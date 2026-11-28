import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://supabase.example.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-secret";

const calls = [];
globalThis.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), options });
  if (options.method === "POST") {
    return new Response(JSON.stringify([{
      source: "gamedata365",
      game: "aviator",
      round_id: "round-1",
      multiplier: "2.5",
      ended_at: "2026-11-19T10:00:00.000Z",
      received_at: "2026-11-19T10:01:00.000Z"
    }]), { status: 201, headers: { "content-type": "application/json" } });
  }
  if (String(url).includes("limit=1")) {
    return new Response("[]", { status: 200 });
  }
  if (options.headers?.range === "0-999") {
    return new Response(JSON.stringify([{
      source: "gamedata365",
      game: "aviator",
      round_id: "round-1",
      multiplier: "2.5",
      ended_at: "2026-11-19T10:00:00.000Z",
      received_at: "2026-11-19T10:01:00.000Z"
    }]), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response("[]", { status: 200 });
};

const storage = await import("./storage.js");

test("Supabase health check uses server-side service credentials", async () => {
  const health = await storage.checkStorage();
  assert.deepEqual(health, { ok: true, mode: "supabase", persistent: true });
  assert.equal(calls[0].options.headers.apikey, "test-service-role-secret");
  assert.equal(calls[0].options.headers.authorization, "Bearer test-service-role-secret");
});

test("Supabase reads are normalized and paginated", async () => {
  const rows = await storage.readAllRecords();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].roundId, "round-1");
  assert.equal(rows[0].multiplier, 2.5);
  assert.equal(rows[0].game, "aviator");
  assert.ok(calls.some(call => call.options.headers?.range === "0-999"));
});

test("Supabase writes use the unique source/game/round key and ignore duplicates", async () => {
  const records = [
    { source: "gamedata365", game: "aviator", roundId: "round-1", multiplier: 2.5, endedAt: "2026-11-19T10:00:00.000Z", receivedAt: "2026-11-19T10:01:00.000Z" },
    { source: "gamedata365", game: "aviator", roundId: "round-2", multiplier: 3.1, endedAt: "2026-11-19T10:02:00.000Z", receivedAt: "2026-11-19T10:03:00.000Z" }
  ];
  const result = await storage.persistUniqueRecords("gamedata365", records);
  assert.deepEqual(result, { accepted: 1, duplicates: 1 });
  const write = calls.find(call => call.options.method === "POST");
  assert.match(write.url, /on_conflict=source,game,round_id/);
  assert.match(write.options.headers.prefer, /resolution=ignore-duplicates/);
  assert.equal(JSON.parse(write.options.body)[0].round_id, "round-1");
});
