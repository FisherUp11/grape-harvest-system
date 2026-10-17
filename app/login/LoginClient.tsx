"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { safeRedirectPath } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

export default function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectedFrom = safeRedirectPath(searchParams.get("redirectedFrom"));
  const supabase = createClient();
  const [email, setEmail] = useState(() => searchParams.get("email") || "");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(() =>
    searchParams.get("password") === "updated"
      ? "密码已更新，请使用下方邮箱和新密码登录。"
      : "",
  );

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setLoading(false);
    if (error) {
      setMessage(
        error.code === "invalid_credentials"
          ? "邮箱或密码不正确，请核对邮箱是否为刚才修改密码的账号。"
          : "登录失败，请检查网络和邮箱密码后重试。",
      );
      return;
    }
    router.replace(redirectedFrom);
    router.refresh();
  };

  const sendReset = async () => {
    if (!email) {
      setMessage("请先填写邮箱。");
      return;
    }
    setLoading(true);
    const origin = window.location.origin;
    // 发起找回前清理本浏览器的旧账号，避免旧会话参与恢复。
    const cleared = await supabase.auth.signOut({ scope: "local" });
    if (cleared.error) {
      setLoading(false);
      setMessage("旧登录状态未能清理，请检查网络后重试。");
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${origin}/auth/callback?next=/reset-password`,
    });
    setLoading(false);
    setMessage(
      error
        ? "重置邮件未确认发送成功，请稍后重试。"
        : `如 ${email.trim()} 已有账号，将收到重置邮件。请使用最新邮件，在同一浏览器中打开，并核对改密页面的邮箱。`,
    );
  };

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-hero">
          <div className="brand-mark">🍇</div>
          <h1>把承诺与实际收到分开记录。</h1>
          <p>
            收葡萄游戏系统。承诺不进入葡萄存量，只有葡萄管家确认后的收葡萄才进入报告。
          </p>
        </div>
        <div className="auth-panel">
          <h2>登录庄园</h2>
          <p>
            使用 Supabase Auth 邮箱密码登录。首次使用可点击“忘记密码 /
            设置密码”。
          </p>
          <form className="stack" onSubmit={login}>
            <div className="field">
              <label htmlFor="login-email">邮箱</label>
              <input
                id="login-email"
                autoComplete="username"
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="login-password">密码</label>
              <input
                id="login-password"
                autoComplete="current-password"
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {message && (
              <div className="notice" role="status">
                {message}
              </div>
            )}
            <button className="btn btn-primary" disabled={loading}>
              {loading ? "处理中…" : "进入系统"}
            </button>
            <button
              className="btn btn-secondary"
              type="button"
              onClick={sendReset}
              disabled={loading}
            >
              忘记密码 / 设置密码
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
