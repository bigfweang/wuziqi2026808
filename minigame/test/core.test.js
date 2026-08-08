const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const {
  AVATAR_FILES,
  applyRoomIfNewer,
  boardIndexFromPoint,
  inviteQuery,
  normalizeRoomCode,
  roomStatusText,
} = require("../src/core");

test("all nine avatars exist in preview and minigame runtime copies", () => {
  assert.equal(AVATAR_FILES.length, 9);
  for (const filename of AVATAR_FILES) {
    const minigame = readFileSync(join(__dirname, "..", "images", "avatars", filename));
    const preview = readFileSync(join(__dirname, "..", "..", "public", "avatars", filename));
    assert.deepEqual(minigame, preview, `${filename} runtime copies must match`);
  }
});

test("newer room revisions win and stale polling cannot roll state back", () => {
  const current = { id: "ABC234", revision: 8, board: "new" };
  assert.equal(applyRoomIfNewer(current, { ...current, revision: 7, board: "old" }), current);
  const newer = { ...current, revision: 9, board: "newer" };
  assert.equal(applyRoomIfNewer(current, newer), newer);
});

test("finished board without winner is shown as a draw", () => {
  assert.equal(roomStatusText({ status: "finished", winner: 0, turn: 2 }), "和棋，棋盘下满啦");
  assert.equal(roomStatusText({ status: "finished", winner: 1, turn: 2 }), "黑方连成五子");
  assert.equal(roomStatusText({ status: "waiting", winner: 0, turn: 1 }), "等待好友输入房间号");
});

test("board touch maps to nearest 15 by 15 intersection", () => {
  const board = { x: 20, y: 100, size: 300, padding: 10 };
  assert.equal(boardIndexFromPoint(30, 110, board), 0);
  assert.equal(boardIndexFromPoint(310, 390, board), 224);
  assert.equal(boardIndexFromPoint(170, 250, board), 112);
  assert.equal(boardIndexFromPoint(5, 5, board), -1);
});

test("room codes and share queries are normalized", () => {
  assert.equal(normalizeRoomCode(" ab-c 23!4 "), "ABC234");
  assert.equal(inviteQuery(" ab-c 23!4 "), "room=ABC234");
});
