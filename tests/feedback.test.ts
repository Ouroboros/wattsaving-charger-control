import assert from "node:assert/strict";
import test from "node:test";
import { FeedbackHistory, feedbackTimestamp, shouldPaintStatusFeedback, STATUS_FEEDBACK_INTERVAL_MS } from "../src/feedback";

test("设备反馈使用设备本地日期和时间，重复相邻消息合并为 +N", () => {
  const history = new FeedbackHistory();
  const first = new Date(2026, 8, 27, 9, 8, 7).getTime();
  assert.equal(feedbackTimestamp(first), "2026-09-27 09:08:07");
  assert.equal(history.add("收到设备状态通知。", first), false);
  for (let n = 1; n <= 3; n++) {
    assert.equal(history.add("收到设备状态通知。", first + n * 1000), true);
    assert.equal(history.toText(), `[${feedbackTimestamp(first + n * 1000)}] 收到设备状态通知。 +${n}`);
  }
  assert.equal(history.size, 1);
  assert.equal(history.add("未连接充电桩", first + 4000), false);
  assert.equal(history.add("收到设备状态通知。", first + 5000), false);
  assert.equal(history.size, 3);
});

test("设备反馈只保留最近 100 条，清空不保留旧计数", () => {
  const history = new FeedbackHistory();
  for (let n = 0; n < 102; n++) history.add(`事件 ${n}`, n);
  assert.equal(history.size, 100);
  assert.equal(history.toText().includes("事件 0\n"), false);
  assert.equal(history.toText().includes("事件 1\n"), false);
  assert.ok(history.toText().includes("事件 2\n"));
  assert.ok(history.toText().endsWith("事件 101"));
  history.clear();
  assert.equal(history.size, 0);
  assert.equal(history.add("事件 101", 103), false);
  assert.equal(history.toText().includes("+1"), false);
});

test("重复状态通知计数最多每 30 秒重绘一次，首条和时间回拨立即显示", () => {
  const first = 1_000_000;
  assert.equal(STATUS_FEEDBACK_INTERVAL_MS, 30_000);
  assert.equal(shouldPaintStatusFeedback(false, first + 1, first), true);
  assert.equal(shouldPaintStatusFeedback(true, first + STATUS_FEEDBACK_INTERVAL_MS - 1, first), false);
  assert.equal(shouldPaintStatusFeedback(true, first + STATUS_FEEDBACK_INTERVAL_MS, first), true);
  assert.equal(shouldPaintStatusFeedback(true, first - 1, first), true);
});
