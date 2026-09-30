"""Live monitoring of the Bay of Bengal: wind, satellites, storms, and a plain-language outlook.

Sources (all public, no key):
  - Open-Meteo: GFS wind, gusts and sea-level pressure on a 1.5 degree grid, 72 h ahead;
    point forecasts for a person's location; marine API for sea temperature and waves.
  - NASA GIBS: Himawari-9 infrared every 10 min, IMERG rain rate every 30 min, SSMI ocean wind
    speed, VIIRS true colour.
  - GDACS: active and recent tropical cyclones with tracks and wind-impact zones.

Everything here is guidance to help people understand what is coming. Official warnings come
from IMD and the State Disaster Management Authority, and the app says so.
"""

from __future__ import annotations

import logging
import math
import pickle
import re
import threading
import time
from datetime import datetime, timedelta, timezone

import httpx
import numpy as np

# The Bay of Bengal on the same 1.5 degree grid the detector was tuned and tested on (pipeline/tune_genesis.py).
REGION = {"lat0": 4.5, "lat1": 24.0, "lon0": 80.5, "lon1": 98.5, "step": 1.5}
# Refresh when the models actually update (GFS every 6 h, ECMWF open data every 6-12 h), which also keeps
# the free Open-Meteo quota comfortably intact.
TTL = {"wind": 3 * 3600, "ecmwf": 6 * 3600, "sst": 6 * 3600, "gibs": 600, "storms": 900, "point": 3600}
OPEN_METEO = "https://api.open-meteo.com/v1/forecast"
MARINE = "https://marine-api.open-meteo.com/v1/marine"
GDACS_LIST = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH"
GIBS_CAPS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml"
GIBS_TILE = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{layer}/default/{time}/{tms}/{{z}}/{{y}}/{{x}}.{ext}"

SATELLITE_LAYERS = {
    "infrared": {"layer": "Himawari_AHI_Band13_Clean_Infrared", "label": "Clouds (Himawari infrared)",
                 "note": "Every 10 min. Bright, cold cloud tops mark deep storms.", "ext": "png"},
    "rain": {"layer": "IMERG_Precipitation_Rate_30min", "label": "Rain rate (GPM IMERG)",
             "note": "Every 30 min, about 4 h behind real time.", "ext": "png"},
    "ocean_wind": {"layer": "SSMI_DMSP_F17_Wind_Speed_Over_Oceans_Ascending", "label": "Ocean wind (SSMI satellite)",
                   "note": "Measured by satellite microwave radiometer, daily.", "ext": "png"},
    "true_color": {"layer": "VIIRS_NOAA20_CorrectedReflectance_TrueColor", "label": "True colour (VIIRS)",
                   "note": "Daily daytime image.", "ext": "jpg"},
}

client = httpx.Client(timeout=60, follow_redirects=True, headers={"User-Agent": "pralay-kavach-prototype"})
_cache: dict[str, tuple[float, object]] = {}
_lock = threading.Lock()
STALE: dict[str, float] = {}  # key -> age in seconds of the copy being served after a failed refresh
log = logging.getLogger("live")


def _disk(key: str):
    from .geo import DATA
    d = DATA / "live_cache"
    d.mkdir(exist_ok=True)
    return d / (re.sub(r"[^a-zA-Z0-9_.-]", "_", key) + ".pkl")


def _cached(key: str, ttl: float, fn):
    """Memory + disk cache. If a refresh fails (rate limit, outage), keep serving the last good copy."""
    with _lock:
        hit = _cache.get(key)
    if hit is None and _disk(key).exists():
        try:
            hit = pickle.loads(_disk(key).read_bytes())
            with _lock:
                _cache[key] = hit
        except Exception:
            hit = None
    if hit and time.time() - hit[0] < ttl:
        STALE.pop(key, None)
        return hit[1]
    try:
        value = fn()
    except Exception as exc:
        if hit:
            log.warning("refresh of %s failed (%s); serving copy from %.0f min ago", key, exc, (time.time() - hit[0]) / 60)
            STALE[key] = time.time() - hit[0]
            return hit[1]
        raise
    entry = (time.time(), value)
    with _lock:
        _cache[key] = entry
    try:
        _disk(key).write_bytes(pickle.dumps(entry))
    except OSError:
        pass
    STALE.pop(key, None)
    return value


def _grid_points():
    r = REGION
    lats = np.arange(r["lat0"], r["lat1"] + 1e-6, r["step"])
    lons = np.arange(r["lon0"], r["lon1"] + 1e-6, r["step"])
    return lats, lons


