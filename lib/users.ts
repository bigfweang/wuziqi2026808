import { randomBytes, randomInt, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getDb, type RoomRow } from "./db";
import { createUserPassword, UserPasswordError, verifyUserPassword } from "./user-password";

export type UserRow = {
  id: string;
  provider: string;
  provider_user_id: string;
  nickname: string;
  avatar_id: number;
  password_salt: string | null;
  password_hash: string | null;
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
const SESSION_COOKIE_NAME = "pixel_gomoku_session";
const LOCAL_ACCOUNT_PATTERN = /^[a-z0-9_]{3,24}$/;
const DUMMY_PASSWORD_SALT = "pixel-gomoku-missing-account";
const DUMMY_PASSWORD_HASH = Buffer.alloc(32).toString("base64url");

export class UserAuthError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "UserAuthError";
  }
}

export function cleanNickname(value: unknown, fallback = "像素棋手") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? Array.from(trimmed).slice(0, 16).join("") : fallback;
}

export function cleanLocalAccount(value: unknown) {
  if (typeof value !== "string") throw new UserAuthError("请输入账号");
  const account = value.normalize("NFKC").trim().toLowerCase();
  if (!LOCAL_ACCOUNT_PATTERN.test(account)) {
    throw new UserAuthError("账号需为 3–24 位小写字母、数字或下划线");
  }
  return account;
}

function cleanAvatarId(value: unknown) {
  const avatarId = Number(value);
  if (!Number.isInteger(avatarId) || avatarId < 1 || avatarId > 9) {
    throw new UserAuthError("请选择有效头像");
  }
  return avatarId;
}

function dummyPassword(value: unknown) {
  if (typeof value !== "string") return "invalid-password";
  const length = Array.from(value).length;
  return length >= 8 && length <= 64 ? value : "invalid-password";
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

export async function registerLocalUser(input: {
  account: unknown;
  nickname: unknown;
  password: unknown;
  avatarId: unknown;
}) {
  const account = cleanLocalAccount(input.account);
  const nickname = cleanNickname(input.nickname, account);
  const avatarId = cleanAvatarId(input.avatarId);
  let credentials: Awaited<ReturnType<typeof createUserPassword>>;
  try {
    credentials = await createUserPassword(input.password);
  } catch (caught) {
    if (caught instanceof UserPasswordError) throw new UserAuthError(caught.message);
    throw caught;
  }
  const now = new Date().toISOString();
  try {
    return getDb().prepare(`
      INSERT INTO users (
        id, provider, provider_user_id, nickname, avatar_id,
        password_salt, password_hash, created_at, updated_at, last_seen_at
      ) VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      randomUUID(),
      account,
      nickname,
      avatarId,
      credentials.salt,
      credentials.hash,
      now,
      now,
      now,
    ) as UserRow;
  } catch (caught) {
    if (caught instanceof Error && caught.message.includes("UNIQUE constraint failed")) {
      throw new UserAuthError("这个账号已经被注册", 409);
    }
    throw caught;
  }
}

export async function authenticateLocalUser(accountValue: unknown, passwordValue: unknown) {
  let account: string;
  try {
    account = cleanLocalAccount(accountValue);
  } catch {
    await verifyUserPassword(dummyPassword(passwordValue), DUMMY_PASSWORD_SALT, DUMMY_PASSWORD_HASH);
    return undefined;
  }
  const user = getDb().prepare(`
    SELECT * FROM users
    WHERE provider = 'local' AND provider_user_id = ?
    LIMIT 1
  `).get(account) as UserRow | undefined;
  if (!user) {
    await verifyUserPassword(dummyPassword(passwordValue), DUMMY_PASSWORD_SALT, DUMMY_PASSWORD_HASH);
    return undefined;
  }
  if (!(await verifyUserPassword(passwordValue, user.password_salt, user.password_hash))) return undefined;
  const now = new Date().toISOString();
  return getDb().prepare(`
    UPDATE users SET last_seen_at = ?, updated_at = ?
    WHERE id = ? RETURNING *
  `).get(now, now, user.id) as UserRow;
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
  getDb().prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now.toISOString());
  getDb().prepare(`
    INSERT INTO sessions (token, user_id, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(token, userId, now.toISOString(), expiresAt);
  return { token, expiresAt };
}

export function sessionCookie(token: string, expiresAt: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}${secure}`;
}

export function clearSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function deleteSession(token: string) {
  getDb().prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

function requestToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const bearer = /^Bearer\s+([A-Za-z0-9_-]{32,})$/.exec(authorization)?.[1];
  if (bearer) return bearer;
  const cookie = request.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name !== SESSION_COOKIE_NAME) continue;
    const value = valueParts.join("=");
    return /^[A-Za-z0-9_-]{32,}$/.test(value) ? value : undefined;
  }
  return undefined;
}

export function authenticateRequest(request: Request) {
  const token = requestToken(request);
  if (!token) return undefined;
  const user = getDb().prepare(`
    SELECT users.* FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token = ? AND sessions.expires_at > ?
    LIMIT 1
  `).get(token, new Date().toISOString()) as UserRow | undefined;
  if (!user) return undefined;
  const now = new Date().toISOString();
  getDb().prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").run(now, user.id);
  return { token, user: { ...user, last_seen_at: now } };
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

export function selfUser(user: UserRow) {
  return {
    ...publicUser(user),
    account: user.provider === "local" ? user.provider_user_id : null,
    online: isUserOnline(user),
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
