import AppShell from "@/app/components/AppShell";
import { getAppContext } from "@/lib/supabase/server";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { profile, user } = await getAppContext();

  if (!profile) {
    return (
      <div className="auth-page">
        <div className="card" style={{ maxWidth: 720 }}>
          <h1>账号还没有完成初始化</h1>
          <p className="muted">当前登录邮箱为 {user.email}，但数据库中还没有对应的 profiles 记录。请按部署指南在 Supabase 中为该用户创建 profile。</p>
          <a className="btn btn-primary" href="/login">返回登录页</a>
        </div>
      </div>
    );
  }

  return <AppShell profile={profile}>{children}</AppShell>;
}
