import { test } from "node:test";
import assert from "node:assert/strict";
import { formatBuildInfo, formatLocalBuildTime } from "../src/build-info";

function inZone(zone: string, check: () => void): void {
  const previous = process.env.TZ;
  try { process.env.TZ = zone; check(); }
  finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
}

test("页面按设备本地时区显示版本和构建时间，不显示 UTC", () => {
  inZone("Asia/Shanghai", () => {
    const text = formatBuildInfo({ version: "0.1.0", revision: "abc1234", builtAt: "2026-09-27T04:13:36.789Z" });
    assert.equal(text, "版本 v0.1.0 · 提交 abc1234 · 构建（本地） 2026-09-27 12:13:36 +08:00");
    assert.doesNotMatch(text, /UTC/);
  });
});
test("跨日和夏令时均按构建瞬间对应的当地偏移显示", () => {
  inZone("America/New_York", () => {
    assert.equal(formatLocalBuildTime("2026-09-27T04:13:36.789Z"), "2026-09-27 00:13:36 -04:00");
    assert.equal(formatLocalBuildTime("2026-01-01T04:13:36.789Z"), "2025-12-31 23:13:36 -05:00");
  });
});
test("无效构建时间不展示虚假的日期", () => {
  assert.equal(formatBuildInfo({ version: "0.1.0", revision: "unknown", builtAt: "invalid" }),
    "版本 v0.1.0 · 提交 unknown · 构建（本地） 未知");
});
