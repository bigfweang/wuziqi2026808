const API_BASE = typeof globalThis !== "undefined" && globalThis.__PIXEL_GOMOKU_API_BASE__
  ? String(globalThis.__PIXEL_GOMOKU_API_BASE__).replace(/\/$/, "")
  : "https://game.lmbostudio.cn";

module.exports = {
  API_BASE,
  GAMESERVER_BRIDGE: true,
  POLL_MS: 1400,
  STORAGE_PREFIX: "pixel-gomoku-dev:",
};
