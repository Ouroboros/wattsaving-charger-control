import { test } from "node:test";
import assert from "node:assert/strict";
import { checksum, command, FrameDecoder, nextMidnight, parseLocalMinute, parseNew, parseOld, reservationCommand, syncClock, validateReservation } from "../src/protocol";

const withCheck = (body: string): string => body + checksum(body);
function oldStatus(): string {
  const first = [..."0".repeat(19)], second = [..."0".repeat(19)];
  first[0] = second[0] = "8"; first[1] = second[1] = "8";
  first[2] = "1"; second[2] = "2"; first[3] = "1"; second[3] = "2";
  for (const [offset, value] of [[4,"030"],[8,"068"],[11,"0032"],[15,"026"]] as const) first.splice(offset, value.length, ...value);
  for (const [offset, value] of [[7,"2"],[8,"0120"],[12,"023"],[15,"230"]] as const) second.splice(offset, value.length, ...value);
  first[18] = second[18] = "6";
  return withCheck(first.join("")) + withCheck(second.join(""));
}
test("两套授权/充停命令只接受五位验证码", () => {
  assert.equal(command(2, "auth", "12345"), "@%PD-100-0-181-12345-@");
  assert.equal(command(1, "auth", "12345"), withCheck("8010000012345000006"));
  assert.equal(command(1, "start"), "80116000000000000062");
  assert.equal(command(2, "stop"), "@%PD-104-0-181-@");
  assert.throws(() => command(1, "auth", "1234"));
});
test("同步时钟帧仅供设备状态同步，不计算预约时间", () => {
  const date = new Date(2024, 0, 2, 3, 4, 5);
  assert.equal(syncClock(2, date), "@%PD-204-0-181-2024-01-02-03-04-05-@");
  assert.equal(syncClock(1, date), withCheck("8212024010203040506"));
});
test("新版设备确认、拒绝和状态字段", () => {
  assert.deepEqual(parseNew("@%DP-101-0-181-1-@"), { type:"auth", protocol:2, ok:true, code:"1" });
  assert.deepEqual(parseNew("@%DP-103-0-181-0-@"), { type:"ack", protocol:2, action:"start", ok:false, code:"0" });
  const s = parseNew("@%DP-107-0-181-68-32-26-2-0-1-2-1200-230-23-0-0-0-@");
  assert.equal(s?.type, "status");
  if (s?.type === "status") { assert.equal(s.soc, 68); assert.equal(s.energyKWh, 3.2); assert.equal(s.state, "2"); assert.equal(s.currentA, 2.3); }
});
test("旧版 40 位分片状态仅在两个校验位有效时解析", () => {
  const frame = oldStatus();
  assert.equal(frame.length, 40);
  const s = parseOld(frame);
  assert.equal(s?.type, "status");
  if (s?.type === "status") { assert.equal(s.soc, 68); assert.equal(s.energyKWh, 3.2); assert.equal(s.state, "2"); }
  assert.equal(parseOld(frame.slice(0, 19) + "9" + frame.slice(20)), null);
  const decoder = new FrameDecoder();
  assert.deepEqual(decoder.feed(frame.slice(0, 20)), []);
  assert.equal(decoder.feed(frame.slice(20))[0]?.type, "status");
});
test("新版通知跨分片及连续帧不会重复解码", () => {
  const decoder = new FrameDecoder();
  assert.deepEqual(decoder.feed("@%DP-101-0"), []);
  const frames = decoder.feed("-181-1-@@%DP-105-0-181-1-@");
  assert.deepEqual(frames.map(frame => frame.type), ["auth", "ack"]);
  assert.deepEqual(decoder.feed(""), []);
});
function oldReservationReply(action: "submit" | "cancel", ok: boolean): string {
  const first = [..."0".repeat(19)], second = [..."0".repeat(19)];
  first[0] = second[0] = first[1] = second[1] = "8";
  first[3] = second[3] = action === "submit" ? "2" : "3";
  first[5] = second[5] = action === "submit" ? ok ? "5" : "6" : ok ? "7" : "8";
  first[18] = second[18] = "6";
  return withCheck(first.join("")) + withCheck(second.join(""));
}
test("跨年日期与预约开始时间默认次日 00:00；新旧预约帧对齐原小程序", () => {
  const now = new Date(2026, 8, 27, 21, 35, 7);
  const reservation = { start: nextMidnight(now), end: { kind: "full" as const } };
  assert.equal(reservation.start.getHours(), 0);
  assert.equal(reservation.start.getDate(), 28);
  assert.equal(nextMidnight(new Date(2026, 11, 31, 23)).getFullYear(), 2027);
  assert.equal(nextMidnight(new Date(2026, 11, 31, 23)).getMonth(), 0);
  assert.equal(reservationCommand(2, "submit", reservation, now), "@%PD-114-0-181-2026-09-27-21-35-07-2026-09-28-00-00-00-3-000-0000-100-@");
  assert.equal(reservationCommand(1, "submit", reservation, now), withCheck("8112026092721350706") + withCheck("8122026092800000006") + withCheck("8133000000010000006"));
  assert.equal(reservationCommand(2, "cancel"), "@%PD-116-0-181-@");
  assert.equal(reservationCommand(1, "cancel"), "80176000000000000068");
  assert.equal(reservationCommand(2, "submit", { start: reservation.start, end: { kind: "time", minutes: 180 } }, now).includes("-1-180-0000-100-@"), true);
  assert.equal(reservationCommand(2, "submit", { start: reservation.start, end: { kind: "energy", kWh: 95 } }, now).includes("-2-000-0095-100-@"), true);
});
test("预约时间和结束方式仅允许旧应用可表达的范围", () => {
  const now = new Date(2026, 8, 27, 21);
  const start = nextMidnight(now);
  assert.equal(parseLocalMinute("2026-09-28T00:00").getTime(), start.getTime());
  assert.throws(() => parseLocalMinute("2026-02-30T00:00"));
  assert.throws(() => parseLocalMinute("2026-09-28T24:00"));
  assert.throws(() => validateReservation({ start: now, end: { kind: "full" } }, now));
  assert.throws(() => validateReservation({ start: new Date(now.getTime() + 25 * 3600000), end: { kind: "full" } }, now));
  assert.throws(() => validateReservation({ start, end: { kind: "time", minutes: 30 } }, now));
  assert.throws(() => validateReservation({ start, end: { kind: "energy", kWh: 100 } }, now));
  assert.throws(() => reservationCommand(2, "cancel", { start, end: { kind: "full" } }, now));
});
test("旧版校验过的 22/33、新版 115/117 只对匹配回执给出成功或拒绝", () => {
  assert.deepEqual(parseNew("@%DP-115-0-181-1-@"), { type: "reservation", protocol: 2, action: "submit", ok: true, code: "1" });
  assert.deepEqual(parseNew("@%DP-117-0-181-0-@"), { type: "reservation", protocol: 2, action: "cancel", ok: false, code: "0" });
  assert.equal(parseNew("@%DP-115-0-181-2-@")?.type, "unknown");
  assert.deepEqual(parseOld(oldReservationReply("submit", true)), { type: "reservation", protocol: 1, action: "submit", ok: true, code: "55" });
  assert.deepEqual(parseOld(oldReservationReply("cancel", false)), { type: "reservation", protocol: 1, action: "cancel", ok: false, code: "88" });
  const valid = oldReservationReply("cancel", true);
  assert.equal(parseOld(valid.slice(0, 19) + "9" + valid.slice(20)), null);
  const decoder = new FrameDecoder();
  assert.deepEqual(decoder.feed(valid.slice(0, 20)), []);
  assert.equal(decoder.feed(valid.slice(20))[0]?.type, "reservation");
});
