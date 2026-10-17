import { NextResponse } from "next/server";
import { safeRedirectPath } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";
import { authDestination } from "@/lib/passwordFlow";
import type { EmailOtpType } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = safeRedirectPath(requestUrl.searchParams.get("next"));

  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type");
  const redirect = (path: string) => {
    // 相对 Location 保持浏览器正在使用的域名，避免代理内部主机名丢失会话 cookie。
    const response = new NextResponse(null, {
      status: 303,
      headers: { Location: path },
    });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  };
  const failed = () =>
    redirect("/reset-password?error=link_invalid#reset-error");
  if (
    ["error", "error_code", "error_description"].some((key) =>
      requestUrl.searchParams.has(key),
    )
  )
    return failed();
  if (code || tokenHash) {
    try {
      const supabase = createClient();
      if (code && tokenHash) return failed();
      if (
        tokenHash &&
        ![
          "recovery",
          "invite",
          "signup",
          "email",
          "email_change",
          "magiclink",
        ].includes(type || "")
      )
        return failed();
      const { data, error } = code
        ? await supabase.auth.exchangeCodeForSession(code)
        : await supabase.auth.verifyOtp({
            token_hash: tokenHash!,
            type: type as EmailOtpType,
          });
      if (error || !data.user || !data.session) return failed();
      return redirect(authDestination(next, data.user.id, type === "recovery"));
    } catch {
      return failed();
    }
  }
  // fragment 不发送到服务端，必须在专用页面显式验证，不能沿用旧会话。
  return redirect(`/auth/complete?next=${encodeURIComponent(next)}`);
}
