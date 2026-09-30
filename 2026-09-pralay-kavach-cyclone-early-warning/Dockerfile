# One image for Cloud Run or Hugging Face Spaces: builds the React app, then serves it and the API from one FastAPI process.
FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
# Hugging Face Spaces runs containers as uid 1000; the app writes demo state and live-feed caches under backend/data.
RUN useradd -m -u 1000 app
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY --chown=app backend/ backend/
COPY --chown=app --from=web /web/dist frontend/dist
# The repo ships the prepared data (including the Earth Engine layers); only fetch if something is missing.
RUN cd backend && (test -f data/dem.npz && test -f data/villages.json || python -m pipeline.fetch_open_data) && chown -R app /app/backend/data
USER app
ENV PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port ${PORT}"]
