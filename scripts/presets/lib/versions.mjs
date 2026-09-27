/**
 * RAY-494：扩展词包（Tier 1 / Tier 2）版本号口径 —— 唯一真相源。
 *
 * 发版口径（Ray 拍板）：**本项目未到生产可用，凡发版必须带 alpha 标识**。
 * 该口径要同时落在三层：应用版本（`apps/web/package.json`）、词包发布 tag
 * （`presets-v*`）、以及**词包版本号本身**（manifest 里用户可见、并驱动升级判定）。
 * RAY-494 之前只有前两层带 alpha：线上 manifest 里 `core-en-tier1` = `1.0.0`、
 * `core-en-tier2` = `1.1.0`，词包版本号层缺失。
 *
 * 递增规则：**内容变更时递增数字部分**，alpha 标识保持不变
 * （当前 Tier 0/1 = `1.0.0-alpha`、Tier 2 = `1.1.0-alpha`；下一个 Tier 2 = `1.1.1-alpha`）。
 *
 * 为什么 Tier 2 与 Tier 0/1 不同号（RAY-492）：运行时以「manifest 的 pkg.version
 * vs 本地 done 标记」判定是否需要安装（packages/core/src/dictionary.ts:
 * installDictionaryPackage：相等即 already-installed，不等才走增量替换
 * upgradeDictionaryPackage）；设置页也按 compareSemver(installedVersion,
 * manifestVersion) < 0 展示「可升级 vX」。Tier 2 纳入 36 万条短语时若不同步 bump，
 * **已装 Tier 2 的用户永远拿不到短语**（静默不升级），故 Tier 2 单独走 1.1.x。
 *
 * 注意：`PACKAGE_VERSION` 同时供 Tier 0（`tier0.data.json`）与词书库
 * （`books.data.json`）使用。这两个产物已提交进仓库、本次不重打，其内嵌
 * `version` 仍是上一版的 `1.0.0`；只有下次重建时才会跟随常量变成 `1.0.0-alpha`。
 */
export const PACKAGE_VERSION = "1.0.0-alpha";

/** Tier 2 全量包数据版本（RAY-492 起与 Tier 0/1 分线） */
export const TIER2_PACKAGE_VERSION = "1.1.0-alpha";

/**
 * 词包版本号必须带上的预发布标识（发版口径的机器可判定部分）。
 * 允许 `-alpha`、`-alpha.1`、`-alpha-1`、`-alpha+build` 等形态，不接受
 * 无预发布（`1.0.0`）或别的预发布线（`1.0.0-beta`）。
 */
const ALPHA_VERSION_RE = /^\d+\.\d+\.\d+-alpha(?:[.-][0-9A-Za-z-]+)*(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * 断言词包版本号带 `-alpha`，否则抛错。
 *
 * manifest 生成前调用（fail-fast）：口径写死在发布链路里，未来再次出现
 * 「应用带了 alpha、词包版本号没带」时直接构建失败，而不是静默发一版不带
 * alpha 的词包。
 */
export function assertAlphaPackageVersion(version, packageId) {
  if (typeof version !== "string" || !ALPHA_VERSION_RE.test(version)) {
    throw new Error(
      `词包版本号缺少 -alpha 标识：${packageId} = ${JSON.stringify(version)}。` +
        `发版口径要求词包版本号一律带 -alpha（如 1.0.0-alpha / 1.1.1-alpha），` +
        `见 scripts/presets/README.md「版本号口径」与 scripts/presets/lib/versions.mjs`,
    );
  }
  return version;
}
