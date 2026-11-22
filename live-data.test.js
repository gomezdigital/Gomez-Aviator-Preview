import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = fs.readFileSync(path.join(here, "live-data.js"), "utf8");

function makeNode() {
  return {
    textContent: "",
    disabled: false,
    className: "",
    children: [],
    classList: { add() {} },
    replaceChildren() { this.children = []; },
    append(...nodes) { this.children.push(...nodes); },
    appendChild(node) { this.children.push(node); },
    addEventListener() {},
    setAttribute() {},
    insertAdjacentElement() {}
  };
}

test("live-data reader loads stored GameData365 records into the Data Lab", async () => {
  const nodes = new Map();
  const listeners = new Map();
  const requested = [];
  let imported = null;
  const rounds = [
    { source: "gamedata365", game: "aviator", roundId: "r2", multiplier: 2.25, endedAt: "2026-11-22T09:02:00.000Z" },
    { source: "gamedata365", game: "aviator", roundId: "r1", multiplier: 1.5, endedAt: "2026-11-22T09:01:00.000Z" }
  ];
  const payloads = {
    "/health": { ok: true, storageMode: "supabase", storage: { ok: true, persistent: true } },
    "/api/v1/time": { serverTime: "2026-11-22T10:00:00.000Z", timezone: "Africa/Gaborone", timezoneLabel: "CAT", source: "collector-server" },
    "/api/v1/sources": { sources: [{ source: "gamedata365", records: 50, lastRoundAt: "2026-11-22T09:02:00.000Z", allowedForIngestion: true }] },
    "/api/v1/rounds?game=aviator&source=gamedata365&limit=500": { rounds, count: 2 },
    "/api/v1/analysis?game=aviator&source=gamedata365&limit=500": {
      analysis: {
        sampleSize: 2,
        multiplier: { mean: 1.875, median: 1.875 },
        distribution: {
          below2x: { count: 1 },
          from2xTo5x: { count: 1 },
          from5xTo10x: { count: 0 },
          atLeast10x: { count: 0 }
        }
      }
    },
    "/api/v1/quality?game=aviator&source=gamedata365": { quality: { status: "HEALTHY", freshness: { status: "FRESH" } } },
    "/api/v1/intelligence?game=aviator&source=gamedata365": {
      intelligence: { status: "BASELINE_INCOMPLETE", message: "More historical rounds are required." }
    }
  };

  const document = {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, makeNode());
      return nodes.get(id);
    },
    createElement() { return makeNode(); },
    querySelector() { return null; },
    head: { appendChild() {} },
    addEventListener(name, callback) { listeners.set(name, callback); }
  };
  const window = {
    setInterval() { return 1; },
    GomezPreview: {
      loadRemoteObservations(rows, label) {
        imported = { rows, label };
        return { loaded: rows.length };
      }
    }
  };
  const context = {
    window,
    document,
    AbortSignal,
    Date,
    Number,
    String,
    Promise,
    Array,
    Object,
    Math,
    Error,
    console,
    fetch: async (url) => {
      const pathName = String(url).replace("https://gomez-aviator-collector.onrender.com", "");
      requested.push(pathName);
      assert.ok(Object.hasOwn(payloads, pathName), "Unexpected collector request: " + pathName);
      return { ok: true, status: 200, json: async () => payloads[pathName] };
    }
  };

  vm.runInNewContext(script, context, { filename: "live-data.js" });
  assert.equal(typeof listeners.get("DOMContentLoaded"), "function");
  listeners.get("DOMContentLoaded")();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(requested.length, 9);
  assert.ok(requested.includes("/health"));
  assert.ok(requested.includes("/api/v1/time"));
  assert.ok(requested.includes("/api/v1/sources"));
  assert.ok(requested.includes("/api/v1/rounds?game=aviator&source=gamedata365&limit=500"));
  assert.ok(requested.includes("/api/v1/analysis?game=aviator&source=gamedata365&limit=500"));
  assert.ok(requested.includes("/api/v1/quality?game=aviator&source=gamedata365"));
  assert.ok(requested.includes("/api/v1/intelligence?game=aviator&source=gamedata365"));
  assert.ok(requested.includes("/api/v1/prediction/next?game=aviator&source=gamedata365"));
  assert.equal(nodes.get("next-flight-status").textContent, "Prediction service not connected");

  assert.equal(nodes.get("collector-status").textContent, "ONLINE");
  assert.equal(nodes.get("storage-status").textContent, "SUPABASE · PERSISTENT");
  assert.equal(nodes.get("provider-record-count").textContent, "50");
  assert.equal(nodes.get("provider-latest-round").textContent, "22/11/2026, 11:02:00 CAT");
  assert.equal(nodes.get("live-analysis-count").textContent, "2");
  assert.equal(nodes.get("live-analysis-mean").textContent, "1.8750x");
  assert.equal(nodes.get("live-analysis-median").textContent, "1.8750x");
  assert.equal(nodes.get("live-analysis-2x").textContent, "50.00%");
  assert.equal(nodes.get("live-analysis-5x").textContent, "0.00%");
  assert.equal(imported.rows.length, 2);
  assert.equal(imported.label, "GameData365 Aviator API");
  assert.equal(imported.rows[0].roundId, "r2");
  assert.match(nodes.get("live-data-message").textContent, /historical records/);
});
