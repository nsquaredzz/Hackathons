"""Who and what the modelled flooding reaches, plus wind exposure for parametric triggers."""

from __future__ import annotations

import json
import math
from functools import lru_cache

import numpy as np
from scipy.spatial import cKDTree

from .geo import DATA, grid, haversine_km, population_on_grid
from .storm import forecast_fixes, holland_fields, motion_ms
from .storm import landfall_time
from .surge import SurgeResult, coast_setup, run_at

# District HQs on the modelled coast. Villages are assigned to the nearest HQ, which is an
# approximation of the real district boundary; swap in census boundaries when available.
DISTRICT_HQS = {
    "Ganjam": (19.39, 84.99), "Puri": (19.81, 85.83), "Khordha": (20.18, 85.62),
    "Cuttack": (20.46, 85.88), "Jagatsinghpur": (20.26, 86.17), "Kendrapara": (20.50, 86.42),
    "Bhadrak": (21.06, 86.50), "Balasore": (21.49, 86.93), "Jajpur": (20.85, 86.33),
    "Nayagarh": (20.13, 85.10), "Purba Medinipur (WB)": (21.78, 87.75),
}
DISTRICT_LANGUAGES = {"Ganjam": ["or", "te"], "Balasore": ["or", "bn"], "Bhadrak": ["or", "bn"]}
CATCHMENT_KM = 3.0
ROAD_CUT_M = 0.3
PAYOUT_WIND_KMH = 150
GALE_KMH = 62
DESTRUCTIVE_WIND_KMH = 120  # kutcha houses fail; Odisha evacuates these coastal villages
WIND_EVAC_COAST_KM = 20
EXTREME_WIND_KMH = 150
SUM_INSURED_PER_VILLAGE_INR = 1_000_000  # assumption for the demo; set per policy in production


def km_xy(lat, lon):
    lat, lon = np.asarray(lat, dtype=float), np.asarray(lon, dtype=float)
    return np.column_stack([lon * 111.2 * math.cos(math.radians(20.2)), lat * 111.2])


def district_of(lat, lon) -> str:
    names = list(DISTRICT_HQS)
    d = [haversine_km(lat, lon, *DISTRICT_HQS[n]) for n in names]
    return names[int(np.argmin(d))]


@lru_cache(maxsize=1)
def assets() -> list[dict]:
    items = json.loads((DATA / "assets.json").read_text())
    for a in items:
        a["district"] = district_of(a["lat"], a["lon"])
        if not a["name"]:
            a["name"] = {"hospital": "Unnamed hospital", "substation": "Substation", "shelter": "Shelter"}[a["kind"]]
    return items


@lru_cache(maxsize=1)
def roads() -> list[dict]:
    return json.loads((DATA / "roads.json").read_text())


@lru_cache(maxsize=1)
def villages() -> list[dict]:
    items = json.loads((DATA / "villages.json").read_text())
    for v in items:
        v["district"] = district_of(v["lat"], v["lon"])
    return items


@lru_cache(maxsize=1)
def catchments():
    """Assign every populated land cell to its nearest village within CATCHMENT_KM."""
    g = grid()
    pop = population_on_grid()
    rows, cols = np.nonzero((pop > 0) & (g.elev > -5))
    tree = cKDTree(km_xy([v["lat"] for v in villages()], [v["lon"] for v in villages()]))
    dist, vid = tree.query(km_xy(g.lats[rows], g.lons[cols]), distance_upper_bound=CATCHMENT_KM)
    ok = np.isfinite(dist)
    rows, cols, vid = rows[ok], cols[ok], vid[ok]
    people = np.bincount(vid, weights=pop[rows, cols], minlength=len(villages()))
    return rows, cols, vid, people


def _sample_max(depth: np.ndarray, lat, lon, radius_px: int = 1) -> np.ndarray:
    g = grid()
    r, c = g.index(np.asarray(lat), np.asarray(lon))
    best = np.zeros(np.shape(r), dtype=np.float32)
    for dr in range(-radius_px, radius_px + 1):
        for dc in range(-radius_px, radius_px + 1):
            best = np.maximum(best, depth[np.clip(r + dr, 0, g.h - 1), np.clip(c + dc, 0, g.w - 1)])
    return best


def _round_people(n: float) -> int:
    return int(round(n, -2)) if n >= 1000 else int(round(n, -1))


@lru_cache(maxsize=16)
def _analysis(t_bucket: int, scenario: str) -> dict:
    surge = run_at(t_bucket, scenario)
    return analyse(surge, t_bucket)


