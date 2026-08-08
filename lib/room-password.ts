import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const MIN_PASSWORD_LENGTH = 4;
const MAX_PASSWORD_LENGTH = 16;

function deriveKey(password: string, salt: string) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 32, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export class RoomPasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoomPasswordError";
  }
}

function cleanPassword(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new RoomPasswordError("房间密码格式不正确");
  return value.trim();
}

export async function createRoomPassword(value: unknown) {
  const password = cleanPassword(value);
  if (!password) return { salt: null, hash: null };
  const length = Array.from(password).length;
  if (length < MIN_PASSWORD_LENGTH || length > MAX_PASSWORD_LENGTH) {
    throw new RoomPasswordError("房间密码需为 4–16 个字符，或留空");
  }
  const salt = randomBytes(16).toString("base64url");
  const hash = (await deriveKey(password, salt)).toString("base64url");
  return { salt, hash };
}

export async function verifyRoomPassword(value: unknown, salt: string | null, expectedHash: string | null) {
  if (!salt || !expectedHash) return true;
  let password: string;
  try {
    password = cleanPassword(value);
  } catch {
    return false;
  }
  if (!password) return false;
  const actual = await deriveKey(password, salt);
  const expected = Buffer.from(expectedHash, "base64url");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
