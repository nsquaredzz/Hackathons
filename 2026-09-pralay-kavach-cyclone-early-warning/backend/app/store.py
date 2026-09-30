"""Save the live demo state (plan, advisories, dispatches, citizen reports) so restarts keep it."""

from __future__ import annotations

import json
import logging
import threading

from .geo import DATA

PATH = DATA / "state.json"
_lock = threading.Lock()
log = logging.getLogger("store")


def save() -> None:
    from . import advisory, agent, bot, citizen

    state = {"plan": agent.STATE.get("plan"), "advisories": advisory.ADVISORIES,
             "dispatched": [a["district"] for a in advisory.DISPATCHED], "reports": citizen.REPORTS, "help": bot.HELP}
    with _lock:
        tmp = PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(state, default=str))
        tmp.replace(PATH)


def load() -> None:
    from . import advisory, agent, citizen

    if not PATH.exists():
        return
    try:
        state = json.loads(PATH.read_text())
    except (OSError, ValueError) as exc:
        log.warning("could not read saved state: %s", exc)
        return
    agent.STATE["plan"] = state.get("plan")
    advisory.ADVISORIES.clear()
    advisory.ADVISORIES.update(state.get("advisories") or {})
    advisory.DISPATCHED[:] = [advisory.ADVISORIES[d] for d in state.get("dispatched", []) if d in advisory.ADVISORIES]
    citizen.REPORTS[:] = state.get("reports") or []
    from . import bot
    bot.HELP[:] = state.get("help") or []


def reset() -> None:
    from . import advisory, agent, citizen

    agent.STATE["plan"] = None
    advisory.ADVISORIES.clear()
    advisory.DISPATCHED.clear()
    citizen.REPORTS.clear()
    from . import bot
    bot.HELP.clear()
    save()
