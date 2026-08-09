import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const port = "3467";
const origin = `http://127.0.0.1:${port}`;
const dataDirectory = mkdtempSync(join(tmpdir(), "pixel-gomoku-smoke-"));
let logs = "";

const server = spawn(process.execPath, [".next/standalone/server.js"], {
  cwd: process.cwd(),
  env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: port, DATA_DIR: dataDirectory, ALLOW_DEV_AUTH: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});

server.stdout.on("data", (chunk) => { logs += chunk.toString(); });
server.stderr.on("data", (chunk) => { logs += chunk.toString(); });

async function request(path, init = {}, sessionToken = "") {
  const headers = { ...(init.headers || {}) };
  if (sessionToken) headers.authorization = `Bearer ${sessionToken}`;
  const response = await fetch(`${origin}${path}`, { ...init, headers });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${response.status}: API did not return JSON (${JSON.stringify(text)})\n${logs}`);
  }
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(data)}`);
  return data;
}

async function waitUntilReady() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`server exited early\n${logs}`);
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
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
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /像素五子棋/);

  const blackSession = await request("/api/auth/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "dev", deviceId: "smoke-black-device", nickname: "黑方" }),
  });
  const whiteSession = await request("/api/auth/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "dev", deviceId: "smoke-white-device", nickname: "白方" }),
  });

  const created = await request("/api/rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "create", name: "黑方" }),
  }, blackSession.token);
  assert.equal(created.room.status, "waiting");

  const joined = await request("/api/rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "join", id: created.room.id, name: "白方" }),
  }, whiteSession.token);
  assert.equal(joined.room.status, "active");

  const action = (sessionToken, roomToken, actionName, index) => request("/api/rooms", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: actionName, id: created.room.id, token: roomToken, index }),
  }, sessionToken);

  await action(blackSession.token, created.token, "move", 112);
  const afterWhiteMove = await action(whiteSession.token, joined.token, "move", 113);
  assert.equal(afterWhiteMove.room.moves.length, 2);
  const afterUndo = await action(whiteSession.token, joined.token, "undo");
  assert.equal(afterUndo.room.moves.length, 1);
  const afterResign = await action(whiteSession.token, joined.token, "resign");
  assert.equal(afterResign.room.winner, 1);
  const afterReset = await action(blackSession.token, created.token, "reset");
  assert.equal(afterReset.room.moves.length, 0);
  assert.equal(afterReset.room.status, "active");

  const blackView = await request(
    `/api/rooms?id=${created.room.id}&token=${encodeURIComponent(created.token)}`,
    {},
    blackSession.token,
  );
  assert.equal(blackView.room.blackName, "黑方");
  assert.equal(blackView.room.whiteName, "白方");
  process.stdout.write("smoke test passed: page, create, join, moves, undo, resign, reset, persistence\n");
} finally {
  await stopServer();
}
