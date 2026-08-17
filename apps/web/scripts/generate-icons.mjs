/**
 * PWA 图标生成器（零依赖，纯 Node）。
 *
 * 生成 apps/web/public/icons/ 下的 PNG 图标：
 *   icon-192.png / icon-512.png（"any"）、maskable-512.png、apple-touch-icon.png（180）。
 *
 * 设计：品牌主色（--lex-primary #4f46e5，见 src/styles/tokens.css）圆角方底 +
 * 白色「闪卡」图形（两张叠放卡片 + 卡片上的文字行）。
 * 图形为轴对齐圆角矩形（无旋转、无字体），像素级确定性输出，可重复生成。
 *
 * 用法：pnpm --filter @lexii/web icons   （或在 apps/web 下 node scripts/generate-icons.mjs）
 * 生成结果提交进仓库；改设计或品牌色后重新运行本脚本。
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** 品牌主色（与 src/styles/tokens.css 的 --lex-primary 保持一致） */
const PRIMARY = hexToRgba("#4f46e5");
const WHITE = [255, 255, 255, 255];

/** 抗锯齿：以 2 倍分辨率渲染，再 2×2 盒式降采样 */
const SUPERSAMPLE = 2;

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

/** 图标规格：文件名 → 边长 / 类型（"maskable" 需要安全区缩放） */
const TARGETS = [
  { file: "icon-192.png", size: 192, maskable: false },
  { file: "icon-512.png", size: 512, maskable: false },
  { file: "maskable-512.png", size: 512, maskable: true },
  { file: "apple-touch-icon.png", size: 180, maskable: false },
];

/* ------------------------------------------------------------------ */
/* PNG 编码（无第三方依赖）                                            */
/* ------------------------------------------------------------------ */

/** CRC32 查表（PNG chunk 校验用） */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const chunk = Buffer.alloc(8 + data.length + 4);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, "ascii");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

/** 将 RGBA 像素缓冲（width × height）编码为 8-bit RGBA PNG */
function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ */
/* 绘制（轴对齐圆角矩形 + alpha 合成 + 超采样降采样）                  */
/* ------------------------------------------------------------------ */

function hexToRgba(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff, 255];
}

/**
 * 圆角矩形在点 (px, py)（像素中心坐标，含 0.5 偏移）处的覆盖率。
 * 像素中心到圆角矩形边界的带符号距离 → [0, 1] 抗锯齿覆盖率。
 */
function roundedRectCoverage(px, py, rect) {
  const halfW = rect.width / 2 - rect.radius;
  const halfH = rect.height / 2 - rect.radius;
  const dx = Math.max(Math.abs(px - rect.cx) - halfW, 0);
  const dy = Math.max(Math.abs(py - rect.cy) - halfH, 0);
  const distance = Math.hypot(dx, dy) - rect.radius;
  return clamp(0.5 - distance, 0, 1);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/** 把形状绘制到超采样画布（src-over alpha 合成，覆盖率作归一化 alpha） */
function drawShape(canvas, size, rect, color) {
  const colorAlpha = color[3] / 255;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 超采样像素中心（相对图标坐标）
      const px = (x + 0.5) / SUPERSAMPLE;
      const py = (y + 0.5) / SUPERSAMPLE;
      const coverage = roundedRectCoverage(px, py, rect);
      if (coverage <= 0) {
        continue;
      }
      const alpha = coverage * colorAlpha;
      const offset = (y * size + x) * 4;
      const outAlpha = canvas[offset + 3] / 255;
      const out = 1 - (1 - outAlpha) * (1 - alpha);
      if (out <= 0) {
        continue;
      }
      for (let channel = 0; channel < 3; channel++) {
        canvas[offset + channel] =
          (color[channel] * alpha + canvas[offset + channel] * outAlpha * (1 - alpha)) / out;
      }
      canvas[offset + 3] = Math.round(out * 255);
    }
  }
}

