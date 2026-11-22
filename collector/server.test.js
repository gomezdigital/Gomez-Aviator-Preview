import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
let child;
let baseUrl;
let tempDir;

async function freePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForHealth(url) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url + "/health");
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Collector did not become healthy in time.");
}

before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gomez-aviator-test-"));
  const port = await freePort();
  baseUrl = "http://127.0.0.1:" + port;
  child = spawn(process.execPath, [path.join(here, "server.js")], {
    env: {
      ...process.env,
      PORT: String(port),
      DATA_FILE: path.join(tempDir, "rounds.jsonl"),
      INGEST_API_TOKEN: "test-only-secret",
      MANUAL_CAPTURE_TOKEN: "manual-test-secret",
      ALLOWED_SOURCES: "gamedata365",
      CORS_ORIGINS: "https://gomezdigital.github.io"
    },
    stdio: "ignore"
  });
  await waitForHealth(baseUrl);
});

after(async () => {
  if (child && child.exitCode === null) child.kill("SIGTERM");
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

test("time endpoint returns an authoritative UTC timestamp and Botswana timezone", async () => {
  const beforeRequest = Date.now();
  const response = await fetch(baseUrl + "/api/v1/time");
  const afterResponse = Date.now();
  const body = await response.json();
  const serverTime = Date.parse(body.serverTime);
  assert.equal(response.status, 200);
  assert.equal(body.timezone, "Africa/Gaborone");
  assert.equal(body.timezoneLabel, "CAT");
  assert.equal(body.source, "collector-server");
  assert.ok(Number.isFinite(serverTime));
  assert.ok(serverTime >= beforeRequest - 5000 && serverTime <= afterResponse + 5000);
});

test("health endpoint reports service health but not a live feed", async () => {
  const response = await fetch(baseUrl + "/health");
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.liveProviderConnected, false);
  assert.equal(body.storageMode, "local-file");
  assert.equal(body.persistentStorage, false);
  assert.equal(body.storage.ok, true);
});

test("source endpoint marks sources as not verified", async () => {
  const response = await fetch(baseUrl + "/api/v1/sources");
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.liveFeedVerified, false);
  assert.ok(body.sources.every((source) => source.liveFeedVerified === false));
});

test("agent report focuses on Aviator without claiming predictions or live data", async () => {
  const response = await fetch(baseUrl + "/api/v1/agents/report");
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.report.status, "INSUFFICIENT_DATA");
  assert.deepEqual(body.report.summary.gamesAnalysed, ["aviator"]);
  assert.equal(body.report.agents.gameAgents.length, 1);
  assert.equal(body.report.predictive, false);
  assert.equal(body.report.liveFeedVerified, false);
  assert.equal(body.liveFeedVerified, false);
});

test("multi-agent report rejects unsupported game filters", async () => {
  const response = await fetch(baseUrl + "/api/v1/agents/report?game=unknown");
  assert.equal(response.status, 400);
});

test("quality endpoint reports an empty dataset without claiming a live feed", async () => {
  const response = await fetch(baseUrl + "/api/v1/quality?game=aviator");
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.quality.status, "NO_VALID_DATA");
  assert.equal(body.quality.liveFeedVerified, false);
  assert.equal(body.liveFeedVerified, false);
});

test("intelligence endpoint reports insufficient data without claiming a live feed", async () => {
  const response = await fetch(baseUrl + "/api/v1/intelligence?game=aviator");
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.intelligence.status, "INSUFFICIENT_DATA");
  assert.equal(body.intelligence.predictive, false);
  assert.equal(body.liveFeedVerified, false);
});

test("analysis endpoint reports an empty historical sample before ingestion", async () => {
  const response = await fetch(baseUrl + "/api/v1/analysis?game=aviator");
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.analysis.sampleSize, 0);
  assert.equal(body.analysis.predictive, false);
  assert.equal(body.liveFeedVerified, false);
});

test("analysis endpoint rejects unsupported game filters", async () => {
  const response = await fetch(baseUrl + "/api/v1/analysis?game=unknown");
  assert.equal(response.status, 400);
});

test("next-flight endpoint refuses to create estimates without persistent prediction storage", async () => {
  const response = await fetch(baseUrl + "/api/v1/prediction/next?game=aviator&source=gamedata365");
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.status, "unavailable");
  assert.equal(body.reason, "PERSISTENT_STORAGE_REQUIRED");
});

test("round endpoint returns an empty list before ingestion", async () => {
  const response = await fetch(baseUrl + "/api/v1/rounds?limit=10");
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.rounds, []);
  assert.equal(body.count, 0);
});

test("manual capture rejects requests without its dedicated access token", async () => {
  const response = await fetch(baseUrl + "/api/v1/manual-capture", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ multiplier: 1.75 })
  });
  assert.equal(response.status, 401);
});

test("manual capture requires persistent storage even with a valid token", async () => {
  const response = await fetch(baseUrl + "/api/v1/manual-capture", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Manual-Capture-Token": "manual-test-secret"
    },
    body: JSON.stringify({ multiplier: 1.75 })
  });
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.reason, "PERSISTENT_STORAGE_REQUIRED");
});

test("ingestion rejects requests without a bearer token", async () => {
  const response = await fetch(baseUrl + "/api/v1/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: "betway", rounds: [] })
  });
  assert.equal(response.status, 401);
});

test("ingestion rejects sources that are not explicitly allowlisted", async () => {
  const response = await fetch(baseUrl + "/api/v1/ingest", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-only-secret"
    },
    body: JSON.stringify({
      source: "betway",
      rounds: [{ roundId: "blocked-test-round", multiplier: 1.65, endedAt: new Date().toISOString() }]
    })
  });
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.match(body.error, /source is not enabled/i);
});

test("ingestion accepts authorized records and identifies repeated round IDs", async () => {
  const record = { roundId: "unique-test-round", game: "aviator", multiplier: 1.65, endedAt: new Date().toISOString() };
  const send = () => fetch(baseUrl + "/api/v1/ingest", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-only-secret"
    },
    body: JSON.stringify({ source: "gamedata365", rounds: [record] })
  });
  const [first, second] = await Promise.all([send(), send()]);
  const bodies = await Promise.all([first.json(), second.json()]);
  assert.ok([first.status, second.status].every(status => status === 201));
  assert.equal(bodies.reduce((sum, body) => sum + body.accepted, 0), 1);
  assert.equal(bodies.reduce((sum, body) => sum + body.duplicates, 0), 1);
});
