import test from "node:test";
import assert from "node:assert/strict";
import { createGameAdapter, normalizeGameRound, SUPPORTED_GAMES } from "./normalize.js";
import { getAdapter, listAdapters } from "./index.js";

const valid = { roundId: "demo-001", multiplier: 1.75, endedAt: "2026-10-14T12:00:00Z" };

test("supports the three planned game identifiers", () => {
  assert.deepEqual(SUPPORTED_GAMES, ["aviator", "high-flyer", "jetx"]);
});

test("normalizes a valid game round with provenance", () => {
  const result = normalizeGameRound("Aviator", valid, "provider-demo");
  assert.equal(result.record.game, "aviator");
  assert.equal(result.record.sourceName, "provider-demo");
  assert.equal(result.record.multiplier, 1.75);
  assert.equal(result.record.roundId, "demo-001");
  assert.equal(result.record.endedAt, new Date(valid.endedAt).toISOString());
});

test("accepts documented aliases id, crashPoint and timestamp", () => {
  const result = normalizeGameRound("jetx", {
    id: "jet-2", crashPoint: "2.25", timestamp: "2026-10-14T12:00:00Z"
  }, "sample");
  assert.equal(result.record.roundId, "jet-2");
  assert.equal(result.record.multiplier, 2.25);
});

test("rejects unsupported games and invalid multipliers", () => {
  assert.match(normalizeGameRound("unknown", valid, "x").error, /Unsupported game/);
  assert.match(normalizeGameRound("aviator", { ...valid, multiplier: 0.5 }, "x").error, /multiplier/);
});

test("rejects malformed timestamps and future timestamps", () => {
  assert.match(normalizeGameRound("aviator", { ...valid, endedAt: "bad" }, "x").error, /timestamp/);
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  assert.match(normalizeGameRound("aviator", { ...valid, endedAt: future }, "x").error, /future/);
});

test("adapter parser failures return a safe validation error", () => {
  const adapter = createGameAdapter({ game: "aviator", sourceName: "test", parseRound: () => { throw new Error("private"); } });
  assert.match(adapter.normalize({}).error, /parser rejected/);
});

test("registry advertises placeholders without claiming live connections", () => {
  assert.ok(getAdapter("aviator"));
  assert.equal(getAdapter("unknown"), null);
  assert.ok(listAdapters().every((item) => item.configured === false && item.liveFeedVerified === false));
});
