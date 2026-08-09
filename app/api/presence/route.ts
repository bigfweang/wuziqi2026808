import { authenticateRequest, isUserOnline } from "../../../lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = authenticateRequest(request);
  if (!session) return Response.json({ error: "登录状态已失效" }, { status: 401 });
  return Response.json(
    { online: isUserOnline(session.user) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
