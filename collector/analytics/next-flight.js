const MIN_SAMPLE = 30;
const MAX_SAMPLE = 200;
const BUCKETS = [
  { key: "below2x", label: "1.00x–1.99x", min: 1, max: 2 },
  { key: "from2xTo5x", label: "2.00x–4.99x", min: 2, max: 5 },
  { key: "from5xTo10x", label: "5.00x–9.99x", min: 5, max: 10 },
  { key: "atLeast10x", label: "10.00x+", min: 10, max: null }
];

export function buildNextFlightEstimate(input, {
  asOfAt = new Date().toISOString(),
  maxFreshnessSeconds = 120,
  minSample = MIN_SAMPLE,
  maxSample = MAX_SAMPLE
} = {}) {
  const rows = (Array.isArray(input) ? input : [])
    .filter((r) => r && Number.isFinite(Number(r.multiplier)) &&
      Number(r.multiplier) >= 1 && Number.isFinite(Date.parse(r.endedAt)))
    .sort((a, b) => Date.parse(a.endedAt) - Date.parse(b.endedAt));
  const latest = rows.at(-1);
  if (!latest) return { status: "unavailable", reason: "NO_OBSERVATIONS", message: "No valid completed rounds are available." };

  const asOfMs = Date.parse(asOfAt);
  const latestMs = Date.parse(latest.endedAt);
  const freshnessSeconds = Math.floor((asOfMs - latestMs) / 1000);
  if (!Number.isFinite(asOfMs) || freshnessSeconds < 0) {
    return { status: "unavailable", reason: "CLOCK_INVALID", message: "The observation clock is invalid; no estimate was created." };
  }
  if (freshnessSeconds > maxFreshnessSeconds) {
    return {
      status: "unavailable", reason: "STALE_DATA",
      message: "The latest stored round is " + freshnessSeconds + " seconds old. Refresh the authorized feed before estimating the next flight.",
      asOfAt, dataCutoffRoundId: String(latest.roundId), dataCutoffEndedAt: latest.endedAt,
      dataFreshnessSeconds: freshnessSeconds, sampleSize: Math.min(rows.length, maxSample)
    };
  }

  const sample = rows.slice(-Math.min(maxSample, rows.length));
  if (sample.length < minSample) {
    return {
      status: "unavailable", reason: "INSUFFICIENT_SAMPLE",
      message: "At least " + minSample + " recent completed rounds are required; only " + sample.length + " are available.",
      asOfAt, dataCutoffRoundId: String(latest.roundId), dataCutoffEndedAt: latest.endedAt,
      dataFreshnessSeconds: freshnessSeconds, sampleSize: sample.length
    };
  }

  const counts = Object.fromEntries(BUCKETS.map((b) => [b.key, 0]));
  for (const row of sample) {
    const value = Number(row.multiplier);
    const bucket = BUCKETS.find((b) => value >= b.min && (b.max === null || value < b.max));
    if (bucket) counts[bucket.key] += 1;
  }
  // Laplace smoothing avoids reporting a zero-probability bucket from a small sample.
  const denominator = sample.length + BUCKETS.length;
  const probabilities = BUCKETS.map((bucket) => ({
    ...bucket,
    observedCount: counts[bucket.key],
    probability: Number(((counts[bucket.key] + 1) / denominator).toFixed(4))
  }));
  const mostLikely = [...probabilities].sort((a, b) => b.probability - a.probability)[0];
  return {
    status: "estimate_available",
    reason: null,
    asOfAt,
    displayTimezone: "Africa/Gaborone",
    target: "FIRST_OBSERVED_FLIGHT_AFTER_AS_OF_TIME",
    dataCutoffRoundId: String(latest.roundId),
    dataCutoffEndedAt: latest.endedAt,
    dataFreshnessSeconds: freshnessSeconds,
    sampleSize: sample.length,
    modelVersion: "empirical-buckets-laplace-v1",
    probabilities,
    mostLikelyRange: mostLikely.label,
    mostLikelyProbability: mostLikely.probability,
    warning: "These are smoothed historical frequencies, not a reliable prediction of an independent random flight. The next flight outcome is not knowable from this sample."
  };
}
