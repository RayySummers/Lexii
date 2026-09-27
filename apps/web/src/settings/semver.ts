/**
 * RAY-494：语义化版本比较（按 semver 2.0.0 §11，支持 pre-release 与 build metadata）。
 *
 * 背景：扩展词包版本号按发版口径一律带 `-alpha`（如 `1.1.0-alpha`）。原实现只拆
 * `major.minor.patch`，`"1.1.0-alpha".split(".")` → `["1","1","0-alpha"]` →
 * `Number("0-alpha")` = NaN → 两次比较都不成立 → 返回 0 → 被当成「与已装版本
 * 一样新」→ 设置页的「可升级」提示静默失效（装了旧包的人再也收不到升级提示）。
 *
 * 口径：
 * - 先按 major.minor.patch 数值比较；
 * - 前三段相同再看 pre-release：**无** pre-release 的版本更大
 *   （`1.1.0 > 1.1.0-alpha`）；都有 pre-release 时按 `.` 分段逐段比较——
 *   纯数字段按数值比、字母数字段按 ASCII 序比，数字段小于字母数字段；
 *   前缀全部相同则段数少的更小（`1.0.0-alpha < 1.0.0-alpha.1`）；
 * - build metadata（`+xxx`）不参与比较（`1.0.0+build.1 === 1.0.0`）。
 *
 * 纯函数、零依赖；核心段缺段或非法（NaN）按 0 处理——沿用原实现的容错行为，
 * manifest 里混进脏版本号时只影响该条的比较结果，不把设置页整页炸掉。
 */

/** 比较 a 与 b：返回 -1（a < b）、0（a === b）、1（a > b） */
export function compareSemver(a: string, b: string): number {
  const [aCore, aPre] = splitVersion(a);
  const [bCore, bPre] = splitVersion(b);

  for (let i = 0; i < 3; i++) {
    const da = aCore[i] ?? 0;
    const db = bCore[i] ?? 0;
    if (da < db) return -1;
    if (da > db) return 1;
  }

  if (aPre === null && bPre === null) return 0;
  // 前三段相同：正式版 > 预发布版（semver §11.3）
  if (aPre === null) return 1;
  if (bPre === null) return -1;

  const ap = aPre.split(".");
  const bp = bPre.split(".");
  const len = Math.max(ap.length, bp.length);
  for (let i = 0; i < len; i++) {
    const xa = ap[i];
    const xb = bp[i];
    // 前缀相同、段数不同：段数少的更小（semver §11.4.4）
    if (xa === undefined) return -1;
    if (xb === undefined) return 1;

    const aNumeric = /^\d+$/.test(xa);
    const bNumeric = /^\d+$/.test(xb);
    if (aNumeric && bNumeric) {
      const na = Number(xa);
      const nb = Number(xb);
      if (na < nb) return -1;
      if (na > nb) return 1;
      continue;
    }
    // 数字标识符 < 字母数字标识符（semver §11.4.3）
    if (aNumeric) return -1;
    if (bNumeric) return 1;
    // 字母数字标识符按 ASCII 序
    if (xa < xb) return -1;
    if (xa > xb) return 1;
  }
  return 0;
}

/**
 * 拆分版本号：返回 [核心段数值数组, pre-release 串或 null]。
 * build metadata（`+xxx`）比较时忽略；空 pre-release（如 `1.0.0-`）按无预发布处理。
 */
function splitVersion(version: string): [number[], string | null] {
  const withoutBuild = version.split("+")[0] ?? "";
  const dashAt = withoutBuild.indexOf("-");
  const corePart = dashAt >= 0 ? withoutBuild.slice(0, dashAt) : withoutBuild;
  const prePart = dashAt >= 0 ? withoutBuild.slice(dashAt + 1) : "";
  const core = corePart.split(".").map((segment) => {
    const value = Number(segment);
    return Number.isFinite(value) ? value : 0;
  });
  return [core, prePart === "" ? null : prePart];
}
