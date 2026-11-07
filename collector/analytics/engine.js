/**
 * Descriptive analytics for completed crash-game rounds.
 * This module summarizes observed history; it does not predict future rounds
 * or generate betting instructions.
 */
const SUPPORTED_GAMES = new Set(["aviator", "high-flyer", "jetx"]);

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function analyzeRounds(input, { game = "", source = "", limit = 500 } = {}) {
  const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 500) : 500;
  const rows = (Array.isArray(input) ? input : [])
    .filter((row) =>
      row && typeof row === "object" &&
      (!game || row.game === game) &&
      (!source || row.source === source) &&
      SUPPORTED_GAMES.has(row.game) &&
      Number.isFinite(Number(row.multiplier)) &&
      Number(row.multiplier) >= 1 &&
      Number.isFinite(Date.parse(row.endedAt))
    )
    .sort((a, b) => Date.parse(a.endedAt) - Date.parse(b.endedAt))
    .slice(-safeLimit);

  const values = rows.map((row) => Number(row.multiplier));
  const count = values.length;
  if (!count) {
    return {
      game: game || null, source: source || null, sampleSize: 0,
      message: "No valid completed-round records are available for this filter.",
      predictive: false
    };
  }

  const sum = values.reduce((total, value) => total + value, 0);
  const buckets = {
    below2x: values.filter((value) => value < 2).length,
    from2xTo5x: values.filter((value) => value >= 2 && value < 5).length,
    from5xTo10x: values.filter((value) => value >= 5 && value < 10).length,
    atLeast10x: values.filter((value) => value >= 10).length
  };
  const recent = values.slice(-20);
  const recentAverage = recent.reduce((total, value) => total + value, 0) / recent.length;
  const last = rows[rows.length - 1];

  return {
    game: game || null,
    source: source || null,
    sampleSize: count,
    observedFrom: rows[0].endedAt,
    observedThrough: last.endedAt,
    multiplier: {
      mean: Number((sum / count).toFixed(4)),
      median: Number(median(values).toFixed(4)),
      minimum: Math.min(...values),
      maximum: Math.max(...values),
      recent20Mean: Number(recentAverage.toFixed(4))
    },
    distribution: Object.fromEntries(
      Object.entries(buckets).map(([key, value]) => [
        key,
        { count: value, percentage: Number(((value / count) * 100).toFixed(2)) }
      ])
    ),
    latestRound: {
      roundId: String(last.roundId),
      multiplier: Number(last.multiplier),
      endedAt: last.endedAt
    },
    interpretation: "Descriptive statistics of recorded past rounds only; not a forecast or betting signal.",
    predictive: false
  };
}
