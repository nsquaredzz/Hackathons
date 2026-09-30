"""One interface for the model calls, with four backends.

  gemini      GEMINI_API_KEY set        (the one to demo to judges)
  anthropic   ANTHROPIC_API_KEY set     (development fallback)
  claude-cli  LLM_PROVIDER=claude-cli   (local dev: calls the Claude Code CLI, which uses your own login)
  mock        no key                    (deterministic, rule-based answers so the demo always runs)

Force one with LLM_PROVIDER=gemini|anthropic|claude-cli|mock.
Every call asks for JSON back; callers pass a `fallback` that produces the same shape without a model.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any, Callable

log = logging.getLogger("llm")


def _provider_name() -> str:
    forced = os.getenv("LLM_PROVIDER", "").strip().lower()
    if forced:
        return forced
    if os.getenv("GEMINI_API_KEY"):
        return "gemini"
    if os.getenv("ANTHROPIC_API_KEY"):
        return "anthropic"
    return "mock"


def provider_info(fast: bool = False) -> dict:
    """`fast` picks a quicker model for interactive use (the voice assistant)."""
    name = _provider_name()
    gemini = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
    model = {"gemini": (os.getenv("GEMINI_FAST_MODEL") or gemini) if fast else gemini,
             "anthropic": os.getenv("ANTHROPIC_FAST_MODEL", "claude-haiku-4-5") if fast
             else os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5-5"),
             "claude-cli": os.getenv("CLAUDE_CLI_FAST_MODEL", "haiku") if fast else os.getenv("CLAUDE_CLI_MODEL", "sonnet"),
             "mock": "rule-based"}.get(name, "?")
    label = {"gemini": "Gemini", "anthropic": "Claude", "claude-cli": "Claude (your login)",
             "mock": "Mock (no API key)"}.get(name, name)
    return {"provider": name, "model": model, "label": label}


def _parse_json(text: str) -> Any:
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1)
    start = min([i for i in (text.find("{"), text.find("[")) if i >= 0], default=0)
    return json.loads(text[start:])


def _gemini(system: str, prompt: str, images: list[tuple[bytes, str]], model: str, timeout: float) -> str:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"], http_options=types.HttpOptions(timeout=int(timeout * 1000)))
    parts: list[Any] = [types.Part.from_bytes(data=data, mime_type=mime) for data, mime in images]
    parts.append(prompt)
    resp = client.models.generate_content(
        model=model,
        contents=parts,
        config=types.GenerateContentConfig(
            system_instruction=system, temperature=0.2, response_mime_type="application/json",
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True)),
    )
    return resp.text


def _anthropic(system: str, prompt: str, images: list[tuple[bytes, str]], model: str, timeout: float) -> str:
    import anthropic

    client = anthropic.Anthropic(timeout=timeout)
    content: list[dict] = [
        {"type": "image", "source": {"type": "base64", "media_type": mime, "data": base64.b64encode(data).decode()}}
        for data, mime in images
    ]
    content.append({"type": "text", "text": prompt + "\n\nRespond with JSON only."})
    msg = client.messages.create(model=model, max_tokens=4096, system=system,
                                 messages=[{"role": "user", "content": content}])
    return "".join(b.text for b in msg.content if b.type == "text")


def _claude_cli(system: str, prompt: str, images: list[tuple[bytes, str]], model: str, timeout: float) -> str:
    """Headless Claude Code (`claude -p`). Uses whatever account the CLI is signed in with.
    For local development only: a deployed app needs a real API key."""
    exe = shutil.which("claude")
    if not exe:
        raise RuntimeError("Claude Code CLI not found on PATH")
    with tempfile.TemporaryDirectory(prefix="pk-llm-") as tmp:
        cmd = [exe, "-p", "--output-format", "json", "--no-session-persistence",
               "--model", model, "--system-prompt", system + " Respond with JSON only."]
        if images:
            paths = []
            for i, (data, mime) in enumerate(images):
                path = Path(tmp) / f"image_{i}.{mime.split('/')[-1].replace('jpeg', 'jpg')}"
                path.write_bytes(data)
                paths.append(str(path))
            prompt = f"First view these image files with the Read tool: {', '.join(paths)}\n\n{prompt}"
            cmd += ["--tools", "Read", "--allowedTools", "Read", "--add-dir", tmp]
        else:
            cmd += ["--tools", ""]
        run = subprocess.run(cmd, input=prompt + "\n\nRespond with JSON only.", capture_output=True,
                             text=True, timeout=timeout, cwd=tmp)
    try:
        out = json.loads(run.stdout)
    except json.JSONDecodeError:
        raise RuntimeError(f"claude CLI failed: {(run.stderr or run.stdout)[:200]}")
    if out.get("is_error"):
        raise RuntimeError(f"claude CLI: {out.get('result', 'error')}")
    return out.get("result", "")


def ask_json(system: str, prompt: str, fallback: Callable[[], Any],
             images: list[tuple[bytes, str]] | None = None, fast: bool = False,
             timeout: float | None = None) -> tuple[Any, dict]:
    """Returns (result, meta). meta says which backend answered and whether it fell back.
    `timeout` caps the model call; on expiry the rule-based fallback answers instead."""
    info = provider_info(fast)
    timeout = timeout or float(os.getenv("LLM_TIMEOUT", "240"))
    if info["provider"] == "mock":
        return fallback(), {**info, "fallback": False}
    call = {"gemini": _gemini, "anthropic": _anthropic, "claude-cli": _claude_cli}.get(info["provider"])
    models = [info["model"]]
    if info["provider"] == "gemini":  # busy models (503/429) are common at peak; try the backups in turn
        models += [m.strip() for m in os.getenv("GEMINI_BACKUP_MODELS", "gemini-3.7-flash,gemini-3.5-flash").split(",")
                   if m.strip() and m.strip() != info["model"]]
    deadline = time.monotonic() + timeout
    exc: Exception = RuntimeError(f"unknown LLM provider {info['provider']!r}")
    for attempt, model in enumerate(models * 2 if call else []):  # two passes; 503s usually clear in seconds
        if attempt == len(models):
            time.sleep(1.5)
        left = deadline - time.monotonic()
        if left < 3:
            break
        try:
            return _parse_json(call(system, prompt, images or [], model, left)), {**info, "model": model, "fallback": False}
        except Exception as e:
            exc = e
            if getattr(e, "code", None) not in (429, 500, 503, 504):
                break
            log.warning("%s busy (%s); trying next model", model, getattr(e, "code", None))
    # keep the demo alive; the UI shows that it fell back
    log.warning("LLM call failed (%s); using rule-based fallback", exc)
    return fallback(), {**info, "fallback": True, "error": str(exc)[:200]}
