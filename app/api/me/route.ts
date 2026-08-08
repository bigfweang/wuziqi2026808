import {
  activeRoomFor,
  authenticateRequest,
  historyFor,
  publicUser,
} from "../../../lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = authenticateRequest(request);
  if (!session) return Response.json({ error: "登录状态已失效" }, { status: 401 });
  return Response.json({
    user: publicUser(session.user),
    history: historyFor(session.user.id),
    activeRoom: activeRoomFor(session.user.id),
    authMode: session.user.provider,
  });
}
