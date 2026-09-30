"""Storm state for a replay time: observed track, forecast track, cone and track scenarios.

Replay times are hours relative to landfall (T-72 ... T+24). The hindcast uses the IBTrACS best
track as the "forecast" after the replay time, widened by a cone sized to typical IMD track errors.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache

import numpy as np

from .geo import DATA, grid

P_ENV = 1010.0  # hPa, ambient pressure
KT = 0.514444  # m/s per knot
SCENARIOS = ("likely", "north", "south")


@dataclass
class Fix:
    time: datetime
    lat: float
    lon: float
    wind_ms: float
    pres: float
    rmax_km: float


def _parse(t: str) -> datetime:
    return datetime.fromisoformat(t.replace("Z", "+00:00"))


@lru_cache(maxsize=1)
def raw_track() -> dict:
    return json.loads((DATA / "fani_track.json").read_text())


@lru_cache(maxsize=1)
def hourly_track() -> list[Fix]:
    pts = raw_track()["points"]
    times = np.array([_parse(p["time"]).timestamp() for p in pts])
    hours = np.arange(times[0], times[-1] + 1, 3600.0)

    def interp(key):
        return np.interp(hours, times, [p[key] for p in pts])

    lat, lon, wind, pres = interp("lat"), interp("lon"), interp("wind_kt"), interp("pres_hpa")
    # JTWC radius of maximum wind is noisy for this storm; keep it in a physically sensible band.
    rmw = np.array([p["rmw_nm"] if p["rmw_nm"] else 20 for p in pts], dtype=float)
    rmax = np.clip(np.interp(hours, times, rmw) * 1.852, 18, 60)
    return [Fix(datetime.fromtimestamp(h, timezone.utc), float(a), float(o), float(w) * KT, float(p), float(r))
            for h, a, o, w, p, r in zip(hours, lat, lon, wind, pres, rmax)]


@lru_cache(maxsize=1)
def landfall_index() -> int:
    """First hourly fix whose centre sits on land inside the modelled region."""
    g = grid()
    w, s, e, n = g.lonlat_bounds()
    for i, f in enumerate(hourly_track()):
        if w < f.lon < e and s < f.lat < n:
            r, c = g.index(f.lon, f.lat)
            if g.elev[r, c] > 0:
                return i
    raise RuntimeError("storm never makes landfall inside the region")


def landfall_time() -> datetime:
    return hourly_track()[landfall_index()].time


def fix_at(t_rel: float) -> Fix:
    track = hourly_track()
    i = int(np.clip(landfall_index() + round(t_rel), 0, len(track) - 1))
    return track[i]


def cone_radius_km(lead_h: float) -> float:
    """Roughly IMD's recent mean track error: ~65 km at 24 h, ~105 km at 48 h, ~140 km at 72 h."""
    return 25 + 1.6 * max(lead_h, 0)


def _offset(lat, lon, bearing_deg, dist_km):
    b = math.radians(bearing_deg)
    dlat = dist_km * math.cos(b) / 111.2
    dlon = dist_km * math.sin(b) / (111.2 * math.cos(math.radians(lat)))
    return lat + dlat, lon + dlon


def _bearing(a: Fix, b: Fix) -> float:
    y = (b.lon - a.lon) * math.cos(math.radians((a.lat + b.lat) / 2))
    return math.degrees(math.atan2(y, b.lat - a.lat)) % 360


def forecast_fixes(t_rel: float, scenario: str = "likely", horizon_h: int = 30) -> list[Fix]:
    """Fixes from the replay time to landfall + horizon, shifted sideways for track scenarios."""
    track = hourly_track()
    i0 = int(np.clip(landfall_index() + round(t_rel), 0, len(track) - 1))
    i1 = min(len(track), landfall_index() + horizon_h)
    out = []
    for i in range(i0, max(i1, i0 + 1)):
        f = track[i]
        lead = i - i0
        if scenario != "likely" and lead > 0:
            prev, nxt = track[max(i - 1, 0)], track[min(i + 1, len(track) - 1)]
            side = 90 if scenario == "south" else -90  # right / left of motion
            # Most of this storm moves north, so "left of motion" is the northern/western shift.
            lat, lon = _offset(f.lat, f.lon, _bearing(prev, nxt) + side, 0.7 * cone_radius_km(lead))
            f = Fix(f.time, lat, lon, f.wind_ms, f.pres, f.rmax_km)
        out.append(f)
    return out


