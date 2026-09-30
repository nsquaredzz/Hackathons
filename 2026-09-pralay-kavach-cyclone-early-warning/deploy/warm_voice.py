"""Pre-generate the phone's fixed spoken lines (walking directions, warnings, setup prompts) with Gemini TTS,
so they play instantly for everyone. Lines already cached are skipped; it stops early if Gemini is over quota.

Usage:  python3 deploy/warm_voice.py [api-url] [langs]
        python3 deploy/warm_voice.py http://localhost:8787 or,en,hi
"""

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8787").rstrip("/")
LANGS = (sys.argv[2] if len(sys.argv) > 2 else "or,en,hi").split(",")
LINES = json.loads((Path(__file__).parent / "voice_lines.json").read_text())

done = failed = 0
for lang in LANGS:
    for text in LINES.get(lang, []):
        url = f"{API}/api/tts?lang={lang}&bg=1&text={urllib.parse.quote(text)}"
        t0 = time.time()
        try:
            urllib.request.urlopen(url, timeout=120).read()
            done += 1
            print(f"ok   {lang} {time.time() - t0:4.1f}s  {text[:50]}", flush=True)
        except urllib.error.HTTPError as e:
            failed += 1
            print(f"fail {lang} {e.code}  {text[:50]}", flush=True)
            if e.code == 503 and time.time() - t0 < 1:
                print("Gemini TTS is over quota (cooling off). Try again after the daily reset.")
                sys.exit(1)
print(f"{done} lines ready, {failed} failed")
