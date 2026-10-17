"use client";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type {
  BudgetPlan,
  ConsumptionAttachment,
  GrapeConsumption,
  GrapeReceipt,
  Profile,
  Supporter,
} from "@/lib/types";
import type { PreparedAttachment } from "@/lib/imageCompression";
import { MAX_ATTACHMENT_SIZE } from "@/lib/imageCompression";
import {
  getAttachmentSignedUrl,
  notifyStorageChanged,
  removeConsumptionAttachment,
  uploadConsumptionAttachment,
} from "@/lib/storage";
import {
  consumptionTypeLabel,
  downloadCsv,
  errorMessage,
  formatDateTime,
  formatFileSize,
  formatGrapes,
  profileName,
  receiptMethodLabel,
  statusLabel,
  toDateInput,
} from "@/lib/utils";
import ConfirmDialog from "./ConfirmDialog";
import RecordTable from "./RecordTable";
import RecordFilters, { EMPTY_FILTERS } from "./RecordFilters";
import AttachmentPicker from "./AttachmentPicker";
import StorageUsage from "./StorageUsage";

type Row = GrapeReceipt | GrapeConsumption;
type Action =
  | { kind: "save"; submit: boolean }
  | { kind: "confirm" | "return" | "archive"; row: Row };
export default function LedgerClient({
  kind,
  profile,
  profiles,
  rows,
  supporters = [],
  plans = [],
  attachments = [],
}: {
  kind: "receipt" | "consumption";
  profile: Profile;
  profiles: Profile[];
  rows: Row[];
  supporters?: Supporter[];
  plans?: BudgetPlan[];
  attachments?: ConsumptionAttachment[];
}) {
  const receipt = kind === "receipt";
  const table = receipt ? "grape_receipts" : "grape_consumptions";
  const title = receipt ? "收葡萄" : "吃葡萄";
  const keeper = profile.role === "grape_keeper",
    superAdmin = profile.role === "super_admin";
  const supabase = createClient(),
    router = useRouter(),
    params = useSearchParams();
  const formRef = useRef<HTMLFormElement>(null);
  const [formOpen, setFormOpen] = useState(!keeper && !superAdmin);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [date, setDate] = useState(toDateInput());
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("wechat");
  const [supporter, setSupporter] = useState("");
  const [consumptionType, setConsumptionType] = useState("project");
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<PreparedAttachment[]>([]),
    [original, setOriginal] = useState(false),
    [preparing, setPreparing] = useState(false);
  const [action, setAction] = useState<Action | null>(null),
    [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [progress, setProgress] = useState("");
  const [filters, setFilters] = useState(() => ({
    ...EMPTY_FILTERS,
    status: ["pending", "returned", "draft", "confirmed"].includes(
      params.get("status") || "",
    )
      ? params.get("status")!
      : "all",
  }));
  const people = useMemo(
    () => Object.fromEntries(profiles.map((p) => [p.id, p])),
    [profiles],
  );
  const supporterMap = useMemo(
    () => Object.fromEntries(supporters.map((p) => [p.id, p])),
    [supporters],
  );
  const existing = attachments.filter((a) => a.consumption_id === editingId);
  const effectivePlans = plans.filter(
    (p) =>
      p.status === "confirmed" &&
      !plans.some((n) => n.status === "confirmed" && n.supersedes_id === p.id),
  );
  const activePlan = effectivePlans
    .filter((p) => date >= p.period_start && date <= p.period_end)
    .sort((a, b) => b.version - a.version)[0];
  const editable = (r: Row) =>
    r.owner_id === profile.id &&
    ["draft", "returned"].includes(r.status) &&
    !superAdmin;
  const rowDate = (r: Row) =>
    "received_date" in r ? r.received_date : r.consumption_date;
  const rowNotes = (r: Row) =>
    "received_date" in r ? r.notes || "" : r.description;
  const filtered = rows.filter(
    (r) =>
      !r.deleted_at &&
      (filters.status === "all" || r.status === filters.status) &&
      (filters.owner === "all" || filters.owner === r.owner_id) &&
      (!filters.month || rowDate(r).startsWith(filters.month)) &&
      `${rowNotes(r)} ${profileName(people[r.owner_id])} ${"supporter_id" in r ? supporterMap[r.supporter_id || ""]?.name || "" : ""}`
        .toLowerCase()
        .includes(filters.search.toLowerCase()),
  );
  const reset = () => {
    setEditingId(null);
    setAmount("");
    setNotes("");
    setSupporter("");
    setCategory("");
    setFiles([]);
    setDate(toDateInput());
    setOriginal(false);
  };
  const edit = (r: Row) => {
    setEditingId(r.id);
    setDate(rowDate(r));
    setAmount(String(r.grape_amount));
    setNotes(rowNotes(r));
    setFiles([]);
    setError("");
    setSuccess("");
    setFormOpen(true);
    if ("received_date" in r) {
      setMethod(r.receipt_method);
      setSupporter(r.supporter_id || "");
    } else {
      setConsumptionType(r.consumption_type);
      setCategory(r.budget_category_id || "");
    }
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      formRef.current?.querySelector("input")?.focus({ preventScroll: true });
    });
  };
  const requestSave = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    const submit =
      (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") !==
      "draft";
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0)
      return setError("葡萄数必须大于 0。");
    if (!receipt && !notes.trim()) return setError("请填写用途说明。");
    if (!receipt && activePlan && !category)
      return setError("请选择该日期生效预算的科目。");
    if (submit && !receipt && files.length + existing.length === 0)
      return setError("提交前请上传至少一个凭证。");
    if (
      files.some(
        (f) => (original ? f.original : f.file).size > MAX_ATTACHMENT_SIZE,
      )
    )
      return setError("文件超过 8 MB，请使用清晰压缩或拆分凭证。");
    setAction({ kind: "save", submit });
  };
  const save = async (submit: boolean) => {
    const base = receipt
      ? {
          received_date: date,
          grape_amount: Number(amount),
          receipt_method: method,
          supporter_id: supporter || null,
          notes: notes.trim() || null,
        }
      : {
          consumption_date: date,
          grape_amount: Number(amount),
          consumption_type: consumptionType,
          description: notes.trim(),
          budget_category_id: category || null,
          attachments_ready: false,
        };
    let id = editingId;
    const uploaded: string[] = [];
    const metadata: string[] = [];
    let submissionAttempted = false;
    try {
      setProgress("保存草稿…");
      const query = id
        ? supabase
            .from(table)
            .update(base)
            .eq("id", id)
            .in("status", ["draft", "returned"])
            .select("id")
            .single()
        : supabase
            .from(table)
            .insert({
              ...base,
              org_id: profile.org_id,
              owner_id: profile.id,
              status: "draft",
              ...(receipt ? { source_type: "one_time" } : {}),
            })
            .select("id")
            .single();
      const result = await query;
      if (result.error) throw result.error;
      id = result.data.id;
      setEditingId(id);
      if (!receipt) {
        for (let i = 0; i < files.length; i++) {
          setProgress(`上传凭证 ${i + 1}/${files.length}…`);
          const file = original ? files[i].original : files[i].file;
          const path = await uploadConsumptionAttachment(
            supabase,
            profile.id,
            id!,
            file,
          );
          uploaded.push(path);
          const a = await supabase
            .from("grape_consumption_attachments")
            .insert({
              org_id: profile.org_id,
              owner_id: profile.id,
              consumption_id: id,
              file_path: path,
              file_name: file.name,
              file_size: file.size,
              mime_type: file.type,
            })
            .select("id")
            .single();
          if (a.error) throw a.error;
          metadata.push(a.data.id);
        }
        const ready = await supabase
          .from(table)
          .update({ attachments_ready: true })
          .eq("id", id)
          .select("id")
          .single();
        if (ready.error) throw ready.error;
      }
      if (submit) {
        submissionAttempted = true;
        const result = await supabase.rpc("record_action", {
          p_table: table,
          p_id: id,
          p_action: "submit",
        });
        if (result.error) throw result.error;
      }
      setSuccess(
        submit
          ? "提交成功。免确认固定吃葡萄将自动生效，其余记录等待农场管家审核。"
          : "草稿已保存，可继续修改。",
      );
      reset();
      setAction(null);
    } catch (err) {
      if (!submissionAttempted) {
        for (const id of metadata)
          await supabase
            .from("grape_consumption_attachments")
            .delete()
            .eq("id", id);
        for (const path of uploaded) {
          try {
            await removeConsumptionAttachment(supabase, path);
          } catch {
            /* 用量卡保留未清理文件真实占用 */
          }
        }
      }
      throw new Error(
        errorMessage(err) +
          (submissionAttempted
            ? " 请先刷新核对提交结果，避免重复提交。"
            : " 草稿已保留，可从明细继续处理。"),
      );
    } finally {
      router.refresh();
      notifyStorageChanged();
    }
  };
  const run = async () => {
    if (!action || busy) return;
    setBusy(true);
    setError("");
    try {
      if (action.kind === "save") await save(action.submit);
      else {
        if (["return", "archive"].includes(action.kind) && !reason.trim())
          throw new Error("请填写原因。");
        const result = await supabase.rpc("record_action", {
          p_table: table,
          p_id: action.row.id,
          p_action: action.kind,
          p_reason: reason.trim() || null,
        });
        if (result.error) throw result.error;
        if (action.kind === "archive" && !receipt) {
          let failed = false;
          for (const a of attachments.filter(
            (a) => a.consumption_id === action.row.id,
          )) {
            try {
              await removeConsumptionAttachment(supabase, a.file_path);
            } catch {
              failed = true;
            }
          }
          setSuccess(
            failed
              ? "文字记录已作废并保留审计，部分图片未清理，请核对空间用量。"
              : "记录已作废；文字与审计保留，凭证文件已清理。",
          );
        } else
          setSuccess(
            action.kind === "return"
              ? "已退回，记录者现在可以修改后重新提交。"
              : "操作已完成。",
          );
        setAction(null);
        setReason("");
        router.refresh();
        notifyStorageChanged();
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      setProgress("");
    }
  };
  const exportCsv = () =>
    downloadCsv(`${title}_${toDateInput()}.csv`, [
      ["日期", "记录人", "葡萄数", "状态", "说明", "退回原因"],
      ...filtered.map((r) => [
        rowDate(r),
        profileName(people[r.owner_id]),
        String(r.grape_amount),
        r.auto_confirmed ? "系统自动生效" : statusLabel(r.status),
        rowNotes(r),
        r.return_reason || "",
      ]),
    ]);
  return (
    <>
      <header className="page-header">
        <div className="page-title">
          <p className="eyebrow">{receipt ? "HARVEST LOG" : "GRAPE USE LOG"}</p>
          <h1>{title}</h1>
          <p>
            {superAdmin
              ? "总园主可查看所有农场的记录，业务数据只读。"
              : "草稿可修改 → 提交即锁定 → 管家退回后才能修改；确认后永久保留原记录。"}
          </p>
        </div>
        <button className="btn btn-secondary" onClick={exportCsv}>
          导出筛选结果 CSV
        </button>
      </header>
      {success && (
        <p className="notice success" role="status">
          {success}
        </p>
      )}
      {error && !action && (
        <p className="notice danger" role="alert">
          {error}
        </p>
      )}
      {!superAdmin && (
        <details
          className="entry-panel"
          open={formOpen}
          onToggle={(e) => setFormOpen(e.currentTarget.open)}
        >
          <summary>
            {editingId
              ? "修改草稿或退回记录"
              : keeper
                ? `登记我自己的${title}`
                : `新增${title} / 收起表单查看明细`}
          </summary>
          <section className="grid grid-2">
            <form
              ref={formRef}
              className="card stack record-form"
              onSubmit={requestSave}
            >
              <p className="muted">
                记录归属：{profileName(profile)}（本人） ·{" "}
                {profile.organizations?.name}
              </p>
              <div className="section-heading">
                <h2>{editingId ? `修改${title}` : `新增${title}`}</h2>
                {editingId && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={reset}
                  >
                    取消修改
                  </button>
                )}
              </div>
              {!receipt &&
                !editingId &&
                Number(profile.monthly_fixed_consumption) > 0 && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setConsumptionType("fixed");
                      setAmount(String(profile.monthly_fixed_consumption));
                      setNotes(`${date.slice(0, 7)} 固定吃葡萄`);
                    }}
                  >
                    填入每月固定用量 ·{" "}
                    {formatGrapes(profile.monthly_fixed_consumption)}
                  </button>
                )}
              <fieldset className="form-grid" disabled={busy || preparing}>
                <label className="field">
                  <span>{receipt ? "收到日期" : "发生日期"}</span>
                  <input
                    className="input"
                    type="date"
                    value={date}
                    onChange={(e) => {
                      setDate(e.target.value);
                      setCategory("");
                    }}
                    required
                  />
                </label>
                <label className="field">
                  <span>{receipt ? "实际收到葡萄数" : "葡萄数"}</span>
                  <input
                    className="input"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                  />
                </label>
                {receipt ? (
                  <>
                    <label className="field">
                      <span>收到方式</span>
                      <select
                        value={method}
                        onChange={(e) => setMethod(e.target.value)}
                      >
                        {["cash", "wechat", "alipay", "bank", "other"].map(
                          (m) => (
                            <option key={m} value={m}>
                              {receiptMethodLabel(m)}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                    <label className="field">
                      <span>支持者</span>
                      <select
                        value={supporter}
                        disabled={
                          !!(
                            rows.find((r) => r.id === editingId) as GrapeReceipt
                          )?.commitment_period_id
                        }
                        onChange={(e) => setSupporter(e.target.value)}
                      >
                        <option value="">未关联</option>
                        {supporters
                          .filter((s) => s.owner_id === profile.id)
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                      </select>
                    </label>
                  </>
                ) : (
                  <>
                    <label className="field">
                      <span>类型</span>
                      <select
                        value={consumptionType}
                        onChange={(e) => setConsumptionType(e.target.value)}
                      >
                        {["fixed", "project", "one_time"].map((t) => (
                          <option key={t} value={t}>
                            {consumptionTypeLabel(t)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>预算科目{activePlan ? "（必选）" : ""}</span>
                      <select
                        value={category}
                        disabled={!activePlan}
                        onChange={(e) => setCategory(e.target.value)}
                      >
                        <option value="">
                          {activePlan ? "请选择科目" : "当前日期无生效预算"}
                        </option>
                        {activePlan?.budget_categories?.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} · {formatGrapes(c.budgeted_amount)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
                <label className="field full-width">
                  <span>{receipt ? "备注（选填）" : "用途说明"}</span>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    required={!receipt}
                  />
                </label>
              </fieldset>
              {!receipt && (
                <>
                  {existing.length > 0 && <AttachmentLinks items={existing} />}
                  <AttachmentPicker
                    items={files}
                    onChange={setFiles}
                    keepOriginal={original}
                    onKeepOriginal={setOriginal}
                    disabled={busy}
                    existingCount={existing.length}
                    onPreparing={setPreparing}
                  />
                  <p className="notice">
                    {consumptionType === "fixed" &&
                    profile.organizations?.fixed_requires_approval === false
                      ? "本农场固定吃葡萄免确认：提交后立即生效并锁定，请核对金额与凭证。"
                      : "这笔吃葡萄须经农场管家确认。项目与一次性吃葡萄始终需要确认。"}
                  </p>
                </>
              )}
              <div className="btn-row">
                <button
                  className="btn btn-secondary"
                  value="draft"
                  disabled={busy || preparing}
                >
                  保存草稿
                </button>
                <button
                  className="btn btn-primary"
                  value="submit"
                  disabled={busy || preparing}
                >
                  {preparing ? "处理图片中…" : "核对并提交"}
                </button>
              </div>
            </form>
            <div className="stack">
              <StorageUsage isKeeper={keeper} />
              <div className="card">
                <h2>记录与审核</h2>
                <p>
                  已提交记录不能自行修改或删除。管家填写原因退回后，本人才可修改并重新提交。
                </p>
                <p>
                  已确认记录与凭证锁定；如发现错误，请提交更正单。作废文字资料会保留审计。
                </p>
              </div>
            </div>
          </section>
        </details>
      )}
      <section className="card section-space">
        <h2>{title}明细</h2>
        <RecordFilters
          value={filters}
          onChange={setFilters}
          profiles={keeper || superAdmin ? profiles : undefined}
          count={filtered.length}
        />
        <RecordTable
          headings={[
            "日期",
            "记录人",
            "葡萄数",
            "说明",
            "状态",
            "凭证与审核",
            "操作",
          ]}
          rows={filtered.map((r) => ({
            id: r.id,
            cells: [
              rowDate(r),
              profileName(people[r.owner_id]),
              <strong key="a">{formatGrapes(r.grape_amount)}</strong>,
              <div key="n">
                {rowNotes(r)}
                {r.return_reason && (
                  <p className="notice">退回原因：{r.return_reason}</p>
                )}
              </div>,
              <span
                key="s"
                className={`badge ${r.status === "confirmed" ? "ok" : r.status === "returned" ? "danger" : "warn"}`}
              >
                {r.auto_confirmed ? "系统自动生效" : statusLabel(r.status)}
              </span>,
              <div key="f">
                {!receipt && (
                  <AttachmentLinks
                    items={attachments.filter((a) => a.consumption_id === r.id)}
                  />
                )}
                <small>
                  {r.status === "confirmed"
                    ? `${r.auto_confirmed ? "系统" : profileName(people[r.confirmed_by || ""])} · ${formatDateTime(r.confirmed_at)}`
                    : `第 ${r.revision_number || 1} 版`}
                </small>
              </div>,
              <div key="ops" className="btn-row">
                {editable(r) && (
                  <>
                    <button
                      className="btn btn-secondary"
                      onClick={() => edit(r)}
                    >
                      修改
                    </button>
                    <button
                      className="btn btn-danger"
                      onClick={() => {
                        setAction({ kind: "archive", row: r });
                        setReason("");
                        setError("");
                      }}
                    >
                      作废
                    </button>
                  </>
                )}
                {keeper && r.status === "pending" && (
                  <>
                    <button
                      className="btn btn-primary"
                      onClick={() => {
                        setAction({ kind: "confirm", row: r });
                        setError("");
                      }}
                    >
                      确认
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => {
                        setAction({ kind: "return", row: r });
                        setReason("");
                        setError("");
                      }}
                    >
                      退回修改
                    </button>
                  </>
                )}
                {r.status === "confirmed" &&
                  r.owner_id === profile.id &&
                  !superAdmin && (
                    <Link
                      className="btn btn-secondary"
                      href={`/corrections?table=${table}&record=${r.id}`}
                    >
                      申请更正
                    </Link>
                  )}
                {superAdmin && <span className="muted">只读</span>}
                {r.status === "pending" && !keeper && (
                  <span className="muted">提交已锁定</span>
                )}
              </div>,
            ],
          }))}
        />
      </section>
      <ConfirmDialog
        open={!!action}
        title={
          action?.kind === "save"
            ? action.submit
              ? "核对后提交？"
              : "保存草稿？"
            : action?.kind === "return"
              ? "退回这条记录？"
              : action?.kind === "archive"
                ? "作废并保留审计？"
                : "确认生效并锁定记录？"
        }
        loading={busy}
        loadingLabel={progress || "处理中…"}
        errorMessage={error}
        onConfirm={() => void run()}
        onCancel={() => setAction(null)}
        description={
          <div className="stack">
            <p>
              {action?.kind === "save"
                ? `${date} · ${formatGrapes(Number(amount))}。${action.submit ? "提交后不可自行修改，免确认固定支出会立即生效。" : "草稿不会影响葡萄存量。"}`
                : action && "row" in action
                  ? `${profileName(people[action.row.owner_id])} · ${formatGrapes(action.row.grape_amount)}。确认后任何业务角色都不能修改原单。`
                  : ""}
            </p>
            {(action?.kind === "return" || action?.kind === "archive") && (
              <label className="field">
                <span>原因（必填）</span>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
            )}
          </div>
        }
      />
    </>
  );
}
export function AttachmentLinks({ items }: { items: ConsumptionAttachment[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({}),
    [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const show = async () => {
    if (open) return setOpen(false);
    setBusy(true);
    setError("");
    try {
      const entries = await Promise.all(
        items.map(
          async (a) =>
            [
              a.id,
              await getAttachmentSignedUrl(createClient(), a.file_path),
            ] as const,
        ),
      );
      setUrls(Object.fromEntries(entries));
      setOpen(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (!items.length) return <span className="muted">暂无凭证</span>;
  return (
    <div>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={busy}
        onClick={() => void show()}
      >
        {busy ? "读取中…" : open ? "收起凭证" : `查看凭证（${items.length}）`}
      </button>
      {error && <p role="alert">{error}</p>}
      {open && (
        <div className="attachment-list">
          {items.map((a) => (
            <a
              key={a.id}
              className="attachment-link"
              href={urls[a.id]}
              target="_blank"
              rel="noreferrer"
            >
              {a.file_name} · {formatFileSize(a.file_size)} ↗
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
