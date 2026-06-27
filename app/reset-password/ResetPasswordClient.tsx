"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordClient() {
  const router = useRouter();
  const supabase = createClient();
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (!error) await supabase.auth.signOut();
    setLoading(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage("密码已更新，请重新登录。");
    setTimeout(() => router.replace("/login"), 900);
  };

  return (
    <main className="auth-page">
      <section className="card" style={{ width: "min(520px, 100%)" }}>
        <h1>设置新密码</h1>
        <p className="muted">请输入至少 8 位的新密码。保存后会退出当前会话。</p>
        <form className="stack" onSubmit={save}>
          <div className="field">
            <label>新密码</label>
            <input className="input" type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {message && <div className="notice">{message}</div>}
          <button className="btn btn-primary" disabled={loading}>{loading ? "保存中…" : "保存新密码"}</button>
        </form>
      </section>
    </main>
  );
}
