import { test } from "node:test";
import assert from "node:assert/strict";
import { countdownTo } from "../src/countdown";

test("预约倒计时按秒显示 HH:MM:SS，页面暂停后按当前时间重新计算", () => {
  const acceptedStart = new Date(2026, 8, 28, 0, 0).getTime();
  assert.equal(countdownTo(acceptedStart, acceptedStart - 24 * 3600000), "24:00:00");
  assert.equal(countdownTo(acceptedStart, acceptedStart - 3661000), "01:01:01");
  assert.equal(countdownTo(acceptedStart, acceptedStart - 1500), "00:00:02");
  assert.equal(countdownTo(acceptedStart, acceptedStart - 1000), "00:00:01");
  assert.equal(countdownTo(acceptedStart, acceptedStart - 1), "00:00:01");
  assert.equal(countdownTo(acceptedStart, acceptedStart), "00:00:00");
  assert.equal(countdownTo(acceptedStart, acceptedStart + 90000), "00:00:00");
  assert.throws(() => countdownTo(Number.NaN));
});
