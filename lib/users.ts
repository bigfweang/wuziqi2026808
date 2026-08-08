import { randomBytes, randomInt, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getDb, type RoomRow } from "./db";

export type UserRow = {
  id: string;
  provider: string;
  provider_user_id: string;
  nickname: string;
  avatar_id: number;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
};

export type UserStats = {
  wins: number;
  losses: number;
  draws: number;
  total: number;
};

type MatchRow = {
  id: string;
  room_id: string;
  round: number;
  black_user_id: string | null;
  white_user_id: string | null;
  winner_user_id: string | null;
  result: "black" | "white" | "draw";
  ended_at: string;
};

const SESSION_DAYS = 180;
const ONLINE_WINDOW_MS = 30_000;

export function cleanNickname(value: unknown, fallback = "像素棋手") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? Array.from(trimmed).slice(0, 16).join("") : fallback;
}

function cleanDeviceId(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9_-]{8,128}$/.test(trimmed) ? trimmed : null;
}

export function findUser(id: string | null | undefined) {
  if (!id) return undefined;
  return getDb().prepare("SELECT * FROM users WHERE id = ? LIMIT 1").get(id) as UserRow | undefined;
}

export function findOrCreateDevUser(deviceIdValue: unknown, nicknameValue: unknown) {
  const deviceId = cleanDeviceId(deviceIdValue);
  if (!deviceId) throw new Error("开发设备标识无效");
  const now = new Date().toISOString();
  const existing = getDb().prepare(
    "SELECT * FROM users WHERE provider = 'dev' AND provider_user_id = ? LIMIT 1",
  ).get(deviceId) as UserRow | undefined;
  if (existing) {
    const nickname = cleanNickname(nicknameValue, existing.nickname);
    return getDb().prepare(`
      UPDATE users SET nickname = ?, updated_at = ?, last_seen_at = ?
      WHERE id = ? RETURNING *
    `).get(nickname, now, now, existing.id) as UserRow;
  }
  return getDb().prepare(`
    INSERT INTO users (
      id, provider, provider_user_id, nickname, avatar_id,
      created_at, updated_at, last_seen_at
    ) VALUES (?, 'dev', ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).get(
    randomUUID(),
    deviceId,
    cleanNickname(nicknameValue),
    randomInt(1, 10),
    now,
    now,
    now,
  ) as UserRow;
}

export function createSession(userId: string) {
  const now = new Date();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86_400_000).toISOString();
  getDb().prepare(`
    INSERT INTO sessions (token, user_id, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(token, userId, now.toISOString(), expiresAt);
  return { token, expiresAt };
}

export function authenticateRequest(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const match = /^Bearer\s+([A-Za-z0-9_-]{32,})$/.exec(authorization);
  if (!match) return undefined;
  const user = getDb().prepare(`
    SELECT users.* FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token = ? AND sessions.expires_at > ?
    LIMIT 1
  `).get(match[1], new Date().toISOString()) as UserRow | undefined;
  if (!user) return undefined;
  const now = new Date().toISOString();
  getDb().prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").run(now, user.id);
  return { token: match[1], user: { ...user, last_seen_at: now } };
}

export function statsFor(userId: string): UserStats {
  const rows = getDb().prepare(`
    SELECT result, winner_user_id FROM matches
    WHERE black_user_id = ? OR white_user_id = ?
  `).all(userId, userId) as Array<Pick<MatchRow, "result" | "winner_user_id">>;
  let wins = 0, losses = 0, draws = 0;
  for (const row of rows) {
    if (row.result === "draw") draws += 1;
    else if (row.winner_user_id === userId) wins += 1;
    else losses += 1;
  }
  return { wins, losses, draws, total: rows.length };
}

export function publicUser(user: UserRow) {
  return {
    id: user.id,
    nickname: user.nickname,
    avatarId: user.avatar_id,
    stats: statsFor(user.id),
  };
}

export function isUserOnline(user: UserRow | undefined) {
  if (!user) return false;
  const seenAt = Date.parse(user.last_seen_at);
  return Number.isFinite(seenAt) && Date.now() - seenAt <= ONLINE_WINDOW_MS;
}

export function playerView(userId: string | null, fallbackName: string | null, fallbackAvatarId: number) {
  const user = findUser(userId);
  return {
    id: user?.id || null,
    nickname: user?.nickname || fallbackName || "棋手",
    avatarId: user?.avatar_id || fallbackAvatarId,
    online: user ? isUserOnline(user) : true,
  };
}

export function activeRoomFor(userId: string) {
  const room = getDb().prepare(`
    SELECT * FROM rooms
    WHERE status != 'finished' AND (black_user_id = ? OR white_user_id = ?)
    ORDER BY updated_at DESC LIMIT 1
  `).get(userId, userId) as RoomRow | undefined;
  if (!room) return null;
  const side = room.black_user_id === userId ? 1 : 2;
  return {
    id: room.id,
    side,
    status: room.status,
    updatedAt: room.updated_at,
  };
}

export function historyFor(userId: string, limit = 30) {
  const rows = getDb().prepare(`
    SELECT * FROM matches
    WHERE black_user_id = ? OR white_user_id = ?
    ORDER BY ended_at DESC LIMIT ?
  `).all(userId, userId, Math.max(1, Math.min(limit, 100))) as MatchRow[];
  return rows.map((row) => {
    const isBlack = row.black_user_id === userId;
    const opponentId = isBlack ? row.white_user_id : row.black_user_id;
    const opponent = findUser(opponentId);
    const result = row.result === "draw" ? "draw" : row.winner_user_id === userId ? "win" : "loss";
    return {
      id: row.id,
      roomId: row.room_id,
      round: row.round,
      result,
      opponent: opponent ? {
        id: opponent.id,
        nickname: opponent.nickname,
        avatarId: opponent.avatar_id,
      } : null,
      endedAt: row.ended_at,
    };
  });
}

export function recordFinishedMatch(room: RoomRow, db: DatabaseSync = getDb()) {
  if (room.status !== "finished") return;
  if (!room.black_user_id && !room.white_user_id) return;
  const winnerUserId = room.winner === 1
    ? room.black_user_id
    : room.winner === 2
      ? room.white_user_id
      : null;
  const result = room.winner === 1 ? "black" : room.winner === 2 ? "white" : "draw";
  db.prepare(`
    INSERT OR IGNORE INTO matches (
      id, room_id, round, black_user_id, white_user_id,
      winner_user_id, result, ended_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    room.id,
    room.round,
    room.black_user_id,
    room.white_user_id,
    winnerUserId,
    result,
    room.updated_at,
  );
}
