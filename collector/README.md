# Gomez Aviator Intelligence Collector

A source-neutral Node.js API for authorized crash-game observations. It validates and deduplicates records, exposes historical research endpoints, and can use Supabase PostgreSQL for persistent storage.

## Storage modes

- **Supabase (recommended for deployment):** set both `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Apply `supabase/migrations/202611190001_create_rounds.sql` first.
- **Local development:** leave both Supabase variables unset. Records are appended to `DATA_FILE` (default `collector/data/rounds.jsonl`). Ephemeral hosting filesystems are not durable; do not use local-file mode for production.

The service refuses a partial Supabase configuration. The service-role key is privileged: store it only as a backend environment secret. Never commit it, send it to the browser, or expose it in client-side JavaScript.

## Local run

Requires Node.js 20 or newer.

```sh
npm test
npm start
```

Set `INGEST_API_TOKEN` to a long random secret before enabling ingestion. Keep `ALLOWED_SOURCES` empty until a source is documented and authorized. `CORS_ORIGINS` should contain only the exact preview/deployment origins that need browser access.

## API

- `GET /health` — service and storage mode; does not claim a provider feed is live.
- `GET /api/v1/sources` — per-source record counts and latest timestamps.
- `GET /api/v1/rounds?game=aviator&limit=100` — most recent observations.
- `GET /api/v1/analysis?game=aviator`
- `GET /api/v1/quality?game=aviator`
- `GET /api/v1/intelligence?game=aviator`
- `GET /api/v1/agents/report?game=aviator`
- `POST /api/v1/ingest` — requires `Authorization: Bearer <INGEST_API_TOKEN>` and an explicitly allowlisted source.

Example ingest body:

```json
{
  "source": "gamedata365",
  "rounds": [
    {
      "game": "aviator",
      "roundId": "provider-round-123",
      "multiplier": 2.35,
      "endedAt": "2026-11-19T10:30:00.000Z"
    }
  ]
}
```

The collector records observations supplied by an authorized source; it does not independently authenticate provider payloads or establish that a feed is live. Do not scrape betting sites or bypass access controls. Do not use these statistics as guaranteed future predictions or betting instructions.


## GameData365 Aviator integration

The provider adapter uses the documented HTTPS API at `https://api.gamedata365.com`:

- `GET /v1/crash/live` — latest completed round per crash game; used by the probe.
- `GET /v1/crash/history?game=aviator&limit=500` — newest Aviator history page; the sync script imports valid rounds and reports provider gap markers.
- Authentication is sent only in the `X-API-Key` request header using the backend-only `GAMEDATA365_API_KEY` environment variable.

Set `GAMEDATA365_API_KEY` only in Render's Environment settings. Never put it in the repository, frontend, chat, screenshots, or logs. The sync command also needs `COLLECTOR_URL`, `INGEST_API_TOKEN`, and `ALLOWED_SOURCES=gamedata365`. Run `npm run probe:gamedata365` to verify the live endpoint without storing records; run `npm run sync:gamedata365` to import the newest available history page. Both commands make provider API requests and consume plan quota.

The free provider key is documented as 200 requests/month with only the newest 50 rounds. This is suitable for a connectivity check and small test import, not reliable continuous capture. A 5-minute polling schedule would use about 8,640 requests/month before retries, so do not enable that schedule on the free plan. Render free web services can sleep; a sleeping service does not provide continuous background polling. Use an explicitly selected provider plan and an always-running/scheduled execution option before promising continuous collection. Provider history gap markers are surfaced in sync output; the collector does not invent missing rounds.

## Render deployment

A starter Blueprint is in `render.yaml` at the repository root. Review the service and environment settings before creating it. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in Render's secret environment settings. Leave `ALLOWED_SOURCES` empty until the provider is ready and authorized. Render free web services may sleep and are not suitable for guaranteed continuous collection; confirm current plan limits before relying on scheduled ingestion.
