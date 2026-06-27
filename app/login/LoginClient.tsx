"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectedFrom = searchParams.get("redirectedFrom") || "/dashboard";
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setMessage(error.message);
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
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/callback?next=/reset-password`,
    });
    setLoading(false);
    setMessage(error ? error.message : "重置 / 设置密码邮件已发送，请查收邮箱。");
  };

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-hero">
          <div className="brand-mark">🍇</div>
          <h1>把承诺与实际收到分开记录。</h1>
          <p>收葡萄游戏系统。承诺不进入葡萄存量，只有葡萄管家确认后的收葡萄才进入报告。</p>
        </div>
        <div className="auth-panel">
          <h2>登录庄园</h2>
          <p>使用 Supabase Auth 邮箱密码登录。首次使用可点击“忘记密码 / 设置密码”。</p>
          <form className="stack" onSubmit={login}>
            <div className="field">
              <label>邮箱</label>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="field">
              <label>密码</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            {message && <div className="notice">{message}</div>}
            <button className="btn btn-primary" disabled={loading}>{loading ? "处理中…" : "进入系统"}</button>
            <button className="btn btn-secondary" type="button" onClick={sendReset} disabled={loading}>忘记密码 / 设置密码</button>
          </form>
        </div>
      </section>
    </main>
  );
}
