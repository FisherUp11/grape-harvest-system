"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import ConfirmDialog from "@/app/components/ConfirmDialog";
import type { AuditLog, BudgetCategory, BudgetCategoryUsage, BudgetPlan, Profile } from "@/lib/types";
import {
  budgetHealth,
  budgetStatusBadgeClass,
  budgetStatusLabel,
  formatDateTime,
  formatGrapes,
  formatPercent,
  profileName,
  toDateInput,
} from "@/lib/utils";

type Props = {
  profile: Profile;
  profiles: Profile[];
  plans: BudgetPlan[];
  usage: BudgetCategoryUsage[];
  auditLogs: AuditLog[];
};

type ActionKind = "submit" | "confirm" | "request_revision" | "unlock" | "resubmit" | "delete_plan";

function usagePercent(consumed: number, budgeted: number) {
  if (budgeted <= 0) return consumed > 0 ? 100 : 0;
  return (consumed / budgeted) * 100;
}

function defaultPeriodEnd() {
  const now = new Date();
  return toDateInput(new Date(now.getFullYear(), now.getMonth() + 1, 0));
}

const ACTION_COPY: Record<ActionKind, { title: string; confirmLabel: string; loadingLabel: string; danger?: boolean; describe: (p: BudgetPlan) => string }> = {
  submit: { title: "提交预算表待葡萄管家确认？", confirmLabel: "确认提交", loadingLabel: "提交中…", describe: (p) => `提交后「${p.title}」的科目将暂时锁定，需葡萄管家确认或解锁后才能再次编辑。` },
  confirm: { title: "确认该预算表生效？", confirmLabel: "确认生效", loadingLabel: "确认中…", describe: (p) => `确认后「${p.title}」将成为该用户此期间内吃葡萄记录必须选择科目的依据。` },
  request_revision: { title: "申请修正该预算表？", confirmLabel: "申请修正", loadingLabel: "提交中…", describe: (p) => `申请后「${p.title}」将进入待解锁状态，需葡萄管家解除锁定后才能修改科目。` },
  unlock: { title: "解除锁定以便用户修正？", confirmLabel: "解除锁定", loadingLabel: "处理中…", describe: (p) => `解除后「${p.title}」的科目将重新变为可编辑状态。` },
  resubmit: { title: "重新提交修正后的预算表？", confirmLabel: "确认提交", loadingLabel: "提交中…", describe: (p) => `提交后「${p.title}」将等待葡萄管家重新确认。` },
  delete_plan: { title: "删除这份草稿预算表？", confirmLabel: "确认删除", loadingLabel: "删除中…", danger: true, describe: (p) => `删除后「${p.title}」及其科目将无法恢复，仅可删除尚未提交的草稿。` },
};

const ACTION_LOG_LABEL: Record<ActionKind, string> = {
  submit: "提交预算表待确认",
  confirm: "确认预算表生效",
  request_revision: "申请修正预算表",
  unlock: "解除预算表锁定",
  resubmit: "重新提交修正后的预算表",
  delete_plan: "删除预算表草稿",
};

