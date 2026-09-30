"""Reduce the forming-storm detector's false alarms, with an honest train/test split.

Data: GFS and ECMWF forecasts *as issued* 1-5 days ahead (Open-Meteo previous-runs archive) on the
live monitor's 1.5 degree grid, cropped to the Bay of Bengal. Truth: IBTrACS (all depressions and storms).

Candidate filters (standard forecaster checks):
  consistency  today's run and yesterday's run both show the low at the same time and place
  compactness  centre at least D hPa below the mean pressure ~500 km out (rejects broad monsoon troughs)
  duration     the low persists for at least H hours in the forecasts
  agreement    ECMWF also shows a closed low within 300 km
  wind         winds of at least W km/h within ~300 km

Rules are chosen on 2024 only (Remal, Dana, Fengal + every low flagged that year) and then scored on
2025-26 (Montha, Ditwah, ONE-26 + that year's flags), which the choice never saw.

A flag counts as real if it matches any IBTrACS system: on its track (500 km), or up to 48 h before and
within 500 km of where it was first tracked (the model saw it coming before it was declared).

Run: python -m pipeline.tune_genesis   ->  data/genesis_backtest.json (read by the Live screen)
"""

from __future__ import annotations

import itertools
import json
import time
from datetime import datetime, timedelta, timezone

import httpx
import numpy as np

from app import live
from app.geo import DATA
from pipeline.backtest_genesis import ibtracs_systems

ARCHIVE = "https://previous-runs-api.open-meteo.com/v1/forecast"
CACHE = DATA / "backtest_cache"
CACHE.mkdir(exist_ok=True)
LEADS = [1, 2, 3, 4, 5]
LATS = np.arange(4.5, 24.01, 1.5)
LONS = np.arange(80.5, 98.51, 1.5)
WINDOWS = {
    "train": [("2024-05-01", "2024-05-31"), ("2024-10-01", "2024-10-31"), ("2024-11-01", "2024-11-30"), ("2024-12-01", "2024-12-31")],
    "test": [("2025-05-01", "2025-05-31"), ("2025-10-01", "2025-10-31"), ("2025-11-01", "2025-11-30"), ("2025-12-01", "2025-12-31"),
             ("2026-09-10", "2026-09-30")],
}
NAMED = {"REMAL", "DANA", "FENGAL", "MONTHA", "DITWAH"}
client = httpx.Client(timeout=300)


def fetch(model: str, start: str, end: str) -> dict:
    f = CACHE / f"{model}_{start}_{end}.npz"
    if f.exists():
        d = np.load(f, allow_pickle=True)
        return {k: d[k] for k in d.files}
    la = [f"{a:.2f}" for a in LATS for _ in LONS]
    lo = [f"{o:.2f}" for _ in LATS for o in LONS]
    vars_ = [f"{v}_previous_day{L}" for L in LEADS for v in ("pressure_msl", "wind_speed_10m")]
    params = {"latitude": ",".join(la), "longitude": ",".join(lo), "models": model, "hourly": ",".join(vars_),
              "start_date": start, "end_date": end, "wind_speed_unit": "kmh", "timezone": "UTC"}
    for attempt in range(12):
        r = client.get(ARCHIVE, params=params)
        if r.status_code != 429:
            break
        wait = min(60 * (attempt + 1), 300)
        print(f"  rate limited ({model} {start}); waiting {wait}s", flush=True)
        time.sleep(wait)
    r.raise_for_status()
    series = r.json()
    times = np.array(series[0]["hourly"]["time"])
    nt, ny, nx = len(times), len(LATS), len(LONS)
    out = {"times": times}
    for L in LEADS:
        for v in ("pressure_msl", "wind_speed_10m"):
            a = np.array([[x if x is not None else np.nan for x in s["hourly"][f"{v}_previous_day{L}"]] for s in series],
                         dtype=np.float32)
            out[f"{v}_{L}"] = a.T.reshape(nt, ny, nx)
    np.savez_compressed(f, **out)
    return out


def candidate_hits(pres, speed, times, step=3) -> list[dict]:
    """Loose detection (1006 hPa, 40 km/h) with features, so rules can be applied afterwards."""
    hits = []
    for t in range(0, pres.shape[0], step):
        p = pres[t]
        for i in range(1, p.shape[0] - 1):
            for j in range(1, p.shape[1] - 1):
                c = p[i, j]
                if not np.isfinite(c) or c > 1006 or c > np.nanmin(p[i - 1:i + 2, j - 1:j + 2]):
                    continue
                if not live._is_sea(LATS[i], LONS[j]):
                    continue
                vmax = float(np.nanmax(speed[t, max(i - 2, 0):i + 3, max(j - 2, 0):j + 3]))
                if vmax < 40:
                    continue
                ring = np.concatenate([p[max(i - 3, 0), max(j - 3, 0):j + 4], p[min(i + 3, p.shape[0] - 1), max(j - 3, 0):j + 4],
                                       p[max(i - 3, 0):i + 4, max(j - 3, 0)], p[max(i - 3, 0):i + 4, min(j + 3, p.shape[1] - 1)]])
                hits.append({"t": t, "time": str(times[t]), "lat": float(LATS[i]), "lon": float(LONS[j]),
                             "p": float(c), "w": vmax, "deficit": float(np.nanmean(ring) - c)})
    return hits


