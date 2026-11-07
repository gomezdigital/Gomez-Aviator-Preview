/**
 * GameData365 crash-games API adapter.
 * API reference: https://gamedata365.com/api-access/docs
 * Keep GAMEDATA365_API_KEY on the backend; never expose it in browser code.
 */
const API_BASE = "https://api.gamedata365.com";
const GAME_ALIASES = Object.freeze({
  aviator: "aviator",
  "high-flyer": "high-flyer",
  high_flyer: "high-flyer",
  jetx: "jetx",
  jet_x: "jetx"
});

function resolveGame(game) {
  const id = String(game?.game_id ?? "").trim().toLowerCase();
  const name = String(game?.game_name ?? "").trim().toLowerCase().replace(/\s+/g, "-");
  return GAME_ALIASES[id] ?? GAME_ALIASES[name] ?? null;
}

export async function fetchGameData365Live({ apiKey = process.env.GAMEDATA365_API_KEY, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error("GAMEDATA365_API_KEY is required.");
  const response = await fetchImpl(`${API_BASE}/v1/crash/live`, {
    method: "GET",
    headers: { "X-API-Key": apiKey, accept: "application/json" },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    const error = new Error(`GameData365 returned HTTP ${response.status}.`);
    error.statusCode = response.status;
    throw error;
  }

  const payload = await response.json();
  if (payload?.status !== "ok" || !Array.isArray(payload.games)) {
    throw new Error("GameData365 returned an unexpected live response.");
  }

  const rounds = [];
  const skipped = [];
  for (const item of payload.games) {
    const game = resolveGame(item);
    if (!game) {
      skipped.push({ gameId: item?.game_id ?? null, reason: "GAME_NOT_MAPPED" });
      continue;
    }
    if (item?.stale === true) {
      skipped.push({ gameId: item?.game_id ?? game, reason: "PROVIDER_MARKED_STALE" });
      continue;
    }
    const latest = item?.latest;
    if (!latest || latest.round_id == null || !String(latest.round_id).trim() || latest.multiplier == null || latest.timestamp == null) {
      skipped.push({ gameId: item?.game_id ?? game, reason: "LATEST_ROUND_FIELDS_MISSING" });
      continue;
    }
    const multiplier = Number(latest.multiplier);
    const timestamp = Date.parse(String(latest.timestamp));
    if (!Number.isFinite(multiplier) || multiplier < 1 || multiplier > 100000000) {
      skipped.push({ gameId: item?.game_id ?? game, reason: "INVALID_MULTIPLIER" });
      continue;
    }
    if (!Number.isFinite(timestamp) || timestamp > Date.now() + 5 * 60 * 1000) {
      skipped.push({ gameId: item?.game_id ?? game, reason: "INVALID_TIMESTAMP" });
      continue;
    }
    rounds.push({
      game,
      sourceName: "gamedata365",
      roundId: String(latest.round_id).trim(),
      multiplier,
      endedAt: new Date(timestamp).toISOString(),
      providerGameId: String(item.game_id ?? ""),
      providerName: String(item.provider ?? "")
    });
  }

  return {
    provider: "gamedata365",
    serverTime: payload.server_time ?? null,
    rounds,
    skipped,
    liveFeedVerified: rounds.length > 0
  };
}