export default function BudgetClient({ profile, profiles, plans, usage, auditLogs }: Props) {
  const supabase = createClient();
  const router = useRouter();
  const isKeeper = profile.role === "grape_keeper";
  const profileMap = useMemo(() => Object.fromEntries(profiles.map((p) => [p.id, p])), [profiles]);

  const usageByPlan = useMemo(() => {
    const map: Record<string, BudgetCategoryUsage[]> = {};
    for (const u of usage) (map[u.budget_plan_id] ||= []).push(u);
    return map;
  }, [usage]);

  const auditByPlan = useMemo(() => {
    const map: Record<string, AuditLog[]> = {};
    for (const a of auditLogs) if (a.entity_id) (map[a.entity_id] ||= []).push(a);
    return map;
  }, [auditLogs]);

  const plansByOwner = useMemo(() => {
    const map: Record<string, BudgetPlan[]> = {};
    for (const p of plans) (map[p.owner_id] ||= []).push(p);
    return map;
  }, [plans]);

  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("吃葡萄预算表");
  const [periodStart, setPeriodStart] = useState(toDateInput());
  const [periodEnd, setPeriodEnd] = useState(defaultPeriodEnd());
  const [createMsg, setCreateMsg] = useState("");
  const [createBusy, setCreateBusy] = useState(false);

  const [newCatName, setNewCatName] = useState<Record<string, string>>({});
  const [newCatAmount, setNewCatAmount] = useState<Record<string, string>>({});
  const [catBusyId, setCatBusyId] = useState<string | null>(null);

  const [action, setAction] = useState<{ kind: ActionKind; plan: BudgetPlan } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState("");
  const [deleteCategory, setDeleteCategory] = useState<BudgetCategory | null>(null);
  const [deleteCategoryBusy, setDeleteCategoryBusy] = useState(false);

  const [expandedAudit, setExpandedAudit] = useState<Record<string, boolean>>({});

  async function logAudit(actionLabel: string, entityId: string, oldData: unknown, newData: unknown) {
    await supabase.from("audit_logs").insert({
      org_id: profile.org_id,
      actor_id: profile.id,
      action: actionLabel,
      entity_table: "budget_plans",
      entity_id: entityId,
      old_data: (oldData ?? null) as never,
      new_data: (newData ?? null) as never,
    });
  }

  const createPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateMsg("");
    if (!periodStart || !periodEnd || periodEnd < periodStart) return setCreateMsg("请填写正确的起止日期，结束日期不能早于开始日期。");
    setCreateBusy(true);
    try {
      const { data, error } = await supabase
        .from("budget_plans")
        .insert({ org_id: profile.org_id, owner_id: profile.id, title: title.trim() || "吃葡萄预算表", period_start: periodStart, period_end: periodEnd, status: "draft" })
        .select("id")
        .single();
      if (error) throw error;
      await logAudit("创建预算表草稿", data.id, null, { title, period_start: periodStart, period_end: periodEnd });
      setCreating(false);
      setTitle("吃葡萄预算表");
      router.refresh();
    } catch (err) {
      setCreateMsg(err instanceof Error ? err.message : "创建失败，请重试。");
    } finally {
      setCreateBusy(false);
    }
  };

  const addCategory = async (plan: BudgetPlan) => {
    const name = (newCatName[plan.id] || "").trim();
    const amt = Number(newCatAmount[plan.id] || 0);
    if (!name) return;
    setCatBusyId(plan.id);
    try {
      const { data, error } = await supabase
        .from("budget_categories")
        .insert({ org_id: profile.org_id, budget_plan_id: plan.id, owner_id: plan.owner_id, name, budgeted_amount: amt, sort_order: plan.budget_categories?.length || 0 })
        .select("id")
        .single();
      if (error) throw error;
      await logAudit(`新增科目「${name}」`, plan.id, null, { name, budgeted_amount: amt });
      setNewCatName((s) => ({ ...s, [plan.id]: "" }));
      setNewCatAmount((s) => ({ ...s, [plan.id]: "" }));
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "新增科目失败");
    } finally {
      setCatBusyId(null);
    }
  };

  const updateCategoryField = async (plan: BudgetPlan, category: BudgetCategory, field: "name" | "budgeted_amount", value: string) => {
    if (field === "name" && value.trim() === category.name) return;
    if (field === "budgeted_amount" && Number(value) === Number(category.budgeted_amount)) return;
    const payload = field === "budgeted_amount" ? { budgeted_amount: Number(value) || 0 } : { name: value.trim() || category.name };
    const { error } = await supabase.from("budget_categories").update(payload).eq("id", category.id);
    if (error) return alert(error.message);
    await logAudit(`修改科目「${category.name}」`, plan.id, { [field]: category[field] }, payload);
    router.refresh();
  };

  const confirmDeleteCategory = async () => {
    if (!deleteCategory || deleteCategoryBusy) return;
    setDeleteCategoryBusy(true);
    try {
      const { error } = await supabase.from("budget_categories").delete().eq("id", deleteCategory.id);
      if (error) throw error;
      await logAudit(`删除科目「${deleteCategory.name}」`, deleteCategory.budget_plan_id, { name: deleteCategory.name, budgeted_amount: deleteCategory.budgeted_amount }, null);
      setDeleteCategory(null);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeleteCategoryBusy(false);
    }
  };

  const runAction = async () => {
    if (!action || actionBusy) return;
    const { kind, plan } = action;
    setActionBusy(true);
    setActionMsg("");
    try {
      if (kind === "delete_plan") {
        const { error } = await supabase.from("budget_plans").delete().eq("id", plan.id);
        if (error) throw error;
      } else {
        let payload: Record<string, unknown> = {};
        if (kind === "submit") payload = { status: "pending_confirmation", submitted_at: new Date().toISOString() };
        if (kind === "confirm") payload = { status: "confirmed", confirmed_by: profile.id, confirmed_at: new Date().toISOString() };
        if (kind === "request_revision") payload = { status: "revision_requested" };
        if (kind === "unlock") payload = { status: "revision_unlocked", unlocked_by: profile.id, unlocked_at: new Date().toISOString() };
        if (kind === "resubmit") payload = { status: "revision_pending_confirmation", submitted_at: new Date().toISOString() };
        const { error } = await supabase.from("budget_plans").update(payload).eq("id", plan.id);
        if (error) throw error;
        await logAudit(ACTION_LOG_LABEL[kind], plan.id, { status: plan.status }, payload);
      }
      setAction(null);
      router.refresh();
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : "操作失败，请重试。");
    } finally {
      setActionBusy(false);
    }
  };

  const ownerIds = isKeeper ? Object.keys(plansByOwner) : [profile.id];

  return (
    <>
      <header className="page-header">
        <div className="page-title">
          <p className="eyebrow">GRAPE BUDGET LEDGER</p>
          <h1>吃葡萄预算</h1>
          <p>每位记录者自行编写吃葡萄预算表与科目，经葡萄管家确认后生效；生效期间的吃葡萄记录需选择对应科目，实际支出与预算的对比一目了然。</p>
        </div>
        {!isKeeper && <button className="btn btn-primary no-print" onClick={() => setCreating((v) => !v)}>{creating ? "取消新建" : "新建预算表"}</button>}
      </header>

      {creating && (
        <form className="card stack" onSubmit={createPlan} style={{ marginBottom: 18 }}>
          <h2>新建预算表</h2>
          <div className="form-grid">
            <div className="field"><label>标题</label><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
            <div className="field"><label>覆盖开始日期</label><input className="input" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} required /></div>
            <div className="field"><label>覆盖结束日期</label><input className="input" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} required /></div>
          </div>
          {createMsg && <div className="notice danger">{createMsg}</div>}
          <button className="btn btn-primary" disabled={createBusy}>{createBusy ? <><span className="spinner" /> 创建中…</> : "创建草稿"}</button>
        </form>
      )}

      {ownerIds.length === 0 && <div className="card empty">暂无预算表。</div>}

      {ownerIds.map((ownerId) => {
        const ownerPlans = plansByOwner[ownerId] || [];
        if (ownerPlans.length === 0) return null;
        return (
          <section key={ownerId} style={{ marginBottom: 26 }}>
            {isKeeper && <h2 style={{ margin: "6px 0 12px" }}>{profileName(profileMap[ownerId])} 的预算表</h2>}
            <div className="stack">
              {ownerPlans.map((plan) => {
                const planUsage = usageByPlan[plan.id] || [];
                const totalBudget = planUsage.reduce((s, u) => s + Number(u.budgeted_amount), 0);
                const totalConfirmed = planUsage.reduce((s, u) => s + Number(u.confirmed_consumed), 0);
                const totalPending = planUsage.reduce((s, u) => s + Number(u.pending_consumed), 0);
                const totalPct = usagePercent(totalConfirmed, totalBudget);
                const totalHealth = budgetHealth(totalPct);
                const editable = (plan.status === "draft" || plan.status === "revision_unlocked") && plan.owner_id === profile.id;
                const canSubmit = editable && plan.status === "draft" && (plan.budget_categories?.length || 0) > 0;
                const canResubmit = editable && plan.status === "revision_unlocked";
                const canRequestRevision = plan.status === "confirmed" && plan.owner_id === profile.id;
                const canConfirm = isKeeper && (plan.status === "pending_confirmation" || plan.status === "revision_pending_confirmation");
                const canUnlock = isKeeper && plan.status === "revision_requested";
                const canDeletePlan = plan.status === "draft" && plan.owner_id === profile.id;
                const auditEntries = auditByPlan[plan.id] || [];

                return (
                  <div key={plan.id} className="card">
                    <div className="btn-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <strong style={{ fontSize: 18 }}>{plan.title}</strong>
                        <p className="muted" style={{ margin: "4px 0 0" }}>{plan.period_start} ~ {plan.period_end}</p>
                      </div>
                      <span className={`badge ${budgetStatusBadgeClass(plan.status)}`}>{budgetStatusLabel(plan.status)}</span>
                    </div>

                    {totalBudget > 0 && (
                      <div style={{ margin: "16px 0" }}>
                        <div className="btn-row" style={{ justifyContent: "space-between" }}>
                          <span className="muted">预算执行：已确认 {formatGrapes(totalConfirmed)} / 预算 {formatGrapes(totalBudget)}{totalPending > 0 && <> · 待确认 {formatGrapes(totalPending)}</>}</span>
                          <span className={`badge ${totalHealth}`}>{formatPercent(totalPct)}</span>
                        </div>
                        <div className={`progress ${totalHealth}`} style={{ marginTop: 8 }}>
                          <span style={{ width: `${Math.min(totalPct, 100)}%` }} />
                        </div>
                      </div>
                    )}

                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>科目</th><th>预算</th><th>已确认吃葡萄</th><th>待确认</th><th>使用率</th>{editable && <th>操作</th>}</tr></thead>
                        <tbody>
                          {(plan.budget_categories || []).map((cat) => {
                            const u = planUsage.find((row) => row.category_id === cat.id);
                            const pct = usagePercent(Number(u?.confirmed_consumed || 0), Number(cat.budgeted_amount));
                            const health = budgetHealth(pct);
                            return (
                              <tr key={cat.id}>
                                <td>{editable ? <input className="input" defaultValue={cat.name} onBlur={(e) => updateCategoryField(plan, cat, "name", e.target.value)} /> : cat.name}</td>
                                <td>{editable ? <input className="input" type="number" min="0" step="0.01" defaultValue={cat.budgeted_amount} onBlur={(e) => updateCategoryField(plan, cat, "budgeted_amount", e.target.value)} /> : formatGrapes(cat.budgeted_amount)}</td>
                                <td>{formatGrapes(u?.confirmed_consumed || 0)}</td>
                                <td>{formatGrapes(u?.pending_consumed || 0)}</td>
                                <td>
                                  <div className="progress-row">
                                    <div className={`progress ${health}`} style={{ width: 80 }}><span style={{ width: `${Math.min(pct, 100)}%` }} /></div>
                                    <span className={`progress-pct ${health}`}>{formatPercent(pct)}</span>
                                  </div>
                                </td>
                                {editable && <td><button className="btn btn-danger" onClick={() => setDeleteCategory(cat)}>删除</button></td>}
                              </tr>
                            );
                          })}
                          {(plan.budget_categories || []).length === 0 && <tr><td colSpan={editable ? 6 : 5} className="empty">还没有科目。</td></tr>}
                        </tbody>
                      </table>
                    </div>

                    {editable && (
                      <div className="btn-row" style={{ marginTop: 12, flexWrap: "wrap" }}>
                        <input className="input" style={{ maxWidth: 200 }} placeholder="新科目名称" value={newCatName[plan.id] || ""} onChange={(e) => setNewCatName((s) => ({ ...s, [plan.id]: e.target.value }))} />
                        <input className="input" style={{ maxWidth: 140 }} type="number" min="0" step="0.01" placeholder="预算金额" value={newCatAmount[plan.id] || ""} onChange={(e) => setNewCatAmount((s) => ({ ...s, [plan.id]: e.target.value }))} />
                        <button className="btn btn-secondary" disabled={catBusyId === plan.id} onClick={() => addCategory(plan)}>添加科目</button>
                      </div>
                    )}

                    <div className="btn-row" style={{ marginTop: 16 }}>
                      {canSubmit && <button className="btn btn-primary" onClick={() => setAction({ kind: "submit", plan })}>提交给葡萄管家确认</button>}
                      {canResubmit && <button className="btn btn-primary" onClick={() => setAction({ kind: "resubmit", plan })}>重新提交确认</button>}
                      {canRequestRevision && <button className="btn btn-secondary" onClick={() => setAction({ kind: "request_revision", plan })}>申请修正</button>}
                      {canConfirm && <button className="btn btn-primary" onClick={() => setAction({ kind: "confirm", plan })}>确认预算表</button>}
                      {canUnlock && <button className="btn btn-secondary" onClick={() => setAction({ kind: "unlock", plan })}>解除锁定以便修正</button>}
                      {canDeletePlan && <button className="btn btn-danger" onClick={() => setAction({ kind: "delete_plan", plan })}>删除草稿</button>}
                      {plan.status === "revision_requested" && !isKeeper && <span className="muted">已申请修正，等待葡萄管家解除锁定…</span>}
                      {plan.status === "pending_confirmation" && !isKeeper && <span className="muted">已提交，等待葡萄管家确认…</span>}
                    </div>

                    {auditEntries.length > 0 && (
                      <div style={{ marginTop: 14 }}>
                        <button type="button" className="btn btn-ghost" onClick={() => setExpandedAudit((s) => ({ ...s, [plan.id]: !s[plan.id] }))}>
                          {expandedAudit[plan.id] ? "收起修正记录" : `查看修正与审计记录（${auditEntries.length}）`}
                        </button>
                        {expandedAudit[plan.id] && (
                          <div className="table-wrap" style={{ marginTop: 8 }}>
                            <table>
                              <thead><tr><th>时间</th><th>操作人</th><th>操作</th></tr></thead>
                              <tbody>
                                {auditEntries.map((log) => (
                                  <tr key={log.id}>
                                    <td className="muted">{formatDateTime(log.created_at)}</td>
                                    <td>{profileName(profileMap[log.actor_id || ""])}</td>
                                    <td>{log.action}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      <ConfirmDialog
        open={!!action}
        title={action ? ACTION_COPY[action.kind].title : ""}
        loading={actionBusy}
        danger={action ? ACTION_COPY[action.kind].danger : false}
        confirmLabel={action ? ACTION_COPY[action.kind].confirmLabel : "确认"}
        loadingLabel={action ? ACTION_COPY[action.kind].loadingLabel : "处理中…"}
        errorMessage={actionMsg || null}
        description={action ? <p>{ACTION_COPY[action.kind].describe(action.plan)}</p> : null}
        onConfirm={runAction}
        onCancel={() => !actionBusy && setAction(null)}
      />

      <ConfirmDialog
        open={!!deleteCategory}
        title="删除该科目？"
        loading={deleteCategoryBusy}
        danger
        confirmLabel="确认删除"
        loadingLabel="删除中…"
        description={deleteCategory ? <p>删除科目「{deleteCategory.name}」后无法恢复，已关联该科目的吃葡萄记录将保留但科目显示为空。</p> : null}
        onConfirm={confirmDeleteCategory}
        onCancel={() => !deleteCategoryBusy && setDeleteCategory(null)}
      />
    </>
  );
}