def near(a, b, km=300):
    return live._km(a["lat"], a["lon"], b["lat"], b["lon"]) <= km


def load_window(start, end):
    g, e = fetch("gfs_seamless", start, end), fetch("ecmwf_ifs025", start, end)
    times = g["times"]
    gfs = {L: candidate_hits(g[f"pressure_msl_{L}"], g[f"wind_speed_10m_{L}"], times) for L in LEADS}
    ecm = {L: candidate_hits(e[f"pressure_msl_{L}"], e[f"wind_speed_10m_{L}"], times) for L in LEADS}
    return {"gfs": gfs, "ecm": ecm}


def apply_rule(data, rule) -> list[dict]:
    """Hits (with lead) that pass a rule. rule = (P, W, D, H, consistent, agree)."""
    P, W, D, H, consistent, agree = rule
    out = []
    for L in LEADS:
        base = [h for h in data["gfs"][L] if h["p"] <= P and h["w"] >= W and h["deficit"] >= D]
        if consistent:
            if L == LEADS[-1]:
                continue  # needs yesterday's run (L+1), not fetched for the longest lead
            prev = data["gfs"][L + 1]
            base = [h for h in base if any(x["t"] == h["t"] and x["p"] <= P + 2 and near(x, h) for x in prev)]
        if agree:
            base = [h for h in base if any(x["t"] == h["t"] and x["p"] <= P + 2 and near(x, h) for x in data["ecm"][L])]
        if H > 3:
            # persistence: the same place flagged in at least H/3 three-hourly steps within a day either side
            kept = []
            for h in base:
                n = sum(1 for x in base if abs(x["t"] - h["t"]) <= 24 and near(x, h, 350))
                if n * 3 >= H:
                    kept.append(h)
            base = kept
        out += [{**h, "lead": L} for h in base]
    return out


def track_pos(track, t: datetime):
    ts = [datetime.fromisoformat(p["time"]).timestamp() for p in track]
    x = t.timestamp()
    if x < ts[0] - 3 * 3600 or x > ts[-1] + 3 * 3600:
        return None
    return {"lat": float(np.interp(x, ts, [p["lat"] for p in track])), "lon": float(np.interp(x, ts, [p["lon"] for p in track]))}


def matches_real(h, systems) -> str | None:
    t = datetime.fromisoformat(h["time"])
    for name, track in systems.items():
        pos = track_pos(track, t)
        if pos and near(pos, h, 500):
            return name
        first = datetime.fromisoformat(track[0]["time"])
        if timedelta(0) <= first - t <= timedelta(hours=48) and near(track[0], h, 500):
            return name
    return None


def evaluate(split: str, rule, cache: dict, systems) -> dict:
    flags, storms = [], {}
    for start, end in WINDOWS[split]:
        hits = apply_rule(cache[(start, end)], rule)
        # Alert episodes: group by place and time.
        episodes = []
        for h in sorted(hits, key=lambda x: x["time"]):
            t = datetime.fromisoformat(h["time"])
            for ep in episodes:
                if near(ep["last"], h, 400) and t - datetime.fromisoformat(ep["last"]["time"]) <= timedelta(hours=36):
                    ep["hits"].append(h)
                    ep["last"] = h
                    break
            else:
                episodes.append({"hits": [h], "last": h})
        for ep in episodes:
            real = next((m for m in (matches_real(h, systems) for h in ep["hits"]) if m), None)
            flags.append({"real": real, "start": ep["hits"][0]["time"], "lat": ep["hits"][0]["lat"], "lon": ep["hits"][0]["lon"]})
        # Named storm detection: earliest issue time of a hit on the storm's own track.
        for name, track in systems.items():
            if name not in NAMED and not name.startswith("UNNAMED-2026-09-22"):
                continue
            t0 = datetime.fromisoformat(track[0]["time"])
            if not (datetime.fromisoformat(start) - timedelta(days=5) <= t0 <= datetime.fromisoformat(end)):
                continue
            land = next((p for p in track if p["land"]), track[-1])
            best = None
            for h in hits:
                pos = track_pos(track, datetime.fromisoformat(h["time"]))
                ok = (pos and near(pos, h, 300)) or (timedelta(0) <= t0 - datetime.fromisoformat(h["time"]) <= timedelta(hours=48) and near(track[0], h, 500))
                if ok:
                    issued = datetime.fromisoformat(h["time"]) - timedelta(days=h["lead"])
                    if best is None or issued < best:
                        best = issued
            label = "ONE-26 (Sep 2026)" if name.startswith("UNNAMED") else name.title()
            storms[label] = {"storm": label, "first_tracked": track[0]["time"], "landfall": land["time"], "spotted": best is not None,
                             **({"earliest_forecast_issued": best.isoformat(),
                                 "days_before_landfall": round((datetime.fromisoformat(land["time"]) - best).total_seconds() / 86400, 1),
                                 "days_before_first_tracked": round((t0 - best).total_seconds() / 86400, 1)} if best else {})}
    false = [f for f in flags if not f["real"]]
    return {"flags": len(flags), "false_alarms": len(false), "storms": list(storms.values()), "false_details": false}


