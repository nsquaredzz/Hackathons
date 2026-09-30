"""The planning agent: reads the situation, runs the models, and drafts a ranked evacuation plan.

Each step is streamed to the UI as it happens, so the officer can see what the plan is based on.
"""

from __future__ import annotations

import json
import time
from datetime import timedelta, timezone
from pathlib import Path
from typing import Iterator

from . import exposure, llm, storm, surge
from .geo import DATA

IST = timezone(timedelta(hours=5, minutes=30))
STATE: dict = {"plan": None}


def ist(dt) -> str:
    return dt.astimezone(IST).strftime("%d %b, %H:%M IST")


def bulletin_text(t_rel: float) -> str:
    """An IMD-style bulletin written from the best-track fix at the replay time."""
    s = storm.storm_state(t_rel)
    f = storm.fix_at(t_rel)
    lf = storm.landfall_time()
    return (
        f"NATIONAL BULLETIN (replay, generated from {s['source']} best track)\n"
        f"Issued: {ist(f.time)}\n"
        f"The {s['category'].lower()} FANI over the west-central Bay of Bengal lay centred near "
        f"latitude {f.lat:.1f}N and longitude {f.lon:.1f}E. Estimated central pressure {s['pressure_hpa']} hPa, "
        f"maximum sustained winds {s['wind_kmh']} km/h.\n"
        f"It is very likely to move north-northeastwards and cross the Odisha coast near Puri "
        f"around {ist(lf)} as a {s['landfall_category'].lower()} with maximum sustained wind speed of "
        f"{s['landfall_wind_kmh']} km/h. Storm surge and very heavy rainfall are expected over coastal Odisha."
    )


SYSTEM = (
    "You are the planning assistant in a State Emergency Operations Centre in India during a cyclone. "
    "You are precise, conservative about uncertainty, and you never invent numbers: use only the figures given. "
    "Always answer with valid JSON matching the requested shape."
)


def _satellite() -> list[tuple[bytes, str]]:
    p = DATA / "satellite_2019-05-02.jpg"
    return [(p.read_bytes(), "image/jpeg")] if p.exists() else []


def assess_storm(t_rel: float) -> tuple[dict, dict]:
    s = storm.storm_state(t_rel)
    text = bulletin_text(t_rel)

    def fallback():
        return {
            "storm": "FANI", "category": s["category"], "center": s["center"],
            "landfall": {"place": "near Puri", "time_ist": ist(storm.landfall_time()),
                         "category": s["landfall_category"], "wind_kmh": s["landfall_wind_kmh"]},
            "satellite_read": "Not analysed (no model key). Add a Gemini key to read the satellite image.",
            "key_risks": ["storm surge on the Puri–Ganjam coast", "extreme winds near landfall", "very heavy rain"],
        }

    prompt = (
        "Read this cyclone bulletin and the attached satellite image (MODIS true colour, 2 May 2019, "
        "covering 80–92E, 13–25N). Return JSON: {storm, category, center:[lon,lat], landfall:{place,time_ist,"
        "category,wind_kmh}, satellite_read: one or two sentences on what the image shows about the storm's "
        "structure (eye, symmetry, extent), key_risks: [3 short strings]}.\n\nBULLETIN:\n" + text
    )
    return llm.ask_json(SYSTEM, prompt, fallback, images=_satellite())


def rank_plan(t_rel: float, risk: dict, scenarios: list[dict]) -> tuple[dict, dict]:
    top = risk["candidates"][:15]
    assets = [a for a in risk["assets_at_risk"] if a["kind"] in ("hospital", "substation")][:8]
    spread = max(x["max_level_m"] for x in scenarios) - min(x["max_level_m"] for x in scenarios)

    def fallback():
        ranked = []
        for i, c in enumerate(top[:10]):
            parts = []
            if "surge" in c["hazard"]:
                when = f", arriving around T{c['water_arrives_h']:+d}h" if c["water_arrives_h"] is not None else ""
                parts.append(f"storm surge up to {c['peak_depth_m']} m reaches {c['people_flooded']:,} people{when}")
            if "wind" in c["hazard"]:
                gales = f"; gales start around T{c['gales_from_h']:+d}h" if c["gales_from_h"] is not None else ""
                parts.append(f"winds peak near {c['peak_wind_kmh']} km/h {c['coast_km']} km from the coast, "
                             f"enough to bring down kutcha houses{gales}")
            why = (f"{c['people_at_risk']:,} people to move: " + "; ".join(parts)) if parts else ""
            if c["route"].startswith("floods"):
                why += f". The route to {c['shelter']['name'] if c['shelter'] else 'shelter'} {c['route'].replace('floods', 'floods at')}, so move early"
            ranked.append({"id": c["id"], "rank": i + 1, "reason": why + "."})
        harden = [{"id": a["id"], "action": ("Move critical patients away from windows, stage backup power and water"
                                             if a["kind"] == "hospital" else "Pre-position crews and plan a controlled shutdown")}
                  for a in assets]
        conf = "high" if spread < 0.4 else "medium" if spread < 1.0 else "low"
        return {
            "ranked": ranked, "harden": harden, "confidence": conf,
            "confidence_note": f"Peak water differs by {spread:.1f} m across the three track scenarios.",
            "summary": (f"About {risk['people_to_evacuate']:,} people should move: {risk['people_in_wind_zone']:,} in "
                        f"villages within {risk['thresholds']['wind_evac_coast_km']} km of the coast facing destructive "
                        f"winds, and {risk['people_in_flood_zone']:,} in the storm-surge zone. Start with the villages "
                        f"ranked below."),
        }

    prompt = (
        "Rank these evacuation candidates (most urgent first, up to 10) and give each a one- or two-sentence reason "
        "a district officer can act on. Each has a hazard: storm surge (peak_depth_m, people_flooded, water_arrives_h) "
        "and/or destructive wind near the coast (peak_wind_kmh, coast_km, gales_from_h); times are hours relative to "
        "landfall, negative = before. Weigh people at risk, how early the hazard arrives, and whether the route to the "
        "assigned shelter floods. Also write a two-sentence summary using the totals given. Then list which of "
        "the at-risk assets to harden and how (one short action each). Set confidence from the scenario spread.\n"
        "Return JSON: {ranked:[{id, rank, reason}], harden:[{id, action}], confidence: high|medium|low, "
        "confidence_note, summary}.\n\n"
        f"TOTALS: people_to_evacuate={risk['people_to_evacuate']}, people_in_wind_zone={risk['people_in_wind_zone']}, "
        f"people_in_flood_zone={risk['people_in_flood_zone']}\n\n"
        f"CANDIDATES:\n{json.dumps(top)}\n\nASSETS AT RISK:\n{json.dumps(assets)}\n\n"
        f"SCENARIOS:\n{json.dumps(scenarios)}"
    )
    return llm.ask_json(SYSTEM, prompt, fallback)


