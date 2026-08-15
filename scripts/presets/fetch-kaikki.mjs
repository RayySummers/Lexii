/**
 * 下载 kaikki.org 英语词典提取数据（Wiktionary JSONL，CC BY-SA 4.0 + GFDL）。
 *
 * kaikki 每周更新、无上游校验和：本脚本把「首次下载的完整快照」固定下来——
 * 下载后计算 SHA256 与字节数写入 .data/kaikki/manifest.json，后续运行按
 * manifest 校验复用（跨机器复现以 manifest 为凭据，记录抓取日期与
 * Last-Modified，与 RAY-258 ECDICT 固定 commit 的口径一致）。
 *
 * 支持多连接分段下载（--connections N）：服务器对单连接限速（实测
 * ~150-200KB/s），多连接并行分段可数倍加速；每段独立 Range 请求、
 * 先写临时分片、全部完成后按序拼接。已完整的分片跳过、未完整的分片
 * 从已有字节续传（追加模式），中断后重跑即可断点续传；分片最终字节数
 * 与期望不符自动整体重试（至多 3 次）。默认单连接（慢但最简）；
 * 校验与 manifest 记录不受连接数影响。
 *
 * 用法：node scripts/presets/fetch-kaikki.mjs [--connections 16]
 * 输出：scripts/presets/.data/kaikki/kaikki.org-dictionary-English.jsonl（git 忽略）
 */
import { createHash } from "node:crypto";
import {
  appendFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_DIR = path.join(ROOT, "scripts", "presets", ".data", "kaikki");
const OUT_FILE = path.join(OUT_DIR, "kaikki.org-dictionary-English.jsonl");
const MANIFEST_FILE = path.join(OUT_DIR, "manifest.json");
const LOCK_FILE = path.join(OUT_DIR, ".kaikki-fetch.lock");

/**
 * 单实例锁：两个下载进程并发写同一组分片会互相污染字节（断点续传的
 * 追加偏移基于启动时测量的大小，另一进程同时写会使文件错位）。锁文件
 * 记录 pid 与启动时间，正常结束/异常退出都释放（finally）。
 */
function acquireLock() {
  if (existsSync(LOCK_FILE)) {
    let info = "";
    try {
      info = readFileSync(LOCK_FILE, "utf-8").trim();
    } catch {
      // 锁文件读不到按空处理
    }
    if (process.argv.includes("--force")) {
      console.log(`锁文件已存在（${info || "未知"})，--force 强制继续…`);
      return;
    }
    throw new Error(
      `另一个下载进程可能正在运行（${info || "未知"}）。确认没有并发下载后删除 ${LOCK_FILE} 重跑，或加 --force 强制继续。`,
    );
  }
  writeFileSync(LOCK_FILE, `pid=${process.pid} started=${new Date().toISOString()}`, "utf-8");
}

function releaseLock() {
  rmSync(LOCK_FILE, { force: true });
}

/** 固定抓取目标：英语词典提取（每周更新的当前快照；日期以 Last-Modified 为准） */
const KAIKKI_URL = "https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl";
/** 下载进度日志间隔（毫秒） */
const PROGRESS_INTERVAL_MS = 20_000;

/** 流式计算文件 SHA256（3.2GB 文件不可整读入内存） */
async function sha256(file) {
  const hash = createHash("sha256");
  return new Promise((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

function readManifest() {
  try {
    return JSON.parse(readFileSync(MANIFEST_FILE, "utf-8"));
  } catch {
    return null;
  }
}

async function headRequest() {
  const res = await fetch(KAIKKI_URL, {
    method: "HEAD",
    headers: { "user-agent": "lexilexi-preset-pipeline", "accept-encoding": "identity" },
  });
  if (!res.ok) {
    throw new Error(`HEAD 失败：HTTP ${res.status}`);
  }
  const total = Number(res.headers.get("content-length")) || 0;
  if (!total) {
    throw new Error("服务器未提供 content-length，无法分段下载");
  }
  return { total, lastModified: res.headers.get("last-modified") ?? "" };
}

/** 下载单个字节区间到分片（resumeBytes > 0 时追加续传）；返回本次新增字节数 */
async function downloadRange(url, start, end, partFile, expected, resumeBytes, partIndex) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "lexilexi-preset-pipeline",
      "accept-encoding": "identity",
      range: `bytes=${start}-${end}`,
    },
  });
  if (!res.ok && res.status !== 206) {
    throw new Error(`Range 请求失败：HTTP ${res.status}（${start}-${end}）`);
  }
  const stream = createWriteStream(partFile, { flags: resumeBytes > 0 ? "a" : "w" });
  const reader = res.body.getReader();
  let bytes = 0;
  let lastLog = Date.now();
  const started = Date.now();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (!stream.write(Buffer.from(value))) {
      await new Promise((resolve) => stream.once("drain", resolve));
    }
    const now = Date.now();
    if (now - lastLog >= PROGRESS_INTERVAL_MS) {
      const donePart = resumeBytes + bytes;
      const speed = (donePart / 1024 / ((now - started + 1) / 1000)).toFixed(0);
      console.log(
        `  分片 ${partIndex}：${(donePart / 1024 / 1024).toFixed(1)} MB / ${(expected / 1024 / 1024).toFixed(1)} MB（${speed} KB/s）`,
      );
      lastLog = now;
    }
  }
  await new Promise((resolve, reject) => {
    stream.end(() => resolve());
    stream.on("error", reject);
  });
  return bytes;
}

