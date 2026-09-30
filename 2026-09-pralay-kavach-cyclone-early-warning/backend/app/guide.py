"""Walking guidance to a shelter, and help requests filed straight from the phone.

Routes come from the OpenStreetMap foot router (FOSSGIS, routing.openstreetmap.de) with turn-by-turn steps;
if it is unreachable we fall back to a straight line. Every route is checked against the storm-surge forecast
at plan time and against verified water reports from residents, so the phone can warn about water ahead.
"""

from __future__ import annotations

import logging
import time
import uuid

import httpx
import numpy as np

from . import bot, citizen, store
from .exposure import _sample_max, district_of
from .geo import haversine_km
from .surge import run_at

log = logging.getLogger("guide")
ROUTER = "https://routing.openstreetmap.de/routed-foot/route/v1/driving/{a};{b}"
_CACHE: dict[tuple, dict] = {}
NEEDS = {"transport", "rescue", "medical"}


def _osm_route(lat: float, lon: float, to_lat: float, to_lon: float) -> dict | None:
    try:
        r = httpx.get(ROUTER.format(a=f"{lon},{lat}", b=f"{to_lon},{to_lat}"),
                      params={"overview": "full", "geometries": "geojson", "steps": "true"}, timeout=8)
        r.raise_for_status()
        route = r.json()["routes"][0]
    except Exception as exc:  # router down or no path: the caller falls back to a straight line
        log.warning("foot router failed: %s", exc)
        return None
    steps = [{"type": s["maneuver"]["type"], "modifier": s["maneuver"].get("modifier"), "name": s.get("name") or "",
              "distance_m": round(s["distance"]), "lon": s["maneuver"]["location"][0], "lat": s["maneuver"]["location"][1]}
             for s in route["legs"][0]["steps"]]
    return {"coords": route["geometry"]["coordinates"], "distance_m": round(route["distance"]),
            "duration_s": round(route["duration"]), "steps": steps, "source": "OpenStreetMap"}


def _straight(lat: float, lon: float, to_lat: float, to_lon: float) -> dict:
    d = float(haversine_km(lat, lon, to_lat, to_lon)) * 1000
    return {"coords": [[lon, lat], [to_lon, to_lat]], "distance_m": round(d), "duration_s": round(d / 1.25),
            "steps": [{"type": "depart", "modifier": None, "name": "", "distance_m": round(d), "lon": lon, "lat": lat},
                      {"type": "arrive", "modifier": None, "name": "", "distance_m": 0, "lon": to_lon, "lat": to_lat}],
            "source": "straight line"}


def _wet_spots(coords: list[list[float]]) -> list[dict]:
    """Points along the route that the surge forecast floods, or where residents reported knee-deep water."""
    lons, lats = np.array([c[0] for c in coords]), np.array([c[1] for c in coords])
    # Densify to roughly every 40 m so short flooded stretches are not skipped.
    seg = haversine_km(lats[:-1], lons[:-1], lats[1:], lons[1:]) * 1000 if len(coords) > 1 else np.array([])
    pts_lat, pts_lon, along, run = [], [], [], 0.0
    for i, d in enumerate(seg):
        n = max(1, int(d // 40))
        for k in range(n):
            f = k / n
            pts_lat.append(lats[i] + f * (lats[i + 1] - lats[i]))
            pts_lon.append(lons[i] + f * (lons[i + 1] - lons[i]))
            along.append(run + f * d)
        run += d
    pts_lat.append(lats[-1]); pts_lon.append(lons[-1]); along.append(run)
    pts_lat, pts_lon, along = np.array(pts_lat), np.array(pts_lon), np.array(along)

    spots = []
    depth = _sample_max(run_at(citizen._plan_t(), "likely").depth, pts_lat, pts_lon)
    for i in np.flatnonzero(depth > 0.3):
        if not spots or along[i] - spots[-1]["at_m"] > 200:
            spots.append({"lat": float(pts_lat[i]), "lon": float(pts_lon[i]), "at_m": round(float(along[i])),
                          "depth_m": round(float(depth[i]), 1), "source": "forecast"})
    for r in citizen.REPORTS:
        if r["verified_depth_m"] < 0.4:
            continue
        d = haversine_km(pts_lat, pts_lon, r["lat"], r["lon"]) * 1000
        i = int(np.argmin(d))
        if d[i] < 150 and along[i] > 150:
            spots.append({"lat": r["lat"], "lon": r["lon"], "at_m": round(float(along[i])),
                          "depth_m": r["verified_depth_m"], "source": "report"})
    return sorted(spots, key=lambda s: s["at_m"])


def walk(lat: float, lon: float, to_lat: float, to_lon: float) -> dict:
    key = tuple(round(v, 4) for v in (lat, lon, to_lat, to_lon))
    route = _CACHE.get(key)
    if route is None:
        route = _osm_route(lat, lon, to_lat, to_lon) or _straight(lat, lon, to_lat, to_lon)
        if route["source"] != "straight line":
            _CACHE[key] = route
    return {**route, "wet": _wet_spots(route["coords"])}


def request_help(lat: float, lon: float, need: str, people: int | None, note: str, lang: str, household: list[str]) -> dict:
    need = need if need in NEEDS else "transport"
    who = ", ".join(household) if household else "no special needs given"
    item = {"id": str(uuid.uuid4())[:8], "time": time.time(), "lat": lat, "lon": lon, "district": district_of(lat, lon),
            "need": need, "people": people, "note": (note or f"Needs a vehicle to the shelter ({who}).")[:200],
            "lang": lang, "said": f"Requested from the phone: {need}. Household: {who}.", "status": "open", "session": "phone"}
    bot.HELP.append(item)
    store.save()
    return item
