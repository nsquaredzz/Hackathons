"""Sahayak: a voice assistant that helps people through a cyclone in their own language.

Each turn: gather the person's situation from live data (their district's alert, shelter and route,
the outlook, nearby reports), ask the model for a short spoken reply plus actions, then enforce the
safety rules in code, whatever the model said:
  - life-threatening words always put "Call 112" first;
  - it never contradicts an evacuation order;
  - reports and rescue requests it files reach the officer console.
The same engine can sit behind a phone line (IVR) or WhatsApp; the browser is the demo channel.
"""

from __future__ import annotations

import json
import re
import time
import uuid
from urllib.parse import quote

from . import advisory, citizen, live, llm
from .exposure import district_of

LANGS = {"or": "Odia", "hi": "Hindi", "bn": "Bengali", "te": "Telugu", "ta": "Tamil", "en": "English"}
CONTACTS = [
    {"number": "112", "label": "Emergency"},
    {"number": "108", "label": "Ambulance"},
    {"number": "1070", "label": "State control room"},
    {"number": "1077", "label": "District control room"},
]
HELP: list[dict] = []

# Words that mean someone may be in danger right now (English, Odia, Hindi, Bengali, Telugu, Tamil).
DANGER = re.compile(
    r"trapped|stuck|drown|injur|bleed|hurt|unconscious|not breathing|heart|chest pain|collapsed|pregnan|labou?r|"
    r"roof|electrocut|snake|rescue|help me|dying|"
    r"ଫସି|ଆହତ|ରକ୍ତ|ବୁଡ଼|ଉଦ୍ଧାର|ବଞ୍ଚାଅ|"
    r"फंस|फँस|घायल|खून|डूब|बचाओ|बेहोश|"
    r"আটকে|আহত|রক্ত|ডুব|বাঁচাও|"
    r"చిక్కు|గాయ|రక్త|మునిగ|కాపాడ|"
    r"சிக்கி|காயம்|இரத்த|மூழ்க|காப்பாற்",
    re.I)

SYSTEM = """You are Sahayak, a calm voice assistant helping people on India's east coast through a cyclone.
People may be frightened, may not read well, and speak their own language. You reply in the language given,
in plain spoken words: at most 3 short sentences, no lists, no markdown, no emoji. Your reply is read aloud.

Rules you must follow:
- Use only the facts in SITUATION about the storm, alerts, shelters and routes. If something is not there, say you
  do not know and suggest calling 1070 (state control room) or 1077 (district control room).
- Official orders come first. If the district has issued an evacuation alert, never tell anyone it is safe to stay.
- If anyone may be in danger now (trapped, injured, water rising inside the house, drowning, not breathing,
  electrocution, labour), tell them to call 112 now, set urgent to true, and file a rescue request.
- Practical cyclone safety (what to carry, staying away from the sea and power lines, drinking safe water,
  staying indoors when the eye passes) is fine to give from general knowledge. Do not give medical treatment
  beyond basic first aid; send them to 108.
- Offer the next useful step as an action rather than describing it.
- Write phone numbers, times and distances with the digits 0-9 (for example 112, 1070), never in native script digits.
- Family phone numbers are saved on the person's phone. To contact family, add the notify_family action; never ask
  for a phone number.

Return JSON only:
{"reply": "<spoken reply in the requested language>",
 "english": "<the same reply in English, for the control room log>",
 "intent": "shelter|alert|report_water|rescue|medical|family|safety_tips|contacts|other",
 "urgent": true|false,
 "actions": ["call_112"|"call_108"|"call_1070"|"call_1077"|"directions"|"notify_family_safe"|"notify_family_help"|"show_contacts"],
 "report": null | {"what": "water|blocked_road|damage", "depth": "ankle|knee|waist|higher", "where": "here|route"},
 "rescue": null | {"need": "rescue|medical|food_water|transport", "people": <number or null>, "note": "<short English note>"}}"""


# Odia, Bengali, Devanagari, Telugu and Tamil digits -> 0-9, so phone numbers match the call buttons.
_DIGITS = str.maketrans({chr(base + i): str(i) for base in (0x0B66, 0x09E6, 0x0966, 0x0C66, 0x0BE6) for i in range(10)})


