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

test("旧浏览器本地充电记录迁移时删除，只保留已确认的预约记录", () => {
  const storage = memory();
  storage.setItem("wattsaving-local-history-v1", JSON.stringify({ charges: [{ id: "old", deviceId: "charge-device" }],
    reservations: [{ id: "reservation", deviceId: "test-device", submittedAt: 1000, startsAt: 5000000,
      end: "自动充满", state: "accepted", updatedAt: 1000 }] }));
  const restored = new LocalHistory(storage);
  assert.equal(restored.latestDeviceId(), "test-device");
  assert.equal(restored.reservations("test-device").length, 1);
  const saved = JSON.parse(storage.getItem("wattsaving-local-history-v1")!);
  assert.equal("charges" in saved, false);
  restored.trackStatus("charge-device", status("4"), 2000);
  assert.equal(storage.getItem("wattsaving-local-history-v1")?.includes("charge-device"), false);
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