def analysis(t_rel: float, scenario: str = "likely") -> dict:
    from .surge import bucket
    return _analysis(bucket(t_rel), scenario)


def wind_exposure(t_rel: float, scenario: str, lats, lons) -> tuple[np.ndarray, np.ndarray]:
    """Peak surface wind (km/h) and the hour (relative to landfall) gales begin, from the replay time on."""
    lats, lons = np.asarray(lats, dtype=float), np.asarray(lons, dtype=float)
    peak = np.zeros(len(lats))
    gale = np.full(len(lats), np.nan)
    lf = landfall_time()
    fixes = forecast_fixes(t_rel, scenario, horizon_h=24)
    for k, f in enumerate(fixes):
        nxt = fixes[min(k + 1, len(fixes) - 1)]
        _, ux, uy = holland_fields(f, lats, lons, motion_ms(f, nxt) if nxt is not f else (0, 0))
        speed = np.hypot(ux, uy) * 3.6
        peak = np.maximum(peak, speed)
        h = (f.time - lf).total_seconds() / 3600
        gale = np.where(np.isnan(gale) & (speed >= GALE_KMH), h, gale)
    return peak, gale


def analyse(surge: SurgeResult, t_rel: float) -> dict:
    """Evacuation need from two hazards, the way Odisha decides it: storm surge flooding, and
    destructive wind near the coast (where kutcha houses fail)."""
    depth = surge.depth
    vs = villages()
    coast_km = coast_setup()["dist_km"]

    # Surge: flooded population, peak depth and water arrival per village.
    rows, cols, vid, people = catchments()
    d = depth[rows, cols]
    wet = d > 0.1
    pop = population_on_grid()[rows, cols]
    flooded_people = np.bincount(vid[wet], weights=pop[wet], minlength=len(vs))
    max_depth = np.zeros(len(vs), dtype=np.float32)
    np.maximum.at(max_depth, vid[wet], d[wet])
    arrival = np.full(len(vs), np.nan, dtype=np.float32)
    arr_cells = surge.arrival_h[rows, cols]
    for i in np.unique(vid[wet]):
        sel = (vid == i) & wet
        arrival[i] = np.nanmin(arr_cells[sel]) if np.isfinite(arr_cells[sel]).any() else np.nan

    # Wind: peak gusts and when gales start, per village.
    v_lat = np.array([v["lat"] for v in vs])
    v_lon = np.array([v["lon"] for v in vs])
    wind, gale = wind_exposure(t_rel, surge.scenario, v_lat, v_lon)
    r_, c_ = grid().index(v_lon, v_lat)
    v_coast = coast_km[r_, c_]
    wind_zone = (wind >= DESTRUCTIVE_WIND_KMH) & (v_coast <= WIND_EVAC_COAST_KM)
    wind_people = np.where(wind_zone, people, 0)

    # Assets: flooded, or in extreme wind.
    items = assets()
    a_lat = [a["lat"] for a in items]
    a_lon = [a["lon"] for a in items]
    a_depth = _sample_max(depth, a_lat, a_lon)
    a_wind, _ = wind_exposure(t_rel, surge.scenario, a_lat, a_lon)
    shelters = [(a, float(x)) for a, x in zip(items, a_depth) if a["kind"] == "shelter"]
    safe = [a for a, x in shelters if x <= 0.1]
    safe_tree = cKDTree(km_xy([a["lat"] for a in safe], [a["lon"] for a in safe])) if safe else None

    at_risk = []
    for a, x, w in zip(items, a_depth, a_wind):
        flooded, windy = x > 0.1, a["kind"] != "shelter" and w >= EXTREME_WIND_KMH
        if flooded or windy:
            at_risk.append({**_asset_public(a), "depth_m": round(float(x), 2), "wind_kmh": round(float(w)),
                            "hazard": "flood + wind" if flooded and windy else "flood" if flooded else "wind"})

    # Evacuation candidates, highest risk first.
    need = np.maximum(flooded_people, wind_people)
    score = flooded_people * (1 + max_depth) * 1.5 + wind_people * np.clip((wind - 100) / 80, 0, 2)
    order = np.argsort(-score)
    candidates = []
    for i in order[:60]:
        if need[i] < 50:
            break
        v = vs[i]
        surge_leave = float(arrival[i]) - 6 if np.isfinite(arrival[i]) else np.inf
        wind_leave = float(gale[i]) - 3 if np.isfinite(gale[i]) else np.inf
        leave_by = min(surge_leave, wind_leave)
        leave_by = -6.0 if not np.isfinite(leave_by) else leave_by
        shelter, route, dist = None, "none", None
        if safe_tree is not None:
            dists, idxs = safe_tree.query(km_xy([v["lat"]], [v["lon"]])[0], k=min(3, len(safe)))
            best = None
            for dd, si in zip(np.atleast_1d(dists), np.atleast_1d(idxs)):
                s_ = safe[int(si)]
                status, floods_at = _route_status(depth, surge.arrival_h, v, s_)
                if best is None or (status == "dry" and best[1] != "dry"):
                    best = (s_, status, floods_at, float(dd))
            shelter, route, floods_at, dist = best
            route = route if route == "dry" else f"floods T{floods_at:+.0f}h" if floods_at is not None else "floods"
        hazards = [h for h, on in (("surge", flooded_people[i] >= 50), ("wind", wind_zone[i])) if on]
        candidates.append({
            "id": v["id"], "name": v["name"], "name_or": v.get("name_or"), "district": v["district"],
            "lat": v["lat"], "lon": v["lon"], "people_total": _round_people(people[i]),
            "people_at_risk": _round_people(need[i]), "people_flooded": _round_people(flooded_people[i]),
            "peak_depth_m": round(float(max_depth[i]), 2), "peak_wind_kmh": round(float(wind[i])),
            "coast_km": round(float(v_coast[i]), 1), "hazard": " + ".join(hazards),
            "water_arrives_h": None if not np.isfinite(arrival[i]) else round(float(arrival[i])),
            "gales_from_h": None if not np.isfinite(gale[i]) else round(float(gale[i])),
            "leave_by_h": round(leave_by),
            "shelter": None if shelter is None else {**_asset_public(shelter), "distance_km": round(dist, 1)},
            "route": route,
        })

    cut_roads, cut_km = _road_cuts(depth)
    return {
        "scenario": surge.scenario,
        "max_level_m": round(surge.max_level, 2),
        "flooded_km2": round(surge.flooded_km2),
        "people_in_flood_zone": _round_people(float(flooded_people.sum())),
        "people_in_wind_zone": _round_people(float(wind_people.sum())),
        "people_to_evacuate": _round_people(float(need.sum())),
        "counts": {
            "hospitals": sum(1 for a in at_risk if a["kind"] == "hospital"),
            "substations": sum(1 for a in at_risk if a["kind"] == "substation"),
            "shelters_flooded": sum(1 for a in at_risk if a["kind"] == "shelter"),
            "villages": int((need >= 50).sum()),
            "road_km_cut": round(cut_km),
        },
        "thresholds": {"destructive_wind_kmh": DESTRUCTIVE_WIND_KMH, "wind_evac_coast_km": WIND_EVAC_COAST_KM,
                       "extreme_wind_kmh": EXTREME_WIND_KMH},
        "assets_at_risk": sorted(at_risk, key=lambda a: (-a["depth_m"], -a["wind_kmh"])),
        "candidates": candidates,
        "cut_roads": cut_roads,
        "districts": _district_summary(candidates),
    }


