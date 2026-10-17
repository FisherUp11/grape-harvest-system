"use client";
import { useCallback, useEffect, useState } from "react";
import type { AuditLog, Profile } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import {
  auditActionLabel,
  errorMessage,
  formatDateTime,
  profileName,
} from "@/lib/utils";
import RecordTable from "@/app/components/RecordTable";
export default function AuditClient({
  profile,
  profiles,
}: {
  profile: Profile;
  profiles: Profile[];
}) {
  const [rows, setRows] = useState<AuditLog[]>([]),
    [page, setPage] = useState(0),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      let q = createClient()
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .order("id")
        .range(page * 50, page * 50 + 49);
      if (from) q = q.gte("created_at", `${from}T00:00:00+08:00`);
      if (to) q = q.lte("created_at", `${to}T23:59:59.999+08:00`);
      const { data, error } = await q;
      if (error) throw error;
      setRows(data || []);
      setError("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [page, from, to]);
  useEffect(() => {
    void load();
  }, [load]);
  const people = Object.fromEntries(profiles.map((p) => [p.id, p]));
  return (
    <>
      <header className="page-header">
        <div className="page-title">
          <p className="eyebrow">AUDIT TRAIL</p>
          <h1>操作与变更审计</h1>
          <p>
            记录提交、退回、修改、确认和作废的历史。审计不可在业务端修改或删除，图片文件不复制进日志。
          </p>
        </div>
        {profile.role === "super_admin" && (
          <a className="btn btn-secondary" href="/api/admin/export?kind=audit">
            导出全部审计归档
          </a>
        )}
      </header>
      <section className="card">
        <div className="record-filters">
          <label className="field">
            <span>开始日期</span>
            <input
              className="input"
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <label className="field">
            <span>结束日期</span>
            <input
              className="input"
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <button
            className="btn btn-secondary"
            onClick={() => void load()}
            disabled={busy}
          >
            刷新
          </button>
        </div>
        {error && (
          <p className="notice danger" role="alert">
            读取失败：{error}
          </p>
        )}
        <RecordTable
          headings={["时间", "操作人", "动作", "记录", "变更内容"]}
          rows={rows.map((r) => ({
            id: r.id,
            cells: [
              formatDateTime(r.created_at),
              r.actor_id ? profileName(people[r.actor_id]) : "系统或部署操作",
              auditActionLabel(r.action),
              `${r.entity_table} · ${r.entity_id?.slice(0, 8) || ""}`,
              <details key="detail">
                <summary>查看字段变化</summary>
                <pre className="audit-json">
                  {JSON.stringify(
                    { 修改前: r.old_data, 修改后: r.new_data },
                    null,
                    2,
                  )}
                </pre>
              </details>,
            ],
          }))}
        />
        <div className="btn-row section-space">
          <button
            className="btn btn-secondary"
            disabled={page === 0 || busy}
            onClick={() => setPage((p) => p - 1)}
          >
            上一页
          </button>
          <span>第 {page + 1} 页，每页最多 50 条</span>
          <button
            className="btn btn-secondary"
            disabled={rows.length < 50 || busy}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </button>
        </div>
      </section>
    </>
  );
}
