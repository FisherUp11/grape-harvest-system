"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { CommitmentPeriod, GrapeReceipt, Profile, Supporter } from "@/lib/types";
import { cycleLabel, downloadCsv, formatGrapes, profileName } from "@/lib/utils";

type Props = { profile: Profile; profiles: Profile[]; supporters: Supporter[]; receipts: GrapeReceipt[]; periods: CommitmentPeriod[] };

export default function SupportersClient({ profile, profiles, supporters, receipts, periods }: Props) {
  const supabase = createClient();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const profileMap = useMemo(() => Object.fromEntries(profiles.map((p) => [p.id, p])), [profiles]);

  const stats = useMemo(() => {
    const map: Record<string, { confirmed: number; pending: number; missed: number; count: number; last: string }> = {};
    for (const s of supporters) map[s.id] = { confirmed: 0, pending: 0, missed: 0, count: 0, last: "" };
    for (const r of receipts) {
      if (!r.supporter_id || !map[r.supporter_id]) continue;
      if (r.status === "confirmed") { map[r.supporter_id].confirmed += Number(r.grape_amount); map[r.supporter_id].count += 1; map[r.supporter_id].last = [map[r.supporter_id].last, r.received_date].sort().pop() || r.received_date; }
      if (r.status === "pending") map[r.supporter_id].pending += Number(r.grape_amount);
    }
    for (const p of periods) if (map[p.supporter_id] && ["not_received", "overdue"].includes(p.status)) map[p.supporter_id].missed += Number(p.expected_grapes);
    return map;
  }, [supporters, receipts, periods]);

  const createSupporter = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("supporters").insert({ org_id: profile.org_id, owner_id: profile.id, name, email: email || null, notes: notes || null });
    if (error) return setMessage(error.message);
    setName(""); setEmail(""); setNotes(""); router.refresh();
  };

  const exportCsv = () => {
    downloadCsv(`支持者明细_${new Date().toISOString().slice(0,10)}.csv`, [["用户", "支持者", "邮箱", "备注", "支持类型", "周期", "已确认葡萄", "待确认葡萄", "未收到葡萄", "次数", "最近收到"], ...supporters.map((s) => [profileName(profileMap[s.owner_id]), s.name, s.email || "", s.notes || "", s.support_type === "recurring" ? "周期性" : "一次性", cycleLabel(s.cycle), String(stats[s.id]?.confirmed || 0), String(stats[s.id]?.pending || 0), String(stats[s.id]?.missed || 0), String(stats[s.id]?.count || 0), stats[s.id]?.last || ""])]);
  };

  return (
    <>
      <header className="page-header"><div className="page-title"><p className="eyebrow">SUPPORTER GARDEN</p><h1>支持者管理</h1><p>普通用户仅能查看自己的支持者；葡萄管家可查看所有用户的联系方式，但不会跨用户合并同名支持者。</p></div><button className="btn btn-secondary no-print" onClick={exportCsv}>导出 CSV</button></header>
      <section className="grid grid-2">
        <form className="card stack" onSubmit={createSupporter}>
          <h2>新增支持者</h2>
          <div className="form-grid"><div className="field"><label>姓名</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></div><div className="field"><label>邮箱</label><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div></div>
          <div className="field"><label>备注</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          {message && <div className="notice">{message}</div>}
          <button className="btn btn-primary">保存支持者</button>
        </form>
        <div className="card"><h2>隔离规则</h2><p className="muted">每条支持者记录都有所属用户。普通用户无法查询、导出或复用他人的支持者；葡萄管家可查看所有联系方式用于必要沟通。</p></div>
      </section>
      <section className="card" style={{ marginTop: 18 }}><h2>支持者列表</h2><div className="table-wrap"><table><thead><tr><th>用户</th><th>姓名</th><th>邮箱</th><th>备注</th><th>已确认</th><th>待确认</th><th>未收到</th><th>次数</th><th>最近收到</th></tr></thead><tbody>{supporters.map((s) => <tr key={s.id}><td>{profileName(profileMap[s.owner_id])}</td><td><strong>{s.name}</strong><br /><span className="muted">{s.support_type === "recurring" ? "周期性" : "一次性"} · {cycleLabel(s.cycle)}</span></td><td>{s.email || "-"}</td><td>{s.notes || "-"}</td><td>{formatGrapes(stats[s.id]?.confirmed || 0)}</td><td>{formatGrapes(stats[s.id]?.pending || 0)}</td><td>{formatGrapes(stats[s.id]?.missed || 0)}</td><td>{stats[s.id]?.count || 0}</td><td>{stats[s.id]?.last || "-"}</td></tr>)}{supporters.length === 0 && <tr><td colSpan={9} className="empty">暂无支持者。</td></tr>}</tbody></table></div></section>
    </>
  );
}
