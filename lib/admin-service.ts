import type { DatabaseSync } from "node:sqlite";
import { getDb, withImmediateTransaction } from "./db";
import { createUserPassword, UserPasswordError } from "./user-password";
import { cleanNickname, findUser, isUserOnline, statsFor, type UserRow } from "./users";

export class AdminUserError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "AdminUserError";
  }
}

function cleanUserId(value: unknown) {
  if (typeof value !== "string") throw new AdminUserError("用户标识无效");
  const id = value.trim();
  if (!id || id.length > 128) throw new AdminUserError("用户标识无效");
  return id;
}

function cleanAdminNickname(value: unknown) {
  const nickname = cleanNickname(value, "");
  if (!nickname) throw new AdminUserError("名字不能为空");
  return nickname;
}

function cleanAdminAvatarId(value: unknown) {
  const avatarId = Number(value);
  if (!Number.isInteger(avatarId) || avatarId < 1 || avatarId > 9) {
    throw new AdminUserError("请选择有效头像");
  }
  return avatarId;
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function adminUserView(user: UserRow) {
  return {
    id: user.id,
    account: user.provider === "local" ? user.provider_user_id : null,
    provider: user.provider,
    nickname: user.nickname,
    avatarId: user.avatar_id,
    passwordSet: Boolean(user.password_salt && user.password_hash),
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    lastSeenAt: user.last_seen_at,
    online: isUserOnline(user),
    stats: statsFor(user.id),
  };
}

function requireUser(id: string, db: DatabaseSync = getDb()) {
  const user = db.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").get(id) as UserRow | undefined;
  if (!user) throw new AdminUserError("用户不存在", 404);
  return user;
}

function recordAudit(
  db: DatabaseSync,
  action: "profile.update" | "password.reset",
  targetUserId: string,
  detail: Record<string, unknown>,
) {
  db.prepare(`
    INSERT INTO admin_audit_log (action, target_user_id, detail, created_at)
    VALUES (?, ?, ?, ?)
  `).run(action, targetUserId, JSON.stringify(detail), new Date().toISOString());
}

export function getAdminStats() {
  const now = Date.now();
  const newUserCutoff = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const onlineCutoff = new Date(now - 30_000).toISOString();
  const users = getDb().prepare(`
    SELECT
      COUNT(*) AS total_users,
      COALESCE(SUM(CASE WHEN provider = 'local' THEN 1 ELSE 0 END), 0) AS registered_users,
      COALESCE(SUM(CASE WHEN provider = 'dev' THEN 1 ELSE 0 END), 0) AS dev_users,
      COALESCE(SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END), 0) AS new_users_24h,
      COALESCE(SUM(CASE WHEN last_seen_at >= ? THEN 1 ELSE 0 END), 0) AS online_users
    FROM users
  `).get(newUserCutoff, onlineCutoff) as {
    total_users: number;
    registered_users: number;
    dev_users: number;
    new_users_24h: number;
    online_users: number;
  };
  const matches = getDb().prepare("SELECT COUNT(*) AS count FROM matches").get() as { count: number };
  const rooms = getDb().prepare("SELECT COUNT(*) AS count FROM rooms WHERE status != 'finished'").get() as { count: number };
  return {
    totalUsers: Number(users.total_users),
    registeredUsers: Number(users.registered_users),
    devUsers: Number(users.dev_users),
    newUsers24h: Number(users.new_users_24h),
    onlineUsers: Number(users.online_users),
    totalMatches: Number(matches.count),
    activeRooms: Number(rooms.count),
  };
}

export function listAdminUsers(input: { query?: string | null; limit?: number; offset?: number }) {
  const query = typeof input.query === "string" ? input.query.normalize("NFKC").trim().slice(0, 64) : "";
  const limit = Math.max(1, Math.min(Number.isFinite(input.limit) ? Math.trunc(input.limit as number) : 50, 100));
  const offset = Math.max(0, Math.min(Number.isFinite(input.offset) ? Math.trunc(input.offset as number) : 0, 100_000));
  const pattern = `%${escapeLike(query)}%`;
  const where = query
    ? "WHERE nickname LIKE ? ESCAPE '\\' COLLATE NOCASE OR (provider = 'local' AND provider_user_id LIKE ? ESCAPE '\\' COLLATE NOCASE)"
    : "";
  const parameters = query ? [pattern, pattern] : [];
  const countRow = getDb().prepare(`SELECT COUNT(*) AS count FROM users ${where}`).get(...parameters) as { count: number };
  const rows = getDb().prepare(`
    SELECT * FROM users ${where}
    ORDER BY created_at DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(...parameters, limit, offset) as UserRow[];
  return {
    users: rows.map(adminUserView),
    total: Number(countRow.count),
    limit,
    offset,
  };
}

export function updateAdminUserProfile(input: { userId: unknown; nickname: unknown; avatarId: unknown }) {
  const userId = cleanUserId(input.userId);
  const nickname = cleanAdminNickname(input.nickname);
  const avatarId = cleanAdminAvatarId(input.avatarId);
  const updated = withImmediateTransaction((db) => {
    requireUser(userId, db);
    const now = new Date().toISOString();
    const user = db.prepare(`
      UPDATE users SET nickname = ?, avatar_id = ?, updated_at = ?
      WHERE id = ? RETURNING *
    `).get(nickname, avatarId, now, userId) as UserRow;
    recordAudit(db, "profile.update", userId, { nickname, avatarId });
    return user;
  });
  return adminUserView(updated);
}

export async function resetAdminUserPassword(input: { userId: unknown; password: unknown }) {
  const userId = cleanUserId(input.userId);
  const existing = findUser(userId);
  if (!existing) throw new AdminUserError("用户不存在", 404);
  if (existing.provider !== "local") throw new AdminUserError("开发身份没有可重置的登录密码");
  let credentials: Awaited<ReturnType<typeof createUserPassword>>;
  try {
    credentials = await createUserPassword(input.password);
  } catch (caught) {
    if (caught instanceof UserPasswordError) throw new AdminUserError(caught.message);
    throw caught;
  }
  const updated = withImmediateTransaction((db) => {
    requireUser(userId, db);
    const now = new Date().toISOString();
    const user = db.prepare(`
      UPDATE users
      SET password_salt = ?, password_hash = ?, updated_at = ?
      WHERE id = ? RETURNING *
    `).get(credentials.salt, credentials.hash, now, userId) as UserRow;
    const revoked = db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
    recordAudit(db, "password.reset", userId, { revokedSessions: Number(revoked.changes) });
    return user;
  });
  return adminUserView(updated);
}
