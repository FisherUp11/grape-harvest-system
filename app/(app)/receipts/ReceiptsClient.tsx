"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import ConfirmDialog from "@/app/components/ConfirmDialog";
import type { GrapeReceipt, Profile, Supporter } from "@/lib/types";
import { formatDateTime, formatGrapes, profileName, receiptMethodLabel, statusLabel, supporterName, toDateInput } from "@/lib/utils";

type Props = { profile: Profile; profiles: Profile[]; supporters: Supporter[]; receipts: GrapeReceipt[] };

export default function ReceiptsClient({ profile, profiles, supporters, receipts }: Props) {
  const supabase = createClient();
  const router = useRouter();
  const [supporterId, setSupporterId] = useState(supporters.find((s) => s.owner_id === profile.id)?.id || "");
  const [date, setDate] = useState(toDateInput());
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("wechat");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [confirmTarget, setConfirmTarget] = useState<GrapeReceipt | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GrapeReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const supporterMap = useMemo(() => Object.fromEntries(supporters.map((s) => [s.id, s])), [supporters]);
  const profileMap = useMemo(() => Object.fromEntries(profiles.map((p) => [p.id, p])), [profiles]);
  const isKeeper = profile.role === "grape_keeper";

  const createReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    const { error } = await supabase.from("grape_receipts").insert({ org_id: profile.org_id, owner_id: profile.id, supporter_id: supporterId || null, received_date: date, grape_amount: Number(amount), receipt_method: method, source_type: "one_time", status: "pending", notes });
    if (error) return setMessage(error.message);
    setAmount(""); setNotes(""); router.refresh();
  };

  const confirmReceipt = async () => {
    if (!confirmTarget || busy) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("grape_receipts").update({ status: "confirmed", confirmed_by: profile.id, confirmed_at: new Date().toISOString() }).eq("id", confirmTarget.id);
      if (error) throw error;
      if (confirmTarget.commitment_period_id) {
        await supabase
          .from("commitment_periods")
          .update({ status: "confirmed", confirmed_by: profile.id, confirmed_at: new Date().toISOString(), actual_grapes: confirmTarget.grape_amount, actual_receipt_id: confirmTarget.id })
          .eq("id", confirmTarget.commitment_period_id);
      }
      setConfirmTarget(null);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "确认失败");
    } finally {
      setBusy(false);
    }
  };

  const deleteReceipt = async () => {
    if (!deleteTarget || busy) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("grape_receipts").delete().eq("id", deleteTarget.id);
      if (error) throw error;
      setDeleteTarget(null);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "删除失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="page-header"><div className="page-title"><p className="eyebrow">HARVEST LOG</p><h1>收葡萄</h1><p>记录实际已经收到的葡萄；待葡萄管家确认后才进入葡萄存量。</p></div></header>
      <section className="grid grid-2">
        <form className="card stack" onSubmit={createReceipt}>
          <h2>新增一次性收葡萄</h2>
          <div className="form-grid">
            <div className="field"><label>日期</label><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
            <div className="field"><label>葡萄数</label><input className="input" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} required /></div>
            <div className="field"><label>收到方式</label><select value={method} onChange={(e) => setMethod(e.target.value)}><option value="cash">现金</option><option value="wechat">微信</option><option value="alipay">支付宝</option><option value="bank">银行卡</option><option value="other">其他</option></select></div>
            <div className="field"><label>支持者</label><select value={supporterId} onChange={(e) => setSupporterId(e.target.value)}><option value="">未关联</option>{supporters.filter((s) => s.owner_id === profile.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          </div>
          <div className="field"><label>备注</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          {message && <div className="notice">{message}</div>}
          <button className="btn btn-primary">提交，等待葡萄管家确认</button>
        </form>
        <div className="card"><h2>确认规则</h2><p className="muted">记录者可在确认前编辑或删除。葡萄管家确认后，记录锁定并进入葡萄存量、月度报告与提醒计算。</p><div className="notice">周期性承诺请优先在“承诺支持”的期次中点击“标记已收到”。</div></div>
      </section>
      <section className="card" style={{ marginTop: 18 }}>
        <h2>收葡萄明细</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>日期</th><th>记录人 / 记录时间</th><th>支持者</th><th>葡萄数</th><th>方式</th><th>状态</th><th>确认人 / 确认时间</th><th>备注</th><th>操作</th></tr></thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.id}>
                  <td>{r.received_date}</td>
                  <td className="record-meta"><strong>{profileName(profileMap[r.owner_id])}</strong><br />{formatDateTime(r.created_at)}</td>
                  <td>{supporterName(r.supporter_id ? supporterMap[r.supporter_id] : null)}</td>
                  <td>{formatGrapes(r.grape_amount)}</td>
                  <td>{receiptMethodLabel(r.receipt_method)}</td>
                  <td><span className={`badge ${r.status === "confirmed" ? "ok" : "warn"}`}>{statusLabel(r.status)}</span></td>
                  <td className="record-meta">{r.status === "confirmed" ? <><strong>{profileName(profileMap[r.confirmed_by || ""])}</strong><br />{formatDateTime(r.confirmed_at)}</> : "-"}</td>
                  <td>{r.notes}</td>
                  <td>
                    <div className="btn-row">
                      {isKeeper && r.status === "pending" && <button className="btn btn-primary" onClick={() => setConfirmTarget(r)}>确认</button>}
                      {r.owner_id === profile.id && r.status === "pending" && <button className="btn btn-danger" onClick={() => setDeleteTarget(r)}>删除</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {receipts.length === 0 && <tr><td colSpan={9} className="empty">暂无记录。</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <ConfirmDialog
        open={!!confirmTarget}
        title="确认这条收葡萄记录？"
        loading={busy}
        confirmLabel="确认收到"
        loadingLabel="确认中…"
        description={
          confirmTarget ? (
            <dl>
              <dt>记录人</dt><dd>{profileName(profileMap[confirmTarget.owner_id])}</dd>
              <dt>日期</dt><dd>{confirmTarget.received_date}</dd>
              <dt>葡萄数</dt><dd>{formatGrapes(confirmTarget.grape_amount)}</dd>
              <dt>支持者</dt><dd>{supporterName(confirmTarget.supporter_id ? supporterMap[confirmTarget.supporter_id] : null)}</dd>
            </dl>
          ) : null
        }
        onConfirm={confirmReceipt}
        onCancel={() => !busy && setConfirmTarget(null)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="删除这条待确认收葡萄记录？"
        loading={busy}
        danger
        confirmLabel="确认删除"
        loadingLabel="删除中…"
        description={<p>删除后无法恢复，仅可删除尚未被葡萄管家确认的记录。</p>}
        onConfirm={deleteReceipt}
        onCancel={() => !busy && setDeleteTarget(null)}
      />
    </>
  );
}

