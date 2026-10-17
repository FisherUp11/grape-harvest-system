import type { SupabaseClient } from "@supabase/supabase-js";
import { safeRedirectPath } from "./utils";

export function authDestination(
  next: string | null,
  userId: string,
  recovery = false,
) {
  const url = new URL(safeRedirectPath(next), "https://app.invalid");
  if (recovery || url.pathname === "/reset-password") {
    url.pathname = "/reset-password";
    url.search = "";
    url.searchParams.set("flow", "recovery");
    // 绑定已验证的账号，此 ID 本身不授予任何权限。
    url.searchParams.set("account", userId);
  }
  return url.pathname + url.search;
}
export function passwordErrorMessage(error: unknown) {
  const code = (error as { code?: string; name?: string })?.code;
  if (code === "account_changed")
    return "当前登录账号已变化。为避免改错账号，请重新登录或重新申请密码重置邮件。";
  if (
    [
      "session_not_found",
      "session_expired",
      "refresh_token_not_found",
      "refresh_token_already_used",
    ].includes(code || "") ||
    (error as { name?: string })?.name === "AuthSessionMissingError"
  )
    return "登录或重置会话已失效，请重新登录或申请新的重置邮件。";
  if (code === "weak_password")
    return "密码未满足当前项目的安全规则，请使用更长的密码并组合字母、数字和符号。";
  if (code === "same_password")
    return "新密码不能与当前密码相同，请换一个密码。";
  if (
    ["reauthentication_needed", "reauthentication_not_valid"].includes(
      code || "",
    )
  )
    return "本次修改需要重新验证身份，请从登录页重新申请密码重置邮件。";
  if (
    [
      "over_request_rate_limit",
      "over_email_send_rate_limit",
      "over_request_limit",
    ].includes(code || "")
  )
    return "操作过于频繁，请稍后重试。";
  return "密码未确认保存成功，请检查网络后重试；若持续失败，请重新申请重置邮件。";
}
export async function updatePasswordForAccount(
  auth: Pick<SupabaseClient["auth"], "getUser" | "updateUser">,
  userId: string,
  password: string,
) {
  const { data: current, error: identityError } = await auth.getUser();
  if (identityError) throw identityError;
  if (!current.user || current.user.id !== userId)
    throw { code: "account_changed" };
  const { data, error } = await auth.updateUser({ password });
  if (error) throw error;
  if (!data.user || data.user.id !== userId) throw { code: "account_changed" };
}
