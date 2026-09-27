import { test } from "node:test";
import assert from "node:assert/strict";
import { formatBuildInfo } from "../src/build-info";

test("页面版本展示语义版本、提交短号和 UTC 构建时间", () => {
  assert.equal(formatBuildInfo({ version: "0.1.0", revision: "abc1234", builtAt: "2026-09-27T04:13:36.789Z" }),
    "版本 v0.1.0 · 提交 abc1234 · 构建 2026-09-27 04:13:36 UTC");
});
test("无效构建时间不展示虚假的日期", () => {
  assert.equal(formatBuildInfo({ version: "0.1.0", revision: "unknown", builtAt: "invalid" }),
    "版本 v0.1.0 · 提交 unknown · 构建 未知");
});
