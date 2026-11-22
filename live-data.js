(() => {
  "use strict";

  const API = "https://gomez-aviator-collector.onrender.com";
  const $ = (id) => document.getElementById(id);
  const set = (id, value) => { const node = $(id); if (node) node.textContent = String(value); };
  const DISPLAY_TIME_ZONE = "Africa/Gaborone";
  const formatTime = (value) => {
    if (!value) return "Not available";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Not available";
    const formatted = new Intl.DateTimeFormat("en-GB", {
      timeZone: DISPLAY_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).format(date);
    return formatted + " CAT";
  };
  async function get(path) {
    const response = await fetch(API + path, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(60000)
    });
    if (!response.ok) throw new Error("Collector returned HTTP " + response.status + " for " + path);
    return response.json();
  }
  function renderRounds(rows) {
    const host = $("live-round-list");
    if (!host) return;
    host.replaceChildren();
    rows.slice(0, 10).forEach((round) => {
      const item = document.createElement("div");
      item.className = "live-round-item";
      const time = document.createElement("small");
      time.textContent = formatTime(round.endedAt);
      const value = document.createElement("strong");
      const multiplier = Number(round.multiplier);
      value.textContent = Number.isFinite(multiplier) ? multiplier.toFixed(2) + "x" : "—";
      if (multiplier >= 5) value.classList.add("high");
      item.append(time, value);
      host.appendChild(item);
    });
    if (!rows.length) {
      const empty = document.createElement("p");
      empty.className = "panel-copy";
      empty.textContent = "No stored GameData365 Aviator rounds yet.";
      host.appendChild(empty);
    }
  }
  async function refresh() {
    const button = $("refresh-live-data");
    if (button) { button.disabled = true; button.textContent = "Refreshing…"; }
    set("live-data-message", "Contacting collector and reading stored records…");
    try {
      const [health, sources, roundsResponse, analysisResponse, qualityResponse, intelligenceResponse] = await Promise.all([
        get("/health"),
        get("/api/v1/sources"),
        get("/api/v1/rounds?game=aviator&source=gamedata365&limit=500"),
        get("/api/v1/analysis?game=aviator&source=gamedata365&limit=500"),
        get("/api/v1/quality?game=aviator&source=gamedata365"),
        get("/api/v1/intelligence?game=aviator&source=gamedata365")
      ]);
      const source = (sources.sources || []).find((item) => item.source === "gamedata365");
      const rows = Array.isArray(roundsResponse.rounds) ? roundsResponse.rounds : [];
      const analysis = analysisResponse.analysis || {};
      const quality = qualityResponse.quality || {};
      const intelligence = intelligenceResponse.intelligence || {};

      set("collector-status", health.ok ? "ONLINE" : "UNAVAILABLE");
      set("storage-status", health.storage && health.storage.ok && health.storage.persistent ? "SUPABASE · PERSISTENT" : (health.storageMode || "NOT VERIFIED"));
      set("provider-record-count", source ? source.records : 0);
      set("provider-latest-round", source && source.lastRoundAt ? formatTime(source.lastRoundAt) : "No records stored");
      set("provider-ingestion-status", source && source.allowedForIngestion ? "ENABLED" : "DISABLED");
      set("provider-status", source && source.records > 0 ? "RECORDS AVAILABLE" : "AWAITING FIRST SYNC");
      set("live-analysis-status", analysis.sampleSize ? "HISTORICAL ANALYSIS" : "NO DATA");
      set("live-analysis-count", analysis.sampleSize || 0);
      set("live-analysis-mean", analysis.multiplier ? Number(analysis.multiplier.mean).toFixed(4) + "x" : "—");
      set("live-analysis-median", analysis.multiplier ? Number(analysis.multiplier.median).toFixed(4) + "x" : "—");
      const bins = analysis.distribution || {};
      const low = bins.below2x;
      const mid = bins.from2xTo5x;
      set("live-analysis-2x", low && analysis.sampleSize ? (100 * (1 - low.count / analysis.sampleSize)).toFixed(2) + "%" : "—");
      set("live-analysis-5x", analysis.sampleSize
        ? (100 * (((bins.from5xTo10x?.count || 0) + (bins.atLeast10x?.count || 0)) / analysis.sampleSize)).toFixed(2) + "%"
        : "—");
      set("live-analysis-quality", quality.status ? quality.status + " · " + (quality.freshness?.status || "FRESHNESS UNKNOWN") : "—");
      if (intelligence.status === "COMPARISON_AVAILABLE" && intelligence.windows) {
        const recent = intelligence.windows.recent;
        const baseline = intelligence.windows.baseline;
        set("live-intelligence-output",
          "Recent " + recent.sampleSize + "-round window: mean " + recent.meanMultiplier.toFixed(3) +
          "x, median " + recent.medianMultiplier.toFixed(3) + "x. Prior baseline: mean " +
          baseline.meanMultiplier.toFixed(3) + "x, median " + baseline.medianMultiplier.toFixed(3) +
          "x. " + (intelligence.observations || []).map((item) => item.message).join(" "));
      } else {
        set("live-intelligence-output", intelligence.message || "More stored rounds are required for a recent-window versus baseline comparison.");
      }
      renderRounds(rows);
      try {
        const response = await get("/api/v1/prediction/next?game=aviator&source=gamedata365");
        const estimate = response.prediction || {};
        set("next-flight-range", estimate.mostLikelyRange || "—");
        set("next-flight-status", estimate.status === "estimate_available" ? "Historical estimate · not certainty" : "Estimate unavailable");
        set("next-flight-message", estimate.message || estimate.warning || "No estimate available.");
        set("next-flight-asof", estimate.asOfAt ? "As of " + formatTime(estimate.asOfAt) : "No estimate recorded");
        set("next-flight-evidence", estimate.status === "estimate_available"
          ? "Sample: " + estimate.sampleSize + " rounds · Most frequent historical band: " +
            (100 * estimate.mostLikelyProbability).toFixed(1) + "% smoothed frequency · Freshness: " +
            estimate.dataFreshnessSeconds + " seconds. This is not a reliable next-flight forecast."
          : (estimate.reason || "Prediction endpoint unavailable."));
      } catch (predictionError) {
        set("next-flight-range", "—");
        set("next-flight-status", "Prediction service not connected");
        set("next-flight-message", "The collector has not been updated with the time-aware prediction endpoint yet.");
        set("next-flight-asof", "No estimate recorded");
        set("next-flight-evidence", "Historical observations only; no next-flight estimate was saved.");
      }
      if (rows.length && window.GomezPreview && typeof window.GomezPreview.loadRemoteObservations === "function") {
        try { window.GomezPreview.loadRemoteObservations(rows, "GameData365 Aviator API"); }
        catch (loadError) { console.warn("Could not load remote observations into Data Lab:", loadError.message); }
      }
      const latest = source && source.lastRoundAt ? " Latest stored round: " + formatTime(source.lastRoundAt) + "." : "";
      const note = rows.length
        ? "Loaded " + rows.length + " stored GameData365 Aviator observation(s). These are historical records, not a live game stream or a forecast." + latest
        : "Collector is reachable, but no GameData365 Aviator rounds have been stored yet. Run a verified provider sync first.";
      set("live-data-message", note);
    } catch (error) {
      set("collector-status", "CONNECTION ERROR");
      set("provider-status", "UNAVAILABLE");
      set("live-data-message", error.message || "Could not read collector data.");
    } finally {
      if (button) { button.disabled = false; button.textContent = "Refresh stored data"; }
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    $("refresh-live-data")?.addEventListener("click", refresh);
    refresh();
  });
})();