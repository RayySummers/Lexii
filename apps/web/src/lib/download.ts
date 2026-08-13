/**
 * 浏览器文件下载工具（纯前端，无网络）。
 *
 * 用 Blob + 对象 URL + 临时 <a download> 触发下载，随后清理；
 * 不依赖任何后端，符合 local-first 红线。
 */

/**
 * 以指定 MIME 类型下载一段文本为文件。
 *
 * @param filename 下载文件名（如 `lexilexi-backup-2026-08-14.json`）
 * @param text 文件内容
 * @param mimeType MIME 类型（如 `application/json` / `text/csv`）
 */
export function downloadTextFile(filename: string, text: string, mimeType: string): void {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  // 部分浏览器（Firefox）要求锚点挂在 DOM 上才能触发下载
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** 下载文件名日期戳（YYYY-MM-DD，本地时区），如 `lexilexi-backup-2026-08-14.json` */
export function datedFilename(prefix: string, ext: string): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `${prefix}-${date}.${ext}`;
}
