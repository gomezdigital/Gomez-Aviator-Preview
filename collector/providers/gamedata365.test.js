import test from "node:test";
import assert from "node:assert/strict";
import { fetchGameData365Live } from "./gamedata365.js";

test("GameData365 adapter normalizes Aviator, High Flyer and JetX latest rounds", async () => {
  let requestedUrl;
  let requestedHeaders;
  const mockFetch = async (url, options) => {
    requestedUrl = url;
    requestedHeaders = options.headers;
    return new Response(JSON.stringify({
      status: "ok",
      server_time: "2026-11-05T10:00:00Z",
      games: [
        { game_id: "aviator", game_name: "Aviator", stale: false, latest: { round_id: "a-1", multiplier: 1.52, timestamp: "2026-11-05T09:59:59Z" } },
        { game_id: "high_flyer", game_name: "High Flyer", stale: false, latest: { round_id: "hf-1", multiplier: 2.1, timestamp: "2026-11-05T09:59:58Z" } },
        { game_id: "jetx", game_name: "JetX", stale: false, latest: { round_id: "j-1", multiplier: 3.4, timestamp: "2026-11-05T09:59:57Z" } }
      ]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await fetchGameData365Live({ apiKey: "test-secret", fetchImpl: mockFetch });
  assert.equal(requestedUrl, "https://api.gamedata365.com/v1/crash/live");
  assert.equal(requestedHeaders["X-API-Key"], "test-secret");
  assert.deepEqual(result.rounds.map((r) => r.game), ["aviator", "high-flyer", "jetx"]);
  assert.equal(result.rounds[0].roundId, "a-1");
  assert.equal(result.rounds[1].multiplier, 2.1);
});

test("GameData365 adapter skips stale and unmapped games", async () => {
  const mockFetch = async () => new Response(JSON.stringify({
    status: "ok",
    games: [
      { game_id: "aviator", stale: true, latest: { round_id: "old", multiplier: 1.2, timestamp: "2026-11-05T09:00:00Z" } },
      { game_id: "unknown_game", stale: false, latest: { round_id: "u-1", multiplier: 2, timestamp: "2026-11-05T09:00:00Z" } }
    ]
  }), { status: 200, headers: { "content-type": "application/json" } });
  const result = await fetchGameData365Live({ apiKey: "test-secret", fetchImpl: mockFetch });
  assert.equal(result.rounds.length, 0);
  assert.equal(result.skipped.length, 2);
});

test("GameData365 adapter requires API key and rejects provider errors", async () => {
  await assert.rejects(() => fetchGameData365Live({ apiKey: "" }), /API_KEY is required/);
  await assert.rejects(() => fetchGameData365Live({
    apiKey: "test-secret",
    fetchImpl: async () => new Response("{}", { status: 403 })
  }), /HTTP 403/);
});

test("GameData365 adapter skips invalid multipliers, timestamps and empty round IDs", async () => {
  const mockFetch = async () => new Response(JSON.stringify({
    status: "ok",
    games: [
      { game_id: "aviator", stale: false, latest: { round_id: "bad-m", multiplier: 0, timestamp: "2026-11-05T09:00:00Z" } },
      { game_id: "jetx", stale: false, latest: { round_id: "bad-t", multiplier: 2, timestamp: "not-a-date" } },
      { game_id: "high_flyer", stale: false, latest: { round_id: "  ", multiplier: 2, timestamp: "2026-11-05T09:00:00Z" } }
    ]
  }), { status: 200, headers: { "content-type": "application/json" } });
  const result = await fetchGameData365Live({ apiKey: "test-secret", fetchImpl: mockFetch });
  assert.equal(result.rounds.length, 0);
  assert.deepEqual(result.skipped.map((item) => item.reason), [
    "INVALID_MULTIPLIER", "INVALID_TIMESTAMP", "LATEST_ROUND_FIELDS_MISSING"
  ]);
});

