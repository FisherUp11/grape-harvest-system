"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { GrapeConsumption, Profile } from "@/lib/types";
import {
  type PreparedAttachment,
  MAX_ATTACHMENT_SIZE,
} from "@/lib/imageCompression";
import {
  uploadConsumptionAttachment,
  removeConsumptionAttachment,
  notifyStorageChanged,
} from "@/lib/storage";
import { errorMessage, formatGrapes } from "@/lib/utils";
import AttachmentPicker from "./AttachmentPicker";
import ConfirmDialog from "./ConfirmDialog";

export default function FixedVoucherUpload({
  profile,
  row,
  existingCount,
}: {
  profile: Profile;
  row: GrapeConsumption;
  existingCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [preparing, setPreparing] = useState(false);
  const [items, setItems] = useState<PreparedAttachment[]>([]),
    [original, setOriginal] = useState(false);
  const [error, setError] = useState("");
  const upload = async () => {
    if (busy || preparing) return;
    if (!items.length) return setError("请先选择凭证。");
    if (
      items.some(
        (i) => (original ? i.original : i.file).size > MAX_ATTACHMENT_SIZE,
      )
    )
      return setError("凭证超过 8 MB，请使用压缩图或拆分凭证。");
    setBusy(true);
    setError("");
    const db = createClient();
    try {
      for (const item of items) {
        const file = original ? item.original : item.file;
        const path = await uploadConsumptionAttachment(
          db,
          profile.id,
          row.id,
          file,
        );
        const { error } = await db
          .from("grape_consumption_attachments")
          .insert({
            org_id: profile.org_id,
            owner_id: profile.id,
            consumption_id: row.id,
            file_path: path,
            file_name: file.name,
            file_size: file.size,
            mime_type: file.type,
          });
        if (error) {
          // 仅尝试清理未成功登记的孤立对象；数据库拒绝删除任何已登记永久凭证。
          try {
            await removeConsumptionAttachment(db, path);
          } catch {
            /* 用量统计保留真实占用 */
          }
          throw error;
        }
      }
      setItems([]);
      setOpen(false);
    } catch (e) {
      setItems([]);
      setError(
        errorMessage(e) +
          " 请刷新核对已上传凭证，勿重复上传；成功上传的凭证已永久保留。",
      );
    } finally {
      setBusy(false);
      notifyStorageChanged();
      router.refresh();
    }
  };
  return (
    <>
      <button
        className="btn btn-secondary"
        disabled={existingCount >= 5}
        onClick={() => {
          setError("");
          setOpen(true);
        }}
      >
        补传凭证
      </button>
      <ConfirmDialog
        open={open}
        title="补传固定吃葡萄凭证"
        loading={busy || preparing}
        errorMessage={error}
        confirmLabel="确认上传并永久留存"
        onConfirm={() => void upload()}
        onCancel={() => {
          setOpen(false);
          setItems([]);
        }}
        description={
          <div className="stack">
            <p>
              {row.consumption_date} · {formatGrapes(row.grape_amount)} ·{" "}
              {row.description}
            </p>
            <p className="notice">
              仅追加凭证，不修改数量或审核状态。上传成功后不可删除、覆盖或替换，请放大核对后再确认。
            </p>
            <AttachmentPicker
              items={items}
              onChange={setItems}
              keepOriginal={original}
              onKeepOriginal={setOriginal}
              disabled={busy}
              existingCount={existingCount}
              onPreparing={setPreparing}
            />
          </div>
        }
      />
    </>
  );
}
