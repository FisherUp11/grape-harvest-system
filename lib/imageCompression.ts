// 凭证优先保留小字：清晰模式 2560px / JPEG 0.88；原图模式供用户核对后选择。
export const MAX_ATTACHMENT_COUNT = 5;
export const MAX_ATTACHMENT_SIZE = 8 * 1024 * 1024;
export const MAX_SOURCE_IMAGE_SIZE = 30 * 1024 * 1024;
export const ATTACHMENT_ACCEPT =
  "image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf";
const ALLOWED_TYPES = ATTACHMENT_ACCEPT.split(",");
export type PreparedAttachment = {
  original: File;
  file: File;
  width?: number;
  height?: number;
  warning?: string;
};

export function validateAttachment(file: File) {
  if (!ALLOWED_TYPES.includes(file.type))
    throw new Error(
      `「${file.name}」格式不支持，请使用 JPEG、PNG、WebP、HEIC 或 PDF。`,
    );
  const limit = file.type.startsWith("image/")
    ? MAX_SOURCE_IMAGE_SIZE
    : MAX_ATTACHMENT_SIZE;
  if (file.size > limit)
    throw new Error(
      `「${file.name}」过大，图片原文件最多 30 MB，PDF 最多 8 MB。`,
    );
}

export async function prepareAttachment(
  original: File,
): Promise<PreparedAttachment> {
  validateAttachment(original);
  if (!original.type.startsWith("image/")) return { original, file: original };
  const url = URL.createObjectURL(original);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("浏览器无法解码图片"));
      image.src = url;
    });
    const longReceipt =
      Math.max(img.width, img.height) / Math.min(img.width, img.height) > 3;
    const ratio = longReceipt
      ? Math.min(
          1,
          1600 / Math.min(img.width, img.height),
          8000 / Math.max(img.width, img.height),
        )
      : Math.min(1, 2560 / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * ratio));
    const height = Math.max(1, Math.round(img.height * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建图片预览");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.88),
    );
    if (!blob) throw new Error("图片压缩失败");
    const compressed = blob.size < original.size;
    const file = compressed
      ? new File([blob], original.name.replace(/\.[^./\\]+$/, "") + ".jpg", {
          type: "image/jpeg",
          lastModified: original.lastModified,
        })
      : original;
    if (file.size > MAX_ATTACHMENT_SIZE)
      throw new Error("压缩后仍超过 8 MB，请裁剪或拆分凭证后上传。");
    return {
      original,
      file,
      width: compressed ? width : img.width,
      height: compressed ? height : img.height,
    };
  } catch (error) {
    if (original.size > MAX_ATTACHMENT_SIZE)
      throw new Error(
        `「${original.name}」无法压缩到 8 MB 以内，请转换为 JPEG 或拆分后重试。`,
      );
    return {
      original,
      file: original,
      warning:
        error instanceof Error
          ? `${error.message}，将保留原文件。`
          : "无法压缩，将保留原文件。",
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function compressImageFile(file: File) {
  return (await prepareAttachment(file)).file;
}
