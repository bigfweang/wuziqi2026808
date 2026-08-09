import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 64;
const KEY_LENGTH = 32;

function deriveKey(password: string, salt: string) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export class UserPasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserPasswordError";
  }
}

function validatePassword(value: unknown) {
  if (typeof value !== "string") throw new UserPasswordError("密码格式不正确");
  const length = Array.from(value).length;
  if (length < MIN_PASSWORD_LENGTH || length > MAX_PASSWORD_LENGTH) {
    throw new UserPasswordError("密码需为 8–64 个字符");
  }
  return value;
}

export async function createUserPassword(value: unknown) {
  const password = validatePassword(value);
  const salt = randomBytes(16).toString("base64url");
  const hash = (await deriveKey(password, salt)).toString("base64url");
  return { salt, hash };
}

export async function verifyUserPassword(
  value: unknown,
  salt: string | null,
  expectedHash: string | null,
) {
  if (!salt || !expectedHash || typeof value !== "string") return false;
  const length = Array.from(value).length;
  if (length < MIN_PASSWORD_LENGTH || length > MAX_PASSWORD_LENGTH) return false;
  const actual = await deriveKey(value, salt);
  const expected = Buffer.from(expectedHash, "base64url");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
