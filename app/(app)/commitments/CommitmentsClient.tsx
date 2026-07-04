"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import ConfirmDialog from "@/app/components/ConfirmDialog";
import type { Commitment, CommitmentPeriod, Cycle, Profile, Supporter } from "@/lib/types";
import { addCycle, cycleLabel, formatDateTime, formatGrapes, profileName, statusLabel, supporterName, toDateInput } from "@/lib/utils";

type Props = { profile: Profile; profiles: Profile[]; supporters: Supporter[]; commitments: Commitment[]; periods: CommitmentPeriod[] };

export default function CommitmentsClient({ profile, profiles, supporters, commitments, periods }: Props) {
  const supabase = createClient();
  const router = useRouter();
  const [supporterId, setSupporterId] = useState(supporters[0]?.id || "");
  const [newSupporter, setNewSupporter] = useState("");
  const [amount, setAmount] = useState("1000");
  const [type, setType] = useState<"one_time" | "recurring">("recurring");
  const [cycle, setCycle] = useState<Cycle>("monthly");
  const [startDate, setStartDate] = useState(toDateInput());
  const [periodCount, setPeriodCount] = useState("12");
  const [expectedDay, setExpectedDay] = useState("5");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [stopTarget, setStopTarget] = useState<Commitment | null>(null);
  const [stopSubmitting, setStopSubmitting] = useState(false);
  const [busyPeriodId, setBusyPeriodId] = useState<string | null>(null);

  const supporterMap = useMemo(() => Object.fromEntries(supporters.map((s) => [s.id, s])), [supporters]);
  const profileMap = useMemo(() => Object.fromEntries(profiles.map((p) => [p.id, p])), [profiles]);
  const periodMap = useMemo(() => {
    const map: Record<string, CommitmentPeriod[]> = {};
    for (const p of periods) (map[p.commitment_id] ||= []).push(p);
    return map;
  }, [periods]);

  const supporterLabel = newSupporter.trim() || supporterMap[supporterId]?.name || "未选择支持者";
  const previewCount = type === "one_time" ? 1 : Math.max(1, Number(periodCount) || 1);
  const previewTotal = (Number(amount) || 0) * previewCount;

  const openConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    setSuccessMsg("");
    if (!supporterId && !newSupporter.trim()) return setMessage("请选择或新增支持者。");
    if (!amount || Number(amount) <= 0) return setMessage("请输入正确的葡萄数。");
    setConfirmOpen(true);
  };

  const createCommitment = async () => {
    if (submitting) return;
    setSubmitting(true);
    setMessage("");
    try {
      let finalSupporterId = supporterId;
      if (newSupporter.trim()) {
        const { data, error } = await supabase
          .from("supporters")
          .insert({ org_id: profile.org_id, owner_id: profile.id, name: newSupporter.trim(), support_type: type === "recurring" ? "recurring" : "one_time", cycle: type === "recurring" ? cycle : null })
          .select("id")
          .single();
        if (error) throw error;
        finalSupporterId = data.id;
      }
      if (!finalSupporterId) throw new Error("请选择或新增支持者。");

      const count = type === "one_time" ? 1 : Math.max(1, Number(periodCount));
      const grapeAmount = Number(amount);
      const start = new Date(`${startDate}T00:00:00`);
      const end = addCycle(start, type === "recurring" ? cycle : null, count - 1);
      const { data: commitment, error } = await supabase
        .from("commitments")
        .insert({
          org_id: profile.org_id,
          owner_id: profile.id,
          supporter_id: finalSupporterId,
          commitment_type: type,
          grape_amount: grapeAmount,
          cycle: type === "recurring" ? cycle : null,
          start_date: startDate,
          end_date: toDateInput(end),
          total_periods: count,
          expected_day: type === "recurring" ? Number(expectedDay) : null,
          total_grapes: grapeAmount * count,
          notes,
        })
        .select("id")
        .single();
      if (error) throw error;

      const rows = Array.from({ length: count }).map((_, i) => {
        const d = addCycle(start, type === "recurring" ? cycle : null, i);
        if (type === "recurring" && expectedDay) d.setDate(Math.min(Number(expectedDay), 28));
        return {
          org_id: profile.org_id,
          owner_id: profile.id,
          supporter_id: finalSupporterId,
          commitment_id: commitment.id,
          period_no: i + 1,
          expected_date: toDateInput(d),
          expected_grapes: grapeAmount,
        };
      });
      const { error: periodError } = await supabase.from("commitment_periods").insert(rows);
      if (periodError) throw periodError;

      setConfirmOpen(false);
      setSuccessMsg(`已成功生成 ${count} 期期次，共 ${formatGrapes(grapeAmount * count)}。`);
      setNewSupporter("");
      setNotes("");
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存失败，请重试。");
    } finally {
      setSubmitting(false);
    }
  };

  const markReceived = async (period: CommitmentPeriod) => {
    if (busyPeriodId) return;
    setBusyPeriodId(period.id);
    try {
      const { data, error } = await supabase
        .from("grape_receipts")
        .insert({
          org_id: profile.org_id,
          owner_id: period.owner_id,
          supporter_id: period.supporter_id,
          commitment_id: period.commitment_id,
          commitment_period_id: period.id,
          received_date: toDateInput(),
          grape_amount: period.expected_grapes,
          receipt_method: "other",
          source_type: "commitment",
          status: "pending",
        })
        .select("id")
        .single();
      if (error) throw error;
      await supabase.from("commitment_periods").update({ status: "pending_confirmation", actual_receipt_id: data.id, actual_grapes: period.expected_grapes, received_at: new Date().toISOString() }).eq("id", period.id);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusyPeriodId(null);
    }
  };

  const stopPeriod = async (period: CommitmentPeriod) => {
    if (busyPeriodId) return;
    setBusyPeriodId(period.id);
    try {
      await supabase.from("commitment_periods").update({ status: "stopped", stopped_at: new Date().toISOString() }).eq("id", period.id);
      router.refresh();
    } finally {
      setBusyPeriodId(null);
    }
  };

  const stopCommitment = async () => {
    if (!stopTarget || stopSubmitting) return;
    setStopSubmitting(true);
    try {
      await supabase.from("commitments").update({ status: "stopped" }).eq("id", stopTarget.id);
      await supabase.from("commitment_periods").update({ status: "stopped", stopped_at: new Date().toISOString() }).eq("commitment_id", stopTarget.id).in("status", ["not_received", "overdue"]);
      setStopTarget(null);
      router.refresh();
    } finally {
      setStopSubmitting(false);
    }
  };

  return (
    <>
      <header className="page-header"><div className="page-title"><p className="eyebrow">PROMISES VS REALITY</p><h1>承诺支持</h1><p>先记录承诺，再按期次追踪实际是否收到；只有葡萄管家确认后才进入葡萄存量。</p></div></header>
      <section className="grid grid-2">
        <form className="card stack" onSubmit={openConfirm}>
          <h2>新增承诺</h2>
          <div className="form-grid">
            <div className="field"><label>选择支持者</label><select value={supporterId} onChange={(e) => setSupporterId(e.target.value)}><option value="">不选择，使用下方新增</option>{supporters.filter((s) => s.owner_id === profile.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <div className="field"><label>或新增支持者</label><input className="input" value={newSupporter} onChange={(e) => setNewSupporter(e.target.value)} placeholder="支持者姓名" /></div>
            <div className="field"><label>承诺类型</label><select value={type} onChange={(e) => setType(e.target.value as "one_time" | "recurring")}><option value="recurring">周期性</option><option value="one_time">一次性</option></select></div>
            <div className="field"><label>每期葡萄数</label><input className="input" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} required /></div>
            {type === "recurring" && <><div className="field"><label>周期</label><select value={cycle} onChange={(e) => setCycle(e.target.value as Cycle)}><option value="monthly">每月</option><option value="quarterly">每季度</option><option value="half_yearly">每半年</option><option value="yearly">每年</option></select></div><div className="field"><label>期数</label><input className="input" type="number" min="1" value={periodCount} onChange={(e) => setPeriodCount(e.target.value)} /></div><div className="field"><label>预计收到日</label><input className="input" type="number" min="1" max="28" value={expectedDay} onChange={(e) => setExpectedDay(e.target.value)} /></div></>}
            <div className="field"><label>开始日期</label><input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required /></div>
          </div>
          <div className="field"><label>备注</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          {message && !confirmOpen && <div className="notice danger">{message}</div>}
          {successMsg && <div className="notice success">{successMsg}</div>}
          <button className="btn btn-primary" disabled={submitting}>保存承诺并生成期次</button>
        </form>

        <div className="card">
          <h2>承诺列表</h2>
          <div className="stack">
            {commitments.map((c) => {
              const ps = periodMap[c.id] || [];
              const confirmed = ps.filter((p) => p.status === "confirmed").reduce((sum, p) => sum + Number(p.expected_grapes), 0);
              return (
                <div key={c.id} className="card" style={{ boxShadow: "none" }}>
                  <div className="btn-row" style={{ justifyContent: "space-between" }}><strong>{supporterName(supporterMap[c.supporter_id])}</strong><span className="badge">{statusLabel(c.status)}</span></div>
                  <p className="muted">{profileName(profileMap[c.owner_id])} · {cycleLabel(c.cycle)} · {formatGrapes(c.grape_amount)} × {c.total_periods} 期</p>
                  <p>已确认 {formatGrapes(confirmed)} / 承诺 {formatGrapes(c.total_grapes)}</p>
                  <p className="record-meta">记录人：<strong>{profileName(profileMap[c.owner_id])}</strong> · 记录时间：{formatDateTime(c.created_at)}</p>
                  {c.status === "active" && c.owner_id === profile.id && <button className="btn btn-secondary" onClick={() => setStopTarget(c)}>停止后续期次</button>}
                </div>
              );
            })}
            {commitments.length === 0 && <div className="empty">还没有承诺记录。</div>}
          </div>
        </div>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <h2>期次计划</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>预计日期</th><th>用户</th><th>支持者</th><th>葡萄数</th><th>状态</th><th>记录时间</th><th>确认人 / 确认时间</th><th>操作</th></tr></thead>
            <tbody>
              {periods.slice(0, 80).map((p) => (
                <tr key={p.id}>
                  <td>{p.expected_date}</td>
                  <td>{profileName(profileMap[p.owner_id])}</td>
                  <td>{supporterName(supporterMap[p.supporter_id])}</td>
                  <td>{formatGrapes(p.expected_grapes)}</td>
                  <td><span className={`badge ${p.status === "confirmed" ? "ok" : p.status === "overdue" ? "danger" : "warn"}`}>{statusLabel(p.status)}</span></td>
                  <td className="muted">{formatDateTime(p.created_at)}</td>
                  <td className="muted">{p.status === "confirmed" ? <>{profileName(profileMap[p.confirmed_by || ""])}<br />{formatDateTime(p.confirmed_at)}</> : "-"}</td>
                  <td>
                    <div className="btn-row">
                      {p.owner_id === profile.id && ["not_received", "overdue"].includes(p.status) && <button className="btn btn-primary" disabled={busyPeriodId === p.id} onClick={() => markReceived(p)} key="r">标记已收到</button>}
                      {p.owner_id === profile.id && ["not_received", "overdue"].includes(p.status) && <button className="btn btn-secondary" disabled={busyPeriodId === p.id} onClick={() => stopPeriod(p)} key="s">停止</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {periods.length === 0 && <tr><td colSpan={8} className="empty">暂无期次。</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <ConfirmDialog
        open={confirmOpen}
        title="确认生成承诺与期次"
        loading={submitting}
        confirmLabel="确认生成"
        loadingLabel="正在生成…"
        errorMessage={message || null}
        description={
          <dl>
            <dt>支持者</dt><dd>{supporterLabel}</dd>
            <dt>承诺类型</dt><dd>{type === "recurring" ? `周期性 · ${cycleLabel(cycle)}` : "一次性"}</dd>
            <dt>每期葡萄数</dt><dd>{formatGrapes(Number(amount) || 0)}</dd>
            <dt>将生成期次数</dt><dd>{previewCount} 期</dd>
            <dt>承诺总葡萄数</dt><dd>{formatGrapes(previewTotal)}</dd>
            <dt>开始日期</dt><dd>{startDate}</dd>
          </dl>
        }
        onConfirm={createCommitment}
        onCancel={() => !submitting && setConfirmOpen(false)}
      />

      <ConfirmDialog
        open={!!stopTarget}
        title="确认停止该承诺？"
        loading={stopSubmitting}
        danger
        confirmLabel="确认停止"
        loadingLabel="处理中…"
        description={<p>停止后，尚未收到的未来期次将标记为「已停止」，不再计入预期。此操作不可撤销。</p>}
        onConfirm={stopCommitment}
        onCancel={() => !stopSubmitting && setStopTarget(null)}
      />
    </>
  );
}

