(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  // Synthetic demo values only. They are not live game results.
  let skippedRows = 0;
  let datasetIsImported = false;
  const HISTORY_KEY = "gomez-aviator-import-history-v1";
  let importHistory = loadImportHistory();
  const SNAPSHOT_KEY = "gomez-aviator-summary-snapshots-v1";
  let snapshots = loadSnapshots();
  let latestComparison = null;

  // One simulated day (1,440 rounds at one-minute intervals). Synthetic only.
  function generateSyntheticDay() {
    const dayStart = Date.now() - 24 * 60 * 60 * 1000;
    const values = Array.from({ length: 1440 }, () => {
      const r = Math.random();
      if (r < 0.68) return Number((1 + Math.random() * 1.15).toFixed(2));
      if (r < 0.91) return Number((2.15 + Math.random() * 3.85).toFixed(2));
      if (r < 0.985) return Number((6 + Math.random() * 14).toFixed(2));
      return Number((20 + Math.random() * 80).toFixed(2));
    });
    window.GomezObservations = values.map((multiplier, index) => ({
      multiplier,
      timestamp: new Date(dayStart + index * 60 * 1000).toISOString(),
      roundId: "synthetic-day-" + (index + 1)
    }));
    return values;
  }
  let rounds = generateSyntheticDay();

  // CSV parser supporting quoted cells, commas inside quotes, and escaped quotes.
  // It deliberately rejects unterminated quoted fields rather than silently misreading data.
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;

    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '"') {
        if (quoted && text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = !quoted;
        }
      } else if (ch === "," && !quoted) {
        row.push(cell);
        cell = "";
      } else if ((ch === "\n" || ch === "\r") && !quoted) {
        if (ch === "\r" && text[i + 1] === "\n") i += 1;
        row.push(cell);
        if (row.some((value) => String(value).trim() !== "")) rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += ch;
      }
    }

    if (quoted) throw new Error("CSV contains an unterminated quoted field.");
    row.push(cell);
    if (row.some((value) => String(value).trim() !== "")) rows.push(row);
    return rows;
  }

  function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function loadImportHistory() {
    try {
      const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      return Array.isArray(saved) ? saved.filter((item) =>
        item && typeof item.id === "string" && typeof item.fileName === "string"
      ).slice(0, 20) : [];
    } catch (_) {
      return [];
    }
  }

  function saveImportHistory() {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(importHistory.slice(0, 20)));
      return true;
    } catch (_) {
      $("#history-count").textContent = "STORAGE UNAVAILABLE";
      return false;
    }
  }

  function renderImportHistory() {
    const host = $("#import-history");
    if (!host) return;
    $("#history-count").textContent = importHistory.length + " SAVED";
    host.replaceChildren();
    if (!importHistory.length) {
      const empty = document.createElement("p");
      empty.className = "message";
      empty.textContent = "No imports recorded yet.";
      host.appendChild(empty);
      return;
    }
    importHistory.forEach((item) => {
      const row = document.createElement("article");
      row.className = "history-item";
      const details = document.createElement("div");
      details.className = "history-details";
      const name = document.createElement("strong");
      name.textContent = item.fileName;
      const date = document.createElement("small");
      const parsedDate = new Date(item.importedAt);
      date.textContent = Number.isNaN(parsedDate.getTime()) ? "Date unavailable" : parsedDate.toLocaleString();
      const stats = document.createElement("small");
      stats.textContent = item.records + " records · " + item.skippedRows + " skipped · " + item.timestampCoverage + "% timestamp coverage";
      details.append(name, date, stats);
      const score = document.createElement("b");
      score.className = "history-score";
      score.textContent = item.qualityScore + "/100";
      row.append(details, score);
      host.appendChild(row);
    });
  }

  function exportImportHistory() {
    const payload = {
      product: "Gomez Aviator Intelligence",
      exportType: "local-import-provenance",
      exportedAt: new Date().toISOString(),
      note: "Metadata only. This file does not contain imported round data or verify source authenticity.",
      imports: importHistory
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "gomez-aviator-import-history.json";
    link.click();
    URL.revokeObjectURL(url);
  }


  function loadSnapshots(){try{const value=JSON.parse(localStorage.getItem(SNAPSHOT_KEY)||"[]");return Array.isArray(value)?value.filter(item=>item&&typeof item.id==="string"&&item.summary&&Number(item.summary.recordCount)>0).slice(0,5):[];}catch(_){return[];}}
  function saveSnapshots(){try{localStorage.setItem(SNAPSHOT_KEY,JSON.stringify(snapshots.slice(0,5)));return true;}catch(_){return false;}}
  function renderSnapshots(){
    const first=$("#compare-first"),second=$("#compare-second");if(!first||!second)return;
    [first,second].forEach(select=>{const previous=select.value;select.replaceChildren();snapshots.forEach(item=>{const option=document.createElement("option");option.value=item.id;option.textContent=item.summary.label+" · "+item.summary.recordCount+" rows";select.appendChild(option);});if(snapshots.some(item=>item.id===previous))select.value=previous;});
    $("#save-snapshot").disabled=!datasetIsImported;
    $("#save-snapshot").textContent=datasetIsImported?"Save current summary":"Import a CSV to save";
  }
  function getComparison(){
    const a=snapshots.find(item=>item.id===$("#compare-first").value),b=snapshots.find(item=>item.id===$("#compare-second").value);
    if(!a||!b||a.id===b.id)throw new Error("Choose two different saved dataset snapshots.");
    return {product:"Gomez Aviator Intelligence",reportType:"descriptive-dataset-comparison",generatedAt:new Date().toISOString(),datasetA:a.summary,datasetB:b.summary,comparison:window.GomezResearchCore.compareDatasetSummaries(a.summary,b.summary),methodology:"Mean, interpolated quantiles, threshold frequencies (≥2x, ≥5x, ≥10x), timestamp coverage and heuristic quality score. Summary snapshots only.",limitations:"Historical descriptive analysis only; no future outcomes, betting advice, source verification or causal inference."};
  }
  function exportComparison(){
    if(!latestComparison){$("#dataset-comparison-result").textContent="Run a comparison first.";return;}
    const blob=new Blob([JSON.stringify(latestComparison,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download="gomez-aviator-dataset-comparison.json";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function renderQualityAudit() {
    const core = window.GomezResearchCore;
    if (!core || typeof core.auditDataset !== "function") return;
    const observations = window.GomezObservations || rounds.map((multiplier) => ({ multiplier, timestamp: null }));
    const report = core.auditDataset(observations, skippedRows);
    const labels = [
      ["Records", report.recordCount],
      ["Skipped rows", report.skippedRows],
      ["Missing times", report.missingTimestamps],
      ["Invalid times", report.invalidTimestamps],
      ["Duplicate pairs", report.duplicateRecords],
      ["Order issues", report.orderInversions],
      ["Future times", report.futureTimestamps],
      ["Duplicate IDs", report.duplicateRoundIds],
      ["Time coverage", (report.timestampCoverage * 100).toFixed(1) + "%"]
    ];
    $("#quality-score").textContent = String(report.score);
    $("#quality-status").textContent = datasetIsImported ? report.status.toUpperCase() : "SYNTHETIC DEMO";
    $("#quality-grid").replaceChildren();
    labels.forEach(([label, value]) => {
      const cell = document.createElement("div");
      cell.className = "summary-cell";
      const small = document.createElement("small");
      small.textContent = label;
      const strong = document.createElement("b");
      strong.textContent = String(value);
      cell.append(small, strong);
      $("#quality-grid").appendChild(cell);
    });
    $("#quality-warning").textContent = (datasetIsImported ? report.warning : "Synthetic demo data only; this score is not a source-quality certification. ") + " A high score cannot prove source authenticity, completeness, or accuracy.";
  }

  function render() {
    $("#metric-count").textContent = String(rounds.length);
    $("#metric-median").innerHTML = median(rounds).toFixed(2) + "<span>x</span>";
    const high = rounds.length ? rounds.filter((value) => value >= 5).length / rounds.length * 100 : 0;
    $("#metric-high").innerHTML = high.toFixed(1) + "<span>%</span>";

    const chart = $("#distribution-chart");
    chart.replaceChildren();
    const sample = rounds.slice(-48);
    sample.forEach((value) => {
      const bar = document.createElement("span");
      bar.className = "bar";
      bar.style.height = Math.max(5, Math.min(100, value / 20 * 100)) + "%";
      bar.title = value.toFixed(2) + "x · synthetic demo";
      chart.appendChild(bar);
    });


  function renderDistribution(){
    const host=$("#distribution-breakdown"),source=$("#distribution-source"),warning=$("#distribution-warning");
    if(!host||!window.GomezResearchCore)return;
    const observations=window.GomezObservations||rounds.map(multiplier=>({multiplier}));
    try{
      const profile=window.GomezResearchCore.distributionProfile(observations);
      host.replaceChildren();
      profile.bins.forEach(bin=>{
        const row=document.createElement("div");row.className="distribution-row";
        const label=document.createElement("div");label.className="distribution-label";label.textContent=bin.label;
        const track=document.createElement("div");track.className="distribution-track";
        const fill=document.createElement("span");fill.style.width=(bin.rate*100).toFixed(2)+"%";track.appendChild(fill);
        const value=document.createElement("b");value.textContent=bin.count+" · "+(bin.rate*100).toFixed(1)+"%";
        row.append(label,track,value);host.appendChild(row);
      });
      source.textContent=datasetIsImported?"IMPORTED · UNVERIFIED":"SYNTHETIC DEMO";
      warning.textContent=profile.warning;
    }catch(error){host.textContent=error.message;source.textContent="UNAVAILABLE";}
  }

    renderQualityAudit();
    renderDistribution();
    renderImportHistory();
    renderSnapshots();

    const summary = $("#data-summary");
    if (summary) {
      const min = rounds.length ? Math.min(...rounds) : 0;
      const max = rounds.length ? Math.max(...rounds) : 0;
      summary.innerHTML = [
        ["Records", rounds.length],
        ["Minimum", min.toFixed(2) + "x"],
        ["Maximum", max.toFixed(2) + "x"]
      ].map(([label, value]) => `<div class="summary-cell"><small>${label}</small><b>${value}</b></div>`).join("");
    }
  }

  const validViews = new Set($(".view").map((view) => view.id.replace(/^view-/, "")));

  function showView(name, options = {}) {
    const target = validViews.has(name) ? name : "overview";
    $(".view").forEach((view) => view.classList.toggle("active", view.id === "view-" + target));
    $(".nav-item").forEach((button) => {
      const isActive = button.dataset.view === target;
      button.classList.toggle("active", isActive);
      if (isActive) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    const active = $(`.nav-item[data-view="${target}"]`);
    $("#crumb-current").textContent = active ? active.textContent.trim() : "Overview";
    $("#sidebar").classList.remove("open");
    if (options.updateHash !== false && window.location.hash !== "#" + target) {
      window.history.pushState({ view: target }, "", "#" + target);
    }
    window.scrollTo({ top: 0, behavior: options.smooth === false ? "auto" : "smooth" });
  }

  $(".nav-item").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.view));
  });

  window.addEventListener("popstate", () => {
    showView(window.location.hash.slice(1) || "overview", { updateHash: false, smooth: false });
  });

  $("#menu-button").addEventListener("click", () => {
    const isOpen = $("#sidebar").classList.toggle("open");
    $("#menu-button").setAttribute("aria-expanded", String(isOpen));
  });
  $("#go-data").addEventListener("click", () => showView("data"));
  showView(window.location.hash.slice(1) || "overview", { updateHash: false, smooth: false });

  // Research-only next-flight analysis. This summarizes the loaded sample;
  // it does not claim to predict an individual crash point.
  function wilsonInterval(successes, total, z = 1.96) {
    if (!total) return { low: 0, high: 1 };
    const p = successes / total;
    const z2 = z * z;
    const denominator = 1 + z2 / total;
    const center = (p + z2 / (2 * total)) / denominator;
    const margin = (z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)) / denominator;
    return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
  }

  function analyzeNextFlight() {
    const output = $("#next-flight-result");
    if (!output) return;
    const n = rounds.length;
    if (!n) {
      output.textContent = "No valid observations are loaded. Import a historical CSV first.";
      return;
    }

    const sorted = [...rounds].sort((a, b) => a - b);
    const medianValue = n % 2
      ? sorted[Math.floor(n / 2)]
      : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    const thresholds = [2, 5, 10];
    const summary = thresholds.map((target) => {
      const hits = rounds.filter((value) => value >= target).length;
      const rate = hits / n;
      const ci = wilsonInterval(hits, n);
      return target + "× reached in " + (rate * 100).toFixed(1) +
        "% of this sample (95% interval " + (ci.low * 100).toFixed(1) +
        "–" + (ci.high * 100).toFixed(1) + "%; " + hits + "/" + n + ").";
    });

    const recent = rounds.slice(-20);
    const recentMedian = recent.length ? median(recent) : medianValue;
    output.textContent = "Analysis complete in-browser. Sample size: " + n +
      ". Sample median: " + medianValue.toFixed(2) + "×. Median of the last " + recent.length +
      " rows in the imported file: " + recentMedian.toFixed(2) + "×. " + summary.join(" ") +
      " Next individual crash point: UNKNOWN. These are historical sample frequencies, not next-round probabilities or a dependable prediction. Larger samples do not remove the game's randomness.";
  }

  $("#analyze-next-flight")?.addEventListener("click", analyzeNextFlight);

  // Fast browser-side sampling simulation. It does NOT predict a real next round.
  $("#run-flight-simulation")?.addEventListener("click", () => {
    const button = $("#run-flight-simulation");
    const display = $("#center-multiplier");
    const status = $("#simulation-status");
    if (!display || !status || !rounds.length) {
      if (status) status.textContent = "No sample values available. Load demo data or import a CSV.";
      return;
    }
    button.disabled = true;
    button.textContent = "Calculating…";
    status.textContent = "Running a quick sample calculation…";
    // Small delay so the UI visibly responds, while computation remains lightweight.
    window.setTimeout(() => {
      try {
        const sampleCount = rounds.length;
        const sorted = [...rounds].sort((a,b) => a-b);
        // Bootstrap-style resampling: choose a random observation from the loaded sample.
        const picked = sorted[Math.floor(Math.random() * sorted.length)];
        const medianValue = median(sorted);
        const belowOrEqual = sorted.filter(v => v <= picked).length / sampleCount * 100;
        display.replaceChildren();
        display.append(document.createTextNode(picked.toFixed(2)));
        const x = document.createElement("span"); x.textContent = "x"; display.appendChild(x);
        $("#center-label").textContent = datasetIsImported ? "SAMPLED FROM IMPORT · UNVERIFIED" : "SYNTHETIC DEMO SAMPLE";
        status.textContent = "Simulation complete in milliseconds. Selected " + picked.toFixed(2) +
          "× from " + sampleCount + " loaded sample values; sample median " + medianValue.toFixed(2) +
          "×; selected value is at approximately the " + belowOrEqual.toFixed(1) +
          "th percentile of this dataset. This is a resampled historical/demo value—not a prediction of the next real flight.";
      } catch (error) {
        status.textContent = "Simulation could not complete: " + (error.message || "unknown error");
      } finally {
        button.disabled = false;
        button.innerHTML = 'Run quick simulation <span>✦</span>';
      }
    }, 120);
  });

  $("#run-core-analysis")?.addEventListener("click", () => {
    const output = $("#core-analysis-result");
    if (!output) return;
    if (!window.GomezResearchCore) {
      output.textContent = "Research core failed to load. Refresh and check the browser console.";
      return;
    }
    const threshold = Number($("#core-threshold")?.value);
    const streak = Number($("#core-streak")?.value);
    if (!Number.isFinite(threshold) || threshold <= 1 || !Number.isInteger(streak) || streak < 1 || streak > 100) {
      output.textContent = "Enter a target above 1× and a whole-number streak from 1 to 100.";
      return;
    }
    try {
      const prepared = window.GomezResearchCore.normalizeObservations(
  window.GomezObservations || rounds.map(multiplier => ({ multiplier }))
);
      const result = window.GomezResearchCore.walkForwardComparison(prepared.observations, threshold, streak, 50);
      if (result.status !== "evaluated") {
        output.textContent = "Insufficient observations. Need at least " + result.requiredHistory + "; currently loaded: " + result.available + ".";
        return;
      }
      output.textContent = "Evaluation completed on " + result.scoredObservations + " later observations after " +
        result.initialHistory + " initial history rows. Baseline Brier score: " + result.baselineBrier.toFixed(4) +
        ". Streak-rule Brier score: " + result.streakBrier.toFixed(4) + ". Comparison: " +
        (result.comparison === "streak-lower-brier" ? "streak rule lower" :
         result.comparison === "baseline-lower-brier" ? "baseline lower" : "tie") +
        ". " + prepared.warning + " " + result.warning +
        " " + (/demo|synthetic/i.test($("#data-message")?.textContent || "") ?
        "These are synthetic demo observations, not real game history." : "Imported source accuracy and ordering still require independent verification.");
    } catch (error) {
      output.textContent = "Evaluation stopped: " + (error.message || "invalid data or settings.");
    }
  });


  $("#reset-data").addEventListener("click", () => {
    rounds = generateSyntheticDay();
    window.GomezObservations = null;
    skippedRows = 0;
    datasetIsImported = false;
    
    $("#data-message").textContent = "New synthetic demo sample generated. Not live game history.";
    render();
  });

  $("#csv-input").addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      $("#data-message").textContent = "File too large. Please choose a CSV under 2 MB.";
      event.target.value = "";
      return;
    }

    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length < 2) throw new Error("CSV needs a header and at least one data row.");

      const normalizeHeader = (value) => String(value || "")
        .trim().toLowerCase().replace(/^\uFEFF/, "").replace(/[^a-z0-9]/g, "");
      const headers = rows[0].map(normalizeHeader);
      const column = headers.findIndex((name) =>
        ["multiplier", "crash", "result", "value", "coefficient"].includes(name)
      );
      if (column < 0) throw new Error('Could not find a multiplier column (for example, "multiplier").');

            const parsed = [];
      const observations = [];
      let invalid = 0;

      const timestampHeaders = [
        "timestamp", "datetime", "date", "time", "roundtime", "createdat"
      ];

      const timestampColumn = headers.findIndex((name) =>
        timestampHeaders.includes(name)
      );
      const roundIdColumn = headers.findIndex((name) =>
        ["roundid", "round", "id", "roundnumber"].includes(name)
      );

      for (const row of rows.slice(1)) {
        const raw = String(row[column] ?? "").trim().replace(/[×x]$/i, "");
        const value = Number(raw.replace(/,/g, ""));

        if (raw && Number.isFinite(value) && value >= 1 && value <= 100000000) {
          parsed.push(value);

          let timestamp = null;

          if (timestampColumn >= 0) {
            const rawTimestamp = String(row[timestampColumn] ?? "").trim();

            if (rawTimestamp) {
              const parsedDate = Date.parse(rawTimestamp);

              if (Number.isFinite(parsedDate)) {
                timestamp = new Date(parsedDate).toISOString();
              }
            }
          }

          observations.push({
            multiplier: value,
            timestamp,
            round_id: roundIdColumn >= 0 ? String(row[roundIdColumn] ?? "").trim() : ""
          });
        } else {
          invalid++;
        }
      }

      if (!parsed.length) {
        throw new Error("No valid multiplier values found (values must be between 1.00 and 100,000,000).");
      }

      rounds = parsed.slice(0, 10000);
      window.GomezObservations = observations.slice(0, 10000);
      skippedRows = invalid;
      datasetIsImported = true;

      const timestampCount = window.GomezObservations.filter(item => item.timestamp).length;
      const audit = window.GomezResearchCore.auditDataset(window.GomezObservations, invalid);
      importHistory.unshift({
        id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(16).slice(2),
        fileName: file.name,
        importedAt: new Date().toISOString(),
        fileSizeBytes: file.size,
        records: window.GomezObservations.length,
        skippedRows: invalid,
        timestampCoverage: (audit.timestampCoverage * 100).toFixed(1),
        qualityScore: audit.score,
        qualityStatus: audit.status,
        sourceVerification: "unverified"
      });
      importHistory = importHistory.slice(0, 20);
      saveImportHistory();
      renderImportHistory();

      $("#data-message").textContent =
        `Imported ${rounds.length} valid values from ${file.name}; skipped ${invalid} invalid rows. ` +
        `Timestamps preserved: ${timestampCount}. Source is unverified. Historical research only.`;

      render();
    } catch (error) {
      $("#data-message").textContent = error.message || "Could not read this CSV.";
    }
  });


  $("#save-snapshot")?.addEventListener("click",()=>{
    if(!datasetIsImported){$("#dataset-comparison-result").textContent="Import a CSV first; synthetic demo data cannot be saved as a historical source.";return;}
    try{
      const observations=window.GomezObservations||[];
      const label=$("#snapshot-label").value.trim()||"Dataset "+new Date().toLocaleString();
      const summary=window.GomezResearchCore.summarizeDataset(observations,{label,source:"Imported CSV — unverified",skippedRows});
      snapshots.unshift({id:(window.crypto&&window.crypto.randomUUID)?window.crypto.randomUUID():String(Date.now())+"-"+Math.random().toString(16).slice(2),summary});
      snapshots=snapshots.slice(0,5);
      if(!saveSnapshots())throw new Error("Browser storage is unavailable or full.");
      $("#dataset-comparison-result").textContent="Saved summary for "+label+". Only aggregate statistics were stored locally; raw round data was not saved.";
      renderSnapshots();
    }catch(error){$("#dataset-comparison-result").textContent=error.message||"Could not save this summary.";}
  });
  $("#run-dataset-compare")?.addEventListener("click",()=>{
    try{latestComparison=getComparison();const c=latestComparison.comparison;
      $("#dataset-comparison-result").textContent="Compared "+c.firstLabel+" with "+c.secondLabel+". Median difference (B − A): "+c.medianDifference.toFixed(3)+"×; mean difference: "+c.meanDifference.toFixed(3)+"×; sample-size difference: "+c.recordCountDifference+". Threshold-rate differences (B − A): "+c.thresholdRateDifferences.map(x=>x.threshold+"× "+(x.difference*100).toFixed(1)+" percentage points").join("; ")+". "+c.warning;
    }catch(error){latestComparison=null;$("#dataset-comparison-result").textContent=error.message;}
  });


  let latestTimePeriodProfile=null;
  function runTimePeriodAnalysis(){
    const result=$("#time-period-result"),tableHost=$("#time-period-table-wrap"),warning=$("#time-period-warning"),source=$("#time-period-source");
    if(!result||!tableHost)return;
    if(!datasetIsImported){result.textContent="Import a timestamped historical CSV first. Synthetic demo data is not presented as historical evidence.";tableHost.replaceChildren();latestTimePeriodProfile=null;return;}
    try{
      const observations=window.GomezObservations||[];
      const period=$("#time-period-select")?.value||"month";
      const profile=window.GomezResearchCore.timePeriodProfile(observations,period);
      latestTimePeriodProfile=profile;
      source.textContent="IMPORTED · UNVERIFIED";
      if(!profile.periods.length){result.textContent="No valid timestamps were available for grouping. Check the timestamp column and format.";tableHost.replaceChildren();}
      else{
        result.textContent="Analyzed "+profile.datedRecordCount+" timestamped records across "+profile.periodCount+" "+period+" period(s).";
        const table=document.createElement("table");table.className="time-period-table";
        const headers=["Period","Records","Mean","Median","Min","Max","≥2x","≥5x","≥10x"];
        const thead=document.createElement("thead"),trh=document.createElement("tr");
        headers.forEach(label=>{const th=document.createElement("th");th.textContent=label;trh.appendChild(th);});thead.appendChild(trh);table.appendChild(thead);
        const tbody=document.createElement("tbody");
        profile.periods.forEach(p=>{
          const tr=document.createElement("tr");
          const cells=[p.period,p.recordCount,p.mean.toFixed(3)+"x",p.median.toFixed(3)+"x",p.minimum.toFixed(2)+"x",p.maximum.toFixed(2)+"x",p.thresholds[0].count+" ("+(p.thresholds[0].rate*100).toFixed(1)+"%)",p.thresholds[1].count+" ("+(p.thresholds[1].rate*100).toFixed(1)+"%)",p.thresholds[2].count+" ("+(p.thresholds[2].rate*100).toFixed(1)+"%)"];
          cells.forEach(value=>{const td=document.createElement("td");td.textContent=String(value);tr.appendChild(td);});tbody.appendChild(tr);
        });
        table.appendChild(tbody);tableHost.replaceChildren(table);
      }
      warning.textContent=profile.warning+" "+profile.missingTimestamps+" record(s) lacked a usable timestamp.";
    }catch(error){latestTimePeriodProfile=null;result.textContent=error.message||"Could not analyze time periods.";tableHost.replaceChildren();}
  }
  $("#run-time-period")?.addEventListener("click",runTimePeriodAnalysis);
  $("#time-period-select")?.addEventListener("change",()=>{if(datasetIsImported)runTimePeriodAnalysis();});


  function runStabilityAnalysis(){
    const result=$("#stability-result"),host=$("#stability-table-wrap"),source=$("#stability-source"),warning=$("#stability-warning");
    if(!result||!host)return;
    if(!datasetIsImported){result.textContent="Import a historical CSV first. Synthetic demo data is not treated as historical evidence.";host.replaceChildren();return;}
    try{
      const windowSize=Number($("#stability-window")?.value),stepSize=Number($("#stability-step")?.value);
      const profile=window.GomezResearchCore.stabilityProfile(window.GomezObservations||[],windowSize,stepSize);
      source.textContent="IMPORTED · UNVERIFIED";
      if(profile.status==="insufficient-data"){result.textContent="Insufficient records: "+profile.recordCount+" available; "+profile.requiredRecords+" required for one window.";host.replaceChildren();}
      else{
        result.textContent="Analyzed "+profile.recordCount+" records in "+profile.windowCount+" rolling window(s), each containing "+profile.windowSize+" observations.";
        const table=document.createElement("table");table.className="time-period-table";
        const headers=["Start row","End row","N","Mean","Median","≥2x","≥5x","≥10x"];
        const thead=document.createElement("thead"),trh=document.createElement("tr");
        headers.forEach(label=>{const th=document.createElement("th");th.textContent=label;trh.appendChild(th);});thead.appendChild(trh);table.appendChild(thead);
        const tbody=document.createElement("tbody");
        profile.windows.forEach(w=>{const tr=document.createElement("tr");const cells=[w.startIndex+1,w.endIndex+1,w.recordCount,w.mean.toFixed(3)+"x",w.median.toFixed(3)+"x",...w.thresholdRates.map(x=>(x.rate*100).toFixed(1)+"%")];cells.forEach(value=>{const td=document.createElement("td");td.textContent=String(value);tr.appendChild(td);});tbody.appendChild(tr);});
        table.appendChild(tbody);host.replaceChildren(table);
      }
      warning.textContent=profile.warning;
    }catch(error){result.textContent=error.message||"Could not analyze stability.";host.replaceChildren();}
  }
  $("#run-stability")?.addEventListener("click",runStabilityAnalysis);

  function buildResearchReport(){
    if(!datasetIsImported)throw new Error("Import a historical CSV first. Synthetic demo data cannot be reported as historical evidence.");
    const observations=window.GomezObservations||[];
    if(!observations.length)throw new Error("No imported observations are available.");
    const summary=window.GomezResearchCore.summarizeDataset(observations,{label:"Current imported dataset",source:"CSV import — unverified",skippedRows});
    const audit=window.GomezResearchCore.auditDataset(observations,skippedRows);
    const distribution=window.GomezResearchCore.distributionProfile(observations);
    const timePeriods=window.GomezResearchCore.timePeriodProfile(observations,"month");
    const stability=window.GomezResearchCore.stabilityProfile(observations,Math.min(100,Math.max(2,observations.length)),Math.min(100,Math.max(1,observations.length)));
    const latest=importHistory[0]||null;
    return {product:"Gomez Aviator Intelligence",reportType:"historical-descriptive-research",generatedAt:new Date().toISOString(),dataset:{fileName:latest?latest.fileName:"Unavailable",importedAt:latest?latest.importedAt:null,sourceVerification:"unverified",recordCount:observations.length,skippedRows},summary,audit,distribution,timePeriods,stability,methodology:{statistics:"Arithmetic mean, median, minimum, maximum, linearly interpolated quartiles and observed frequency at or above 2x, 5x and 10x.",distribution:"Observed counts and sample shares across fixed multiplier ranges. These describe this dataset only and are not estimates of future outcomes.",timePeriods:"UTC calendar-month descriptive summaries for records with valid timestamps; missing timestamps are excluded from period groups.",stability:"Rolling descriptive summaries over fixed-size row windows; overlapping windows are not independent and do not predict future outcomes.",quality:"Heuristic checks for missing, invalid and future timestamps, duplicate timestamp/multiplier pairs, ordering inversions, duplicate round IDs and skipped rows.",storage:"Report is generated locally in this browser from the currently imported CSV."},limitations:["Descriptive historical analysis only; no future-round forecast or betting instruction.","The source file and its records have not been independently authenticated.","A quality score is heuristic and does not prove authenticity, completeness or accuracy.","Observed sample frequencies are not guaranteed future probabilities.","Collection period, sampling method and missing records may affect comparisons."]};
  }
  function downloadTextFile(name,content,type){
    const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),link=document.createElement("a");
    link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function exportResearchJson(){
    try{const report=buildResearchReport();downloadTextFile("gomez-aviator-historical-research-report.json",JSON.stringify(report,null,2),"application/json");$("#research-report-result").textContent="Research JSON report generated. Source remains unverified; read the limitations before interpreting results.";}
    catch(error){$("#research-report-result").textContent=error.message;}
  }
  function escapeReportHtml(value){
    return String(value).replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  }
  function exportResearchHtml(){
    try{
      const r=buildResearchReport(),s=r.summary,a=r.audit;
      const rows=[["Records",s.recordCount],["Mean",s.mean.toFixed(4)+"x"],["Median",s.median.toFixed(4)+"x"],["Minimum",s.minimum.toFixed(4)+"x"],["Maximum",s.maximum.toFixed(4)+"x"],["25th percentile",s.quantiles.q25.toFixed(4)+"x"],["75th percentile",s.quantiles.q75.toFixed(4)+"x"],["90th percentile",s.quantiles.q90.toFixed(4)+"x"],["At or above 2x",s.thresholds[0].count+" ("+(s.thresholds[0].rate*100).toFixed(2)+"%)"],["At or above 5x",s.thresholds[1].count+" ("+(s.thresholds[1].rate*100).toFixed(2)+"%)"],["At or above 10x",s.thresholds[2].count+" ("+(s.thresholds[2].rate*100).toFixed(2)+"%)"],["Timestamp coverage",(s.timestampCoverage*100).toFixed(1)+"%"],["Heuristic quality score",a.score+"/100 — "+a.status],["Skipped rows",a.skippedRows],["Duplicate records",a.duplicateRecords],["Invalid timestamps",a.invalidTimestamps],["Future timestamps",a.futureTimestamps],["Ordering inversions",a.orderInversions],["Duplicate round IDs",a.duplicateRoundIds]];
      const table=rows.map(([k,v])=>"<tr><th>"+escapeReportHtml(k)+"</th><td>"+escapeReportHtml(v)+"</td></tr>").join("");
      const distributionRows=r.distribution.bins.map(bin=>"<tr><th>"+escapeReportHtml(bin.label)+"</th><td>"+bin.count+" observations ("+(bin.rate*100).toFixed(2)+"%)</td></tr>").join("");
      const distributionTable="<table>"+distributionRows+"</table>";
      const timePeriodRows=r.timePeriods.periods.map(p=>"<tr><th>"+escapeReportHtml(p.period)+"</th><td>"+p.recordCount+"</td><td>"+p.mean.toFixed(3)+"x</td><td>"+p.median.toFixed(3)+"x</td><td>"+p.minimum.toFixed(2)+"x</td><td>"+p.maximum.toFixed(2)+"x</td></tr>").join("");
      const timePeriodTable="<table><tr><th>Month (UTC)</th><th>Records</th><th>Mean</th><th>Median</th><th>Min</th><th>Max</th></tr>"+timePeriodRows+"</table>";
      const limits=r.limitations.map(x=>"<li>"+escapeReportHtml(x)+"</li>").join("");
      const doc="<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Gomez Aviator Intelligence — Research Report</title><style>body{font:16px/1.6 Arial,sans-serif;max-width:850px;margin:40px auto;padding:0 20px;color:#18211d}h1,h2{font-family:Arial,sans-serif}h1{margin-bottom:4px}small,.muted{color:#58665f}table{border-collapse:collapse;width:100%;margin:20px 0}th,td{text-align:left;padding:10px;border-bottom:1px solid #dce3df}th{width:55%;background:#f4f7f5}.warning{padding:14px;background:#fff5df;border-left:4px solid #c78b21}footer{margin-top:30px;border-top:1px solid #ddd;padding-top:15px}</style><h1>Gomez Aviator Intelligence</h1><p class='muted'>Historical descriptive research report · Generated "+escapeReportHtml(r.generatedAt)+"</p><div class='warning'><b>Research only:</b> Historical analysis does not predict future rounds or provide betting advice. Imported source is unverified.</div><h2>Dataset</h2><p>File: "+escapeReportHtml(r.dataset.fileName)+"<br>Imported: "+escapeReportHtml(r.dataset.importedAt||"Unavailable")+"<br>Records: "+s.recordCount+" · Skipped rows: "+a.skippedRows+"</p><h2>Descriptive statistics and quality checks</h2><table>"+table+"</table><h2>Observed multiplier distribution</h2><p>"+escapeReportHtml(r.methodology.distribution)+"</p>"+distributionTable+"<h2>Time-period summary (UTC month)</h2><p>"+escapeReportHtml(r.methodology.timePeriods)+"</p>"+timePeriodTable+"<h2>Methodology</h2><p>"+escapeReportHtml(r.methodology.statistics)+"</p><p>"+escapeReportHtml(r.methodology.quality)+"</p><h2>Limitations</h2><ul>"+limits+"</ul><footer>Gomez Aviator Intelligence · Local browser-generated report · Source authenticity not verified.</footer></html>";
      downloadTextFile("gomez-aviator-historical-research-report.html",doc,"text/html;charset=utf-8");
      $("#research-report-result").textContent="Readable HTML report generated. Open it in a browser or keep it with the source dataset; source authenticity remains unverified.";
    }catch(error){$("#research-report-result").textContent=error.message;}
  }

  $("#export-dataset-compare")?.addEventListener("click",exportComparison);
  $("#export-research-json")?.addEventListener("click",exportResearchJson);
  $("#export-research-html")?.addEventListener("click",exportResearchHtml);
  $("#export-history")?.addEventListener("click", exportImportHistory);

  $("#clear-history")?.addEventListener("click", () => {
    if (!importHistory.length) return;
    importHistory = [];
    saveImportHistory();
    renderImportHistory();
  });

  $("#download-sample").addEventListener("click", () => {
    const content = "round_id,multiplier\n" + rounds.map((value, index) => `demo-${index + 1},${value.toFixed(2)}`).join("\n");
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "gomez-aviator-demo-sample.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });

  render();
})();
