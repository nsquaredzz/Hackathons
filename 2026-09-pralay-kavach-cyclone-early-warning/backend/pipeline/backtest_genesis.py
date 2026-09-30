"""Backtest the live forming-storm detector on real Bay of Bengal storms since 2024.

For each storm and each lead time L = 1..7 days, take the GFS forecast *issued L days earlier*
(Open-Meteo previous-runs archive) on the same 1.5 degree grid as the live monitor, and run the
exact detector the Live screen uses (thresholds set before this test). A detection counts only if
it lies within 300 km of where the storm really was at that time (IBTrACS best track).

Also counts false alarms: systems the detector flags in forecasts issued 3 days ahead over the
Oct-Dec seasons that match no IBTrACS system at all (named storms or depressions).

Run: python -m pipeline.backtest_genesis    ->  data/genesis_backtest.json
"""

from __future__ import annotations

import csv
import io
import json
import time
from datetime import datetime, timedelta, timezone

import httpx
import numpy as np

from app import live
from app.geo import DATA
from pipeline.fetch_open_data import IBTRACS_URL

ARCHIVE = "https://previous-runs-api.open-meteo.com/v1/forecast"
STORMS = ["REMAL", "DANA", "FENGAL", "MONTHA", "DITWAH", "UNNAMED-2026-09-22"]
LEADS = range(1, 8)
MATCH_KM = 300
client = httpx.Client(timeout=300)


def ibtracs_systems() -> dict[str, list[dict]]:
    cache = DATA / "ibtracs_ni_recent.json"
    if cache.exists():
        return json.loads(cache.read_text())
    text = client.get(IBTRACS_URL).text
    out: dict[str, list[dict]] = {}
    for r in csv.DictReader(io.StringIO(text)):
        if r["BASIN"] != "NI" or r["SEASON"] < "2024":
            continue
        key = r["NAME"] if r["NAME"] != "UNNAMED" else f"UNNAMED-{r['ISO_TIME'][:10]}-{r['SID']}"
        key = next((k for k in out if k.endswith(r["SID"]) or k == r["NAME"]), key) if r["NAME"] == "UNNAMED" else key
        out.setdefault(key, []).append({"time": r["ISO_TIME"].replace(" ", "T"), "lat": float(r["LAT"]),
                                        "lon": float(r["LON"]), "land": r["DIST2LAND"].strip() == "0"})
    cache.write_text(json.dumps(out))
    return out


def fetch(start: str, end: str, leads) -> tuple[list[str], dict[int, tuple[np.ndarray, np.ndarray]]]:
    lats, lons = live._grid_points()
    la = [f"{a:.2f}" for a in lats for _ in lons]
    lo = [f"{o:.2f}" for _ in lats for o in lons]
    vars_ = [f"{v}_previous_day{L}" for L in leads for v in ("pressure_msl", "wind_speed_10m")]
    params = {"latitude": ",".join(la), "longitude": ",".join(lo), "models": "gfs_seamless",
              "hourly": ",".join(vars_), "start_date": start, "end_date": end, "wind_speed_unit": "kmh", "timezone": "UTC"}
    for attempt in range(8):
        r = client.get(ARCHIVE, params=params)
        if r.status_code != 429:
            break
        wait = 30 * (attempt + 1)
        print(f"  rate limited, waiting {wait}s")
        time.sleep(wait)
    r.raise_for_status()
    series = r.json()
    times = series[0]["hourly"]["time"]
    nt, ny, nx = len(times), len(lats), len(lons)

    def stack(key):
        a = np.array([[v if v is not None else np.nan for v in s["hourly"][key]] for s in series], dtype=np.float32)
        return a.T.reshape(nt, ny, nx)

    return times, {L: (stack(f"pressure_msl_previous_day{L}"), stack(f"wind_speed_10m_previous_day{L}")) for L in leads}


def track_position(track: list[dict], t: str) -> tuple[float, float] | None:
    ts = [datetime.fromisoformat(p["time"]).timestamp() for p in track]
    x = datetime.fromisoformat(t).timestamp()
    if x < ts[0] - 3 * 3600 or x > ts[-1] + 3 * 3600:
        return None
    return float(np.interp(x, ts, [p["lat"] for p in track])), float(np.interp(x, ts, [p["lon"] for p in track]))


def storm_key(systems, name):
    if name in systems:
        return name
    return next((k for k in systems if k.startswith(name)), None)


