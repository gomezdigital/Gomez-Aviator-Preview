import { fetchGameData365History } from "../providers/gamedata365.js";

const collectorUrl = (process.env.COLLECTOR_URL || "").replace(/\/$/, "");
const ingestToken = process.env.INGEST_API_TOKEN || "";
const allowedSources = new Set((process.env.ALLOWED_SOURCES || "").split(",").map((s) => s.trim().toLowerCase()));
if (!collectorUrl) throw new Error("COLLECTOR_URL is required.");
if (!ingestToken) throw new Error("INGEST_API_TOKEN is required.");
if (!allowedSources.has("gamedata365")) throw new Error('Add "gamedata365" to ALLOWED_SOURCES on the collector before running this sync.');

// A single history request retrieves recent completed Aviator rounds. Repeated
// syncs are idempotent because storage deduplicates source/game/round_id.
const history = await fetchGameData365History({ game: "aviator", limit: 500 });
if (history.rounds.length === 0) {
  console.log(JSON.stringify({ status: "no-valid-aviator-history", skipped: history.skipped, historySpins: history.historySpins }, null, 2));
  process.exit(0);
}
const response = await fetch(`${collectorUrl}/api/v1/ingest`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${ingestToken}` },
  body: JSON.stringify({ source: "gamedata365", rounds: history.rounds.slice(0, 500).map(({ game, roundId, multiplier, endedAt }) => ({ game, roundId, multiplier, endedAt })) }),
  signal: AbortSignal.timeout(60000)
});
const body = await response.json().catch(() => ({}));
if (!response.ok) throw new Error(`Collector ingest failed with HTTP ${response.status}: ${body.error || "unknown error"}`);
console.log(JSON.stringify({
  status: "history-sync-complete", provider: history.provider, game: "aviator",
  roundsReturned: history.rounds.length,
  gapMarkers: history.skipped.filter((item) => item.reason === "PROVIDER_HISTORY_GAP").length,
  invalidRecordsSkipped: history.skipped.filter((item) => item.reason !== "PROVIDER_HISTORY_GAP").length,
  historySpinsAvailable: history.historySpins, nextCursorAvailable: Boolean(history.nextCursor), ingest: body
}, null, 2));
