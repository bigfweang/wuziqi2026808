import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";

const port = "3471";
const origin = `http://127.0.0.1:${port}`;
const dataDirectory = mkdtempSync(join(tmpdir(), "pixel-gomoku-gsm-broker-"));
let logs = "";

const server = spawn(process.execPath, [".next/standalone/server.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    HOSTNAME: "127.0.0.1",
    PORT: port,
    DATA_DIR: dataDirectory,
    ALLOW_DEV_AUTH: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

server.stdout.on("data", (chunk) => { logs += chunk.toString(); });
server.stderr.on("data", (chunk) => { logs += chunk.toString(); });

async function rawRequest(path, init = {}, token) {
  const headers = { ...(init.headers || {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${origin}${path}`, { ...init, headers });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  return { response, data, text };
}

async function jsonRequest(path, method, payload, token) {
  const result = await rawRequest(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }, token);
  if (!result.response.ok) throw new Error(`${result.response.status}: ${JSON.stringify(result.data)}\n${logs}`);
  return result.data;
}

async function login(deviceId, nickname) {
  return jsonRequest("/api/auth/session", "POST", { mode: "dev", deviceId, nickname });
}

async function waitUntilReady() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`server exited early\n${logs}`);
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return;
    } catch {}
    await delay(150);
  }
  throw new Error(`server did not become ready\n${logs}`);
}

async function stopServer() {
  if (server.exitCode === null) {
    server.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => server.once("exit", resolve)),
      delay(3000),
    ]);
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      rmSync(dataDirectory, { recursive: true, force: true });
      return;
    } catch {
      await delay(150 * (attempt + 1));
    }
  }
}

try {
  await waitUntilReady();
  const host = await login("gsm-broker-host", "房主");
  const guest = await login("gsm-broker-guest", "好友");
  const outsider = await login("gsm-broker-outsider", "路人");

  const created = await jsonRequest("/api/rooms", "POST", {
    action: "create",
    password: "2468",
  }, host.token);
  assert.match(created.room.id, /^[23456789A-HJ-NP-Z]{6}$/);
  assert.equal(JSON.stringify(created).includes("2468"), false);

  const accessInfo = "gsm-access-info-test-secret";
  const registered = await jsonRequest("/api/gameserver/rooms", "PUT", {
    roomId: created.room.id,
    accessInfo,
    ttlSeconds: 600,
  }, host.token);
  assert.equal(registered.roomId, created.room.id);
  assert.match(registered.expiresAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(JSON.stringify(registered).includes(accessInfo), false);

  const anonymousResolve = await rawRequest(`/api/gameserver/rooms?id=${created.room.id}`);
  assert.equal(anonymousResolve.response.status, 401);

  const outsiderResolve = await rawRequest(`/api/gameserver/rooms?id=${created.room.id}`, {}, outsider.token);
  assert.equal(outsiderResolve.response.status, 403);

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const rejected = await rawRequest("/api/rooms", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.50",
      },
      body: JSON.stringify({ action: "join", id: created.room.id, password: "9999" }),
    }, outsider.token);
    assert.equal(rejected.response.status, 403);
  }
  const rateLimited = await rawRequest("/api/rooms", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.50",
    },
    body: JSON.stringify({ action: "join", id: created.room.id, password: "9999" }),
  }, outsider.token);
  assert.equal(rateLimited.response.status, 429);
  assert.ok(Number(rateLimited.response.headers.get("retry-after")) > 0);

  const wrongPassword = await rawRequest("/api/rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "join", id: created.room.id, password: "9999" }),
  }, guest.token);
  assert.equal(wrongPassword.response.status, 403);

  const joined = await jsonRequest("/api/rooms", "POST", {
    action: "join",
    id: created.room.id,
    password: "2468",
  }, guest.token);
  assert.equal(joined.room.side, 2);
  assert.equal(JSON.stringify(joined).includes(accessInfo), false);

  const guestResolve = await rawRequest(`/api/gameserver/rooms?id=${created.room.id}`, {}, guest.token);
  assert.equal(guestResolve.response.status, 200);
  assert.equal(guestResolve.data.accessInfo, accessInfo);
  assert.equal(guestResolve.data.roomId, created.room.id);

  const guestRegister = await rawRequest("/api/gameserver/rooms", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomId: created.room.id, accessInfo: "replacement", ttlSeconds: 600 }),
  }, guest.token);
  assert.equal(guestRegister.response.status, 403);

  const publicRoom = await rawRequest(`/api/rooms?id=${created.room.id}`, {}, host.token);
  assert.equal(publicRoom.response.status, 200);
  assert.equal(JSON.stringify(publicRoom.data).includes(accessInfo), false);

  const db = new DatabaseSync(join(dataDirectory, "gomoku.db"));
  const roomSecurity = db.prepare(
    "SELECT password_salt, password_hash FROM rooms WHERE id = ?",
  ).get(created.room.id);
  assert.ok(roomSecurity.password_salt);
  assert.ok(roomSecurity.password_hash);
  assert.notEqual(roomSecurity.password_hash, "2468");
  const brokerRow = db.prepare(
    "SELECT owner_user_id, access_info, expires_at FROM gameserver_rooms WHERE room_id = ?",
  ).get(created.room.id);
  assert.equal(brokerRow.owner_user_id, host.user.id);
  assert.equal(brokerRow.access_info, accessInfo);
  db.prepare("UPDATE gameserver_rooms SET expires_at = ? WHERE room_id = ?")
    .run(new Date(Date.now() - 1000).toISOString(), created.room.id);
  const schemaVersion = db.prepare("PRAGMA user_version").get();
  const roomColumns = db.prepare("PRAGMA table_info(rooms)").all().map((column) => column.name);
  const integrity = db.prepare("PRAGMA integrity_check").get();
  const foreignKeyErrors = db.prepare("PRAGMA foreign_key_check").all();
  assert.equal(schemaVersion.user_version, 5);
  assert.ok(roomColumns.includes("black_undos_used"));
  assert.ok(roomColumns.includes("white_undos_used"));
  assert.equal(integrity.integrity_check, "ok");
  assert.deepEqual(foreignKeyErrors, []);
  db.close();

  const expiredResolve = await rawRequest(`/api/gameserver/rooms?id=${created.room.id}`, {}, guest.token);
  assert.equal(expiredResolve.response.status, 410);
  assert.equal(JSON.stringify(expiredResolve.data).includes(accessInfo), false);

  const floodUsers = await Promise.all(Array.from(
    { length: 24 },
    (_, index) => login(`gsm-broker-flood-${index}`, `限流测试${index}`),
  ));
  const missingRoomId = created.room.id === "AAAAAA" ? "BBBBBB" : "AAAAAA";
  let globalLimitReached = false;
  let permittedFloodRequests = 0;
  for (let attempt = 0; attempt < 260; attempt += 1) {
    const rejected = await rawRequest("/api/rooms", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `198.51.100.${attempt + 1}`,
      },
      body: JSON.stringify({ action: "join", id: missingRoomId }),
    }, floodUsers[attempt % floodUsers.length].token);
    if (rejected.response.status === 429) {
      globalLimitReached = true;
      break;
    }
    assert.equal(rejected.response.status, 404);
    permittedFloodRequests += 1;
  }
  assert.equal(globalLimitReached, true);
  assert.ok(permittedFloodRequests > 0);

  process.stdout.write("GameServer broker passed: room password, rate limit, member-only resolve, expiry, migration\n");
} finally {
  await stopServer();
}
