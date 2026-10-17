"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type {
  AuditLog,
  BudgetCategory,
  BudgetCategoryUsage,
  BudgetPlan,
  Profile,
} from "@/lib/types";
import {
  budgetStatusLabel,
  budgetHealth,
  currentMonth,
  errorMessage,
  formatGrapes,
  formatPercent,
  monthRange,
  profileName,
  toDateInput,
  auditActionLabel,
  formatDateTime,
} from "@/lib/utils";
import ConfirmDialog from "@/app/components/ConfirmDialog";
import RecordTable from "@/app/components/RecordTable";

type Action =
  | { kind: "create" }
  | {
      kind: "submit" | "confirm" | "return" | "clone" | "archive";
      plan: BudgetPlan;
    }
  | {
      kind: "category";
      plan: BudgetPlan;
      category?: BudgetCategory;
      name: string;
      amount: number;
    }
  | { kind: "remove_category"; plan: BudgetPlan; category: BudgetCategory }
  | {
      kind: "header";
      plan: BudgetPlan;
      title: string;
      start: string;
      end: string;
    };
export default function BudgetClient({
  profile,
  profiles,
  plans,
  usage,
  auditLogs,
}: {
  profile: Profile;
  profiles: Profile[];
  plans: BudgetPlan[];
  usage: BudgetCategoryUsage[];
  auditLogs: AuditLog[];
}) {
  const router = useRouter(),
    superAdmin = profile.role === "super_admin",
    keeper = profile.role === "grape_keeper";
  const [creating, setCreating] = useState(false),
    [title, setTitle] = useState("吃葡萄预算表"),
    [start, setStart] = useState(toDateInput()),
    [end, setEnd] = useState(
      monthRange(currentMonth().year, currentMonth().month).end,
    );
  const [action, setAction] = useState<Action | null>(null),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const people = Object.fromEntries(profiles.map((p) => [p.id, p]));
  const ask = (a: Action) => {
    setError("");
    setReason("");
    setAction(a);
  };
  const run = async () => {
    if (!action || busy) return;
    setBusy(true);
    setError("");
    try {
      const db = createClient();
      let failure: { message: string } | null = null;
      if (action.kind === "create") {
        if (end < start) throw new Error("预算结束日期不能早于开始日期。");
        const r = await db
          .from("budget_plans")
          .insert({
            org_id: profile.org_id,
            owner_id: profile.id,
            title: title.trim(),
            period_start: start,
            period_end: end,
            status: "draft",
          })
          .select("id")
          .single();
        failure = r.error;
        if (!failure) setCreating(false);
      } else if (action.kind === "clone") {
        const r = await db.rpc("clone_budget_version", {
          p_id: action.plan.id,
        });
        failure = r.error;
      } else if (action.kind === "category") {
        if (
          !action.name.trim() ||
          !Number.isFinite(action.amount) ||
          action.amount < 0
        )
          throw new Error("请填写科目名称和有效预算金额。");
        const payload = {
          name: action.name.trim(),
          budgeted_amount: action.amount,
        };
        const r = action.category
          ? await db
              .from("budget_categories")
              .update(payload)
              .eq("id", action.category.id)
              .select("id")
              .single()
          : await db
              .from("budget_categories")
              .insert({
                ...payload,
                org_id: action.plan.org_id,
                owner_id: action.plan.owner_id,
                budget_plan_id: action.plan.id,
                sort_order: action.plan.budget_categories?.length || 0,
              })
              .select("id")
              .single();
        failure = r.error;
      } else if (action.kind === "remove_category") {
        if (!reason.trim()) throw new Error("请填写作废原因。");
        const r = await db
          .from("budget_categories")
          .update({
            deleted_at: new Date().toISOString(),
            deletion_reason: reason.trim(),
          })
          .eq("id", action.category.id)
          .select("id")
          .single();
        failure = r.error;
      } else if (action.kind === "header") {
        if (action.end < action.start) throw new Error("预算期间无效。");
        const r = await db
          .from("budget_plans")
          .update({
            title: action.title.trim(),
            period_start: action.start,
            period_end: action.end,
          })
          .eq("id", action.plan.id)
          .select("id")
          .single();
        failure = r.error;
      } else {
        const { kind, plan } = action;
        if (["return", "archive"].includes(kind) && !reason.trim())
          throw new Error("请填写原因。");
        const payload =
          kind === "submit"
            ? {
                status:
                  plan.status === "draft"
                    ? "pending_confirmation"
                    : "revision_pending_confirmation",
              }
            : kind === "confirm"
              ? { status: "confirmed" }
              : kind === "return"
                ? { status: "revision_unlocked", return_reason: reason.trim() }
                : {
                    deleted_at: new Date().toISOString(),
                    deletion_reason: reason.trim(),
                  };
        const r = await db
          .from("budget_plans")
          .update(payload)
          .eq("id", plan.id)
          .eq("status", plan.status)
          .select("id")
          .single();
        failure = r.error;
      }
      if (failure) throw failure;
      setMessage("预算操作已完成并留存审计。");
      setAction(null);
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <header className="page-header">
        <div className="page-title">
          <p className="eyebrow">BUDGET LEDGER</p>
          <h1>吃葡萄预算</h1>
          <p>
            提交后不可自行修改；管家退回后才能修订。确认后的原版本永久锁定，后续调整创建新版本。
          </p>
        </div>
        {!superAdmin && (
          <button
            className="btn btn-primary"
            onClick={() => setCreating(!creating)}
          >
            {creating ? "收起新建" : "新建预算表"}
          </button>
        )}
      </header>
      {message && (
        <p className="notice success" role="status">
          {message}
        </p>
      )}
      {creating && !superAdmin && (
        <form
          className="card stack"
          onSubmit={(e) => {
            e.preventDefault();
            ask({ kind: "create" });
          }}
        >
          <h2>新建预算草稿</h2>
          <div className="form-grid">
            <label className="field">
              <span>标题</span>
              <input
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>开始日期</span>
              <input
                className="input"
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>结束日期</span>
              <input
                className="input"
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                required
              />
            </label>
          </div>
          <button className="btn btn-primary">核对并创建草稿</button>
        </form>
      )}
      <div className="stack section-space">
        {plans.map((plan) => {
          const canEdit =
            !superAdmin &&
            plan.owner_id === profile.id &&
            ["draft", "revision_unlocked"].includes(plan.status);
          const pending = [
            "pending_confirmation",
            "revision_pending_confirmation",
          ].includes(plan.status);
          const categories = plan.budget_categories || [];
          const u = usage.filter((x) => x.budget_plan_id === plan.id);
          const total = categories.reduce(
              (s, c) => s + Number(c.budgeted_amount),
              0,
            ),
            confirmed = u.reduce((s, c) => s + Number(c.confirmed_consumed), 0);
          const pct = total > 0 ? (confirmed / total) * 100 : 0;
          return (
            <section key={plan.id} className="card stack">
              <div className="section-heading">
                <div>
                  <h2>
                    {plan.title} · 第 {plan.version} 版
                  </h2>
                  <p className="muted">
                    {profileName(people[plan.owner_id])} · {plan.period_start}{" "}
                    至 {plan.period_end}
                  </p>
                </div>
                <span className="badge">{budgetStatusLabel(plan.status)}</span>
              </div>
              {plan.return_reason && (
                <p className="notice">管家退回：{plan.return_reason}</p>
              )}
              <p>
                预算 {formatGrapes(total)} · 已确认吃葡萄{" "}
                {formatGrapes(confirmed)} · 使用率 {formatPercent(pct)}
              </p>
              <div className={`progress ${budgetHealth(pct)}`}>
                <span style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
              {canEdit && (
                <form
                  className="form-grid"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    ask({
                      kind: "header",
                      plan,
                      title: String(f.get("title")),
                      start: String(f.get("start")),
                      end: String(f.get("end")),
                    });
                  }}
                >
                  <label className="field">
                    <span>标题</span>
                    <input
                      className="input"
                      name="title"
                      defaultValue={plan.title}
                      required
                    />
                  </label>
                  <label className="field">
                    <span>开始日期</span>
                    <input
                      className="input"
                      type="date"
                      name="start"
                      defaultValue={plan.period_start}
                      required
                    />
                  </label>
                  <label className="field">
                    <span>结束日期</span>
                    <input
                      className="input"
                      type="date"
                      name="end"
                      defaultValue={plan.period_end}
                      required
                    />
                  </label>
                  <button className="btn btn-secondary">
                    保存预算期间与标题
                  </button>
                </form>
              )}
              <RecordTable
                headings={["科目", "预算", "已确认", "待确认", "操作"]}
                rows={categories.map((c) => ({
                  id: c.id,
                  cells: [
                    c.name,
                    formatGrapes(c.budgeted_amount),
                    formatGrapes(
                      u.find((v) => v.category_id === c.id)?.confirmed_consumed,
                    ),
                    formatGrapes(
                      u.find((v) => v.category_id === c.id)?.pending_consumed,
                    ),
                    canEdit ? (
                      <CategoryForm
                        key="edit"
                        plan={plan}
                        category={c}
                        onSave={ask}
                      />
                    ) : (
                      <span key="locked" className="muted">
                        已锁定
                      </span>
                    ),
                  ],
                }))}
              />
              {canEdit && <CategoryForm plan={plan} onSave={ask} />}
              <div className="btn-row">
                {canEdit && (
                  <>
                    <button
                      className="btn btn-primary"
                      disabled={!categories.length}
                      onClick={() => ask({ kind: "submit", plan })}
                    >
                      提交管家确认
                    </button>
                    <button
                      className="btn btn-danger"
                      onClick={() => ask({ kind: "archive", plan })}
                    >
                      作废草稿并留痕
                    </button>
                  </>
                )}
                {pending && keeper && (
                  <>
                    <button
                      className="btn btn-primary"
                      onClick={() => ask({ kind: "confirm", plan })}
                    >
                      确认预算
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => ask({ kind: "return", plan })}
                    >
                      退回修改
                    </button>
                  </>
                )}
                {plan.status === "confirmed" &&
                  plan.owner_id === profile.id &&
                  !superAdmin && (
                    <button
                      className="btn btn-secondary"
                      onClick={() => ask({ kind: "clone", plan })}
                    >
                      以此预算创建新版本
                    </button>
                  )}
              </div>
              <details>
                <summary>查看近期预算变更历史</summary>
                <a href="/audit">查看完整变更审计</a>
                {auditLogs
                  .filter((a) => a.entity_id === plan.id)
                  .map((a) => (
                    <p key={a.id}>
                      {formatDateTime(a.created_at)} ·{" "}
                      {profileName(people[a.actor_id || ""])} ·{" "}
                      {auditActionLabel(a.action)}
                    </p>
                  ))}
              </details>
            </section>
          );
        })}
        {!plans.length && <p className="card empty">暂无预算表。</p>}
      </div>
      <ConfirmDialog
        open={!!action}
        title={
          action?.kind === "confirm"
            ? "确认预算生效并锁定原版本？"
            : action?.kind === "return"
              ? "退回预算修改？"
              : action?.kind === "clone"
                ? "保留原版并创建新版草稿？"
                : "确认预算操作？"
        }
        loading={busy}
        errorMessage={error}
        onConfirm={() => void run()}
        onCancel={() => setAction(null)}
        description={
          <div className="stack">
            <p>
              {action && "plan" in action ? action.plan.title : title}
              。提交后仅能由管家退回，已确认原版不可解锁。
            </p>
            {["return", "archive", "remove_category"].includes(
              action?.kind || "",
            ) && (
              <label className="field">
                <span>原因（必填）</span>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
            )}
          </div>
        }
      />
    </>
  );
}
function CategoryForm({
  plan,
  category,
  onSave,
}: {
  plan: BudgetPlan;
  category?: BudgetCategory;
  onSave: (a: Action) => void;
}) {
  return (
    <form
      className="category-form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        onSave({
          kind: "category",
          plan,
          category,
          name: String(f.get("name")),
          amount: Number(f.get("amount")),
        });
      }}
    >
      <label className="field">
        <span>{category ? "修改科目名称" : "新科目名称"}</span>
        <input
          className="input"
          name="name"
          defaultValue={category?.name || ""}
          required
        />
      </label>
      <label className="field">
        <span>预算葡萄数</span>
        <input
          className="input"
          name="amount"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          defaultValue={category?.budgeted_amount ?? ""}
          required
        />
      </label>
      <div className="btn-row">
        <button className="btn btn-secondary">
          {category ? "保存修改" : "添加科目"}
        </button>
        {category && (
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => onSave({ kind: "remove_category", plan, category })}
          >
            作废科目
          </button>
        )}
      </div>
    </form>
  );
}
