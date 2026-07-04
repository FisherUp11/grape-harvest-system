import type { SupabaseClient } from "@supabase/supabase-js";

export const ATTACHMENT_BUCKET = "consumption-attachments";

// Supabase 图床（Storage）总配额，基础版为 1GB；如升级套餐可通过环境变量调整，无需改代码。
export const STORAGE_QUOTA_BYTES = Number(process.env.NEXT_PUBLIC_SUPABASE_STORAGE_QUOTA_GB || 1) * 1024 * 1024 * 1024;

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
}

/**
 * 上传吃葡萄附件到私有 Storage 桶，路径按 owner_id/consumption_id 隔离，满足 RLS 目录规则。
 */
export async function uploadConsumptionAttachment(
  supabase: SupabaseClient,
  ownerId: string,
  consumptionId: string,
  file: File
) {
  const path = `${ownerId}/${consumptionId}/${Date.now()}_${sanitizeFileName(file.name)}`;
  const { error } = await supabase.storage.from(ATTACHMENT_BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) throw error;
  return path;
}

export async function getAttachmentSignedUrl(supabase: SupabaseClient, path: string, expiresIn = 3600) {
  const { data, error } = await supabase.storage.from(ATTACHMENT_BUCKET).createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}

export async function removeConsumptionAttachment(supabase: SupabaseClient, path: string) {
  const { error } = await supabase.storage.from(ATTACHMENT_BUCKET).remove([path]);
  if (error) throw error;
}
