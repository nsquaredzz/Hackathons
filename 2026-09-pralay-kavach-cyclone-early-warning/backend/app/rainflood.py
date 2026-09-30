"""Waterlogging-prone land: where the storm's rain is likely to stand.

A susceptibility layer, not a depth model. Land floods from rain when it sits barely above its
nearest drainage line (HAND, MERIT Hydro), is almost flat, and gets heavy rain (GPM IMERG
2-4 May 2019, which stands in for the rain forecast in the replay):

    prone = HAND <= HAND_MAX_M  and  slope <= SLOPE_MAX_DEG  and  rain >= RAIN_MIN_MM

Thresholds are fitted with spatial cross-validation against the Sentinel-1 flood map (fit on one
half of a checkerboard of ~40 km blocks, score on the other half); see validate.cross_validate().
"""

from __future__ import annotations

from functools import lru_cache

import numpy as np

from .geo import DATA, grid

HAND_MAX_M = 0.3
SLOPE_MAX_DEG = 0.3
RAIN_MIN_MM = 80.0


def available() -> bool:
    return (DATA / "hydro.npz").exists()


def to_grid(arr: np.ndarray, bounds) -> np.ndarray:
    """Nearest-neighbour resample of a lon/lat raster onto the DEM grid."""
    g = grid()
    w, s, e, n = bounds
    lon2d, lat2d = np.meshgrid(g.lons, g.lats)
    h, wd = arr.shape
    cols = np.clip(((lon2d - w) / (e - w) * wd).astype(int), 0, wd - 1)
    rows = np.clip(((n - lat2d) / (n - s) * h).astype(int), 0, h - 1)
    return arr[rows, cols]


@lru_cache(maxsize=1)
def inputs():
    """(rain mm, HAND m, permanent water) on the DEM grid."""
    d = np.load(DATA / "hydro.npz")
    b = d["bounds"]
    return (to_grid(d["rain_mm"], b).astype(np.float32),
            to_grid(d["hand_dm"], b).astype(np.float32) / 10,
            to_grid(d["permanent"], b).astype(bool))


@lru_cache(maxsize=1)
def slope_deg() -> np.ndarray:
    g = grid()
    gy, gx = np.gradient(np.maximum(g.elev, 0).astype(np.float32), g.cell_km * 1000)
    return np.degrees(np.arctan(np.hypot(gx, gy)))


@lru_cache(maxsize=1)
def land_mask() -> np.ndarray:
    from .surge import coast_setup

    return ~coast_setup()["sea"] & ~inputs()[2]


def prone(hand_max=HAND_MAX_M, slope_max=SLOPE_MAX_DEG, rain_min=RAIN_MIN_MM) -> np.ndarray:
    rain, hand, _ = inputs()
    return land_mask() & (hand <= hand_max) & (slope_deg() <= slope_max) & (rain >= rain_min)


@lru_cache(maxsize=1)
def prone_default() -> np.ndarray:
    g = grid()
    return prone() if available() else np.zeros(g.elev.shape, dtype=bool)
