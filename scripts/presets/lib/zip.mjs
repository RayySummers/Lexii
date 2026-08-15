/**
 * 最小 ZIP 读取器（EPUB = ZIP 容器；仅支持 stored/deflate 两种压缩方式）。
 *
 * 纯 Node 内置 API 实现（zlib.inflateRawSync 解 deflate）。OpenEtymology 的
 * 结构化词根词缀内容在 EPUB 内（TXT 为纯词表），打包管线用它逐词提取。
 * 只做读取不做写入；不支持 zip64 与加密（来源文件为常规 EPUB，无此形态）。
 */
import { inflateRawSync } from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/** ZIP 条目内容（UTF-8 解码后字符串；二进制条目返回 Buffer） */
export function readZipEntries(buf) {
  const eocd = findEocd(buf);
  if (!eocd) {
    throw new Error("ZIP 结构非法：找不到 End of Central Directory");
  }
  const count = buf.readUInt16LE(eocd + 10);
  let cursor = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new Error(`ZIP 结构非法：central directory 条目 #${i} 签名不符`);
    }
    const method = buf.readUInt16LE(cursor + 10);
    const compressedSize = buf.readUInt32LE(cursor + 20);
    const nameLength = buf.readUInt16LE(cursor + 28);
    const extraLength = buf.readUInt16LE(cursor + 30);
    const commentLength = buf.readUInt16LE(cursor + 32);
    const localOffset = buf.readUInt32LE(cursor + 42);
    const name = buf.toString("utf-8", cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;

    if (buf.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new Error(`ZIP 结构非法：条目 ${name} 的 local header 签名不符`);
    }
    const localNameLength = buf.readUInt16LE(localOffset + 26);
    const localExtraLength = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    let data;
    if (method === 0) {
      data = buf.subarray(dataStart, dataEnd);
    } else if (method === 8) {
      data = inflateRawSync(buf.subarray(dataStart, dataEnd));
    } else {
      throw new Error(`ZIP 条目 ${name} 使用不支持的压缩方式：${method}`);
    }
    entries.push({ name, data });
  }
  return entries;
}

/** 在文件末尾 64KB 内定位 EOCD 签名（忽略 trailing data） */
function findEocd(buf) {
  const start = Math.max(0, buf.length - 0x10000);
  for (let i = buf.length - 22; i >= start; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) {
      return i;
    }
  }
  return null;
}

/** 常用 HTML 实体解码（XHTML 文本内的 &amp; &lt; &gt; &quot; &#39; &#nnn; &#xHH;） */
export function decodeHtmlEntities(text) {
  return text.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g,
    (entity, name) => {
      if (name.startsWith("#x")) {
        return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
      }
      if (name.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
      }
      switch (name) {
        case "amp":
          return "&";
        case "lt":
          return "<";
        case "gt":
          return ">";
        case "quot":
          return '"';
        case "apos":
          return "'";
        case "nbsp":
          return " ";
        default:
          return entity;
      }
    },
  );
}

/** 剥除 XML 标签（提取 XHTML 元素文本内容；来源文件结构固定、无嵌套混乱标签） */
export function stripTags(html) {
  return decodeHtmlEntities(
    html
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  );
}
