import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
let collector;
let collectorUrl;
let tempDir;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function waitForHealth() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(collectorUrl + "/health");
      if (response.ok) return response.json();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Collector did not become healthy in time.");
}

before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gomez-ingestion-integration-"));
  const probe = http.createServer();
  const port = await listen(probe);
  await new Promise((resolve) => probe.close(resolve));
  collectorUrl = "http://127.0.0.1:" + port;

  collector = spawn(process.execPath, [path.join(here, "server.js")], {
    env: {
      ...process.env,
      PORT: String(port),
      DATA_FILE: path.join(tempDir, "rounds.jsonl"),
      INGEST_API_TOKEN: "integration-test-token",
      ALLOWED_SOURCES: "user-import",
      CORS_ORIGINS: ""
    },
    stdio: "ignore"
  });
  const health = await waitForHealth();
  assert.equal(health.storageMode, "local-file");
  assert.equal(health.persistentStorage, false);
});

after(async () => {
  if (collector && collector.exitCode === null) collector.kill("SIGTERM");
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

test("authenticated sample ingestion persists and reads back through the API", async () => {
  const response = await fetch(collectorUrl + "/api/v1/ingest", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer integration-test-token"
    },
    body: JSON.stringify({
      source: "user-import",
      rounds: [{
        game: "aviator",
        roundId: "synthetic-integration-round-001",
        multiplier: 2.35,
        endedAt: "2026-11-19T10:30:00.000Z"
      }]
    })
  });
  const result = await response.json();
  assert.equal(response.status, 201);
  assert.equal(result.accepted, 1);
  assert.equal(result.duplicates, 0);
  assert.equal(result.liveFeedVerified, false);

  const readback = await fetch(collectorUrl + "/api/v1/rounds?game=aviator&source=user-import");
  const data = await readback.json();
  assert.equal(readback.status, 200);
  assert.equal(data.count, 1);
  assert.equal(data.rounds[0].roundId, "synthetic-integration-round-001");
  assert.equal(data.rounds[0].multiplier, 2.35);
});

test("repeated sample ingestion is idempotent", async () => {
  const response = await fetch(collectorUrl + "/api/v1/ingest", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer integration-test-token"
    },
    body: JSON.stringify({
      source: "user-import",
      rounds: [{
        game: "aviator",
        roundId: "synthetic-integration-round-001",
        multiplier: 2.35,
        endedAt: "2026-11-19T10:30:00.000Z"
      }]
    })
  });
  const result = await response.json();
  assert.equal(response.status, 201);
  assert.equal(result.accepted, 0);
  assert.equal(result.duplicates, 1);
  const readback = await fetch(collectorUrl + "/api/v1/rounds?game=aviator&source=user-import");
  assert.equal((await readback.json()).count, 1);
});

test("invalid sample records are rejected before storage", async () => {
  const response = await fetch(collectorUrl + "/api/v1/ingest", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer integration-test-token"
    },
    body: JSON.stringify({
      source: "user-import",
      rounds: [{ game: "aviator", roundId: "invalid-sample", multiplier: 0.5, endedAt: "2026-11-19T10:30:00.000Z" }]
    })
  });
  assert.equal(response.status, 400);
  const readback = await fetch(collectorUrl + "/api/v1/rounds?game=aviator&source=user-import");
  assert.equal((await readback.json()).count, 1);
});
