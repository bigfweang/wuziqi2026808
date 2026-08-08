const API_BASE = typeof globalThis !== "undefined" && globalThis.__PIXEL_GOMOKU_API_BASE__
  ? String(globalThis.__PIXEL_GOMOKU_API_BASE__).replace(/\/$/, "")
  : "http://127.0.0.1:3000";

module.exports = {
  API_BASE,
  POLL_MS: 1400,
  STORAGE_PREFIX: "pixel-gomoku-dev:",
};
