const BOARD_SIZE = 15;
const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;
const AVATAR_FILES = [
  "01-face-short-hair.png",
  "02-face-bob.png",
  "03-face-curly.png",
  "04-face-glasses.png",
  "05-face-bangs.png",
  "06-face-spiky.png",
  "07-face-beard.png",
  "08-face-bun.png",
  "09-face-mustache.png",
];

function applyRoomIfNewer(current, incoming) {
  if (!incoming) return current;
  if (!current || current.id !== incoming.id) return incoming;
  return Number(incoming.revision) >= Number(current.revision) ? incoming : current;
}

function parseBoard(value) {
  if (typeof value !== "string" || value.length !== CELL_COUNT || /[^012]/.test(value)) {
    return Array(CELL_COUNT).fill(0);
  }
  return Array.from(value, Number);
}

function roomStatusText(room) {
  if (!room) return "正在连接棋局";
  if (room.status === "waiting") return "等待好友加入";
  if (room.status === "finished") {
    if (room.winner === 1) return "黑方连成五子";
    if (room.winner === 2) return "白方连成五子";
    return "和棋，棋盘下满啦";
  }
  return room.turn === 1 ? "轮到黑方" : "轮到白方";
}

function boardIndexFromPoint(x, y, board) {
  if (!board || x < board.x || y < board.y || x > board.x + board.size || y > board.y + board.size) return -1;
  const span = board.size - board.padding * 2;
  const cell = span / (BOARD_SIZE - 1);
  const col = Math.round((x - board.x - board.padding) / cell);
  const row = Math.round((y - board.y - board.padding) / cell);
  if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return -1;
  const centerX = board.x + board.padding + col * cell;
  const centerY = board.y + board.padding + row * cell;
  if (Math.abs(x - centerX) > cell * 0.62 || Math.abs(y - centerY) > cell * 0.62) return -1;
  return row * BOARD_SIZE + col;
}

function normalizeRoomCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function inviteQuery(roomId) {
  return `room=${encodeURIComponent(normalizeRoomCode(roomId))}`;
}

function avatarFile(avatarId) {
  const index = Math.max(1, Math.min(9, Number(avatarId) || 1)) - 1;
  return AVATAR_FILES[index];
}

function makeDeviceId(random = Math.random, now = Date.now) {
  const seed = `${now().toString(36)}-${Math.floor(random() * Number.MAX_SAFE_INTEGER).toString(36)}`;
  return `dev-${seed.replace(/[^a-z0-9-]/gi, "").slice(0, 80)}`;
}

function winningLine(room) {
  return new Set(Array.isArray(room && room.winningLine) ? room.winningLine : []);
}

module.exports = {
  AVATAR_FILES,
  BOARD_SIZE,
  CELL_COUNT,
  applyRoomIfNewer,
  avatarFile,
  boardIndexFromPoint,
  inviteQuery,
  makeDeviceId,
  normalizeRoomCode,
  parseBoard,
  roomStatusText,
  winningLine,
};
