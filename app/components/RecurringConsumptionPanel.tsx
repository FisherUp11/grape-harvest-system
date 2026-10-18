"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type {
  BudgetCategory,
  Profile,
  RecurringConsumptionPlan,
} from "@/lib/types";
import {
  errorMessage,
  formatGrapes,
  profileName,
  toDateInput,
} from "@/lib/utils";
import ConfirmDialog from "./ConfirmDialog";

type Action =
  | { kind: "create"; id: string }
  | { kind: "stop" | "category"; plan: RecurringConsumptionPlan };
export default function RecurringConsumptionPanel({
  profile,
  profiles,
  plans,
  categories,
}: {
  profile: Profile;
  profiles: Profile[];
  plans: RecurringConsumptionPlan[];
  categories: BudgetCategory[];
}) {
  const router = useRouter();
  const readonly = profile.role === "super_admin";
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [amount, setAmount] = useState(
    String(profile.monthly_fixed_consumption || 3000),
  );
  const [start, setStart] = useState(toDateInput());
  const [end, setEnd] = useState(`${toDateInput().slice(0, 4)}-12-31`);
  const [day, setDay] = useState(String(Number(toDateInput().slice(8))));
  const [category, setCategory] = useState("");
  const [reason, setReason] = useState("");
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const people = Object.fromEntries(profiles.map((p) => [p.id, p]));
  // 每日后台任务之外，打开页面时也补处理本人的到期计划；数据库保证不会提前或重复生成。
  useEffect(() => {
    if (readonly) return;
    let active = true;
    const sync = async () => {
      try {
        const { data, error } = await createClient().rpc(
          "sync_recurring_consumptions",
        );
        if (!active) return;
        if (error)
          setError("到期计划检查失败，请刷新重试：" + errorMessage(error));
        else if (data?.generated || data?.blocked) router.refresh();
      } catch {
        if (active) setError("到期计划检查失败，请检查网络后刷新重试。");
      }
    };
    void sync();
    const timer = setInterval(() => void sync(), 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [readonly, router]);

  const ask = (next: Action) => {
    setError("");
    setReason("");
    setCategory(
      next.kind === "category" ? next.plan.budget_category_id || "" : "",
    );
    setAction(next);
  };
  const run = async () => {
    if (!action || busy) return;
    setBusy(true);
    setError("");
    const db = createClient();
    try {
      if (action.kind === "create") {
        const { error } = await db
          .from("recurring_consumption_plans")
          .insert({
            id: action.id,
            org_id: profile.org_id,
            owner_id: profile.id,
            description: description.trim(),
            grape_amount: Number(amount),
            start_date: start,
            end_date: end,
            day_of_month: Number(day),
            budget_category_id: category || null,
          })
          .select("id")
          .single();
        if (error) {
          // 手机断网可能只丢失响应；使用同一确认操作的 ID 核对，避免再建一份计划。
          const existing = await db
            .from("recurring_consumption_plans")
            .select("id")
            .eq("id", action.id)
            .eq("owner_id", profile.id)
            .maybeSingle();
          if (existing.error || !existing.data) throw error;
        }
        // 已创建后不重复创建；同步失败也保留计划并提示检查。
        setAction(null);
        setDescription("");
        setCreating(false);
        const sync = await db.rpc("sync_recurring_consumptions");
        setMessage(
          sync.error
            ? "计划已保存，但到期检查失败，请刷新查看，勿重复创建。"
            : sync.data?.blocked
              ? "计划已保存；部分到期记录暂未生成，请查看计划中的原因。"
              : "计划已保存。只有到期的月份才会生成记录，未来月份不影响存量。",
        );
      } else if (action.kind === "stop") {
        if (!reason.trim()) throw new Error("请填写终止原因。");
        const { error } = await db.rpc("stop_recurring_consumption", {
          p_id: action.plan.id,
          p_reason: reason.trim(),
        });
        if (error) throw error;
        setMessage(
          "计划已终止，不再生成后续记录；已生成记录保留。需要恢复时请新建计划。",
        );
      } else {
        const { error } = await db
          .from("recurring_consumption_plans")
          .update({ budget_category_id: category || null })
          .eq("id", action.plan.id)
          .select("id")
          .single();
        if (error) throw error;
        const sync = await db.rpc("sync_recurring_consumptions");
        setMessage(
          sync.error || sync.data?.blocked
            ? "后续预算科目已更新，请查看计划中的到期处理结果。"
            : "后续预算科目已更新，已生成记录保持不变。",
        );
      }
      setAction(null);
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  const budgetSelect = (
    <label className="field">
      <span>后续预算科目（有生效预算时必须匹配）</span>
      <select value={category} onChange={(e) => setCategory(e.target.value)}>
        <option value="">未指定</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <section className="card section-space recurring-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">MONTHLY PLAN</p>
          <h2>按月固定吃葡萄</h2>
        </div>
        <span className="badge">
          执行中 {plans.filter((p) => p.status === "active").length}
        </span>
      </div>
      <p className="muted">
        设置一次，到期生成。按北京时间执行，未来月份不扣除；固定吃葡萄可后补凭证，上传成功后不可删除。
      </p>
      {message && (
        <p className="notice success" role="status">
          {message}
        </p>
      )}
      {error && !action && (
        <p className="notice danger" role="alert">
          {error}
        </p>
      )}
      {!readonly && (
        <details
          className="entry-panel"
          open={creating}
          onToggle={(e) => setCreating(e.currentTarget.open)}
        >
          <summary>＋ 设置按月计划</summary>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              setError("");
              if (
                !description.trim() ||
                Number(amount) <= 0 ||
                !Number.isFinite(Number(amount)) ||
                start < toDateInput() ||
                end < start
              )
                return setError(
                  "请核对用途、数量及起止日期，起始日期不能早于今天。",
                );
              setAction({ kind: "create", id: crypto.randomUUID() });
            }}
          >
            <fieldset className="form-grid" disabled={busy}>
              <label className="field full-width">
                <span>固定用途</span>
                <input
                  className="input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={500}
                  required
                />
              </label>
              <label className="field">
                <span>每月葡萄数</span>
                <input
                  className="input"
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span>每月几号</span>
                <select value={day} onChange={(e) => setDay(e.target.value)}>
                  {Array.from({ length: 31 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      {i + 1} 日
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>计划开始日期</span>
                <input
                  className="input"
                  type="date"
                  min={toDateInput()}
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span>计划结束日期</span>
                <input
                  className="input"
                  type="date"
                  min={start}
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  required
                />
              </label>
              {budgetSelect}
            </fieldset>
            <p className="notice">
              {profile.organizations?.fixed_requires_approval
                ? "到期后生成待确认记录，管家确认后才影响存量。"
                : "到期后自动生效并锁定，当天到期的计划保存后即可执行。"}{" "}
              每月不足所选日期时取月末；最长可设置 10 年。
            </p>
            <button className="btn btn-primary" disabled={busy}>
              核对并创建计划
            </button>
          </form>
        </details>
      )}
      <div className="stack section-space">
        {plans.length === 0 && (
          <p className="muted">暂无按月计划。单笔固定吃葡萄仍可在下方登记。</p>
        )}
        {plans.map((p) => (
          <article className="card" key={p.id}>
            <div className="section-heading">
              <strong>{p.description}</strong>
              <span
                className={`badge ${p.status === "active" ? "ok" : "warn"}`}
              >
                {
                  { active: "执行中", stopped: "已终止", completed: "已结束" }[
                    p.status
                  ]
                }
              </span>
            </div>
            <p>
              {profileName(people[p.owner_id])} · 每月 {p.day_of_month} 日 ·{" "}
              {formatGrapes(p.grape_amount)}
            </p>
            <p className="muted">
              {p.start_date} 至 {p.end_date} · 已生成 {p.generated_count} 期
              {p.next_date ? ` · 下一期 ${p.next_date}` : ""}
            </p>
            {p.stop_reason && (
              <p className="notice">终止原因：{p.stop_reason}</p>
            )}
            {p.last_error && p.status === "active" && (
              <p className="notice danger" role="alert">
                到期记录尚未生成：{p.last_error}。修正后会补处理已到期月份。
              </p>
            )}
            {!readonly &&
              p.owner_id === profile.id &&
              p.status === "active" && (
                <div className="btn-row">
                  <button
                    className="btn btn-secondary"
                    onClick={() => ask({ kind: "category", plan: p })}
                  >
                    调整后续预算科目
                  </button>
                  <button
                    className="btn btn-danger"
                    onClick={() => ask({ kind: "stop", plan: p })}
                  >
                    终止后续计划
                  </button>
                </div>
              )}
          </article>
        ))}
      </div>
      <ConfirmDialog
        open={!!action}
        title={
          action?.kind === "create"
            ? "创建按月固定吃葡萄计划？"
            : action?.kind === "stop"
              ? "终止后续固定吃葡萄？"
              : "调整后续预算科目？"
        }
        loading={busy}
        errorMessage={error}
        danger={action?.kind === "stop"}
        onConfirm={() => void run()}
        onCancel={() => setAction(null)}
        description={
          <div className="stack">
            {action?.kind === "create" ? (
              <p>
                {start} 至 {end}，每月 {day} 日 {formatGrapes(Number(amount))}
                。仅到期月份生成；如果今天到期，将按农场规则立即生效或等待确认。
              </p>
            ) : action?.kind === "stop" ? (
              <>
                <p>
                  停止尚未生成的各期，已经生成的记录不会被撤回。终止后不能重新开启，需要新建计划。
                </p>
                <label className="field">
                  <span>终止原因（必填）</span>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
              </>
            ) : (
              <>
                {budgetSelect}
                <p>仅影响尚未生成的记录，已生成记录不变。</p>
              </>
            )}
          </div>
        }
      />
    </section>
  );
}
