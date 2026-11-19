/**
 * GameData365 crash-games API adapter.
 * API reference: https://gamedata365.com/api-access/docs
 * Keep GAMEDATA365_API_KEY on the backend; never expose it in browser code.
 */
const API_BASE = "https://api.gamedata365.com";
const GAME_ALIASES = Object.freeze({ aviator: "aviator", "high-flyer": "high-flyer", high_flyer: "high-flyer", jetx: "jetx", jet_x: "jetx" });

function resolveGame(game) {
  const id = String(game?.game_id ?? "").trim().toLowerCase();
  const name = String(game?.game_name ?? "").trim().toLowerCase().replace(/\s+/g, "-");
  return GAME_ALIASES[id] ?? GAME_ALIASES[name] ?? null;
}
function parseProviderTime(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return NaN;
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)
    ? raw.replace(" ", "T") + "Z" : raw;
  return Date.parse(normalized);
}
function normalizeRound(round, game = "aviator") {
  if (!round || typeof round !== "object" || round.type === "gap") return null;
  const roundId = String(round.round_id ?? "").trim();
  const multiplier = Number(round.multiplier);
  const timestamp = parseProviderTime(round.timestamp);
  if (!roundId || roundId.length > 180 || !Number.isFinite(multiplier) || multiplier < 1 || multiplier > 100000000) return null;
  if (!Number.isFinite(timestamp) || timestamp > Date.now() + 5 * 60 * 1000) return null;
  return { game, sourceName: "gamedata365", roundId, multiplier, endedAt: new Date(timestamp).toISOString(), backfilled: round.backfilled === true };
}
async function requestJson(path, apiKey, fetchImpl) {
  const response = await fetchImpl(API_BASE + path, {
    method: "GET", headers: { "X-API-Key": apiKey, accept: "application/json" }, signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) {
    const error = new Error(`GameData365 returned HTTP ${response.status}.`);
    error.statusCode = response.status;
    throw error;
  }
  return response.json();
}
function requireApiKey(apiKey) {
  if (!apiKey) throw new Error("GAMEDATA365_API_KEY is required.");
}
export async function fetchGameData365Live({ apiKey = process.env.GAMEDATA365_API_KEY, fetchImpl = fetch } = {}) {
  requireApiKey(apiKey);
  const payload = await requestJson("/v1/crash/live", apiKey, fetchImpl);
  if (payload?.status !== "ok" || !Array.isArray(payload.games)) throw new Error("GameData365 returned an unexpected live response.");
  const rounds = [], skipped = [];
  for (const item of payload.games) {
    const game = resolveGame(item);
    if (!game) { skipped.push({ gameId: item?.game_id ?? null, reason: "GAME_NOT_MAPPED" }); continue; }
    if (item?.stale === true) { skipped.push({ gameId: item?.game_id ?? game, reason: "PROVIDER_MARKED_STALE" }); continue; }
    const normalized = normalizeRound(item?.latest, game);
    if (!normalized) { skipped.push({ gameId: item?.game_id ?? game, reason: "INVALID_OR_MISSING_LATEST_ROUND" }); continue; }
    rounds.push({ ...normalized, providerGameId: String(item.game_id ?? ""), providerName: String(item.provider ?? "") });
  }
  return { provider: "gamedata365", serverTime: payload.server_time ?? null, rounds, skipped, liveFeedVerified: rounds.some((r) => r.game === "aviator") };
}
export async function fetchGameData365History({ apiKey = process.env.GAMEDATA365_API_KEY, game = "aviator", limit = 500, cursor = "", fetchImpl = fetch } = {}) {
  requireApiKey(apiKey);
  const gameId = String(game).trim().toLowerCase();
  if (gameId !== "aviator") throw new Error("This collector currently imports Aviator history only.");
  const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 1000) : 500;
  const params = new URLSearchParams({ game: gameId, limit: String(safeLimit) });
  if (cursor) params.set("cursor", String(cursor));
  const payload = await requestJson("/v1/crash/history?" + params.toString(), apiKey, fetchImpl);
  if (payload?.status !== "ok" || !Array.isArray(payload.rounds)) throw new Error("GameData365 returned an unexpected crash-history response.");
  if (payload.game_id && String(payload.game_id).toLowerCase() !== gameId) throw new Error("GameData365 returned history for a different game.");
  const rounds = [], skipped = [];
  for (const item of payload.rounds) {
    if (item?.type === "gap") {
      skipped.push({ reason: "PROVIDER_HISTORY_GAP", from: item.from ?? null, to: item.to ?? null, estimatedMissing: Number(item.estimated_missing) || null, recovered: item.recovered === true });
      continue;
    }
    const normalized = normalizeRound(item, gameId);
    if (!normalized) { skipped.push({ roundId: item?.round_id ?? null, reason: "INVALID_HISTORY_ROUND" }); continue; }
    rounds.push(normalized);
  }
  return { provider: "gamedata365", game: gameId, serverTime: payload.server_time ?? null, rounds, skipped, nextCursor: payload.next_cursor ?? null, historySpins: Number(payload.history_spins) || null, count: Number(payload.count) || rounds.length };
}
