import { test } from "node:test";
import assert from "node:assert/strict";
import { ChargerClient, type BleAdapter, type BleCharacteristic, type BleDevice, type BleServer } from "../src/ble";
import { Diagnostics } from "../src/diagnostics";
import { nextMidnight } from "../src/protocol";

class MemoryStorage {
  private values = new Map<string,string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}
const authOk = "@%DP-101-0-181-1-@";
const authBad = "@%DP-101-0-181-0-@";
const stateFrame = (state: string, mode = "2", lock = "1"): string => `@%DP-107-0-181-68-32-26-${state}-0-${lock}-${mode}-1200-230-23-0-0-0-@`;
class FakeNotifier extends EventTarget {
  readonly uuid = "0000ff01-0000-1000-8000-00805f9b34fb";
  readonly properties = { notify: true };
  value?: DataView;
  async startNotifications(): Promise<BleCharacteristic> {
    queueMicrotask(() => this.push(stateFrame("2")));
    return this as unknown as BleCharacteristic;
  }
  push(frame: string): void {
    const bytes = Uint8Array.from([...frame], ch => ch.charCodeAt(0));
    this.value = new DataView(bytes.buffer);
    this.dispatchEvent(new Event("characteristicvaluechanged"));
  }
}
class FakeWriter extends EventTarget {
  readonly uuid = "0000ff02-0000-1000-8000-00805f9b34fb";
  readonly properties = { write: true };
  readonly sent: string[] = [];
  authAccept = true;
  reservationAccept = true;
  reservationCancelAccept = true;
  reservationCancelStatus = true;
  reservationAck = true;
  constructor(private readonly notifier: FakeNotifier) { super(); }
  async writeValueWithResponse(data: BufferSource): Promise<void> {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const frame = String.fromCharCode(...bytes);
    this.sent.push(frame);
    if (frame.startsWith("@%PD-100")) queueMicrotask(() => this.notifier.push(this.authAccept ? authOk : authBad));
    if (frame.startsWith("@%PD-204")) queueMicrotask(() => this.notifier.push(stateFrame("2")));
    if (frame.startsWith("@%PD-102")) queueMicrotask(() => { this.notifier.push("@%DP-103-0-181-1-@"); this.notifier.push(stateFrame("4")); });
    if (frame.startsWith("@%PD-104")) queueMicrotask(() => { this.notifier.push("@%DP-105-0-181-1-@"); this.notifier.push(stateFrame("2")); });
    if (frame.startsWith("@%PD-114") && this.reservationAck) queueMicrotask(() => {
      this.notifier.push(`@%DP-115-0-181-${this.reservationAccept ? "1" : "0"}-@`);
      if (this.reservationAccept) this.notifier.push(stateFrame("2", "3"));
    });
    if (frame.startsWith("@%PD-116") && this.reservationAck) queueMicrotask(() => {
      this.notifier.push(`@%DP-117-0-181-${this.reservationCancelAccept ? "1" : "0"}-@`);
      if (this.reservationCancelAccept && this.reservationCancelStatus) this.notifier.push(stateFrame("2"));
    });
  }
}
class FakeDevice extends EventTarget implements BleDevice {
  readonly id: string;
  readonly name: string;
  readonly notifier = new FakeNotifier();
  readonly writer = new FakeWriter(this.notifier);
  readonly gatt: BleServer;
  constructor(id: string) {
    super(); this.id = id; this.name = `测试设备-${id}`;
    const service = { getCharacteristics: async () => [this.notifier, this.writer] as unknown as BleCharacteristic[] };
    this.gatt = {
      connected: false,
      connect: async () => { this.gatt.connected = true; return this.gatt; },
      disconnect: () => { this.gatt.connected = false; this.dispatchEvent(new Event("gattserverdisconnected")); },
      getPrimaryService: async uuid => { if (uuid.startsWith("0000ff00")) return service; throw new Error("service missing"); }
    };
  }
}
const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));
test("首次成功授权后按设备保存密码，恢复连接时自动发送并等待设备回执", async () => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
  const device = new FakeDevice("A");
  const adapter: BleAdapter = { requestDevice: async () => device, getDevices: async () => [device] };
  const client = new ChargerClient(adapter, () => {});
  await client.chooseDevice(2);
  assert.equal(client.authorized, false);
  await client.login("12345", true);
  await tick();
  assert.equal(client.authorized, true);
  assert.equal(client.currentStatus?.state, "2");
  assert.equal(device.writer.sent.filter(frame => frame.includes("12345")).length, 1);
  await client.control("start");
  assert.equal(client.currentStatus?.state, "4");
  await client.control("stop");
  assert.equal(client.currentStatus?.state, "2");
  client.disconnect();
  const restored = new ChargerClient(adapter, () => {});
  assert.equal(await restored.restore(), true);
  await tick();
  assert.equal(restored.authorized, true);
  assert.equal(device.writer.sent.filter(frame => frame.includes("12345")).length, 2);
  restored.disconnect();
});
test("GATT 已连接就记住设备；未确认的验证码不保存，下次无需弹选择器", async () => {
  const storage = new MemoryStorage();
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = storage;
  const device = new FakeDevice("private-device-id");
  const client = new ChargerClient({ requestDevice: async () => device }, () => {});
  await client.chooseDevice(2);
  assert.equal(client.rememberedName, device.name);
  const saved = JSON.parse(storage.getItem("wattsaving-ble-devices-v1") ?? "null") as { lastId: string; devices: Record<string, { password?: string }> };
  assert.equal(saved.lastId, device.id);
  assert.equal(saved.devices[device.id]?.password, undefined);
  client.disconnect();
  let chooserCalls = 0;
  const restored = new ChargerClient({
    requestDevice: async () => { chooserCalls++; return device; },
    getDevices: async () => [device]
  }, () => {});
  assert.equal(await restored.restore(), true);
  assert.equal(restored.authorized, false);
  assert.equal(chooserCalls, 0);
  restored.disconnect();
  const log = new Diagnostics(null);
  const empty = new ChargerClient({ requestDevice: async () => device, getDevices: async () => [] }, () => {}, () => true,
    (event, data, level) => log.add(event, data, level));
  assert.equal(await empty.restore(), false);
  assert.ok(log.recent.some(entry => entry.event === "restore-result" && entry.data.candidates === 0 && entry.data.found === false));
});
test("密码不会发给另一台设备；设备拒绝缓存密码则删除并要求重新输入", async () => {
  const storage = new MemoryStorage();
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = storage;
  const first = new FakeDevice("A"), other = new FakeDevice("B");
  const adapter: BleAdapter = { requestDevice: async () => first, getDevices: async () => [first] };
  const client = new ChargerClient(adapter, () => {});
  await client.chooseDevice(2);
  await client.login("54321", true); await tick(); client.disconnect();
  const otherClient = new ChargerClient({ requestDevice: async () => other }, () => {});
  await otherClient.chooseDevice(2); await tick();
  assert.equal(other.writer.sent.length, 0);
  const afterOther = JSON.parse(storage.getItem("wattsaving-ble-devices-v1") ?? "null") as { lastId: string; devices: Record<string, { password?: string }> };
  assert.equal(afterOther.lastId, "B");
  assert.equal(afterOther.devices.A?.password, "54321");
  assert.equal(afterOther.devices.B?.password, undefined);
  otherClient.disconnect();
  first.writer.authAccept = false;
  const events: string[] = [];
  const restored = new ChargerClient(adapter, event => events.push(event.type));
  assert.equal(await restored.restore(), false);
  await restored.chooseDevice(2); await tick();
  assert.equal(restored.authorized, false);
  assert.ok(events.includes("auth-needed"));
  restored.disconnect();
  const again = new ChargerClient(adapter, () => {});
  await again.restore(); await tick();
  assert.equal(first.writer.sent.filter(frame => frame.includes("54321")).length, 2);
  again.disconnect();
});
test("点击后控制入口被禁用时，不继续连接或发送蓝牙指令", async () => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
  const device = new FakeDevice("C");
  let enabled = true;
  const client = new ChargerClient({ requestDevice: async () => device }, () => {}, () => enabled);
  const pending = client.chooseDevice(2);
  enabled = false;
  await pending;
  assert.equal(device.gatt.connected, false);
  assert.equal(device.writer.sent.length, 0);
  assert.equal(client.currentDevice, null);
});
test("真实 BLE 生命周期日志覆盖授权、控制与回执且不输出密码或设备标识", async () => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
  const device = new FakeDevice("private-device-id");
  const log = new Diagnostics(null);
  const client = new ChargerClient({ requestDevice: async () => device }, () => {}, () => true,
    (event, data, level) => log.add(event, data, level));
  await client.chooseDevice(2);
  await client.login("98765", true); await tick();
  await client.control("start");
  client.disconnect();
  const output = log.exportText({ secureContext: true, webBluetooth: true, getDevices: false, scheme: "https" });
  for (const event of ["chooser-open", "gatt-connected", "service-found", "characteristic-methods", "notifications-start", "notifications-started", "protocol-selected", "auth-request", "auth-reply", "auth-saved", "rx-frame", "status", "tx-attempt", "control-request", "control-confirmed", "disconnect"]) assert.ok(output.includes(event), `missing ${event}`);
  assert.ok(log.recent.some(entry => entry.event === "tx-written" && entry.data.method === "with-response"));
  assert.ok(log.recent.some(entry => entry.event === "auth-saved" && entry.data.remembered === true));
  for (const secret of ["98765", "private-device-id", "测试设备", "@%PD-100"]) assert.equal(output.includes(secret), false);
});
test("特征不匹配时记录逐服务 UUID 短码和属性，自定义 UUID 不泄露", async () => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
  const device = new EventTarget() as BleDevice & { id: string; name: string; gatt: BleServer };
  device.id = "private-device-id"; device.name = "private-device-name";
  const characteristic = (uuid: string, properties: object): BleCharacteristic =>
    Object.assign(new EventTarget(), { uuid, properties }) as BleCharacteristic;
  const service0 = { getCharacteristics: async () => [characteristic("0000ffe1-0000-1000-8000-00805f9b34fb", { notify: true })] };
  const customUuid = "c0ffee00-1111-2222-3333-444455556666";
  const service5 = { getCharacteristics: async () => [characteristic("0000ffe2-0000-1000-8000-00805f9b34fb", { write: true }), characteristic(customUuid, { indicate: true, writeWithoutResponse: true })] };
  const gatt: BleServer = {
    connected: false,
    connect: async () => { gatt.connected = true; return gatt; },
    disconnect: () => { gatt.connected = false; device.dispatchEvent(new Event("gattserverdisconnected")); },
    getPrimaryService: async uuid => {
      if (uuid.startsWith("0000ffe0")) return service0;
      if (uuid.startsWith("0000ffe5")) return service5;
      throw new Error("service missing");
    }
  };
  device.gatt = gatt;
  const log = new Diagnostics(null);
  const client = new ChargerClient({ requestDevice: async () => device }, () => {}, () => true,
    (event, data, level) => log.add(event, data, level));
  await assert.rejects(client.chooseDevice(), /找不到旧应用使用的通知\/写入特征/);
  assert.equal(client.rememberedName, device.name);
  let chooserCalls = 0;
  const restored = new ChargerClient({
    requestDevice: async () => { chooserCalls++; return device; },
    getDevices: async () => [device]
  }, () => {});
  assert.equal(await restored.restore(), false);
  assert.equal(chooserCalls, 0);
  const output = log.exportText({ secureContext: true, webBluetooth: true, getDevices: false, scheme: "https" });
  const entries = output.split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line) as { event: string; data: Record<string, unknown> });
  assert.deepEqual(entries.filter(entry => entry.event === "service-characteristics").map(entry => entry.data), [{ service: "ffe0", count: 1 }, { service: "ffe5", count: 2 }]);
  const found = entries.filter(entry => entry.event === "characteristic-discovered").map(entry => entry.data);
  assert.deepEqual(found.map(data => data.uuid), ["ffe1", "ffe2", "custom128"]);
  assert.equal(found[0]?.notify, true);
  assert.equal(found[1]?.write, true);
  assert.equal(found[2]?.indicate, true);
  assert.equal(found[2]?.writeWithoutResponse, true);
  assert.equal(found[2]?.writeResponseMethod, false);
  assert.ok(entries.some(entry => entry.event === "service-unavailable" && entry.data.service === "ff00" && entry.data.reason === "not-found"));
  assert.ok(entries.some(entry => entry.event === "gatt-connect-error" && entry.data.stage === "characteristics-ffe5"));
  for (const secret of [device.id, device.name, customUuid, "@%PD-100"]) assert.equal(output.includes(secret), false);
});
test("选择器拒绝与通知启动失败均记录阶段及安全错误类别", async () => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
  const log = new Diagnostics(null);
  const diagnose = (event: string, data?: Record<string, string | number | boolean | null>, level?: "info" | "warn" | "error") => log.add(event, data, level);
  const cancelled = new DOMException("User cancelled on private-device-id", "NotFoundError");
  const declined = new ChargerClient({ requestDevice: async () => { throw cancelled; } }, () => {}, () => true, diagnose);
  await assert.rejects(declined.chooseDevice(), /User cancelled/);
  const device = new FakeDevice("private-device-id");
  device.notifier.startNotifications = async () => { throw new Error("permission denied for private-device-name 54321"); };
  const client = new ChargerClient({ requestDevice: async () => device }, () => {}, () => true, diagnose);
  await assert.rejects(client.chooseDevice(2), /permission denied/);
  assert.ok(log.recent.some(entry => entry.event === "chooser-error" && entry.data.reason === "cancelled"));
  assert.ok(log.recent.some(entry => entry.event === "notifications-error" && entry.data.reason === "permission"));
  assert.ok(log.recent.some(entry => entry.event === "gatt-connect-error" && entry.data.stage === "notifications"));
  const output = log.exportText({ secureContext: true, webBluetooth: true, getDevices: false, scheme: "https" });
  for (const secret of ["private-device-id", "private-device-name", "54321"]) assert.equal(output.includes(secret), false);
});
test("无法解析的通知与写入超出 MTU 只留下计数、写入方式和错误类别", async () => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
  const device = new FakeDevice("private-device-id");
  const log = new Diagnostics(null);
  const client = new ChargerClient({ requestDevice: async () => device }, () => {}, () => true,
    (event, data, level) => log.add(event, data, level));
  await client.chooseDevice(2);
  device.notifier.push("private-raw-frame-payload");
  device.notifier.push("@%DP-103-0-181-1-@");
  device.notifier.push("@%DP-117-0-181-1-@");
  assert.ok(log.recent.some(entry => entry.event === "control-ack-ignored" && entry.data.reason === "no-pending"));
  assert.ok(log.recent.some(entry => entry.event === "reservation-reply" && entry.data.matched === false));
  device.writer.writeValueWithResponse = async () => { throw new Error("MTU exceeded private-device-id 54321"); };
  await assert.rejects(client.login("54321", false), /发送授权报文失败/);
  assert.ok(log.recent.some(entry => entry.event === "rx-notification" && entry.data.parsed === 0));
  assert.ok(log.recent.some(entry => entry.event === "tx-error" && entry.data.reason === "size-or-mtu" && entry.data.method === "with-response"));
  assert.ok(log.recent.some(entry => entry.event === "auth-unconfirmed" && entry.data.reason === "write-error"));
  const output = log.exportText({ secureContext: true, webBluetooth: true, getDevices: false, scheme: "https" });
  for (const secret of ["private-raw-frame-payload", "private-device-id", "54321"]) assert.equal(output.includes(secret), false);
  client.disconnect();
});
test("服务特征读取失败记录服务代码、错误类别和失败阶段", async () => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
  const device = new FakeDevice("private-device-id");
  device.gatt.getPrimaryService = async uuid => {
    if (uuid.startsWith("0000ff00")) return { getCharacteristics: async () => { throw new DOMException("permission denied private-device-id", "SecurityError"); } };
    throw new DOMException("service missing", "NotFoundError");
  };
  const log = new Diagnostics(null);
  const client = new ChargerClient({ requestDevice: async () => device }, () => {}, () => true,
    (event, data, level) => log.add(event, data, level));
  await assert.rejects(client.chooseDevice(), /permission denied/);
  assert.ok(log.recent.some(entry => entry.event === "characteristics-error" && entry.data.service === "ff00" && entry.data.kind === "SecurityError" && entry.data.reason === "permission"));
  assert.ok(log.recent.some(entry => entry.event === "gatt-connect-error" && entry.data.stage === "characteristics-ff00"));
  assert.equal(log.exportText({ secureContext: true, webBluetooth: true, getDevices: false, scheme: "https" }).includes(device.id), false);
});
test("连续相同状态不会挤掉服务发现阶段的日志", async () => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
  const device = new FakeDevice("private-device-id");
  const log = new Diagnostics(null);
  const client = new ChargerClient({ requestDevice: async () => device }, () => {}, () => true,
    (event, data, level) => log.add(event, data, level));
  await client.chooseDevice(2);
  await client.login("98765", false); await tick();
  for (let i = 0; i < 320; i++) device.notifier.push(stateFrame("2"));
  const statusEntries = log.recent.filter(entry => entry.event === "status");
  assert.ok(statusEntries.length < 20);
  assert.ok(log.recent.some(entry => entry.event === "service-found" && entry.data.service === "ff00"));
  assert.ok(log.recent.some(entry => entry.event === "characteristic-discovered"));
  assert.equal(log.exportText({ secureContext: true, webBluetooth: true, getDevices: false, scheme: "https" }).includes(device.id), false);
  client.disconnect();
});
test("预约和取消需设备匹配回执；拒绝及断线不冒充成功；日志不含原始报文", async () => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
  const device = new FakeDevice("private-reservation-device");
  const log = new Diagnostics(null);
  const events: string[] = [];
  const client = new ChargerClient({ requestDevice: async () => device }, event => events.push(event.type), () => true,
    (event, data, level) => log.add(event, data, level));
  await client.chooseDevice(2);
  await client.login("98765", false); await tick();
  const reservation = { start: nextMidnight(), end: { kind: "full" as const } };
  assert.equal(client.canCancelReservation, false);
  device.notifier.push(stateFrame("2", "3"));
  assert.equal(client.canCancelReservation, true);
  device.notifier.push(stateFrame("2"));
  device.notifier.push(stateFrame("2", "2", "0"));
  assert.throws(() => client.submitReservation(reservation), /上锁/);
  device.notifier.push(stateFrame("2"));
  await client.submitReservation(reservation);
  assert.equal(client.canCancelReservation, true);
  assert.equal(client.currentStatus?.mode, "3");
  device.writer.reservationCancelStatus = false;
  await client.cancelReservation();
  assert.equal(client.canCancelReservation, false);
  assert.equal(client.currentStatus?.mode, "3");
  device.notifier.push(stateFrame("2"));
  assert.equal(client.currentStatus?.mode, "2");
  assert.deepEqual(events.filter(event => event === "reservation"), ["reservation", "reservation"]);
  device.writer.reservationAccept = false;
  await assert.rejects(client.submitReservation(reservation), /拒绝/);
  assert.equal(events.filter(event => event === "reservation").length, 2);
  device.writer.reservationAck = false;
  const pending = client.submitReservation(reservation);
  client.disconnect();
  await assert.rejects(pending, /结果未知/);
  const output = log.exportText({ secureContext: true, webBluetooth: true, getDevices: false, scheme: "https" });
  for (const event of ["reservation-request", "reservation-reply", "reservation-unconfirmed"]) assert.ok(output.includes(event));
  for (const secret of ["98765", "private-reservation-device", "@%PD-114"]) assert.equal(output.includes(secret), false);
});
