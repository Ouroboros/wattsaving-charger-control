import { test } from "node:test";
import assert from "node:assert/strict";
import { ExperimentalDecoder, experimentalGearCommand, experimentalQueryCommand, parseExperimentalFrame } from "../src/experimental";

function packet(op: number, body: number[]): Uint8Array {
  const result = Uint8Array.from([0x23, body.length + 5, op, ...body, 0x66, 0]);
  result[result.length - 1] = result.slice(0, -1).reduce((sum, value) => sum + value, 0) & 0xff;
  return result;
}
const ascii = (s: string): Uint8Array => Uint8Array.from([...s], c => c.charCodeAt(0));

test("四档按 App 11 字节协议计算真实字节校验，不把 kW 误当档位参数", () => {
  for (let gear = 0; gear < 4; gear++) {
    assert.deepEqual([...experimentalGearCommand("00000000", "00", gear)],
      [0x23, 0x0b, 0x32, 0, 0, 0, 0, 0, gear, 0x66, 0xc6 + gear]);
  }
  assert.deepEqual([...experimentalGearCommand("11223344", "05", 2)],
    [0x23, 0x0b, 0x32, 0x11, 0x22, 0x33, 0x44, 0x05, 0x02, 0x66, (0xc6 + 0x11 + 0x22 + 0x33 + 0x44 + 5 + 2) & 0xff]);
  assert.throws(() => experimentalGearCommand("", "00", 0), /桩编码或枪号/);
  assert.throws(() => experimentalGearCommand("00000000", "", 0), /桩编码或枪号/);
  assert.throws(() => experimentalGearCommand("00000000", "00", 22), /0～3/);
});

test("只解析校验、长度与结束符都正确的 82 和 54；功率与档位互不混淆", () => {
  const ack = packet(0x82, [0, 0, 0, 0, 0, 1]);
  assert.deepEqual(parseExperimentalFrame(ack), { type: "gear-reply", code: 1, accepted: true });
  const no = packet(0x82, [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(parseExperimentalFrame(no), { type: "gear-reply", code: 0, accepted: false });
  const body = Array(50).fill(0); body[47] = 0xdc; body[48] = 0x00; body[49] = 2;
  const state = packet(0x54, body);
  assert.deepEqual(parseExperimentalFrame(state), { type: "power-report", powerTenths: 220, gear: 2, pile: "00000000", gun: "00" });
  state[state.length - 1] ^= 1;
  assert.equal(parseExperimentalFrame(state), null);
  const wrongLength = Uint8Array.from(ack); wrongLength[1] = 10;
  assert.equal(parseExperimentalFrame(wrongLength), null);
  const wrongFooter = Uint8Array.from(ack); wrongFooter[9] = 0;
  assert.equal(parseExperimentalFrame(wrongFooter), null);
});

test("APP 25 和 44 查询包含自动取得的设备字段，回报只提取结果、不暴露内容", () => {
  const pile = "11223344", gun = "05";
  assert.deepEqual([...experimentalQueryCommand(pile, gun, "vin-list")],
    [0x23, 0x0a, 0x25, 0x11, 0x22, 0x33, 0x44, 0x05, 0x66, (0xb8 + 0x11 + 0x22 + 0x33 + 0x44 + 5) & 0xff]);
  assert.deepEqual([...experimentalQueryCommand(pile, gun, "network-info")],
    [0x23, 0x0a, 0x44, 0x11, 0x22, 0x33, 0x44, 0x05, 0x66, (0xd7 + 0x11 + 0x22 + 0x33 + 0x44 + 5) & 0xff]);
  assert.throws(() => experimentalQueryCommand("", gun, "vin-list"), /桩编码或枪号/);
  assert.throws(() => experimentalQueryCommand(pile, gun, "unknown" as "vin-list"), /未知/);
  assert.deepEqual(parseExperimentalFrame(packet(0x75, [0x11, 0x22, 0x33, 0x44, 0x05, 1, ...Array(17).fill(0x56)])),
    { type: "vin-list-reply", accepted: true });
  assert.deepEqual(parseExperimentalFrame(packet(0x75, [0x11, 0x22, 0x33, 0x44, 0x05, 0])),
    { type: "vin-list-reply", accepted: false });
  assert.deepEqual(parseExperimentalFrame(packet(0x94, [0x11, 0x22, 0x33, 0x44, 0x05, ...Array(12).fill(0x56)])),
    { type: "network-info-reply" });
});

test("分片较长的 VIN 列表回报也不进入 ASCII 文本通道或暴露条目", () => {
  const decoder = new ExperimentalDecoder();
  const reply = packet(0x75, [0x11, 0x22, 0x33, 0x44, 0x05, 1, ...Array(153).fill(0x56)]);
  assert.ok(reply.length > 128);
  for (let i = 0; i < reply.length - 20; i += 20) {
    const output = decoder.feed(reply.slice(i, Math.min(i + 20, reply.length - 20)));
    assert.deepEqual(output.frames, []);
    assert.equal(output.text.length, 0);
  }
  const tail = decoder.feed(reply.slice(reply.length - 20));
  assert.deepEqual(tail.frames, [{ type: "vin-list-reply", accepted: true }]);
  assert.equal(tail.text.length, 0);
});

test("混合、分片二进制通知不进入 ASCII 解码；现有文本仍原样透传", () => {
  const decoder = new ExperimentalDecoder();
  const report = packet(0x54, [...Array(49).fill(0), 3]);
  const head = ascii("@%DP-103-0-181-1-@");
  let output = decoder.feed(Uint8Array.from([...head, ...report.slice(0, 18)]));
  assert.deepEqual(output.frames, []);
  assert.deepEqual([...output.text], [...head]);
  output = decoder.feed(Uint8Array.from([...report.slice(18), ...ascii("@%DP-105-0-181-1-@")]));
  assert.deepEqual(output.frames, [{ type: "power-report", powerTenths: 0, gear: 3, pile: "00000000", gun: "00" }]);
  assert.equal(String.fromCharCode(...output.text), "@%DP-105-0-181-1-@");
  decoder.reset();
  assert.deepEqual(decoder.feed(ascii("123")).frames, []);
});
