import test from "node:test";
import assert from "node:assert/strict";
import { assessDataQuality } from "./quality.js";

const now = Date.parse("2026-11-06T12:00:00Z");
function row(id, overrides = {}) {
  return {
    game: "aviator", source: "gamedata365", roundId: id,
    multiplier: 1.8, endedAt: "2026-11-06T11:59:00Z", ...overrides
  };
}

test("quality report marks valid recent records healthy", () => {
  const result = assessDataQuality([row("a"), row("b")], { now });
  assert.equal(result.status, "HEALTHY");
  assert.equal(result.counts.valid, 2);
  assert.equal(result.freshness.status, "FRESH");
});

test("quality report identifies malformed, unsupported and invalid values", () => {
  const result = assessDataQuality([
    null, row("bad-game", { game: "unknown" }),
    row("bad-multiplier", { multiplier: 0.5 }),
    row("bad-time", { endedAt: "not-a-date" })
  ], { now });
  assert.equal(result.counts.malformed, 1);
  assert.equal(result.counts.unsupportedGame, 1);
  assert.equal(result.counts.invalidMultiplier, 1);
  assert.equal(result.counts.invalidTimestamp, 1);
  assert.equal(result.status, "ISSUES_FOUND");
});

test("quality report detects duplicate keys and future timestamps", () => {
  const result = assessDataQuality([
    row("same"), row("same"),
    row("future", { endedAt: "2026-11-06T13:00:00Z" })
  ], { now });
  assert.equal(result.counts.duplicates, 1);
  assert.equal(result.counts.futureTimestamp, 1);
});

test("quality report detects stale and out-of-order records", () => {
  const result = assessDataQuality([
    row("new", { endedAt: "2026-11-06T11:30:00Z" }),
    row("old", { endedAt: "2026-11-06T11:00:00Z" })
  ], { now });
  assert.equal(result.counts.outOfOrder, 1);
  assert.equal(result.freshness.status, "STALE");
});

test("quality report respects game and source filters", () => {
  const result = assessDataQuality([
    row("a"), row("j1", { game: "jetx" }), row("b", { source: "manual" })
  ], { now, game: "aviator", source: "gamedata365" });
  assert.equal(result.counts.received, 3);
  assert.equal(result.counts.valid, 1);
});
