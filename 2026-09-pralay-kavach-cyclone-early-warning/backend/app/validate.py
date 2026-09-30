"""Checking the forecast against what happened, and the satellite flood map as a product.

Sentinel-1 radar (via `pipeline/gee_precompute.py`) first saw the area on 4 May 2019, about
20 hours after landfall. By then the storm surge had drained back to sea, so the radar shows
rain and river water standing inland. That sets what can and cannot be checked:

  - Surge forecast: not checkable with this pass (the water was gone). Said plainly.
  - Waterlogging-prone land: checked with spatial cross-validation (fit on half, score on the other).
  - Evacuation: the model's count against the reported evacuation.
And after landfall the observed map itself drives relief targeting and flood-triggered payouts.
"""

from __future__ import annotations

import io
import itertools
import json
from functools import lru_cache

import numpy as np
from PIL import Image

from . import rainflood
from .geo import DATA, grid

OBSERVED = DATA / "observed_flood.npz"
CV_CACHE = DATA / "cv_waterlogging.json"
SATELLITE_DATE = "4 May 2019"
REPORTED_EVACUATION = {
    "people": 1_200_000,
    "text": "About 1.2 million people were evacuated across Odisha ahead of Fani.",
    "source": "Government of Odisha / UN reports, May 2019",
}


def available() -> bool:
    return OBSERVED.exists()


@lru_cache(maxsize=1)
def observed_on_grid() -> np.ndarray | None:
    if not available():
        return None
    d = np.load(OBSERVED)
    return rainflood.to_grid(d["mask"], d["bounds"]).astype(bool)


def _folds() -> np.ndarray:
    """Checkerboard of ~40 km blocks: 0 / 1."""
    g = grid()
    lon2d, lat2d = np.meshgrid(g.lons, g.lats)
    return ((np.floor((lon2d - 84.4) / 0.4) + np.floor((lat2d - 18.9) / 0.4)) % 2).astype(np.int8)


def cross_validate(force: bool = False) -> dict | None:
    """Fit waterlogging thresholds on one fold, score on the other, both ways. Cached to disk."""
    if not (available() and rainflood.available()):
        return None
    if CV_CACHE.exists() and not force:
        return json.loads(CV_CACHE.read_text())
    obs = observed_on_grid()
    land = rainflood.land_mask()
    folds = _folds()
    rain, hand, _ = rainflood.inputs()
    slope = rainflood.slope_deg()
    grid_h, grid_s, grid_r = [0.3, 0.6, 1.0, 1.5, 2.0, 3.0], [0.3, 0.5, 1.0, 2.0], [0, 60, 75, 85, 100]

    def iou(p, m):
        u = ((p | obs) & m).sum()
        return float((p & obs & m).sum() / u) if u else 0.0

    tests = []
    for train in (0, 1):
        m = (folds == train) & land
        best = max(itertools.product(grid_h, grid_s, grid_r),
                   key=lambda t: iou(land & (hand <= t[0]) & (slope <= t[1]) & (rain >= t[2]), m))
        p = land & (hand <= best[0]) & (slope <= best[1]) & (rain >= best[2])
        test = (folds != train) & land
        flagged = float((p & test).sum() / test.sum())
        caught = float((p & obs & test).sum() / max((obs & test).sum(), 1))
        tests.append({"fit_on_fold": train, "params": {"hand_max_m": best[0], "slope_max_deg": best[1], "rain_min_mm": best[2]},
                      "test_land_flagged": round(flagged, 4), "test_flooding_caught": round(caught, 3),
                      "lift": round(caught / flagged, 1) if flagged else None, "test_iou": round(iou(p, test), 3)})
    out = {
        "method": "Spatial cross-validation: thresholds fitted on one half of a checkerboard of ~40 km blocks, "
                  "scored on the other half, both ways.",
        "folds": tests,
        "land_flagged": round(float(np.mean([t["test_land_flagged"] for t in tests])), 4),
        "flooding_caught": round(float(np.mean([t["test_flooding_caught"] for t in tests])), 3),
        "lift": round(float(np.mean([t["lift"] for t in tests if t["lift"]])), 1),
    }
    CV_CACHE.write_text(json.dumps(out, indent=1))
    return out


@lru_cache(maxsize=1)
def flooded_villages() -> list[dict]:
    """Villages with standing water in their catchment on the satellite pass."""
    from . import exposure

    obs = observed_on_grid()
    if obs is None:
        return []
    rows, cols, vid, people = exposure.catchments()
    vs = exposure.villages()
    cells = np.bincount(vid, weights=obs[rows, cols].astype(float), minlength=len(vs))
    km2 = cells * grid().cell_km ** 2
    out = [{"id": vs[i]["id"], "name": vs[i]["name"], "district": vs[i]["district"], "lat": vs[i]["lat"],
            "lon": vs[i]["lon"], "people": int(round(people[i], -1)), "water_km2": round(float(km2[i]), 2)}
           for i in np.flatnonzero(cells >= 3)]
    return sorted(out, key=lambda v: -v["water_km2"])


def compare(plan_people: int | None = None) -> dict:
    if not available():
        return {
            "available": False,
            "message": "No satellite flood map yet. Run `python -m pipeline.gee_precompute` with an Earth Engine "
                       "project to pull the Sentinel-1 flood extent for Fani, then reload.",
        }
    obs = observed_on_grid()
    g = grid()
    villages = flooded_villages()
    by_district: dict[str, dict] = {}
    for v in villages:
        d = by_district.setdefault(v["district"], {"district": v["district"], "villages": 0, "people": 0, "water_km2": 0.0})
        d["villages"] += 1
        d["people"] += v["people"]
        d["water_km2"] = round(d["water_km2"] + v["water_km2"], 1)
    return {
        "available": True,
        "satellite": {
            "date": SATELLITE_DATE, "sensor": "Sentinel-1 SAR (VV), same-orbit change detection",
            "observed_km2": round(float(obs.sum() * g.cell_km ** 2)),
            "villages": len(villages), "people_in_villages": int(sum(v["people"] for v in villages)),
            "top_villages": villages[:8],
            "by_district": sorted(by_district.values(), key=lambda d: -d["water_km2"])[:6],
        },
        "surge_check": {
            "checkable": False,
            "text": "The surge drained within hours of landfall; the first radar pass came about 20 hours later, "
                    "so it cannot confirm or refute the surge forecast. Tide-gauge and field surveys are needed for that.",
        },
        "waterlogging_check": cross_validate(),
        "evacuation_check": {"model_people": plan_people, **REPORTED_EVACUATION},
    }


def _png(mask: np.ndarray, rgba: tuple[int, int, int, int], step: int = 2) -> bytes:
    m = mask[::step, ::step]
    out = np.zeros(m.shape + (4,), dtype=np.uint8)
    out[m] = rgba
    buf = io.BytesIO()
    Image.fromarray(out, "RGBA").save(buf, "PNG", optimize=True)
    return buf.getvalue()


@lru_cache(maxsize=1)
def observed_png() -> bytes | None:
    obs = observed_on_grid()
    if obs is None:
        return None
    # Thicken slightly so small patches stay visible when zoomed out.
    from scipy import ndimage
    return _png(ndimage.binary_dilation(obs, iterations=1), (255, 138, 76, 235))


@lru_cache(maxsize=1)
def waterlogging_png() -> bytes | None:
    if not rainflood.available():
        return None
    return _png(rainflood.prone_default(), (143, 220, 255, 150))