def _asset_public(a: dict) -> dict:
    return {"id": a["id"], "kind": a["kind"], "name": a["name"], "lat": a["lat"], "lon": a["lon"],
            "district": a["district"], "proxy": a.get("proxy", False)}


def _route_status(depth, arrival_h, v, s):
    """Straight-line route proxy: does the line from village to shelter cross flooded ground?"""
    lats = np.linspace(v["lat"], s["lat"], 40)
    lons = np.linspace(v["lon"], s["lon"], 40)
    g = grid()
    r, c = g.index(lons, lats)
    wet = depth[r, c] > ROAD_CUT_M
    if not wet.any():
        return "dry", None
    t = arrival_h[r, c][wet]
    t = t[np.isfinite(t)]
    return "floods", (float(t.min()) if len(t) else None)


def _road_cuts(depth):
    g = grid()
    cut, total_km = [], 0.0
    for road in roads():
        pts = np.array(road["coords"])
        r, c = g.index(pts[:, 0], pts[:, 1])
        wet = depth[r, c] > ROAD_CUT_M
        if not wet.any():
            continue
        seg = wet[:-1] | wet[1:]
        km = haversine_km(pts[:-1, 1], pts[:-1, 0], pts[1:, 1], pts[1:, 0])
        total_km += float(km[seg].sum())
        # Emit only the wet stretches as line pieces.
        piece = []
        for k in range(len(pts)):
            if wet[k] or (k > 0 and wet[k - 1]) or (k + 1 < len(pts) and wet[k + 1]):
                piece.append(pts[k].tolist())
            elif piece:
                if len(piece) > 1:
                    cut.append({"ref": road["ref"], "class": road["class"], "coords": piece})
                piece = []
        if len(piece) > 1:
            cut.append({"ref": road["ref"], "class": road["class"], "coords": piece})
    return cut, total_km


