"use client";
import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { authDestination } from "@/lib/passwordFlow";

export default function AuthCompleteClient() {
  const task = useRef<Promise<string> | null>(null);
  useEffect(() => {
    let active = true;
    if (!task.current)
      task.current = (async () => {
        const url = new URL(window.location.href);
        const fragment = new URLSearchParams(url.hash.slice(1));
        // 在创建 PKCE 客户端前清理 fragment，再显式接收旧邮件的 implicit 会话。
        window.history.replaceState(
          window.history.state,
          "",
          url.pathname + url.search,
        );
        const failed = "/reset-password?error=link_invalid";
        if (
          ["error", "error_code", "error_description"].some(
            (key) => fragment.has(key) || url.searchParams.has(key),
          )
        )
          return failed;
        const access_token = fragment.get("access_token"),
          refresh_token = fragment.get("refresh_token");
        if (!access_token || !refresh_token) return failed;
        try {
          const auth = createClient().auth;
          const { data, error } = await auth.setSession({
            access_token,
            refresh_token,
          });
          if (error || !data.user || !data.session) return failed;
          const verified = await auth.getUser(data.session.access_token);
          if (verified.error || verified.data.user?.id !== data.user.id)
            return failed;
          return authDestination(
            url.searchParams.get("next"),
            data.user.id,
            fragment.get("type") === "recovery",
          );
        } catch {
          return failed;
        }
      })();
    void task.current.then((path) => {
      if (active) window.location.replace(path);
    });
    return () => {
      active = false;
    };
  }, []);
  return (
    <main className="auth-page">
      <section className="card">
        <h1>正在验证邮件链接</h1>
        <p role="status">验证成功后再设置密码，请稍候…</p>
      </section>
    </main>
  );
}
