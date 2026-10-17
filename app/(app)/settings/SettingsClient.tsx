"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import FarmApprovalPolicy from "@/app/components/FarmApprovalPolicy";
import StorageUsage from "@/app/components/StorageUsage";
import type { Profile } from "@/lib/types";
import {
  errorMessage,
  formatGrapes,
  profileName,
  roleLabel,
} from "@/lib/utils";

type JobConfig = { dailyJob: boolean; email: boolean; monthlyReports: boolean };
function ReminderForm({ profile, mine }: { profile: Profile; mine: boolean }) {
  const [fixed, setFixed] = useState(
    String(profile.monthly_fixed_consumption ?? 0),
  );
  const [threshold, setThreshold] = useState(
    String(profile.grape_alert_threshold ?? 0),
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setMessage("");
    setError("");
    if (
      ![fixed, threshold].every(
        (v) => v.trim() && Number.isFinite(Number(v)) && Number(v) >= 0,
      )
    )
      return setError("请输入大于或等于 0 的有效数值。");
    setSaving(true);
    try {
      const { error } = await createClient()
        .from("profiles")
        .update({
          monthly_fixed_consumption: Number(fixed),
          grape_alert_threshold: Number(threshold),
        })
        .eq("id", profile.id)
        .select("id")
        .single();
      if (error) throw error;
      setMessage("已保存提醒参数。");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <form className="card stack" onSubmit={save}>
      <div>
        <h2>{mine ? "我的提醒设置" : profileName(profile)}</h2>
        <p className="muted">
          {profile.email} · {roleLabel(profile.role)}
        </p>
      </div>
      <fieldset className="form-grid" disabled={saving}>
        <label className="field">
          <span>每月固定吃葡萄</span>
          <input
            className="input"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={fixed}
            onChange={(e) => setFixed(e.target.value)}
          />
        </label>
        <label className="field">
          <span>存量提醒阈值</span>
          <input
            className="input"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
        </label>
      </fieldset>
      <div className="btn-row">
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => setThreshold(String(Number(fixed) || 0))}
        >
          设为 1 个月固定用量
        </button>
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => setThreshold(String((Number(fixed) || 0) * 2))}
        >
          设为 2 个月固定用量
        </button>
      </div>
      <p className="muted">
        存量低于 {formatGrapes(Number(threshold))} 时提醒；阈值为 0
        表示关闭。每月固定用量用于预警参考，实际支出仍需登记和确认。
      </p>
      {message && (
        <p className="notice success" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="notice danger" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-primary" disabled={saving}>
        {saving ? "保存中…" : "保存设置"}
      </button>
    </form>
  );
}
export default function SettingsClient({
  profile,
  profiles,
  jobs,
}: {
  profile: Profile;
  profiles: Profile[];
  jobs: JobConfig;
}) {
  const [search, setSearch] = useState("");
  const keeper = profile.role === "grape_keeper";
  return (
    <>
      <header className="page-header">
        <div className="page-title">
          <p className="eyebrow">PREFERENCES</p>
          <h1>葡萄设置</h1>
          <p>设置固定用量和存量提醒阈值，查看附件空间使用情况。</p>
        </div>
      </header>
      <section className="grid grid-2">
        <ReminderForm profile={profile} mine />
        <StorageUsage isKeeper={keeper} />
      </section>
      {keeper && profile.org_id && (
        <FarmApprovalPolicy
          farmId={profile.org_id}
          required={profile.organizations?.fixed_requires_approval ?? false}
        />
      )}
      {keeper && (
        <section className="card section-space">
          <h2>自动检查与邮件配置状态</h2>
          <p>
            每日检查：
            <strong>
              {jobs.dailyJob
                ? "密钥已配置，调度运行情况见部署平台"
                : "未配置任务密钥"}
            </strong>
          </p>
          <p>
            提醒邮件：
            <strong>
              {jobs.email ? "服务配置已填写，待运行核验" : "未配置，不会发送"}
            </strong>
          </p>
          <p>
            月报邮件：
            <strong>
              {jobs.monthlyReports
                ? "已启用，每月发送上月摘要与报告入口"
                : "未启用"}
            </strong>
          </p>
          <p className="muted">
            邮件和定时任务需要部署环境配置。网页内的存量提醒、手动月报与下载可独立使用。
          </p>
        </section>
      )}
      {keeper && (
        <section className="section-space">
          <div className="section-heading">
            <h2>用户提醒参数</h2>
            <label className="field">
              <span>搜索用户</span>
              <input
                className="input"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="姓名或邮箱"
              />
            </label>
          </div>
          <div className="grid grid-2">
            {profiles
              .filter(
                (p) =>
                  p.id !== profile.id &&
                  `${profileName(p)} ${p.email || ""}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
              )
              .map((p) => (
                <ReminderForm
                  key={`${p.id}-${p.monthly_fixed_consumption}-${p.grape_alert_threshold}`}
                  profile={p}
                  mine={false}
                />
              ))}
          </div>
        </section>
      )}
    </>
  );
}
