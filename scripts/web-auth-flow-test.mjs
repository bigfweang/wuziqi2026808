import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { buildGameInvitation } from "../lib/invitation.ts";

const invitation = buildGameInvitation({
  baseUrl: "https://game.lmbostudio.cn/old?debug=1#fragment",
  roomId: "abc234",
  roomPassword: "2468",
  inviterNickname: "测试房主",
});
assert.equal(invitation.url, "https://game.lmbostudio.cn/old?room=ABC234");
assert.match(invitation.text, /网址：https:\/\/game\.lmbostudio\.cn\/old\?room=ABC234/);
assert.match(invitation.text, /房间号：ABC234/);
assert.match(invitation.text, /房间密码：2468/);
assert.equal(invitation.url.includes("2468"), false);

const port = "3473";
const origin = `http://127.0.0.1:${port}`;
const dataDirectory = mkdtempSync(join(tmpdir(), "pixel-gomoku-web-auth-"));
const databasePath = join(dataDirectory, "gomoku.db");
let logs = "";

const legacyDb = new DatabaseSync(databasePath);
legacyDb.exec(`
  CREATE TABLE rooms (
    id TEXT PRIMARY KEY NOT NULL,
    black_token TEXT NOT NULL,
    white_token TEXT,
    black_name TEXT NOT NULL DEFAULT '我',
    white_name TEXT,
    board TEXT NOT NULL,
    moves TEXT NOT NULL DEFAULT '[]',
    turn INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'waiting',
    winner INTEGER NOT NULL DEFAULT 0,
    black_user_id TEXT,
    white_user_id TEXT,
    password_salt TEXT,
    password_hash TEXT,
    round INTEGER NOT NULL DEFAULT 1,
    revision INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE users (
    id TEXT PRIMARY KEY NOT NULL,
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    nickname TEXT NOT NULL,
    avatar_id INTEGER NOT NULL CHECK (avatar_id BETWEEN 1 AND 9),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    UNIQUE(provider, provider_user_id)
  );
  PRAGMA user_version = 2;
`);
legacyDb.close();

