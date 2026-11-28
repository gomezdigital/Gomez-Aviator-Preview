import { fetchGameData365Live } from "../providers/gamedata365.js";

const collectorUrl = (process.env.COLLECTOR_URL || "").replace(/\/$/, "");
const ingestToken = process.env.INGEST_API_TOKEN || "";
const allowedSources = new Set((process.env.ALLOWED_SOURCES || "").split(",").map((s) => s.trim().toLowerCase()));

if (!collectorUrl) throw new Error("COLLECTOR_URL is required.");
if (!ingestToken) throw new Error("INGEST_API_TOKEN is required.");
if (!allowedSources.has("gamedata365")) throw new Error('Add "gamedata365" to ALLOWED_SOURCES on the collector.');

try {
  // One provider request per scheduled run. The endpoint returns only the
  // latest completed round per game, so intervals between polls can be missed.
  const result = await fetchGameData365Live();
  const aviator = result.rounds.filter((round) => round.game === "aviator");

  if (aviator.length === 0) {
    console.log(JSON.stringify({
      status: "no-fresh-aviator-round",
      providerServerTime: result.serverTime,
      skipped: result.skipped,
      note: "No fresh Aviator round was returned; nothing was ingested."
    }, null, 2));
    process.exit(0);
  }

  const response = await fetch(`${collectorUrl}/api/v1/ingest`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ingestToken}`
    },
    body: JSON.stringify({
      source: "gamedata365",
      rounds: aviator.map(({ game, roundId, multiplier, endedAt }) => ({ game, roundId, multiplier, endedAt }))
    }),
    signal: AbortSignal.timeout(60000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Collector ingest failed with HTTP ${response.status}: ${body.error || "unknown error"}`);

  console.log(JSON.stringify({
    status: "live-poll-complete",
    provider: result.provider,
    providerServerTime: result.serverTime,
    observedRounds: aviator.map(({ roundId, multiplier, endedAt }) => ({ roundId, multiplier, endedAt })),
    accepted: body.accepted,
    duplicates: body.duplicates,
    note: "This is a low-frequency latest-round poll, not a continuous stream. Rounds between polls may be missed."
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    status: "live-poll-failed",
    message: error.message,
    httpStatus: error.statusCode ?? null
  }, null, 2));
  process.exitCode = 1;
}