# ---------------------------------------------------------------- wind field

def _fetch_wind() -> dict:
    lats, lons = _grid_points()
    la = [f"{a:.2f}" for a in lats for _ in lons]
    lo = [f"{o:.2f}" for _ in lats for o in lons]
    resp = client.get(OPEN_METEO, params={
        "latitude": ",".join(la), "longitude": ",".join(lo), "models": "gfs_seamless",
        "hourly": "wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl",
        "forecast_days": 4, "wind_speed_unit": "kmh", "timezone": "UTC"})
    resp.raise_for_status()
    series = resp.json()
    times = series[0]["hourly"]["time"]
    nt, ny, nx = len(times), len(lats), len(lons)

    def stack(key):
        a = np.array([[v if v is not None else np.nan for v in s["hourly"][key]] for s in series], dtype=np.float32)
        return a.T.reshape(nt, ny, nx)

    speed, direction = stack("wind_speed_10m"), stack("wind_direction_10m")
    gust, pres = stack("wind_gusts_10m"), stack("pressure_msl")

    # Meteorological direction is where wind comes FROM; u/v point where it goes (km/h).
    rad = np.radians(direction)
    u, v = -speed * np.sin(rad), -speed * np.cos(rad)
    return {"times": times, "lats": lats.tolist(), "lons": lons.tolist(),
            "u": u, "v": v, "speed": speed, "gust": gust, "pressure": pres,
            "fetched": datetime.now(timezone.utc).isoformat(), "model": "GFS via Open-Meteo"}


def wind() -> dict:
    """The cached forecast, starting from the current hour (it may have been fetched hours ago)."""
    w = _cached("wind", TTL["wind"], _fetch_wind)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:00")
    k = max(0, next((i for i, t in enumerate(w["times"]) if t >= now), 0))
    return {**w, "times": w["times"][k:], **{f: w[f][k:] for f in ("u", "v", "speed", "gust", "pressure")},
            "stale_min": round(STALE.get("wind", 0) / 60)}


def wind_payload(step_h: int = 3) -> dict:
    """Compact wind field for the browser: every `step_h` hours, rounded."""
    w = wind()
    idx = list(range(0, min(len(w["times"]), 73), step_h))
    r1 = lambda a: np.nan_to_num(np.round(a, 1)).tolist()
    return {"times": [w["times"][i] for i in idx], "lats": w["lats"], "lons": w["lons"],
            "u": [r1(w["u"][i]) for i in idx], "v": [r1(w["v"][i]) for i in idx],
            "pressure": [r1(w["pressure"][i]) for i in idx], "fetched": w["fetched"], "model": w["model"]}


# ---------------------------------------------------------------- sea temperature

def _fetch_sst() -> dict:
    pts = [(la, lo) for la in (8, 12, 16, 19) for lo in (84, 87, 90, 93)]
    resp = client.get(MARINE, params={"latitude": ",".join(str(a) for a, _ in pts),
                                      "longitude": ",".join(str(o) for _, o in pts),
                                      "current": "sea_surface_temperature"})
    resp.raise_for_status()
    vals = [s["current"]["sea_surface_temperature"] for s in resp.json() if s["current"].get("sea_surface_temperature") is not None]
    mean = float(np.mean(vals)) if vals else None
    return {"mean_c": round(mean, 1) if mean else None, "max_c": round(max(vals), 1) if vals else None,
            "fuel": None if mean is None else "high" if mean >= 28.5 else "enough" if mean >= 26.5 else "low",
            "note": "Cyclones need sea water warmer than about 26.5 °C."}


def sst() -> dict:
    return _cached("sst", TTL["sst"], _fetch_sst)


# ---------------------------------------------------------------- satellites

def _fetch_satellite_times() -> dict:
    caps = client.get(GIBS_CAPS).text
    out = {}
    for key, cfg in SATELLITE_LAYERS.items():
        m = re.search(r"<ows:Identifier>" + re.escape(cfg["layer"]) + r"</ows:Identifier>(.*?)</Layer>", caps, re.S)
        if not m:
            continue
        block = m.group(1)
        latest = re.search(r"<Default>(.*?)</Default>", block).group(1)
        tms = re.search(r"<TileMatrixSet>(.*?)</TileMatrixSet>", block).group(1)
        maxzoom = int(re.search(r"Level(\d+)", tms).group(1))
        out[key] = {**cfg, "time": latest, "maxzoom": maxzoom,
                    "tiles": GIBS_TILE.format(layer=cfg["layer"], time=latest, tms=tms, ext=cfg["ext"])}
    return out


