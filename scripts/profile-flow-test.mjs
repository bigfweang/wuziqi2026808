import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";

const port = "3469";
const origin = `http://127.0.0.1:${port}`;
const dataDirectory = mkdtempSync(join(tmpdir(), "pixel-gomoku-profile-"));
let logs = "";

const legacyDb = new DatabaseSync(join(dataDirectory, "gomoku.db"));
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
    revision INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);
legacyDb.close();

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

async function request(path, init = {}, token) {
  const { response, data, text } = await rawRequest(path, init, token);
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(data)}`);
  if (!data) throw new Error(`${response.status}: API did not return JSON (${JSON.stringify(text)})`);
  return data;
}

async function jsonRequest(path, method, payload, token) {
  return request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }, token);
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

  const blackLogin = await jsonRequest("/api/auth/session", "POST", {
    mode: "dev",
    deviceId: "profile-flow-black",
    nickname: "黑方微信名",
  });
  assert.match(blackLogin.token, /^[A-Za-z0-9_-]{32,}$/);
  assert.equal(blackLogin.user.nickname, "黑方微信名");
  assert.ok(blackLogin.user.avatarId >= 1 && blackLogin.user.avatarId <= 9);
  assert.deepEqual(blackLogin.user.stats, { wins: 0, losses: 0, draws: 0, total: 0 });

  const whiteLogin = await jsonRequest("/api/auth/session", "POST", {
    mode: "dev",
    deviceId: "profile-flow-white",
    nickname: "白方微信名",
  });
  assert.notEqual(whiteLogin.user.id, blackLogin.user.id);

  const created = await jsonRequest("/api/rooms", "POST", { action: "create" }, blackLogin.token);
  assert.equal(created.room.blackPlayer.nickname, "黑方微信名");
  assert.equal(created.room.blackPlayer.avatarId, blackLogin.user.avatarId);
  assert.equal(created.room.blackPlayer.online, true);
  assert.equal(created.room.whitePlayer, null);

  const joined = await jsonRequest("/api/rooms", "POST", {
    action: "join",
    id: created.room.id,
  }, whiteLogin.token);
  assert.equal(joined.room.whitePlayer.nickname, "白方微信名");
  assert.equal(joined.room.whitePlayer.avatarId, whiteLogin.user.avatarId);
  assert.equal(joined.room.whitePlayer.online, true);

  const conflictingIdentity = await rawRequest(
    `/api/rooms?id=${created.room.id}&token=${encodeURIComponent(created.token)}`,
    {},
    whiteLogin.token,
  );
  assert.equal(conflictingIdentity.response.status, 403, "session and seat token must resolve to the same player");

  const action = (sessionToken, roomToken, actionName, index) => jsonRequest("/api/rooms", "PATCH", {
    action: actionName,
    id: created.room.id,
    token: roomToken,
    index,
  }, sessionToken);

  for (const [sessionToken, roomToken, index] of [
    [blackLogin.token, created.token, 0],
    [whiteLogin.token, joined.token, 15],
    [blackLogin.token, created.token, 1],
    [whiteLogin.token, joined.token, 16],
    [blackLogin.token, created.token, 2],
    [whiteLogin.token, joined.token, 17],
    [blackLogin.token, created.token, 3],
    [whiteLogin.token, joined.token, 18],
  ]) {
    await action(sessionToken, roomToken, "move", index);
  }

  const failureDb = new DatabaseSync(join(dataDirectory, "gomoku.db"));
  failureDb.exec(`
    PRAGMA busy_timeout = 5000;
    CREATE TRIGGER fail_match_insert
    BEFORE INSERT ON matches
    BEGIN
      SELECT RAISE(ABORT, 'forced match failure');
    END;
  `);
  failureDb.close();

  const failedFinish = await rawRequest("/api/rooms", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "move",
      id: created.room.id,
      token: created.token,
      index: 4,
    }),
  }, blackLogin.token);
  assert.equal(failedFinish.response.status, 500, "forced match insert failure should fail the command");

  const rollbackDb = new DatabaseSync(join(dataDirectory, "gomoku.db"));
  const rolledBackRoom = rollbackDb.prepare(
    "SELECT status, winner, moves FROM rooms WHERE id = ?",
  ).get(created.room.id);
  const matchCountAfterFailure = rollbackDb.prepare(
    "SELECT COUNT(*) AS count FROM matches WHERE room_id = ?",
  ).get(created.room.id);
  assert.equal(rolledBackRoom.status, "active", "room finish must roll back when match insert fails");
  assert.equal(rolledBackRoom.winner, 0);
  assert.equal(JSON.parse(rolledBackRoom.moves).length, 8);
  assert.equal(matchCountAfterFailure.count, 0);
  rollbackDb.exec("DROP TRIGGER fail_match_insert");
  rollbackDb.close();

  const finished = await action(blackLogin.token, created.token, "move", 4);
  assert.equal(finished.room.status, "finished");
  assert.equal(finished.room.winner, 1);

  const blackProfile = await request("/api/me", {}, blackLogin.token);
  assert.deepEqual(blackProfile.user.stats, { wins: 1, losses: 0, draws: 0, total: 1 });
  assert.equal(blackProfile.history.length, 1);
  assert.equal(blackProfile.history[0].result, "win");
  assert.match(blackProfile.history[0].endedAt, /^\d{4}-\d{2}-\d{2}T/);

  const whiteProfile = await request("/api/me", {}, whiteLogin.token);
  assert.deepEqual(whiteProfile.user.stats, { wins: 0, losses: 1, draws: 0, total: 1 });
  assert.equal(whiteProfile.history[0].result, "loss");

  const repeatedRead = await request(`/api/rooms?id=${created.room.id}&token=${encodeURIComponent(created.token)}`, {}, blackLogin.token);
  assert.equal(repeatedRead.room.winner, 1);
  const afterRepeatedRead = await request("/api/me", {}, blackLogin.token);
  assert.equal(afterRepeatedRead.user.stats.wins, 1, "finished room must only be scored once");

  const undoFinished = await rawRequest("/api/rooms", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "undo", id: created.room.id, token: created.token }),
  }, blackLogin.token);
  assert.equal(undoFinished.response.status, 409, "finished round must not be undoable");

  const reset = await action(blackLogin.token, created.token, "reset");
  assert.equal(reset.room.status, "active");
  assert.equal(reset.room.moves.length, 0);
  assert.equal(reset.room.round, 2);
  assert.equal(reset.room.revision > finished.room.revision, true);

  const roundDb = new DatabaseSync(join(dataDirectory, "gomoku.db"));
  const settledRound = roundDb.prepare(
    "SELECT round FROM matches WHERE room_id = ?",
  ).get(created.room.id);
  const currentRound = roundDb.prepare(
    "SELECT round FROM rooms WHERE id = ?",
  ).get(created.room.id);
  const schemaVersion = roundDb.prepare("PRAGMA user_version").get();
  const userColumns = roundDb.prepare("PRAGMA table_info(users)").all().map((column) => column.name);
  const integrity = roundDb.prepare("PRAGMA integrity_check").get();
  const foreignKeyErrors = roundDb.prepare("PRAGMA foreign_key_check").all();
  assert.equal(settledRound.round, 1);
  assert.equal(currentRound.round, 2);
  assert.equal(schemaVersion.user_version, 4);
  assert.ok(userColumns.includes("password_salt"));
  assert.ok(userColumns.includes("password_hash"));
  assert.equal(integrity.integrity_check, "ok");
  assert.deepEqual(foreignKeyErrors, []);
  roundDb.close();

  const resetActive = await rawRequest("/api/rooms", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "reset", id: created.room.id, token: created.token }),
  }, blackLogin.token);
  assert.equal(resetActive.response.status, 409, "active round must not be resettable");

  const afterResetProfile = await request("/api/me", {}, blackLogin.token);
  assert.equal(afterResetProfile.user.stats.wins, 1, "starting the next round must not alter prior scoring");

  const drawPattern = Array.from({ length: 225 }, (_, index) => {
    const row = Math.floor(index / 15);
    const column = index % 15;
    return (row + 2 * column + 3) % 4 < 2 ? 1 : 2;
  });
  assert.equal(drawPattern.at(-1), 1);
  assert.equal(drawPattern.filter((stone) => stone === 1).length, 113);
  assert.equal(drawPattern.filter((stone) => stone === 2).length, 112);
  const drawBoard = [...drawPattern];
  drawBoard[224] = 0;
  const drawMoves = drawBoard.flatMap((stone, index) => stone ? [{ index, stone }] : []);
  const drawDb = new DatabaseSync(join(dataDirectory, "gomoku.db"));
  drawDb.prepare(`
    UPDATE rooms
    SET board = ?, moves = ?, turn = 1, status = 'active', winner = 0, revision = revision + 1
    WHERE id = ?
  `).run(drawBoard.join(""), JSON.stringify(drawMoves), created.room.id);
  drawDb.close();

  const drawFinished = await action(blackLogin.token, created.token, "move", 224);
  assert.equal(drawFinished.room.status, "finished");
  assert.equal(drawFinished.room.winner, 0);
  assert.equal(drawFinished.room.moves.length, 225);
  const blackAfterDraw = await request("/api/me", {}, blackLogin.token);
  const whiteAfterDraw = await request("/api/me", {}, whiteLogin.token);
  assert.deepEqual(blackAfterDraw.user.stats, { wins: 1, losses: 0, draws: 1, total: 2 });
  assert.deepEqual(whiteAfterDraw.user.stats, { wins: 0, losses: 1, draws: 1, total: 2 });
  assert.equal(blackAfterDraw.history[0].result, "draw");
  const resetDraw = await action(whiteLogin.token, joined.token, "reset");
  assert.equal(resetDraw.room.status, "active");
  assert.equal(resetDraw.room.round, 3);

  const blackLoginAgain = await jsonRequest("/api/auth/session", "POST", {
    mode: "dev",
    deviceId: "profile-flow-black",
    nickname: "黑方微信名",
  });
  assert.equal(blackLoginAgain.user.id, blackLogin.user.id);
  assert.equal(blackLoginAgain.user.avatarId, blackLogin.user.avatarId);
  assert.equal(blackLoginAgain.user.stats.wins, 1);
  assert.equal(blackLoginAgain.user.stats.draws, 1);

  process.stdout.write("profile flow passed: stable user/avatar, presence, win/draw scoring, reset, history, resume identity\n");
} finally {
  await stopServer();
}
