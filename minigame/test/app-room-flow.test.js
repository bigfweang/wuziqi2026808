const test = require("node:test");
const assert = require("node:assert/strict");
const { PixelGomokuApp } = require("../src/app");

function room(id, side, status = "waiting") {
  return {
    id,
    side,
    status,
    revision: 1,
    board: "0".repeat(225),
    moves: [],
    turn: 1,
    winner: 0,
  };
}

function appWith({ platform = {}, gameServer = null } = {}) {
  const basePlatform = {
    getStorage: () => "",
    setStorage: () => {},
    ...platform,
  };
  const app = new PixelGomokuApp({
    platform: basePlatform,
    config: { API_BASE: "https://example.test", STORAGE_PREFIX: "test:", POLL_MS: 1000 },
    gameServer,
  });
  const toasts = [];
  app.toast = (message) => toasts.push(message);
  app.api.token = "session-token";
  return { app, toasts };
}

test("create uses an optional password and binds the friendly room code", async () => {
  let createdPassword = null;
  let boundRoomId = "";
  const gameServer = {
    hostRoom: async (roomId) => { boundRoomId = roomId; return true; },
  };
  const { app, toasts } = appWith({
    platform: { promptCreateRoom: async () => ({ password: "2468" }) },
    gameServer,
  });
  app.api.createRoom = async (password) => {
    createdPassword = password;
    return { room: room("ABC234", 1) };
  };

  await app.createRoom();
  assert.equal(createdPassword, "2468");
  assert.equal(boundRoomId, "ABC234");
  assert.equal(app.state.room.id, "ABC234");
  assert.match(toasts.at(-1), /好友可直接输入房间号/);
});

test("join prompts for room code and password before resolving GameServer", async () => {
  let joined = null;
  let bridgedRoomId = "";
  const gameServer = {
    guestRoom: async (roomId) => { bridgedRoomId = roomId; return true; },
  };
  const { app, toasts } = appWith({
    platform: {
      promptJoinRoom: async () => ({ roomCode: "ABC234", password: "2468" }),
    },
    gameServer,
  });
  app.api.joinRoom = async (roomId, password) => {
    joined = { roomId, password };
    return { room: room(roomId, 2, "active") };
  };

  await app.promptAndJoin();
  assert.deepEqual(joined, { roomId: "ABC234", password: "2468" });
  assert.equal(bridgedRoomId, "ABC234");
  assert.match(toasts.at(-1), /已通过房间号加入微信联机/);
});

test("GameServer failure never blocks the existing HTTPS room flow", async () => {
  const gameServer = {
    hostRoom: async () => { throw new Error("GameServer unavailable"); },
  };
  const { app, toasts } = appWith({
    platform: { promptCreateRoom: async () => ({ password: "" }) },
    gameServer,
  });
  app.api.createRoom = async () => ({ room: room("ABC234", 1) });

  await app.createRoom();
  assert.equal(app.state.screen, "game");
  assert.equal(app.state.room.id, "ABC234");
  assert.match(toasts.at(-1), /可直接输入房间号加入/);
});

test("resume reconnects GameServer by existing room side", async () => {
  let reconnectArgs = null;
  const gameServer = {
    reconnectRoom: async (...args) => { reconnectArgs = args; return true; },
  };
  const { app } = appWith({ gameServer });
  app.state.activeRoom = { id: "ABC234", side: 2, status: "active" };
  app.api.room = async () => ({ room: room("ABC234", 2, "active") });

  await app.resumeRoom();
  assert.equal(reconnectArgs[0], "ABC234");
  assert.equal(reconnectArgs[1], 2);
  assert.equal(reconnectArgs[2], app.api);
});

test("GameServer disconnect feedback preserves the HTTPS-room fallback", () => {
  const { app, toasts } = appWith();

  app.gameServerStatus("room-disconnected", { role: "guest" });
  app.gameServerStatus("room-reconnect-failed", { role: "guest" });

  assert.match(toasts[0], /正在恢复/);
  assert.match(toasts[1], /棋局仍可继续/);
});

test("returning to the foreground refreshes HTTPS state and reconnects GameServer", async () => {
  let reconnectArgs = null;
  const currentRoom = room("ABC234", 2, "active");
  const gameServer = {
    reconnectRoom: async (...args) => { reconnectArgs = args; return true; },
  };
  const { app } = appWith({ gameServer });
  app.state.screen = "game";
  app.state.room = currentRoom;
  app.api.room = async () => ({ room: currentRoom });

  await app.handleShow();

  assert.deepEqual(reconnectArgs, ["ABC234", 2, app.api]);
});
