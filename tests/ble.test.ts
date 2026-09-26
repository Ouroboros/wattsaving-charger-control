import { test } from "node:test";
import assert from "node:assert/strict";
import { ChargerClient, type BleAdapter, type BleCharacteristic, type BleDevice, type BleServer } from "../src/ble";

class MemoryStorage {
  private values = new Map<string,string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}
const authOk = "@%DP-101-0-181-1-@";
const authBad = "@%DP-101-0-181-0-@";
const stateFrame = (state: string): string => `@%DP-107-0-181-68-32-26-${state}-0-1-2-1200-230-23-0-0-0-@`;
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
  constructor(private readonly notifier: FakeNotifier) { super(); }
  async writeValueWithResponse(data: BufferSource): Promise<void> {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const frame = String.fromCharCode(...bytes);
    this.sent.push(frame);
    if (frame.startsWith("@%PD-100")) queueMicrotask(() => this.notifier.push(this.authAccept ? authOk : authBad));
    if (frame.startsWith("@%PD-204")) queueMicrotask(() => this.notifier.push(stateFrame("2")));
    if (frame.startsWith("@%PD-102")) queueMicrotask(() => { this.notifier.push("@%DP-103-0-181-1-@"); this.notifier.push(stateFrame("4")); });
    if (frame.startsWith("@%PD-104")) queueMicrotask(() => { this.notifier.push("@%DP-105-0-181-1-@"); this.notifier.push(stateFrame("2")); });
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
test("密码不会发给另一台设备；设备拒绝缓存密码则删除并要求重新输入", async () => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
  const first = new FakeDevice("A"), other = new FakeDevice("B");
  const adapter: BleAdapter = { requestDevice: async () => first, getDevices: async () => [first] };
  const client = new ChargerClient(adapter, () => {});
  await client.chooseDevice(2);
  await client.login("54321", true); await tick(); client.disconnect();
  const otherClient = new ChargerClient({ requestDevice: async () => other }, () => {});
  await otherClient.chooseDevice(2); await tick();
  assert.equal(other.writer.sent.length, 0);
  otherClient.disconnect();
  first.writer.authAccept = false;
  const events: string[] = [];
  const restored = new ChargerClient(adapter, event => events.push(event.type));
  await restored.restore(); await tick();
  assert.equal(restored.authorized, false);
  assert.ok(events.includes("auth-needed"));
  restored.disconnect();
  const again = new ChargerClient(adapter, () => {});
  await again.restore(); await tick();
  assert.equal(first.writer.sent.filter(frame => frame.includes("54321")).length, 2);
  again.disconnect();
});
test("切换回模拟模式时，不继续连接或发送任何真实蓝牙指令", async () => {
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
