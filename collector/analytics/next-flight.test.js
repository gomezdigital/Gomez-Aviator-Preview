import test from "node:test";
import assert from "node:assert/strict";
import { buildNextFlightEstimate } from "./next-flight.js";

function rows(count = 40, endedAt = "2026-11-22T10:00:00.000Z") {
  return Array.from({ length: count }, (_, i) => ({
    roundId: String(i + 1),
    multiplier: i % 4 === 0 ? 1.5 : i % 4 === 1 ? 2.5 : i % 4 === 2 ? 6 : 12,
    endedAt: new Date(Date.parse(endedAt) - (count - i - 1) * 1000).toISOString()
  }));
}

test("next-flight estimate records an as-of time and empirical bucket probabilities", () => {
  const asOfAt = "2026-11-22T10:00:30.000Z";
  const result = buildNextFlightEstimate(rows(), { asOfAt });
  assert.equal(result.status, "estimate_available");
  assert.equal(result.asOfAt, asOfAt);
  assert.equal(result.displayTimezone, "Africa/Gaborone");
  assert.equal(result.target, "FIRST_OBSERVED_FLIGHT_AFTER_AS_OF_TIME");
  assert.equal(result.sampleSize, 40);
  assert.equal(result.probabilities.length, 4);
  assert.ok(Math.abs(result.probabilities.reduce((sum, p) => sum + p.probability, 0) - 1) < 0.0001);
  assert.match(result.warning, /not a reliable prediction/);
});

test("stale data never produces a next-flight estimate", () => {
  const result = buildNextFlightEstimate(rows(), { asOfAt: "2026-11-22T10:05:00.000Z" });
  assert.equal(result.status, "unavailable");
  assert.equal(result.reason, "STALE_DATA");
});

test("insufficient sample never produces a next-flight estimate", () => {
  const result = buildNextFlightEstimate(rows(12), { asOfAt: "2026-11-22T10:00:30.000Z" });
  assert.equal(result.status, "unavailable");
  assert.equal(result.reason, "INSUFFICIENT_SAMPLE");
});

test("future-dated rounds are excluded from the prediction data cutoff", () => {
  const asOfAt = "2026-11-22T10:00:30.000Z";
  const input = [
    ...rows(),
    { roundId: "future-round", multiplier: 99, endedAt: "2026-11-22T10:00:31.000Z" }
  ];
  const result = buildNextFlightEstimate(input, { asOfAt });
  assert.equal(result.status, "estimate_available");
  assert.notEqual(result.dataCutoffRoundId, "future-round");
  assert.ok(Date.parse(result.dataCutoffEndedAt) <= Date.parse(asOfAt));
});
