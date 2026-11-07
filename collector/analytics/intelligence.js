/**
 * Observational intelligence for recorded crash-game rounds.
 * Flags data-quality and historical-distribution changes only.
 * It does not predict future outcomes or provide betting signals.
 */
const GAMES = new Set(["aviator", "high-flyer", "jetx"]);
const DEFAULT_RECENT = 20;
const DEFAULT_BASELINE = 100;

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function validRounds(input, game, source) {
  return (Array.isArray(input) ? input : [])
    .filter((row) =>
      row && typeof row === "object" &&
      (!game || row.game === game) &&
      (!source || row.source === source) &&
      GAMES.has(row.game) &&
      Number.isFinite(Number(row.multiplier)) &&
      Number(row.multiplier) >= 1 &&
      Number.isFinite(Date.parse(row.endedAt))
    )
    .map((row) => ({ ...row, multiplier: Number(row.multiplier), time: Date.parse(row.endedAt) }))
    .sort((a, b) => a.time - b.time);
}

function summarize(rows) {
  if (!rows.length) return null;
  const values = rows.map((row) => row.multiplier);
  const logs = values.map(Math.log);
  const latest = rows[rows.length - 1];
  return {
    sampleSize: rows.length,
    meanMultiplier: Number(mean(values).toFixed(4)),
    medianMultiplier: Number((values.length % 2
      ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
      : (() => { const s = [...values].sort((a, b) => a - b); const m = s.length / 2; return (s[m - 1] + s[m]) / 2; })()).toFixed(4)),
    logMultiplierStdDev: Number(standardDeviation(logs).toFixed(4)),
    below2xRate: Number((values.filter((value) => value < 2).length / values.length).toFixed(4)),
    atLeast10xRate: Number((values.filter((value) => value >= 10).length / values.length).toFixed(4)),
    from: rows[0].endedAt,
    through: latest.endedAt
  };
}

export function analyzeIntelligence(input, {
  game = "",
  source = "",
  recentSize = DEFAULT_RECENT,
  baselineSize = DEFAULT_BASELINE
} = {}) {
  const recentCount = Number.isInteger(recentSize) ? Math.min(Math.max(recentSize, 5), 100) : DEFAULT_RECENT;
  const baselineCount = Number.isInteger(baselineSize) ? Math.min(Math.max(baselineSize, 20), 500) : DEFAULT_BASELINE;
  const rows = validRounds(input, game, source);
  const required = recentCount + baselineCount;

  if (rows.length < recentCount) {
    return {
      game: game || null, source: source || null, status: "INSUFFICIENT_DATA",
      sampleSize: rows.length, requiredForRecentWindow: recentCount,
      message: "Collect more valid completed rounds before evaluating a recent window.",
      observations: [], predictive: false
    };
  }

  const recentRows = rows.slice(-recentCount);
  const baselineRows = rows.slice(-(recentCount + baselineCount), -recentCount);
  const recent = summarize(recentRows);
  const baseline = summarize(baselineRows);
  const observations = [];

  if (baselineRows.length < baselineCount) {
    observations.push({
      code: "BASELINE_INCOMPLETE",
      severity: "info",
      message: `Only ${baselineRows.length} of ${baselineCount} baseline rounds are available; comparisons are withheld.`
    });
  } else {
    const meanChange = (recent.meanMultiplier - baseline.meanMultiplier) / Math.max(baseline.meanMultiplier, 0.0001);
    const lowRateChange = recent.below2xRate - baseline.below2xRate;
    const volatilityRatio = recent.logMultiplierStdDev / Math.max(baseline.logMultiplierStdDev, 0.0001);

    if (Math.abs(meanChange) >= 0.25) observations.push({
      code: "MEAN_SHIFT_OBSERVED", severity: "info",
      recentVsBaselinePercent: Number((meanChange * 100).toFixed(2)),
      message: "The recent-window mean differs materially from the selected historical baseline."
    });
    if (Math.abs(lowRateChange) >= 0.15) observations.push({
      code: "LOW_MULTIPLIER_RATE_SHIFT", severity: "info",
      percentagePointChange: Number((lowRateChange * 100).toFixed(2)),
      message: "The observed share of rounds below 2x has shifted versus the baseline."
    });
    if (volatilityRatio >= 1.5 || volatilityRatio <= 0.67) observations.push({
      code: "DISPERSION_SHIFT_OBSERVED", severity: "info",
      recentToBaselineRatio: Number(volatilityRatio.toFixed(3)),
      message: "Dispersion of log multipliers differs from the baseline."
    });
    if (!observations.length) observations.push({
      code: "NO_LARGE_SHIFT_DETECTED", severity: "info",
      message: "No configured large distribution shift was detected in these windows."
    });
  }

  return {
    game: game || null,
    source: source || null,
    status: baselineRows.length >= baselineCount ? "COMPARISON_AVAILABLE" : "BASELINE_INCOMPLETE",
    sampleSize: rows.length,
    windows: { recent, baseline },
    observations,
    interpretation: "These are retrospective comparisons of recorded rounds. They do not predict the next round or establish a betting edge.",
    predictive: false
  };
}