/** 分段并行下载：每段一个连接；已完整分片跳过，未完整分片断点续传，段内失败整体重试该段（至多 3 次） */
async function downloadParallel(url, total, connections, partPrefix) {
  const partSize = Math.ceil(total / connections);
  const started = Date.now();
  const results = await Promise.all(
    Array.from({ length: connections }, async (_, i) => {
      const start = i * partSize;
      const end = Math.min(start + partSize - 1, total - 1);
      const expected = end - start + 1;
      const partFile = `${partPrefix}.${String(i).padStart(3, "0")}`;
      for (let attempt = 1; ; attempt += 1) {
        try {
          let resumeBytes = 0;
          try {
            const size = statSync(partFile).size;
            if (size === expected) {
              console.log(`  分片 ${i} 已完整，跳过`);
              return { i, ok: true };
            }
            if (size > expected) {
              rmSync(partFile, { force: true });
            } else {
              resumeBytes = size;
            }
          } catch {
            resumeBytes = 0;
          }
          if (resumeBytes > 0) {
            console.log(`  分片 ${i} 从 ${(resumeBytes / 1024 / 1024).toFixed(1)} MB 续传`);
          }
          await downloadRange(url, start + resumeBytes, end, partFile, expected, resumeBytes, i);
          const size = statSync(partFile).size;
          if (size !== expected) {
            throw new Error(`分片 ${i} 字节数不符：期望 ${expected}，实际 ${size}`);
          }
          return { i, ok: true };
        } catch (err) {
          if (attempt >= 3) {
            return { i, ok: false, error: String(err) };
          }
          console.log(`  分片 ${i} 重试（${err instanceof Error ? err.message : err}）`);
          rmSync(partFile, { force: true });
        }
      }
    }),
  );
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    throw new Error(`分段下载失败：${failed.map((f) => f.error).join("; ")}`);
  }
  return (Date.now() - started) / 1000;
}

async function main() {
  const connections = Number(process.argv[3] ?? 1);
  mkdirSync(OUT_DIR, { recursive: true });
  acquireLock();
  try {
    const manifest = readManifest();
    if (manifest?.file === path.basename(OUT_FILE)) {
      try {
        const size = statSync(OUT_FILE).size;
        if (size === manifest.bytes) {
          const actual = await sha256(OUT_FILE);
          if (actual === manifest.sha256) {
            console.log(
              `已存在且校验通过：${OUT_FILE}（${(size / 1024 / 1024 / 1024).toFixed(2)} GB）`,
            );
            return;
          }
          console.log(`已存在但 SHA256 与 manifest 不符（${actual.slice(0, 16)}…），重新下载…`);
        }
      } catch {
        // 文件缺失，走重新下载
      }
    }

    const { total, lastModified } = await headRequest();
    console.log(
      `下载 ${KAIKKI_URL}（${(total / 1024 / 1024 / 1024).toFixed(2)} GB，${connections} 连接并行）…`,
    );
    const partPrefix = path.join(OUT_DIR, ".kaikki-part");
    const seconds = await downloadParallel(KAIKKI_URL, total, connections, partPrefix);

    // 按序拼接分片（fs.appendFileSync 顺序追加，避免整文件内存拷贝；先清空旧文件防半成品残留）
    rmSync(OUT_FILE, { force: true });
    for (let i = 0; i < connections; i += 1) {
      appendFileSync(OUT_FILE, readFileSync(`${partPrefix}.${String(i).padStart(3, "0")}`));
      rmSync(`${partPrefix}.${String(i).padStart(3, "0")}`);
    }
    const bytes = statSync(OUT_FILE).size;
    if (bytes !== total) {
      throw new Error(`拼接后字节数不符：期望 ${total}，实际 ${bytes}`);
    }
    const digest = await sha256(OUT_FILE);
    writeFileSync(
      MANIFEST_FILE,
      `${JSON.stringify(
        {
          file: path.basename(OUT_FILE),
          url: KAIKKI_URL,
          fetchedAt: new Date().toISOString(),
          lastModified,
          bytes,
          sha256: digest,
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );
    console.log(
      `已写入 ${OUT_FILE}（${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB，SHA256 ${digest.slice(0, 16)}…，耗时 ${Math.round(seconds)}s）`,
    );
    console.log(`manifest：${MANIFEST_FILE}`);
  } finally {
    releaseLock();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