def situation(lat: float, lon: float, lang: str) -> dict:
    district = district_of(lat, lon)
    alerts = advisory.dispatched_for(district)
    alert = None
    if alerts:
        a = alerts[-1]
        t = a["texts"].get(lang) if a["texts"].get(lang, {}).get("body") else a["texts"].get("en")
        alert = {"headline": t.get("headline"), "body": t.get("body"), "leave_by": a["facts"].get("leave_by_ist"),
                 "landfall": a["facts"].get("landfall_ist"), "evacuation_order": True}
    try:
        shelter = citizen.shelter_for(lat, lon)
    except Exception:
        shelter = None
    try:
        o = live.outlook(lat, lon)
        outlook = {"level": o["level"], "headline": o["headline"], "reasons": o["reasons"], "now": o["now"]}
    except Exception:
        outlook = None
    nearby = [{"level": r["verified_level"], "matches_forecast": r["matches_model"]}
              for r in citizen.REPORTS[-20:] if abs(r["lat"] - lat) < 0.1 and abs(r["lon"] - lon) < 0.1]
    return {"district": district, "official_alert": alert, "shelter": shelter, "outlook": outlook,
            "nearby_water_reports": nearby[-5:], "emergency_numbers": CONTACTS}


def _fallback(message: str, sit: dict, lang: str) -> dict:
    """Rule-based replies when no model is available (English and Odia)."""
    m = message.lower()
    odia = lang == "or"
    s = sit.get("shelter")
    if DANGER.search(message):
        return {"reply": "ଏବେ 112 କୁ ଫୋନ କରନ୍ତୁ। ମୁଁ ଉଦ୍ଧାର ଅନୁରୋଧ ପଠାଉଛି।" if odia else
                "Call 112 now. I am sending a rescue request to the control room.",
                "english": "Call 112 now. Rescue request sent.", "intent": "rescue", "urgent": True,
                "actions": ["call_112"], "report": None, "rescue": {"need": "rescue", "people": None, "note": message[:120]}}
    if any(k in m for k in ("water", "flood", "ପାଣି", "पानी", "জল", "నీరు", "தண்ணீர்")):
        return {"reply": "ରିପୋର୍ଟ ପଠାଗଲା। ଉଚ୍ଚ ସ୍ଥାନକୁ ଯାଆନ୍ତୁ ଏବଂ ଆଶ୍ରୟସ୍ଥଳୀ ରାସ୍ତା ଦେଖନ୍ତୁ।" if odia else
                "Thank you, I have reported the water. Move to higher ground and follow the route to your shelter.",
                "english": "Water reported; move to higher ground.", "intent": "report_water", "urgent": False,
                "actions": ["directions"], "report": {"what": "water", "depth": "knee", "where": "here"}, "rescue": None}
    if any(k in m for k in ("family", "safe", "ପରିବାର", "परिवार")):
        return {"reply": "ଆପଣଙ୍କ ପରିବାରକୁ ଖବର ପଠାଇବା ପାଇଁ ତଳେ ଦବାନ୍ତୁ।" if odia else
                "Tap below to tell your family you are safe.",
                "english": "Offered to notify family.", "intent": "family", "urgent": False,
                "actions": ["notify_family_safe"], "report": None, "rescue": None}
    if s:
        return {"reply": (f"ଆପଣଙ୍କ ଆଶ୍ରୟସ୍ଥଳୀ {s['name']}, {s['distance_km']} କି.ମି. ଦୂରରେ।" if odia else
                          f"Your shelter is {s['name']}, {s['distance_km']} km away. The route is {s['route']}."),
                "english": f"Shelter {s['name']}.", "intent": "shelter", "urgent": False,
                "actions": ["directions"], "report": None, "rescue": None}
    o = sit.get("outlook")
    return {"reply": o["headline"] if o else "Call 1070 for the state control room.", "english": "Outlook given.",
            "intent": "alert", "urgent": False, "actions": ["show_contacts"], "report": None, "rescue": None}


