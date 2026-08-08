import {
  activeRoomFor,
  createSession,
  findOrCreateDevUser,
  publicUser,
} from "../../../../lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const error = (message: string, status = 400) => Response.json({ error: message }, { status });

export async function POST(request: Request) {
  let payload: { mode?: string; deviceId?: string; nickname?: string };
  try {
    payload = await request.json() as typeof payload;
  } catch {
    return error("请求内容不是有效 JSON");
  }

  if (payload.mode !== "dev") return error("当前只启用开发登录，微信账号接入后会切换为 wx.login", 501);
  const devAuthAllowed = process.env.ALLOW_DEV_AUTH === "1" || process.env.NODE_ENV !== "production";
  if (!devAuthAllowed) return error("生产环境未启用开发登录", 403);

  try {
    const user = findOrCreateDevUser(payload.deviceId, payload.nickname);
    const session = createSession(user.id);
    return Response.json({
      token: session.token,
      expiresAt: session.expiresAt,
      user: publicUser(user),
      activeRoom: activeRoomFor(user.id),
      authMode: "dev",
    });
  } catch (caught) {
    return error(caught instanceof Error ? caught.message : "开发登录失败");
  }
}
