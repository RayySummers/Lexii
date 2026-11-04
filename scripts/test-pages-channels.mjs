// RAY-491 — Pages 通道新鲜度判定 / 构建信息断言的单测。
//
// 运行：node --test scripts/test-pages-channels.mjs
// 覆盖三层：
// 1. 纯逻辑（tag 排序、构建信息校验、根路径新鲜度判定）——RAY-491 事故的
//    核心回归：候选 tag 落后时必须 adopt 最新快照，绝不降级；
// 2. 断言内核（checkPagesChannels）：正常 / 缺文件 / branch 不符 / releaseTags
//    缺项 / 轮询等到传播完成；
// 3. 两个 CLI 的真实进程调用：本地 HTTP 服务模拟 Pages（--expect-branch 路径），
//    以及临时 git 仓库模拟「checkout 后又有新 tag」的 resolve 场景。
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  checkPagesChannels,
  compareReleaseTags,
  decideRootSnapshot,
  isReleaseTag,
  parseBuildInfo,
  parseTagOutput,
  pickNewestTag,
  withCacheBust,
} from "./pages-channel-lib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const resolveCli = join(__dirname, "resolve-pages-root.mjs");
const checkCli = join(__dirname, "check-pages-channels.mjs");

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function makeTempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function buildInfo(overrides = {}) {
  return {
    channel: "release",
    sha: "507152d",
    time: "2026-09-27T13:22:41.665Z",
    branch: "v0.10.5-alpha",
    releaseTags: ["v0.10.5-alpha", "v0.10.4-alpha", "v0.10.3-alpha"],
    ...overrides,
  };
}

// 本机 127.0.0.1 的请求必须绕过环境里的 HTTP(S)_PROXY，否则 CLI 的 fetch 会
// 走代理并超时（开发机常见配置，CI runner 无代理不受影响）。
const localEnv = { ...process.env };
for (const key of [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
]) {
  delete localEnv[key];
}
localEnv.NODE_USE_ENV_PROXY = "";
localEnv.NO_PROXY = "127.0.0.1,localhost";
localEnv.no_proxy = "127.0.0.1,localhost";

// 注意：这里必须用异步 spawn。spawnSync 会阻塞父进程事件循环，同进程里的
// 模拟 Pages 服务就永远回不了响应，CLI 只能等到 AbortSignal 超时。
function runCli(args, cwd) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, args, { env: localEnv, cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => resolvePromise({ status, stdout, stderr }));
  });
}

function startPagesServer(files) {
  const server = createServer((request, response) => {
    const path = new URL(request.url, "http://127.0.0.1").pathname;
    const body = files[path];
    if (body === undefined) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("not found");
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  });
  return new Promise((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => {
      resolvePromise({ server, port: server.address().port });
    });
  });
}

describe("tag 解析与排序", () => {
  it("识别应用发版 tag，排除词包 tag 与非法输入", () => {
    assert.equal(isReleaseTag("v0.10.5-alpha"), true);
    assert.equal(isReleaseTag("v1.0.0"), true);
    assert.equal(isReleaseTag("presets-v0.8.2-alpha"), false);
    assert.equal(isReleaseTag("main"), false);
    assert.equal(isReleaseTag(null), false);
  });

  it("按数值而非字典序比较（v0.10.10 > v0.10.9，RAY-491 易踩坑）", () => {
    assert.equal(compareReleaseTags("v0.10.10-alpha", "v0.10.9-alpha"), 1);
    assert.equal(compareReleaseTags("v0.10.2-alpha", "v0.10.1-alpha"), 1);
    assert.equal(compareReleaseTags("v0.10.1-alpha", "v0.10.1-alpha"), 0);
    assert.equal(compareReleaseTags("v0.10.1-alpha", "v0.10.2-alpha"), -1);
  });

  it("预发布版小于同号正式版，alpha.2 > alpha", () => {
    assert.equal(compareReleaseTags("v0.10.2-alpha", "v0.10.2"), -1);
    assert.equal(compareReleaseTags("v0.10.2-alpha.2", "v0.10.2-alpha"), 1);
    assert.equal(compareReleaseTags("v0.10.2-beta", "v0.10.2-alpha.9"), 1);
  });

  it("pickNewestTag 只认 v* 且取最大", () => {
    assert.equal(
      pickNewestTag(["v0.10.9-alpha", "presets-v0.11.0", "v0.10.10-alpha"]),
      "v0.10.10-alpha",
    );
    assert.equal(pickNewestTag([]), null);
    assert.equal(pickNewestTag(["presets-v0.9.0", "main"]), null);
  });

  it("parseTagOutput 兼容 ls-remote 与 tag --list 两种输出", () => {
    assert.deepEqual(
      parseTagOutput("abc123\trefs/tags/v0.10.5-alpha\ndef456\trefs/tags/v0.10.4-alpha\n"),
      ["v0.10.5-alpha", "v0.10.4-alpha"],
    );
    assert.deepEqual(parseTagOutput("v0.10.5-alpha\n\nv0.10.4-alpha\n"), [
      "v0.10.5-alpha",
      "v0.10.4-alpha",
    ]);
  });
});

