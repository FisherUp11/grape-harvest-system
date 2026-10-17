import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { updatePasswordForAccount } from "@/lib/passwordFlow";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const fail = (code: string, status: number) =>
    NextResponse.json(
      { error: code },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  const origin = request.headers.get("origin"),
    host =
      request.headers.get("x-forwarded-host") ||
      request.headers.get("host") ||
      new URL(request.url).host;
  if (origin) {
    try {
      if (new URL(origin).host !== host) return fail("origin_mismatch", 403);
    } catch {
      return fail("origin_mismatch", 403);
    }
  }
  try {
    const body = await request.json();
    if (typeof body?.account !== "string" || typeof body?.password !== "string")
      return fail("invalid_request", 400);
    if (body.password.length < 8) return fail("weak_password", 400);
    // 此客户端只读取本次请求的 cookie，不受其他标签页切换账号影响。
    await updatePasswordForAccount(
      createClient().auth,
      body.account,
      body.password,
    );
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const code = (error as { code?: string; name?: string })?.code;
    const known = [
      "account_changed",
      "weak_password",
      "same_password",
      "reauthentication_needed",
      "reauthentication_not_valid",
      "session_not_found",
      "session_expired",
      "refresh_token_not_found",
      "refresh_token_already_used",
      "over_request_rate_limit",
    ];
    const safe = known.includes(code || "")
      ? code!
      : (error as { name?: string })?.name === "AuthSessionMissingError"
        ? "session_not_found"
        : "password_update_failed";
    return fail(
      safe,
      ["account_changed", "session_not_found", "session_expired"].includes(safe)
        ? 401
        : 400,
    );
  }
}
