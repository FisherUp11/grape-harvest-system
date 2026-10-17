"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { profileName, roleLabel } from "@/lib/utils";
import type { Profile } from "@/lib/types";
import { useState } from "react";
import StorageUsage from "./StorageUsage";

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

export default function AppShell({
  children,
  profile,
}: {
  children: React.ReactNode;
  profile: Profile | null;
}) {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const supabase = createClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const groups = navGroups.map((group) =>
    group.title === "系统"
      ? {
          ...group,
          items: [
            ...group.items.filter(
              (item) =>
                profile?.role !== "super_admin" || item.href !== "/settings",
            ),
            { href: "/audit", label: "变更审计", icon: "📋" },
            { href: "/corrections", label: "更正单", icon: "↩" },
            ...(profile?.role === "super_admin"
              ? [{ href: "/estate", label: "总园主管理", icon: "🏡" }]
              : []),
          ],
        }
      : group,
  );

  const logout = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  return (
    <div className="shell">
      <div className="mobile-topbar">
        <Link href="/dashboard">
          <strong>🍇 收葡萄系统</strong>
          <small>
            {profileName(profile)} · {roleLabel(profile?.role)}
          </small>
        </Link>
        <button
          className="btn btn-ghost"
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? "关闭" : "全部功能 ☰"}
        </button>
      </div>
      {menuOpen && (
        <nav id="mobile-menu" className="mobile-menu" aria-label="全部功能">
          {groups.map((group) => (
            <section key={group.title}>
              <p className="nav-title">{group.title}</p>
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`nav-item${pathname === item.href ? " active" : ""}`}
                  aria-current={pathname === item.href ? "page" : undefined}
                  onClick={() => setMenuOpen(false)}
                >
                  <span aria-hidden="true">{item.icon}</span>
                  {item.label}
                </Link>
              ))}
            </section>
          ))}
          {profile?.role !== "super_admin" && (
            <StorageUsage isKeeper={profile?.role === "grape_keeper"} compact />
          )}
          <button className="btn btn-secondary" onClick={logout}>
            退出登录
          </button>
        </nav>
      )}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-logo">🍇</div>
          <div>
            <strong>收葡萄系统</strong>
            <span>Grape Harvest Ledger</span>
          </div>
        </div>

        <nav className="sidebar-scroll">
          {groups.map((group) => (
            <section className="nav-section" key={group.title}>
              <p className="nav-title">{group.title}</p>
              {group.items.map((item) => {
                const active =
                  pathname === item.href ||
                  pathname.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`nav-item${active ? " active" : ""}`}
                    aria-current={active ? "page" : undefined}
                  >
                    <span aria-hidden="true" className="nav-icon">
                      {item.icon}
                    </span>
                    <span>
                      {item.href === "/dashboard" ? "葡萄总览" : item.label}
                    </span>
                  </Link>
                );
              })}
            </section>
          ))}
        </nav>

        <div className="sidebar-footer">
          <small>
            {profile?.role === "super_admin"
              ? "全部葡萄农场"
              : profile?.organizations?.name || "当前农场"}
          </small>
          <div className="sidebar-username">{profileName(profile)}</div>
          <div className="badge role-badge">{roleLabel(profile?.role)}</div>
          <button className="btn btn-secondary btn-logout" onClick={logout}>
            退出登录
          </button>
        </div>
      </aside>
      <main className="content" id="main-content">
        {children}
      </main>
      <nav className="mobile-bottom-nav no-print" aria-label="常用功能">
        {[
          {
            href: profile?.role === "super_admin" ? "/estate" : "/dashboard",
            label: profile?.role === "super_admin" ? "管理" : "总览",
            icon: "⌂",
          },
          { href: "/receipts", label: "收葡萄", icon: "+" },
          { href: "/consumptions", label: "吃葡萄", icon: "−" },
          { href: "/budget", label: "预算", icon: "▤" },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={pathname === item.href ? "active" : ""}
            aria-current={pathname === item.href ? "page" : undefined}
            onClick={() => setMenuOpen(false)}
          >
            <span aria-hidden="true">{item.icon}</span>
            {item.label}
          </Link>
        ))}
        <button
          type="button"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
        >
          <span aria-hidden="true">☰</span>更多
        </button>
      </nav>
    </div>
  );
}
