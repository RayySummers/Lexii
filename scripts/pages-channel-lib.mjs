/**
 * RAY-491 — Pages 双通道「根路径绝不被降级」判定内核 + 线上构建信息断言。
 *
 * 背景（RAY-491 复核结论）：`deploy-dev.yml` 与 `deploy-release.yml` 早已共用
 * `concurrency: { group: pages, cancel-in-progress: false }`（RAY-297 Oscar
 * suggestion 1），但 2026-09-26 的 v0.10.2-alpha 仍然被 dev 部署盖回了
 * v0.10.1-alpha。串行化只能保证「按队列顺序落盘」，不能保证「后落盘的内容
 * 更新」——dev 在 checkout 那一刻解析「最新 v* tag」，那台 runner 的 tag 列表
 * 是旧的，构建又比 release 慢，于是后落盘的旧快照覆盖了新快照。
 *
 * 因此本模块只做两件事，且都是纯逻辑（可单测、不碰网络/文件）：
 *
 * 1. `decideRootSnapshot()`：写根路径前重新解析一次最新 v* tag，并与「线上
 *    已部署的根路径构建信息」比较，取三者最新者。候选不是最新 → 换用最新
 *    快照重新构建根路径（`adopt`），候选已是最新 → 照常写入（`write`）。
 *
 *    为什么是「换最新快照重构建」而不是「跳过根路径写入」：GitHub Pages 每次
 *    部署都是**整站替换**（artifact = 完整站点），dev 的 artifact 里如果没有
 *    根路径文件，部署后根路径会直接 404/被删掉。跳过写入与「整站替换」语义
 *    互斥，故改为「根路径永远写，但写的一定是最新快照」——同样做到只降不升
 *    的反面（只升不降），且不会造成根路径空窗。流程口径见 CONTRIBUTING.md
 *    「发版流程」第 5 步。
 * 2. `checkPagesChannels()`：部署后 / 定时回归断言，比对线上
 *    `<base>/build-info.json` 与 `<base>/dev/build-info.json` 是否与期望一致
 *    （根路径 `branch` ＝ 本次 tag 且 `releaseTags` 含它）。用于
 *    `deploy-release.yml` 的「发版后断言」（不符则重写一次，仍不符直接 fail）
 *    以及 `.github/workflows/check-pages-channels.yml` 的定时回归。
 *
 * 线上构建信息的读取锚点：`apps/web/vite.config.ts` 自 RAY-491 起随构建产出
 * `build-info.json`（与 `__APP_BUILD__` 同一份数据：channel/sha/time/branch/
 * releaseTags），根路径与 /dev/ 各一份，机器可读、无需跑浏览器解析 bundle。
 */

/** 版本 tag 形态：v<major>.<minor>.<patch>[-prerelease]（`presets-v*` 不是应用发版 tag） */
const RELEASE_TAG_RE = /^v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

const BUILD_CHANNELS = new Set(["release", "dev"]);

/**
 * 解析发版 tag 的版本信息。
 * @param {unknown} tag
 * @returns {{ major: number, minor: number, patch: number, prerelease: string[] } | null}
 */
