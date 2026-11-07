import { createGameAdapter } from "./normalize.js";

/**
 * Register only provider adapters whose access and data format have been
 * documented and authorized. These are contract placeholders, not live feeds.
 */
export const adapterRegistry = Object.freeze({
  aviator: createGameAdapter({
    game: "aviator",
    sourceName: "unconfigured-aviator-provider",
    parseRound: (payload) => payload
  }),
  "high-flyer": createGameAdapter({
    game: "high-flyer",
    sourceName: "unconfigured-high-flyer-provider",
    parseRound: (payload) => payload
  }),
  jetx: createGameAdapter({
    game: "jetx",
    sourceName: "unconfigured-jetx-provider",
    parseRound: (payload) => payload
  })
});

export function getAdapter(game) {
  const key = String(game ?? "").trim().toLowerCase();
  return adapterRegistry[key] ?? null;
}

export function listAdapters() {
  return Object.keys(adapterRegistry).map((game) => ({
    game,
    configured: false,
    liveFeedVerified: false,
    status: "ADAPTER_CONTRACT_ONLY"
  }));
}
