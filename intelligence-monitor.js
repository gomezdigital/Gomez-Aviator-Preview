(() => {
  "use strict";
  const API = "https://gomez-aviator-collector.onrender.com";
  const $ = (id) => document.getElementById(id);
  const CAT = "Africa/Gaborone";
  let busy = false;

  const fmtTime = (value) => {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: CAT, day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
    }).format(date) + " CAT";
  };
  const set = (id, value) => { const node = $(id); if (node) node.textContent = String(value); };
  const pct = (value) => value == null ? "—" : (Number(value) * 100).toFixed(1) + "%";
  async function get(path) {
    const response = await fetch(API + path, {
      headers: { accept: "application/json" }, cache: "no-store",
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error("Collector HTTP " + response.status + " (" + path + ")");
    return response.json();
  }
  function renderPatterns(patterns) {
    if (!patterns) {
      set("gomez-pattern-status", "PATTERN API NOT AVAILABLE");
      set("gomez-pattern-summary", "The pattern endpoint is not available on the current collector deployment yet.");
      return;
    }
    set("gomez-pattern-status", patterns.status || "ANALYSIS STATUS UNKNOWN");
    set("gomez-pattern-sample", patterns.sampleSize ?? 0);
    const dist = patterns.overallDistribution || [];
    const host = $("gomez-pattern-distribution");
    if (host) {
      host.replaceChildren();
      dist.forEach((item) => {
        const row = document.createElement("div");
        row.className = "gomez-pattern-row";
        const label = document.createElement("span");
        label.textContent = item.label;
        const track = document.createElement("div");
        track.className = "gomez-pattern-track";
        const fill = document.createElement("i");
        fill.style.width = Math.max(0, Math.min(100, Number(item.rate || 0) * 100)) + "%";
        track.appendChild(fill);
        const value = document.createElement("b");
        value.textContent = item.count + " · " + pct(item.rate);
        row.append(label, track, value);
        host.appendChild(row);
      });
      if (!dist.length) host.textContent = "No valid observations yet.";
    }
    const changes = (patterns.distributionChanges || []).filter((item) => item.percentagePointDifference !== null);
    const largest = changes.sort((a, b) => Math.abs(b.percentagePointDifference) - Math.abs(a.percentagePointDifference))[0];
    set("gomez-pattern-shift", largest
      ? largest.label + ": " + (largest.percentagePointDifference > 0 ? "+" : "") + largest.percentagePointDifference + " percentage points in recent window"
      : "Not enough baseline observations to compare windows.");
    const runs = patterns.runs || [];
    const longest = runs.reduce((best, item) => !best || item.longestRun > best.longestRun ? item : best, null);
    set("gomez-pattern-run", longest && longest.longestRun
      ? longest.label + " · longest observed run " + longest.longestRun
      : "No consecutive run available.");
    const spacing = patterns.highMultiplierSpacing || {};
    set("gomez-pattern-spacing", spacing.eventCount
      ? spacing.eventCount + " observations at 10x+ · median spacing " + (spacing.medianIntervalInObservedRounds ?? "not available") + " observed rounds"
      : "No 10x+ observations in this sample.");
    set("gomez-pattern-summary", patterns.interpretation || "Retrospective descriptive analysis only.");
  }
  async function refresh() {
    if (busy) return;
    busy = true;
    set("gomez-monitor-status", "SYNCING");
    try {
      const [health, sourceData, roundData, timeData] = await Promise.all([
        get("/health"),
        get("/api/v1/sources"),
        get("/api/v1/rounds?game=aviator&source=gamedata365&limit=500"),
        get("/api/v1/time")
      ]);
      let patternData = null;
      try {
        patternData = await get("/api/v1/patterns?game=aviator&source=gamedata365&recentSize=20&baselineSize=50");
      } catch (patternError) {
        console.warn("Pattern endpoint is not available yet:", patternError.message);
      }
      const source = (sourceData.sources || []).find((item) => item.source === "gamedata365");
      const rounds = Array.isArray(roundData.rounds) ? roundData.rounds : [];
      const latest = rounds[0] || null;
      const age = latest ? Math.max(0, Math.floor((Date.parse(timeData.serverTime) - Date.parse(latest.endedAt)) / 1000)) : null;
      set("gomez-monitor-status", health.ok ? "COLLECTOR ONLINE" : "COLLECTOR UNAVAILABLE");
      set("gomez-monitor-clock", fmtTime(timeData.serverTime));
      set("gomez-monitor-storage", health.storage?.ok && health.storage?.persistent ? "SUPABASE PERSISTENT" : "STORAGE NOT VERIFIED");
      set("gomez-monitor-source", source?.allowedForIngestion ? "INGESTION ENABLED" : "SOURCE NOT ENABLED");
      set("gomez-monitor-count", source?.records ?? roundData.count ?? 0);
      set("gomez-monitor-latest", latest ? Number(latest.multiplier).toFixed(2) + "x · Round " + latest.roundId : "No stored round");
      set("gomez-monitor-age", age === null ? "No observation" : age + " seconds ago");
      set("gomez-monitor-freshness", age === null ? "NO DATA" : age <= 120 ? "RECENT OBSERVATION" : "HISTORICAL / STALE");
      set("gomez-monitor-updated", "Last dashboard refresh: " + fmtTime(timeData.serverTime));
      renderPatterns(patternData?.patterns || null);
      const list = $("gomez-monitor-rounds");
      if (list) {
        list.replaceChildren();
        rounds.slice(0, 8).forEach((round) => {
          const item = document.createElement("div");
          item.className = "gomez-monitor-round";
          const time = document.createElement("small");
          time.textContent = fmtTime(round.endedAt);
          const value = document.createElement("b");
          value.textContent = Number(round.multiplier).toFixed(2) + "x";
          item.append(time, value);
          list.appendChild(item);
        });
        if (!rounds.length) list.textContent = "No stored observations yet.";
      }
    } catch (error) {
      set("gomez-monitor-status", "CONNECTION / ENDPOINT ISSUE");
      set("gomez-monitor-updated", error.message || "Could not refresh the intelligence monitor.");
    } finally {
      busy = false;
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    if (!$("gomez-intelligence-monitor")) return;
    refresh();
    window.setInterval(refresh, 30000);
    const button = $("gomez-monitor-refresh");
    if (button) button.addEventListener("click", refresh);
  });
})();