def satellites() -> dict:
    return _cached("gibs", TTL["gibs"], _fetch_satellite_times)


# ---------------------------------------------------------------- storms

def _in_basin(lon: float, lat: float) -> bool:
    return 40 <= lon <= 100 and -5 <= lat <= 32


def _fetch_storms() -> dict:
    now = datetime.now(timezone.utc)
    resp = client.get(GDACS_LIST, params={"eventlist": "TC", "fromDate": (now - timedelta(days=21)).date().isoformat(),
                                          "toDate": now.date().isoformat()})
    resp.raise_for_status()
    active, recent = [], []
    for f in resp.json().get("features", []):
        p = f["properties"]
        lon, lat = f["geometry"]["coordinates"][:2]
        if not _in_basin(lon, lat):
            continue
        sev = p.get("severitydata") or {}
        item = {
            "id": p.get("eventid"), "name": p.get("name", "").replace("Tropical Cyclone ", ""),
            "alert": p.get("alertlevel"), "from": p.get("fromdate"), "to": p.get("todate"),
            "current": bool(p.get("iscurrent")) and str(p.get("iscurrent")).lower() != "false",
            "lon": lon, "lat": lat, "severity": sev.get("severitytext"), "max_wind_kmh": sev.get("severity"),
            "countries": p.get("country"), "report": (p.get("url") or {}).get("report"),
            "geometry_url": (p.get("url") or {}).get("geometry"),
        }
        (active if item["current"] else recent).append(item)
    for s in active + recent[:2]:
        s["geometry"] = _storm_geometry(s["geometry_url"])
    return {"active": active, "recent": recent, "source": "GDACS (EU JRC / UN OCHA)", "checked": now.isoformat()}


def _storm_geometry(url: str | None) -> dict | None:
    if not url:
        return None
    try:
        d = client.get(url).json()
    except (httpx.HTTPError, ValueError):
        return None
    keep = [f for f in d.get("features", [])
            if str(f["properties"].get("Class", "")).startswith(("Line_", "Poly_Red", "Poly_Orange", "Poly_Green", "Poly_Cones"))]
    return {"type": "FeatureCollection", "features": keep}


def storms() -> dict:
    return _cached("storms", TTL["storms"], _fetch_storms)


# ---------------------------------------------------------------- forming storms

GENESIS_MAX_PRESSURE = 1004.0  # hPa
GENESIS_MIN_WIND = 50.0  # km/h within ~300 km
# Filters chosen by pipeline/tune_genesis.py on 2024 storms and scored on 2025-26 (held out):
AGREE_MAX_PRESSURE = 1006.0  # ECMWF must show its own closed low (<= this) within 300 km at the same time
AGREE_MIN_WIND = 40.0
MIN_DURATION_H = 12  # and the GFS low must persist at least this long


def detect_lows(pres: np.ndarray, speed: np.ndarray, lats, lons, times, step: int = 3,
                max_p: float = GENESIS_MAX_PRESSURE, min_w: float = GENESIS_MIN_WIND) -> list[dict]:
    """Closed lows over the sea: a pressure minimum below GENESIS_MAX_PRESSURE, lower than its eight
    neighbours, with winds of at least GENESIS_MIN_WIND within two grid cells (~300 km).
    `pres`, `speed` are [time, lat, lon]. Shared by the live watch and the backtest."""
    lats, lons = np.asarray(lats), np.asarray(lons)
    hits = []
    for t in range(0, pres.shape[0], step):
        p = pres[t]
        for i in range(1, p.shape[0] - 1):
            for j in range(1, p.shape[1] - 1):
                c = p[i, j]
                if not np.isfinite(c) or c > max_p:
                    continue
                if c > np.nanmin(p[i - 1:i + 2, j - 1:j + 2]):
                    continue
                vmax = float(np.nanmax(speed[t, max(i - 2, 0):i + 3, max(j - 2, 0):j + 3]))
                if vmax < min_w or not _is_sea(lats[i], lons[j]):
                    continue
                hits.append({"t": t, "time": times[t], "lat": float(lats[i]), "lon": float(lons[j]),
                             "pressure_hpa": round(float(c), 1), "max_wind_kmh": round(vmax)})
    return hits


