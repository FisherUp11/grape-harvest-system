"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import ConfirmDialog from "@/app/components/ConfirmDialog";
import { compressImageFile, MAX_ATTACHMENT_COUNT, MAX_ATTACHMENT_SIZE } from "@/lib/imageCompression";
import { getAttachmentSignedUrl, removeConsumptionAttachment, uploadConsumptionAttachment } from "@/lib/storage";
import type { BudgetPlan, ConsumptionAttachment, GrapeConsumption, Profile, BudgetCategory } from "@/lib/types";
import { consumptionTypeLabel, formatDateTime, formatFileSize, formatGrapes, profileName, statusLabel, toDateInput } from "@/lib/utils";

type Props = {
  profile: Profile;
  profiles: Profile[];
  consumptions: GrapeConsumption[];
  confirmedBudgetPlans: BudgetPlan[];
  categories: BudgetCategory[];
  attachments: ConsumptionAttachment[];
};

export default function ConsumptionsClient({ profile, profiles, consumptions, confirmedBudgetPlans, categories, attachments }: Props) {
  const supabase = createClient();
  const router = useRouter();
  const isKeeper = profile.role === "grape_keeper";

  const profileMap = useMemo(() => Object.fromEntries(profiles.map((p) => [p.id, p])), [profiles]);
  const categoryMap = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories]);
  const attachmentsByConsumption = useMemo(() => {
    const map: Record<string, ConsumptionAttachment[]> = {};
    for (const a of attachments) (map[a.consumption_id] ||= []).push(a);
    return map;
  }, [attachments]);

  const [date, setDate] = useState(toDateInput());
  const [amount, setAmount] = useState("");
  const [type, setType] = useState("fixed");
  const [description, setDescription] = useState("");
  const [budgetCategoryId, setBudgetCategoryId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [message, setMessage] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [confirmTarget, setConfirmTarget] = useState<GrapeConsumption | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GrapeConsumption | null>(null);
  const [busy, setBusy] = useState(false);

  // 命中当前日期、已被葡萄管家确认生效的预算表（若存在，则必须选择其中的科目）
  const activePlan = useMemo(
    () => confirmedBudgetPlans.find((p) => date >= p.period_start && date <= p.period_end) || null,
    [confirmedBudgetPlans, date]
  );
  const activeCategories = useMemo(() => activePlan?.budget_categories || [], [activePlan]);

  const onPickFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setMessage("");
    const incoming = Array.from(list);
    const combined = [...files, ...incoming];
    if (combined.length > MAX_ATTACHMENT_COUNT) return setMessage(`每条记录最多上传 ${MAX_ATTACHMENT_COUNT} 个附件。`);
    const oversize = incoming.find((f) => f.size > MAX_ATTACHMENT_SIZE);
    if (oversize) return setMessage(`附件「${oversize.name}」超过 ${formatFileSize(MAX_ATTACHMENT_SIZE)} 大小限制。`);
    setFiles(combined);
  };

  const removeFile = (idx: number) => setFiles((list) => list.filter((_, i) => i !== idx));

  const createConsumption = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setMessage("");
    setSuccessMsg("");
    if (!amount || Number(amount) <= 0) return setMessage("请输入正确的葡萄数。");
    if (!description.trim()) return setMessage("请填写说明。");
    if (activePlan && !budgetCategoryId) return setMessage("当前日期已有确认生效的预算表，请选择对应科目后再提交。");
    if (files.length === 0) return setMessage("请至少上传 1 个凭证附件（最多 5 个）。");

    setSubmitting(true);
    let consumptionId: string | null = null;
    const uploadedPaths: string[] = [];
    try {
      const { data: created, error } = await supabase
        .from("grape_consumptions")
        .insert({
          org_id: profile.org_id,
          owner_id: profile.id,
          consumption_date: date,
          grape_amount: Number(amount),
          consumption_type: type,
          description: description.trim(),
          budget_category_id: budgetCategoryId || null,
          status: "pending",
        })
        .select("id")
        .single();
      if (error) throw error;
      consumptionId = created.id as string;

      for (const file of files) {
        const toUpload = await compressImageFile(file);
        const path = await uploadConsumptionAttachment(supabase, profile.id, consumptionId, toUpload);
        uploadedPaths.push(path);
        const { error: attError } = await supabase.from("grape_consumption_attachments").insert({
          org_id: profile.org_id,
          consumption_id: consumptionId,
          owner_id: profile.id,
          file_path: path,
          file_name: toUpload.name,
          mime_type: toUpload.type || "application/octet-stream",
          file_size: toUpload.size,
        });
        if (attError) throw attError;
      }

      setSuccessMsg("吃葡萄记录已提交，等待葡萄管家确认。");
      setAmount("");
      setDescription("");
      setBudgetCategoryId("");
      setFiles([]);
      router.refresh();
    } catch (err) {
      // 提交过程中任一环节失败都需要回滚，避免留下没有附件或没有正文的脏数据。
      if (consumptionId) await supabase.from("grape_consumptions").delete().eq("id", consumptionId);
      for (const path of uploadedPaths) await removeConsumptionAttachment(supabase, path).catch(() => {});
      setMessage(err instanceof Error ? err.message : "提交失败，请重试。");
    } finally {
      setSubmitting(false);
    }
  };

  const confirmConsumption = async () => {
    if (!confirmTarget || busy) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("grape_consumptions").update({ status: "confirmed", confirmed_by: profile.id, confirmed_at: new Date().toISOString() }).eq("id", confirmTarget.id);
      if (error) throw error;
      setConfirmTarget(null);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "确认失败");
    } finally {
      setBusy(false);
    }
  };

  const deleteConsumption = async () => {
    if (!deleteTarget || busy) return;
    setBusy(true);
    try {
      const targetAttachments = attachmentsByConsumption[deleteTarget.id] || [];
      const { error } = await supabase.from("grape_consumptions").delete().eq("id", deleteTarget.id);
      if (error) throw error;
      for (const a of targetAttachments) await removeConsumptionAttachment(supabase, a.file_path).catch(() => {});
      setDeleteTarget(null);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "删除失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="page-header"><div className="page-title"><p className="eyebrow">GRAPE BITES</p><h1>吃葡萄</h1><p>记录固定、项目或一次性的吃葡萄情况；如命中已确认的预算表需选择科目并上传凭证附件，确认后从葡萄存量中扣减且不可修改。</p></div></header>
      <section className="grid grid-2">
        <form className="card stack" onSubmit={createConsumption}>
          <h2>新增吃葡萄</h2>
          <div className="form-grid">
            <div className="field"><label>日期</label><input className="input" type="date" value={date} onChange={(e) => { setDate(e.target.value); setBudgetCategoryId(""); }} required /></div>
            <div className="field"><label>葡萄数</label><input className="input" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required /></div>
            <div className="field"><label>类型</label><select value={type} onChange={(e) => setType(e.target.value)}><option value="fixed">固定吃葡萄</option><option value="project">项目吃葡萄</option><option value="one_time">一次性吃葡萄</option></select></div>
            <div className="field">
              <label>预算科目{activePlan ? "（必选）" : ""}</label>
              <select value={budgetCategoryId} onChange={(e) => setBudgetCategoryId(e.target.value)} disabled={!activePlan}>
                <option value="">{activePlan ? "请选择科目" : "当前日期无生效预算表"}</option>
                {activeCategories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}（预算 {formatGrapes(c.budgeted_amount)}）</option>
                ))}
              </select>
            </div>
          </div>
          <div className="field"><label>说明</label><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} required /></div>
          <div className="field">
            <label>凭证附件（最多 {MAX_ATTACHMENT_COUNT} 个，图片会自动压缩后上传）</label>
            <input className="input" type="file" accept="image/*,.pdf" multiple onChange={(e) => { onPickFiles(e.target.files); e.target.value = ""; }} />
            {files.length > 0 && (
              <div className="attachment-list">
                {files.map((f, idx) => (
                  <span key={`${f.name}-${idx}`} className="attachment-chip">
                    {f.name} · {formatFileSize(f.size)}
                    <button type="button" onClick={() => removeFile(idx)}>移除</button>
                  </span>
                ))}
              </div>
            )}
          </div>
          {message && <div className="notice danger">{message}</div>}
          {successMsg && <div className="notice success">{successMsg}</div>}
          <button className="btn btn-primary" disabled={submitting}>{submitting ? <><span className="spinner" /> 正在提交…</> : "提交，等待葡萄管家确认"}</button>
        </form>
        <div className="card">
          <h2>预算与凭证提示</h2>
          {activePlan ? (
            <p className="muted">当前日期命中已确认预算表 <strong>{activePlan.title}</strong>（{activePlan.period_start} ~ {activePlan.period_end}），请选择对应科目后再提交。</p>
          ) : (
            <p className="muted">当前日期没有命中已确认的预算表，可前往“吃葡萄预算”页面编写并提交预算表供葡萄管家确认。</p>
          )}
          <p className="muted">附件在浏览器内自动压缩为合适尺寸的 JPEG 后上传，尽量减少存储空间占用；PDF 等非图片文件将原样上传。已确认的记录不可再修改或删除。</p>
        </div>
      </section>
      <section className="card" style={{ marginTop: 18 }}>
        <h2>吃葡萄明细</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>日期</th><th>记录人 / 记录时间</th><th>葡萄数</th><th>类型</th><th>科目</th><th>说明</th><th>附件</th><th>状态</th><th>确认人 / 确认时间</th><th>操作</th></tr></thead>
            <tbody>
              {consumptions.map((c) => (
                <tr key={c.id}>
                  <td>{c.consumption_date}</td>
                  <td className="record-meta"><strong>{profileName(profileMap[c.owner_id])}</strong><br />{formatDateTime(c.created_at)}</td>
                  <td>{formatGrapes(c.grape_amount)}</td>
                  <td>{consumptionTypeLabel(c.consumption_type)}</td>
                  <td>{c.budget_category_id ? categoryMap[c.budget_category_id]?.name || "-" : "-"}</td>
                  <td>{c.description}</td>
                  <td><AttachmentCell supabase={supabase} items={attachmentsByConsumption[c.id] || []} /></td>
                  <td><span className={`badge ${c.status === "confirmed" ? "ok" : "warn"}`}>{statusLabel(c.status)}</span></td>
                  <td className="record-meta">{c.status === "confirmed" ? <><strong>{profileName(profileMap[c.confirmed_by || ""])}</strong><br />{formatDateTime(c.confirmed_at)}</> : "-"}</td>
                  <td>
                    <div className="btn-row">
                      {isKeeper && c.status === "pending" && <button className="btn btn-primary" onClick={() => setConfirmTarget(c)}>确认</button>}
                      {c.owner_id === profile.id && c.status === "pending" && <button className="btn btn-danger" onClick={() => setDeleteTarget(c)}>删除</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {consumptions.length === 0 && <tr><td colSpan={10} className="empty">暂无记录。</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <ConfirmDialog
        open={!!confirmTarget}
        title="确认这条吃葡萄记录？"
        loading={busy}
        confirmLabel="确认"
        loadingLabel="确认中…"
        description={
          confirmTarget ? (
            <dl>
              <dt>记录人</dt><dd>{profileName(profileMap[confirmTarget.owner_id])}</dd>
              <dt>日期</dt><dd>{confirmTarget.consumption_date}</dd>
              <dt>葡萄数</dt><dd>{formatGrapes(confirmTarget.grape_amount)}</dd>
              <dt>说明</dt><dd>{confirmTarget.description}</dd>
            </dl>
          ) : null
        }
        onConfirm={confirmConsumption}
        onCancel={() => !busy && setConfirmTarget(null)}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        title="删除这条待确认吃葡萄记录？"
        loading={busy}
        danger
        confirmLabel="确认删除"
        loadingLabel="删除中…"
        description={<p>删除后无法恢复，关联的附件也会一并删除，仅可删除尚未被葡萄管家确认的记录。</p>}
        onConfirm={deleteConsumption}
        onCancel={() => !busy && setDeleteTarget(null)}
      />
    </>
  );
}

function AttachmentCell({ supabase, items }: { supabase: SupabaseClient; items: ConsumptionAttachment[] }) {
  const [open, setOpen] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  if (items.length === 0) return <span className="muted">无</span>;

  const toggle = async () => {
    if (open) return setOpen(false);
    setOpen(true);
    if (Object.keys(urls).length > 0) return;
    setLoading(true);
    try {
      const entries = await Promise.all(items.map(async (a) => [a.id, await getAttachmentSignedUrl(supabase, a.file_path)] as const));
      setUrls(Object.fromEntries(entries));
    } catch {
      // 生成签名地址失败时静默忽略，用户可重新点击重试。
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button type="button" className="btn btn-ghost" onClick={toggle}>{open ? "收起" : `查看（${items.length}）`}</button>
      {open && (
        <div className="attachment-list">
          {loading && <span className="muted">加载中…</span>}
          {!loading && items.map((a) => (
            <a key={a.id} className="attachment-chip" href={urls[a.id] || "#"} target="_blank" rel="noreferrer">
              {a.file_name}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
