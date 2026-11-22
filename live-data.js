(() => {
  "use strict";

  const API = "https://gomez-aviator-collector.onrender.com";
  const $ = (id) => document.getElementById(id);
  const set = (id, value) => { const node = $(id); if (node) node.textContent = String(value); };
  const DISPLAY_TIME_ZONE = "Africa/Gaborone";
  let serverClockOffsetMs = 0;
  let clockSyncStatus = "DEVICE CLOCK · NOT VERIFIED";
  let clockTimerStarted = false;

  function ensureClockPanel() {
    if ($("gomez-live-clock")) return;
    const actions = document.querySelector(".topbar .top-actions");
    if (!actions) return;
    const panel = document.createElement("div");
    panel.id = "gomez-live-clock";
    panel.className = "gomez-live-clock";
    panel.setAttribute("aria-label", "Live Botswana date and time");
    panel.innerHTML = `
      <div class="gomez-clock-main">
        <strong id="gomez-clock-time">Syncing…</strong>
        <small id="gomez-clock-date">Waiting for server time</small>
      </div>
      <div class="gomez-clock-meta">
        <b id="gomez-clock-sync">WAITING FOR SERVER</b>
        <small>Africa/Gaborone · CAT · UTC+2</small>
      </div>`;
    actions.parentNode.insertBefore(panel, actions);
    const style = document.createElement("style");
    style.textContent = `
      .gomez-live-clock{display:flex;align-items:center;gap:12px;margin-left:auto;margin-right:14px;padding:7px 11px;border:1px solid #285238;border-radius:10px;background:#0e1b12;white-space:nowrap}
      .gomez-clock-main,.gomez-clock-meta{display:grid;gap:2px}
      #gomez-clock-time{font:700 16px/1.15 "Space Grotesk",sans-serif;letter-spacing:.2px;color:#f2fff5;font-variant-numeric:tabular-nums}
      #gomez-clock-date,.gomez-clock-meta small{font-size:8px;color:#91a196}
      #gomez-clock-sync{font-size:9px;letter-spacing:.5px;color:#9be7ad}
      .gomez-clock-meta{padding-left:11px;border-left:1px solid #2b4432}
      @media(max-width:900px){.gomez-clock-meta{display:none}.gomez-live-clock{margin-right:8px;padding:6px 8px}}
      @media(max-width:700px){.gomez-live-clock{gap:0;margin-left:auto;margin-right:7px;padding:5px 7px}#gomez-clock-time{font-size:13px}#gomez-clock-date{font-size:7px}.topbar{gap:7px}}
    `;
    document.head.appendChild(style);
  }

  function renderClock() {
    const now = new Date(Date.now() + serverClockOffsetMs);
    set("gomez-clock-time", new Intl.DateTimeFormat("en-GB", {
      timeZone: DISPLAY_TIME_ZONE, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
    }).format(now) + " CAT");
    set("gomez-clock-date", new Intl.DateTimeFormat("en-GB", {
      timeZone: DISPLAY_TIME_ZONE, weekday: "long", day: "2-digit", month: "long", year: "numeric"
    }).format(now));
    set("gomez-clock-sync", clockSyncStatus);
  }

  async function synchronizeClock() {
    const startedAt = Date.now();
    try {
      const response = await get("/api/v1/time");
      const receivedAt = Date.now();
      const serverMs = Date.parse(response.serverTime);
      if (!Number.isFinite(serverMs) || response.timezone !== DISPLAY_TIME_ZONE) {
        throw new Error("Collector returned invalid clock metadata.");
      }
      const midpoint = startedAt + (receivedAt - startedAt) / 2;
      serverClockOffsetMs = serverMs - midpoint;
      clockSyncStatus = "SERVER SYNCED";
      renderClock();
    } catch (error) {
      if (serverClockOffsetMs === null) serverClockOffsetMs = 0;
      clockSyncStatus = "DEVICE CLOCK · NOT VERIFIED";
      renderClock();
      console.warn("Could not synchronize live clock:", error.message);
    }
  }

  function startLiveClock() {
    ensureClockPanel();
    if (clockTimerStarted) return;
    clockTimerStarted = true;
    synchronizeClock();
    window.setInterval(renderClock, 1000);
    window.setInterval(synchronizeClock, 30000);
  }

  function ensurePredictionCutoffFields() {
    const host = $("next-flight-evidence");
    if (!host || $("next-flight-cutoff")) return;
    const cutoff = document.createElement("p");
    cutoff.id = "next-flight-cutoff";
    cutoff.className = "panel-copy";
    cutoff.textContent = "Data cutoff: waiting for estimate";
    const round = document.createElement("p");
    round.id = "next-flight-cutoff-round";
    round.className = "panel-copy";
    round.textContent = "Last eligible round: waiting for estimate";
    host.insertAdjacentElement("afterend", cutoff);
    cutoff.insertAdjacentElement("afterend", round);
  }

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
        set("next-flight-cutoff", estimate.dataCutoffEndedAt
          ? "Data cutoff: " + formatTime(estimate.dataCutoffEndedAt)
          : "Data cutoff: unavailable");
        set("next-flight-cutoff-round", estimate.dataCutoffRoundId
          ? "Last eligible round ID: " + estimate.dataCutoffRoundId
          : "Last eligible round: unavailable");
      } catch (predictionError) {
        set("next-flight-range", "—");
        set("next-flight-status", "Prediction service not connected");
        set("next-flight-message", "The collector has not been updated with the time-aware prediction endpoint yet.");
        set("next-flight-asof", "No estimate recorded");
        set("next-flight-evidence", "Historical observations only; no next-flight estimate was saved.");
        set("next-flight-cutoff", "Data cutoff: unavailable");
        set("next-flight-cutoff-round", "Last eligible round: unavailable");
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
  async function recordManualObservation() {
    const button = $("save-manual-observation");
    const token = $("manual-capture-token")?.value.trim();
    const multiplier = Number($("manual-multiplier")?.value);
    const status = $("manual-capture-status");
    if (!token) { if (status) status.textContent = "Enter the private capture access token first."; return; }
    if (!Number.isFinite(multiplier) || multiplier < 1 || multiplier > 100000000) {
      if (status) status.textContent = "Enter a valid multiplier of at least 1.00x.";
      return;
    }
    if (button) { button.disabled = true; button.textContent = "Recording…"; }
    if (status) status.textContent = "Sending the observation securely to the collector…";
    try {
      const response = await fetch(API + "/api/v1/manual-capture", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "application/json",
          "X-Manual-Capture-Token": token
        },
        body: JSON.stringify({ multiplier }),
        cache: "no-store",
        signal: AbortSignal.timeout(30000)
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || body.error || ("Collector returned HTTP " + response.status));
      if (status) status.textContent = body.accepted
        ? "Recorded " + Number(body.round.multiplier).toFixed(2) + "x at " + formatTime(body.round.endedAt) + " CAT. Stored in Supabase."
        : "Observation was not added (duplicate or storage response).";
      const field = $("manual-multiplier");
      if (field) field.value = "";
      await refreshManualObservations();
    } catch (error) {
      if (status) status.textContent = error.message || "Could not record the observation.";
    } finally {
      if (button) { button.disabled = false; button.textContent = "Record observed round"; }
    }
  }

  async function refreshManualObservations() {
    try {
      const response = await get("/api/v1/rounds?game=aviator&source=manual-observation&limit=100");
      const rows = Array.isArray(response.rounds) ? response.rounds : [];
      set("manual-round-count", response.count || rows.length);
      set("manual-latest-round", rows[0]?.endedAt ? formatTime(rows[0].endedAt) : "No manual records yet");
      const host = $("manual-round-list");
      if (!host) return;
      host.replaceChildren();
      rows.slice(0, 10).forEach((round) => {
        const item = document.createElement("div");
        item.className = "live-round-item";
        const time = document.createElement("small");
        time.textContent = formatTime(round.endedAt);
        const value = document.createElement("strong");
        value.textContent = Number(round.multiplier).toFixed(2) + "x";
        if (Number(round.multiplier) >= 5) value.classList.add("high");
        item.append(time, value);
        host.appendChild(item);
      });
      if (!rows.length) {
        const empty = document.createElement("p");
        empty.className = "panel-copy";
        empty.textContent = "No manual observations recorded yet.";
        host.appendChild(empty);
      }
    } catch (error) {
      set("manual-round-count", "Unavailable");
      set("manual-latest-round", "Could not load records");
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    startLiveClock();
    ensurePredictionCutoffFields();
    $("refresh-live-data")?.addEventListener("click", refresh);
    $("save-manual-observation")?.addEventListener("click", recordManualObservation);
    refreshManualObservations();
    refresh();
  });
})();