import fs from "node:fs/promises";
import path from "node:path";

const DATA_FILE = path.resolve(process.env.DATA_FILE || path.join(process.cwd(), "data", "rounds.jsonl"));
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const PAGE_SIZE = 1000;
const useSupabase = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

if (Boolean(SUPABASE_URL) !== Boolean(SUPABASE_SERVICE_ROLE_KEY)) {
  throw new Error("Set both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or neither.");
}
if (useSupabase && !/^https:\/\//i.test(SUPABASE_URL)) {
  throw new Error("SUPABASE_URL must use HTTPS.");
}

export const storageMode = useSupabase ? "supabase" : "local-file";
export const persistentStorage = useSupabase;

function mapFromDatabase(row) {
  return {
    source: row.source,
    game: row.game,
    roundId: row.round_id,
    multiplier: Number(row.multiplier),
    endedAt: row.ended_at,
    receivedAt: row.received_at
  };
}

function mapToDatabase(record) {
  return {
    source: record.source,
    game: record.game || "aviator",
    round_id: record.roundId,
    multiplier: record.multiplier,
    ended_at: record.endedAt,
    received_at: record.receivedAt
  };
}

async function supabaseRequest(pathname, options = {}) {
  const response = await fetch(SUPABASE_URL + "/rest/v1/" + pathname, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: "Bearer " + SUPABASE_SERVICE_ROLE_KEY,
      "content-type": "application/json",
      ...options.headers
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    const error = new Error("Supabase storage request failed (" + response.status + "): " + detail);
    error.statusCode = 503;
    throw error;
  }
  if (response.status === 204) return [];
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

async function readLocalRecords() {
  try {
    const content = await fs.readFile(DATA_FILE, "utf8");
    const rows = [];
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (row && typeof row === "object" && row.source && row.roundId) rows.push(row);
      } catch {
        // Preserve damaged lines for manual investigation.
      }
    }
    return rows;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

let localWriteQueue = Promise.resolve();

async function persistLocalRecords(records) {
  let result;
  localWriteQueue = localWriteQueue.catch(() => {}).then(async () => {
    const existing = await readLocalRecords();
    const known = new Set(existing.map((r) =>
      r.source + "::" + (r.game || "aviator") + "::" + r.roundId
    ));
    const accepted = [];
    let duplicates = 0;
    for (const record of records) {
      const key = record.source + "::" + (record.game || "aviator") + "::" + record.roundId;
      if (known.has(key)) {
        duplicates += 1;
        continue;
      }
      known.add(key);
      accepted.push(record);
    }
    if (accepted.length) {
      await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
      await fs.appendFile(DATA_FILE, accepted.map((r) => JSON.stringify(r)).join("\n") + "\n", {
        encoding: "utf8",
        mode: 0o600
      });
    }
    result = { accepted: accepted.length, duplicates };
  });
  await localWriteQueue;
  return result;
}

export async function readAllRecords() {
  if (!useSupabase) return readLocalRecords();
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await supabaseRequest(
      "aviator_rounds?select=source,game,round_id,multiplier,ended_at,received_at&order=ended_at.asc,round_id.asc",
      { headers: { range: offset + "-" + (offset + PAGE_SIZE - 1), "range-unit": "items" } }
    );
    rows.push(...page.map(mapFromDatabase));
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

export async function persistUniqueRecords(source, records) {
  if (!useSupabase) return persistLocalRecords(records);
  const payload = records.map(mapToDatabase);
  const inserted = await supabaseRequest(
    "aviator_rounds?on_conflict=source,game,round_id",
    {
      method: "POST",
      headers: { prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify(payload)
    }
  );
  const accepted = inserted.length;
  return { accepted, duplicates: records.length - accepted };
}

export async function checkStorage() {
  if (!useSupabase) return { ok: true, mode: storageMode, persistent: false };
  await supabaseRequest("aviator_rounds?select=id&limit=1");
  return { ok: true, mode: storageMode, persistent: true };
}
