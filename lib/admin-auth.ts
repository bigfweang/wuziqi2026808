import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getDb } from "./db";
import { hashSessionToken } from "./session-token";

const ADMIN_SESSION_HOURS = 8;
const MIN_ADMIN_PASSWORD_LENGTH = 16;
const LEGACY_ADMIN_COOKIE_NAME = "pixel_gomoku_admin";
const ADMIN_COOKIE_NAME = process.env.NODE_ENV === "production"
  ? "__Host-pixel_admin"
  : LEGACY_ADMIN_COOKIE_NAME;

function configuredPassword() {
  const value = process.env.ADMIN_PASSWORD;
  if (typeof value !== "string") return null;
  const length = Array.from(value).length;
  return length >= MIN_ADMIN_PASSWORD_LENGTH && length <= 256 ? value : null;
}

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function isAdminConfigured() {
  return configuredPassword() !== null;
}

export function verifyAdminPassword(value: unknown) {
  const expected = configuredPassword();
  if (!expected || typeof value !== "string") return false;
  const length = Array.from(value).length;
  if (length < 1 || length > 256) return false;
  return timingSafeEqual(digest(value), digest(expected));
}

export function requestAdminToken(request: Request) {
  const cookie = request.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name !== ADMIN_COOKIE_NAME) continue;
    const value = valueParts.join("=");
    return /^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
  }
  return undefined;
}

function signAdminNonce(password: string, nonce: string) {
  return createHmac("sha256", password)
    .update("pixel-gomoku-admin-session:", "utf8")
    .update(nonce, "utf8")
    .digest("base64url");
}

function createSignedAdminToken(password: string) {
  const nonce = randomBytes(32).toString("base64url");
  return `${nonce}.${signAdminNonce(password, nonce)}`;
}

function verifySignedAdminToken(password: string, token: string) {
  const [nonce, signature] = token.split(".");
  return Boolean(nonce && signature && safeEqual(signature, signAdminNonce(password, nonce)));
}

export function createAdminSession() {
  const password = configuredPassword();
  if (!password) throw new Error("Admin password is not configured securely");
  const now = new Date();
  const token = createSignedAdminToken(password);
  const expiresAt = new Date(now.getTime() + ADMIN_SESSION_HOURS * 60 * 60 * 1000).toISOString();
  const db = getDb();
  db.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").run(now.toISOString());
  db.prepare(`
    INSERT INTO admin_sessions (token, created_at, expires_at)
    VALUES (?, ?, ?)
  `).run(hashSessionToken(token), now.toISOString(), expiresAt);
  return { token, expiresAt };
}

export function authenticateAdminRequest(request: Request) {
  const password = configuredPassword();
  const token = requestAdminToken(request);
  if (!password || !token || !verifySignedAdminToken(password, token)) return false;
  const row = getDb().prepare(`
    SELECT 1 AS active FROM admin_sessions
    WHERE token = ? AND expires_at > ? LIMIT 1
  `).get(hashSessionToken(token), new Date().toISOString()) as { active: number } | undefined;
  return Boolean(row?.active);
}

export function deleteAdminSession(token: string | undefined) {
  if (!token) return;
  getDb().prepare("DELETE FROM admin_sessions WHERE token = ?").run(hashSessionToken(token));
}

export function adminSessionCookie(token: string, expiresAt: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${ADMIN_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Expires=${new Date(expiresAt).toUTCString()}${secure}`;
}

export function clearAdminSessionCookies() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return Array.from(new Set([ADMIN_COOKIE_NAME, LEGACY_ADMIN_COOKIE_NAME])).map(
    (name) => `${name}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`,
  );
}
