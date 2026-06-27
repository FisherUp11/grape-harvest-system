"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";
import { formatGrapes, profileName, roleLabel } from "@/lib/utils";

type Props = { profile: Profile; profiles: Profile[] };

export default function SettingsClient({ profile, profiles }: Props) {
  const supabase = createClient();
  const router = useRouter();
  const [fixed, setFixed] = useState(String(profile.monthly_fixed_consumption ?? 0));
  const [threshold, setThreshold] = useState(String(profile.grape_alert_threshold ?? 0));
  const [message, setMessage] = useState("");

  const saveMine = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("profiles").update({ monthly_fixed_consumption: Number(fixed), grape_alert_threshold: Number(threshold) }).eq("id", profile.id);
    setMessage(error ? error.message : "已保存。");
    router.refresh();
  };

  const updateProfile = async (id: string, key: "monthly_fixed_consumption" | "grape_alert_threshold", value: string) => {
    const { error } = await supabase.from("profiles").update({ [key]: Number(value) }).eq("id", id);
    if (error) alert(error.message);
    router.refresh();
  };

  return (
    <>
      <header className="page-header"><div className="page-title"><p className="eyebrow">SYSTEM TUNING</p><h1>葡萄设置</h1><p>维护个人固定吃葡萄数、提醒阈值；葡萄管家可为所有用户设置提醒参数。</p></div></header>
      <section className="grid grid-2">
        <form className="card stack" onSubmit={saveMine}>
          <h2>我的提醒设置</h2>
          <div className="form-grid"><div className="field"><label>每月固定吃葡萄</label><input className="input" type="number" min="0" step="0.01" value={fixed} onChange={(e) => setFixed(e.target.value)} /></div><div className="field"><label>葡萄存量提醒阈值</label><input className="input" type="number" min="0" step="0.01" value={threshold} onChange={(e) => setThreshold(e.target.value)} /></div></div>
          {message && <div className="notice">{message}</div>}
          <button className="btn btn-primary">保存我的设置</button>
        </form>
        <div className="card"><h2>当前身份</h2><p><strong>{profileName(profile)}</strong></p><p className="badge">{roleLabel(profile.role)}</p><p className="muted">葡萄管家可确认记录、查看全体支持者联系方式，并配置每位用户提醒阈值。</p></div>
      </section>
      {profile.role === "grape_keeper" && <section className="card" style={{ marginTop: 18 }}><h2>用户提醒参数</h2><div className="table-wrap"><table><thead><tr><th>用户</th><th>角色</th><th>每月固定吃葡萄</th><th>提醒阈值</th></tr></thead><tbody>{profiles.map((p) => <tr key={p.id}><td>{profileName(p)}<br /><span className="muted">{p.email}</span></td><td><span className="badge">{roleLabel(p.role)}</span></td><td><input className="input" type="number" defaultValue={p.monthly_fixed_consumption ?? 0} onBlur={(e) => updateProfile(p.id, "monthly_fixed_consumption", e.target.value)} /></td><td><input className="input" type="number" defaultValue={p.grape_alert_threshold ?? 0} onBlur={(e) => updateProfile(p.id, "grape_alert_threshold", e.target.value)} /><div className="muted">当前：{formatGrapes(p.grape_alert_threshold ?? 0)}</div></td></tr>)}</tbody></table></div></section>}
    </>
  );
}