def chat(lat: float, lon: float, lang: str, message: str, history: list[dict], session: str) -> dict:
    lang = lang if lang in LANGS else "en"
    sit = situation(lat, lon, lang)
    convo = "\n".join(f"{h['role']}: {h['text']}" for h in history[-6:])
    prompt = (f"LANGUAGE: {LANGS[lang]}\nSITUATION:\n{json.dumps(sit, ensure_ascii=False, default=str)}\n\n"
              f"CONVERSATION SO FAR:\n{convo}\n\nPERSON SAYS: {message}")
    t0 = time.time()
    # A person in danger cannot wait: cap the model at 25 s and fall back to rules (112 stays first).
    out, meta = llm.ask_json(SYSTEM, prompt, lambda: _fallback(message, sit, lang), fast=True, timeout=25)
    if not isinstance(out, dict) or not out.get("reply"):
        out, meta = _fallback(message, sit, lang), {**meta, "fallback": True}

    # Safety rules, enforced in code.
    actions = [a for a in out.get("actions") or [] if isinstance(a, str)]
    danger = bool(DANGER.search(message))
    if danger or out.get("urgent"):
        out["urgent"] = True
        actions = ["call_112"] + [a for a in actions if a != "call_112"]
        if not out.get("rescue"):
            out["rescue"] = {"need": "rescue", "people": None, "note": message[:160]}

    filed = {}
    rep = out.get("report")
    if isinstance(rep, dict) and rep.get("what") == "water":
        depth = rep.get("depth") if rep.get("depth") in citizen.DEPTH_CHOICES else "knee"
        spot = (lat, lon)
        s = sit.get("shelter")
        if rep.get("where") == "route" and s:
            spot = ((lat + s["lat"]) / 2, (lon + s["lon"]) / 2)
        res = citizen.report(spot[0], spot[1], depth, None, None, home=(lat, lon))
        filed["report"] = res["report"]["id"]
        sit["shelter"] = res["shelter"]
    resc = out.get("rescue")
    if isinstance(resc, dict):
        item = {"id": str(uuid.uuid4())[:8], "time": time.time(), "lat": lat, "lon": lon, "district": sit["district"],
                "need": resc.get("need") or "rescue", "people": resc.get("people"),
                "note": resc.get("note") or message[:160], "lang": lang, "said": message[:300], "status": "open",
                "session": session}
        HELP.append(item)
        from . import store
        store.save()
        filed["help"] = item["id"]
    return {
        "reply": str(out["reply"]).translate(_DIGITS), "english": out.get("english"), "intent": out.get("intent"), "urgent": bool(out.get("urgent")),
        "actions": _expand(actions, sit, lang), "filed": filed, "shelter": sit.get("shelter"),
        "llm": meta, "seconds": round(time.time() - t0, 1),
    }


def _expand(actions: list[str], sit: dict, lang: str) -> list[dict]:
    """Turn action names into buttons the phone can act on (tel:, maps, WhatsApp/SMS text)."""
    out, seen = [], set()
    s = sit.get("shelter")
    for a in actions:
        if a in seen:
            continue
        seen.add(a)
        if a.startswith("call_"):
            num = a.split("_", 1)[1]
            label = next((c["label"] for c in CONTACTS if c["number"] == num), num)
            out.append({"type": "call", "number": num, "label": f"Call {num}", "detail": label})
        elif a == "directions" and s:
            out.append({"type": "directions", "label": f"Route to {s['name']}", "lat": s["lat"], "lon": s["lon"]})
        elif a in ("notify_family_safe", "notify_family_help"):
            safe = a.endswith("safe")
            place = f" I am going to {s['name']}." if s and safe else ""
            msg = (f"I am safe.{place} (Sent from Pralay Kavach)" if safe
                   else "I need help. Please call me or call 112. (Sent from Pralay Kavach)")
            out.append({"type": "family", "label": "Tell my family I'm safe" if safe else "Ask family for help",
                        "message": msg, "safe": safe})
        elif a == "show_contacts":
            out.append({"type": "contacts", "label": "Emergency numbers", "contacts": CONTACTS})
    return out


def whatsapp_link(number: str | None, message: str) -> str:
    return f"https://wa.me/{number or ''}?text={quote(message)}"
