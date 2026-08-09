import { authenticateAdminRequest, isAdminConfigured } from "../../../../lib/admin-auth";
import {
  AdminUserError,
  listAdminUsers,
  resetAdminUserPassword,
  updateAdminUserProfile,
} from "../../../../lib/admin-service";
import { consumeRequestLimit, type RateLimitResult } from "../../../../lib/request-rate-limit";
import { mutationOriginError } from "../../../../lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function error(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function rateLimitError(result: RateLimitResult) {
  return Response.json(
    { error: "操作过于频繁，请稍后再试" },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
  );
}

function authorize(request: Request) {
  if (!isAdminConfigured()) return error("后台尚未配置管理员密码", 503);
  if (!authenticateAdminRequest(request)) return error("请先登录管理后台", 401);
  return null;
}

export function GET(request: Request) {
  const authError = authorize(request);
  if (authError) return authError;
  const url = new URL(request.url);
  const query = url.searchParams.get("query");
  const limit = Number(url.searchParams.get("limit") || "50");
  const offset = Number(url.searchParams.get("offset") || "0");
  return Response.json(listAdminUsers({ query, limit, offset }));
}

export async function PATCH(request: Request) {
  const authError = authorize(request);
  if (authError) return authError;
  const originError = mutationOriginError(request, "cookie");
  if (originError) return originError;
  let payload: {
    action?: string;
    userId?: unknown;
    nickname?: unknown;
    avatarId?: unknown;
    password?: unknown;
  };
  try {
    payload = await request.json() as typeof payload;
  } catch {
    return error("请求内容不是有效 JSON");
  }
  const requestLimit = consumeRequestLimit(
    request,
    typeof payload.userId === "string" ? payload.userId.slice(0, 128) : "invalid-user",
    { scope: "admin-user-write", userLimit: 20, ipLimit: 60, globalLimit: 300 },
  );
  if (!requestLimit.allowed) return rateLimitError(requestLimit);
  try {
    if (payload.action === "profile") {
      return Response.json({
        user: updateAdminUserProfile({
          userId: payload.userId,
          nickname: payload.nickname,
          avatarId: payload.avatarId,
        }),
      });
    }
    if (payload.action === "password") {
      const user = await resetAdminUserPassword({ userId: payload.userId, password: payload.password });
      return Response.json({ ok: true, user });
    }
    return error("不支持的后台操作");
  } catch (caught) {
    if (caught instanceof AdminUserError) return error(caught.message, caught.status);
    console.error("Admin user operation failed", caught);
    return error("后台操作失败，请稍后重试", 500);
  }
}
