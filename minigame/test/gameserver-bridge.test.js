const test = require("node:test");
const assert = require("node:assert/strict");
const {
  GameServerBridge,
  MESSAGE_TYPE,
  ROOM_EXT_PREFIX,
} = require("../src/gameserver-bridge");

function platform(overrides = {}) {
  return { isPreview: false, ...overrides };
}

test("developer-tools simulator does not create a GameServer room", async () => {
  const events = [];
  const bridge = new GameServerBridge({
    platform: platform(),
    wxApi: {
      getDeviceInfo: () => ({ platform: "devtools" }),
      getGameServerManager: () => { throw new Error("must not be called"); },
    },
    onStatus: (event) => events.push(event),
  });

  assert.equal(await bridge.ensureReady(), false);
  assert.deepEqual(events, []);
});

test("host binds an opaque GameServer credential to the friendly room code", async () => {
  const events = [];
  let createOptions;
  let registration;
  const manager = {
    login: async () => {},
    onBroadcast: () => {},
    createRoom: (options) => {
      createOptions = options;
      options.success({ data: { accessInfo: "host-access-secret", clientId: 1 } });
    },
  };
  const api = {
    registerGameServerRoom: async (...args) => { registration = args; },
  };
  const bridge = new GameServerBridge({
    platform: platform(),
    wxApi: { getGameServerManager: () => manager },
    onStatus: (event, detail) => events.push({ event, detail }),
  });

  assert.equal(await bridge.hostRoom("ABC234", api), true);
  assert.equal(createOptions.roomExtInfo, `${ROOM_EXT_PREFIX}ABC234`);
  assert.deepEqual(registration, ["ABC234", "host-access-secret", 600]);
  assert.equal(events.some(({ event }) => event === "host-ready"), true);
  assert.equal(JSON.stringify(events).includes("host-access-secret"), false);
});

test("guest resolves by room code, joins, and exchanges a sanitized broadcast", async () => {
  const events = [];
  const sentMessages = [];
  let joinedAccessInfo = "";
  let broadcastListener;
  const manager = {
    login: async () => {},
    onBroadcast: (listener) => { broadcastListener = listener; },
    joinRoom: ({ accessInfo, success }) => {
      joinedAccessInfo = accessInfo;
      success({ data: { myPos: 2, clientId: 2 } });
    },
    broadcastInRoom: ({ msg, success }) => {
      sentMessages.push(JSON.parse(msg));
      success();
    },
  };
  const api = {
    gameServerRoom: async () => ({ accessInfo: "guest-access-secret" }),
  };
  const bridge = new GameServerBridge({
    platform: platform(),
    wxApi: { getGameServerManager: () => manager },
    onStatus: (event, detail) => events.push({ event, detail }),
  });

  assert.equal(await bridge.guestRoom("ABC234", api), true);
  assert.equal(joinedAccessInfo, "guest-access-secret");
  assert.deepEqual(sentMessages[0], { type: MESSAGE_TYPE, event: "ping", roomId: "ABC234" });
  broadcastListener({ msg: JSON.stringify({ type: MESSAGE_TYPE, event: "ack", roomId: "ABC234" }) });
  assert.equal(events.some(({ event, detail }) => event === "peer-message" && detail.role === "guest"), true);
  assert.equal(JSON.stringify(events).includes("guest-access-secret"), false);
});

test("existing friendly room reconnects to its matching GameServer room", async () => {
  const events = [];
  let reconnectAccessInfo = "";
  const manager = {
    login: async () => {},
    onBroadcast: () => {},
    getLastRoomInfo: ({ success }) => success({
      data: {
        accessInfo: "reconnect-access-secret",
        roomInfo: { roomExtInfo: `${ROOM_EXT_PREFIX}ABC234` },
      },
    }),
    reconnect: async ({ accessInfo }) => { reconnectAccessInfo = accessInfo; },
  };
  const bridge = new GameServerBridge({
    platform: platform(),
    wxApi: { getGameServerManager: () => manager },
    onStatus: (event, detail) => events.push({ event, detail }),
  });

  assert.equal(await bridge.reconnectRoom("ABC234", 1, {}), true);
  assert.equal(reconnectAccessInfo, "reconnect-access-secret");
  assert.equal(events.some(({ event, detail }) => event === "room-reconnected" && detail.role === "host"), true);
  assert.equal(JSON.stringify(events).includes("reconnect-access-secret"), false);
});

test("foreground disconnect actively reconnects without exposing its credential", async () => {
  const events = [];
  let disconnectListener;
  let reconnectAccessInfo = "";
  const manager = {
    login: async () => {},
    onBroadcast: () => {},
    onDisconnect: (listener) => { disconnectListener = listener; },
    createRoom: ({ success }) => success({ data: { accessInfo: "initial-access-secret" } }),
    getLastRoomInfo: ({ success }) => success({
      data: {
        accessInfo: "disconnect-access-secret",
        roomInfo: { roomExtInfo: `${ROOM_EXT_PREFIX}ABC234` },
      },
    }),
    reconnect: async ({ accessInfo }) => { reconnectAccessInfo = accessInfo; },
  };
  const bridge = new GameServerBridge({
    platform: platform(),
    wxApi: { getGameServerManager: () => manager },
    onStatus: (event, detail) => events.push({ event, detail }),
  });
  const api = { registerGameServerRoom: async () => {} };

  await bridge.hostRoom("ABC234", api);
  disconnectListener({ errCode: 9001 });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(reconnectAccessInfo, "disconnect-access-secret");
  assert.equal(events.some(({ event }) => event === "room-disconnected"), true);
  assert.equal(events.some(({ event }) => event === "room-reconnected"), true);
  assert.equal(JSON.stringify(events).includes("disconnect-access-secret"), false);
});

test("failed foreground reconnect reports HTTPS fallback and does not loop", async () => {
  const events = [];
  let disconnectListener;
  let reconnectCalls = 0;
  const manager = {
    login: async () => {},
    onBroadcast: () => {},
    onDisconnect: (listener) => { disconnectListener = listener; },
    createRoom: ({ success }) => success({ data: { accessInfo: "initial-access-secret" } }),
    getLastRoomInfo: ({ success }) => success({
      data: {
        accessInfo: "failed-reconnect-secret",
        roomInfo: { roomExtInfo: `${ROOM_EXT_PREFIX}ABC234` },
      },
    }),
    reconnect: async () => { reconnectCalls += 1; throw { errCode: 9001 }; },
  };
  const bridge = new GameServerBridge({
    platform: platform(),
    wxApi: { getGameServerManager: () => manager },
    onStatus: (event, detail) => events.push({ event, detail }),
  });
  const api = { registerGameServerRoom: async () => {} };

  await bridge.hostRoom("ABC234", api);
  disconnectListener({ errCode: 9001 });
  disconnectListener({ errCode: 9001 });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(reconnectCalls, 1);
  assert.equal(events.filter(({ event }) => event === "room-reconnect-failed").length, 1);
  assert.equal(JSON.stringify(events).includes("failed-reconnect-secret"), false);
});
