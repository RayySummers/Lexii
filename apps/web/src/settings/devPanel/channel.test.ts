/**
 * 通道检测与切换目标计算测试（RAY-297 任务 B）：
 * 纯函数覆盖 dev 子路径（带/不带结尾斜杠、带文件名）、根路径、查询串等形态。
 */
import { describe, expect, it } from "vitest";
import { detectChannel, getOtherChannelPath } from "./channel";

describe("detectChannel 通道检测", () => {
  it.each([
    ["/Lexilexi/dev/", "dev"],
    ["/Lexilexi/dev", "dev"],
    ["/Lexilexi/dev/index.html", "dev"],
    ["/Lexilexi/dev/index.html?x=1", "dev"],
    ["/dev/", "dev"],
    ["/Lexilexi/", "release"],
    ["/Lexilexi", "release"],
    ["/Lexilexi/index.html", "release"],
    ["/", "release"],
    ["/foo/devbar/", "release"],
  ])("%s → %s", (pathname, expected) => {
    expect(detectChannel(pathname)).toBe(expected);
  });
});

describe("getOtherChannelPath 切换目标", () => {
  it.each([
    // release → dev（追加 dev/ 子路径）
    ["/Lexilexi/", "/Lexilexi/dev/"],
    ["/Lexilexi", "/Lexilexi/dev/"],
    ["/Lexilexi/index.html", "/Lexilexi/dev/"],
    ["/", "/dev/"],
    // dev → release（去掉 dev 段）
    ["/Lexilexi/dev/", "/Lexilexi/"],
    ["/Lexilexi/dev", "/Lexilexi/"],
    ["/Lexilexi/dev/index.html", "/Lexilexi/"],
    ["/dev/", "/"],
    ["/Lexilexi/dev?from=settings", "/Lexilexi/"],
  ])("%s → %s", (pathname, expected) => {
    expect(getOtherChannelPath(pathname)).toBe(expected);
  });

  it("与 detectChannel 互逆：任意路径切换两次回到自身通道目录", () => {
    for (const pathname of [
      "/Lexilexi/",
      "/Lexilexi/dev/",
      "/",
      "/dev/",
      "/Lexilexi/dev/index.html",
    ]) {
      const other = getOtherChannelPath(pathname);
      expect(detectChannel(other)).not.toBe(detectChannel(pathname));
      // 再切换一次回到原通道（目录级等价）
      const back = getOtherChannelPath(other);
      expect(detectChannel(back)).toBe(detectChannel(pathname));
    }
  });
});
