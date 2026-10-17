"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { STORAGE_QUOTA_BYTES, STORAGE_CHANGED_EVENT } from "@/lib/storage";
import type { StorageUsageBucket } from "@/lib/types";
import { budgetHealth, formatFileSize, formatPercent } from "@/lib/utils";

export default function StorageUsage({
  isKeeper,
  compact = false,
}: {
  isKeeper: boolean;
  compact?: boolean;
}) {
  const [state, setState] = useState<{
    rows: StorageUsageBucket[];
    updated: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const { data, error: failure } = await createClient().rpc(
        "get_storage_usage_summary",
      );
      if (failure) throw failure;
      setState({
        rows: data ?? [],
        updated: new Date().toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      });
      setError("");
    } catch {
      setError(
        "用量暂时无法读取，请重试；若持续失败，请检查数据库升级是否完成。",
      );
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(onVisible, 30_000);
    window.addEventListener(STORAGE_CHANGED_EVENT, onVisible);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener(STORAGE_CHANGED_EVENT, onVisible);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);
  const bytes = state?.rows.reduce((s, r) => s + Number(r.total_bytes), 0) ?? 0;
  const count =
    state?.rows.reduce((s, r) => s + Number(r.object_count), 0) ?? 0;
  const pct = (bytes / STORAGE_QUOTA_BYTES) * 100;
  const health = budgetHealth(pct);
  return (
    <section
      className={compact ? "storage-compact" : "card storage-card"}
      aria-label="附件空间用量"
    >
      <div className="section-heading">
        <strong>{isKeeper ? "机构附件空间" : "我的附件用量"}</strong>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={loading}
          onClick={() => void refresh()}
          aria-label="刷新空间用量"
        >
          {loading ? "读取中…" : "刷新"}
        </button>
      </div>
      {state ? (
        <>
          <div className="storage-amount">
            {formatFileSize(bytes)}
            {isKeeper && (
              <small> / {formatFileSize(STORAGE_QUOTA_BYTES)}</small>
            )}
          </div>
          {isKeeper && (
            <div className="progress-row">
              <div
                className={`progress ${health}`}
                role="progressbar"
                aria-label="附件空间占用"
                aria-valuenow={Math.min(pct, 100)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <span style={{ width: `${Math.min(pct, 100)}%` }} />
              </div>
              <span>{formatPercent(pct)}</span>
            </div>
          )}
          <p className="storage-caption">
            {count} 个文件
            {isKeeper &&
              ` · 剩余 ${formatFileSize(Math.max(0, STORAGE_QUOTA_BYTES - bytes))}`}
            <br />
            {state.updated} 更新 · 每 30 秒刷新
          </p>
          {isKeeper && pct >= 80 && (
            <p className="notice danger" role="status">
              {pct >= 100
                ? "附件空间已达到配置容量，请联系管理员扩容。"
                : "附件空间已用超过 80%，请及时安排扩容。"}
            </p>
          )}
        </>
      ) : (
        !error && <p className="storage-caption">正在读取实际用量…</p>
      )}
      {error && (
        <p className="storage-caption" role="alert">
          {error}
          {state && " 当前显示上次成功读取的数据。"}
        </p>
      )}
      {!compact && (
        <p className="muted storage-caption">
          {isKeeper
            ? "统计本机构凭证桶中的文件；容量为配置的附件额度，平台账单以控制台为准。"
            : "仅统计自己的凭证文件，不显示其他用户的资料。"}
        </p>
      )}
    </section>
  );
}
