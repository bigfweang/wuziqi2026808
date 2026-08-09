import {
  adminSessionCookie,
  authenticateAdminRequest,
  clearAdminSessionCookies,
  createAdminSession,
  deleteAdminSession,
  isAdminConfigured,
  requestAdminToken,
  verifyAdminPassword,
} from "../../../../lib/admin-auth";
import { consumeRequestLimit, type RateLimitResult } from "../../../../lib/request-rate-limit";
import { mutationOriginError } from "../../../../lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const error = (message: string, status: number) => Response.json({ error: message }, { status });

function rateLimitError(result: RateLimitResult) {
  return Response.json(
    { error: "尝试过于频繁，请稍后再试" },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
  );
}

function configurationError() {
  return Response.json(
    { error: "后台尚未配置管理员密码", configured: false },
    { status: 503 },
  );
}

export function GET(request: Request) {
  if (!isAdminConfigured()) return configurationError();
  if (!authenticateAdminRequest(request)) {
    return Response.json({ authenticated: false, configured: true }, { status: 401 });
  }
  return Response.json({ authenticated: true, configured: true });
}

export async function POST(request: Request) {
  const originError = mutationOriginError(request, "cookie");
  if (originError) return originError;
  if (!isAdminConfigured()) return configurationError();
  const requestLimit = consumeRequestLimit(request, "administrator", {
    scope: "admin-login",
    userLimit: 100,
    ipLimit: 5,
    globalLimit: 100,
    windowMs: 5 * 60_000,
  });
  if (!requestLimit.allowed) return rateLimitError(requestLimit);
  let payload: { password?: unknown };
  try {
    payload = await request.json() as typeof payload;
  } catch {
    return error("请求内容不是有效 JSON", 400);
  }
  if (!verifyAdminPassword(payload.password)) return error("管理员密码不正确", 401);
  const session = createAdminSession();
  return Response.json(
    { authenticated: true, configured: true, expiresAt: session.expiresAt },
    { headers: { "Set-Cookie": adminSessionCookie(session.token, session.expiresAt) } },
  );
}

export function DELETE(request: Request) {
  const originError = mutationOriginError(request, "cookie");
  if (originError) return originError;
  deleteAdminSession(requestAdminToken(request));
  const headers = new Headers();
  for (const cookie of clearAdminSessionCookies()) headers.append("Set-Cookie", cookie);
  return Response.json({ ok: true }, { headers });
}
