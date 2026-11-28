import { fetchGameData365History } from "../providers/gamedata365.js";

const history = await fetchGameData365History({ game: "aviator", limit: 500 });
const gaps = history.skipped.filter((item) => item.reason === "PROVIDER_HISTORY_GAP");
const invalid = history.skipped.filter((item) => item.reason !== "PROVIDER_HISTORY_GAP");

console.log(JSON.stringify({
  status: history.rounds.length > 0 ? "history-data-received" : "history-empty",
  provider: history.provider,
  game: history.game,
  providerServerTime: history.serverTime,
  roundsReturned: history.rounds.length,
  historySpinsAvailable: history.historySpins,
  nextCursorAvailable: Boolean(history.nextCursor),
  gapMarkers: gaps.length,
  invalidRecordsSkipped: invalid.length,
  sampleRounds: history.rounds.slice(0, 5).map(({ roundId, multiplier, endedAt }) => ({ roundId, multiplier, endedAt })),
  gaps: gaps.slice(0, 5)
}, null, 2));
