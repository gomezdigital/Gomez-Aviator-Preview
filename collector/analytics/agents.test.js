import test from "node:test";
import assert from "node:assert/strict";
import { buildAgentReport } from "./agents.js";

function rounds(game, count) {
  return Array.from({ length: count }, (_, i) => ({
    game, source: "gamedata365", roundId: game + "-" + i,
    multiplier: 1.5 + (i % 5),
    endedAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()
  }));
}

test("coordinator returns explicit insufficient-data report for empty storage", () => {
  const report = buildAgentReport([]);
  assert.equal(report.status, "INSUFFICIENT_DATA");
  assert.deepEqual(report.missingData, ["aviator"]);
  assert.equal(report.predictive, false);
  assert.equal(report.liveFeedVerified, false);
});

test("game agents analyse only their own game's stored records", () => {
  const report = buildAgentReport([...rounds("aviator", 30), ...rounds("jetx", 10)]);
  const aviator = report.agents.gameAgents.find((agent) => agent.game === "aviator");
  assert.equal(aviator.historicalAnalysis.sampleSize, 30);
  assert.equal(report.agents.gameAgents.length, 1);
  assert.deepEqual(report.summary.gamesAnalysed, ["aviator"]);
  assert.equal(report.predictive, false);
});

test("pattern agent reviews Aviator history without cross-game comparisons", () => {
  const report = buildAgentReport(rounds("aviator", 5));
  assert.equal(report.agents.patternAnalysisAgent.status, "AVIATOR_HISTORICAL_REVIEW");
  assert.deepEqual(report.agents.patternAnalysisAgent.gamesCompared, ["aviator"]);
});

test("game filter returns only the requested agent", () => {
  const report = buildAgentReport(rounds("aviator", 8), { game: "aviator" });
  assert.deepEqual(report.summary.gamesAnalysed, ["aviator"]);
  assert.equal(report.agents.gameAgents.length, 1);
});
