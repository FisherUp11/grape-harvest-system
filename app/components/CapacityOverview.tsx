"use client";
import { useCallback, useEffect, useState } from "react";
import type { EstateCapacity } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { formatFileSize, formatPercent, errorMessage } from "@/lib/utils";
import { STORAGE_CHANGED_EVENT, STORAGE_QUOTA_BYTES } from "@/lib/storage";
import RecordTable from "./RecordTable";
const dbMb = Number(process.env.NEXT_PUBLIC_DATABASE_QUOTA_MB || 500);
const DB_QUOTA = (Number.isFinite(dbMb) && dbMb > 0 ? dbMb : 500) * 1024 ** 2;
function Meter({
  label,
  bytes,
  quota,
}: {
  label: string;
  bytes: number;
  quota: number;
}) {
  const pct = (bytes / quota) * 100;
  const health = pct >= 90 ? "danger" : pct >= 70 ? "warn" : "ok";
  return (
    <div className="card">
      <h3>{label}</h3>
      <div className="storage-amount">
        {formatFileSize(bytes)} <small>/ {formatFileSize(quota)}</small>
      </div>
      <div className="progress-row">
        <div
          className={`progress ${health}`}
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, pct)}
        >
          <span style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
        <strong>{formatPercent(pct)}</strong>
      </div>
      <p className="muted">剩余 {formatFileSize(Math.max(0, quota - bytes))}</p>
      {pct >= 70 && (
        <p className={`notice ${pct >= 90 ? "danger" : ""}`} role="status">
          {pct >= 90
            ? "已用超过 90%，请尽快归档或扩容。"
            : pct >= 80
              ? "已用超过 80%，请安排归档或扩容。"
              : "已用超过 70%，请关注增长。"}
        </p>
      )}
    </div>
  );
}
export default function CapacityOverview() {
  const [data, setData] = useState<EstateCapacity | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await createClient().rpc("get_estate_capacity");
      if (error) throw error;
      setData(data);
      setError("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = setInterval(visible, 30000);
    window.addEventListener("focus", visible);
    window.addEventListener(STORAGE_CHANGED_EVENT, visible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", visible);
      window.removeEventListener(STORAGE_CHANGED_EVENT, visible);
    };
  }, [refresh]);
  return (
    <section className="stack">
      <div className="section-heading">
        <h2>庄园容量总览</h2>
        <button
          className="btn btn-secondary"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? "读取中…" : "刷新容量"}
        </button>
      </div>
      {error && (
        <p className="notice danger" role="alert">
          容量读取失败：{error}{" "}
          {data ? "当前保留上次读数。" : "不会将失败显示为零。"}
        </p>
      )}
      {!data && !error && <p role="status">正在读取数据库与文件实际用量…</p>}
      {data && (
        <>
          <div className="grid grid-2">
            <Meter
              label="数据库容量"
              bytes={Number(data.database_bytes)}
              quota={DB_QUOTA}
            />
            <Meter
              label="文件存储容量"
              bytes={Number(data.storage_bytes)}
              quota={STORAGE_QUOTA_BYTES}
            />
          </div>
          <div className="card">
            <h3>审计占用</h3>
            <p>
              {Number(data.audit_count).toLocaleString("zh-CN")} 条 ·{" "}
              {formatFileSize(Number(data.audit_bytes))}（含索引）
            </p>
            <p className="muted">
              全局文件 {data.storage_count} 个 ·{" "}
              {new Date(data.measured_at).toLocaleString("zh-CN", {
                timeZone: "Asia/Shanghai",
              })}{" "}
              更新，每 30
              秒刷新。数据库读数包含实际数据库占用；配额为配置参考，最终以平台控制台为准。
            </p>
            <div className="btn-row">
              <a
                className="btn btn-secondary"
                href="/api/admin/export?kind=audit"
              >
                导出审计归档
              </a>
              <a
                className="btn btn-secondary"
                href="/api/admin/export?kind=backup"
              >
                导出业务文字备份
              </a>
            </div>
            <p className="muted">
              导出不会删除历史资料；备份不含图片文件、Auth 密码或密钥。
            </p>
          </div>
          <RecordTable
            headings={["农场", "成员与管家", "待审核", "附件用量"]}
            rows={data.farms.map((f) => ({
              id: f.id,
              cells: [
                f.name,
                <div key="members">
                  {f.user_count} 人 · 管家 {f.keeper_count ?? 0} 位
                  {f.keeper_count === 0 && (
                    <p className="notice danger">请先分配农场管家</p>
                  )}
                </div>,
                `${f.pending_count ?? 0} 条`,
                formatFileSize(Number(f.storage_bytes)),
              ],
            }))}
          />
        </>
      )}
    </section>
  );
}
