import test from "node:test";
import assert from "node:assert/strict";
import { analyzeIntelligence } from "./intelligence.js";

function makeRounds(count, multiplierFor, game = "aviator") {
  return Array.from({ length: count }, (_, index) => ({
    game, source: "gamedata365", roundId: `r${index}`,
    multiplier: multiplierFor(index),
    endedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString()
  }));
}

test("intelligence withholds comparisons when recent sample is too small", () => {
  const result = analyzeIntelligence(makeRounds(4, () => 1.5), { recentSize: 5, baselineSize: 20 });
  assert.equal(result.status, "INSUFFICIENT_DATA");
  assert.equal(result.predictive, false);
});

test("intelligence reports incomplete baseline without inventing a comparison", () => {
  const result = analyzeIntelligence(makeRounds(8, () => 1.8), { recentSize: 5, baselineSize: 20 });
  assert.equal(result.status, "BASELINE_INCOMPLETE");
  assert.ok(result.observations.some((item) => item.code === "BASELINE_INCOMPLETE"));
});

test("intelligence detects a descriptive shift between recent and baseline windows", () => {
  const rounds = makeRounds(30, (index) => index < 20 ? 1.4 : 8);
  const result = analyzeIntelligence(rounds, { recentSize: 10, baselineSize: 20 });
  assert.equal(result.status, "COMPARISON_AVAILABLE");
  assert.ok(result.observations.some((item) => item.code === "MEAN_SHIFT_OBSERVED"));
  assert.equal(result.predictive, false);
});

test("intelligence filters game and source and ignores malformed records", () => {
  const rounds = [
    ...makeRounds(30, () => 2),
    ...makeRounds(30, () => 50, "jetx"),
    { game: "aviator", source: "gamedata365", roundId: "bad", multiplier: "NaN", endedAt: "invalid" }
  ];
  const result = analyzeIntelligence(rounds, { game: "aviator", source: "gamedata365", recentSize: 5, baselineSize: 20 });
  assert.equal(result.sampleSize, 30);
});
