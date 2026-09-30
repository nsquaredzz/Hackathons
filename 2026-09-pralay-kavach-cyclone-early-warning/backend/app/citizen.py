"""The citizen side: a personalised feed and photo reports of rising water."""

from __future__ import annotations

import time
import uuid

import numpy as np
from scipy.spatial import cKDTree

from . import advisory, agent, llm
from .exposure import _route_status, assets, district_of, km_xy
from .geo import haversine_km
from .surge import run_at

REPORTS: list[dict] = []
DEPTH_CHOICES = {"ankle": 0.15, "knee": 0.5, "waist": 1.0, "higher": 1.5}


def _plan_t() -> int:
    plan = agent.STATE.get("plan")
    return plan["t_rel"] if plan else -24


def _blocked_by_reports(v: dict, s: dict) -> bool:
    """A route is blocked by a verified report of knee-deep water or worse lying along it
    (not at the starting point, which every route shares)."""
    wet = [r for r in REPORTS if r["verified_depth_m"] >= 0.4]
    if not wet:
        return False
    lats = np.linspace(v["lat"], s["lat"], 60)
    lons = np.linspace(v["lon"], s["lon"], 60)
    along = haversine_km(v["lat"], v["lon"], lats, lons) > 0.25
    for r in wet:
        if haversine_km(v["lat"], v["lon"], r["lat"], r["lon"]) < 0.25:
            continue
        if along.any() and haversine_km(lats[along], lons[along], r["lat"], r["lon"]).min() < 0.4:
            return True
    return False


def shelter_for(lat: float, lon: float) -> dict | None:
    surge = run_at(_plan_t(), "likely")
    from .exposure import _sample_max

    shelters = [a for a in assets() if a["kind"] == "shelter"]
    depth = _sample_max(surge.depth, [a["lat"] for a in shelters], [a["lon"] for a in shelters])
    safe = [a for a, d in zip(shelters, depth) if d <= 0.1]
    if not safe:
        return None
    tree = cKDTree(km_xy([a["lat"] for a in safe], [a["lon"] for a in safe]))
    dists, idxs = tree.query(km_xy([lat], [lon])[0], k=min(15, len(safe)))
    me = {"lat": lat, "lon": lon}
    first = None
    for d, i in zip(np.atleast_1d(dists), np.atleast_1d(idxs)):
        s = safe[int(i)]
        status, floods_at = _route_status(surge.depth, surge.arrival_h, me, s)
        blocked = _blocked_by_reports(me, s)
        option = {"id": s["id"], "name": s["name"], "lat": s["lat"], "lon": s["lon"], "proxy": s.get("proxy"),
                  "distance_km": round(float(haversine_km(lat, lon, s["lat"], s["lon"])), 1),
                  "route": "blocked by reported flooding" if blocked else status,
                  "floods_at_h": floods_at}
        first = first or option
        if status == "dry" and not blocked:
            option["rerouted"] = option["id"] != first["id"]
            if option["rerouted"]:
                option["previous"] = first["name"]
            return option
    return first


def feed(lat: float, lon: float) -> dict:
    district = district_of(lat, lon)
    alerts = advisory.dispatched_for(district)
    return {
        "district": district,
        "alerts": [{"id": a["id"], "texts": a["texts"], "languages": a["languages"],
                    "dispatched_at": a.get("dispatched_at"), "facts": a["facts"]} for a in alerts],
        "shelter": shelter_for(lat, lon) if alerts else None,
        "reports": [r for r in REPORTS if haversine_km(lat, lon, r["lat"], r["lon"]) < 10][-5:],
    }


def report(lat: float, lon: float, depth_choice: str, photo: bytes | None, mime: str | None,
           home: tuple[float, float] | None = None) -> dict:
    """`lat, lon` is where the water is; `home` is where the reporter is headed from (defaults to the same spot)."""
    surge = run_at(_plan_t(), "likely")
    from .exposure import _sample_max

    model_depth = float(_sample_max(surge.depth, [lat], [lon], radius_px=3)[0])
    claimed = DEPTH_CHOICES.get(depth_choice, 0.5)

    def fallback():
        return {"is_flood_photo": True, "water_level": depth_choice, "depth_m": claimed,
                "notes": "Photo not analysed (no model key); using the level the reporter chose."}

    check, meta = ({}, llm.provider_info())
    if photo:
        check, meta = llm.ask_json(
            "You verify citizen flood photos for a disaster control room. Be conservative.",
            "Does this photo show flood water in a street or settlement? Estimate the water level against people, "
            "vehicles or buildings. The reporter said: " + depth_choice + ".\nReturn JSON: {is_flood_photo: bool, "
            "water_level: ankle|knee|waist|higher|none, depth_m: number, notes: one sentence}",
            fallback, images=[(photo, mime or "image/jpeg")])
    else:
        check = fallback()
    verified = float(check.get("depth_m") or 0) if check.get("is_flood_photo", True) else 0.0
    agrees = (model_depth > 0.1) == (verified > 0.1)
    item = {
        "id": str(uuid.uuid4())[:8], "lat": lat, "lon": lon, "time": time.time(), "district": district_of(lat, lon),
        "reported_level": depth_choice, "verified_level": check.get("water_level", depth_choice),
        "verified_depth_m": round(verified, 2), "model_depth_m": round(model_depth, 2),
        "matches_model": agrees, "notes": check.get("notes", ""), "llm": meta,
    }
    REPORTS.append(item)
    from . import store
    store.save()
    return {"report": item, "shelter": shelter_for(*(home or (lat, lon)))}
