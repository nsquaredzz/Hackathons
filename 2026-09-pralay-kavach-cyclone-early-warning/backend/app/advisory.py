"""Multilingual advisories, CAP 1.2 output, two-person approval and dispatch."""

from __future__ import annotations

import json
import time
import uuid
from datetime import timedelta
from xml.sax.saxutils import escape

from . import agent, llm, storm
from .exposure import DISTRICT_HQS, DISTRICT_LANGUAGES

LANG_NAMES = {"en": "English", "or": "Odia", "te": "Telugu", "bn": "Bengali", "ta": "Tamil"}
CAP_LANG = {"en": "en-IN", "or": "or-IN", "te": "te-IN", "bn": "bn-IN", "ta": "ta-IN"}
ODIA_DIGITS = str.maketrans("0123456789", "୦୧୨୩୪୫୬୭୮୯")

ADVISORIES: dict[str, dict] = {}
DISPATCHED: list[dict] = []


def _facts(district: str) -> dict:
    plan = agent.STATE.get("plan") or {}
    rows = [r for r in plan.get("ranked", []) if r["district"] == district]
    lf = storm.landfall_time()
    leave_h = min([r["leave_by_h"] for r in rows], default=-12)
    leave_by = lf + timedelta(hours=leave_h)
    return {
        "district": district,
        "landfall_ist": agent.ist(lf),
        "landfall_place": "near Puri",
        "leave_by_ist": agent.ist(leave_by),
        "leave_by_dt": leave_by,
        "wind_kmh": storm.storm_state(0)["landfall_wind_kmh"],
        "villages": [r["name"] for r in rows[:6]],
        "category": storm.storm_state(0)["landfall_category"],
    }


def languages_for(district: str) -> list[str]:
    return ["en"] + DISTRICT_LANGUAGES.get(district, ["or"])


def _fallback_text(f: dict, langs: list[str]) -> dict:
    hh = f["leave_by_dt"].astimezone(agent.IST)
    out = {
        "en": {
            "headline": f"Warning: Cyclone Fani. Leave for your shelter by {f['leave_by_ist']}.",
            "body": (f"Cyclone Fani will cross the coast {f['landfall_place']} around {f['landfall_ist']} with winds near "
                     f"{f['wind_kmh']} km/h and a storm surge. People in low-lying villages of {f['district']} district "
                     f"must go to their nearest cyclone shelter before {f['leave_by_ist']}. Take drinking water, "
                     "medicines and documents. Do not go near the sea."),
            "back_translation": None,
        },
        "or": {
            "headline": "ସତର୍କତା: ଘୂର୍ଣ୍ଣିବାତ ଫନି",
            "body": (f"ଘୂର୍ଣ୍ଣିବାତ ଫନି ମେ {str(storm.landfall_time().astimezone(agent.IST).day).translate(ODIA_DIGITS)} "
                     f"ତାରିଖରେ ପୁରୀ ନିକଟରେ ପହଞ୍ଚିବ। {hh.strftime('%d/%m %H:%M').translate(ODIA_DIGITS)} ପୂର୍ବରୁ "
                     "ନିକଟସ୍ଥ ଆଶ୍ରୟସ୍ଥଳୀକୁ ଯାଆନ୍ତୁ।"),
            "back_translation": (f"Warning: Cyclone Fani. Cyclone Fani will reach near Puri on "
                                 f"{storm.landfall_time().astimezone(agent.IST).day} May. Go to the nearest shelter "
                                 f"before {hh.strftime('%d/%m %H:%M')}."),
            "template": True,
        },
    }
    for lang in langs:
        if lang not in out:
            out[lang] = {"headline": None, "body": None, "back_translation": None,
                         "unavailable": f"{LANG_NAMES[lang]} needs a Gemini key (no template in mock mode)."}
    return {k: v for k, v in out.items() if k in langs}


def generate(district: str) -> dict:
    f = _facts(district)
    langs = languages_for(district)
    facts = {k: v for k, v in f.items() if k != "leave_by_dt"}
    prompt = (
        "Write a cyclone evacuation advisory for SMS/WhatsApp and a voice call. Plain words, under 60 words per "
        "language, the action first. Use only these facts:\n" + json.dumps(facts, ensure_ascii=False) +
        f"\n\nLanguages: {', '.join(LANG_NAMES[x] for x in langs)}. For every non-English language also give a literal "
        "English back-translation so a reviewer can check it.\nReturn JSON: {" +
        ", ".join(f'"{x}": {{"headline", "body", "back_translation"}}' for x in langs) + "}"
    )
    texts, meta = llm.ask_json(agent.SYSTEM, prompt, lambda: _fallback_text(f, langs))
    adv = {
        "id": str(uuid.uuid4())[:8], "district": district, "languages": langs, "texts": texts, "llm": meta,
        "facts": facts, "status": "draft", "approvals": [], "created": time.time(),
    }
    adv["cap"] = cap_xml(adv, f)
    ADVISORIES[district] = adv
    from . import store
    store.save()
    return adv


def cap_xml(adv: dict, f: dict) -> str:
    lf = storm.landfall_time()
    hq = DISTRICT_HQS[adv["district"]]
    infos = []
    for lang in adv["languages"]:
        t = adv["texts"].get(lang) or {}
        if not t.get("body"):
            continue
        infos.append(f"""  <info>
    <language>{CAP_LANG[lang]}</language>
    <category>Met</category>
    <event>Cyclone</event>
    <urgency>Expected</urgency>
    <severity>Extreme</severity>
    <certainty>Likely</certainty>
    <onset>{lf.isoformat()}</onset>
    <senderName>State Emergency Operations Centre (Pralay Kavach)</senderName>
    <headline>{escape(t.get('headline') or '')}</headline>
    <description>{escape(t.get('body') or '')}</description>
    <instruction>Move to your assigned cyclone shelter before {escape(f['leave_by_ist'])}.</instruction>
    <area>
      <areaDesc>{escape(adv['district'])} district, Odisha</areaDesc>
      <circle>{hq[0]:.3f},{hq[1]:.3f} 35</circle>
    </area>
  </info>""")
    sent = (storm.landfall_time() - timedelta(hours=24)).isoformat()
    return (f"""<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>PK-{adv['district'].upper()}-{adv['id']}</identifier>
  <sender>seoc@pralaykavach.example</sender>
  <sent>{sent}</sent>
  <status>Exercise</status>
  <msgType>Alert</msgType>
  <scope>Public</scope>
  <note>Replay of Cyclone Fani (2019). Exercise only.</note>
""" + "\n".join(infos) + "\n</alert>\n")


def approve(district: str, approver: str) -> dict:
    adv = ADVISORIES[district]
    if adv["status"] == "dispatched":
        return adv
    if approver in [a["by"] for a in adv["approvals"]]:
        raise ValueError("The same person cannot approve twice; a second approver is required.")
    adv["approvals"].append({"by": approver, "at": time.time()})
    if len(adv["approvals"]) >= 2:
        adv["status"] = "dispatched"
        adv["dispatched_at"] = time.time()
        DISPATCHED.append(adv)
    else:
        adv["status"] = "awaiting_second_approval"
    from . import store
    store.save()
    return adv


def dispatched_for(district: str) -> list[dict]:
    return [a for a in DISPATCHED if a["district"] == district]