def group_systems(hits: list[dict], km: float = 400) -> list[dict]:
    systems: list[dict] = []
    for h in sorted(hits, key=lambda x: x["t"]):
        for s in systems:
            if _km(s["last"]["lat"], s["last"]["lon"], h["lat"], h["lon"]) < km and h["t"] - s["last"]["t"] <= 24:
                s["points"].append(h)
                s["last"] = h
                break
        else:
            systems.append({"points": [h], "last": h})
    return systems


def _fetch_ecmwf() -> dict:
    lats, lons = _grid_points()
    la = [f"{a:.2f}" for a in lats for _ in lons]
    lo = [f"{o:.2f}" for _ in lats for o in lons]
    resp = client.get(OPEN_METEO, params={
        "latitude": ",".join(la), "longitude": ",".join(lo), "models": "ecmwf_ifs025",
        "hourly": "wind_speed_10m,pressure_msl", "forecast_days": 4, "wind_speed_unit": "kmh", "timezone": "UTC"})
    resp.raise_for_status()
    series = resp.json()
    times = series[0]["hourly"]["time"]
    nt, ny, nx = len(times), len(lats), len(lons)

    def stack(key):
        a = np.array([[v if v is not None else np.nan for v in s_["hourly"][key]] for s_ in series], dtype=np.float32)
        return a.T.reshape(nt, ny, nx)

    return {"times": times, "pressure": stack("pressure_msl"), "speed": stack("wind_speed_10m")}


def ecmwf() -> dict:
    return _cached("ecmwf", TTL["ecmwf"], _fetch_ecmwf)


def genesis_watch() -> list[dict]:
    """Forming-storm watch on the live forecasts (model guidance, not an official outlook).

    A GFS closed low (<= 1004 hPa, 50+ km/h winds within ~300 km, over the sea) that ECMWF also shows
    at the same time within 300 km, and that persists for at least 12 hours.
    """
    w = wind()
    n = min(w["pressure"].shape[0], 73)
    gfs = detect_lows(w["pressure"][:n], w["speed"][:n], w["lats"], w["lons"], w["times"])
    try:
        e = ecmwf()
        idx = {t: i for i, t in enumerate(e["times"])}
        rows = [idx.get(t) for t in w["times"][:n]]
        if None in rows:
            return []
        ecm = detect_lows(e["pressure"][rows], e["speed"][rows], w["lats"], w["lons"], w["times"][:n],
                          max_p=AGREE_MAX_PRESSURE, min_w=AGREE_MIN_WIND)
    except (httpx.HTTPError, ValueError, KeyError):
        return []  # without the second model we do not raise a watch
    agreed = [h for h in gfs if any(x["t"] == h["t"] and _km(x["lat"], x["lon"], h["lat"], h["lon"]) <= 300 for x in ecm)]
    lasting = [h for h in agreed
               if 3 * sum(1 for x in agreed if abs(x["t"] - h["t"]) <= 24
                          and _km(x["lat"], x["lon"], h["lat"], h["lon"]) <= 350) >= MIN_DURATION_H]
    out = []
    for s_ in group_systems(lasting):
        pts = s_["points"]
        peak = min(pts, key=lambda x: x["pressure_hpa"])
        out.append({"first_seen": pts[0]["time"], "lat": peak["lat"], "lon": peak["lon"],
                    "min_pressure_hpa": peak["pressure_hpa"], "max_wind_kmh": max(x["max_wind_kmh"] for x in pts),
                    "path": [[x["lon"], x["lat"]] for x in pts], "hours_seen": len(pts) * 3,
                    "models": "GFS + ECMWF"})
    return sorted(out, key=lambda s_: s_["min_pressure_hpa"])


def _is_sea(lat: float, lon: float) -> bool:
    """Coarse Bay of Bengal / Arabian Sea / Andaman Sea test for the 1.5 degree grid."""
    if lat < 5:
        return True
    if lon >= 80.5 and lon <= 92 and lat <= 21.5:
        # Bay of Bengal, excluding the Indian east coast (roughly lon > 80 + (lat-10)*0.55 for lat 10-21)
        coast = 79.8 + max(0.0, (lat - 10) * 0.62)
        return lon > coast + 0.8
    if 92 < lon <= 98 and lat <= 16:
        return True  # Andaman Sea
    if lon <= 76.5 and lat <= 20:
        return True  # Arabian Sea edge of the window
    return False


def _km(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(a))


# ---------------------------------------------------------------- overview

