#!/usr/bin/env bash
# Start the API (port 8000) and the web app (port 5173) together. Ctrl+C stops both.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d backend/.venv ]; then
  python3 -m venv backend/.venv
  backend/.venv/bin/pip install -q -r backend/requirements.txt
fi
if [ ! -f backend/data/dem.npz ] || [ ! -f backend/data/villages.json ]; then
  (cd backend && .venv/bin/python -m pipeline.fetch_open_data)
fi
[ -d frontend/node_modules ] || (cd frontend && npm install)

trap 'kill 0' EXIT
(cd backend && .venv/bin/uvicorn app.main:app --port 8000 --reload --reload-dir app) &
(cd frontend && npm run dev) &
wait
