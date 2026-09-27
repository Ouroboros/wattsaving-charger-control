import assert from "node:assert/strict";
import test from "node:test";
import { LocalHistory } from "../src/history";
import type { DeviceStatus } from "../src/protocol";

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
};
const status = (state: string, mode = "2"): DeviceStatus => ({
  type: "status", protocol: 2, soc: 50, energyKWh: 1.2, minutes: 18, state,
  remainingMinutes: 20, lock: "1", mode, power: "0000", voltage: "220", currentA: 6,
  gunFlag: "0", selfStartFlag: "0", vinFlag: "0"
});

test("充电记录只记录实际观察；离线结束不伪造时间", () => {
  const storage = memory();
  const first = new LocalHistory(storage);
  first.trackStatus("test-device", status("4"), 1000);
  assert.equal(first.charges("test-device")[0].startedAt, null);
  const restored = new LocalHistory(storage);
  restored.trackStatus("test-device", status("2"), 2000);
  assert.equal(restored.charges("test-device")[0].endedAt, null);
  restored.trackStatus("another-device", status("2"), 3000);
  restored.trackStatus("another-device", status("4"), 4000);
  restored.trackStatus("another-device", status("5"), 5000);
  assert.equal(restored.charges("another-device")[0].endedAt, 5000);
});

test("仅确认的预约持久化；替换和取消保留真实操作状态", () => {
  const storage = memory();
  const history = new LocalHistory(storage);
  history.acceptReservation("test-device", 5000000, { kind: "full" }, 1000);
  assert.equal(new LocalHistory(storage).latestReservation("test-device")?.startsAt, 5000000);
  history.trackStatus("test-device", status("2", "3"), 2000);
  assert.equal(history.latestReservation("test-device")?.state, "observed");
  history.acceptReservation("test-device", 6000000, { kind: "time", minutes: 120 }, 3000);
  assert.equal(history.reservations("test-device")[1].state, "replaced");
  history.cancelReservation("test-device", 4000);
  assert.equal(new LocalHistory(storage).latestReservation("test-device"), undefined);
  history.clear();
  assert.deepEqual(new LocalHistory(storage).reservations("test-device"), []);
});
