import { fetchGameData365Live } from "../providers/gamedata365.js";

try {
  const result = await fetchGameData365Live();
  console.log(JSON.stringify({
    status: result.liveFeedVerified ? "provider-data-received" : "connected-no-fresh-rounds",
    provider: result.provider,
    providerServerTime: result.serverTime,
    gamesReturned: result.rounds.length,
    rounds: result.rounds.map(({ game, roundId, multiplier, endedAt }) => ({
      game, roundId, multiplier, endedAt
    })),
    skipped: result.skipped
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    status: "provider-check-failed",
    message: error.message,
    httpStatus: error.statusCode ?? null
  }, null, 2));
  process.exitCode = 1;
}
