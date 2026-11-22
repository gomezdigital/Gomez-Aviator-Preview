const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const requiredControls = [
  "csv-input", "reset-data", "quality-score", "quality-status", "quality-grid",
  "quality-warning", "distribution-breakdown", "distribution-source",
  "distribution-warning", "run-core-analysis", "core-threshold", "core-streak",
  "core-analysis-result", "snapshot-label", "save-snapshot", "history-count",
  "import-history", "compare-first", "compare-second", "run-dataset-compare",
  "export-dataset-compare", "dataset-comparison-result", "time-period-select",
  "run-time-period", "time-period-result", "time-period-table-wrap",
  "time-period-warning", "time-period-source", "stability-window",
  "stability-step", "run-stability", "stability-result", "stability-table-wrap",
  "stability-warning", "stability-source", "export-research-json",
  "export-research-html", "research-report-result", "export-history", "clear-history",
  "provider-status", "collector-status", "storage-status", "provider-record-count",
  "provider-latest-round", "provider-ingestion-status", "refresh-live-data",
  "live-data-message", "live-analysis-status", "live-analysis-count", "live-analysis-mean",
  "live-analysis-median", "live-analysis-2x", "live-analysis-5x", "live-analysis-quality",
  "live-intelligence-output", "live-round-list"
];

test("Data Lab exposes every control required by its research script", () => {
  for (const id of requiredControls) {
    assert.ok(html.includes('id="' + id + '"') || html.includes("id='" + id + "'"),
      "Missing Data Lab element: " + id);
  }
});

test("HTML element IDs are unique", () => {
  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual([...new Set(duplicates)], []);
});


test("preview loads the public live-data reader without embedding provider secrets", () => {
  assert.ok(html.includes('src="live-data.js"'));
  const liveScript = fs.readFileSync(path.join(__dirname, "live-data.js"), "utf8");
  assert.ok(liveScript.includes("/api/v1/analysis"));
  assert.ok(liveScript.includes("/api/v1/quality"));
  assert.ok(!liveScript.includes("GAMEDATA365_API_KEY"));
  assert.ok(!liveScript.includes("SUPABASE_SERVICE_ROLE_KEY"));
});
