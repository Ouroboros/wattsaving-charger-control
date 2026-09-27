import { command, FrameDecoder, reservationCommand, syncClock, type ControlAction, type DeviceStatus, type Frame, type Reservation, type ReservationAction, type Version } from "./protocol";
import { diagnosticError, type DiagnosticLevel, type DiagnosticValue } from "./diagnostics";

// Web Bluetooth 在部分 TypeScript DOM 版本中没有类型定义；只声明本项目使用到的 API。
export interface BleCharacteristic extends EventTarget {
  uuid: string;
  value?: DataView;
  properties: { read?: boolean; notify?: boolean; indicate?: boolean; write?: boolean; writeWithoutResponse?: boolean };
  startNotifications(): Promise<BleCharacteristic>;
  writeValueWithResponse?(data: BufferSource): Promise<void>;
  writeValueWithoutResponse?(data: BufferSource): Promise<void>;
  writeValue?(data: BufferSource): Promise<void>;
}
export interface BleService { getCharacteristics(): Promise<BleCharacteristic[]>; }
export interface BleServer {
  connected: boolean;
  connect(): Promise<BleServer>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<BleService>;
}
export interface BleDevice extends EventTarget { id: string; name?: string; gatt?: BleServer; }
export interface BleAdapter {
  requestDevice(options: { acceptAllDevices: true; optionalServices: string[] }): Promise<BleDevice>;
  getDevices?(): Promise<BleDevice[]>;
}
interface StoredDevice { name: string; password?: string; protocol?: Version; }
interface Vault { lastId: string; devices: Record<string, StoredDevice>; }
type Phase = "offline" | "connecting" | "detecting" | "password" | "authenticating" | "ready";
export type ChargerEvent =
  | { type: "phase"; phase: Phase; message: string }
  | { type: "notice"; message: string }
  | { type: "protocol"; version: Version; source: string }
  | { type: "status"; status: DeviceStatus }
  | { type: "reservation"; action: ReservationAction; message: string }
  | { type: "auth-needed"; message: string };
