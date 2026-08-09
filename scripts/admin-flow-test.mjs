import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";

const port = "3478";
const origin = `http://127.0.0.1:${port}`;
const dataDirectory = mkdtempSync(join(tmpdir(), "pixel-gomoku-admin-"));
const databasePath = join(dataDirectory, "gomoku.db");
const adminPassword = "admin-test-password-2026";
let logs = "";

const server = spawn(process.execPath, [".next/standalone/server.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    HOSTNAME: "127.0.0.1",
    PORT: port,
    DATA_DIR: dataDirectory,
    ALLOW_DEV_AUTH: "0",
    ADMIN_PASSWORD: adminPassword,
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

async function jsonRequest(path, method, payload, cookie = "", requestOrigin = origin) {
  return rawRequest(path, {
    method,
    headers: { "content-type": "application/json", origin: requestOrigin },
    body: JSON.stringify(payload),
  }, cookie);
}

function cookieFrom(response, name) {
  const value = response.headers.get("set-cookie") || "";
  const match = new RegExp(`${name}=([^;]+)`).exec(value);
  assert.ok(match, `missing ${name} cookie in ${value}`);
  return `${name}=${match[1]}`;
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

  const unauthenticatedStats = await rawRequest("/api/admin/stats");
  assert.equal(unauthenticatedStats.response.status, 401);

  const missingOriginLogin = await rawRequest("/api/admin/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: adminPassword }),
  });
  assert.equal(missingOriginLogin.response.status, 403);

  const crossSiteLogin = await jsonRequest(
    "/api/admin/session",
    "POST",
    { password: adminPassword },
    "",
    "https://evil.example",
  );
  assert.equal(crossSiteLogin.response.status, 403);

  const bearerHeaderLoginBypass = await rawRequest("/api/admin/session", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://evil.example",
      authorization: "Bearer ignored-by-admin",
    },
    body: JSON.stringify({ password: adminPassword }),
  });
  assert.equal(bearerHeaderLoginBypass.response.status, 403);

  const wrongAdminLogin = await jsonRequest("/api/admin/session", "POST", { password: "wrong-admin-password" });
  assert.equal(wrongAdminLogin.response.status, 401);
  assert.equal(wrongAdminLogin.response.headers.get("set-cookie"), null);

  const adminLogin = await jsonRequest("/api/admin/session", "POST", { password: adminPassword });
  assert.equal(adminLogin.response.status, 200);
  assert.equal(adminLogin.data.authenticated, true);
  const adminSetCookie = adminLogin.response.headers.get("set-cookie") || "";
  assert.match(adminSetCookie, /__Host-pixel_admin=/);
  assert.match(adminSetCookie, /HttpOnly/i);
  assert.match(adminSetCookie, /SameSite=Strict/i);
  assert.match(adminSetCookie, /Secure/i);
  const adminCookie = cookieFrom(adminLogin.response, "__Host-pixel_admin");

  const adminSession = await rawRequest("/api/admin/session", {}, adminCookie);
  assert.equal(adminSession.response.status, 200);
  assert.equal(adminSession.data.authenticated, true);

  const firstRegistration = await jsonRequest("/api/auth/session", "POST", {
    mode: "register",
    account: "admin_user_one",
    nickname: "原名字",
    password: "original-password-1",
    avatarId: 2,
  });
  assert.equal(firstRegistration.response.status, 201);
  const firstUserCookie = cookieFrom(firstRegistration.response, "__Host-pixel_session");
  const firstUserId = firstRegistration.data.user.id;

  const secondRegistration = await jsonRequest("/api/auth/session", "POST", {
    mode: "register",
    account: "admin_user_two",
    nickname: "第二位用户",
    password: "original-password-2",
    avatarId: 7,
  });
  assert.equal(secondRegistration.response.status, 201);

  const stats = await rawRequest("/api/admin/stats", {}, adminCookie);
  assert.equal(stats.response.status, 200);
  assert.equal(stats.data.stats.totalUsers, 2);
  assert.equal(stats.data.stats.registeredUsers, 2);
  assert.equal(stats.data.stats.devUsers, 0);
  assert.equal(stats.data.stats.newUsers24h, 2);
  assert.ok(stats.data.stats.onlineUsers >= 2);
  assert.equal(stats.data.stats.totalMatches, 0);
  assert.equal(stats.data.stats.activeRooms, 0);

  const users = await rawRequest("/api/admin/users?query=admin_user&limit=20&offset=0", {}, adminCookie);
  assert.equal(users.response.status, 200);
  assert.equal(users.data.total, 2);
  assert.equal(users.data.users.length, 2);
  const firstAdminUser = users.data.users.find((user) => user.id === firstUserId);
  assert.ok(firstAdminUser);
  assert.equal(firstAdminUser.account, "admin_user_one");
  assert.equal(firstAdminUser.nickname, "原名字");
  assert.equal(firstAdminUser.avatarId, 2);
  assert.equal(firstAdminUser.passwordSet, true);
  const serializedUsers = JSON.stringify(users.data);
  assert.equal(serializedUsers.includes("password_hash"), false);
  assert.equal(serializedUsers.includes("password_salt"), false);
  assert.equal(serializedUsers.includes("original-password"), false);

  const missingOriginUpdate = await rawRequest("/api/admin/users", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "profile", userId: firstUserId, nickname: "不应生效", avatarId: 1 }),
  }, adminCookie);
  assert.equal(missingOriginUpdate.response.status, 403);

  const bearerHeaderUpdateBypass = await rawRequest("/api/admin/users", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      origin: "https://evil.example",
      authorization: "Bearer ignored-by-admin",
    },
    body: JSON.stringify({ action: "profile", userId: firstUserId, nickname: "不应生效", avatarId: 1 }),
  }, adminCookie);
  assert.equal(bearerHeaderUpdateBypass.response.status, 403);

  const updated = await jsonRequest("/api/admin/users", "PATCH", {
    action: "profile",
    userId: firstUserId,
    nickname: "新名字",
    avatarId: 9,
  }, adminCookie);
  assert.equal(updated.response.status, 200);
  assert.equal(updated.data.user.nickname, "新名字");
  assert.equal(updated.data.user.avatarId, 9);

  const userProfile = await rawRequest("/api/me", {}, firstUserCookie);
  assert.equal(userProfile.response.status, 200);
  assert.equal(userProfile.data.user.nickname, "新名字");
  assert.equal(userProfile.data.user.avatarId, 9);

  const newPassword = "replacement-password-9";
  const reset = await jsonRequest("/api/admin/users", "PATCH", {
    action: "password",
    userId: firstUserId,
    password: newPassword,
  }, adminCookie);
  assert.equal(reset.response.status, 200);
  assert.equal(reset.data.ok, true);
  assert.equal(JSON.stringify(reset.data).includes(newPassword), false);

  const revokedProfile = await rawRequest("/api/me", {}, firstUserCookie);
  assert.equal(revokedProfile.response.status, 401, "password reset must revoke existing user sessions");

  const oldPasswordLogin = await jsonRequest("/api/auth/session", "POST", {
    mode: "login",
    account: "admin_user_one",
    password: "original-password-1",
  });
  assert.equal(oldPasswordLogin.response.status, 401);

  const newPasswordLogin = await jsonRequest("/api/auth/session", "POST", {
    mode: "login",
    account: "admin_user_one",
    password: newPassword,
  });
  assert.equal(newPasswordLogin.response.status, 200);

  const filteredUsers = await rawRequest("/api/admin/users?query=%E6%96%B0%E5%90%8D%E5%AD%97", {}, adminCookie);
  assert.equal(filteredUsers.response.status, 200);
  assert.equal(filteredUsers.data.total, 1);
  assert.equal(filteredUsers.data.users[0].id, firstUserId);

  const db = new DatabaseSync(databasePath);
  const schemaVersion = db.prepare("PRAGMA user_version").get().user_version;
  const adminSessionColumns = db.prepare("PRAGMA table_info(admin_sessions)").all().map((column) => column.name);
  const storedAdminSessions = db.prepare("SELECT token FROM admin_sessions").all();
  const auditRows = db.prepare("SELECT action, target_user_id, detail FROM admin_audit_log ORDER BY id").all();
  const storedUser = db.prepare("SELECT nickname, avatar_id, password_hash FROM users WHERE id = ?").get(firstUserId);
  const activeSessions = db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?").get(firstUserId).count;
  assert.equal(schemaVersion, 6);
  assert.deepEqual(adminSessionColumns, ["token", "created_at", "expires_at"]);
  assert.equal(storedAdminSessions.length, 1);
  assert.match(storedAdminSessions[0].token, /^sha256:[A-Za-z0-9_-]+$/);
  assert.equal(JSON.stringify(storedAdminSessions).includes(adminPassword), false);
  assert.equal(storedUser.nickname, "新名字");
  assert.equal(storedUser.avatar_id, 9);
  assert.ok(storedUser.password_hash);
  assert.notEqual(storedUser.password_hash, newPassword);
  assert.deepEqual(auditRows.map((row) => row.action), ["profile.update", "password.reset"]);
  assert.ok(auditRows.every((row) => row.target_user_id === firstUserId));
  assert.equal(JSON.stringify(auditRows).includes(newPassword), false);
  assert.equal(activeSessions, 1, "only the new login session should remain after reset");
  db.close();

  const adminLogout = await rawRequest("/api/admin/session", {
    method: "DELETE",
    headers: { origin },
  }, adminCookie);
  assert.equal(adminLogout.response.status, 200);
  assert.match(adminLogout.response.headers.get("set-cookie") || "", /Max-Age=0/i);
  const afterLogout = await rawRequest("/api/admin/stats", {}, adminCookie);
  assert.equal(afterLogout.response.status, 401);

  process.stdout.write("admin flow passed: auth, stats, search, profile edit, secure password reset, audit\n");
} finally {
  await stopServer();
}