def main():
    systems = ibtracs_systems()
    cache = {}
    for split, wins in WINDOWS.items():
        for w in wins:
            print(f"loading {w} ({split})", flush=True)
            cache[w] = load_window(*w)

    baseline = (1004, 50, 0, 3, False, False)  # the detector as first shipped
    grid = list(itertools.product([1004, 1002], [50, 55, 60], [0, 1, 2, 3], [3, 12, 24], [False, True], [False, True]))
    scored = []
    for rule in grid:
        tr = evaluate("train", rule, cache, systems)
        leads = [s.get("days_before_landfall", 0) for s in tr["storms"]]
        all_hit = all(s["spotted"] and s["days_before_landfall"] >= 3 for s in tr["storms"])
        scored.append((not all_hit, tr["false_alarms"], -float(np.median(leads) if leads else 0), rule, tr))
    scored.sort(key=lambda x: x[:3])
    best_rule, best_train = scored[0][3], scored[0][4]
    base_train = evaluate("train", baseline, cache, systems)
    base_test = evaluate("test", baseline, cache, systems)
    best_test = evaluate("test", best_rule, cache, systems)

    names = ("max_pressure_hpa", "min_wind_kmh", "min_deficit_hpa", "min_duration_h", "run_to_run_consistency", "ecmwf_agreement")
    rule_dict = dict(zip(names, best_rule))
    print("baseline  train", base_train["false_alarms"], "/", base_train["flags"], " test", base_test["false_alarms"], "/", base_test["flags"])
    print("chosen    ", rule_dict)
    print("chosen    train", best_train["false_alarms"], "/", best_train["flags"], " test", best_test["false_alarms"], "/", best_test["flags"])
    for s in best_train["storms"] + best_test["storms"]:
        print(f"  {s['storm']:18s} spotted={s['spotted']} {s.get('days_before_landfall', '')} d before landfall")

    def summary(ev):
        return {"flags": ev["flags"], "false_alarms": ev["false_alarms"], "storms": ev["storms"]}

    out = {
        "method": "Rules chosen on 2024 (train) and scored on 2025-26 (test), using GFS and ECMWF forecasts as issued "
                  "1-5 days ahead. A hit counts within 300 km of the real storm (IBTrACS); a flag is real if it matches "
                  "any IBTrACS depression or storm, including up to 48 h before it was first tracked.",
        "rule": rule_dict, "baseline_rule": dict(zip(names, baseline)),
        "train": {"chosen": summary(best_train), "baseline": summary(base_train)},
        "test": {"chosen": summary(best_test), "baseline": summary(base_test)},
        "run": datetime.now(timezone.utc).isoformat(),
    }
    (DATA / "genesis_tuning.json").write_text(json.dumps(out, indent=1))
    write_ui(out)


def write_ui(out: dict) -> None:
    """The file the Live screen reads (data/genesis_backtest.json)."""
    storms = [{**s, "split": "train"} for s in out["train"]["chosen"]["storms"]] + \
             [{**s, "split": "test"} for s in out["test"]["chosen"]["storms"]]
    ui = {
        "method": out["method"], "rule": out["rule"],
        "thresholds": {"pressure_hpa_max": out["rule"]["max_pressure_hpa"], "wind_kmh_min": out["rule"]["min_wind_kmh"],
                       "match_km": 300},
        "storms": storms,
        "false_alarm_checks": [
            {"window": "2024 (rules chosen here)", "flagged": out["train"]["chosen"]["flags"],
             "false_alarms": out["train"]["chosen"]["false_alarms"], "lead_days": 5},
            {"window": "2025-26 (held out)", "flagged": out["test"]["chosen"]["flags"],
             "false_alarms": out["test"]["chosen"]["false_alarms"], "lead_days": 5},
        ],
        "baseline": {k: {"flagged": out[k]["baseline"]["flags"], "false_alarms": out[k]["baseline"]["false_alarms"]}
                     for k in ("train", "test")},
        "run": out["run"],
    }
    (DATA / "genesis_backtest.json").write_text(json.dumps(ui, indent=1))


if __name__ == "__main__":
    main()