const KEY = "wattsaving-ble-devices-v1";
const UUID = (short: string): string => `0000${short}-0000-1000-8000-00805f9b34fb`;
const SERVICES = ["ff00", "ffe0", "ffe5"].map(UUID);
const NOTIFY = new Set([UUID("ff01"), UUID("ffe4")]);
const WRITE = new Set([UUID("ff02"), UUID("ffe9")]);
// 标准 Bluetooth UUID 的短码是无损的；不把可能含设备标识的自定义 128 位 UUID 写入日志。
function diagnosticUuid(value: unknown): string {
  if (typeof value !== "string") return "missing";
  const id = value.toLowerCase();
  if (/^[0-9a-f]{4}$/.test(id)) return id;
  const base = /^([0-9a-f]{8})-0000-1000-8000-00805f9b34fb$/.exec(id);
  if (base) return base[1].startsWith("0000") ? base[1].slice(4) : base[1];
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id) ? "custom128" : "unexpected-format";
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function encodeAscii(text: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(text.length));
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}
function decodeAscii(view: DataView): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  let result = "";
  for (const byte of bytes) result += String.fromCharCode(byte);
  return result;
}
export class ChargerClient {
  private readonly adapter: BleAdapter;
  private readonly emit: (event: ChargerEvent) => void;
  private readonly enabled: () => boolean;
  private readonly diagnose: (event: string, data?: Record<string, DiagnosticValue>, level?: DiagnosticLevel) => void;
  private device: BleDevice | null = null;
  private server: BleServer | null = null;
  private writer: BleCharacteristic | null = null;
  private listener: ((event: Event) => void) | null = null;
  private decoder = new FrameDecoder();
  private rxNotifications = 0;
  private rxBytes = 0;
  private decodedFrames = 0;
  private statusFrames = 0;
  private lastStatusSignature = "";
  private epoch = 0;
  private sniffTimer: ReturnType<typeof setTimeout> | null = null;
  private autoLoginTried = false;
  private protocol: Version | null = null;
  private phase: Phase = "offline";
  private latest: DeviceStatus | null = null;
  private latestAt = 0;
  private pendingAuth: { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; password: string; remember: boolean } | null = null;
  private pendingControl: { action: ControlAction; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private pendingReservation: { action: ReservationAction; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private reservationAccepted: boolean | null = null;
  private fallbackVault: Vault = { lastId: "", devices: {} };

  constructor(
    adapter: BleAdapter,
    emit: (event: ChargerEvent) => void,
    enabled: () => boolean = () => true,
    diagnose: (event: string, data?: Record<string, DiagnosticValue>, level?: DiagnosticLevel) => void = () => {}
  ) { this.adapter = adapter; this.emit = emit; this.enabled = enabled; this.diagnose = diagnose; }
  get currentDevice(): BleDevice | null { return this.device; }
  get currentProtocol(): Version | null { return this.protocol; }
  get currentStatus(): DeviceStatus | null { return this.latest; }
  get authorized(): boolean { return this.phase === "ready" && !!this.server?.connected; }
  get reservationPending(): boolean { return !!this.pendingReservation; }
  get canCancelReservation(): boolean { return this.reservationAccepted === null ? this.latest?.mode === "3" : this.reservationAccepted; }
  get rememberedName(): string | null {
    const saved = this.loadVault();
    return saved.devices[saved.lastId]?.name ?? null;
  }
  private loadVault(): Vault {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
      if (parsed && typeof parsed === "object" && "devices" in parsed && "lastId" in parsed) {
        const value = parsed as Vault;
        if (typeof value.lastId === "string" && value.devices && typeof value.devices === "object") return value;
      }
    } catch { /* 私密浏览或本地文件可能禁用存储 */ }
    return this.fallbackVault;
  }
  private storeVault(vault: Vault): boolean {
    this.fallbackVault = vault;
    try { localStorage.setItem(KEY, JSON.stringify(vault)); return true; }
    catch {
      this.diagnose("device-storage-error", { operation: "write" }, "warn");
      this.emit({ type: "notice", message: "浏览器未允许本地存储；本次设备和密码不会在下次打开时保留。" });
      return false;
    }
  }
  private rememberConnectedDevice(device: BleDevice): void {
    if (!device.id) { this.diagnose("device-remember-skipped", { reason: "missing-id" }, "warn"); return; }
    const vault = this.loadVault();
    const previous = vault.devices[device.id];
    vault.lastId = device.id;
    vault.devices[device.id] = { ...previous, name: device.name || previous?.name || "未命名设备" };
    const persisted = this.storeVault(vault);
    this.diagnose("device-remembered", { known: !!previous, persisted });
  }
  forgetPassword(): void {
    const id = this.device?.id ?? this.loadVault().lastId;
    const vault = this.loadVault();
    if (vault.devices[id]) { delete vault.devices[id].password; this.storeVault(vault); }
  }
  forgetDevice(): void {
    this.disconnect();
    this.storeVault({ lastId: "", devices: {} });
    this.emit({ type: "notice", message: "已清除该网站保存的设备和蓝牙验证码。" });
  }
  private setPhase(phase: Phase, message: string): void { this.phase = phase; this.emit({ type: "phase", phase, message }); }
  async restore(): Promise<boolean> {
    const id = this.loadVault().lastId;
    if (!id || !this.adapter.getDevices || !this.enabled()) {
      const reason = !id ? "no-record" : !this.adapter.getDevices ? "api-unavailable" : "control-disabled";
      this.diagnose("restore-skipped", { reason, remembered: !!id, getDevices: !!this.adapter.getDevices });
      return false;
    }
    try {
      this.diagnose("restore-search");
      const devices = await this.adapter.getDevices();
      const remembered = devices.find(device => device.id === id);
      this.diagnose("restore-result", { found: !!remembered, candidates: devices.length, enabled: this.enabled() });
      if (!remembered || !this.enabled()) return false;
      await this.connect(remembered);
      return true;
    } catch (error) {
      this.diagnose("restore-error", diagnosticError(error), "warn");
      this.emit({ type: "notice", message: `恢复上次设备失败：${message(error)}；请点击选择设备。` });
      return false;
    }
  }
  async chooseDevice(protocol?: Version): Promise<void> {
    // requestDevice 必须直接从用户点击处理程序发起；此前不得 await。
    this.diagnose("chooser-open", { optionalServices: SERVICES.length });
    let device: BleDevice;
    try { device = await this.adapter.requestDevice({ acceptAllDevices: true, optionalServices: SERVICES }); }
    catch (error) { this.diagnose("chooser-error", diagnosticError(error), "warn"); throw error; }
    this.diagnose("chooser-selected", { named: !!device.name, hasGatt: !!device.gatt, hasId: !!device.id });
    if (!this.enabled()) return;
    await this.connect(device, protocol);
  }
  async connect(device: BleDevice, requested?: Version): Promise<void> {
    if (!this.enabled()) throw new Error("真机控制模式未启用");
    this.disconnect();
    const epoch = this.epoch;
    this.device = device;
    let stage = "gatt";
    this.diagnose("gatt-connect-start");
    this.setPhase("connecting", `正在连接 ${device.name || "未命名设备"}…`);
    try {
      if (!device.gatt) throw new Error("设备不提供 GATT 服务");
      const server = await device.gatt.connect();
      if (epoch !== this.epoch || !this.enabled()) { if (server.connected) server.disconnect(); return; }
      this.server = server;
      this.diagnose("gatt-connected");
      this.rememberConnectedDevice(device);
      device.addEventListener("gattserverdisconnected", this.onDisconnected);
      let notifier: BleCharacteristic | null = null, writer: BleCharacteristic | null = null;
      let notifyService = "none", writeService = "none";
      for (const uuid of SERVICES) {
        const serviceCode = uuid.slice(4, 8);
        stage = `service-${serviceCode}`;
        let service: BleService;
        try { service = await this.server.getPrimaryService(uuid); }
        catch (error) {
          const details = diagnosticError(error);
          this.diagnose("service-unavailable", { service: serviceCode, ...details }, details.reason === "not-found" ? "info" : "warn");
          continue;
        }
        this.diagnose("service-found", { service: serviceCode });
        stage = `characteristics-${serviceCode}`;
        let characteristics: BleCharacteristic[];
        try { characteristics = await service.getCharacteristics(); }
        catch (error) {
          this.diagnose("characteristics-error", { service: serviceCode, ...diagnosticError(error) }, "warn");
          throw error;
        }
        this.diagnose("service-characteristics", { service: serviceCode, count: characteristics.length });
        for (const [index, characteristic] of characteristics.entries()) {
          const properties = characteristic.properties;
          this.diagnose("characteristic-discovered", {
            service: serviceCode, index, uuid: diagnosticUuid(characteristic.uuid), propertiesAvailable: !!properties,
            read: !!properties?.read, notify: !!properties?.notify, indicate: !!properties?.indicate,
            write: !!properties?.write, writeWithoutResponse: !!properties?.writeWithoutResponse,
            notifyMethod: typeof characteristic.startNotifications === "function",
            writeResponseMethod: typeof characteristic.writeValueWithResponse === "function",
            writeNoResponseMethod: typeof characteristic.writeValueWithoutResponse === "function",
            writeLegacyMethod: typeof characteristic.writeValue === "function"
          });
          const id = characteristic.uuid.toLowerCase();
          if (!notifier && NOTIFY.has(id) && (characteristic.properties.notify || characteristic.properties.indicate)) { notifier = characteristic; notifyService = serviceCode; }
          if (!writer && WRITE.has(id) && (characteristic.properties.write || characteristic.properties.writeWithoutResponse)) { writer = characteristic; writeService = serviceCode; }
        }
        if (notifier && writer) break;
      }
      this.diagnose("characteristics", { notify: !!notifier, write: !!writer,
        notifyService, notifyUuid: diagnosticUuid(notifier?.uuid), writeService, writeUuid: diagnosticUuid(writer?.uuid) });
      if (!notifier || !writer) throw new Error("找不到旧应用使用的通知/写入特征；请核对充电桩型号");
      this.writer = writer;
      this.listener = event => {
        const view = (event.target as BleCharacteristic | null)?.value;
        if (view && epoch === this.epoch) this.onBytes(view);
      };
      this.diagnose("characteristic-methods", {
        notifyMethod: typeof notifier.startNotifications === "function", writeResponse: typeof writer.writeValueWithResponse === "function",
        writeNoResponse: typeof writer.writeValueWithoutResponse === "function", writeLegacy: typeof writer.writeValue === "function"
      });
      notifier.addEventListener("characteristicvaluechanged", this.listener);
      stage = "notifications";
      this.diagnose("notifications-start", { notify: !!notifier.properties?.notify, indicate: !!notifier.properties?.indicate });
      try { await notifier.startNotifications(); }
      catch (error) { this.diagnose("notifications-error", diagnosticError(error), "error"); throw error; }
      if (epoch !== this.epoch) return;
      this.diagnose("notifications-started");
      if (!this.protocol) this.setPhase("detecting", "已连接，等待设备报文以辨识协议…");
      if (!this.protocol && requested) this.chooseProtocol(requested, "用户指定");
      else if (!this.protocol) this.sniffTimer = setTimeout(() => {
        if (epoch !== this.epoch || this.protocol) return;
        const cached = this.loadVault().devices[device.id]?.protocol;
        this.diagnose("protocol-sniff-expired", { notifications: this.rxNotifications, bytes: this.rxBytes, parsed: this.decodedFrames, cached: cached === 1 || cached === 2 }, "warn");
        if (cached === 1 || cached === 2) this.chooseProtocol(cached, "上次成功的协议，等待设备确认");
        else { this.setPhase("password", "没有收到协议报文；请手动选择旧版或新版协议，再输入密码。"); this.emit({ type: "auth-needed", message: "请选协议并输入五位蓝牙验证码。" }); }
      }, 5000);
    } catch (error) {
      this.diagnose("gatt-connect-error", { stage, ...diagnosticError(error) }, "error");
      if (epoch === this.epoch) { this.disconnect(); this.emit({ type: "notice", message: `连接失败：${message(error)}` }); }
      throw error;
    }
  }
  chooseProtocol(version: Version, source = "用户指定"): void {
    if (!this.server?.connected || !this.writer) throw new Error("设备尚未完成连接");
    if (this.authorized || this.pendingAuth) throw new Error("已开始授权，不能切换协议");
    if (this.sniffTimer) clearTimeout(this.sniffTimer);
    this.sniffTimer = null;
    this.protocol = version;
    this.diagnose("protocol-selected", { version, source });
    this.emit({ type: "protocol", version, source });
    if (this.autoLoginTried) return;
    const saved = this.loadVault().devices[this.device!.id];
    if (saved?.password && /^\d{5}$/.test(saved.password)) {
      this.diagnose("auth-cached-available");
      this.autoLoginTried = true;
      void this.login(saved.password, true).catch(error => {
        this.diagnose("auth-cached-failed", diagnosticError(error), "warn");
        this.forgetPassword();
        this.setPhase("password", `自动授权失败：${message(error)}`);
        this.emit({ type: "auth-needed", message: "请重新输入蓝牙验证码。" });
      });
    } else {
      this.setPhase("password", "请输入五位蓝牙验证码；首次通过后可保存并自动输入。");
      this.emit({ type: "auth-needed", message: "请输入蓝牙验证码。" });
    }
  }
  async login(password: string, remember: boolean): Promise<void> {
    if (!this.writer || !this.protocol || !this.server?.connected || !this.device) throw new Error("请先连接设备并识别协议");
    if (this.pendingAuth) throw new Error("正在等待上一次授权的设备回复");
    const frame = command(this.protocol, "auth", password);
    this.diagnose("auth-request", { version: this.protocol, remember });
    this.setPhase("authenticating", "正在发送验证码，等待设备确认…");
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => this.rejectAuth(new Error("授权超时，不能确认设备是否接受密码"), "timeout"), 9000);
      this.pendingAuth = { resolve, reject, timer, password, remember };
      void this.write(frame, "auth").catch(error => this.rejectAuth(new Error(`发送授权报文失败：${message(error)}`), "write-error"));
    });
  }
  private rejectAuth(error: Error, reason = "unknown"): void {
    if (!this.pendingAuth) return;
    const pending = this.pendingAuth;
    this.pendingAuth = null; clearTimeout(pending.timer);
    this.diagnose("auth-unconfirmed", { connected: !!this.server?.connected, reason }, "warn");
    if (this.server?.connected) this.setPhase("password", error.message);
    pending.reject(error);
  }
  async refresh(): Promise<void> {
    if (!this.authorized || !this.protocol) throw new Error("请先通过设备授权");
    if (this.pendingReservation) throw new Error("正在等待预约回执，请勿同时发送同步指令");
    // 旧应用使用同步设备时钟的帧触发状态更新；它不是无副作用的读取操作。
    await this.write(syncClock(this.protocol), "clock-sync");
    this.emit({ type: "notice", message: "已发送设备时钟同步帧，等待状态通知。" });
  }
  control(action: ControlAction): Promise<void> {
    if (!this.authorized || !this.protocol || !this.latest || Date.now() - this.latestAt > 20000) throw new Error("设备状态不存在或已过期；请先刷新状态");
    if (this.pendingControl || this.pendingReservation) throw new Error("上一条指令尚未确认");
    const s = this.latest;
    if (action === "start" && (s.state !== "2" || s.gunFlag === "1" || s.selfStartFlag === "2" || s.mode === "3")) throw new Error("设备当前不满足启动条件：需就绪、插枪、无预约或即插即充冲突");
    if (action === "stop" && s.state !== "4") throw new Error("只有充电中才能停止");
    if (action === "unlock" && (s.state === "4" || s.mode === "3" || s.lock === "0")) throw new Error("充电中、预约模式或已解锁时不能执行解锁");
    const frame = command(this.protocol, action);
    this.diagnose("control-request", { action, state: s.state });
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => this.rejectControl(new Error("设备未返回确认状态；实际状态未知，请刷新核对，勿直接重试"), "timeout"), 10000);
      this.pendingControl = { action, resolve, reject, timer };
      void this.write(frame, action).catch(error => this.rejectControl(new Error(`发送指令失败：${message(error)}`), "write-error"));
    });
  }
  submitReservation(reservation: Reservation): Promise<void> { return this.reserve("submit", reservation); }
  cancelReservation(): Promise<void> { return this.reserve("cancel"); }
  private reserve(action: ReservationAction, reservation?: Reservation): Promise<void> {
    if (!this.authorized || !this.protocol || !this.latest || Date.now() - this.latestAt > 20000) throw new Error("设备状态不存在或已过期；请先刷新状态");
    if (this.pendingControl || this.pendingReservation || this.pendingAuth) throw new Error("上一条指令尚未确认");
    const status = this.latest;
    if (action === "submit" && (status.state !== "2" || status.gunFlag === "1" || status.lock === "0" || status.selfStartFlag === "2" || status.mode === "5")) {
      throw new Error("预约需要设备就绪、已插枪上锁，且未启用即插即充或无感充电");
    }
    if (action === "cancel" && (status.state === "4" || !this.canCancelReservation)) throw new Error("未确认设备处于可取消的预约状态；请先刷新状态");
    const frame = reservationCommand(this.protocol, action, reservation);
    this.diagnose("reservation-request", { action, end: reservation?.end.kind ?? "none", state: status.state });
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => this.rejectReservation(new Error("未收到设备预约回执；实际结果未知，请刷新核对，勿直接重试"), "timeout"), 10000);
      this.pendingReservation = { action, resolve, reject, timer };
      void this.write(frame, `reservation-${action}`).catch(error => this.rejectReservation(new Error(`发送预约指令失败：${message(error)}`), "write-error"));
    });
  }
  private rejectReservation(error: Error, reason = "unknown"): void {
    if (!this.pendingReservation) return;
    const pending = this.pendingReservation;
    this.pendingReservation = null; clearTimeout(pending.timer);
    this.diagnose("reservation-unconfirmed", { action: pending.action, reason }, "warn");
    pending.reject(error);
  }
  private rejectControl(error: Error, reason = "unknown"): void {
    if (!this.pendingControl) return;
    const pending = this.pendingControl;
    this.pendingControl = null; clearTimeout(pending.timer);
    this.diagnose("control-unconfirmed", { action: pending.action, reason }, "warn");
    pending.reject(error);
  }
  private confirmControl(): void {
    if (!this.pendingControl) return;
    const pending = this.pendingControl;
    this.pendingControl = null; clearTimeout(pending.timer);
    this.diagnose("control-confirmed", { action: pending.action });
    pending.resolve();
  }
  private onBytes(view: DataView): void {
    const frames = this.decoder.feed(decodeAscii(view));
    this.rxNotifications++; this.rxBytes += view.byteLength; this.decodedFrames += frames.length;
    // 分片与未知格式也要可见；连续通知只记录前六次及 2 的幂，避免冲掉发现阶段的日志。
    if (frames.some(frame => frame.type !== "status") || this.rxNotifications <= 6 || !(this.rxNotifications & (this.rxNotifications - 1))) {
      this.diagnose("rx-notification", { bytes: view.byteLength, parsed: frames.length,
        notifications: this.rxNotifications, totalBytes: this.rxBytes, totalParsed: this.decodedFrames });
    }
    for (const frame of frames) this.onFrame(frame);
  }
  private onFrame(frame: Frame): void {
    if (frame.type !== "status") this.diagnose("rx-frame", { type: frame.type, version: frame.protocol });
    if (!this.protocol) this.chooseProtocol(frame.protocol, "设备通知");
    if (frame.protocol !== this.protocol) {
      this.diagnose("protocol-mismatch", { expected: this.protocol, actual: frame.protocol, type: frame.type }, "warn");
      this.emit({ type: "notice", message: "收到另一种协议的报文；已忽略，不会自动切换授权协议。" }); return;
    }
    if (frame.type === "auth" && !this.pendingAuth) { this.diagnose("auth-reply-ignored", { reason: "no-pending" }, "warn"); return; }
    if (frame.type === "auth" && this.pendingAuth) {
      this.diagnose("auth-reply", { accepted: frame.ok });
      if (!frame.ok) { this.rejectAuth(new Error("设备拒绝蓝牙验证码"), "rejected"); return; }
      const pending = this.pendingAuth;
      this.pendingAuth = null; clearTimeout(pending.timer);
      const vault = this.loadVault();
      const device = this.device!;
      vault.lastId = device.id;
      vault.devices[device.id] = { name: device.name || "未命名设备", protocol: this.protocol, ...(pending.remember ? { password: pending.password } : {}) };
      const persisted = this.storeVault(vault);
      this.diagnose("auth-saved", { remembered: pending.remember, persisted, version: this.protocol });
      this.setPhase("ready", "设备确认授权成功；可以读取状态并控制。" );
      pending.resolve();
      void this.refresh().catch(error => this.emit({ type: "notice", message: `同步时钟/获取状态失败：${message(error)}` }));
      return;
    }
    if (frame.type === "reservation") {
      const pending = this.pendingReservation;
      const matched = !!pending && pending.action === frame.action;
      this.diagnose("reservation-reply", { action: frame.action, accepted: frame.ok, matched });
      if (!matched || !pending) return;
      this.pendingReservation = null; clearTimeout(pending.timer);
      if (!frame.ok) { pending.reject(new Error("设备拒绝预约操作")); return; }
      this.reservationAccepted = frame.action === "submit";
      this.emit({ type: "reservation", action: frame.action, message: frame.action === "submit" ? "设备已确认预约提交。" : "设备已确认取消预约。" });
      pending.resolve();
      return;
    }
    if (frame.type === "status" && !this.authorized) { this.diagnose("status-ignored", { reason: "not-authorized" }); return; }
    if (frame.type === "status" && this.authorized) {
      if (this.reservationAccepted === false && frame.mode === "3") this.reservationAccepted = null;
      this.statusFrames++;
      const signature = [frame.state, frame.gunFlag, frame.mode, frame.lock, frame.selfStartFlag].join("|");
      if (signature !== this.lastStatusSignature || this.statusFrames <= 3 || !(this.statusFrames & (this.statusFrames - 1))) {
        this.diagnose("status", { version: frame.protocol, state: frame.state, gun: frame.gunFlag,
          mode: frame.mode, lock: frame.lock, selfStart: frame.selfStartFlag, samples: this.statusFrames });
      }
      this.lastStatusSignature = signature;
      this.latest = frame; this.latestAt = Date.now();
      this.emit({ type: "status", status: frame });
      const action = this.pendingControl?.action;
      if (action === "start" && frame.state === "4" || action === "stop" && frame.state === "2" || action === "unlock" && frame.lock === "0") this.confirmControl();
    }
    if (frame.type === "ack" && this.pendingControl?.action === frame.action) {
      this.diagnose("control-ack", { action: frame.action, accepted: frame.ok, matched: true });
      if (!frame.ok) this.rejectControl(new Error("设备拒绝该充电操作"), "rejected");
      else this.emit({ type: "notice", message: "设备已接收操作，等待状态变化再确认完成。" });
    } else if (frame.type === "ack") {
      this.diagnose("control-ack-ignored", { action: frame.action, reason: this.pendingControl ? "action-mismatch" : "no-pending" }, "warn");
    }
  }
  private async write(text: string, action: "auth" | "clock-sync" | ControlAction | "reservation-submit" | "reservation-cancel"): Promise<void> {
    if (!this.enabled()) throw new Error("真机控制模式已关闭，不发送蓝牙指令");
    const writer = this.writer;
    if (!writer || !this.server?.connected) throw new Error("蓝牙连接已断开");
    const bytes = encodeAscii(text);
    this.diagnose("tx-attempt", { action, bytes: bytes.length });
    let method = "none";
    try {
      if (writer.properties.write && writer.writeValueWithResponse) { method = "with-response"; await writer.writeValueWithResponse(bytes); }
      else if (writer.properties.writeWithoutResponse && writer.writeValueWithoutResponse) { method = "without-response"; await writer.writeValueWithoutResponse(bytes); }
      else if (writer.writeValue) { method = "legacy"; await writer.writeValue(bytes); }
      else throw new Error("该设备特征不可写");
      this.diagnose("tx-written", { action, method });
    } catch (error) {
      this.diagnose("tx-error", { action, method, ...diagnosticError(error) }, "error");
      throw error;
    }
  }
  private readonly onDisconnected = (): void => { this.diagnose("unexpected-disconnect", {}, "warn"); this.disconnect(); this.emit({ type: "notice", message: "设备已断线；页面数据不再视为实时。" }); };
  disconnect(): void {
    this.epoch++;
    if (this.sniffTimer) clearTimeout(this.sniffTimer);
    this.sniffTimer = null;
    this.rejectAuth(new Error("蓝牙连接已断开"), "disconnect");
    this.rejectControl(new Error("蓝牙连接已断开；指令实际结果未知"), "disconnect");
    this.rejectReservation(new Error("蓝牙连接已断开；预约实际结果未知"), "disconnect");
    const server = this.server;
    if (this.device || server) this.diagnose("disconnect", { connected: !!server?.connected });
    this.device?.removeEventListener("gattserverdisconnected", this.onDisconnected);
    this.device = null; this.server = null; this.writer = null; this.listener = null;
    try { if (server?.connected) server.disconnect(); } catch { /* 连接可能已自行断开 */ }
    this.protocol = null; this.latest = null; this.latestAt = 0;
    this.autoLoginTried = false; this.reservationAccepted = null; this.decoder.reset();
    this.rxNotifications = 0; this.rxBytes = 0; this.decodedFrames = 0;
    this.statusFrames = 0; this.lastStatusSignature = "";
    this.setPhase("offline", "未连接充电桩");
  }
}
