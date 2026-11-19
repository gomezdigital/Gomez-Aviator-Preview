import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
let collector;
let supabase;
let collectorUrl;
let supabaseUrl;
let rows = new Map();

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
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
  rows = new Map();
  supabase = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    res.setHeader("content-type", "application/json");
    if (req.method === "GET" && url.pathname === "/rest/v1/aviator_rounds") {
      res.end(JSON.stringify([...rows.values()]));
      return;
    }
    if (req.method === "POST" && url.pathname === "/rest/v1/aviator_rounds") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const incoming = JSON.parse(body);
      const accepted = [];
      for (const record of incoming) {
        const key = [record.source, record.game, record.round_id].join("::");
        if (!rows.has(key)) {
          rows.set(key, record);
          accepted.push(record);
        }
      }
      res.statusCode = 201;
      res.end(JSON.stringify(accepted));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ message: "not found" }));
  });
  const supabasePort = await listen(supabase);
  supabaseUrl = "http://127.0.0.1:" + supabasePort;

  const probe = http.createServer();
  const collectorPort = await listen(probe);
  await close(probe);
  collectorUrl = "http://127.0.0.1:" + collectorPort;

  collector = spawn(process.execPath, [path.join(here, "server.js")], {
    env: {
      ...process.env,
      PORT: String(collectorPort),
      SUPABASE_URL: supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: "integration-test-only",
      INGEST_API_TOKEN: "integration-test-token",
      ALLOWED_SOURCES: "user-import",
      CORS_ORIGINS: ""
    },
    stdio: "ignore"
  });
  const health = await waitForHealth();
  assert.equal(health.storageMode, "supabase");
  assert.equal(health.persistentStorage, true);
});

after(async () => {
  if (collector && collector.exitCode === null) collector.kill("SIGTERM");
  if (supabase) await close(supabase);
});

test("authenticated sample ingestion persists to Supabase and reads back", async () => {
  const sample = {
    source: "user-import",
    rounds: [{
      game: "aviator",
      roundId: "synthetic-integration-round-001",
      multiplier: 2.35,
      endedAt: "2026-11-19T10:30:00.000Z"
    }]
  };
  const response = await fetch(collectorUrl + "/api/v1/ingest", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer integration-test-token"
    },
    body: JSON.stringify(sample)
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
  assert.equal(rows.size, 1);
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
  assert.equal(rows.size, 1);
});
