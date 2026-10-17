"use client";

import { useEffect, useRef, useState } from "react";
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENT_COUNT,
  MAX_ATTACHMENT_SIZE,
  prepareAttachment,
  type PreparedAttachment,
} from "@/lib/imageCompression";
import { errorMessage, formatFileSize } from "@/lib/utils";

function Preview({
  item,
  keepOriginal,
}: {
  item: PreparedAttachment;
  keepOriginal: boolean;
}) {
  const [url, setUrl] = useState("");
  const file = keepOriginal ? item.original : item.file;
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return (
    <>
      {file.type.startsWith("image/") && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          aria-label={`放大查看 ${file.name}`}
        >
          <img
            className="upload-preview"
            src={url}
            alt={`待上传凭证 ${file.name}`}
          />
        </a>
      )}
      <div>
        <strong>{file.name}</strong>
        <p className="muted">
          原文件 {formatFileSize(item.original.size)} → 上传{" "}
          {formatFileSize(file.size)}
          {!keepOriginal && item.width && ` · ${item.width} × ${item.height}`}
        </p>
        <a
          className="attachment-link"
          href={url}
          target="_blank"
          rel="noreferrer"
        >
          {file.type === "application/pdf" ? "打开 PDF 核对" : "放大核对文字"}
        </a>
        {item.warning && <p className="notice">{item.warning}</p>}
      </div>
    </>
  );
}

export default function AttachmentPicker({
  items,
  onChange,
  keepOriginal,
  onKeepOriginal,
  disabled,
  existingCount = 0,
  onPreparing,
}: {
  items: PreparedAttachment[];
  onChange: (items: PreparedAttachment[]) => void;
  keepOriginal: boolean;
  onKeepOriginal: (value: boolean) => void;
  disabled: boolean;
  existingCount?: number;
  onPreparing: (value: boolean) => void;
}) {
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const selectFiles = async (files: FileList | null) => {
    if (!files?.length || lock.current) return;
    const incoming = Array.from(files);
    if (incoming.length + items.length + existingCount > MAX_ATTACHMENT_COUNT)
      return setError(
        `已有 ${existingCount} 个凭证，每条记录合计最多 ${MAX_ATTACHMENT_COUNT} 个。`,
      );
    lock.current = true;
    setPreparing(true);
    onPreparing(true);
    setError("");
    try {
      const prepared: PreparedAttachment[] = [];
      // 逐张处理，避免手机同时解码多张大图造成内存峰值。
      for (const file of incoming) prepared.push(await prepareAttachment(file));
      onChange([...items, ...prepared]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      lock.current = false;
      setPreparing(false);
      onPreparing(false);
    }
  };
  return (
    <div className="stack attachment-picker">
      <label className="field">
        <span>
          凭证附件 · 合计 {existingCount + items.length} /{" "}
          {MAX_ATTACHMENT_COUNT}
        </span>
        <input
          className="input"
          type="file"
          accept={ATTACHMENT_ACCEPT}
          multiple
          disabled={
            disabled ||
            preparing ||
            existingCount + items.length >= MAX_ATTACHMENT_COUNT
          }
          onChange={(e) => {
            void selectFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      <p className="muted">
        可拍照或从相册选取。默认清晰压缩，保留票据小字；PDF
        原样上传，单个上传文件最多 8 MB。
      </p>
      <label className="check-field">
        <input
          type="checkbox"
          checked={keepOriginal}
          disabled={disabled || preparing}
          onChange={(e) => onKeepOriginal(e.target.checked)}
        />
        保留原图（适合文字特别细的凭证，会占更多空间）
      </label>
      {preparing && <p role="status">正在处理图片，请稍候…</p>}
      {error && (
        <p className="notice danger" role="alert">
          {error}
        </p>
      )}
      {keepOriginal &&
        items.some((i) => i.original.size > MAX_ATTACHMENT_SIZE) && (
          <p className="notice danger" role="alert">
            部分原图超过 8 MB，请关闭“保留原图”或拆分凭证。
          </p>
        )}
      {items.map((item, index) => (
        <div className="upload-item" key={`${item.original.name}-${index}`}>
          <Preview item={item} keepOriginal={keepOriginal} />
          <button
            type="button"
            className="btn btn-danger"
            disabled={disabled || preparing}
            onClick={() => onChange(items.filter((_, i) => i !== index))}
          >
            移除
          </button>
        </div>
      ))}
    </div>
  );
}
