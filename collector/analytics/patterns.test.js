import test from "node:test";
import assert from "node:assert/strict";
import { analyzePatterns } from "./patterns.js";

function rounds(values) {
  return values.map((multiplier, index) => ({
    game: "aviator", source: "gamedata365", roundId: "r" + index,
    multiplier, endedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString()
  }));
}

test("pattern analysis exposes distribution, transitions, runs and high-multiplier spacing", () => {
  const result = analyzePatterns(rounds([1.2, 1.5, 2.2, 1.8, 6, 11, 1.4, 10.5, 1.3, 2.4, 1.6, 5.5, 12, 1.7, 3.1]), {
    recentSize: 5, baselineSize: 10, minimumTransitionCount: 1
  });
  assert.equal(result.sampleSize, 15);
  assert.equal(result.status, "ANALYSIS_AVAILABLE");
  assert.equal(result.predictive, false);
  assert.equal(result.overallDistribution.reduce((sum, item) => sum + item.count, 0), 15);
  assert.equal(result.transitions.length, 4);
  assert.equal(result.runs.find((item) => item.bucket === "below2x").longestRun, 2);
  assert.deepEqual(result.highMultiplierSpacing.intervalsInObservedRounds, [2, 2]);
});

test("transition rates are conditional on the observed previous category", () => {
  const result = analyzePatterns(rounds([1.1, 1.2, 1.3, 2.1, 1.4, 2.2, 1.5]), {
    recentSize: 5, baselineSize: 2, minimumTransitionCount: 1
  });
  const low = result.transitions.find((item) => item.from === "below2x");
  assert.equal(low.totalTransitions, 4);
  assert.equal(low.outcomes.reduce((sum, item) => sum + item.count, 0), 4);
  assert.ok(low.outcomes.every((item) => item.rate === null || (item.rate >= 0 && item.rate <= 1)));
});

test("duplicate round IDs and malformed observations are excluded", () => {
  const input = [
    ...rounds([1.2, 2.2, 3.2]),
    { ...rounds([9])[0], roundId: "r1", multiplier: 99 },
    { game: "aviator", source: "gamedata365", roundId: "bad", multiplier: "NaN", endedAt: "invalid" }
  ];
  const result = analyzePatterns(input, { recentSize: 5, baselineSize: 10 });
  assert.equal(result.sampleSize, 3);
});

test("insufficient data is explicitly labelled and does not invent a baseline", () => {
  const result = analyzePatterns(rounds([1.2, 1.3, 1.4]), { recentSize: 5, baselineSize: 10 });
  assert.equal(result.status, "INSUFFICIENT_DATA");
  assert.equal(result.baselineWindow.actualSize, 0);
  assert.ok(result.distributionChanges.every((item) => item.status === "insufficient-baseline"));
});

test("source and game filters are applied", () => {
  const input = [
    ...rounds([1.2, 1.3, 1.4]),
    { ...rounds([99])[0], game: "jetx", source: "other" }
  ];
  const result = analyzePatterns(input, { game: "aviator", source: "gamedata365", recentSize: 5 });
  assert.equal(result.sampleSize, 3);
});
