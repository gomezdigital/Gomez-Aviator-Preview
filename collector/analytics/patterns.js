/**
 * Pattern research over recorded crash-game rounds.
 * Detects descriptive sequences and distribution changes only.
 * It does not predict future outcomes or produce betting signals.
 */
const GAMES = new Set(["aviator", "high-flyer", "jetx"]);
const BUCKETS = [
  { id: "below2x", label: "1.00x–1.99x", test: (value) => value < 2 },
  { id: "from2xTo5x", label: "2.00x–4.99x", test: (value) => value >= 2 && value < 5 },
  { id: "from5xTo10x", label: "5.00x–9.99x", test: (value) => value >= 5 && value < 10 },
  { id: "atLeast10x", label: "10.00x+", test: (value) => value >= 10 }
];

function bucketFor(value) {
  return BUCKETS.find((bucket) => bucket.test(value)) || null;
}

function wilsonInterval(successes, total, z = 1.96) {
  if (!total) return { lower: null, upper: null };
  const p = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total) / denominator;
  return {
    lower: Number(Math.max(0, center - margin).toFixed(4)),
    upper: Number(Math.min(1, center + margin).toFixed(4))
  };
}

function validRounds(input, game, source) {
  const seen = new Set();
  return (Array.isArray(input) ? input : [])
    .filter((row) => row && typeof row === "object" && !Array.isArray(row))
    .filter((row) => (!game || row.game === game) && (!source || row.source === source))
    .map((row) => {
      const multiplier = Number(row.multiplier);
      const timestamp = Date.parse(row.endedAt ?? row.timestamp ?? "");
      const roundId = String(row.roundId ?? row.round_id ?? "").trim();
      return { row, multiplier, timestamp, roundId };
    })
    .filter((item) => GAMES.has(item.row.game) &&
      Number.isFinite(item.multiplier) && item.multiplier >= 1 && item.multiplier <= 100000000 &&
      Number.isFinite(item.timestamp))
    .filter((item) => {
      const key = item.roundId
        ? [item.row.source || "", item.row.game, item.roundId].join("::")
        : [item.row.source || "", item.row.game, item.timestamp, item.multiplier].join("::");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((item) => ({
      game: item.row.game,
      source: item.row.source || "",
      roundId: item.roundId || null,
      multiplier: item.multiplier,
      endedAt: new Date(item.timestamp).toISOString(),
      bucket: bucketFor(item.multiplier).id
    }));
}

function summarizeBuckets(rows) {
  const total = rows.length;
  return BUCKETS.map((bucket) => {
    const count = rows.filter((row) => row.bucket === bucket.id).length;
    const interval = wilsonInterval(count, total);
    return {
      id: bucket.id, label: bucket.label, count,
      rate: total ? Number((count / total).toFixed(4)) : null,
      confidenceInterval95: interval
    };
  });
}

function transitionProfile(rows) {
  const matrix = BUCKETS.map((from) => {
    const outcomes = BUCKETS.map((to) => ({ id: to.id, label: to.label, count: 0 }));
    let total = 0;
    for (let index = 1; index < rows.length; index += 1) {
      if (rows[index - 1].bucket !== from.id) continue;
      const target = outcomes.find((item) => item.id === rows[index].bucket);
      target.count += 1;
      total += 1;
    }
    return {
      from: from.id,
      fromLabel: from.label,
      totalTransitions: total,
      outcomes: outcomes.map((item) => ({
        ...item,
        rate: total ? Number((item.count / total).toFixed(4)) : null,
        confidenceInterval95: wilsonInterval(item.count, total)
      }))
    };
  });
  return matrix;
}

function runProfile(rows) {
  const runs = [];
  for (const bucket of BUCKETS) {
    const lengths = [];
    let current = 0;
    rows.forEach((row) => {
      if (row.bucket === bucket.id) current += 1;
      else if (current) { lengths.push(current); current = 0; }
    });
    if (current) lengths.push(current);
    const latest = rows.length && rows[rows.length - 1].bucket === bucket.id
      ? lengths[lengths.length - 1] : 0;
    runs.push({
      bucket: bucket.id,
      label: bucket.label,
      runCount: lengths.length,
      longestRun: lengths.length ? Math.max(...lengths) : 0,
      averageRunLength: lengths.length
        ? Number((lengths.reduce((sum, length) => sum + length, 0) / lengths.length).toFixed(2)) : 0,
      latestRunLength: latest,
      observedRunLengths: lengths
    });
  }
  return runs;
}

function spacingProfile(rows) {
  const events = rows.filter((row) => row.multiplier >= 10);
  const positions = events.map((event) => rows.indexOf(event));
  const intervals = positions.slice(1).map((position, index) => position - positions[index]);
  const sorted = [...intervals].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const medianGap = !sorted.length ? null : sorted.length % 2
    ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return {
    eventCount: events.length,
    intervalsInObservedRounds: intervals,
    medianIntervalInObservedRounds: medianGap,
    warning: "Intervals describe the supplied observed sequence; missed provider rounds can distort spacing."
  };
}

export function analyzePatterns(input, {
  game = "aviator",
  source = "",
  recentSize = 20,
  baselineSize = 50,
  minimumTransitionCount = 5
} = {}) {
  const recentCount = Number.isInteger(recentSize) ? Math.min(Math.max(recentSize, 5), 200) : 20;
  const baselineCount = Number.isInteger(baselineSize) ? Math.min(Math.max(baselineSize, 10), 500) : 50;
  const minTransitions = Number.isInteger(minimumTransitionCount)
    ? Math.min(Math.max(minimumTransitionCount, 1), 100) : 5;
  const rows = validRounds(input, game, source);
  const recentRows = rows.slice(-recentCount);
  const baselineRows = rows.slice(-(recentCount + baselineCount), -recentCount);
  const recentBuckets = summarizeBuckets(recentRows);
  const baselineBuckets = summarizeBuckets(baselineRows);
  const distributionChanges = recentBuckets.map((recent) => {
    const baseline = baselineBuckets.find((item) => item.id === recent.id);
    const difference = recent.rate === null || baseline.rate === null
      ? null : Number((recent.rate - baseline.rate).toFixed(4));
    return {
      bucket: recent.id, label: recent.label,
      recentCount: recent.count, recentRate: recent.rate,
      baselineCount: baseline.count, baselineRate: baseline.rate,
      percentagePointDifference: difference === null ? null : Number((difference * 100).toFixed(2)),
      status: difference === null ? "insufficient-baseline"
        : Math.abs(difference) >= 0.15 ? "shift-observed" : "no-large-shift-observed"
    };
  });
  const transitions = transitionProfile(rows).map((item) => ({
    ...item,
    status: item.totalTransitions >= minTransitions ? "descriptive-sample-available" : "insufficient-transitions",
    outcomes: item.outcomes.map((outcome) => ({
      ...outcome,
      status: item.totalTransitions >= minTransitions ? "descriptive-sample-available" : "insufficient-transitions"
    }))
  }));
  const minimumRows = recentCount + baselineCount;
  return {
    game,
    source: source || null,
    status: rows.length < recentCount ? "INSUFFICIENT_DATA"
      : baselineRows.length < baselineCount ? "BASELINE_INCOMPLETE" : "ANALYSIS_AVAILABLE",
    sampleSize: rows.length,
    timeRange: rows.length ? { from: rows[0].endedAt, through: rows[rows.length - 1].endedAt } : null,
    bucketDefinitions: BUCKETS.map(({ id, label }) => ({ id, label })),
    overallDistribution: summarizeBuckets(rows),
    recentWindow: { requestedSize: recentCount, actualSize: recentRows.length, distribution: recentBuckets },
    baselineWindow: { requestedSize: baselineCount, actualSize: baselineRows.length, distribution: baselineBuckets },
    distributionChanges,
    transitions,
    runs: runProfile(rows),
    highMultiplierSpacing: spacingProfile(rows),
    sampleRequirements: {
      recentWindowComplete: recentRows.length === recentCount,
      baselineWindowComplete: baselineRows.length === baselineCount,
      recommendedMinimumForWindowComparison: minimumRows,
      minimumTransitionsForPerTransitionSummary: minTransitions
    },
    interpretation: "Retrospective pattern research only. Frequencies and sequences are descriptive, not evidence that a future round is predictable.",
    predictive: false
  };
}