const server = spawn(process.execPath, [".next/standalone/server.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    HOSTNAME: "127.0.0.1",
    PORT: port,
    DATA_DIR: dataDirectory,
    ALLOW_DEV_AUTH: "0",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => { logs += chunk.toString(); });
server.stderr.on("data", (chunk) => { logs += chunk.toString(); });

async function rawRequest(path, init = {}, cookie = "") {
  const headers = { ...(init.headers || {}) };
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${origin}${path}`, { ...init, headers });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  return { response, data, text };
}

async function jsonRequest(path, method, payload, cookie = "") {
  return rawRequest(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }, cookie);
}

function sessionCookie(response) {
  const value = response.headers.get("set-cookie") || "";
  assert.match(value, /pixel_gomoku_session=[A-Za-z0-9_-]{32,}/);
  assert.match(value, /HttpOnly/i);
  assert.match(value, /SameSite=Lax/i);
  return value.split(";", 1)[0];
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

  const anonymousProfile = await rawRequest("/api/me");
  assert.equal(anonymousProfile.response.status, 401);

  const anonymousCreate = await jsonRequest("/api/rooms", "POST", {
    action: "create",
    password: "2468",
  });
  assert.equal(anonymousCreate.response.status, 401, "registered session must be required to create rooms");

  const weakRegistration = await jsonRequest("/api/auth/session", "POST", {
    mode: "register",
    account: "ab",
    nickname: "弱密码",
    password: "123",
    avatarId: 1,
  });
  assert.equal(weakRegistration.response.status, 400);

  const blackRegistration = await jsonRequest("/api/auth/session", "POST", {
    mode: "register",
    account: "black_player",
    nickname: "黑方玩家",
    password: "correct-horse-1",
    avatarId: 3,
  });
  assert.equal(blackRegistration.response.status, 201);
  assert.equal(blackRegistration.data.user.nickname, "黑方玩家");
  assert.equal(blackRegistration.data.user.avatarId, 3);
  assert.equal(blackRegistration.data.user.account, "black_player");
  assert.equal(blackRegistration.data.user.online, true);
  assert.equal("token" in blackRegistration.data, false, "web session token must stay in HttpOnly cookie");
  assert.equal(JSON.stringify(blackRegistration.data).includes("correct-horse-1"), false);
  const blackCookie = sessionCookie(blackRegistration.response);

  const duplicateRegistration = await jsonRequest("/api/auth/session", "POST", {
    mode: "register",
    account: "BLACK_PLAYER",
    nickname: "另一个黑方",
    password: "correct-horse-2",
    avatarId: 4,
  });
  assert.equal(duplicateRegistration.response.status, 409);

  const wrongLogin = await jsonRequest("/api/auth/session", "POST", {
    mode: "login",
    account: "black_player",
    password: "wrong-password",
  });
  assert.equal(wrongLogin.response.status, 401);
  assert.equal(wrongLogin.data.error, "账号或密码不正确");

  const blackLogin = await jsonRequest("/api/auth/session", "POST", {
    mode: "login",
    account: "BLACK_PLAYER",
    password: "correct-horse-1",
  });
  assert.equal(blackLogin.response.status, 200);
  assert.equal(blackLogin.data.user.id, blackRegistration.data.user.id);
  const blackLoginCookie = sessionCookie(blackLogin.response);

  const blackProfile = await rawRequest("/api/me", {}, blackLoginCookie);
  assert.equal(blackProfile.response.status, 200);
  assert.equal(blackProfile.data.user.account, "black_player");
  assert.deepEqual(blackProfile.data.user.stats, { wins: 0, losses: 0, draws: 0, total: 0 });

  const presence = await jsonRequest("/api/presence", "POST", {}, blackLoginCookie);
  assert.equal(presence.response.status, 200);
  assert.equal(presence.data.online, true);

  const whiteRegistration = await jsonRequest("/api/auth/session", "POST", {
    mode: "register",
    account: "white_player",
    nickname: "白方玩家",
    password: "correct-horse-2",
    avatarId: 8,
  });
  assert.equal(whiteRegistration.response.status, 201);
  const whiteCookie = sessionCookie(whiteRegistration.response);

  const created = await jsonRequest("/api/rooms", "POST", {
    action: "create",
    password: "2468",
  }, blackCookie);
  assert.equal(created.response.status, 201);
  assert.equal(created.data.room.blackPlayer.nickname, "黑方玩家");
  assert.equal(created.data.room.blackPlayer.avatarId, 3);
  assert.equal(JSON.stringify(created.data).includes("2468"), false);

  const unauthenticatedJoin = await jsonRequest("/api/rooms", "POST", {
    action: "join",
    id: created.data.room.id,
    password: "2468",
  });
  assert.equal(unauthenticatedJoin.response.status, 401);

  const wrongRoomPassword = await jsonRequest("/api/rooms", "POST", {
    action: "join",
    id: created.data.room.id,
    password: "9999",
  }, whiteCookie);
  assert.equal(wrongRoomPassword.response.status, 403);

  const joined = await jsonRequest("/api/rooms", "POST", {
    action: "join",
    id: created.data.room.id,
    password: "2468",
  }, whiteCookie);
  assert.equal(joined.response.status, 200);
  assert.equal(joined.data.room.whitePlayer.nickname, "白方玩家");

  const roomView = await rawRequest(`/api/rooms?id=${created.data.room.id}`, {}, blackCookie);
  assert.equal(roomView.response.status, 200);
  assert.equal(roomView.data.room.status, "active");

  const anonymousMove = await jsonRequest("/api/rooms", "PATCH", {
    action: "move",
    id: created.data.room.id,
    token: created.data.token,
    index: 112,
  });
  assert.equal(anonymousMove.response.status, 401);

  const blackMove = await jsonRequest("/api/rooms", "PATCH", {
    action: "move",
    id: created.data.room.id,
    index: 112,
  }, blackCookie);
  assert.equal(blackMove.response.status, 200);
  assert.equal(blackMove.data.room.moves.length, 1);

  const logout = await rawRequest("/api/auth/session", { method: "DELETE" }, blackLoginCookie);
  assert.equal(logout.response.status, 200);
  assert.match(logout.response.headers.get("set-cookie") || "", /Max-Age=0/i);
  const afterLogout = await rawRequest("/api/me", {}, blackLoginCookie);
  assert.equal(afterLogout.response.status, 401);

  const db = new DatabaseSync(databasePath);
  const schemaVersion = db.prepare("PRAGMA user_version").get();
  const columns = db.prepare("PRAGMA table_info(users)").all().map((column) => column.name);
  const account = db.prepare(`
    SELECT provider, provider_user_id, password_salt, password_hash
    FROM users WHERE provider = 'local' AND provider_user_id = 'black_player'
  `).get();
  const integrity = db.prepare("PRAGMA integrity_check").get();
  const foreignKeyErrors = db.prepare("PRAGMA foreign_key_check").all();
  assert.equal(schemaVersion.user_version, 3);
  assert.ok(columns.includes("password_salt"));
  assert.ok(columns.includes("password_hash"));
  assert.equal(account.provider, "local");
  assert.ok(account.password_salt);
  assert.ok(account.password_hash);
  assert.notEqual(account.password_hash, "correct-horse-1");
  assert.equal(integrity.integrity_check, "ok");
  assert.deepEqual(foreignKeyErrors, []);
  db.close();

  process.stdout.write("web auth flow passed: migration, register/login cookie, presence, registered-only rooms, logout\n");
} finally {
  await stopServer();
}