/** 2×2 降采样：预乘 alpha 平均后反预乘，避免直通 alpha 平均产生的深色边缘 */
function downsample(canvas, supersampledSize, targetSize) {
  const out = Buffer.alloc(targetSize * targetSize * 4);
  const pixelCount = SUPERSAMPLE * SUPERSAMPLE;
  for (let y = 0; y < targetSize; y++) {
    for (let x = 0; x < targetSize; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let dy = 0; dy < SUPERSAMPLE; dy++) {
        for (let dx = 0; dx < SUPERSAMPLE; dx++) {
          const offset = ((y * SUPERSAMPLE + dy) * supersampledSize + x * SUPERSAMPLE + dx) * 4;
          const alpha = canvas[offset + 3];
          r += canvas[offset] * alpha;
          g += canvas[offset + 1] * alpha;
          b += canvas[offset + 2] * alpha;
          a += alpha;
        }
      }
      const outOffset = (y * targetSize + x) * 4;
      if (a === 0) {
        continue; // 全透明块保持 0
      }
      out[outOffset] = Math.round(r / a);
      out[outOffset + 1] = Math.round(g / a);
      out[outOffset + 2] = Math.round(b / a);
      out[outOffset + 3] = Math.round(a / pixelCount);
    }
  }
  return out;
}

/**
 * 绘制一枚图标（目标边长单位下的形状坐标）：
 * 品牌色圆角方底 + 叠放的两张白色闪卡 + 前卡上的三行文字。
 * maskable 时图形整体缩到安全区（80% 中心圆），背景仍铺满。
 */
function renderIcon(targetSize, maskable) {
  const supersampledSize = targetSize * SUPERSAMPLE;
  const canvas = Buffer.alloc(supersampledSize * supersampledSize * 4);

  // 1) 背景：铺满的圆角方（maskable 用更小圆角，靠近方形安全区）
  drawShape(
    canvas,
    supersampledSize,
    {
      cx: targetSize / 2,
      cy: targetSize / 2,
      width: targetSize,
      height: targetSize,
      radius: maskable ? targetSize * 0.08 : targetSize * 0.22,
    },
    PRIMARY,
  );

  // maskable：图形内容缩至 80% 安全区（相对中心缩放）
  const glyphScale = maskable ? 0.78 : 1;
  const center = targetSize / 2;
  const rect = (raw) => ({
    cx: center + (raw.cx - center) * glyphScale,
    cy: center + (raw.cy - center) * glyphScale,
    width: raw.width * glyphScale,
    height: raw.height * glyphScale,
    radius: raw.radius * glyphScale,
  });

  // 2) 后卡（左上偏移露出边缘）
  drawShape(
    canvas,
    supersampledSize,
    rect({
      cx: targetSize * 0.43,
      cy: targetSize * 0.54,
      width: targetSize * 0.5,
      height: targetSize * 0.6,
      radius: targetSize * 0.07,
    }),
    WHITE,
  );

  // 3) 前卡（右下偏移，叠在后卡之上）
  const frontRaw = {
    cx: targetSize * 0.57,
    cy: targetSize * 0.46,
    width: targetSize * 0.5,
    height: targetSize * 0.6,
    radius: targetSize * 0.07,
  };
  drawShape(canvas, supersampledSize, rect(frontRaw), WHITE);

  // 4) 前卡上的三行「文字」（品牌色圆角横条，随前卡一起缩放居中）
  const barWidth = targetSize * 0.26;
  const barHeight = targetSize * 0.05;
  const barRadius = barHeight / 2;
  for (const barCY of [targetSize * 0.34, targetSize * 0.46, targetSize * 0.58]) {
    drawShape(
      canvas,
      supersampledSize,
      rect({
        cx: frontRaw.cx,
        cy: barCY,
        width: barWidth,
        height: barHeight,
        radius: barRadius,
      }),
      PRIMARY,
    );
  }

  return encodePng(targetSize, targetSize, downsample(canvas, supersampledSize, targetSize));
}

/* ------------------------------------------------------------------ */

mkdirSync(OUT_DIR, { recursive: true });
for (const target of TARGETS) {
  const png = renderIcon(target.size, target.maskable);
  writeFileSync(join(OUT_DIR, target.file), png);
  console.log(`generated ${target.file} (${target.size}×${target.size}, ${png.length} bytes)`);
}
