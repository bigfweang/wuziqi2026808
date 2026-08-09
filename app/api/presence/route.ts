import { mutationOriginError } from "../../../lib/request-security";
import { authenticateRequest, isUserOnline } from "../../../lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = authenticateRequest(request);
  if (!session) return Response.json({ error: "登录状态已失效" }, { status: 401 });
  const originError = mutationOriginError(request, session.transport);
  if (originError) return originError;
  return Response.json(
    { online: isUserOnline(session.user) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
