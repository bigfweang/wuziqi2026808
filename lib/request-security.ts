export type AuthTransport = "cookie" | "bearer";

export function mutationOriginError(request: Request, transport?: AuthTransport) {
  const hasBearerHeader = /^Bearer\s+/i.test(request.headers.get("authorization") || "");
  if (transport === "bearer" || (transport === undefined && hasBearerHeader)) {
    return null;
  }
  const origin = request.headers.get("origin");
  let expectedOrigin: string;
  try {
    const requestUrl = new URL(request.url);
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
    const host = forwardedHost || request.headers.get("host")?.trim() || requestUrl.host;
    const protocol = forwardedProto ? `${forwardedProto.replace(/:$/, "")}:` : requestUrl.protocol;
    expectedOrigin = new URL(`${protocol}//${host}`).origin;
  } catch {
    return Response.json({ error: "请求来源无效" }, { status: 403 });
  }
  if (!origin || origin !== expectedOrigin) {
    return Response.json({ error: "请求来源无效" }, { status: 403 });
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return Response.json({ error: "不允许跨站请求" }, { status: 403 });
  }
  return null;
}
