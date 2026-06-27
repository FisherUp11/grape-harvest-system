"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { GrapeConsumption, Profile } from "@/lib/types";
import { consumptionTypeLabel, formatGrapes, profileName, statusLabel, toDateInput } from "@/lib/utils";

type Props = { profile: Profile; profiles: Profile[]; consumptions: GrapeConsumption[] };

export default function ConsumptionsClient({ profile, profiles, consumptions }: Props) {
  const supabase = createClient();
  const router = useRouter();
  const [date, setDate] = useState(toDateInput());
  const [amount, setAmount] = useState("");
  const [type, setType] = useState("fixed");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState("");
  const profileMap = useMemo(() => Object.fromEntries(profiles.map((p) => [p.id, p])), [profiles]);
  const isKeeper = profile.role === "grape_keeper";

  const createConsumption = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    const { error } = await supabase.from("grape_consumptions").insert({ org_id: profile.org_id, owner_id: profile.id, consumption_date: date, grape_amount: Number(amount), consumption_type: type, description, status: "pending" });
    if (error) return setMessage(error.message);
    setAmount(""); setDescription(""); router.refresh();
  };

  const confirmConsumption = async (id: string) => {
    const { error } = await supabase.from("grape_consumptions").update({ status: "confirmed", confirmed_by: profile.id, confirmed_at: new Date().toISOString() }).eq("id", id);
    if (error) alert(error.message);
    router.refresh();
  };

  const deleteConsumption = async (id: string) => {
    if (!confirm("删除这条待确认吃葡萄记录？")) return;
    const { error } = await supabase.from("grape_consumptions").delete().eq("id", id);
    if (error) alert(error.message);
    router.refresh();
  };

  return (
    <>
      <header className="page-header"><div className="page-title"><p className="eyebrow">GRAPE BITES</p><h1>吃葡萄</h1><p>记录固定、项目或一次性的吃葡萄情况；确认后从葡萄存量中扣减。</p></div></header>
      <section className="grid grid-2">
        <form className="card stack" onSubmit={createConsumption}>
          <h2>新增吃葡萄</h2>
          <div className="form-grid">
            <div className="field"><label>日期</label><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
            <div className="field"><label>葡萄数</label><input className="input" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required /></div>
            <div className="field"><label>类型</label><select value={type} onChange={(e) => setType(e.target.value)}><option value="fixed">固定吃葡萄</option><option value="project">项目吃葡萄</option><option value="one_time">一次性吃葡萄</option></select></div>
            <div className="field"><label>说明</label><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} required /></div>
          </div>
          {message && <div className="notice">{message}</div>}
          <button className="btn btn-primary">提交，等待葡萄管家确认</button>
        </form>
        <div className="card"><h2>自动化建议</h2><p className="muted">如果每月固定吃葡萄数稳定，可在“葡萄设置”中维护，用于葡萄存量提醒阈值。</p></div>
      </section>
      <section className="card" style={{ marginTop: 18 }}><h2>吃葡萄明细</h2><div className="table-wrap"><table><thead><tr><th>日期</th><th>用户</th><th>葡萄数</th><th>类型</th><th>说明</th><th>状态</th><th>操作</th></tr></thead><tbody>{consumptions.map((c) => <tr key={c.id}><td>{c.consumption_date}</td><td>{profileName(profileMap[c.owner_id])}</td><td>{formatGrapes(c.grape_amount)}</td><td>{consumptionTypeLabel(c.consumption_type)}</td><td>{c.description}</td><td><span className={`badge ${c.status === "confirmed" ? "ok" : "warn"}`}>{statusLabel(c.status)}</span></td><td><div className="btn-row">{isKeeper && c.status === "pending" && <button className="btn btn-primary" onClick={() => confirmConsumption(c.id)}>确认</button>}{c.owner_id === profile.id && c.status === "pending" && <button className="btn btn-danger" onClick={() => deleteConsumption(c.id)}>删除</button>}</div></td></tr>)}{consumptions.length === 0 && <tr><td colSpan={7} className="empty">暂无记录。</td></tr>}</tbody></table></div></section>
    </>
  );
}
