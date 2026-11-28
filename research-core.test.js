const test = require("node:test");
const assert = require("node:assert/strict");
require("./research-core.js");

const core = global.GomezResearchCore;
const sample = [
  { multiplier: 1.2, timestamp: "2026-01-01T00:00:00Z", round_id: "r1" },
  { multiplier: 2.4, timestamp: "2026-01-01T00:01:00Z", round_id: "r2" },
  { multiplier: 5.2, timestamp: "2026-01-01T00:02:00Z", round_id: "r3" },
  { multiplier: 1.8, timestamp: "2026-01-02T00:00:00Z", round_id: "r4" },
  { multiplier: 10.5, timestamp: "2026-02-01T00:00:00Z", round_id: "r5" }
];

test("research core exposes the expected public API", () => {
  for (const name of [
    "normalizeObservations", "auditDataset", "distributionProfile",
    "summarizeDataset", "compareDatasetSummaries", "timePeriodProfile",
    "stabilityProfile", "walkForwardComparison"
  ]) assert.equal(typeof core[name], "function", name);
});

test("normalization validates multipliers and preserves supplied order", () => {
  const result = core.normalizeObservations([
    { multiplier: "2.50x", timestamp: "2026-01-01T00:00:00Z" },
    { multiplier: "not-a-number" },
    { multiplier: 1.1, timestamp: null }
  ]);
  assert.equal(result.observations.length, 2);
  assert.equal(result.invalidRows, 1);
  assert.equal(result.observations[0].multiplier, 2.5);
  assert.equal(result.observations[1].timestamp, null);
});

test("audit reports missing, invalid, future, duplicate and out-of-order data", () => {
  const now = Date.parse("2026-01-03T00:00:00Z");
  const report = core.auditDataset([
    { multiplier: 2, timestamp: "2026-01-02T00:00:00Z", round_id: "same" },
    { multiplier: 2, timestamp: "2026-01-02T00:00:00Z", round_id: "same" },
    { multiplier: 3, timestamp: "invalid-date", round_id: "bad-time" },
    { multiplier: 4, timestamp: null, round_id: "missing-time" },
    { multiplier: 5, timestamp: "2026-01-01T00:00:00Z", round_id: "old" },
    { multiplier: 6, timestamp: "2026-01-04T00:00:00Z", round_id: "future" }
  ], 1, now);
  assert.equal(report.recordCount, 6);
  assert.equal(report.skippedRows, 1);
  assert.equal(report.missingTimestamps, 1);
  assert.equal(report.invalidTimestamps, 1);
  assert.equal(report.duplicateRecords, 1);
  assert.equal(report.orderInversions, 1);
  assert.equal(report.futureTimestamps, 1);
  assert.equal(report.duplicateRoundIds, 1);
  assert.ok(report.score >= 0 && report.score <= 100);
});

test("distribution profile partitions all valid records exactly once", () => {
  const result = core.distributionProfile(sample);
  assert.equal(result.recordCount, 5);
  assert.equal(result.bins.reduce((sum, bin) => sum + bin.count, 0), 5);
  assert.equal(result.bins[0].count, 2);
  assert.equal(result.bins[1].count, 1);
  assert.equal(result.bins[2].count, 1);
  assert.equal(result.bins[3].count, 1);
});

test("dataset summaries and comparisons use descriptive threshold rates", () => {
  const a = core.summarizeDataset(sample, { label: "A" });
  const b = core.summarizeDataset(sample.slice(1), { label: "B" });
  const comparison = core.compareDatasetSummaries(a, b);
  assert.equal(a.recordCount, 5);
  assert.equal(a.median, 2.4);
  assert.equal(comparison.firstLabel, "A");
  assert.equal(comparison.secondLabel, "B");
  assert.equal(comparison.recordCountDifference, -1);
  assert.equal(comparison.thresholdRateDifferences.length, 3);
});

test("time-period profile groups timestamped records by UTC period", () => {
  const result = core.timePeriodProfile(sample, "month");
  assert.equal(result.periodCount, 2);
  assert.equal(result.datedRecordCount, 5);
  assert.equal(result.periods[0].period, "2026-01");
  assert.equal(result.periods[0].recordCount, 4);
  assert.equal(result.periods[1].period, "2026-02");
  assert.throws(() => core.timePeriodProfile(sample, "year"), /Period must be/);
});

test("stability profile returns rolling windows or a clear insufficient state", () => {
  const short = core.stabilityProfile(sample, 10, 2);
  assert.equal(short.status, "insufficient-data");
  const long = core.stabilityProfile([...sample, ...sample, ...sample], 5, 5);
  assert.equal(long.status, "evaluated");
  assert.equal(long.windowCount, 3);
  assert.equal(long.windows[0].recordCount, 5);
  assert.equal(long.windows[0].thresholdRates.length, 3);
});

test("walk-forward comparison only scores observations after its initial history", () => {
  const data = Array.from({ length: 80 }, (_, index) => ({
    multiplier: index % 4 === 0 ? 2.5 : 1.4,
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString()
  }));
  const result = core.walkForwardComparison(data, 2, 3, 50);
  assert.equal(result.status, "evaluated");
  assert.equal(result.initialHistory, 50);
  assert.equal(result.scoredObservations, 30);
  assert.ok(result.baselineBrier >= 0 && result.baselineBrier <= 1);
  assert.ok(result.streakBrier >= 0 && result.streakBrier <= 1);
  assert.equal(core.walkForwardComparison(data.slice(0, 20), 2, 3, 50).status, "insufficient-data");
  assert.throws(() => core.walkForwardComparison(data, 1, 3, 50), /Target must be/);
});
