/**
 * 通道检测与切换目标计算测试（RAY-297 任务 B）：
 * 纯函数覆盖 dev 子路径（带/不带结尾斜杠、带文件名）、根路径、查询串等形态。
 */
import { describe, expect, it } from "vitest";
import { detectChannel, getOtherChannelPath } from "./channel";

describe("detectChannel 通道检测", () => {
  it.each([
    ["/Lexii/dev/", "dev"],
    ["/Lexii/dev", "dev"],
    ["/Lexii/dev/index.html", "dev"],
    ["/Lexii/dev/index.html?x=1", "dev"],
    ["/dev/", "dev"],
    ["/Lexii/", "release"],
    ["/Lexii", "release"],
    ["/Lexii/index.html", "release"],
    ["/", "release"],
    ["/foo/devbar/", "release"],
  ])("%s → %s", (pathname, expected) => {
    expect(detectChannel(pathname)).toBe(expected);
  });
});

describe("getOtherChannelPath 切换目标", () => {
  it.each([
    // release → dev（追加 dev/ 子路径）
    ["/Lexii/", "/Lexii/dev/"],
    ["/Lexii", "/Lexii/dev/"],
    ["/Lexii/index.html", "/Lexii/dev/"],
    ["/", "/dev/"],
    // dev → release（去掉 dev 段）
    ["/Lexii/dev/", "/Lexii/"],
    ["/Lexii/dev", "/Lexii/"],
    ["/Lexii/dev/index.html", "/Lexii/"],
    ["/dev/", "/"],
    ["/Lexii/dev?from=settings", "/Lexii/"],
  ])("%s → %s", (pathname, expected) => {
    expect(getOtherChannelPath(pathname)).toBe(expected);
  });

  it("与 detectChannel 互逆：任意路径切换两次回到自身通道目录", () => {
    for (const pathname of [
      "/Lexii/",
      "/Lexii/dev/",
      "/",
      "/dev/",
      "/Lexii/dev/index.html",
    ]) {
      const other = getOtherChannelPath(pathname);
      expect(detectChannel(other)).not.toBe(detectChannel(pathname));
      // 再切换一次回到原通道（目录级等价）
      const back = getOtherChannelPath(other);
      expect(detectChannel(back)).toBe(detectChannel(pathname));
    }
  });
});
