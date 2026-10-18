// Vercel/反向代理可能在 request.url 中使用内部地址，以代理传入的公开主机为准。
export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const incoming = new URL(request.url);
    const host =
      request.headers.get("x-forwarded-host") ||
      request.headers.get("host") ||
      incoming.host;
    const protocol =
      request.headers.get("x-forwarded-proto") ||
      incoming.protocol.replace(":", "");
    const publicOrigin = new URL(`${protocol}://${host}`).origin;
    return new URL(origin).origin === publicOrigin && publicOrigin !== "null";
  } catch {
    return false;
  }
}
