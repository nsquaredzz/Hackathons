"""First-order storm-surge screening model.

At every coastal cell and every hour of the storm's approach:
    surge = inverse barometer (1 cm per hPa below ambient)
          + wind setup  (K x shelf factor x onshore wind^2)
          + tide allowance
The shelf factor comes from real bathymetry: shallow, wide shelves pile water up more.
Peak water levels then spread inland over the elevation model, losing height with distance
(friction), and only into land hydraulically connected to the sea.

It is a prioritisation tool, not a replacement for ADCIRC-class hydrodynamic models.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from functools import lru_cache

import numpy as np
from PIL import Image
from scipy import ndimage

from .geo import grid
from .storm import P_ENV, forecast_fixes, holland_fields, landfall_index, landfall_time, motion_ms

WIND_SETUP_K = 7e-4  # m per (m/s)^2, calibrated so Fani peaks near the ~1.5-2.5 m reported along the Puri coast
TIDE_M = 0.4  # allowance for high tide
INLAND_DECAY_M_PER_KM = 0.12
MAX_INLAND_KM = 30


@lru_cache(maxsize=1)
def coast_setup():
    g = grid()
    elev = g.elev
    water = elev <= 0
    labels, _ = ndimage.label(water)
    # The sea is the water body touching the southern/eastern image edges.
    edge = np.concatenate([labels[-1, :], labels[:, -1]])
    sea_labels = np.unique(edge[edge > 0])
    sea = np.isin(labels, sea_labels)
    land = ~sea
    coast = sea & ndimage.binary_dilation(land, iterations=1)

    # Shelf factor from mean depth within ~15 km offshore.
    depth = np.where(sea, -elev, 0).astype(np.float32)
    size = max(int(15 / g.cell_km), 3)
    mean_depth = ndimage.uniform_filter(depth, size) / np.maximum(ndimage.uniform_filter(sea.astype(np.float32), size), 1e-3)
    shelf = np.clip((20.0 / np.maximum(mean_depth, 5.0)) ** 0.5, 0.6, 1.8)

    # Inland-pointing unit normal from a smoothed land mask (rows run south, so north = -d/drow).
    smooth = ndimage.gaussian_filter(land.astype(np.float32), sigma=max(int(4 / g.cell_km), 2))
    gy, gx = np.gradient(smooth)
    nx, ny = gx, -gy
    norm = np.maximum(np.hypot(nx, ny), 1e-6)
    nx, ny = nx / norm, ny / norm

    rows, cols = np.nonzero(coast)
    dist_px, (irow, icol) = ndimage.distance_transform_edt(~coast, return_indices=True)
    return {
        "sea": sea, "land": land, "rows": rows, "cols": cols,
        "lats": g.lats[rows], "lons": g.lons[cols],
        "shelf": shelf[rows, cols], "nx": nx[rows, cols], "ny": ny[rows, cols],
        "dist_km": dist_px * g.cell_km, "near_row": irow, "near_col": icol,
    }


@dataclass
class SurgeResult:
    scenario: str
    depth: np.ndarray  # metres of water over land, 0 where dry
    coast_peak: np.ndarray  # peak water level at each coastal cell
    coast_arrival_h: np.ndarray  # hours relative to landfall when water passes half its peak
    arrival_h: np.ndarray  # same, spread to every cell
    max_level: float
    flooded_km2: float


def _compute(t_rel: float, scenario: str) -> SurgeResult:
    g, c = grid(), coast_setup()
    fixes = forecast_fixes(t_rel, scenario)
    lf = landfall_time()
    n = len(c["rows"])
    peak = np.zeros(n, dtype=np.float32)
    arrival = np.full(n, np.nan, dtype=np.float32)
    levels_by_hour = []
    hours = []
    for k, f in enumerate(fixes):
        # Only hours when the storm can affect this coast.
        if abs(f.lat - 20.2) > 5 or abs(f.lon - 86.0) > 5:
            continue
        nxt = fixes[min(k + 1, len(fixes) - 1)]
        pres, ux, uy = holland_fields(f, c["lats"], c["lons"], motion_ms(f, nxt) if nxt is not f else (0, 0))
        onshore = np.maximum(ux * c["nx"] + uy * c["ny"], 0)
        level = 0.01 * (P_ENV - pres) + WIND_SETUP_K * c["shelf"] * onshore ** 2 + TIDE_M
        levels_by_hour.append(level.astype(np.float32))
        hours.append((f.time - lf).total_seconds() / 3600)
        peak = np.maximum(peak, level)
    if levels_by_hour:
        stack = np.stack(levels_by_hour)
        surge_only = stack - TIDE_M  # tide alone should not count as the surge arriving
        hit = surge_only >= np.maximum(0.5 * (peak - TIDE_M), 0.3)[None, :]
        first = np.argmax(hit, axis=0)
        arrival = np.where(hit.any(axis=0), np.array(hours)[first], np.nan).astype(np.float32)

    # Spread peak levels inland from the nearest coastal cell.
    idx = np.full(g.elev.shape, -1, dtype=np.int64)
    idx[c["rows"], c["cols"]] = np.arange(n)
    nearest = idx[c["near_row"], c["near_col"]]
    level = peak[nearest] - INLAND_DECAY_M_PER_KM * c["dist_km"]
    # Inland ponds and DEM voids sit below 0 m; treat them as ground level, not deep holes.
    depth = np.where(c["land"], level - np.maximum(g.elev, 0), 0)
    wet = (depth > 0.1) & (c["dist_km"] < MAX_INLAND_KM)
    labels, _ = ndimage.label(wet | c["sea"])
    connected = np.isin(labels, np.unique(labels[c["sea"]]))
    depth = np.where(wet & connected, depth, 0).astype(np.float32)
    return SurgeResult(
        scenario=scenario, depth=depth, coast_peak=peak, coast_arrival_h=arrival,
        arrival_h=arrival[nearest].astype(np.float32), max_level=float(peak.max()) if n else 0.0,
        flooded_km2=float((depth > 0).sum() * g.cell_km ** 2),
    )


@lru_cache(maxsize=32)
def run(t_rel_bucket: int, scenario: str = "likely") -> SurgeResult:
    return _compute(t_rel_bucket, scenario)


def bucket(t_rel: float) -> int:
    """Surge only changes with lead time through the scenario spread; bucket to 6 h."""
    return int(np.clip(6 * round(t_rel / 6), -72, 0))


def run_at(t_rel: float, scenario: str = "likely") -> SurgeResult:
    return run(bucket(t_rel), scenario)


_RAMP = np.array([
    [0.10, 165, 228, 255, 110],
    [0.75, 111, 211, 255, 170],
    [1.50, 47, 143, 216, 205],
    [2.50, 30, 100, 180, 225],
    [3.50, 21, 78, 134, 240],
], dtype=np.float32)


def depth_png(depth: np.ndarray, max_px: int = 1600) -> bytes:
    d = depth
    step = max(1, int(np.ceil(max(d.shape) / max_px)))
    d = d[::step, ::step]
    rgba = np.zeros(d.shape + (4,), dtype=np.uint8)
    for ch in range(4):
        rgba[..., ch] = np.interp(d, _RAMP[:, 0], _RAMP[:, ch + 1]).astype(np.uint8)
    rgba[d <= 0.1] = 0
    buf = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(buf, "PNG", optimize=True)
    return buf.getvalue()


def landfall_offset_hours() -> int:
    return landfall_index()
