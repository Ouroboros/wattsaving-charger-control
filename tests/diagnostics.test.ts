import { test } from "node:test";
import assert from "node:assert/strict";
import { Diagnostics, diagnosticError, type DiagnosticEnvironment } from "../src/diagnostics";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}
const environment: DiagnosticEnvironment = { secureContext: true, webBluetooth: true, getDevices: false, scheme: "https" };
test("诊断 v4 只输出有限错误类别与原因，不导出错误原文或报文字段", () => {
  const diagnostic = new Diagnostics(null);
  const error = new Error("Permission denied for private-device-id, code 54321");
  error.name = "private-device-name";
  assert.deepEqual(diagnosticError(error), { kind: "other", reason: "permission" });
  diagnostic.add("error", { ...diagnosticError(error), rawFrame: "private-raw-payload", message: "private-error-message" }, "error");
  assert.deepEqual(diagnosticError(new Error("Characteristic missing")), { kind: "Error", reason: "not-found" });
  assert.deepEqual(diagnosticError(new DOMException("User cancelled", "NotFoundError")), { kind: "NotFoundError", reason: "cancelled" });
  assert.deepEqual(diagnosticError(new Error("MTU exceeded")), { kind: "Error", reason: "size-or-mtu" });
  const interrupted = new Error("private-device-id"); interrupted.name = "ConnectionInterruptedError";
  assert.deepEqual(diagnosticError(interrupted), { kind: "ConnectionInterruptedError", reason: "connection-interrupted" });
  const text = diagnostic.exportText(environment);
  assert.match(text, /diagnostics v4/);
  for (const secret of ["private-device-id", "private-device-name", "54321", "private-raw-payload", "private-error-message"]) assert.equal(text.includes(secret), false);
  assert.match(text, /\[REDACTED\]/);
});
test("日志导出和恢复时隐藏验证码、设备标识、名称、原始授权帧及本地信息", () => {
  const store = new MemoryStorage();
  const diagnostics = new Diagnostics(store);
  diagnostics.hide("私人充电桩");
  diagnostics.add("auth-request", { password: "12345", deviceId: "opaque-id-001", deviceName: "私人充电桩", remember: true });
  diagnostics.add("ble-error", { details: "私人充电桩 @%PD-100-0-181-12345-@ 80100000123450000060 a@b.example /mnt/d/secrets/file.txt 11:22:33:44:55:66" }, "error");
  diagnostics.add("ble-error", { details: "@%PD-114-0-181-2026-09-28-00-00-@" }, "error");
  const exported = diagnostics.exportText(environment);
  for (const secret of ["12345", "opaque-id-001", "私人充电桩", "@%PD", "80100000", "a@b.example", "/mnt/d/secrets", "11:22:33:44:55:66"]) {
    assert.equal(exported.includes(secret), false, `不得导出 ${secret}`);
  }
  assert.match(exported, /auth-request/);
  assert.match(exported, /\[REDACTED\]/);
  const restored = new Diagnostics(store);
  assert.equal(restored.exportText(environment).includes("12345"), false);
  restored.clear();
  assert.equal(new Diagnostics(store).recent.length, 0);
});
test("日志条数和保存长度有界；浏览器禁用存储时仍可复制内存日志", () => {
  const failed = { getItem: (): string | null => { throw new Error("blocked"); }, setItem: (): void => { throw new Error("blocked"); }, removeItem: (): void => { throw new Error("blocked"); } };
  const diagnostics = new Diagnostics(failed);
  for (let i = 0; i < 250; i++) diagnostics.add("event", { index: i, details: "x".repeat(500) });
  assert.equal(diagnostics.storageAvailable, false);
  assert.ok(diagnostics.recent.length <= 160);
  assert.ok(JSON.stringify(diagnostics.recent).length <= 32000);
  assert.match(diagnostics.exportText(environment), /localPersistence: unavailable/);
  diagnostics.clear();
  assert.equal(diagnostics.recent.length, 0);
});
test("对已有存储的字段重新脱敏，不信任本地持久化内容", () => {
  const store = new MemoryStorage();
  store.setItem("wattsaving-diagnostics-v1", JSON.stringify([{ at: "2026-01-01T00:00:00.000Z", level: "info", event: "connect", data: { deviceId: "private-id", password: "54321", detail: "54321" } }]));
  const text = new Diagnostics(store).exportText(environment);
  assert.equal(text.includes("private-id"), false);
  assert.equal(text.includes("54321"), false);
});
