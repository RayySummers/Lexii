/**
 * ipa-dict en_US / en_UK 解析（MIT / GPL-3.0 双链，RAY-267 核对 Credits）。
 *
 * 文件格式：`word<TAB>/ipa/`（无表头；部分条目多个变体以 ", " 分隔，
 * 原样保留——变体拆分与展示口径留给功能层批次）。仅摄取 en_US / en_UK
 * 两个文件（避开仓库内个别 CC BY-NC 语种文件，Jack 拍板硬性要求）。
 */
import { readFileSync } from "node:fs";

/**
 * 解析 ipa-dict TSV → Map<小写词形, ipa 字符串>。
 *
 * @param file .data/ipa-dict/{en_US,en_UK}.txt
 * @returns Map<term, ipa>（同词多行首现优先；行内多变体原样保留）
 */
export function parseIpaDict(file) {
  const map = new Map();
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    if (!line) continue;
    const tab = line.indexOf("\t");
    if (tab <= 0) continue;
    const term = line.slice(0, tab).trim().toLowerCase();
    const ipa = line.slice(tab + 1).trim();
    if (!term || !ipa.startsWith("/")) continue;
    if (!map.has(term)) {
      map.set(term, ipa);
    }
  }
  return map;
}
