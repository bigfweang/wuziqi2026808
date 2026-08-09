import { createHash } from "node:crypto";

const SESSION_TOKEN_PREFIX = "sha256:";

export function hashSessionToken(token: string) {
  return `${SESSION_TOKEN_PREFIX}${createHash("sha256").update(token).digest("base64url")}`;
}

export function isHashedSessionToken(value: string) {
  return value.startsWith(SESSION_TOKEN_PREFIX);
}
