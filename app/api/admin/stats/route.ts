import { authenticateAdminRequest, isAdminConfigured } from "../../../../lib/admin-auth";
import { getAdminStats } from "../../../../lib/admin-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  if (!isAdminConfigured()) {
    return Response.json({ error: "后台尚未配置管理员密码" }, { status: 503 });
  }
  if (!authenticateAdminRequest(request)) {
    return Response.json({ error: "请先登录管理后台" }, { status: 401 });
  }
  return Response.json({ stats: getAdminStats() });
}