def run(t_rel: float) -> Iterator[dict]:
    def step(sid, title, status, detail="", **extra):
        return {"type": "step", "id": sid, "title": title, "status": status, "detail": detail, **extra}

    yield {"type": "start", "llm": llm.provider_info(), "t_rel": t_rel}

    yield step("bulletin", "Read the bulletin and satellite image", "running")
    assessment, meta = assess_storm(t_rel)
    yield step("bulletin", "Read the bulletin and satellite image", "done",
               f"{assessment.get('category', '')} · landfall {ist(storm.landfall_time())}", llm=meta)

    yield step("surge", "Run surge model on 3 track scenarios", "running")
    t0 = time.time()
    scenarios = []
    for sc in storm.SCENARIOS:
        r = surge.run_at(t_rel, sc)
        a = exposure.analysis(t_rel, sc)
        scenarios.append({"scenario": sc, "max_level_m": round(r.max_level, 2), "flooded_km2": round(r.flooded_km2),
                          "people_in_flood_zone": a["people_in_flood_zone"]})
    yield step("surge", "Run surge model on 3 track scenarios", "done",
               " · ".join(f"{s['scenario']} {s['max_level_m']} m" for s in scenarios),
               seconds=round(time.time() - t0, 1))

    risk = exposure.analysis(t_rel, "likely")
    yield step("exposure", "Find people and assets in the flood zone", "done",
               f"{risk['people_to_evacuate']:,} to move · {risk['people_in_flood_zone']:,} in surge zone · "
               f"{risk['counts']['hospitals']} hospitals")
    yield step("shelters", "Match villages to shelters with dry routes", "done",
               f"{sum(1 for c in risk['candidates'] if c['route'] == 'dry')} of {len(risk['candidates'])} routes stay dry")
    yield step("roads", "Check roads against flood timing", "done", f"{risk['counts']['road_km_cut']} km of main road cut")

    yield step("rank", "Rank evacuation and explain why", "running")
    ranked, meta2 = rank_plan(t_rel, risk, scenarios)
    by_id = {c["id"]: c for c in risk["candidates"]}
    rows = []
    for item in sorted(ranked.get("ranked", []), key=lambda x: x.get("rank", 99)):
        c = by_id.get(item.get("id"))
        if c:
            rows.append({**c, "rank": len(rows) + 1, "reason": item.get("reason", "")})
    assets_by_id = {a["id"]: a for a in risk["assets_at_risk"]}
    harden = [{**assets_by_id[h["id"]], "action": h.get("action", "")}
              for h in ranked.get("harden", []) if h.get("id") in assets_by_id]
    yield step("rank", "Rank evacuation and explain why", "done", f"{len(rows)} villages ranked", llm=meta2)

    plan = {
        "t_rel": round(t_rel), "created": time.time(), "status": "draft",
        "assessment": assessment, "bulletin": bulletin_text(t_rel), "scenarios": scenarios,
        "ranked": rows, "harden": harden, "summary": ranked.get("summary", ""),
        "confidence": ranked.get("confidence", "medium"), "confidence_note": ranked.get("confidence_note", ""),
        "counts": risk["counts"], "people_in_flood_zone": risk["people_in_flood_zone"],
        "people_to_evacuate": risk["people_to_evacuate"], "people_in_wind_zone": risk["people_in_wind_zone"],
        "districts": risk["districts"], "llm": meta2,
    }
    STATE["plan"] = plan
    from . import store
    store.save()
    yield {"type": "plan", "plan": plan}
