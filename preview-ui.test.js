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
  "export-research-html", "research-report-result", "export-history", "clear-history"
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
