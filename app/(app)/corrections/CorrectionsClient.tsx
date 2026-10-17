"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  Profile,
  RecordCorrection,
  GrapeReceipt,
  GrapeConsumption,
} from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import {
  errorMessage,
  formatGrapes,
  profileName,
  statusLabel,
  toDateInput,
} from "@/lib/utils";
import ConfirmDialog from "@/app/components/ConfirmDialog";
import RecordTable from "@/app/components/RecordTable";
export default function CorrectionsClient({
  profile,
  profiles,
  corrections,
  receipts,
  consumptions,
}: {
  profile: Profile;
  profiles: Profile[];
  corrections: RecordCorrection[];
  receipts: GrapeReceipt[];
  consumptions: GrapeConsumption[];
}) {
  const router = useRouter(),
    params = useSearchParams();
  const [table, setTable] = useState(
      params.get("table") === "grape_receipts"
        ? "grape_receipts"
        : "grape_consumptions",
    ),
    [target, setTarget] = useState(params.get("record") || "");
  const [editing, setEditing] = useState<RecordCorrection | null>(null),
    [amount, setAmount] = useState(""),
    [reason, setReason] = useState(""),
    [date, setDate] = useState(toDateInput());
  const [action, setAction] = useState<{
      kind: "create" | "confirm" | "return" | "archive";
      row?: RecordCorrection;
    } | null>(null),
    [reviewReason, setReviewReason] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const options = (table === "grape_receipts" ? receipts : consumptions).filter(
    (r) => r.owner_id === profile.id && r.status === "confirmed",
  );
  const original = options.find((r) => r.id === target);
  const people = Object.fromEntries(profiles.map((p) => [p.id, p]));
  const run = async () => {
    if (!action || busy) return;
    setBusy(true);
    setError("");
    try {
      const db = createClient();
      if (action.kind === "create") {
        if (
          !original ||
          !reason.trim() ||
          !amount.trim() ||
          !Number.isFinite(Number(amount)) ||
          Number(amount) < 0
        )
          throw new Error("请选择原单、填写原因和大于或等于 0 的更正后金额。");
        const payload = {
          replacement_amount: Number(amount),
          reason: reason.trim(),
          correction_date: date,
        };
        const result = editing
          ? await db
              .from("record_corrections")
              .update(payload)
              .eq("id", editing.id)
              .in("status", ["draft", "returned"])
              .select("*")
              .single()
          : await db
              .from("record_corrections")
              .insert({
                ...payload,
                org_id: profile.org_id,
                owner_id: profile.id,
                target_table: table,
                target_id: target,
                previous_amount: 0,
                status: "draft",
              })
              .select("*")
              .single();
        if (result.error) throw result.error;
        setEditing(result.data as RecordCorrection);
        const submit = await db.rpc("record_action", {
          p_table: "record_corrections",
          p_id: result.data.id,
          p_action: "submit",
        });
        if (submit.error) throw submit.error;
        setMessage("更正单已提交，原记录保持不变，审核后仅将差额计入存量。");
        setEditing(null);
        setAmount("");
        setReason("");
      } else {
        if (["return", "archive"].includes(action.kind) && !reviewReason.trim())
          throw new Error("请填写原因。");
        const result = await db.rpc("record_action", {
          p_table: "record_corrections",
          p_id: action.row!.id,
          p_action: action.kind,
          p_reason: reviewReason.trim(),
        });
        if (result.error) throw result.error;
        setMessage("更正单操作已完成。");
      }
      setAction(null);
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <header className="page-header">
        <div className="page-title">
          <p className="eyebrow">CORRECTIONS</p>
          <h1>更正单</h1>
          <p>
            已确认原单永不覆盖。更正单必须由本农场管家审核，生效差额计入更正日期所在月份。
          </p>
        </div>
      </header>
      {message && (
        <p className="notice success" role="status">
          {message}
        </p>
      )}
      {profile.role !== "super_admin" && (
        <form
          className="card stack"
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            setAction({ kind: "create" });
          }}
        >
          <h2>{editing ? "修改退回的更正单" : "申请更正已确认记录"}</h2>
          <div className="form-grid">
            <label className="field">
              <span>原单类型</span>
              <select
                disabled={!!editing}
                value={table}
                onChange={(e) => {
                  setTable(e.target.value);
                  setTarget("");
                }}
              >
                <option value="grape_consumptions">吃葡萄</option>
                <option value="grape_receipts">收葡萄</option>
              </select>
            </label>
            <label className="field">
              <span>已确认原单</span>
              <select
                required
                disabled={!!editing}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">请选择</option>
                {options.map((r) => (
                  <option key={r.id} value={r.id}>
                    {"received_date" in r
                      ? r.received_date
                      : r.consumption_date}{" "}
                    · {formatGrapes(r.grape_amount)} · {r.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>更正后应为多少葡萄</span>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label className="field">
              <span>更正生效日期</span>
              <input
                className="input"
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
          </div>
          <label className="field">
            <span>更正原因</span>
            <textarea
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="btn-row">
            <button className="btn btn-primary">核对并提交更正</button>
            {editing && (
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => {
                  setEditing(null);
                  setAmount("");
                  setReason("");
                }}
              >
                取消修改
              </button>
            )}
          </div>
        </form>
      )}
      <section className="card section-space">
        <h2>更正记录</h2>
        <RecordTable
          headings={[
            "记录人",
            "原单",
            "金额变化",
            "日期与原因",
            "状态",
            "操作",
          ]}
          rows={corrections.map((r) => ({
            id: r.id,
            cells: [
              profileName(people[r.owner_id]),
              `${r.target_table === "grape_receipts" ? "收葡萄" : "吃葡萄"} · ${r.target_id.slice(0, 8)}`,
              `${formatGrapes(r.previous_amount)} → ${formatGrapes(r.replacement_amount)}（差额 ${formatGrapes(r.amount_delta)}）`,
              <div key="n">
                {r.correction_date}
                <br />
                {r.reason}
                {r.return_reason && (
                  <p className="notice">退回：{r.return_reason}</p>
                )}
              </div>,
              statusLabel(r.status),
              <div key="a" className="btn-row">
                {r.status === "pending" && profile.role === "grape_keeper" && (
                  <>
                    <button
                      className="btn btn-primary"
                      onClick={() => {
                        setAction({ kind: "confirm", row: r });
                        setError("");
                      }}
                    >
                      确认更正
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => {
                        setAction({ kind: "return", row: r });
                        setReviewReason("");
                        setError("");
                      }}
                    >
                      退回
                    </button>
                  </>
                )}
                {["draft", "returned"].includes(r.status) &&
                  r.owner_id === profile.id &&
                  profile.role !== "super_admin" && (
                    <>
                      <button
                        className="btn btn-secondary"
                        onClick={() => {
                          setEditing(r);
                          setTable(r.target_table);
                          setTarget(r.target_id);
                          setAmount(String(r.replacement_amount));
                          setReason(r.reason);
                          setDate(r.correction_date);
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                      >
                        修改重提
                      </button>
                      <button
                        className="btn btn-danger"
                        onClick={() => {
                          setAction({ kind: "archive", row: r });
                          setReviewReason("");
                          setError("");
                        }}
                      >
                        作废
                      </button>
                    </>
                  )}
              </div>,
            ],
          }))}
        />
      </section>
      <ConfirmDialog
        open={!!action}
        title={
          action?.kind === "create"
            ? "提交更正单？"
            : action?.kind === "return"
              ? "退回更正单？"
              : action?.kind === "archive"
                ? "作废并保留审计？"
                : "确认更正差额生效？"
        }
        loading={busy}
        errorMessage={error}
        onConfirm={() => void run()}
        onCancel={() => setAction(null)}
        description={
          <div className="stack">
            <p>
              {action?.kind === "create"
                ? `目标金额 ${formatGrapes(Number(amount))}。原单不改变，审核后按差额调整余额。`
                : `差额 ${formatGrapes(action?.row?.amount_delta)}。确认后更正单也永久锁定。`}
            </p>
            {["return", "archive"].includes(action?.kind || "") && (
              <label className="field">
                <span>原因（必填）</span>
                <textarea
                  value={reviewReason}
                  onChange={(e) => setReviewReason(e.target.value)}
                />
              </label>
            )}
          </div>
        }
      />
    </>
  );
}
