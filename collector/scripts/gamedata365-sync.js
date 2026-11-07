import { fetchGameData365Live } from "../providers/gamedata365.js";

const collectorUrl = (process.env.COLLECTOR_URL || "").replace(/\/$/, "");
const ingestToken = process.env.INGEST_API_TOKEN || "";
const allowedSources = new Set((process.env.ALLOWED_SOURCES || "").split(",").map((s) => s.trim().toLowerCase()));

if (!collectorUrl) throw new Error("COLLECTOR_URL is required.");
if (!ingestToken) throw new Error("INGEST_API_TOKEN is required.");
if (!allowedSources.has("gamedata365")) {
  throw new Error('Add "gamedata365" to ALLOWED_SOURCES on the collector before running this sync.');
}

const providerResult = await fetchGameData365Live();
const result = { ...providerResult, rounds: providerResult.rounds.filter((round) => round.game === "aviator") };
const ignoredOtherGames = providerResult.rounds.length - result.rounds.length;
if (result.rounds.length === 0) {
  console.log(JSON.stringify({ status: "no-fresh-aviator-round", skipped: result.skipped, ignoredOtherGames, serverTime: result.serverTime }));
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
    rounds: result.rounds.map(({ game, roundId, multiplier, endedAt }) => ({ game, roundId, multiplier, endedAt }))
  }),
  signal: AbortSignal.timeout(15000)
});

const body = await response.json().catch(() => ({}));
if (!response.ok) {
  throw new Error(`Collector ingest failed with HTTP ${response.status}: ${body.error || "unknown error"}`);
}
console.log(JSON.stringify({
  status: "sync-complete",
  provider: result.provider,
  gameFocus: "aviator",
  latestAviatorRoundsFound: result.rounds.length,
  ignoredOtherGames,
  skipped: result.skipped,
  ingest: body,
  providerServerTime: result.serverTime
}, null, 2));
