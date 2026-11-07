/**
 * Data-quality diagnostics for recorded crash-game rounds.
 * Checks structural consistency and collection freshness; it cannot verify
 * that a provider's reported round is authentic or complete.
 */
const GAMES = new Set(["aviator", "high-flyer", "jetx"]);
const DEFAULT_STALE_MINUTES = 10;

export function assessDataQuality(input, {
  game = "",
  source = "",
  now = Date.now(),
  staleAfterMinutes = DEFAULT_STALE_MINUTES
} = {}) {
  const rows = Array.isArray(input) ? input : [];
  const staleMs = (Number.isFinite(staleAfterMinutes) && staleAfterMinutes > 0
    ? staleAfterMinutes : DEFAULT_STALE_MINUTES) * 60_000;
  const seen = new Set();
  const issues = [];
  const valid = [];
  const counts = {
    received: rows.length,
    malformed: 0,
    unsupportedGame: 0,
    invalidMultiplier: 0,
    invalidTimestamp: 0,
    futureTimestamp: 0,
    duplicates: 0,
    outOfOrder: 0
  };

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      counts.malformed += 1;
      issues.push({ code: "MALFORMED_RECORD", index, severity: "error" });
      continue;
    }
    if ((game && row.game !== game) || (source && row.source !== source)) continue;

    if (!GAMES.has(row.game)) {
      counts.unsupportedGame += 1;
      issues.push({ code: "UNSUPPORTED_GAME", index, severity: "error" });
      continue;
    }
    const multiplier = Number(row.multiplier);
    if (!Number.isFinite(multiplier) || multiplier < 1 || multiplier > 100000000) {
      counts.invalidMultiplier += 1;
      issues.push({ code: "INVALID_MULTIPLIER", index, severity: "error" });
      continue;
    }
    const timestamp = Date.parse(row.endedAt);
    if (!row.endedAt || !Number.isFinite(timestamp)) {
      counts.invalidTimestamp += 1;
      issues.push({ code: "INVALID_TIMESTAMP", index, severity: "error" });
      continue;
    }
    if (timestamp > now + 5 * 60_000) {
      counts.futureTimestamp += 1;
      issues.push({ code: "FUTURE_TIMESTAMP", index, severity: "error" });
      continue;
    }
    const key = [row.source || "", row.game, String(row.roundId ?? "")].join("::");
    if (!row.roundId || seen.has(key)) {
      counts.duplicates += 1;
      issues.push({ code: "DUPLICATE_OR_MISSING_ROUND_ID", index, severity: "warning" });
      continue;
    }
    seen.add(key);
    valid.push({ index, timestamp, endedAt: new Date(timestamp).toISOString(), multiplier, row });
  }

  let previousTime = -Infinity;
  for (const item of valid) {
    if (item.timestamp < previousTime) {
      counts.outOfOrder += 1;
      issues.push({ code: "OUT_OF_ORDER_TIMESTAMP", index: item.index, severity: "warning" });
    }
    previousTime = Math.max(previousTime, item.timestamp);
  }

  const newest = valid.reduce((best, item) => Math.max(best, item.timestamp), 0);
  const ageMs = newest ? Math.max(0, now - newest) : null;
  const freshness = newest === 0 ? "NO_VALID_DATA" : ageMs > staleMs ? "STALE" : "FRESH";
  if (freshness === "STALE") {
    issues.push({ code: "DATA_STALE", severity: "warning", ageMinutes: Number((ageMs / 60_000).toFixed(1)) });
  }
  const errorCount = issues.filter((item) => item.severity === "error").length;
  const warningCount = issues.filter((item) => item.severity === "warning").length;

  return {
    game: game || null,
    source: source || null,
    status: errorCount ? "ISSUES_FOUND" : warningCount ? "WARNINGS" : valid.length ? "HEALTHY" : "NO_VALID_DATA",
    counts: { ...counts, valid: valid.length, errors: errorCount, warnings: warningCount },
    freshness: {
      status: freshness,
      latestRoundAt: newest ? new Date(newest).toISOString() : null,
      ageMinutes: ageMs === null ? null : Number((ageMs / 60_000).toFixed(1)),
      staleAfterMinutes: staleMs / 60_000
    },
    issues,
    limitations: "Quality checks assess record structure, consistency and freshness only. They cannot prove provider authenticity, completeness or a live connection.",
    liveFeedVerified: false
  };
}
