/**
 * Multi-agent retrospective analysis coordinator.
 * Agents analyse stored completed rounds only; no agent predicts outcomes.
 */
import { analyzeRounds } from "./engine.js";
import { analyzeIntelligence } from "./intelligence.js";
import { assessDataQuality } from "./quality.js";

const GAMES = ["aviator"];

function gameAgent(records, game, source) {
  const analysis = analyzeRounds(records, { game, source, limit: 500 });
  const intelligence = analyzeIntelligence(records, { game, source });
  const quality = assessDataQuality(records, { game, source });
  const enoughRecent = intelligence.status !== "INSUFFICIENT_DATA";
  return {
    agent: `${game.replace(/(^|-)([a-z])/g, (_, dash, letter) => letter.toUpperCase())}Agent`,
    game,
    status: analysis.sampleSize ? "OBSERVATIONS_AVAILABLE" : "INSUFFICIENT_DATA",
    observations: analysis.sampleSize ? [{
      code: "HISTORICAL_SAMPLE_SUMMARY",
      sampleSize: analysis.sampleSize,
      meanMultiplier: analysis.multiplier.mean,
      medianMultiplier: analysis.multiplier.median,
      latestRound: analysis.latestRound
    }] : [],
    historicalAnalysis: analysis,
    distributionIntelligence: intelligence,
    dataQuality: quality,
    confidence: {
      level: !analysis.sampleSize ? "NONE" : enoughRecent && quality.status === "HEALTHY" ? "LIMITED" : "LOW",
      basis: "Confidence describes data sufficiency and quality, not confidence about a future outcome."
    },
    predictive: false
  };
}

function patternAgent(gameReports) {
  const available = gameReports.filter((report) => report.historicalAnalysis.sampleSize > 0);
  return {
    agent: "PatternAnalysisAgent",
    status: available.length ? "AVIATOR_HISTORICAL_REVIEW" : "INSUFFICIENT_DATA",
    gamesCompared: available.map((report) => report.game),
    observations: available.length
      ? ["Reviewing Aviator historical distributions only. No cross-game comparison or future-outcome prediction is performed."]
      : ["Collect valid Aviator rounds before historical pattern review can begin."],
    comparisons: available.map((report) => ({
      game: report.game,
      sampleSize: report.historicalAnalysis.sampleSize,
      meanMultiplier: report.historicalAnalysis.multiplier.mean,
      medianMultiplier: report.historicalAnalysis.multiplier.median
    })),
    predictive: false
  };
}

export function buildAgentReport(input, { game = "", source = "" } = {}) {
  const selectedGames = game ? [game] : GAMES;
  const gameReports = selectedGames.map((item) => gameAgent(input, item, source));
  const pattern = patternAgent(gameReports);
  const validCount = gameReports.reduce((sum, report) => sum + report.historicalAnalysis.sampleSize, 0);
  const qualityIssues = gameReports.flatMap((report) => report.dataQuality.issues.map((issue) => ({
    game: report.game, ...issue
  })));
  const insufficient = gameReports.filter((report) => report.status === "INSUFFICIENT_DATA").map((report) => report.game);

  return {
    generatedAt: new Date().toISOString(),
    coordinator: "IntelligenceCoordinator",
    status: validCount ? (insufficient.length ? "PARTIAL_DATA" : "OBSERVATIONS_AVAILABLE") : "INSUFFICIENT_DATA",
    agents: {
      gameAgents: gameReports,
      patternAnalysisAgent: pattern,
      dataQualityAgent: {
        status: qualityIssues.length ? "ISSUES_OR_WARNINGS_PRESENT" : validCount ? "NO_REPORTED_ISSUES" : "NO_VALID_DATA",
        issues: qualityIssues,
        gamesWithoutSufficientData: insufficient,
        liveFeedVerified: false,
        role: "Checks recorded data structure, consistency and freshness; does not authenticate a provider."
      }
    },
    summary: {
      gamesAnalysed: selectedGames,
      validHistoricalRounds: validCount,
      insufficientDataGames: insufficient,
      keyLimitation: "The agents analyse stored historical records only. They do not observe live games, forecast future multipliers, or provide betting signals."
    },
    confidence: {
      level: validCount === 0 ? "NONE" : insufficient.length || qualityIssues.length ? "LOW" : "LIMITED",
      explanation: "This is a data-readiness assessment, not a probability estimate for the next round."
    },
    missingData: insufficient,
    predictive: false,
    liveFeedVerified: false
  };
}
