import test from "node:test";
import assert from "node:assert/strict";
import { fetchGameData365Live, fetchGameData365History } from "./gamedata365.js";

test("GameData365 live adapter normalizes fresh Aviator rounds and ignores unrelated games", async () => {
  let requestedUrl, requestedHeaders;
  const mockFetch = async (url, options) => {
    requestedUrl = url; requestedHeaders = options.headers;
    return new Response(JSON.stringify({ status: "ok", server_time: "2026-11-05T10:00:00Z", games: [
      { game_id: "aviator", game_name: "Aviator", provider: "spribe", stale: false, latest: { round_id: "a-1", multiplier: 1.52, timestamp: "2026-11-05T09:59:59Z" } },
      { game_id: "lucky_jet", game_name: "Lucky Jet", provider: "other", stale: false, latest: { round_id: "lj-1", multiplier: 2.1, timestamp: "2026-11-05T09:59:58Z" } }
    ] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await fetchGameData365Live({ apiKey: "test-secret", fetchImpl: mockFetch });
  assert.equal(requestedUrl, "https://api.gamedata365.com/v1/crash/live");
  assert.equal(requestedHeaders["X-API-Key"], "test-secret");
  assert.deepEqual(result.rounds.map((r) => r.game), ["aviator"]);
  assert.equal(result.rounds[0].roundId, "a-1");
  assert.equal(result.liveFeedVerified, true);
});
test("GameData365 live adapter skips stale and unmapped games", async () => {
  const mockFetch = async () => new Response(JSON.stringify({ status: "ok", games: [
    { game_id: "aviator", stale: true, latest: { round_id: "old", multiplier: 1.2, timestamp: "2026-11-05T09:00:00Z" } },
    { game_id: "unknown_game", stale: false, latest: { round_id: "u-1", multiplier: 2, timestamp: "2026-11-05T09:00:00Z" } }
  ] }), { status: 200, headers: { "content-type": "application/json" } });
  const result = await fetchGameData365Live({ apiKey: "test-secret", fetchImpl: mockFetch });
  assert.equal(result.rounds.length, 0); assert.equal(result.skipped.length, 2); assert.equal(result.liveFeedVerified, false);
});
test("GameData365 history adapter fetches Aviator rounds and preserves gap metadata", async () => {
  let requestedUrl, requestedHeaders;
  const mockFetch = async (url, options) => {
    requestedUrl = url; requestedHeaders = options.headers;
    return new Response(JSON.stringify({ status: "ok", game_id: "aviator", count: 2, history_spins: 50, next_cursor: "next-page", rounds: [
      { round_id: "aviator-1", multiplier: 1.27, timestamp: "2026-11-19 13:04:08", backfilled: false },
      { type: "gap", from: "2026-11-19T13:03:00Z", to: "2026-11-19T13:03:20Z", estimated_missing: 2, recovered: false },
      { round_id: "aviator-2", multiplier: 4.86, timestamp: "2026-11-19T13:04:07Z", backfilled: true }
    ] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await fetchGameData365History({ apiKey: "test-secret", limit: 200, cursor: "previous", fetchImpl: mockFetch });
  assert.match(requestedUrl, /\/v1\/crash\/history\?game=aviator&limit=200&cursor=previous/);
  assert.equal(requestedHeaders["X-API-Key"], "test-secret");
  assert.equal(result.rounds.length, 2);
  assert.equal(result.rounds[0].endedAt, "2026-11-19T13:04:08.000Z");
  assert.equal(result.rounds[1].backfilled, true);
  assert.equal(result.skipped[0].reason, "PROVIDER_HISTORY_GAP");
  assert.equal(result.nextCursor, "next-page"); assert.equal(result.historySpins, 50);
});
test("GameData365 history adapter rejects unsupported games and malformed responses", async () => {
  await assert.rejects(() => fetchGameData365History({ apiKey: "test-secret", game: "jetx" }), /Aviator history only/);
  await assert.rejects(() => fetchGameData365History({ apiKey: "" }), /API_KEY is required/);
  await assert.rejects(() => fetchGameData365History({ apiKey: "test-secret", fetchImpl: async () => new Response("{}", { status: 200 }) }), /unexpected crash-history response/);
});
test("GameData365 errors never echo API key values", async () => {
  await assert.rejects(() => fetchGameData365Live({ apiKey: "test-secret", fetchImpl: async () => new Response("{}", { status: 403 }) }),
    (error) => error.statusCode === 403 && !error.message.includes("test-secret"));
});
