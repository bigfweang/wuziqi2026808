import { consumeRequestLimit, type RateLimitResult } from "../../../../lib/request-rate-limit";
import {
  activeRoomFor,
  authenticateLocalUser,
  authenticateRequest,
  clearSessionCookie,
  createSession,
  deleteSession,
  findOrCreateDevUser,
  registerLocalUser,
  selfUser,
  sessionCookie,
  UserAuthError,
} from "../../../../lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const error = (message: string, status = 400) => Response.json({ error: message }, { status });

function rateLimitError(result: RateLimitResult) {
  return Response.json(
    { error: "尝试过于频繁，请稍后再试" },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
  );
}

function rateIdentity(value: unknown) {
  if (typeof value !== "string") return "invalid-account";
  return value.normalize("NFKC").trim().toLowerCase().slice(0, 32) || "invalid-account";
}

export async function POST(request: Request) {
  let payload: {
    mode?: string;
    account?: string;
    nickname?: string;
    password?: string;
    avatarId?: number;
    deviceId?: string;
  };
  try {
    payload = await request.json() as typeof payload;
  } catch {
    return error("请求内容不是有效 JSON");
  }

  if (payload.mode === "register" || payload.mode === "login") {
    const isRegistration = payload.mode === "register";
    const requestLimit = consumeRequestLimit(request, rateIdentity(payload.account), {
      scope: isRegistration ? "auth-register" : "auth-login",
      userLimit: isRegistration ? 3 : 10,
      ipLimit: isRegistration ? 6 : 20,
      globalLimit: isRegistration ? 20 : 50,
    });
    if (!requestLimit.allowed) return rateLimitError(requestLimit);

    try {
      const user = isRegistration
        ? await registerLocalUser({
          account: payload.account,
          nickname: payload.nickname,
          password: payload.password,
          avatarId: payload.avatarId,
        })
        : await authenticateLocalUser(payload.account, payload.password);
      if (!user) return error("账号或密码不正确", 401);
      const session = createSession(user.id);
      return Response.json({
        user: selfUser(user),
        activeRoom: activeRoomFor(user.id),
        authMode: "local",
      }, {
        status: isRegistration ? 201 : 200,
        headers: { "Set-Cookie": sessionCookie(session.token, session.expiresAt) },
      });
    } catch (caught) {
      if (caught instanceof UserAuthError) return error(caught.message, caught.status);
      console.error("Local authentication failed", caught);
      return error(isRegistration ? "注册失败，请稍后重试" : "登录失败，请稍后重试", 500);
    }
  }

  if (payload.mode !== "dev") return error("不支持的登录方式");
  const devAuthAllowed = process.env.ALLOW_DEV_AUTH === "1" || process.env.NODE_ENV !== "production";
  if (!devAuthAllowed) return error("生产环境未启用开发登录", 403);

  try {
    const user = findOrCreateDevUser(payload.deviceId, payload.nickname);
    const session = createSession(user.id);
    return Response.json({
      token: session.token,
      expiresAt: session.expiresAt,
      user: selfUser(user),
      activeRoom: activeRoomFor(user.id),
      authMode: "dev",
    });
  } catch (caught) {
    return error(caught instanceof Error ? caught.message : "开发登录失败");
  }
}

export async function DELETE(request: Request) {
  const session = authenticateRequest(request);
  if (session) deleteSession(session.token);
  return Response.json(
    { ok: true },
    { headers: { "Set-Cookie": clearSessionCookie() } },
  );
}