def overview() -> dict:
    w = wind()
    sea = np.array([[_is_sea(a, o) for o in w["lons"]] for a in w["lats"]])
    now_speed = w["speed"][0]
    peak = float(np.nanmax(np.where(sea[None], w["gust"], np.nan)))
    return {
        "model_time": w["times"][0], "fetched": w["fetched"], "model": w["model"],
        "max_sea_wind_now_kmh": round(float(np.nanmax(np.where(sea, now_speed, np.nan)))),
        "max_sea_gust_72h_kmh": round(peak),
        "min_pressure_72h_hpa": round(float(np.nanmin(np.where(sea[None], w["pressure"], np.nan))), 1),
        "sst": _safe(sst), "storms": _safe(storms), "genesis": genesis_watch(),
        "satellites": _safe(satellites),
        "stale": {k: round(v / 60) for k, v in STALE.items() if not k.startswith("pt:")},
        "official": {"text": "Official warnings: IMD (mausam.imd.gov.in) and Odisha SDMA. This is guidance, not a warning.",
                     "imd": "https://mausam.imd.gov.in/", "osdma": "https://www.osdma.org/"},
    }


def _safe(fn):
    try:
        return fn()
    except Exception as exc:  # a feed being down should not take the page down
        return {"error": str(exc)[:160]}


# ---------------------------------------------------------------- personal outlook

def outlook(lat: float, lon: float) -> dict:
    def fetch():
        r = client.get(OPEN_METEO, params={
            "latitude": lat, "longitude": lon, "timezone": "Asia/Kolkata", "forecast_days": 3, "wind_speed_unit": "kmh",
            "current": "wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation,pressure_msl,temperature_2m",
            "hourly": "wind_speed_10m,wind_gusts_10m,precipitation,pressure_msl"})
        r.raise_for_status()
        return r.json()

    d = _cached(f"pt:{lat:.2f},{lon:.2f}", TTL["point"], fetch)
    h = d["hourly"]
    gusts = [g or 0 for g in h["wind_gusts_10m"]]
    rain = [p or 0 for p in h["precipitation"]]
    rain24 = max(sum(rain[i:i + 24]) for i in range(0, max(len(rain) - 23, 1)))
    peak_i = int(np.argmax(gusts))
    st = storms() if not isinstance(_safe(storms), dict) or "error" not in _safe(storms) else {"active": []}
    nearest = None
    for s in st.get("active", []):
        dist = _km(lat, lon, s["lat"], s["lon"])
        if nearest is None or dist < nearest["distance_km"]:
            nearest = {"name": s["name"], "distance_km": round(dist), "severity": s["severity"], "alert": s["alert"]}
    watch = [g for g in genesis_watch() if _km(lat, lon, g["lat"], g["lon"]) < 900]

    level, reasons = "clear", []
    if max(gusts) >= 90 or (nearest and nearest["distance_km"] < 300):
        level = "danger"
    elif max(gusts) >= 60 or rain24 >= 100 or (nearest and nearest["distance_km"] < 1000) or watch:
        level = "watch"
    if nearest:
        reasons.append(f"{nearest['name']} is {nearest['distance_km']} km away ({nearest['severity']}).")
    if watch:
        g = watch[0]
        reasons.append(f"Forecast models show a low forming over the sea about {round(_km(lat, lon, g['lat'], g['lon']))} km away "
                       f"(lowest pressure {g['min_pressure_hpa']} hPa).")
    reasons.append(f"Strongest gusts in the next 3 days: {round(max(gusts))} km/h around {_hhmm(h['time'][peak_i])}.")
    reasons.append(f"Most rain in any 24 hours: {round(rain24)} mm.")
    headline = {"clear": "No storm threat in the next 3 days",
                "watch": "Keep watch: rough weather possible",
                "danger": "Dangerous winds expected: follow official orders"}[level]
    step = 3
    return {
        "level": level, "headline": headline, "reasons": reasons,
        "now": {"wind_kmh": d["current"]["wind_speed_10m"], "gust_kmh": d["current"]["wind_gusts_10m"],
                "direction_deg": d["current"]["wind_direction_10m"], "rain_mm": d["current"]["precipitation"],
                "pressure_hpa": d["current"]["pressure_msl"], "temp_c": d["current"]["temperature_2m"]},
        "hourly": {"time": h["time"][::step], "gust_kmh": gusts[::step],
                   "rain_mm": [round(sum(rain[i:i + step]), 1) for i in range(0, len(rain), step)]},
        "nearest_storm": nearest, "forming": watch[:1],
        "official": "Official warnings come from IMD and the State Disaster Management Authority.",
    }


def _hhmm(t: str) -> str:
    dt = datetime.fromisoformat(t)
    return dt.strftime("%a %H:%M")
