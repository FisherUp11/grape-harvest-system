"use client";
import { useEffect } from "react";

// 兼容仍指向站点首页的旧邮件；fragment 中的凭证只交给专用回调页处理。
export default function AuthLinkBridge() {
  useEffect(() => {
    if (
      window.location.pathname.startsWith("/auth/") ||
      window.location.pathname === "/reset-password"
    )
      return;
    const hash = window.location.hash;
    const params = new URLSearchParams(hash.slice(1));
    if (
      [
        "access_token",
        "refresh_token",
        "error",
        "error_description",
        "error_code",
      ].some((key) => params.has(key))
    ) {
      const next =
        params.get("type") === "recovery" ||
        params.has("error") ||
        params.has("error_code")
          ? "/reset-password"
          : "/dashboard";
      window.location.replace(
        `/auth/complete?next=${encodeURIComponent(next)}${hash}`,
      );
    }
  }, []);
  return null;
}