def storm_state(t_rel: float) -> dict:
    track = hourly_track()
    li = landfall_index()
    i0 = int(np.clip(li + round(t_rel), 0, len(track) - 1))
    now = track[i0]
    observed = [[f.lon, f.lat] for f in track[: i0 + 1] if f.lat > 5]
    future = track[i0:]
    forecast = [[f.lon, f.lat] for f in future[:: 3]]

    # Cone: left/right offsets along the forecast track, radius growing with lead time.
    left, right = [], []
    for k in range(0, len(future) - 1, 3):
        f, nxt = future[k], future[min(k + 1, len(future) - 1)]
        b = _bearing(f, nxt)
        r = cone_radius_km(k)
        left.append(list(reversed(_offset(f.lat, f.lon, b - 90, r))))
        right.append(list(reversed(_offset(f.lat, f.lon, b + 90, r))))
        if f.time >= track[li].time + timedelta(hours=9):
            break
    cone = right + list(reversed(left)) + [right[0]] if right else []

    points_by_lead = [
        {"lead_h": lead, "lon": track[i0 + lead].lon, "lat": track[i0 + lead].lat,
         "time": track[i0 + lead].time.isoformat()}
        for lead in (24, 48, 72) if i0 + lead < len(track) and i0 + lead <= li
    ]
    return {
        "t_rel": round(t_rel),
        "time": now.time.isoformat(),
        "landfall_time": track[li].time.isoformat(),
        "landfall_point": [track[li].lon, track[li].lat],
        "center": [now.lon, now.lat],
        "wind_kmh": round(now.wind_ms * 3.6),
        "pressure_hpa": round(now.pres),
        "landfall_wind_kmh": round(track[li - 1].wind_ms * 3.6),
        "category": imd_category(now.wind_ms / KT),
        "landfall_category": imd_category(track[li - 1].wind_ms / KT),
        "track_spread_km": round(cone_radius_km(max(li - i0, 0))),
        "observed": observed,
        "forecast": forecast,
        "forecast_points": points_by_lead,
        "cone": cone,
        "source": raw_track()["source"],
    }


def imd_category(wind_kt: float) -> str:
    for limit, name in ((120, "Super cyclonic storm"), (90, "Extremely severe cyclonic storm"),
                        (64, "Very severe cyclonic storm"), (48, "Severe cyclonic storm"),
                        (34, "Cyclonic storm"), (28, "Deep depression")):
        if wind_kt >= limit:
            return name
    return "Depression"


def holland_fields(f: Fix, lats: np.ndarray, lons: np.ndarray, motion: tuple[float, float] = (0.0, 0.0)):
    """Holland (1980) pressure (hPa) and surface wind vector (m/s east, north) at points."""
    dx = (lons - f.lon) * 111.2 * np.cos(np.radians(f.lat))
    dy = (lats - f.lat) * 111.2
    r = np.maximum(np.hypot(dx, dy), 1.0)  # km
    dp = max(P_ENV - f.pres, 1.0) * 100  # Pa
    rho = 1.15
    b = float(np.clip(rho * math.e * f.wind_ms ** 2 / dp, 1.0, 2.5))
    x = (f.rmax_km / r) ** b
    pres = f.pres + (P_ENV - f.pres) * np.exp(-x)
    fcor = 2 * 7.292e-5 * math.sin(math.radians(abs(f.lat)))
    rm = r * 1000
    v = np.sqrt(b / rho * x * dp * np.exp(-x) + (rm * fcor / 2) ** 2) - rm * fcor / 2
    v *= 0.9  # gradient -> surface
    # Counter-clockwise flow with a 20 degree inflow angle, plus part of the storm's motion.
    tx, ty = -dy / r, dx / r
    ang = math.radians(20)
    ux = v * (math.cos(ang) * tx - math.sin(ang) * dx / r) + 0.5 * motion[0]
    uy = v * (math.cos(ang) * ty - math.sin(ang) * dy / r) + 0.5 * motion[1]
    return pres, ux, uy


def motion_ms(a: Fix, b: Fix) -> tuple[float, float]:
    dt = max((b.time - a.time).total_seconds(), 1)
    return ((b.lon - a.lon) * 111200 * math.cos(math.radians(a.lat)) / dt, (b.lat - a.lat) * 111200 / dt)
