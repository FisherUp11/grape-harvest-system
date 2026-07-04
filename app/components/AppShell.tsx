"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { profileName, roleLabel } from "@/lib/utils";
import type { Profile } from "@/lib/types";

const navGroups = [
  {
    title: "葡萄总览",
    items: [
      { href: "/dashboard", label: "庄园仪表盘", icon: "🍇" },
      { href: "/reports", label: "月度葡萄报告", icon: "📜" },
    ],
  },
  {
    title: "日常记录",
    items: [
      { href: "/commitments", label: "承诺支持", icon: "🌱" },
      { href: "/receipts", label: "收葡萄", icon: "🧺" },
      { href: "/consumptions", label: "吃葡萄", icon: "🍽️" },
      { href: "/budget", label: "吃葡萄预算", icon: "📊" },
      { href: "/supporters", label: "支持者", icon: "🤝" },
    ],
  },
  {
    title: "系统",
    items: [{ href: "/settings", label: "葡萄设置", icon: "⚙️" }],
  },
];

export default function AppShell({ children, profile }: { children: React.ReactNode; profile: Profile | null }) {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const supabase = createClient();

  const logout = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  return (
    <div className="shell">
      <div className="mobile-topbar">
        <strong>🍇 收葡萄系统</strong>
        <button className="btn btn-ghost" onClick={logout}>退出</button>
      </div>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-logo">🍇</div>
          <div>
            <strong>收葡萄系统</strong>
            <span>Grape Harvest Ledger</span>
          </div>
        </div>

        <nav className="sidebar-scroll">
          {navGroups.map((group) => (
            <section className="nav-section" key={group.title}>
              <p className="nav-title">{group.title}</p>
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <Link key={item.href} href={item.href} className={`nav-item${active ? " active" : ""}`}>
                    <span className="nav-icon">{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </section>
          ))}
        </nav>

        <div className="sidebar-footer">
          <small>{profile?.organizations?.name || "当前组织"}</small>
          <div className="sidebar-username">{profileName(profile)}</div>
          <div className="badge role-badge">{roleLabel(profile?.role)}</div>
          <button className="btn btn-secondary btn-logout" onClick={logout}>退出登录</button>
        </div>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
