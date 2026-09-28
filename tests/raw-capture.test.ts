import assert from "node:assert/strict";
import test from "node:test";
import { RawCapture } from "../src/raw-capture";

const at = new Date("2026-01-01T00:00:00Z");
const ascii = (value: string): Uint8Array => Uint8Array.from(value, char => char.charCodeAt(0));

test("临时抓包默认关闭，开启后显示完整TX/RX字节，停止与清空不持久化", () => {
  const capture = new RawCapture();
  const auth = ascii("@%PD-100-0-181-12345-@");
  assert.equal(capture.record("TX", auth, at), false);
  assert.equal(capture.count, 0);
  capture.start();
  assert.equal(capture.record("TX", auth, at), true);
  assert.equal(capture.record("RX", Uint8Array.from([0x23, 0x00, 0x54, 0x66]), at), true);
  assert.match(capture.toText(), /TX 写入尝试 · 22 字节/);
  assert.match(capture.toText(), /ASCII: @%PD-100-0-181-12345-@/);
  assert.match(capture.toText(), /HEX: 23 00 54 66/);
  assert.match(capture.toText(), /RX 通知 · 4 字节/);
  capture.stop();
  assert.equal(capture.record("RX", ascii("ignored"), at), false);
  assert.equal(capture.count, 2);
  capture.clear();
  assert.equal(capture.toText(), "");
  capture.start();
  assert.equal(capture.record("RX", ascii("new"), at), true);
  assert.equal(capture.count, 1);
});

test("临时抓包最多保留最近200条；默认不保留缓冲区引用", () => {
  const capture = new RawCapture();
  capture.start();
  const bytes = ascii("first");
  capture.record("RX", bytes, at);
  bytes.fill(0);
  assert.match(capture.toText(), /ASCII: first/);
  for (let i = 0; i < 201; i++) capture.record("RX", ascii(String(i)), at);
  assert.equal(capture.count, 200);
  assert.doesNotMatch(capture.toText(), /ASCII: first/);
  assert.match(capture.toText(), /ASCII: 200/);
});
