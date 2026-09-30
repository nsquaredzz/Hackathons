"""Shared geography: region bounds, Web Mercator helpers and the loaded grids."""

from __future__ import annotations

import math
from functools import lru_cache
from pathlib import Path

import numpy as np

# Odisha coast from Ganjam to Balasore: (west, south, east, north)
BBOX = (84.4, 18.9, 87.6, 21.9)
DEM_ZOOM = 10
EARTH_R = 6378137.0
DATA = Path(__file__).resolve().parent.parent / "data"


def lonlat_to_merc(lon, lat):
    x = np.radians(lon) * EARTH_R
    y = np.log(np.tan(np.pi / 4 + np.radians(lat) / 2)) * EARTH_R
    return x, y


def merc_to_lonlat(x, y):
    lon = np.degrees(x / EARTH_R)
    lat = np.degrees(2 * np.arctan(np.exp(y / EARTH_R)) - np.pi / 2)
    return lon, lat


def lonlat_to_tile(lon: float, lat: float, z: int) -> tuple[int, int]:
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


def tile_bounds_mercator(x: int, y: int, z: int) -> tuple[float, float, float, float]:
    """(minx, maxy, maxx, miny) of a tile, i.e. top-left then bottom-right."""
    size = 2 * math.pi * EARTH_R / 2 ** z
    origin = math.pi * EARTH_R
    return x * size - origin, origin - y * size, (x + 1) * size - origin, origin - (y + 1) * size


def haversine_km(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dp, dl = p2 - p1, np.radians(np.asarray(lon2) - np.asarray(lon1))
    a = np.sin(dp / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * 6371.0 * np.arcsin(np.sqrt(a))


class Grid:
    """The DEM grid (Web Mercator, north-up) that every model layer shares."""

    def __init__(self, elev: np.ndarray, merc_bounds: np.ndarray):
        self.elev = elev
        self.h, self.w = elev.shape
        self.mx0, self.my0, self.mx1, self.my1 = (float(v) for v in merc_bounds)
        self.dx = (self.mx1 - self.mx0) / self.w
        self.dy = (self.my1 - self.my0) / self.h
        xs = self.mx0 + (np.arange(self.w) + 0.5) * self.dx
        ys = self.my1 - (np.arange(self.h) + 0.5) * self.dy
        self.lons, _ = merc_to_lonlat(xs, np.zeros_like(xs))
        _, self.lats = merc_to_lonlat(np.zeros_like(ys), ys)
        # Ground size of one cell in km (varies slowly with latitude).
        self.cell_km = self.dx / 1000 * np.cos(np.radians(self.lats.mean()))

    def index(self, lon, lat):
        mx, my = lonlat_to_merc(np.asarray(lon, dtype=float), np.asarray(lat, dtype=float))
        col = ((mx - self.mx0) / self.dx).astype(int)
        row = ((self.my1 - my) / self.dy).astype(int)
        return np.clip(row, 0, self.h - 1), np.clip(col, 0, self.w - 1)

    def lonlat_bounds(self):
        lon0, lat0 = merc_to_lonlat(self.mx0, self.my0)
        lon1, lat1 = merc_to_lonlat(self.mx1, self.my1)
        return float(lon0), float(lat0), float(lon1), float(lat1)

    def corners(self):
        """MapLibre image-source corners: TL, TR, BR, BL."""
        w, s, e, n = self.lonlat_bounds()
        return [[w, n], [e, n], [e, s], [w, s]]


@lru_cache(maxsize=1)
def grid() -> Grid:
    d = np.load(DATA / "dem.npz")
    return Grid(d["elev"], d["merc_bounds"])


@lru_cache(maxsize=1)
def population_on_grid() -> np.ndarray:
    """WorldPop people per DEM cell (nearest-neighbour resample, mass-preserving)."""
    g = grid()
    d = np.load(DATA / "population.npz")
    pop, (w, s, e, n) = d["pop"], d["bounds"]
    ph, pw = pop.shape
    lon2d, lat2d = np.meshgrid(g.lons, g.lats)
    cols = np.clip(((lon2d - w) / (e - w) * pw).astype(int), 0, pw - 1)
    rows = np.clip(((n - lat2d) / (n - s) * ph).astype(int), 0, ph - 1)
    sampled = pop[rows, cols]
    # Each 1 km WorldPop cell is split across however many DEM cells fall inside it.
    counts = np.bincount((rows * pw + cols).ravel(), minlength=ph * pw).reshape(ph, pw)
    return (sampled / np.maximum(counts[rows, cols], 1)).astype(np.float32)