describe("构建信息校验", () => {
  it("接受合法 JSON 并规范化", () => {
    const info = parseBuildInfo(JSON.stringify(buildInfo()));
    assert.equal(info.channel, "release");
    assert.equal(info.branch, "v0.10.5-alpha");
    assert.deepEqual(info.releaseTags, ["v0.10.5-alpha", "v0.10.4-alpha", "v0.10.3-alpha"]);
  });

  it("缺字段 / 非法 JSON / 非法 channel 都抛错", () => {
    assert.throws(() => parseBuildInfo("{"), /不是合法 JSON/);
    assert.throws(
      () => parseBuildInfo(JSON.stringify({ ...buildInfo(), branch: "" })),
      /缺少 branch/,
    );
    assert.throws(
      () => parseBuildInfo(JSON.stringify({ ...buildInfo(), channel: "preview" })),
      /channel 非法/,
    );
    assert.throws(
      () => parseBuildInfo(JSON.stringify({ ...buildInfo(), releaseTags: "v1" })),
      /releaseTags/,
    );
  });
});

describe("decideRootSnapshot（RAY-491 根因回归）", () => {
  it("候选 tag 落后线上根路径 → adopt 线上更新的 tag，不覆盖", () => {
    const decision = decideRootSnapshot({
      candidate: "v0.10.1-alpha",
      availableTags: ["v0.10.2-alpha", "v0.10.1-alpha"],
      liveBuildInfo: buildInfo({ branch: "v0.10.2-alpha" }),
    });
    assert.equal(decision.action, "adopt");
    assert.equal(decision.branch, "v0.10.2-alpha");
    assert.match(decision.reason, /避免旧快照覆盖新版本/);
  });

  it("候选 tag 落后远端最新（线上还读不到）→ 仍 adopt 远端最新", () => {
    const decision = decideRootSnapshot({
      candidate: "v0.10.1-alpha",
      availableTags: ["v0.10.1-alpha", "v0.10.2-alpha"],
      liveBuildInfo: null,
    });
    assert.equal(decision.action, "adopt");
    assert.equal(decision.branch, "v0.10.2-alpha");
  });

  it("候选已是最新 → write，保持原行为（线上更旧也不回退）", () => {
    const decision = decideRootSnapshot({
      candidate: "v0.10.5-alpha",
      availableTags: ["v0.10.5-alpha", "v0.10.4-alpha"],
      liveBuildInfo: buildInfo({ branch: "v0.10.1-alpha" }),
    });
    assert.equal(decision.action, "write");
    assert.equal(decision.branch, "v0.10.5-alpha");
  });

  it("没有 tag 时候选 main：有 tag 就 adopt 最新 tag", () => {
    const decision = decideRootSnapshot({
      candidate: "main",
      availableTags: ["v0.10.1-alpha"],
      liveBuildInfo: null,
    });
    assert.equal(decision.action, "adopt");
    assert.equal(decision.branch, "v0.10.1-alpha");
  });

  it("线上 branch 是 main / 不可读时只按 git 信号判定", () => {
    const baseline = decideRootSnapshot({
      candidate: "v0.10.1-alpha",
      availableTags: ["v0.10.1-alpha"],
      liveBuildInfo: buildInfo({ branch: "main" }),
    });
    assert.equal(baseline.action, "write");
    const unreadable = decideRootSnapshot({
      candidate: "v0.10.1-alpha",
      availableTags: ["v0.10.1-alpha"],
      liveBuildInfo: null,
    });
    assert.equal(unreadable.action, "write");
    assert.equal(unreadable.signals.liveBranch, null);
  });

  it("缺候选 tag 直接抛错（不允许静默按 main 发布）", () => {
    assert.throws(() => decideRootSnapshot({ candidate: "  " }), /缺少候选 tag/);
  });
});

