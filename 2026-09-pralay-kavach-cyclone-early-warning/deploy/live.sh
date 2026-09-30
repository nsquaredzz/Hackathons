#!/usr/bin/env bash
# Live demo from this Mac: the API container behind a Cloudflare quick tunnel, and the web app on Firebase Hosting
# (https://pralay-kavach.web.app) rebuilt to point at the tunnel. Run again after a reboot or if the tunnel drops:
# the tunnel URL changes, the Firebase URL does not.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=8787
LOG="$HOME/Library/Logs/pralay-kavach-tunnel.log"

docker image inspect pralay-kavach >/dev/null 2>&1 || docker build -t pralay-kavach .
docker start pralay-kavach >/dev/null 2>&1 || docker run -d --name pralay-kavach --restart unless-stopped -p 127.0.0.1:$PORT:8080 \
  -e LLM_PROVIDER=gemini -e GEMINI_MODEL=gemini-3.8-flash -e GEMINI_BACKUP_MODELS=gemini-3.7-flash,gemini-3.5-flash \
  -e "GEMINI_API_KEY=$(grep '^GEMINI_API_KEY=' .env | cut -d= -f2-)" pralay-kavach >/dev/null
until curl -sf "localhost:$PORT/api/health" >/dev/null; do sleep 2; done

pkill -f "cloudflared tunnel --no-autoupdate --url http://localhost:$PORT" || true
nohup cloudflared tunnel --no-autoupdate --url "http://localhost:$PORT" >"$LOG" 2>&1 & disown
URL=""
for _ in $(seq 1 60); do URL=$(grep -aoE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | tail -1 || true); [ -n "$URL" ] && break; sleep 1; done
[ -n "$URL" ] || { echo "tunnel did not start; see $LOG"; exit 1; }
# Never publish a web app pointing at an API that does not answer.
for _ in $(seq 1 60); do curl -sf --max-time 10 "$URL/api/health" >/dev/null && break; sleep 3; done
curl -sf --max-time 10 "$URL/api/health" >/dev/null || { echo "API not reachable through $URL; not publishing"; exit 1; }
# Keep the Mac from idle-sleeping for as long as the tunnel runs.
nohup caffeinate -ims -w "$(pgrep -f "cloudflared tunnel --no-autoupdate --url http://localhost:$PORT" | head -1)" >/dev/null 2>&1 & disown

(cd frontend && VITE_API_BASE="$URL" npm run build >/dev/null)
npx -y firebase-tools@latest deploy --only hosting --project pralay-kavach >/dev/null
echo "Live: https://pralay-kavach.web.app   (API tunnel: $URL)"
