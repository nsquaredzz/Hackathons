"""Spoken audio for the resident's phone from Gemini TTS, so every language (Odia included) sounds natural.

Each clip is cached on disk by (voice, language, text): an alert or a walking prompt is generated once and then
served instantly to every phone. Calls to Gemini are spaced out to stay inside free-tier per-minute limits;
if Gemini cannot answer, the phone falls back to its own speech engine.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import os
import threading
import time

import httpx

from .geo import DATA

log = logging.getLogger("tts")
CACHE = DATA / "tts_cache"
MODELS = [m.strip() for m in os.getenv("GEMINI_TTS_MODELS", "gemini-3.8-flash-tts,gemini-3.8-flash-lite-tts").split(",") if m.strip()]
VOICE = os.getenv("GEMINI_TTS_VOICE", "Kore")
MIN_GAP = float(os.getenv("TTS_MIN_GAP", "4"))  # seconds between Gemini calls
URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

_lock = threading.Lock()
_last_call = 0.0
_people_waiting = 0  # lines someone is waiting to hear right now; background work gives way to them
_count = threading.Lock()


def available() -> bool:
    return bool(os.getenv("GEMINI_API_KEY"))


def _path(text: str, lang: str):
    key = hashlib.sha1(f"{VOICE}|{lang}|{text}".encode()).hexdigest()
    return CACHE / f"{key}.wav"


def cached(text: str, lang: str) -> bool:
    return _path(text.strip(), lang).exists()


def speech(text: str, lang: str, background: bool = False) -> bytes | None:
    """WAV audio for `text`, from the cache or Gemini; None if Gemini is unavailable or out of quota.
    `background` lines (generated ahead of time) wait while anyone is waiting to hear something."""
    global _last_call, _people_waiting
    text = text.strip()
    path = _path(text, lang)
    if path.exists():
        return path.read_bytes()
    if not available() or not text:
        return None
    if background:
        while _people_waiting:
            time.sleep(0.2)
    else:
        with _count:
            _people_waiting += 1
    try:
        return _generate(text, path)
    finally:
        if not background:
            with _count:
                _people_waiting -= 1


def _generate(text: str, path) -> bytes | None:
    global _last_call
    with _lock:  # one Gemini call at a time, spaced out
        if path.exists():
            return path.read_bytes()
        wait = MIN_GAP - (time.time() - _last_call)
        if wait > 0:
            time.sleep(wait)
        for model in MODELS:
            try:
                r = httpx.post(URL.format(model=model), headers={"x-goog-api-key": os.environ["GEMINI_API_KEY"]}, timeout=40, json={
                    "contents": [{"parts": [{"text": text}]}],
                    "generationConfig": {"responseModalities": ["AUDIO"],
                                         "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": VOICE}}}},
                })
            except httpx.HTTPError as exc:
                log.warning("tts %s failed: %s", model, exc)
                continue
            finally:
                _last_call = time.time()
            if r.status_code == 200:
                part = r.json()["candidates"][0]["content"]["parts"][0]["inlineData"]
                audio = base64.b64decode(part["data"])
                CACHE.mkdir(parents=True, exist_ok=True)
                path.write_bytes(audio)
                return audio
            log.warning("tts %s: %s", model, r.status_code)
            if r.status_code not in (429, 500, 503):
                break
    return None
