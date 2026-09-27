import { test } from "node:test";
import assert from "node:assert/strict";
import { ChargerClient, reservationBlockReason, type BleAdapter, type BleCharacteristic, type BleDevice, type BleServer } from "../src/ble";
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
test("同一页面断线后点击恢复直接复用设备对象，无需选择器或 getDevices", async () => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
  const device = new FakeDevice("private-device-id");
  let chooserCalls = 0;
  const client = new ChargerClient({ requestDevice: async () => { chooserCalls++; return device; } }, () => {});
  await client.chooseDevice(2);
  client.disconnect();
  assert.equal(await client.restore(), true);
  assert.equal(chooserCalls, 1);
  assert.equal(client.currentDevice, device);
  client.forgetDevice();
  assert.equal(await client.restore(), false);
});
test("FFE0/FFE5 返回短码特征时保持连接，提示输入验证码且授权前不写入", async () => {
  for (const [notifyUuid, writeUuid] of [["ffe4", "ffe9"], ["0000ffe4", "0000ffe9"]]) {
    (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
    const device = new FakeDevice("private-device-id");
    Object.defineProperty(device.notifier, "uuid", { value: notifyUuid });
    Object.defineProperty(device.writer, "uuid", { value: writeUuid });
    device.gatt.getPrimaryService = async uuid => {
      if (uuid.startsWith("0000ffe0")) return { getCharacteristics: async () => [device.notifier] as unknown as BleCharacteristic[] };
      if (uuid.startsWith("0000ffe5")) return { getCharacteristics: async () => [device.writer] as unknown as BleCharacteristic[] };
      throw new Error("service discovery rejected");
    };
    const events: string[] = [];
    const log = new Diagnostics(null);
    const client = new ChargerClient({ requestDevice: async () => device }, event => events.push(event.type), () => true,
      (event, data, level) => log.add(event, data, level));
    await client.chooseDevice();
    await tick();
    assert.equal(device.gatt.connected, true);
    assert.equal(client.currentProtocol, 2);
    assert.ok(events.includes("auth-needed"));
    assert.equal(client.authorized, false);
    assert.equal(device.writer.sent.length, 0);
    assert.ok(log.recent.some(entry => entry.event === "service-query-start" && entry.data.service === "ff00"));
    assert.ok(log.recent.some(entry => entry.event === "service-unavailable" && entry.data.service === "ff00"));
    assert.ok(log.recent.some(entry => entry.event === "characteristics-query-start" && entry.data.service === "ffe0"));
    assert.ok(log.recent.some(entry => entry.event === "characteristics-query-start" && entry.data.service === "ffe5"));
    assert.ok(log.recent.some(entry => entry.event === "discovery-summary" && entry.data.notify === true && entry.data.write === true));
    const discovered = log.recent.filter(entry => entry.event === "characteristic-discovered");
    const selections = log.recent.filter(entry => entry.event === "characteristic-selection");
    const form = notifyUuid.length === 4 ? "short16" : "short32";
    assert.ok(discovered.some(entry => entry.data.uuid === "ffe4" && entry.data.uuidForm === form));
    assert.ok(discovered.some(entry => entry.data.uuid === "ffe9" && entry.data.uuidForm === form));
    assert.ok(selections.some(entry => entry.data.uuid === "ffe4" && entry.data.notifyUuidMatch === true && entry.data.notifyProperty === true && entry.data.selectedNotify === true));
    assert.ok(selections.some(entry => entry.data.uuid === "ffe9" && entry.data.writeUuidMatch === true && entry.data.writeProperty === true && entry.data.selectedWrite === true));
    assert.ok(log.recent.some(entry => entry.event === "auth-gate" && entry.data.stage === "await-password-input"));
    assert.equal(log.recent.some(entry => entry.event === "gatt-connect-error" || entry.event === "disconnect" || entry.event === "auth-request" || entry.event === "tx-attempt"), false);
    await client.login("12345", false);
    assert.equal(client.authorized, true);
    assert.ok(log.recent.some(entry => entry.event === "auth-request"));
    const output = log.exportText({ secureContext: true, webBluetooth: true, getDevices: false, scheme: "https" });
    assert.equal(output.includes("12345"), false);
    assert.equal(output.includes(device.id), false);
    client.disconnect();
    assert.ok(log.recent.some(entry => entry.event === "disconnect" && entry.data.reason === "user" && entry.data.initiatedBy === "page" && entry.data.connected === true));
    assert.ok(log.recent.some(entry => entry.event === "gatt-disconnect-call" && entry.data.reason === "user"));
    assert.ok(log.recent.some(entry => entry.event === "gatt-disconnect-result" && entry.data.connected === false));
  }
});
test("断线及重连时移除旧通知监听，避免累积回调", async () => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
  const device = new FakeDevice("private-device-id");
  const add = device.notifier.addEventListener.bind(device.notifier);
  const remove = device.notifier.removeEventListener.bind(device.notifier);
  let added = 0, removed = 0;
  device.notifier.addEventListener = (type, listener, options) => {
    if (type === "characteristicvaluechanged") added++;
    add(type, listener, options);
  };
  device.notifier.removeEventListener = (type, listener, options) => {
    if (type === "characteristicvaluechanged") removed++;
    remove(type, listener, options);
  };
  const client = new ChargerClient({ requestDevice: async () => device }, () => {});
  await client.chooseDevice(2);
  client.disconnect();
  await client.chooseDevice(2);
  client.disconnect();
  assert.equal(added, 2);
  assert.equal(removed, 2);
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
  assert.deepEqual(log.recent.filter(entry => entry.event === "status-transition").map(entry => entry.data.toState), ["2", "4"]);
  client.disconnect();
  const pageDisconnect = log.recent.find(entry => entry.event === "disconnect" && entry.data.reason === "user");
  assert.equal(pageDisconnect?.data.lastState, "4");
  assert.equal(pageDisconnect?.data.phase, "ready");
  assert.equal(pageDisconnect?.data.page, "unavailable");
  assert.equal(typeof pageDisconnect?.data.statusAgeMs, "number");
  assert.equal(log.recent.some(entry => entry.event === "unexpected-disconnect"), false);
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
  assert.ok(entries.some(entry => entry.event === "service-query-finish" && entry.data.service === "ff00" && entry.data.outcome === "missing" && typeof entry.data.durationMs === "number"));
  assert.ok(entries.some(entry => entry.event === "characteristics-query-finish" && entry.data.service === "ffe5" && entry.data.outcome === "found"));
  assert.ok(entries.some(entry => entry.event === "discovery-missing" && entry.data.notify === false && entry.data.write === false));
  const errorAt = entries.findIndex(entry => entry.event === "gatt-connect-error" && entry.data.stage === "characteristics-ffe5");
  const disconnectAt = entries.findIndex(entry => entry.event === "disconnect" && entry.data.reason === "connect-error" && entry.data.initiatedBy === "page" && entry.data.connected === true);
  const callAt = entries.findIndex(entry => entry.event === "gatt-disconnect-call" && entry.data.reason === "connect-error");
  assert.ok(errorAt >= 0 && disconnectAt > errorAt && callAt > disconnectAt);
  assert.equal(entries.some(entry => entry.event === "unexpected-disconnect"), false);
  assert.ok(entries.some(entry => entry.event === "gatt-disconnect-result" && entry.data.connected === false));
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
test("GATT 建连前失败记录来源、阶段和安全错误类别，不导出设备资料", async () => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
  const device = new FakeDevice("private-device-id");
  device.gatt.connect = async () => { throw new DOMException("Bluetooth powered off private-device-id", "NetworkError"); };
  const log = new Diagnostics(null);
  const client = new ChargerClient({ requestDevice: async () => device }, () => {}, () => true,
    (event, data, level) => log.add(event, data, level));
  await assert.rejects(client.chooseDevice(), /powered off/);
  assert.ok(log.recent.some(entry => entry.event === "gatt-connect-start" && entry.data.attempt === 1 && entry.data.source === "chooser" && entry.data.lastState === "unavailable"));
  assert.ok(log.recent.some(entry => entry.event === "gatt-connect-error" && entry.data.stage === "gatt" && entry.data.kind === "NetworkError" && entry.data.reason === "bluetooth-off" && typeof entry.data.elapsedMs === "number"));
  assert.ok(log.recent.some(entry => entry.event === "disconnect" && entry.data.reason === "connect-error" && entry.data.connected === false && entry.data.lastState === "unavailable"));
  assert.equal(log.recent.some(entry => entry.event === "gatt-disconnect-call"), false);
  const output = log.exportText({ secureContext: true, webBluetooth: true, getDevices: false, scheme: "https" });
  for (const secret of [device.id, device.name, "Bluetooth powered off private-device-id"]) assert.equal(output.includes(secret), false);
});
test("查询服务时断线会中止扫描，不再误报后续服务或特征缺失", async () => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
  const device = new FakeDevice("private-device-id");
  let rejectService: (error: Error) => void = () => { throw new Error("服务查询尚未开始"); };
  let queries = 0;
  device.gatt.getPrimaryService = async () => { queries++; return new Promise((_, reject) => { rejectService = reject; }); };
  const log = new Diagnostics(null);
  const client = new ChargerClient({ requestDevice: async () => device }, () => {}, () => true,
    (event, data, level) => log.add(event, data, level));
  const pending = client.chooseDevice(2);
  await tick();
  assert.equal(queries, 1);
  device.gatt.connected = false;
  device.dispatchEvent(new Event("gattserverdisconnected"));
  rejectService(new Error("private-device-id service error"));
  await assert.rejects(pending, /连接在服务发现期间已中止/);
  assert.equal(queries, 1);
  assert.ok(log.recent.some(entry => entry.event === "gatt-connect-start" && entry.data.attempt === 1 && entry.data.source === "chooser" && entry.data.lastState === "unavailable" && entry.data.page === "unavailable"));
  assert.ok(log.recent.some(entry => entry.event === "service-query-finish" && entry.data.service === "ff00" && entry.data.outcome === "interrupted" && typeof entry.data.durationMs === "number"));
  assert.ok(log.recent.some(entry => entry.event === "unexpected-disconnect" && entry.data.stage === "service-ff00" && entry.data.connected === false && entry.data.lastState === "unavailable" && entry.data.statusAgeMs === null && typeof entry.data.afterConnectedMs === "number" && typeof entry.data.stageMs === "number"));
  assert.ok(log.recent.some(entry => entry.event === "disconnect-rx-summary" && entry.data.attempt === 1));
  assert.ok(log.recent.some(entry => entry.event === "disconnect" && entry.data.reason === "gatt-event" && entry.data.initiatedBy === "gatt-event" && entry.data.page === "unavailable"));
  assert.equal(log.recent.some(entry => entry.event === "gatt-disconnect-call"), false);
  assert.ok(log.recent.some(entry => entry.event === "discovery-interrupted" && entry.data.stage === "service-ff00" && entry.data.cause === "gatt-disconnected"));
  assert.ok(log.recent.some(entry => entry.event === "gatt-connect-error" && entry.data.reason === "connection-interrupted" && entry.data.attempt === 1 && typeof entry.data.elapsedMs === "number"));
  assert.equal(log.recent.some(entry => entry.event === "service-unavailable" || entry.event === "characteristics"), false);
  assert.equal(client.currentDevice, null);
  assert.equal(log.exportText({ secureContext: true, webBluetooth: true, getDevices: false, scheme: "https" }).includes(device.id), false);
});
test("充电状态下断线和本页重连失败只记录上次状态及耗时，不泄露设备资料", async () => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
  const device = new FakeDevice("private-charging-device-id");
  const log = new Diagnostics(null);
  const client = new ChargerClient({ requestDevice: async () => device }, () => {}, () => true,
    (event, data, level) => log.add(event, data, level));
  await client.chooseDevice(2);
  await client.login("54321", false); await tick();
  await client.control("start");
  assert.equal(client.currentStatus?.state, "4");
  device.writer.writeValueWithResponse = async () => {};
  const pendingStop = client.control("stop");
  device.gatt.connected = false;
  device.dispatchEvent(new Event("gattserverdisconnected"));
  await assert.rejects(pendingStop, /结果未知/);
  const disconnect = log.recent.find(entry => entry.event === "unexpected-disconnect");
  assert.equal(disconnect?.data.phase, "ready");
  assert.equal(disconnect?.data.lastState, "4");
  assert.equal(disconnect?.data.pendingControl, true);
  assert.equal(typeof disconnect?.data.statusAgeMs, "number");
  assert.ok(log.recent.some(entry => entry.event === "disconnect-rx-summary" && Number(entry.data.statuses) >= 2));
  let rejectService: (error: Error) => void = () => { throw new Error("服务查询尚未开始"); };
  device.gatt.getPrimaryService = async () => new Promise((_, reject) => { rejectService = reject; });
  const retry = client.restore();
  await tick();
  device.gatt.connected = false;
  device.dispatchEvent(new Event("gattserverdisconnected"));
  rejectService(new Error("private-charging-device-id service failed"));
  assert.equal(await retry, false);
  assert.ok(log.recent.some(entry => entry.event === "gatt-connect-start" && entry.data.attempt === 2 && entry.data.source === "current-page" && entry.data.lastState === "4" && typeof entry.data.statusAgeMs === "number"));
  assert.ok(log.recent.some(entry => entry.event === "service-query-finish" && entry.data.attempt === 2 && entry.data.outcome === "interrupted"));
  assert.ok(log.recent.some(entry => entry.event === "gatt-connect-error" && entry.data.attempt === 2 && entry.data.stage === "service-ff00"));
  const output = log.exportText({ secureContext: true, webBluetooth: true, getDevices: false, scheme: "https" });
  for (const secret of [device.id, device.name, "54321", "@%PD-100"]) assert.equal(output.includes(secret), false);
});
test("查询特征等待期间断线，即使服务返回结果也不启动通知或误判特征", async () => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
  const device = new FakeDevice("private-device-id");
  let resolveCharacteristics: (items: BleCharacteristic[]) => void = () => { throw new Error("特征查询尚未开始"); };
  device.gatt.getPrimaryService = async () => ({
    getCharacteristics: () => new Promise<BleCharacteristic[]>(resolve => { resolveCharacteristics = resolve; })
  });
  const log = new Diagnostics(null);
  const client = new ChargerClient({ requestDevice: async () => device }, () => {}, () => true,
    (event, data, level) => log.add(event, data, level));
  const pending = client.chooseDevice(2);
  await tick();
  device.gatt.connected = false;
  device.dispatchEvent(new Event("gattserverdisconnected"));
  resolveCharacteristics([device.notifier, device.writer] as unknown as BleCharacteristic[]);
  await assert.rejects(pending, /连接在服务发现期间已中止/);
  assert.ok(log.recent.some(entry => entry.event === "discovery-interrupted" && entry.data.operation === "get-characteristics"));
  assert.equal(log.recent.some(entry => entry.event === "service-characteristics" || entry.event === "notifications-start"), false);
  assert.equal(device.writer.sent.length, 0);
});
test("服务均读取失败时保留失败分类，不声称设备没有特征", async () => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
  const device = new FakeDevice("private-device-id");
  device.gatt.getPrimaryService = async () => { throw new DOMException("permission denied", "SecurityError"); };
  const log = new Diagnostics(null);
  const client = new ChargerClient({ requestDevice: async () => device }, () => {}, () => true,
    (event, data, level) => log.add(event, data, level));
  await assert.rejects(client.chooseDevice(2), /无法读取旧应用使用的 BLE 服务/);
  assert.ok(log.recent.some(entry => entry.event === "discovery-summary" && entry.data.servicesFound === 0 && entry.data.failedServices === 3));
  assert.equal(log.recent.filter(entry => entry.event === "service-unavailable" && entry.data.reason === "permission").length, 3);
  assert.equal(log.recent.some(entry => entry.event === "unexpected-disconnect"), false);
});
test("通知和写入特征只从旧源码对应的服务选用", async () => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
  const device = new FakeDevice("private-device-id");
  device.gatt.getPrimaryService = async uuid => {
    if (uuid.startsWith("0000ffe0")) return { getCharacteristics: async () => [device.notifier, device.writer] as unknown as BleCharacteristic[] };
    throw new DOMException("service missing", "NotFoundError");
  };
  const log = new Diagnostics(null);
  const client = new ChargerClient({ requestDevice: async () => device }, () => {}, () => true,
    (event, data, level) => log.add(event, data, level));
  await assert.rejects(client.chooseDevice(2), /找不到旧应用使用的通知\/写入特征/);
  const writer = log.recent.find(entry => entry.event === "characteristic-discovered" && entry.data.uuid === "ff02");
  assert.equal(writer?.data.writeServiceAllowed, false);
  assert.ok(log.recent.some(entry => entry.event === "discovery-summary" && entry.data.notify === true && entry.data.write === false));
  assert.equal(device.writer.sent.length, 0);
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
  device.notifier.push(stateFrame("5", "2", "0"));
  assert.throws(() => client.submitReservation(reservation), /充电准备状态/);
  device.notifier.push(stateFrame("2", "2", "0"));
  assert.equal(reservationBlockReason(client.currentStatus!), null);
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
  assert.ok(output.includes("reservation-gate"));
});
test("重复未识别通知仅保留计数摘要，不冲掉连接与授权诊断", async () => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
  const device = new FakeDevice("private-device-id");
  const log = new Diagnostics(null);
  const client = new ChargerClient({ requestDevice: async () => device }, () => {}, () => true,
    (event, data, level) => log.add(event, data, level));
  await client.chooseDevice(2);
  for (let i = 0; i < 128; i++) device.notifier.push("@%DP-999-0-181-1-@");
  const unknown = log.recent.filter(entry => entry.event === "rx-unknown-summary");
  assert.ok(unknown.length < 15);
  assert.ok(unknown.some(entry => entry.data.count === 128));
  assert.ok(log.recent.some(entry => entry.event === "rx-notification" && entry.data.notifications === 128));
  client.disconnect();
});
