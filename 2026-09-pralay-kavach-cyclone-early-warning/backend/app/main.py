"""Pralay Kavach API."""

from __future__ import annotations

import io
import json
import logging
from functools import lru_cache
from pathlib import Path

import numpy as np
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pydantic import BaseModel

load_dotenv(Path(__file__).resolve().parents[2] / ".env")
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from . import advisory, agent, bot, citizen, exposure, guide, live, llm, rainflood, storm, store, surge, tts, validate  # noqa: E402
from .geo import DATA, grid, lonlat_to_merc  # noqa: E402

logging.basicConfig(level=logging.INFO)
app = FastAPI(title="Pralay Kavach", version="0.1")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

T_MIN, T_MAX = -72, 24


@app.on_event("startup")
def startup():
    store.load()

    def warm():
        # Compute the heavy layers once so the first clicks in a demo are instant.
        for t in (-48, -36, -24):
            for sc in storm.SCENARIOS:
                exposure.analysis(t, sc)
        surge.depth_png(surge.run_at(-48, "likely").depth)
        validate.observed_png(), validate.waterlogging_png(), validate.cross_validate(), validate.flooded_villages()
        exposure.parametric()
        logging.getLogger("warmup").info("models warm")

    import threading
    threading.Thread(target=warm, daemon=True).start()


def clamp_t(t: float) -> float:
    return float(np.clip(t, T_MIN, T_MAX))


@app.get("/api/health")
def health():
    files = ["fani_track.json", "dem.npz", "population.npz", "assets.json", "roads.json", "villages.json",
             "satellite_2019-05-02.jpg", "observed_flood.npz", "hydro.npz"]
    return {"llm": llm.provider_info(), "data": {f: (DATA / f).exists() for f in files},
            "replay": {"t_min": T_MIN, "t_max": T_MAX, "landfall": storm.landfall_time().isoformat()}}


@app.get("/api/storm")
def get_storm(t: float = -72):
    return storm.storm_state(clamp_t(t))


@app.get("/api/layers/meta")
def layer_meta():
    return {"flood_corners": grid().corners(), "satellite_corners": [[80, 25], [92, 25], [92, 13], [80, 13]],
            "bbox": grid().lonlat_bounds()}


@app.get("/api/layers/flood.png")
def flood_png(t: float = -48, scenario: str = "likely"):
    if scenario not in storm.SCENARIOS:
        raise HTTPException(400, "unknown scenario")
    png = surge.depth_png(surge.run_at(clamp_t(t), scenario).depth)
    return Response(png, media_type="image/png", headers={"Cache-Control": "max-age=3600"})


@lru_cache(maxsize=1)
def _satellite_mercator() -> bytes:
    """GIBS serves plate carree; resample rows so the image sits correctly on a Web Mercator map."""
    img = Image.open(DATA / "satellite_2019-05-02.jpg").convert("RGB")
    src = np.asarray(img)
    h = src.shape[0]
    _, y_n = lonlat_to_merc(0, 25)
    _, y_s = lonlat_to_merc(0, 13)
    ys = np.linspace(y_n, y_s, h)
    lats = np.degrees(2 * np.arctan(np.exp(ys / 6378137.0)) - np.pi / 2)
    rows = np.clip(((25 - lats) / 12 * h).astype(int), 0, h - 1)
    buf = io.BytesIO()
    Image.fromarray(src[rows]).save(buf, "JPEG", quality=85)
    return buf.getvalue()


@app.get("/api/layers/satellite.jpg")
def satellite():
    return Response(_satellite_mercator(), media_type="image/jpeg", headers={"Cache-Control": "max-age=86400"})


@app.get("/api/layers/observed.png")
def observed_png():
    png = validate.observed_png()
    if png is None:
        raise HTTPException(404, "observed flood map not generated")
    return Response(png, media_type="image/png", headers={"Cache-Control": "max-age=3600"})


@app.get("/api/layers/waterlogging.png")
def waterlogging_png():
    png = validate.waterlogging_png()
    if png is None:
        raise HTTPException(404, "hydrology data not generated")
    return Response(png, media_type="image/png", headers={"Cache-Control": "max-age=3600"})


@app.get("/api/assets")
def all_assets():
    return [exposure._asset_public(a) for a in exposure.assets()]


@app.get("/api/risk")
def risk(t: float = -48, scenario: str = "likely"):
    a = exposure.analysis(clamp_t(t), scenario)
    return {**a, "assets_at_risk": a["assets_at_risk"][:400], "waterlogging": exposure.waterlogging_summary()}


@app.get("/api/agent/run")
def run_agent(t: float = -36):
    def events():
        for ev in agent.run(clamp_t(t)):
            yield f"data: {json.dumps(ev, default=str)}\n\n"
    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/plan")
def get_plan():
    return agent.STATE.get("plan") or JSONResponse({"detail": "no plan yet"}, status_code=404)


class AdvisoryRequest(BaseModel):
    district: str


@app.post("/api/advisory")
def make_advisory(req: AdvisoryRequest):
    if req.district not in exposure.DISTRICT_HQS:
        raise HTTPException(400, "unknown district")
    return advisory.generate(req.district)


@app.get("/api/advisories")
def list_advisories():
    return list(advisory.ADVISORIES.values())