def _district_summary(candidates):
    out = {}
    for cnd in candidates:
        d = out.setdefault(cnd["district"], {"district": cnd["district"], "people_at_risk": 0, "villages": 0,
                                             "earliest_leave_by_h": 0})
        d["people_at_risk"] += cnd["people_at_risk"]
        d["villages"] += 1
        d["earliest_leave_by_h"] = min(d["earliest_leave_by_h"], cnd["leave_by_h"])
    return sorted(out.values(), key=lambda d: -d["people_at_risk"])


@lru_cache(maxsize=4)
def peak_winds(scenario: str = "likely") -> np.ndarray:
    """Peak surface wind (km/h) at every village over the storm's life."""
    vs = villages()
    lats = np.array([v["lat"] for v in vs])
    lons = np.array([v["lon"] for v in vs])
    peak = np.zeros(len(vs))
    fixes = forecast_fixes(-72, scenario, horizon_h=36)
    for k, f in enumerate(fixes):
        nxt = fixes[min(k + 1, len(fixes) - 1)]
        _, ux, uy = holland_fields(f, lats, lons, motion_ms(f, nxt) if nxt is not f else (0, 0))
        peak = np.maximum(peak, np.hypot(ux, uy) * 3.6)
    return peak


def parametric(scenario: str = "likely") -> dict:
    vs = villages()
    wind = peak_winds(scenario)
    rows = {}
    for v, w in zip(vs, wind):
        r = rows.setdefault(v["district"], {"district": v["district"], "villages": 0, "triggered": 0, "peak_wind_kmh": 0.0})
        r["villages"] += 1
        r["triggered"] += int(w >= PAYOUT_WIND_KMH)
        r["peak_wind_kmh"] = max(r["peak_wind_kmh"], float(w))
    table = sorted(rows.values(), key=lambda r: -r["peak_wind_kmh"])
    for r in table:
        r["peak_wind_kmh"] = round(r["peak_wind_kmh"])
        r["payout_inr"] = r["triggered"] * SUM_INSURED_PER_VILLAGE_INR
    triggered = sum(r["triggered"] for r in table)
    return {
        "threshold_kmh": PAYOUT_WIND_KMH,
        "insured_units": len(vs),
        "triggered_units": triggered,
        "sum_insured_per_unit_inr": SUM_INSURED_PER_VILLAGE_INR,
        "payout_inr": triggered * SUM_INSURED_PER_VILLAGE_INR,
        "by_district": table,
        "note": "Wind from a Holland (1980) parametric model on the IBTrACS best track. "
                "Sum insured per village is a demo assumption.",
    }


@lru_cache(maxsize=1)
def waterlogging_summary() -> dict | None:
    """Villages whose surroundings are waterlogging-prone under the storm's rain."""
    from . import rainflood

    if not rainflood.available():
        return None
    prone = rainflood.prone_default()
    rows, cols, vid, people = catchments()
    vs = villages()
    # Villages where at least a tenth of the surrounding populated land is prone.
    share = np.bincount(vid, weights=prone[rows, cols].astype(float), minlength=len(vs)) / \
        np.maximum(np.bincount(vid, minlength=len(vs)), 1)
    return {"villages": int((share >= 0.1).sum()),
            "people": _round_people(float(population_on_grid()[prone].sum())),  # living on prone land itself
            "km2": round(float(prone.sum() * grid().cell_km ** 2))}


FLOOD_PAYOUT_PER_VILLAGE_INR = 500_000  # demo assumption, like the wind cover


def flood_payout() -> dict | None:
    """Flood cover triggered by the satellite: villages with standing water on the radar pass."""
    from . import validate

    v = validate.flooded_villages()
    if not validate.available():
        return None
    return {"trigger": "Standing water detected by Sentinel-1 in the village's surroundings",
            "villages": len(v), "per_village_inr": FLOOD_PAYOUT_PER_VILLAGE_INR,
            "payout_inr": len(v) * FLOOD_PAYOUT_PER_VILLAGE_INR}