def backtest_storm(systems, name) -> dict | None:
    key = storm_key(systems, name)
    if not key:
        return None
    track = systems[key]
    first = datetime.fromisoformat(track[0]["time"])
    land = next((p for p in track if p["land"]), None)
    landfall = datetime.fromisoformat(land["time"]) if land else datetime.fromisoformat(track[-1]["time"])
    lats, lons = live._grid_points()
    times, fields = fetch((first - timedelta(days=1)).date().isoformat(), (landfall + timedelta(hours=12)).date().isoformat(), LEADS)
    by_lead, earliest = {}, None
    for L, (pres, speed) in fields.items():
        hits = live.detect_lows(pres, speed, lats, lons, times)
        matched = []
        for h in hits:
            pos = track_position(track, h["time"])
            if pos and live._km(pos[0], pos[1], h["lat"], h["lon"]) <= MATCH_KM:
                matched.append(h)
        by_lead[L] = len(matched)
        for h in matched:
            issued = datetime.fromisoformat(h["time"]) - timedelta(days=L)
            if earliest is None or issued < earliest[0]:
                earliest = (issued, L, h)
    out = {"storm": name.split("-")[0].title() if not name.startswith("UNNAMED") else "ONE-26 (Sep 2026)",
           "first_tracked": track[0]["time"], "landfall": landfall.isoformat() if land else None,
           "landfall_point": [land["lon"], land["lat"]] if land else None,
           "detected_at_lead_days": {str(k): v > 0 for k, v in by_lead.items()}}
    if earliest:
        issued, L, h = earliest
        out.update({"spotted": True, "earliest_forecast_issued": issued.isoformat(), "lead_days_used": L,
                    "days_before_landfall": round((landfall - issued).total_seconds() / 86400, 1),
                    "days_before_first_tracked": round((first - issued).total_seconds() / 86400, 1),
                    "detection": h})
    else:
        out["spotted"] = False
    return out


def false_alarms(systems, season_start: str, season_end: str, lead: int = 3) -> dict:
    lats, lons = live._grid_points()
    alarms, total = [], 0
    start = datetime.fromisoformat(season_start)
    end = datetime.fromisoformat(season_end)
    while start < end:
        chunk_end = min(start + timedelta(days=30), end)
        times, fields = fetch(start.date().isoformat(), chunk_end.date().isoformat(), [lead])
        pres, speed = fields[lead]
        for s in live.group_systems(live.detect_lows(pres, speed, lats, lons, times, step=6)):
            total += 1
            real = False
            for h in s["points"]:
                for track in systems.values():
                    pos = track_position(track, h["time"])
                    if pos and live._km(pos[0], pos[1], h["lat"], h["lon"]) <= 500:
                        real = True
                        break
                if real:
                    break
            if not real:
                alarms.append({"time": s["points"][0]["time"], "lat": s["points"][0]["lat"], "lon": s["points"][0]["lon"],
                               "min_pressure_hpa": min(p["pressure_hpa"] for p in s["points"])})
        start = chunk_end + timedelta(days=1)
    return {"window": f"{season_start} to {season_end}", "lead_days": lead, "flagged": total, "false_alarms": len(alarms),
            "details": alarms}


def main():
    systems = ibtracs_systems()
    print("systems since 2024:", len(systems))
    partial = DATA / "genesis_backtest_storms.json"
    cached = json.loads(partial.read_text()) if partial.exists() else {}
    results = []
    for name in STORMS:
        if name in cached:
            results.append(cached[name])
            continue
        r = backtest_storm(systems, name)
        if r:
            results.append(r)
            cached[name] = r
            partial.write_text(json.dumps(cached))
            print(f"{r['storm']:18s} spotted={r['spotted']}  "
                  + (f"{r['days_before_landfall']} days before landfall, {r['days_before_first_tracked']} days before first tracked"
                     if r["spotted"] else ""))
    fa = [false_alarms(systems, "2024-10-01", "2024-12-31"), false_alarms(systems, "2025-10-01", "2025-12-31")]
    for f in fa:
        print(f"false alarms {f['window']}: {f['false_alarms']} of {f['flagged']} flagged systems")
    out = {"method": __doc__.strip().split("\n\n")[1].replace("\n", " "),
           "thresholds": {"pressure_hpa_max": live.GENESIS_MAX_PRESSURE, "wind_kmh_min": live.GENESIS_MIN_WIND,
                          "match_km": MATCH_KM},
           "storms": results, "false_alarm_checks": fa, "run": datetime.now(timezone.utc).isoformat()}
    (DATA / "genesis_backtest.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
