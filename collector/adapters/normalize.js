/**
 * Source-neutral game adapter contract.
 * Adapters transform authorized provider payloads into normalized round records.
 * No network access, credentials, scraping, or betting logic belongs here.
 */

export const SUPPORTED_GAMES = Object.freeze(["aviator", "high-flyer", "jetx"]);

const MAX_ID_LENGTH = 180;
const MAX_MULTIPLIER = 100_000_000;

export function normalizeGameRound(game, input, sourceName) {
  const normalizedGame = String(game ?? "").trim().toLowerCase();
  if (!SUPPORTED_GAMES.includes(normalizedGame)) {
    return { error: `Unsupported game: ${normalizedGame || "(empty)"}` };
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "Round must be an object." };
  }

  const roundId = String(input.roundId ?? input.id ?? "").trim();
  const multiplier = Number(input.multiplier ?? input.crashPoint);
  const endedAtRaw = input.endedAt ?? input.timestamp;
  const endedAtMs = Date.parse(String(endedAtRaw ?? ""));

  if (!roundId || roundId.length > MAX_ID_LENGTH) {
    return { error: "roundId/id is required and must be at most 180 characters." };
  }
  if (!Number.isFinite(multiplier) || multiplier < 1 || multiplier > MAX_MULTIPLIER) {
    return { error: "multiplier/crashPoint must be between 1 and 100000000." };
  }
  if (!Number.isFinite(endedAtMs)) {
    return { error: "endedAt/timestamp must be a valid timestamp." };
  }
  if (endedAtMs > Date.now() + 5 * 60 * 1000) {
    return { error: "Round timestamp is too far in the future." };
  }

  return {
    record: {
      game: normalizedGame,
      sourceName: String(sourceName ?? "unknown").trim().slice(0, 100) || "unknown",
      roundId,
      multiplier,
      endedAt: new Date(endedAtMs).toISOString()
    }
  };
}

/**
 * Adapter factory. Provider-specific parsing is intentionally injected so the
 * shared layer never assumes an undocumented API schema.
 */
export function createGameAdapter({ game, sourceName, parseRound }) {
  if (!SUPPORTED_GAMES.includes(String(game).toLowerCase())) {
    throw new TypeError("Adapter game must be aviator, high-flyer, or jetx.");
  }
  if (typeof parseRound !== "function") {
    throw new TypeError("parseRound must be a function supplied by an authorized provider adapter.");
  }

  return Object.freeze({
    game: String(game).toLowerCase(),
    sourceName: String(sourceName ?? "unknown"),
    normalize(payload) {
      let parsed;
      try {
        parsed = parseRound(payload);
      } catch {
        return { error: "Provider parser rejected the payload." };
      }
      return normalizeGameRound(game, parsed, sourceName);
    }
  });
}
