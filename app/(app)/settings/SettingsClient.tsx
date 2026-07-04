"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { STORAGE_QUOTA_BYTES } from "@/lib/storage";
import type { Profile, StorageUsageBucket } from "@/lib/types";
import { budgetHealth, formatFileSize, formatGrapes, formatPercent, profileName, roleLabel } from "@/lib/utils";

type Props = { profile: Profile; profiles: Profile[]; storageUsage: StorageUsageBucket[] };

export default function SettingsClient({ profile, profiles, storageUsage }: Props) {
  const supabase = createClient();
  const router = useRouter();
  const [fixed, setFixed] = useState(String(profile.monthly_fixed_consumption ?? 0));
  const [threshold, setThreshold] = useState(String(profile.grape_alert_threshold ?? 0));
  const [message, setMessage] = useState("");

  const totalBytes = useMemo(() => storageUsage.reduce((sum, b) => sum + Number(b.total_bytes), 0), [storageUsage]);
  const totalObjects = useMemo(() => storageUsage.reduce((sum, b) => sum + Number(b.object_count), 0), [storageUsage]);
  const storagePct = STORAGE_QUOTA_BYTES > 0 ? (totalBytes / STORAGE_QUOTA_BYTES) * 100 : 0;
  const storageHealth = budgetHealth(storagePct);

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
      {profile.role === "grape_keeper" && (
        <section className="card" style={{ marginTop: 18 }}>
          <div className="btn-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ margin: 0 }}>图床（Storage）用量</h2>
            <button className="btn btn-secondary" onClick={() => router.refresh()}>刷新用量</button>
          </div>
          <div className="progress-row" style={{ marginTop: 14 }}>
            <div className={`progress ${storageHealth}`}><span style={{ width: `${Math.min(storagePct, 100)}%` }} /></div>
            <span className={`progress-pct ${storageHealth}`}>{formatPercent(storagePct)}</span>
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            已用 {formatFileSize(totalBytes)} / {formatFileSize(STORAGE_QUOTA_BYTES)}（共 {totalObjects} 个文件），统计自吃葡萄凭证附件桶，为估算值，最终以 Supabase 控制台 Storage 页面为准。
          </p>
          {storagePct >= 80 && (
            <div className="notice" style={{ marginTop: 10 }}>
              图床空间已接近或超出基础版 {formatFileSize(STORAGE_QUOTA_BYTES)} 配额，建议提醒记录者清理无效附件，或考虑升级 Supabase 套餐。
            </div>
          )}
        </section>
      )}
    </>
  );
}