describe("checkPagesChannels 断言内核", () => {
  const okFetch = (root = buildInfo(), dev = buildInfo({ channel: "dev", branch: "main" })) => {
    return async (url) => {
      if (url.includes("dev/build-info.json")) {
        return { ok: true, status: 200, text: async () => JSON.stringify(dev) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(root) };
    };
  };

  it("根路径与 dev 通道都符合期望 → ok", async () => {
    const result = await checkPagesChannels({
      baseUrl: "https://example.test/Lexii/",
      expectBranch: "v0.10.5-alpha",
      fetchImpl: okFetch(),
      waitSeconds: 0,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.problems, []);
    assert.equal(result.root.branch, "v0.10.5-alpha");
    assert.equal(result.dev.channel, "dev");
  });

  it("根路径仍是旧 tag（事故形态）→ 报 branch 与 releaseTags 两处不符", async () => {
    const result = await checkPagesChannels({
      baseUrl: "https://example.test/Lexii/",
      expectBranch: "v0.10.2-alpha",
      fetchImpl: okFetch(buildInfo({ branch: "v0.10.1-alpha", releaseTags: ["v0.10.1-alpha"] })),
      waitSeconds: 0,
    });
    assert.equal(result.ok, false);
    assert.equal(result.problems.length, 2);
    assert.match(result.problems[0], /branch 应为 v0\.10\.2-alpha，实际 v0\.10\.1-alpha/);
    assert.match(result.problems[1], /releaseTags 不含 v0\.10\.2-alpha/);
  });

  it("build-info.json 缺失 → fail-closed 且给出定位信息", async () => {
    const result = await checkPagesChannels({
      baseUrl: "https://example.test/Lexii/",
      expectBranch: "v0.10.5-alpha",
      fetchImpl: async () => ({ ok: false, status: 404, text: async () => "not found" }),
      waitSeconds: 0,
    });
    assert.equal(result.ok, false);
    assert.match(result.problems.join("\n"), /根路径 build-info\.json 不可用.*HTTP 404/);
  });

  it("dev 通道 channel 不是 dev → 报错", async () => {
    const result = await checkPagesChannels({
      baseUrl: "https://example.test/Lexii/",
      only: "dev",
      fetchImpl: okFetch(buildInfo(), buildInfo({ channel: "release" })),
      waitSeconds: 0,
    });
    assert.equal(result.ok, false);
    assert.match(result.problems[0], /dev 通道 channel 应为 dev/);
  });

  it("CDN 传播延迟：先旧后新，轮询到通过", async () => {
    let calls = 0;
    const fetchImpl = async (url) => {
      if (url.includes("dev/build-info.json")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(buildInfo({ channel: "dev", branch: "main" })),
        };
      }
      calls += 1;
      const info = calls <= 2 ? buildInfo({ branch: "v0.10.4-alpha" }) : buildInfo();
      return { ok: true, status: 200, text: async () => JSON.stringify(info) };
    };
    const result = await checkPagesChannels({
      baseUrl: "https://example.test/Lexii/",
      expectBranch: "v0.10.5-alpha",
      fetchImpl,
      waitSeconds: 2,
      pollIntervalMs: 0,
      sleep: async () => {},
    });
    assert.equal(result.ok, true);
    assert.equal(result.attempts, 3);
  });

  it("始终不符且不等待 → 一次断言后失败", async () => {
    const result = await checkPagesChannels({
      baseUrl: "https://example.test/Lexii/",
      expectBranch: "v0.10.5-alpha",
      fetchImpl: okFetch(buildInfo({ branch: "v0.10.4-alpha" })),
      waitSeconds: 0,
    });
    assert.equal(result.ok, false);
    assert.equal(result.attempts, 1);
  });

  it("只查根路径但既无期望 tag 也无 --latest-tag → 抛错", async () => {
    await assert.rejects(
      checkPagesChannels({
        baseUrl: "https://example.test/Lexii/",
        only: "root",
        fetchImpl: okFetch(),
      }),
      /缺少期望 tag/,
    );
  });
});

describe("withCacheBust", () => {
  it("追加时间戳参数绕过 Pages CDN 缓存", () => {
    assert.equal(
      withCacheBust("https://a.test/Lexii/build-info.json", 1),
      "https://a.test/Lexii/build-info.json?_ray491=1",
    );
    assert.equal(
      withCacheBust("https://a.test/x.json?a=1", 2),
      "https://a.test/x.json?a=1&_ray491=2",
    );
  });
});

describe("resolve-pages-root CLI（临时 git 仓库模拟 tag 竞态）", () => {
  function initRepo(tags) {
    const dir = makeTempDir("ray491-resolve-");
    const run = (...args) =>
      execFileSync(
        "git",
        ["-c", "user.name=RAY-491", "-c", "user.email=ray491@example.test", ...args],
        {
          cwd: dir,
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
    run("init", "--quiet");
    run("commit", "--allow-empty", "-m", "init", "--quiet");
    for (const tag of tags) run("tag", tag);
    return dir;
  }

  function readEnvFile(envFile) {
    return Object.fromEntries(
      readFileSync(envFile, "utf-8")
        .split("\n")
        .filter(Boolean)
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
    );
  }

  function runResolve(cwd, candidate, envFile) {
    return spawnSync(
      process.execPath,
      [resolveCli, "--candidate", candidate, "--skip-live", "--github-env", envFile],
      { cwd, encoding: "utf-8" },
    );
  }

  it("候选落后仓库里已存在的 tag → adopt 最新（数值比较 v0.10.10 > v0.10.9）", () => {
    const dir = initRepo([
      "v0.10.1-alpha",
      "v0.10.9-alpha",
      "v0.10.10-alpha",
      "presets-v0.11.0-alpha",
    ]);
    const envFile = join(dir, "env.txt");
    writeFileSync(envFile, "", "utf-8");
    const result = runResolve(dir, "v0.10.1-alpha", envFile);
    assert.equal(result.status, 0, result.stderr);
    const env = readEnvFile(envFile);
    assert.equal(env.ROOT_BRANCH, "v0.10.10-alpha");
    assert.equal(env.ROOT_ACTION, "adopt");
    assert.match(env.ROOT_REASON, /避免旧快照覆盖新版本/);
    assert.equal(env.ROOT_LIVE_BRANCH, "");
  });

  it("线上根路径 tag 比候选与本地 tag 都新 → adopt 线上（真读 build-info.json）", async () => {
    const dir = initRepo(["v0.10.1-alpha"]);
    const envFile = join(dir, "env.txt");
    writeFileSync(envFile, "", "utf-8");
    const { server, port } = await startPagesServer({
      "/build-info.json": buildInfo({ branch: "v0.10.3-alpha" }),
    });
    try {
      const result = await runCli(
        [
          resolveCli,
          "--candidate",
          "v0.10.1-alpha",
          "--live-url",
          `http://127.0.0.1:${port}/build-info.json`,
          "--github-env",
          envFile,
        ],
        dir,
      );
      assert.equal(result.status, 0, result.stderr);
      const env = readEnvFile(envFile);
      assert.equal(env.ROOT_BRANCH, "v0.10.3-alpha");
      assert.equal(env.ROOT_ACTION, "adopt");
      assert.equal(env.ROOT_LIVE_BRANCH, "v0.10.3-alpha");
    } finally {
      server.close();
    }
  });

  it("候选已是最新 → write，且不改写 tag", () => {
    const dir = initRepo(["v0.10.10-alpha", "v0.10.9-alpha"]);
    const envFile = join(dir, "env.txt");
    writeFileSync(envFile, "", "utf-8");
    const result = runResolve(dir, "v0.10.10-alpha", envFile);
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(envFile, "utf-8"), /ROOT_ACTION=write/);
    assert.match(readFileSync(envFile, "utf-8"), /ROOT_BRANCH=v0\.10\.10-alpha/);
  });

  it("无 tag 且候选 main → 仍写 main（首发前站点不 404）", () => {
    const dir = initRepo([]);
    const envFile = join(dir, "env.txt");
    writeFileSync(envFile, "", "utf-8");
    const result = runResolve(dir, "main", envFile);
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(envFile, "utf-8"), /ROOT_ACTION=write/);
    assert.match(readFileSync(envFile, "utf-8"), /ROOT_BRANCH=main/);
  });
});

describe("check-pages-channels CLI（本地 HTTP 模拟 Pages）", () => {
  it("线上一致 → 退出码 0", async () => {
    const { server, port } = await startPagesServer({
      "/Lexii/build-info.json": buildInfo(),
      "/Lexii/dev/build-info.json": buildInfo({ channel: "dev", branch: "main" }),
    });
    try {
      const result = await runCli([
        checkCli,
        "--base-url",
        `http://127.0.0.1:${port}/Lexii/`,
        "--expect-branch",
        "v0.10.5-alpha",
      ]);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /通过：线上构建信息与期望一致/);
    } finally {
      server.close();
    }
  });

  it("线上仍是旧 tag → 退出码 1 且指出 branch 不符（事故形态）", async () => {
    const { server, port } = await startPagesServer({
      "/Lexii/build-info.json": buildInfo({
        branch: "v0.10.4-alpha",
        releaseTags: ["v0.10.4-alpha"],
      }),
      "/Lexii/dev/build-info.json": buildInfo({ channel: "dev", branch: "main" }),
    });
    try {
      const result = await runCli([
        checkCli,
        "--base-url",
        `http://127.0.0.1:${port}/Lexii/`,
        "--expect-branch",
        "v0.10.5-alpha",
      ]);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /branch 应为 v0\.10\.5-alpha，实际 v0\.10\.4-alpha/);
    } finally {
      server.close();
    }
  });
});
