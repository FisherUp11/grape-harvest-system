"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import ConfirmDialog from "@/app/components/ConfirmDialog";
import RecordTable from "@/app/components/RecordTable";
import type {
  Commitment,
  CommitmentPeriod,
  Cycle,
  Profile,
  Supporter,
} from "@/lib/types";
import {
  cycleLabel,
  downloadCsv,
  errorMessage,
  periodStatus,
  formatDateTime,
  formatGrapes,
  profileName,
  statusLabel,
  supporterName,
  toDateInput,
} from "@/lib/utils";

type Props = {
  profile: Profile;
  profiles: Profile[];
  supporters: Supporter[];
  commitments: Commitment[];
  periods: CommitmentPeriod[];
};

export default function CommitmentsClient({
  profile,
  profiles,
  supporters,
  commitments,
  periods,
}: Props) {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [supporterId, setSupporterId] = useState(
    supporters.find((s) => s.owner_id === profile.id)?.id || "",
  );
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
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(
    searchParams.get("status") === "overdue" ? "overdue" : "all",
  );
  const [receivedPeriod, setReceivedPeriod] = useState<CommitmentPeriod | null>(
    null,
  );
  const [actualAmount, setActualAmount] = useState("");
  const [receivedDate, setReceivedDate] = useState(toDateInput());
  const [receiptMethod, setReceiptMethod] = useState("wechat");
  const [busyPeriodId, setBusyPeriodId] = useState<string | null>(null);

  const supporterMap = useMemo(
    () => Object.fromEntries(supporters.map((s) => [s.id, s])),
    [supporters],
  );
  const profileMap = useMemo(
    () => Object.fromEntries(profiles.map((p) => [p.id, p])),
    [profiles],
  );
  const periodMap = useMemo(() => {
    const map: Record<string, CommitmentPeriod[]> = {};
    for (const p of periods) (map[p.commitment_id] ||= []).push(p);
    return map;
  }, [periods]);

  const filteredPeriods = periods.filter(
    (p) =>
      (statusFilter === "all" || periodStatus(p) === statusFilter) &&
      `${supporterName(supporterMap[p.supporter_id])} ${profileName(profileMap[p.owner_id])}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const supporterLabel =
    newSupporter.trim() || supporterMap[supporterId]?.name || "未选择支持者";
  const previewCount =
    type === "one_time" ? 1 : Math.max(1, Number(periodCount) || 1);
  const previewTotal = (Number(amount) || 0) * previewCount;

  const openConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    setSuccessMsg("");
    if (!supporterId && !newSupporter.trim())
      return setMessage("请选择或新增支持者。");
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0)
      return setMessage("请输入正确的葡萄数。");
    if (
      type === "recurring" &&
      (!Number.isInteger(Number(periodCount)) ||
        Number(periodCount) < 1 ||
        Number(periodCount) > 120)
    )
      return setMessage("期数须为 1–120 的整数。");
    setConfirmOpen(true);
  };

  const createCommitment = async () => {
    if (submitting) return;
    setSubmitting(true);
    setMessage("");
    try {
      const count = type === "one_time" ? 1 : Number(periodCount);
      const { error } = await supabase.rpc("create_commitment_with_periods", {
        p_supporter_id: supporterId || null,
        p_new_supporter: newSupporter.trim() || null,
        p_type: type,
        p_amount: Number(amount),
        p_cycle: type === "recurring" ? cycle : null,
        p_start: startDate,
        p_count: count,
        p_expected_day: type === "recurring" ? Number(expectedDay) : null,
        p_notes: notes.trim() || null,
      });
      if (error) throw error;
      setConfirmOpen(false);
      setSuccessMsg(
        `已成功生成 ${count} 期期次，共 ${formatGrapes(Number(amount) * count)}。`,
      );
      setNewSupporter("");
      setNotes("");
      router.refresh();
    } catch (err) {
      setMessage(errorMessage(err, "保存失败，请重试。"));
    } finally {
      setSubmitting(false);
    }
  };

  const markReceived = async () => {
    const period = receivedPeriod;
    if (!period) return;
    if (!Number.isFinite(Number(actualAmount)) || Number(actualAmount) <= 0)
      return setMessage("请输入实际收到的葡萄数。");
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
          received_date: receivedDate,
          grape_amount: Number(actualAmount),
          receipt_method: receiptMethod,
          source_type: "commitment",
          status: "draft",
        })
        .select("id")
        .single();
      if (error) throw error;
      const submitted = await supabase.rpc("record_action", {
        p_table: "grape_receipts",
        p_id: data.id,
        p_action: "submit",
      });
      if (submitted.error) throw submitted.error;
      setReceivedPeriod(null);
      setSuccessMsg("已登记实际收到，等待管家确认。期次已同步。");
      router.refresh();
    } catch (err) {
      setMessage(errorMessage(err));
    } finally {
      setBusyPeriodId(null);
    }
  };

  const stopPeriod = async (period: CommitmentPeriod) => {
    if (busyPeriodId) return;
    setBusyPeriodId(period.id);
    try {
      const { error } = await supabase
        .from("commitment_periods")
        .update({ status: "stopped", stopped_at: new Date().toISOString() })
        .eq("id", period.id)
        .select("id")
        .single();
      if (error) throw error;
      router.refresh();
    } catch (err) {
      setMessage(errorMessage(err));
    } finally {
      setBusyPeriodId(null);
    }
  };

  const stopCommitment = async () => {
    if (!stopTarget || stopSubmitting) return;
    setStopSubmitting(true);
    try {
      const { error } = await supabase.rpc("stop_commitment", {
        p_id: stopTarget.id,
      });
      if (error) throw error;
      setStopTarget(null);
      router.refresh();
    } catch (err) {
      setMessage(errorMessage(err));
    } finally {
      setStopSubmitting(false);
    }
  };

  return (
    <>
      <header className="page-header">
        <div className="page-title">
          <p className="eyebrow">PROMISES VS REALITY</p>
          <h1>承诺支持</h1>
          <p>
            先记录承诺，再按期次追踪实际是否收到；只有葡萄管家确认后才进入葡萄存量。
          </p>
        </div>
      </header>
      <section className="grid grid-2">
        {profile.role !== "super_admin" && (
          <form className="card stack" onSubmit={openConfirm}>
            <h2>新增承诺</h2>
            <div className="form-grid">
              <div className="field">
                <label>选择支持者</label>
                <select
                  value={supporterId}
                  onChange={(e) => setSupporterId(e.target.value)}
                >
                  <option value="">不选择，使用下方新增</option>
                  {supporters
                    .filter((s) => s.owner_id === profile.id)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="field">
                <label>或新增支持者</label>
                <input
                  className="input"
                  value={newSupporter}
                  onChange={(e) => setNewSupporter(e.target.value)}
                  placeholder="支持者姓名"
                />
              </div>
              <div className="field">
                <label>承诺类型</label>
                <select
                  value={type}
                  onChange={(e) =>
                    setType(e.target.value as "one_time" | "recurring")
                  }
                >
                  <option value="recurring">周期性</option>
                  <option value="one_time">一次性</option>
                </select>
              </div>
              <div className="field">
                <label>每期葡萄数</label>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </div>
              {type === "recurring" && (
                <>
                  <div className="field">
                    <label>周期</label>
                    <select
                      value={cycle}
                      onChange={(e) => setCycle(e.target.value as Cycle)}
                    >
                      <option value="monthly">每月</option>
                      <option value="quarterly">每季度</option>
                      <option value="half_yearly">每半年</option>
                      <option value="yearly">每年</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>期数</label>
                    <input
                      className="input"
                      type="number"
                      min="1"
                      max="120"
                      step="1"
                      value={periodCount}
                      onChange={(e) => setPeriodCount(e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>预计收到日</label>
                    <input
                      className="input"
                      type="number"
                      min="1"
                      max="28"
                      value={expectedDay}
                      onChange={(e) => setExpectedDay(e.target.value)}
                    />
                  </div>
                </>
              )}
              <div className="field">
                <label>开始日期</label>
                <input
                  className="input"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="field">
              <label>备注</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            {message && !confirmOpen && (
              <div className="notice danger">{message}</div>
            )}
            {successMsg && <div className="notice success">{successMsg}</div>}
            <button className="btn btn-primary" disabled={submitting}>
              保存承诺并生成期次
            </button>
          </form>
        )}

        <div className="card">
          <h2>承诺列表</h2>
          <div className="stack">
            {commitments.map((c) => {
              const ps = periodMap[c.id] || [];
              const confirmed = ps
                .filter((p) => p.status === "confirmed")
                .reduce(
                  (sum, p) =>
                    sum + Number(p.actual_grapes ?? p.expected_grapes),
                  0,
                );
              return (
                <div key={c.id} className="card" style={{ boxShadow: "none" }}>
                  <div
                    className="btn-row"
                    style={{ justifyContent: "space-between" }}
                  >
                    <strong>
                      {supporterName(supporterMap[c.supporter_id])}
                    </strong>
                    <span className="badge">{statusLabel(c.status)}</span>
                  </div>
                  <p className="muted">
                    {profileName(profileMap[c.owner_id])} ·{" "}
                    {cycleLabel(c.cycle)} · {formatGrapes(c.grape_amount)} ×{" "}
                    {c.total_periods} 期
                  </p>
                  <p>
                    已确认 {formatGrapes(confirmed)} / 承诺{" "}
                    {formatGrapes(c.total_grapes)}
                  </p>
                  <p className="record-meta">
                    记录人：
                    <strong>{profileName(profileMap[c.owner_id])}</strong> ·
                    记录时间：{formatDateTime(c.created_at)}
                  </p>
                  {c.status === "active" &&
                    c.owner_id === profile.id &&
                    profile.role !== "super_admin" && (
                      <button
                        className="btn btn-secondary"
                        onClick={() => setStopTarget(c)}
                      >
                        停止后续期次
                      </button>
                    )}
                </div>
              );
            })}
            {commitments.length === 0 && (
              <div className="empty">还没有承诺记录。</div>
            )}
          </div>
        </div>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <h2>期次计划</h2>
        <div className="record-filters">
          <label className="field">
            <span>搜索支持者或用户</span>
            <input
              className="input"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label className="field">
            <span>期次状态</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">全部期次</option>
              {[
                "not_received",
                "overdue",
                "pending_confirmation",
                "confirmed",
                "stopped",
              ].map((v) => (
                <option key={v} value={v}>
                  {statusLabel(v)}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn btn-secondary"
            onClick={() =>
              downloadCsv(`承诺期次_${toDateInput()}.csv`, [
                ["预计日期", "用户", "支持者", "承诺葡萄", "实际葡萄", "状态"],
                ...filteredPeriods.map((p) => [
                  p.expected_date,
                  profileName(profileMap[p.owner_id]),
                  supporterName(supporterMap[p.supporter_id]),
                  String(p.expected_grapes),
                  p.actual_grapes == null ? "" : String(p.actual_grapes),
                  statusLabel(periodStatus(p)),
                ]),
              ])
            }
          >
            导出筛选结果 CSV
          </button>
        </div>
        <p className="muted">
          共 {filteredPeriods.length} 期 · 承诺数与实际收到数分别记录。
        </p>
        <RecordTable
          headings={[
            "预计日期",
            "用户",
            "支持者",
            "承诺 / 实际",
            "状态",
            "确认信息",
            "操作",
          ]}
          rows={filteredPeriods.map((p) => ({
            id: p.id,
            cells: [
              p.expected_date,
              profileName(profileMap[p.owner_id]),
              supporterName(supporterMap[p.supporter_id]),
              `${formatGrapes(p.expected_grapes)} / ${p.actual_grapes == null ? "未收到" : formatGrapes(p.actual_grapes)}`,
              <span
                key="s"
                className={`badge ${p.status === "confirmed" ? "ok" : periodStatus(p) === "overdue" ? "danger" : "warn"}`}
              >
                {statusLabel(periodStatus(p))}
              </span>,
              p.confirmed_at
                ? `${profileName(profileMap[p.confirmed_by || ""])} · ${formatDateTime(p.confirmed_at)}`
                : "—",
              <div key="actions" className="btn-row">
                {p.owner_id === profile.id &&
                  profile.role !== "super_admin" &&
                  !p.actual_receipt_id &&
                  ["not_received", "overdue"].includes(p.status) && (
                    <>
                      <button
                        className="btn btn-primary"
                        disabled={busyPeriodId === p.id}
                        onClick={() => {
                          setMessage("");
                          setReceivedPeriod(p);
                          setActualAmount(String(p.expected_grapes));
                          setReceivedDate(toDateInput());
                        }}
                      >
                        标记已收到
                      </button>
                      <button
                        className="btn btn-secondary"
                        disabled={busyPeriodId === p.id}
                        onClick={() => void stopPeriod(p)}
                      >
                        停止该期
                      </button>
                    </>
                  )}
                {p.status === "pending_confirmation" && (
                  <span className="muted">可在收葡萄页修改</span>
                )}
              </div>,
            ],
          }))}
        />
      </section>

      <ConfirmDialog
        open={!!receivedPeriod}
        title="登记这期实际收到"
        confirmLabel="提交待确认"
        loading={!!busyPeriodId}
        errorMessage={message}
        onConfirm={() => void markReceived()}
        onCancel={() => setReceivedPeriod(null)}
        description={
          <div className="stack">
            <p>
              {supporterName(
                receivedPeriod
                  ? supporterMap[receivedPeriod.supporter_id]
                  : null,
              )}{" "}
              · 承诺 {formatGrapes(receivedPeriod?.expected_grapes)}
              ，请按实际收到填写。
            </p>
            <label className="field">
              <span>实际收到葡萄数</span>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                value={actualAmount}
                onChange={(e) => setActualAmount(e.target.value)}
              />
            </label>
            <label className="field">
              <span>收到日期</span>
              <input
                className="input"
                type="date"
                value={receivedDate}
                onChange={(e) => setReceivedDate(e.target.value)}
              />
            </label>
            <label className="field">
              <span>收到方式</span>
              <select
                value={receiptMethod}
                onChange={(e) => setReceiptMethod(e.target.value)}
              >
                <option value="wechat">微信</option>
                <option value="alipay">支付宝</option>
                <option value="bank">银行卡</option>
                <option value="cash">现金</option>
                <option value="other">其他</option>
              </select>
            </label>
          </div>
        }
      />
      <ConfirmDialog
        open={confirmOpen}
        title="确认生成承诺与期次"
        loading={submitting}
        confirmLabel="确认生成"
        loadingLabel="正在生成…"
        errorMessage={message || null}
        description={
          <dl>
            <dt>支持者</dt>
            <dd>{supporterLabel}</dd>
            <dt>承诺类型</dt>
            <dd>
              {type === "recurring"
                ? `周期性 · ${cycleLabel(cycle)}`
                : "一次性"}
            </dd>
            <dt>每期葡萄数</dt>
            <dd>{formatGrapes(Number(amount) || 0)}</dd>
            <dt>将生成期次数</dt>
            <dd>{previewCount} 期</dd>
            <dt>承诺总葡萄数</dt>
            <dd>{formatGrapes(previewTotal)}</dd>
            <dt>开始日期</dt>
            <dd>{startDate}</dd>
          </dl>
        }
        onConfirm={createCommitment}
        onCancel={() => !submitting && setConfirmOpen(false)}
      />

      <ConfirmDialog
        open={!!stopTarget}
        title="确认停止该承诺？"
        errorMessage={message}
        loading={stopSubmitting}
        danger
        confirmLabel="确认停止"
        loadingLabel="处理中…"
        description={
          <p>
            停止后，尚未收到的未来期次将标记为「已停止」，不再计入预期。此操作不可撤销。
          </p>
        }
        onConfirm={stopCommitment}
        onCancel={() => !stopSubmitting && setStopTarget(null)}
      />
    </>
  );
}
