import test from "node:test";
import assert from "node:assert/strict";
import { analyzeRounds } from "./engine.js";

const rounds = [
  { game: "aviator", source: "gamedata365", roundId: "r1", multiplier: 1.5, endedAt: "2026-11-06T10:00:00Z" },
  { game: "aviator", source: "gamedata365", roundId: "r2", multiplier: 2, endedAt: "2026-11-06T10:01:00Z" },
  { game: "aviator", source: "gamedata365", roundId: "r3", multiplier: 10, endedAt: "2026-11-06T10:02:00Z" },
  { game: "jetx", source: "gamedata365", roundId: "j1", multiplier: 3, endedAt: "2026-11-06T10:03:00Z" }
];

test("analytics summarizes only the selected game's recorded rounds", () => {
  const result = analyzeRounds(rounds, { game: "aviator", source: "gamedata365" });
  assert.equal(result.sampleSize, 3);
  assert.equal(result.multiplier.mean, 4.5);
  assert.equal(result.multiplier.median, 2);
  assert.equal(result.distribution.below2x.count, 1);
  assert.equal(result.distribution.atLeast10x.count, 1);
  assert.equal(result.latestRound.roundId, "r3");
  assert.equal(result.predictive, false);
});

test("analytics reports empty history without inventing results", () => {
  const result = analyzeRounds([], { game: "jetx" });
  assert.equal(result.sampleSize, 0);
  assert.equal(result.predictive, false);
});

test("analytics caps requested sample and excludes malformed records", () => {
  const result = analyzeRounds([...rounds, { game: "aviator", roundId: "bad", multiplier: "NaN", endedAt: "bad" }], { limit: 2 });
  assert.equal(result.sampleSize, 2);
});