export function parseReleaseTag(tag) {
  if (typeof tag !== "string") return null;
  const match = RELEASE_TAG_RE.exec(tag.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

/** 是否为应用发版 tag（排除 `presets-v0.8.2-alpha` 这类词包 tag）。 */
export function isReleaseTag(tag) {
  return parseReleaseTag(tag) !== null;
}

function comparePrereleaseIdentifiers(a, b) {
  const aNum = /^\d+$/.test(a);
  const bNum = /^\d+$/.test(b);
  // semver：数字标识符小于字母标识符，纯数字按数值比较
  if (aNum && bNum) return Math.sign(Number(a) - Number(b));
  if (aNum !== bNum) return aNum ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 版本大小比较（v0.10.10 > v0.10.9；v0.10.2-alpha < v0.10.2；
 * v0.10.2-alpha < v0.10.2-alpha.2 < v0.10.2-beta）。无法解析的输入退化为
 * 字符串比较，保证调用方永远拿到 -1 / 0 / 1 而不是抛错。
 * @returns {-1 | 0 | 1}
 */
export function compareReleaseTags(a, b) {
  const left = parseReleaseTag(a);
  const right = parseReleaseTag(b);
  if (!left || !right) {
    const sa = String(a ?? "");
    const sb = String(b ?? "");
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  }
  for (const key of ["major", "minor", "patch"]) {
    const diff = Math.sign(left[key] - right[key]);
    if (diff !== 0) return diff;
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  // 有 prerelease 的版本更小（正式版 > 预发布版）
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;
  const length = Math.min(left.prerelease.length, right.prerelease.length);
  for (let i = 0; i < length; i += 1) {
    const diff = comparePrereleaseIdentifiers(left.prerelease[i], right.prerelease[i]);
    if (diff !== 0) return diff;
  }
  return Math.sign(left.prerelease.length - right.prerelease.length);
}

/**
 * 从任意 tag 列表里挑出最新的应用发版 tag；没有则返回 null。
 * @param {Iterable<unknown>} tags
 * @returns {string | null}
 */
export function pickNewestTag(tags) {
  let newest = null;
  for (const raw of tags ?? []) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim();
    if (!isReleaseTag(tag)) continue;
    if (newest === null || compareReleaseTags(tag, newest) > 0) newest = tag;
  }
  return newest;
}

/**
 * 把 `git ls-remote --tags --refs` / `git tag --list` 的原始输出切成 tag 名列表。
 * @param {string} raw
 * @returns {string[]}
 */
export function parseTagOutput(raw) {
  return String(raw ?? "")
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "";
      // ls-remote 输出形如 "<sha>\trefs/tags/v0.10.5-alpha"
      const refIndex = trimmed.indexOf("refs/tags/");
      return refIndex >= 0 ? trimmed.slice(refIndex + "refs/tags/".length).trim() : trimmed;
    })
    .filter(Boolean);
}

/**
 * 校验并规范化构建信息（vite 产出的 build-info.json）。
 * 失败时抛错，调用方通常把 message 直接展示给 CI 日志。
 * @param {unknown} raw 字符串（JSON 文本）或已解析对象
 */
export function parseBuildInfo(raw) {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch (error) {
      throw new Error(`构建信息不是合法 JSON：${error.message}`, { cause: error });
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("构建信息应为 JSON 对象");
  }
  const record = /** @type {Record<string, unknown>} */ (value);
  const channel = typeof record.channel === "string" ? record.channel.trim() : "";
  if (!BUILD_CHANNELS.has(channel)) {
    throw new Error(
      `构建信息 channel 非法：${JSON.stringify(record.channel)}（应为 release / dev）`,
    );
  }
  const sha = typeof record.sha === "string" ? record.sha.trim() : "";
  if (!sha) throw new Error("构建信息缺少 sha");
  const branch = typeof record.branch === "string" ? record.branch.trim() : "";
  if (!branch) throw new Error("构建信息缺少 branch");
  const time = typeof record.time === "string" ? record.time.trim() : "";
  if (!time) throw new Error("构建信息缺少 time");
  if (
    !Array.isArray(record.releaseTags) ||
    record.releaseTags.some((tag) => typeof tag !== "string")
  ) {
    throw new Error("构建信息 releaseTags 应为字符串数组");
  }
  return {
    channel,
    sha,
    branch,
    time,
    releaseTags: record.releaseTags.map((tag) => tag.trim()).filter(Boolean),
  };
}

/**
 * 写根路径前的「新鲜度判定」。
 *
 * 输入三方信号：
 * - candidate：本 workflow 已解析出的 tag（dev 在 checkout 时刻解析，可能已过时）；
 * - availableTags：此刻重新解析到的全部 tag（`git ls-remote --tags`，权威）；
 * - liveBuildInfo：线上根路径当前部署的构建信息（读 <base>/build-info.json）。
 *
 * 输出：
 * - `write`：候选已是最新 → 照常把候选快照写入根路径；
 * - `adopt`：候选落后 → 根路径改用最新快照（重新 checkout + 构建），
 *   只更新 dev/ 的期望不成立，理由见文件头。
 *
 * @param {{ candidate: string, availableTags?: Iterable<string>, liveBuildInfo?: { branch?: string } | null }} input
 * @returns {{ branch: string, action: "write" | "adopt", reason: string, signals: { candidate: string, newestAvailable: string | null, liveBranch: string | null } }}
 */
export function decideRootSnapshot({ candidate, availableTags = [], liveBuildInfo = null } = {}) {
  const candidateTag = typeof candidate === "string" ? candidate.trim() : "";
  if (!candidateTag) {
    throw new Error("缺少候选 tag（--candidate）");
  }
  const newestAvailable = pickNewestTag(availableTags);
  const liveBranchRaw =
    typeof liveBuildInfo?.branch === "string" ? liveBuildInfo.branch.trim() : "";
  const liveBranch = liveBranchRaw || null;
  const liveTag = liveBranch && isReleaseTag(liveBranch) ? liveBranch : null;

  const signals = { candidate: candidateTag, newestAvailable, liveBranch };
  const upgrades = [];
  let target = candidateTag;

  if (isReleaseTag(candidateTag)) {
    for (const [source, tag] of [
      ["线上根路径", liveTag],
      ["远端最新 tag", newestAvailable],
    ]) {
      if (tag && compareReleaseTags(tag, target) > 0) {
        target = tag;
        upgrades.push(`${source} ${tag} 比候选 ${candidateTag} 新`);
      }
    }
  } else {
    // 候选不是版本 tag（无 tag 时回退 main）：能拿到任何版本 tag 都更强
    for (const [source, tag] of [
      ["远端最新 tag", newestAvailable],
      ["线上根路径", liveTag],
    ]) {
      if (tag) {
        target = tag;
        upgrades.push(`候选 ${candidateTag} 不是版本 tag，改用${source} ${tag}`);
        break;
      }
    }
  }

  const action = target === candidateTag ? "write" : "adopt";
  const reason =
    action === "write"
      ? `候选 ${candidateTag} 已是最新（远端最新 ${newestAvailable ?? "无"}，线上根路径 ${liveBranch ?? "不可读"}）`
      : `${upgrades.join("；")} → 根路径改用 ${target} 快照，避免旧快照覆盖新版本`;
  return { branch: target, action, reason, signals };
}

/**
 * 推导本站 GitHub Pages 的根地址（`https://<owner>.github.io/<repo>/`）。
 * 优先用 CI 注入的 GITHUB_REPOSITORY，本地/离线时回退到本仓库的线上地址；
 * `<owner>.github.io` 这种用户站点仓库没有仓库路径段。
 * @param {Record<string, string | undefined>} [env]
 */
export function defaultPagesBaseUrl(env = process.env) {
  const repository = env.GITHUB_REPOSITORY ?? "";
  const [rawOwner, rawName] = repository.split("/");
  if (rawOwner && rawName) {
    const owner = rawOwner.toLowerCase();
    const name = rawName.toLowerCase() === `${owner}.github.io` ? "" : `/${rawName}`;
    return `https://${owner}.github.io${name}/`;
  }
  return "https://rayysummers.github.io/Lexii/";
}

/** 给 URL 加时间戳查询参数，绕过 Pages CDN 的 10 分钟缓存。 */
export function withCacheBust(url, token = Date.now()) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}_ray491=${encodeURIComponent(String(token))}`;
}

/**
 * 断言线上根路径 / dev 通道的构建信息符合期望。
 *
 * @param {{
 *   baseUrl: string,
 *   expectBranch?: string | null,
 *   latestTag?: string | null,
 *   only?: "root" | "dev" | "both",
 *   waitSeconds?: number,
 *   pollIntervalMs?: number,
 *   fetchImpl?: typeof fetch,
 *   sleep?: (ms: number) => Promise<void>,
 *   log?: (message: string) => void,
 * }} options
 */
export async function checkPagesChannels({
  baseUrl,
  expectBranch = null,
  latestTag = null,
  only = "both",
  waitSeconds = 0,
  pollIntervalMs = 15000,
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = () => {},
} = {}) {
  if (!baseUrl) throw new Error("缺少 baseUrl");
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const scope = only === "root" || only === "dev" ? only : "both";
  const expected = (expectBranch ?? "").trim() || (latestTag ?? "").trim() || null;
  if (scope !== "dev" && !expected) {
    throw new Error("缺少期望 tag：请传 --expect-branch，或可解析出的最新 v* tag");
  }
  const waitMs = Math.max(0, Number(waitSeconds) || 0) * 1000;
  const deadline = Date.now() + waitMs;
  const interval = Math.max(0, Number(pollIntervalMs) || 0);

  const fetchInfo = async (path) => {
    const url = withCacheBust(
      `${base}${path}`,
      `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    try {
      const response = await fetchImpl(url, {
        cache: "no-store",
        headers: { "cache-control": "no-cache", pragma: "no-cache" },
        signal: typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(20000) : undefined,
      });
      if (!response.ok) return { url, error: `HTTP ${response.status}` };
      const text = await response.text();
      return { url, info: parseBuildInfo(text) };
    } catch (error) {
      return { url, error: error?.message ?? String(error) };
    }
  };

  // 单次断言：根路径 / dev 通道各读一份 build-info.json 并逐项校验
  const evaluate = async () => {
    const problems = [];
    let root = null;
    let dev = null;

    if (scope !== "dev") {
      const result = await fetchInfo("build-info.json");
      if (result.error) {
        problems.push(`根路径 build-info.json 不可用（${result.url}）：${result.error}`);
      } else {
        root = result.info;
        if (root.channel !== "release") {
          problems.push(`根路径 channel 应为 release，实际 ${root.channel}`);
        }
        if (expected) {
          if (root.branch !== expected) {
            problems.push(`根路径 branch 应为 ${expected}，实际 ${root.branch}（sha ${root.sha}）`);
          }
          if (isReleaseTag(expected) && !root.releaseTags.includes(expected)) {
            problems.push(
              `根路径 releaseTags 不含 ${expected}（实际前几项：${root.releaseTags.slice(0, 5).join(", ") || "空"}）`,
            );
          }
        }
      }
    }

    if (scope !== "root") {
      const result = await fetchInfo("dev/build-info.json");
      if (result.error) {
        problems.push(`dev 通道 build-info.json 不可用（${result.url}）：${result.error}`);
      } else {
        dev = result.info;
        if (dev.channel !== "dev") {
          problems.push(`dev 通道 channel 应为 dev，实际 ${dev.channel}`);
        }
        if (!dev.branch) problems.push("dev 通道构建信息缺少 branch");
      }
    }

    return { problems, root, dev };
  };

  let attempts = 0;
  for (;;) {
    attempts += 1;
    const { problems, root, dev } = await evaluate();
    if (problems.length === 0) {
      return { ok: true, problems, root, dev, expected, attempts };
    }
    if (Date.now() + interval > deadline) {
      return { ok: false, problems, root, dev, expected, attempts };
    }
    log(
      `第 ${attempts} 次断言未通过，${Math.round(interval / 1000)}s 后重试（Pages CDN 传播延迟）…`,
    );
    await sleep(interval);
  }
}

/**
 * 断言结果转人类可读的行（CI 日志 / 本地终端共用）。
 * @param {{ ok: boolean, problems: string[], root: unknown, dev: unknown, expected: string | null, attempts: number }} result
 * @param {(message: string) => void} [errorLine]
 */
export function formatCheckResult(result, errorLine = (message) => console.error(message)) {
  const lines = [];
  lines.push(`期望根路径 branch：${result.expected ?? "（未指定）"}；共断言 ${result.attempts} 次`);
  for (const problem of result.problems) {
    lines.push(`✗ ${problem}`);
    errorLine(`::error::${problem}`);
  }
  if (result.ok && result.root) {
    lines.push(
      `✓ 根路径：branch=${result.root.branch} sha=${result.root.sha} time=${result.root.time}`,
    );
  }
  if (result.ok && result.dev) {
    lines.push(
      `✓ dev 通道：branch=${result.dev.branch} sha=${result.dev.sha} time=${result.dev.time}`,
    );
  }
  return lines;
}