class Approval(BaseModel):
    approver: str


@app.post("/api/advisory/{district}/approve")
def approve(district: str, body: Approval):
    if district not in advisory.ADVISORIES:
        raise HTTPException(404, "no advisory for that district")
    try:
        return advisory.approve(district, body.approver)
    except ValueError as exc:
        raise HTTPException(409, str(exc))


@app.get("/api/advisory/{district}/cap.xml")
def cap(district: str):
    if district not in advisory.ADVISORIES:
        raise HTTPException(404, "no advisory for that district")
    return Response(advisory.ADVISORIES[district]["cap"], media_type="application/xml")


@app.get("/api/citizen/feed")
def citizen_feed(lat: float = Query(...), lon: float = Query(...)):
    return citizen.feed(lat, lon)


@app.post("/api/citizen/report")
async def citizen_report(lat: float = Form(...), lon: float = Form(...), depth: str = Form("knee"),
                         home_lat: float | None = Form(None), home_lon: float | None = Form(None),
                         photo: UploadFile | None = File(None)):
    data = await photo.read() if photo else None
    home = (home_lat, home_lon) if home_lat is not None and home_lon is not None else None
    return citizen.report(lat, lon, depth, data, photo.content_type if photo else None, home)


@app.get("/api/reports")
def reports():
    return citizen.REPORTS


@app.get("/api/verify")
def verify(scenario: str = "likely"):
    plan = agent.STATE.get("plan")
    people = plan.get("people_to_evacuate") if plan else exposure.analysis(-36, scenario)["people_to_evacuate"]
    return {"hindcast": validate.compare(people), "parametric": exposure.parametric(scenario),
            "flood_payout": exposure.flood_payout()}


@app.get("/api/live/overview")
def live_overview():
    try:
        return live.overview()
    except Exception as exc:
        raise HTTPException(502, f"live feeds unavailable: {exc}")


@app.get("/api/live/wind")
def live_wind(step: int = 3):
    try:
        return live.wind_payload(max(1, min(step, 6)))
    except Exception as exc:
        raise HTTPException(502, f"wind feed unavailable: {exc}")


@app.get("/api/live/outlook")
def live_outlook(lat: float = Query(...), lon: float = Query(...)):
    try:
        return live.outlook(lat, lon)
    except Exception as exc:
        raise HTTPException(502, f"forecast unavailable: {exc}")


@app.get("/api/live/backtest")
def live_backtest():
    f = DATA / "genesis_backtest.json"
    if not f.exists():
        raise HTTPException(404, "run `python -m pipeline.backtest_genesis` first")
    return json.loads(f.read_text())


class BotTurn(BaseModel):
    lat: float
    lon: float
    lang: str = "or"
    message: str
    history: list[dict] = []
    session: str = ""


@app.post("/api/bot/chat")
def bot_chat(turn: BotTurn):
    if not turn.message.strip():
        raise HTTPException(400, "empty message")
    return bot.chat(turn.lat, turn.lon, turn.lang, turn.message.strip()[:600], turn.history, turn.session)


@app.get("/api/tts")
def speak(text: str = Query(..., max_length=700), lang: str = "en", bg: bool = False):
    """The phone's voice: Gemini TTS audio for a line of text, cached so each line is generated once.
    `bg=1` marks lines generated ahead of time; they give way to lines someone is waiting to hear."""
    audio = tts.speech(text, lang, background=bg)
    if audio is None:
        raise HTTPException(503, "voice unavailable; use the device voice")
    return Response(audio, media_type="audio/wav", headers={"Cache-Control": "public, max-age=604800"})


@app.get("/api/tts/status")
def speak_status():
    return {"available": tts.available(), "voice": tts.VOICE, "models": tts.MODELS}


@app.get("/api/guide/route")
def guide_route(lat: float, lon: float, to_lat: float, to_lon: float):
    """Walking route to a shelter with turn-by-turn steps and the flooded spots along it."""
    return guide.walk(lat, lon, to_lat, to_lon)


class HelpAsk(BaseModel):
    lat: float
    lon: float
    need: str = "transport"
    people: int | None = None
    note: str = ""
    lang: str = "en"
    household: list[str] = []


@app.post("/api/help/request")
def help_request(body: HelpAsk):
    """A resident asks for a vehicle or rescue from the phone; it appears in the control room's SOS list."""
    return guide.request_help(body.lat, body.lon, body.need, body.people, body.note, body.lang, body.household)


@app.get("/api/help")
def help_requests():
    return sorted(bot.HELP, key=lambda h: -h["time"])


class HelpUpdate(BaseModel):
    status: str


@app.post("/api/help/{hid}")
def update_help(hid: str, body: HelpUpdate):
    for h in bot.HELP:
        if h["id"] == hid:
            h["status"] = body.status
            store.save()
            return h
    raise HTTPException(404, "not found")


@app.post("/api/reset")
def reset_demo():
    """Clear plans, advisories and reports to start a fresh demo run."""
    store.reset()
    return {"ok": True}


dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if dist.exists():
    from fastapi.responses import FileResponse

    app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        """Serve built files, and index.html for client-side routes like /citizen."""
        f = (dist / path).resolve()
        if path and f.is_file() and dist in f.parents:
            return FileResponse(f)
        return FileResponse(dist / "index.html")
