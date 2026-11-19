/* Gomez Aviator Intelligence — browser research core.
 * Descriptive statistics and chronological evaluation only.
 * This module never forecasts an individual future crash or recommends bets.
 */
(function (root) {
  "use strict";

  const LIMITS = { multiplier: 100000000, observations: 10000 };
  const THRESHOLDS = [2, 5, 10];

  function finiteMultiplier(value) {
    const number = typeof value === "string"
      ? Number(value.trim().replace(/,/g, "").replace(/[×x]$/i, ""))
      : Number(value);
    return Number.isFinite(number) && number >= 1 && number <= LIMITS.multiplier
      ? number : null;
  }

  function timestampOf(value) {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const numeric = /^\d{10,13}$/.test(String(value).trim()) ? Number(value) : null;
    const parsed = numeric !== null
      ? (String(value).trim().length === 10 ? numeric * 1000 : numeric)
      : Date.parse(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function quantile(values, probability) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const position = (sorted.length - 1) * probability;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
  }

  function validRows(input) {
    return (Array.isArray(input) ? input : [])
      .slice(0, LIMITS.observations)
      .map((row, index) => {
        const multiplier = finiteMultiplier(row && row.multiplier);
        if (multiplier === null) return null;
        const rawTime = row.timestamp ?? row.endedAt ?? row.datetime ?? null;
        const timestamp = timestampOf(rawTime);
        return {
          multiplier,
          timestamp: timestamp === null || Number.isNaN(timestamp) ? null : timestamp,
          timestampInvalid: timestamp !== null && Number.isNaN(timestamp),
          roundId: String(row.roundId ?? row.round_id ?? row.round ?? "").trim(),
          index
        };
      })
      .filter(Boolean);
  }

  function normalizeObservations(input) {
    const source = Array.isArray(input) ? input : [];
    const observations = [];
    let invalidRows = 0;
    source.slice(0, LIMITS.observations).forEach((row) => {
      const multiplier = finiteMultiplier(row && row.multiplier);
      if (multiplier === null) {
        invalidRows += 1;
        return;
      }
      const rawTime = row.timestamp ?? row.endedAt ?? row.datetime ?? null;
      const timestamp = timestampOf(rawTime);
      observations.push({
        multiplier,
        timestamp: timestamp === null || Number.isNaN(timestamp) ? null : timestamp,
        roundId: String(row.roundId ?? row.round_id ?? row.round ?? "").trim()
      });
    });
    return {
      observations,
      invalidRows,
      warning: invalidRows
        ? invalidRows + " invalid observation(s) were excluded; supplied row order was preserved."
        : "Valid observations normalized; supplied row order was preserved."
    };
  }

  function auditDataset(input, skippedRows = 0, now = Date.now()) {
    const rows = Array.isArray(input) ? input.slice(0, LIMITS.observations) : [];
    const skipped = Number.isFinite(Number(skippedRows)) ? Math.max(0, Math.floor(Number(skippedRows))) : 0;
    const seenPairs = new Set();
    const seenIds = new Set();
    let missingTimestamps = 0;
    let invalidTimestamps = 0;
    let duplicateRecords = 0;
    let orderInversions = 0;
    let futureTimestamps = 0;
    let duplicateRoundIds = 0;
    let previousTimestamp = null;

    rows.forEach((row) => {
      const rawTime = row && (row.timestamp ?? row.endedAt ?? row.datetime);
      const parsedTime = timestampOf(rawTime);
      if (rawTime === null || rawTime === undefined || String(rawTime).trim() === "") {
        missingTimestamps += 1;
      } else if (Number.isNaN(parsedTime)) {
        invalidTimestamps += 1;
      } else {
        if (parsedTime > now + 5 * 60 * 1000) futureTimestamps += 1;
        if (previousTimestamp !== null && parsedTime < previousTimestamp) orderInversions += 1;
        previousTimestamp = parsedTime;
        const multiplier = finiteMultiplier(row && row.multiplier);
        if (multiplier !== null) {
          const pair = parsedTime + "|" + multiplier;
          if (seenPairs.has(pair)) duplicateRecords += 1;
          seenPairs.add(pair);
        }
      }
      const id = String(row && (row.roundId ?? row.round_id ?? row.round) || "").trim();
      if (id) {
        if (seenIds.has(id)) duplicateRoundIds += 1;
        seenIds.add(id);
      }
    });

    const timestamped = rows.length - missingTimestamps - invalidTimestamps;
    const timestampCoverage = rows.length ? timestamped / rows.length : 0;
    const penalty = missingTimestamps * 0.5 + invalidTimestamps * 3 +
      futureTimestamps * 4 + duplicateRecords * 2 + orderInversions * 1.5 +
      duplicateRoundIds * 2 + skipped * 0.5;
    const score = rows.length ? Math.max(0, Math.min(100, Math.round(100 - penalty / rows.length * 10))) : 0;
    const issues = [];
    if (missingTimestamps) issues.push(missingTimestamps + " record(s) have no timestamp.");
    if (invalidTimestamps) issues.push(invalidTimestamps + " timestamp(s) are invalid.");
    if (futureTimestamps) issues.push(futureTimestamps + " timestamp(s) are materially in the future.");
    if (duplicateRecords) issues.push(duplicateRecords + " repeated timestamp/multiplier pair(s) found.");
    if (orderInversions) issues.push(orderInversions + " timestamp order inversion(s) found.");
    if (duplicateRoundIds) issues.push(duplicateRoundIds + " duplicate round ID(s) found.");
    if (skipped) issues.push(skipped + " row(s) were skipped during import.");

    return {
      recordCount: rows.length, skippedRows: skipped, missingTimestamps, invalidTimestamps,
      duplicateRecords, orderInversions, futureTimestamps, duplicateRoundIds,
      timestampCoverage, score,
      status: !rows.length ? "no-data" : score >= 90 ? "good" : score >= 70 ? "review" : "poor",
      warning: issues.length ? issues.join(" ") : "No configured data-quality flags were detected.",
      issues
    };
  }

  function distributionProfile(input) {
    const rows = validRows(input);
    const bins = [
      { label: "Below 2×", min: 1, max: 2, includeMax: false },
      { label: "2× to below 5×", min: 2, max: 5, includeMax: false },
      { label: "5× to below 10×", min: 5, max: 10, includeMax: false },
      { label: "10× and above", min: 10, max: Infinity, includeMax: true }
    ].map((bin) => {
      const count = rows.filter((row) => row.multiplier >= bin.min &&
        (bin.includeMax ? row.multiplier <= bin.max : row.multiplier < bin.max)).length;
      return { label: bin.label, count, rate: rows.length ? count / rows.length : 0 };
    });
    return {
      recordCount: rows.length,
      bins,
      warning: "Observed sample shares only. They are not calibrated probabilities for a future round."
    };
  }

  function summarizeDataset(input, { label = "Dataset", source = "Unspecified", skippedRows = 0 } = {}) {
    const rows = validRows(input);
    const values = rows.map((row) => row.multiplier);
    const sum = values.reduce((total, value) => total + value, 0);
    const audit = auditDataset(input, skippedRows);
    const thresholds = THRESHOLDS.map((threshold) => {
      const count = values.filter((value) => value >= threshold).length;
      return { threshold, count, rate: values.length ? count / values.length : 0 };
    });
    const dates = rows.map((row) => row.timestamp).filter((value) => value !== null);
    return {
      label, source, recordCount: values.length,
      mean: values.length ? sum / values.length : 0,
      median: median(values) ?? 0,
      minimum: values.length ? Math.min(...values) : 0,
      maximum: values.length ? Math.max(...values) : 0,
      quartiles: { q1: quantile(values, 0.25) ?? 0, q3: quantile(values, 0.75) ?? 0 },
      thresholds,
      timestampCoverage: audit.timestampCoverage,
      dateRange: dates.length ? {
        from: new Date(Math.min(...dates)).toISOString(),
        through: new Date(Math.max(...dates)).toISOString()
      } : null,
      qualityScore: audit.score,
      qualityStatus: audit.status,
      skippedRows: audit.skippedRows,
      warning: "Descriptive summary of supplied observations; source authenticity and future outcomes are not established."
    };
  }

  function compareDatasetSummaries(first, second) {
    const a = first || {};
    const b = second || {};
    const aRates = new Map((a.thresholds || []).map((item) => [Number(item.threshold), Number(item.rate) || 0]));
    const bRates = new Map((b.thresholds || []).map((item) => [Number(item.threshold), Number(item.rate) || 0]));
    return {
      firstLabel: String(a.label || "Dataset A"),
      secondLabel: String(b.label || "Dataset B"),
      medianDifference: (Number(b.median) || 0) - (Number(a.median) || 0),
      meanDifference: (Number(b.mean) || 0) - (Number(a.mean) || 0),
      recordCountDifference: (Number(b.recordCount) || 0) - (Number(a.recordCount) || 0),
      thresholdRateDifferences: THRESHOLDS.map((threshold) => ({
        threshold, difference: (bRates.get(threshold) || 0) - (aRates.get(threshold) || 0)
      })),
      warning: "Differences are descriptive. Sampling, source, time period and data quality may explain them; they do not imply a causal or predictive effect."
    };
  }

  function periodKey(timestamp, period) {
    const date = new Date(timestamp);
    const pad = (value) => String(value).padStart(2, "0");
    if (period === "day") return date.toISOString().slice(0, 10);
    if (period === "hour") return date.toISOString().slice(0, 13) + ":00Z";
    if (period === "week") {
      const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
      const weekday = day.getUTCDay() || 7;
      day.setUTCDate(day.getUTCDate() - weekday + 1);
      return day.toISOString().slice(0, 10);
    }
    return date.getUTCFullYear() + "-" + pad(date.getUTCMonth() + 1);
  }

  function timePeriodProfile(input, period = "month") {
    if (!["hour", "day", "week", "month"].includes(period)) throw new Error("Period must be hour, day, week, or month.");
    const rows = validRows(input);
    const groups = new Map();
    let missingTimestamps = 0;
    rows.forEach((row) => {
      if (row.timestamp === null) { missingTimestamps += 1; return; }
      const key = periodKey(row.timestamp, period);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row.multiplier);
    });
    const periods = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, values]) => ({
      period: key,
      recordCount: values.length,
      mean: values.reduce((sum, value) => sum + value, 0) / values.length,
      median: median(values),
      minimum: Math.min(...values),
      maximum: Math.max(...values),
      thresholds: THRESHOLDS.map((threshold) => {
        const count = values.filter((value) => value >= threshold).length;
        return { threshold, count, rate: count / values.length };
      })
    }));
    return {
      period, datedRecordCount: rows.length - missingTimestamps,
      missingTimestamps, periodCount: periods.length, periods,
      warning: "UTC calendar grouping of recorded observations only; it does not predict future outcomes."
    };
  }

  function stabilityProfile(input, windowSize = 100, stepSize = 25) {
    const rows = validRows(input);
    const size = Number.isInteger(windowSize) ? Math.max(2, Math.min(windowSize, LIMITS.observations)) : 100;
    const step = Number.isInteger(stepSize) ? Math.max(1, Math.min(stepSize, size)) : 25;
    if (rows.length < size) {
      return { status: "insufficient-data", recordCount: rows.length, requiredRecords: size, windowSize: size, stepSize: step, windowCount: 0, windows: [], warning: "Collect more observations for a rolling descriptive comparison." };
    }
    const windows = [];
    for (let start = 0; start + size <= rows.length; start += step) {
      const values = rows.slice(start, start + size).map((row) => row.multiplier);
      windows.push({
        startIndex: start, endIndex: start + size - 1, recordCount: values.length,
        mean: values.reduce((sum, value) => sum + value, 0) / values.length,
        median: median(values),
        thresholdRates: THRESHOLDS.map((threshold) => {
          const count = values.filter((value) => value >= threshold).length;
          return { threshold, count, rate: count / values.length };
        })
      });
    }
    return {
      status: "evaluated", recordCount: rows.length, requiredRecords: size,
      windowSize: size, stepSize: step, windowCount: windows.length, windows,
      warning: "Overlapping rolling windows are not independent and describe past samples only."
    };
  }

  function brierScore(outcomes, probabilities) {
    return outcomes.reduce((sum, outcome, index) => sum + (probabilities[index] - outcome) ** 2, 0) / outcomes.length;
  }

  function walkForwardComparison(input, threshold, streakLength, minimumHistory = 50) {
    const rows = validRows(input);
    const target = Number(threshold);
    const streak = Number(streakLength);
    const initialHistory = Math.max(Number.isInteger(minimumHistory) ? minimumHistory : 50, streak + 2);
    if (!Number.isFinite(target) || target <= 1 || !Number.isInteger(streak) || streak < 1 || streak > 100) {
      throw new Error("Target must be above 1 and streak length must be a whole number from 1 to 100.");
    }
    if (rows.length <= initialHistory) {
      return { status: "insufficient-data", available: rows.length, requiredHistory: initialHistory + 1, initialHistory, scoredObservations: 0, warning: "No forecasts were scored because the initial history requirement was not met." };
    }
    const outcomes = [];
    const baseline = [];
    const conditional = [];
    for (let index = initialHistory; index < rows.length; index += 1) {
      const history = rows.slice(0, index).map((row) => row.multiplier >= target ? 1 : 0);
      const hits = history.reduce((sum, value) => sum + value, 0);
      const baseRate = (hits + 1) / (history.length + 2);
      const preceding = history.slice(-streak);
      const hasLowStreak = preceding.length === streak && preceding.every((value) => value === 0);
      let forecast = baseRate;
      if (hasLowStreak) {
        const conditionalOutcomes = [];
        for (let j = streak; j < history.length; j += 1) {
          if (history.slice(j - streak, j).every((value) => value === 0)) conditionalOutcomes.push(history[j]);
        }
        const conditionalHits = conditionalOutcomes.reduce((sum, value) => sum + value, 0);
        forecast = (conditionalHits + 1) / (conditionalOutcomes.length + 2);
      }
      outcomes.push(rows[index].multiplier >= target ? 1 : 0);
      baseline.push(baseRate);
      conditional.push(forecast);
    }
    const baselineBrier = brierScore(outcomes, baseline);
    const streakBrier = brierScore(outcomes, conditional);
    const comparison = streakBrier < baselineBrier - 1e-12 ? "streak-lower-brier"
      : baselineBrier < streakBrier - 1e-12 ? "baseline-lower-brier" : "tie";
    return {
      status: "evaluated", available: rows.length, requiredHistory: initialHistory + 1,
      initialHistory, scoredObservations: outcomes.length,
      baselineBrier, streakBrier, comparison,
      warning: "Chronological walk-forward research only. Probabilities are estimated from prior rows; results do not establish a repeatable edge or predict the next round."
    };
  }

  root.GomezResearchCore = Object.freeze({
    normalizeObservations, auditDataset, distributionProfile, summarizeDataset,
    compareDatasetSummaries, timePeriodProfile, stabilityProfile, walkForwardComparison
  });
})(typeof window !== "undefined" ? window : globalThis);
