"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Farm, Profile, Role } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { errorMessage, profileName, roleLabel } from "@/lib/utils";
import CapacityOverview from "@/app/components/CapacityOverview";
import RecordTable from "@/app/components/RecordTable";
import ConfirmDialog from "@/app/components/ConfirmDialog";
export default function EstateClient({
  farms,
  profiles,
  accountServiceReady,
}: {
  farms: Farm[];
  profiles: Profile[];
  accountServiceReady: boolean;
}) {
  const router = useRouter();
  const [farmName, setFarmName] = useState("");
  const [email, setEmail] = useState(""),
    [name, setName] = useState(""),
    [role, setRole] = useState<Role>("user"),
    [farm, setFarm] = useState(farms[0]?.id || "");
  const [editing, setEditing] = useState<Profile | null>(null),
    [action, setAction] = useState<
      "farm" | "account" | "assign" | "resend" | null
    >(null),
    [target, setTarget] = useState<Profile | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const farmMap = Object.fromEntries(farms.map((f) => [f.id, f]));
  const run = async () => {
    if (!action || busy) return;
    setBusy(true);
    setError("");
    try {
      const db = createClient();
      if (action === "farm") {
        const { error } = await db
          .from("organizations")
          .insert({ name: farmName.trim() })
          .select("id")
          .single();
        if (error) throw error;
        setFarmName("");
        setMessage("农场已创建，固定吃葡萄默认免确认。");
      } else if (action === "assign" && editing) {
        const { error } = await db.rpc("admin_assign_profile", {
          p_user: editing.id,
          p_farm: role === "super_admin" ? null : farm,
          p_role: role,
          p_name: name.trim(),
          p_email: editing.email,
          p_require_change: false,
        });
        if (error) throw error;
        setEditing(null);
        setMessage("账号分配已更新。");
      } else {
        const response = await fetch("/api/admin/accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            action === "resend"
              ? { action: "resend", id: target?.id }
              : {
                  action: "create",
                  email: email.trim(),
                  name: name.trim(),
                  role,
                  farm,
                },
          ),
        });
        const result = await response.json();
        router.refresh();
        if (!response.ok) throw new Error(result.error);
        setMessage(result.message);
        if (action === "account") {
          setEmail("");
          setName("");
        }
      }
      setAction(null);
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const open = (next: typeof action) => {
    setError("");
    setAction(next);
  };
  return (
    <>
      <header className="page-header">
        <div className="page-title">
          <p className="eyebrow">ESTATE OWNER</p>
          <h1>葡萄总园主</h1>
          <p>
            管理农场与账号，查看全局容量和状况。总园主对收支、预算及更正单只读，不能代改或确认。
          </p>
        </div>
      </header>
      {message && (
        <p className="notice success" role="status">
          {message}
        </p>
      )}
      <CapacityOverview />
      <section className="grid grid-2 section-space">
        <form
          className="card stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (farmName.trim()) open("farm");
          }}
        >
          <h2>创建葡萄农场</h2>
          <label className="field">
            <span>农场名称</span>
            <input
              className="input"
              value={farmName}
              onChange={(e) => setFarmName(e.target.value)}
              maxLength={100}
              required
            />
          </label>
          <button className="btn btn-primary">核对并创建农场</button>
          <p className="muted">每个农场可配置最多两位农场管家和多位记录者。</p>
        </form>
        <form
          className="card stack"
          onSubmit={(e) => {
            e.preventDefault();
            open(editing ? "assign" : "account");
          }}
        >
          <div className="section-heading">
            <h2>{editing ? "调整账号分配" : "创建账号并发送邮件"}</h2>
            {editing && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setEditing(null);
                  setEmail("");
                  setName("");
                  setRole("user");
                }}
              >
                取消调整
              </button>
            )}
          </div>
          {!accountServiceReady && !editing && (
            <p className="notice">
              尚未配置账号管理密钥或发件服务。创建功能会明确报错，已有账号分配与容量查看仍可使用。
            </p>
          )}
          <label className="field">
            <span>邮箱</span>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={!!editing}
              required
            />
          </label>
          <label className="field">
            <span>显示名称</span>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
            />
          </label>
          <label className="field">
            <span>角色</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              <option value="user">记录者</option>
              <option value="grape_keeper">农场管家</option>
              <option value="super_admin">葡萄总园主（业务只读）</option>
            </select>
          </label>
          {role !== "super_admin" && (
            <label className="field">
              <span>所属农场</span>
              <select
                value={farm}
                onChange={(e) => setFarm(e.target.value)}
                required
              >
                <option value="">请选择农场</option>
                {farms.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button className="btn btn-primary">
            {editing ? "核对并保存分配" : "核对、创建并发送临时密码"}
          </button>
          <p className="muted">
            首次登录必须改密。临时密码不在页面显示或写入审计，重发会生成新密码。
          </p>
        </form>
      </section>
      <section className="card section-space">
        <h2>所有账号 · {profiles.length} 人</h2>
        <RecordTable
          headings={["用户", "邮箱", "角色", "农场", "登录与邮件", "操作"]}
          rows={profiles.map((p) => ({
            id: p.id,
            cells: [
              profileName(p),
              p.email,
              roleLabel(p.role),
              p.role === "super_admin"
                ? "全局"
                : farmMap[p.org_id || ""]?.name || "未分配",
              `${p.must_change_password ? "首次改密待完成" : "可正常登录"} · ${({ not_required: "已有账号", pending: "邮件待发送", sent: "邮件已发送", failed: "邮件发送失败" } as Record<string, string>)[p.onboarding_delivery_status || "not_required"] || "已有账号"}`,
              <div key="ops" className="btn-row">
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setEditing(p);
                    setEmail(p.email || "");
                    setName(p.display_name || "");
                    setRole(p.role);
                    setFarm(p.org_id || "");
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  调整分配
                </button>
                {p.must_change_password && (
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      setTarget(p);
                      open("resend");
                    }}
                  >
                    重发临时密码
                  </button>
                )}
              </div>,
            ],
          }))}
        />
      </section>
      <ConfirmDialog
        open={!!action}
        title={
          action === "farm"
            ? "确认创建农场？"
            : action === "assign"
              ? "确认调整账号角色与农场？"
              : action === "resend"
                ? "生成新临时密码并重发？"
                : "确认创建账号并发送临时密码？"
        }
        loading={busy}
        errorMessage={error}
        onConfirm={() => void run()}
        onCancel={() => setAction(null)}
        description={
          <p>
            {action === "farm"
              ? farmName
              : action === "resend"
                ? `${target?.email}。旧临时密码将失效。`
                : `${email} · ${roleLabel(role)} · ${role === "super_admin" ? "全局业务只读" : farmMap[farm]?.name || "请选择农场"}`}
          </p>
        }
      />
    </>
  );
}
