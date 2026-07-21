# Deployment

This project can be deployed as one Node service:

- `/` serves the built React app from `world-cup-command-center/dist`.
- `/api/*` serves the prediction API.
- Local persistence defaults to SQLite.

## Requirements

- Node.js 24 or newer. The backend uses `node:sqlite`.
- A writable persistent directory for SQLite if the deployment should survive restarts.

## Environment Variables

- `PORT`: HTTP port. Defaults to `8787`.
- `HOST`: bind host. Use `0.0.0.0` on a server.
- `PREDICTION_STORE_DRIVER`: defaults to `sqlite`.
- `PREDICTION_STORE_PATH`: writable SQLite path. Recommended on servers, for example `/data/backend-store.sqlite`.
- `ADMIN_TOKEN`: required when `HOST` is not loopback and must contain at least 24 characters. `/api/admin/*` accepts `Authorization: Bearer <token>` or `X-Admin-Token: <token>`.
- `CORS_ORIGIN`: optional exact browser origin such as `https://example.com`. Cross-origin access is disabled by default and wildcard CORS is rejected.
- `MAX_JSON_BODY_BYTES`: optional admin JSON request limit. Defaults to `10485760` (10 MiB).
- `API_FOOTBALL_KEY`: optional free API-Football key for supplemental technical statistics.

## Docker

Build:

```bash
docker build -t world-cup-prediction .
```

Run:

```bash
docker run --rm -p 8787:8787 \
  -e ADMIN_TOKEN="<set-a-long-random-token>" \
  -v world-cup-prediction-data:/data \
  world-cup-prediction
```

Open:

```text
http://127.0.0.1:8787
```

## Non-Docker VPS

From the repository root:

```bash
npm --prefix world-cup-command-center ci
npm run build
HOST=0.0.0.0 PORT=8787 PREDICTION_STORE_PATH=/data/backend-store.sqlite ADMIN_TOKEN="<set-a-long-random-token>" npm start
```

Use a process manager such as `systemd` or `pm2` for long-running deployment.

## Match Update Watcher

Run one official FIFA fixture/result plus completed-match facts sync cycle:

```bash
npm run watch:match-updates -- --once --json
```

Run continuously every 5 minutes:

```bash
npm run watch:match-updates
```

In production, run the watcher as a separate scheduled job or background worker that shares the same `PREDICTION_STORE_PATH` as the web service.

## Current Limitations

- This is still a trial deployment shape, not the final production architecture.
- SQLite is acceptable for the current demo/test server. A public V1 should move to a managed database or a more explicit backup plan.
- Non-loopback startup fails closed without a strong `ADMIN_TOKEN`. Add reverse-proxy TLS and rate limiting before exposing the service publicly.
- Market value is still pending because FIFA does not provide official valuation data.
