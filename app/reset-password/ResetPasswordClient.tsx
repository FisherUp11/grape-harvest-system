"use client";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { passwordErrorMessage } from "@/lib/passwordFlow";

export default function ResetPasswordClient() {
  const [user, setUser] = useState<User | null>(null),
    [checking, setChecking] = useState(true);
  const [password, setPassword] = useState(""),
    [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState(""),
    [blocked, setBlocked] = useState(false),
    [loading, setLoading] = useState(false),
    [saved, setSaved] = useState(false);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const url = new URL(window.location.href),
      fragment = new URLSearchParams(url.hash.slice(1));
    if (
      url.searchParams.has("error") ||
      ["error", "error_code", "error_description"].some((key) =>
        fragment.has(key),
      )
    ) {
      window.history.replaceState(
        window.history.state,
        "",
        "/reset-password?error=link_invalid",
      );
      setBlocked(true);
      setChecking(false);
      setMessage(
        "邮件链接已失效、已使用或验证失败，请重新申请；本页不会修改浏览器里其他账号的密码。",
      );
      return;
    }
    if (fragment.has("access_token") || fragment.has("refresh_token")) {
      window.location.replace(
        `/auth/complete?next=${encodeURIComponent("/reset-password")}${url.hash}`,
      );
      return;
    }
    const expected = url.searchParams.get("account");
    if (url.searchParams.get("flow") === "recovery" && !expected) {
      setBlocked(true);
      setChecking(false);
      setMessage("缺少本次重置的账号验证，请重新申请邮件。");
      return;
    }
    const auth = createClient().auth;
    void auth
      .getUser()
      .then(({ data, error }) => {
        if (!active) return;
        if (error || !data.user) {
          setBlocked(true);
          setMessage(
            "当前没有有效的登录或重置会话，请重新登录或申请重置邮件。",
          );
        } else if (expected && data.user.id !== expected) {
          setBlocked(true);
          setMessage(passwordErrorMessage({ code: "account_changed" }));
        } else setUser(data.user);
        setChecking(false);
      })
      .catch(() => {
        if (active) {
          setBlocked(true);
          setChecking(false);
          setMessage("账号验证失败，请检查网络后重新打开邮件链接。");
        }
      });
    const { data: listener } = auth.onAuthStateChange((_event, session) => {
      if (active && session?.user && expected && session.user.id !== expected) {
        setBlocked(true);
        setMessage(passwordErrorMessage({ code: "account_changed" }));
      }
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);
  const finish = async () => {
    const { error } = await createClient().auth.signOut({ scope: "local" });
    if (error) {
      setMessage(
        "密码已保存，但退出登录失败。请点击下方按钮重试退出，再用新密码登录。",
      );
      return;
    }
    setLoginUrl(
      `/login?password=updated&email=${encodeURIComponent(user?.email || "")}`,
    );
    setMessage("密码已保存，请使用下方显示的同一邮箱和新密码重新登录。");
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || blocked || loading || saved) return;
    if (password !== confirmPassword)
      return setMessage("两次输入的密码不一致。");
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: user.id, password }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw { code: result.error };
      setSaved(true);
      setPassword("");
      setConfirmPassword("");
      try {
        await finish();
      } catch {
        setMessage("密码已保存，但退出登录失败。请重试退出后使用新密码登录。");
      }
    } catch (error) {
      setMessage(passwordErrorMessage(error));
      if ((error as { code?: string })?.code === "account_changed")
        setBlocked(true);
    } finally {
      setLoading(false);
    }
  };
  return (
    <main className="auth-page">
      <section className="card" style={{ width: "min(520px,100%)" }}>
        <h1>{saved ? "密码已更新" : "设置新密码"}</h1>
        {checking && <p role="status">正在核对改密账号…</p>}
        {user && (
          <p className="notice">
            正在{saved ? "完成改密" : "修改密码"}的账号：
            <strong>{user.email}</strong>
          </p>
        )}
        {message && (
          <p
            className={`notice ${saved ? "success" : "danger"}`}
            role={saved ? "status" : "alert"}
          >
            {message}
          </p>
        )}
        {!checking && !blocked && user && !saved && (
          <form className="stack" onSubmit={save}>
            <p className="muted">
              请输入至少 8
              位的新密码，并核对上方邮箱。引号也会计入密码，请核对输入内容。
            </p>
            <label className="field">
              <span>新密码</span>
              <input
                autoComplete="new-password"
                className="input"
                type={showPassword ? "text" : "password"}
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
              />
            </label>
            <label className="field">
              <span>确认新密码</span>
              <input
                autoComplete="new-password"
                className="input"
                type={showPassword ? "text" : "password"}
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={loading}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={showPassword}
                onChange={(e) => setShowPassword(e.target.checked)}
                disabled={loading}
              />{" "}
              显示新密码以核对输入
            </label>
            <button className="btn btn-primary" disabled={loading}>
              {loading ? "保存中…" : "保存新密码"}
            </button>
          </form>
        )}
        {saved &&
          (loginUrl ? (
            <a className="btn btn-primary" href={loginUrl}>
              使用这个邮箱重新登录
            </a>
          ) : (
            <button
              className="btn btn-primary"
              disabled={loading}
              onClick={() => {
                setLoading(true);
                void finish()
                  .catch(() => setMessage("密码已保存，退出失败，请重试。"))
                  .finally(() => setLoading(false));
              }}
            >
              重试退出登录
            </button>
          ))}
        {(blocked || (!checking && !user)) && (
          <a className="btn btn-primary" href="/login?recovery=1">
            返回登录页重新申请
          </a>
        )}
      </section>
    </main>
  );
}
