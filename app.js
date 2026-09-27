"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // src/protocol.ts
  function nextMidnight(now = /* @__PURE__ */ new Date()) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  }
  function parseLocalMinute(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
    if (!match) throw new Error("\u9884\u7EA6\u65F6\u95F4\u683C\u5F0F\u65E0\u6548");
    const [year, month, day, hour, minute] = match.slice(1).map(Number);
    const date = new Date(year, month - 1, day, hour, minute);
    if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute) {
      throw new Error("\u9884\u7EA6\u65F6\u95F4\u4E0D\u662F\u6709\u6548\u7684\u672C\u5730\u65F6\u95F4");
    }
    return date;
  }
  var commands = {
    1: { start: "80116000000000000062", stop: "80126000000000000063", unlock: "80166000000000000067" },
    2: { start: "@%PD-102-0-181-@", stop: "@%PD-104-0-181-@", unlock: "@%PD-108-0-181-@" }
  };
  var numeric = (value) => /^\d+$/.test(value ?? "");
  var pad = (value) => String(value).padStart(2, "0");
  var calendar = (date) => [String(date.getFullYear()), pad(date.getMonth() + 1), pad(date.getDate()), pad(date.getHours()), pad(date.getMinutes())];
  function checksum(body) {
    if (body.length !== 19 || !numeric(body)) throw new Error("\u65E7\u7248\u5E27\u4E3B\u4F53\u987B\u4E3A 19 \u4F4D\u6570\u5B57");
    return String([...body].reduce((sum, digit) => sum + Number(digit), 0) % 10);
  }
  function appendChecksum(body) {
    return body + checksum(body);
  }
  function command(protocol, action, password) {
    if (action === "auth") {
      if (!/^\d{5}$/.test(password ?? "")) throw new Error("\u84DD\u7259\u9A8C\u8BC1\u7801\u987B\u4E3A\u4E94\u4F4D\u6570\u5B57");
      return protocol === 1 ? appendChecksum(`80100000${password}000006`) : `@%PD-100-0-181-${password}-@`;
    }
    return commands[protocol][action];
  }
  function syncClock(protocol, date = /* @__PURE__ */ new Date()) {
    const parts = [...calendar(date), pad(date.getSeconds())];
    return protocol === 1 ? appendChecksum(`821${parts.join("")}06`) : `@%PD-204-0-181-${parts.join("-")}-@`;
  }
  function validateReservation(reservation, now = /* @__PURE__ */ new Date()) {
    const start = reservation.start;
    if (!(start instanceof Date) || !Number.isFinite(start.getTime()) || !Number.isFinite(now.getTime()) || start.getFullYear() < 1e3 || start.getFullYear() > 9999 || start.getSeconds() || start.getMilliseconds()) {
      throw new Error("\u9884\u7EA6\u5F00\u59CB\u65F6\u95F4\u65E0\u6548\uFF0C\u987B\u7CBE\u786E\u5230\u5206\u949F");
    }
    const offset = start.getTime() - now.getTime();
    if (offset <= 0 || offset > 24 * 60 * 60 * 1e3) throw new Error("\u9884\u7EA6\u5F00\u59CB\u65F6\u95F4\u987B\u5728\u672A\u6765 24 \u5C0F\u65F6\u5185");
    if (reservation.end.kind === "time" && (!Number.isInteger(reservation.end.minutes) || reservation.end.minutes < 60 || reservation.end.minutes > 720 || reservation.end.minutes % 60 !== 0)) {
      throw new Error("\u9884\u7EA6\u65F6\u957F\u4EC5\u652F\u6301 1 \u81F3 12 \u5C0F\u65F6\uFF08\u6574\u5C0F\u65F6\uFF09");
    }
    if (reservation.end.kind === "energy" && (!Number.isInteger(reservation.end.kWh) || reservation.end.kWh < 5 || reservation.end.kWh > 99 || reservation.end.kWh % 5 !== 0 && reservation.end.kWh !== 99)) {
      throw new Error("\u9884\u7EA6\u7535\u91CF\u4EC5\u652F\u6301 5 \u81F3 95 \u5EA6\uFF08\u6BCF\u6863 5 \u5EA6\uFF09\u6216 99 \u5EA6");
    }
    if (!["full", "time", "energy"].includes(reservation.end.kind)) throw new Error("\u672A\u77E5\u7684\u5145\u7535\u7ED3\u675F\u65B9\u5F0F");
  }
  function reservationCommand(protocol, action, reservation, now = /* @__PURE__ */ new Date()) {
    if (action === "cancel") {
      if (reservation) throw new Error("\u53D6\u6D88\u9884\u7EA6\u4E0D\u5F97\u643A\u5E26\u65B0\u7684\u9884\u7EA6\u6761\u4EF6");
      return protocol === 1 ? "80176000000000000068" : "@%PD-116-0-181-@";
    }
    if (action !== "submit" || !reservation) throw new Error("\u63D0\u4EA4\u9884\u7EA6\u987B\u63D0\u4F9B\u5F00\u59CB\u65F6\u95F4\u4E0E\u7ED3\u675F\u6761\u4EF6");
    validateReservation(reservation, now);
    const start = calendar(reservation.start);
    const clock = [...calendar(now), pad(now.getSeconds())];
    const end = reservation.end;
    const pattern = end.kind === "full" ? "3" : end.kind === "time" ? "1" : "2";
    const minutes = end.kind === "time" ? String(end.minutes).padStart(3, "0") : "000";
    const energy = end.kind === "energy" ? String(end.kWh).padStart(4, "0") : "0000";
    if (protocol === 1) return appendChecksum(`811${clock.join("")}06`) + appendChecksum(`812${start.join("")}0006`) + appendChecksum(`813${pattern}${minutes}${energy}10000006`);
    return `@%PD-114-0-181-${clock.join("-")}-${start.join("-")}-00-${pattern}-${minutes}-${energy}-100-@`;
  }
  function status(protocol, fields) {
    if (fields.length < 13 || !fields.slice(0, 3).every(numeric) || ![fields[3], fields[5], fields[10]].every(numeric)) return null;
    return {
      type: "status",
      protocol,
      soc: Number(fields[0]),
      energyKWh: Number(fields[1]) / 10,
      minutes: Number(fields[2]),
      state: fields[3],
      remainingMinutes: Number(fields[4]),
      lock: fields[5],
      mode: fields[6],
      power: fields[7],
      voltage: fields[8],
      currentA: numeric(fields[9]) ? Number(fields[9]) / 10 : null,
      gunFlag: fields[10],
      selfStartFlag: fields[11],
      vinFlag: fields[12]
    };
  }
  function parseNew(frame) {
    if (!frame.startsWith("@%DP-") || !frame.endsWith("-@")) return null;
    const parts = frame.split("-");
    const code = parts[1];
    if (code === "101") return { type: "auth", protocol: 2, ok: parts[4] === "1", code: parts[4] ?? "" };
    if (code === "103" || code === "105") return { type: "ack", protocol: 2, action: code === "103" ? "start" : "stop", ok: parts[4] === "1", code: parts[4] ?? "" };
    if ((code === "115" || code === "117") && (parts[4] === "0" || parts[4] === "1")) return { type: "reservation", protocol: 2, action: code === "115" ? "submit" : "cancel", ok: parts[4] === "1", code: parts[4] };
    if (code === "107") return status(2, parts.slice(4, 17));
    return { type: "unknown", protocol: 2, code: code ?? "" };
  }
  function parseOld(frame) {
    if (!/^\d{40}$/.test(frame)) return null;
    const first = frame.slice(0, 20), second = frame.slice(20);
    if (first[19] !== checksum(first.slice(0, 19)) || second[19] !== checksum(second.slice(0, 19))) return null;
    const header = first[0] + second[0], trailer = first[18] + second[18];
    if (header === "88" && first[1] + second[1] === "88" && trailer === "11") {
      const code = first[4] + second[4];
      return { type: "auth", protocol: 1, ok: code === "33", code };
    }
    if (header === "88" && first[1] + second[1] === "88" && trailer === "66") {
      const kind = first[3] + second[3], code = first[5] + second[5];
      if (kind === "22" && ["55", "66"].includes(code)) return { type: "reservation", protocol: 1, action: "submit", ok: code === "55", code };
      if (kind === "33" && ["77", "88"].includes(code)) return { type: "reservation", protocol: 1, action: "cancel", ok: code === "77", code };
    }
    if (!["88", "77", "66"].includes(header) || trailer !== "66" || first[2] !== "1" || second[2] !== "2") return null;
    return status(1, [frame.slice(8, 11), frame.slice(11, 15), frame.slice(15, 18), frame[27], frame.slice(4, 7), frame[3], frame[23], frame.slice(28, 32), frame.slice(35, 38), frame.slice(32, 35), frame[24], frame[26], frame[25]]);
  }
  var FrameDecoder = class {
    constructor() {
      __publicField(this, "buffer", "");
    }
    reset() {
      this.buffer = "";
    }
    feed(chunk) {
      this.buffer += chunk;
      const frames = [];
      if (this.buffer.length > 2048) this.buffer = this.buffer.slice(-2048);
      while (this.buffer.length) {
        if (this.buffer.startsWith("@%DP-")) {
          const end = this.buffer.indexOf("-@");
          if (end < 0) break;
          const parsed = parseNew(this.buffer.slice(0, end + 2));
          if (parsed) frames.push(parsed);
          this.buffer = this.buffer.slice(end + 2);
        } else if (/^\d/.test(this.buffer)) {
          if (this.buffer.length < 40) break;
          const parsed = parseOld(this.buffer.slice(0, 40));
          if (parsed) {
            frames.push(parsed);
            this.buffer = this.buffer.slice(40);
          } else this.buffer = this.buffer.slice(1);
        } else if ("@%DP-".startsWith(this.buffer)) break;
        else this.buffer = this.buffer.slice(1);
      }
      return frames;
    }
  };

  // src/diagnostics.ts
  var KEY = "wattsaving-diagnostics-v1";
  var MAX_ENTRIES = 160;
  var MAX_CHARS = 32e3;
  var HIDDEN_FIELD = /pass(word)?|secret|token|device.?id|device.?name|alias|mac|path|url|ssid|vin|raw|payload|frame|message/i;
  var SAFE_ERROR_NAMES = /* @__PURE__ */ new Set(["Error", "TypeError", "NotFoundError", "NotAllowedError", "SecurityError", "NetworkError", "NotSupportedError", "InvalidStateError", "AbortError", "TimeoutError", "OperationError", "DataError", "ConnectionInterruptedError"]);
  var escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function diagnosticError(error) {
    const name = error instanceof Error ? error.name : "unknown";
    const kind = SAFE_ERROR_NAMES.has(name) ? name : "other";
    const text2 = `${name} ${error instanceof Error ? error.message : ""}`.toLowerCase();
    const reason = /connectioninterrupted/.test(text2) ? "connection-interrupted" : /cancel|abort/.test(error instanceof Error ? error.message.toLowerCase() : "") ? "cancelled" : /not.?found|unknown service|unknown characteristic|unavailable|not available|\bmissing\b|does not exist|no such/.test(text2) ? "not-found" : /permission|not.?allowed|security|unauthori[sz]ed|access denied/.test(text2) ? "permission" : /bluetooth.*(?:off|disabled)|powered off/.test(text2) ? "bluetooth-off" : /disconnect|not connected|connection lost/.test(text2) ? "disconnected" : /time.?out/.test(text2) ? "timeout" : /unsupported|not supported|not implemented/.test(text2) ? "unsupported" : /busy|in progress/.test(text2) ? "busy" : /length|too long|exceed|\bmtu\b/.test(text2) ? "size-or-mtu" : "unspecified";
    return { kind, reason };
  }
  var Diagnostics = class {
    constructor(storage) {
      __publicField(this, "storage");
      __publicField(this, "secrets", /* @__PURE__ */ new Set());
      __publicField(this, "entries", []);
      __publicField(this, "persistOk", true);
      if (storage !== void 0) this.storage = storage;
      else {
        try {
          this.storage = typeof localStorage !== "undefined" ? localStorage : null;
        } catch {
          this.storage = null;
        }
      }
      this.persistOk = this.storage !== null;
      try {
        const value = JSON.parse(this.storage?.getItem(KEY) ?? "null");
        if (Array.isArray(value)) {
          this.entries = value.slice(-MAX_ENTRIES).filter(
            (entry) => !!entry && typeof entry === "object" && typeof entry.at === "string" && typeof entry.event === "string" && ["info", "warn", "error"].includes(entry.level) && !!entry.data && typeof entry.data === "object"
          ).map((entry) => this.cleanEntry(entry));
        }
      } catch {
        this.persistOk = false;
      }
    }
    get storageAvailable() {
      return this.persistOk;
    }
    get recent() {
      return this.entries;
    }
    hide(value) {
      if (value.length >= 3) this.secrets.add(value);
    }
    sanitize(input) {
      let safe = input.slice(0, 600);
      for (const secret of this.secrets) safe = safe.replace(new RegExp(escapeRegExp(secret), "gi"), "[REDACTED]");
      return safe.replace(/@%PD-100-0-181-\d{5}-@/gi, "[AUTH_FRAME]").replace(/80100000\d{5}000006\d?/g, "[AUTH_FRAME]").replace(/@%[a-z]{2}-[^@\r\n]{0,600}-@/gi, "[BLE_FRAME]").replace(/\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi, "[DEVICE_ID]").replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[DEVICE_ID]").replace(/(?:[a-z]:\\|\/mnt\/|\/Users\/|\/home\/)[^\s"']+/gi, "[LOCAL_PATH]").replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, "[EMAIL]").replace(/\b\d{5,}\b/g, "[NUMBER]");
    }
    cleanData(data) {
      const safe = {};
      for (const [key, value] of Object.entries(data).slice(0, 16)) {
        const field = key.replace(/[^a-z0-9_-]/gi, "_").slice(0, 32);
        if (!field) continue;
        safe[field] = HIDDEN_FIELD.test(field) ? "[REDACTED]" : typeof value === "string" ? this.sanitize(value) : typeof value === "number" && Number.isFinite(value) ? value : typeof value === "boolean" || value === null ? value : "[REDACTED]";
      }
      return safe;
    }
    cleanEntry(entry) {
      return { at: this.sanitize(entry.at).slice(0, 32), level: entry.level, event: entry.event.replace(/[^a-z0-9_.-]/gi, "_").slice(0, 60), data: this.cleanData(entry.data) };
    }
    add(event, data = {}, level = "info") {
      const entry = this.cleanEntry({ at: (/* @__PURE__ */ new Date()).toISOString(), level, event, data });
      this.entries.push(entry);
      if (this.entries.length > MAX_ENTRIES) this.entries.shift();
      let json = JSON.stringify(this.entries);
      while (json.length > MAX_CHARS && this.entries.length > 1) {
        this.entries.shift();
        json = JSON.stringify(this.entries);
      }
      try {
        this.storage?.setItem(KEY, json);
      } catch {
        this.persistOk = false;
      }
    }
    exportText(environment2) {
      const entries = this.entries.map((entry) => this.cleanEntry(entry));
      return [
        "WattSaving diagnostics v3 (no passwords, device IDs or raw BLE frames)",
        `environment: ${JSON.stringify(environment2)}`,
        `localPersistence: ${this.storageAvailable ? "available" : "unavailable"}`,
        ...entries.map((entry) => JSON.stringify(entry))
      ].join("\n");
    }
    clear() {
      this.entries = [];
      this.secrets.clear();
      try {
        this.storage?.removeItem(KEY);
      } catch {
        this.persistOk = false;
      }
    }
  };

  // src/ble.ts
  var KEY2 = "wattsaving-ble-devices-v1";
  var UUID = (short) => `0000${short}-0000-1000-8000-00805f9b34fb`;
  var SERVICES = ["ff00", "ffe0", "ffe5"].map(UUID);
  var NOTIFY_SERVICES = /* @__PURE__ */ new Set(["ff00", "ffe0"]);
  var WRITE_SERVICES = /* @__PURE__ */ new Set(["ff00", "ffe5"]);
  var NOTIFY = /* @__PURE__ */ new Set([UUID("ff01"), UUID("ffe4")]);
  var WRITE = /* @__PURE__ */ new Set([UUID("ff02"), UUID("ffe9")]);
  var ConnectionInterruptedError = class extends Error {
    constructor() {
      super("\u84DD\u7259\u8FDE\u63A5\u5728\u670D\u52A1\u53D1\u73B0\u671F\u95F4\u5DF2\u4E2D\u6B62\uFF1B\u65E0\u6CD5\u5224\u65AD\u8BBE\u5907\u7684\u670D\u52A1\u6216\u7279\u5F81\u662F\u5426\u5B58\u5728");
      this.name = "ConnectionInterruptedError";
    }
  };
  function diagnosticUuid(value) {
    if (typeof value !== "string") return "missing";
    const id = value.toLowerCase();
    if (/^[0-9a-f]{4}$/.test(id)) return id;
    const base = /^([0-9a-f]{8})-0000-1000-8000-00805f9b34fb$/.exec(id);
    if (base) return base[1].startsWith("0000") ? base[1].slice(4) : base[1];
    return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id) ? "custom128" : "unexpected-format";
  }
  function message(error) {
    return error instanceof Error ? error.message : String(error);
  }
  function encodeAscii(text2) {
    const bytes = new Uint8Array(new ArrayBuffer(text2.length));
    for (let i = 0; i < text2.length; i++) bytes[i] = text2.charCodeAt(i);
    return bytes;
  }
  function decodeAscii(view) {
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    let result = "";
    for (const byte of bytes) result += String.fromCharCode(byte);
    return result;
  }
  var ChargerClient = class {
    constructor(adapter2, emit, enabled = () => true, diagnose = () => {
    }) {
      __publicField(this, "adapter");
      __publicField(this, "emit");
      __publicField(this, "enabled");
      __publicField(this, "diagnose");
      __publicField(this, "device", null);
      __publicField(this, "server", null);
      __publicField(this, "writer", null);
      __publicField(this, "notifier", null);
      __publicField(this, "listener", null);
      __publicField(this, "decoder", new FrameDecoder());
      __publicField(this, "rxNotifications", 0);
      __publicField(this, "rxBytes", 0);
      __publicField(this, "decodedFrames", 0);
      __publicField(this, "statusFrames", 0);
      __publicField(this, "lastStatusSignature", "");
      __publicField(this, "epoch", 0);
      __publicField(this, "sniffTimer", null);
      __publicField(this, "autoLoginTried", false);
      __publicField(this, "protocol", null);
      __publicField(this, "phase", "offline");
      __publicField(this, "connectionStage", "offline");
      __publicField(this, "connectedAt", 0);
      __publicField(this, "latest", null);
      __publicField(this, "latestAt", 0);
      __publicField(this, "pendingAuth", null);
      __publicField(this, "pendingControl", null);
      __publicField(this, "pendingReservation", null);
      __publicField(this, "reservationAccepted", null);
      __publicField(this, "fallbackVault", { lastId: "", devices: {} });
      __publicField(this, "onDisconnected", () => {
        this.diagnose("unexpected-disconnect", {
          stage: this.connectionStage,
          afterConnectedMs: this.connectedAt ? Math.max(0, Date.now() - this.connectedAt) : null
        }, "warn");
        this.disconnect();
        this.emit({ type: "notice", message: "\u8BBE\u5907\u5DF2\u65AD\u7EBF\uFF1B\u9875\u9762\u6570\u636E\u4E0D\u518D\u89C6\u4E3A\u5B9E\u65F6\u3002" });
      });
      this.adapter = adapter2;
      this.emit = emit;
      this.enabled = enabled;
      this.diagnose = diagnose;
    }
    get currentDevice() {
      return this.device;
    }
    get currentProtocol() {
      return this.protocol;
    }
    get currentStatus() {
      return this.latest;
    }
    get authorized() {
      return this.phase === "ready" && !!this.server?.connected;
    }
    get reservationPending() {
      return !!this.pendingReservation;
    }
    get canCancelReservation() {
      return this.reservationAccepted === null ? this.latest?.mode === "3" : this.reservationAccepted;
    }
    get rememberedName() {
      const saved = this.loadVault();
      return saved.devices[saved.lastId]?.name ?? null;
    }
    loadVault() {
      try {
        const parsed = JSON.parse(localStorage.getItem(KEY2) ?? "null");
        if (parsed && typeof parsed === "object" && "devices" in parsed && "lastId" in parsed) {
          const value = parsed;
          if (typeof value.lastId === "string" && value.devices && typeof value.devices === "object") return value;
        }
      } catch {
      }
      return this.fallbackVault;
    }
    storeVault(vault) {
      this.fallbackVault = vault;
      try {
        localStorage.setItem(KEY2, JSON.stringify(vault));
        return true;
      } catch {
        this.diagnose("device-storage-error", { operation: "write" }, "warn");
        this.emit({ type: "notice", message: "\u6D4F\u89C8\u5668\u672A\u5141\u8BB8\u672C\u5730\u5B58\u50A8\uFF1B\u672C\u6B21\u8BBE\u5907\u548C\u5BC6\u7801\u4E0D\u4F1A\u5728\u4E0B\u6B21\u6253\u5F00\u65F6\u4FDD\u7559\u3002" });
        return false;
      }
    }
    rememberConnectedDevice(device) {
      if (!device.id) {
        this.diagnose("device-remember-skipped", { reason: "missing-id" }, "warn");
        return;
      }
      const vault = this.loadVault();
      const previous = vault.devices[device.id];
      vault.lastId = device.id;
      vault.devices[device.id] = { ...previous, name: device.name || previous?.name || "\u672A\u547D\u540D\u8BBE\u5907" };
      const persisted = this.storeVault(vault);
      this.diagnose("device-remembered", { known: !!previous, persisted });
    }
    forgetPassword() {
      const id = this.device?.id ?? this.loadVault().lastId;
      const vault = this.loadVault();
      if (vault.devices[id]) {
        delete vault.devices[id].password;
        this.storeVault(vault);
      }
    }
    forgetDevice() {
      this.disconnect();
      this.storeVault({ lastId: "", devices: {} });
      this.emit({ type: "notice", message: "\u5DF2\u6E05\u9664\u8BE5\u7F51\u7AD9\u4FDD\u5B58\u7684\u8BBE\u5907\u548C\u84DD\u7259\u9A8C\u8BC1\u7801\u3002" });
    }
    setPhase(phase2, message2) {
      this.phase = phase2;
      this.emit({ type: "phase", phase: phase2, message: message2 });
    }
    async restore() {
      const id = this.loadVault().lastId;
      if (!id || !this.adapter.getDevices || !this.enabled()) {
        const reason = !id ? "no-record" : !this.adapter.getDevices ? "api-unavailable" : "control-disabled";
        this.diagnose("restore-skipped", { reason, remembered: !!id, getDevices: !!this.adapter.getDevices });
        return false;
      }
      try {
        this.diagnose("restore-search");
        const devices = await this.adapter.getDevices();
        const remembered = devices.find((device) => device.id === id);
        this.diagnose("restore-result", { found: !!remembered, candidates: devices.length, enabled: this.enabled() });
        if (!remembered || !this.enabled()) return false;
        await this.connect(remembered);
        return true;
      } catch (error) {
        this.diagnose("restore-error", diagnosticError(error), "warn");
        this.emit({ type: "notice", message: `\u6062\u590D\u4E0A\u6B21\u8BBE\u5907\u5931\u8D25\uFF1A${message(error)}\uFF1B\u8BF7\u70B9\u51FB\u9009\u62E9\u8BBE\u5907\u3002` });
        return false;
      }
    }
    async chooseDevice(protocol) {
      this.diagnose("chooser-open", { optionalServices: SERVICES.length });
      let device;
      try {
        device = await this.adapter.requestDevice({ acceptAllDevices: true, optionalServices: SERVICES });
      } catch (error) {
        this.diagnose("chooser-error", diagnosticError(error), "warn");
        throw error;
      }
      this.diagnose("chooser-selected", { named: !!device.name, hasGatt: !!device.gatt, hasId: !!device.id });
      if (!this.enabled()) return;
      await this.connect(device, protocol);
    }
    async connect(device, requested) {
      if (!this.enabled()) throw new Error("\u771F\u673A\u63A7\u5236\u6A21\u5F0F\u672A\u542F\u7528");
      this.disconnect();
      const epoch = this.epoch;
      this.device = device;
      let stage = "gatt";
      this.connectionStage = stage;
      const markStage = (next) => {
        stage = next;
        if (epoch === this.epoch) this.connectionStage = next;
      };
      this.diagnose("gatt-connect-start");
      this.setPhase("connecting", `\u6B63\u5728\u8FDE\u63A5 ${device.name || "\u672A\u547D\u540D\u8BBE\u5907"}\u2026`);
      try {
        if (!device.gatt) throw new Error("\u8BBE\u5907\u4E0D\u63D0\u4F9B GATT \u670D\u52A1");
        const server = await device.gatt.connect();
        if (epoch !== this.epoch || !this.enabled()) {
          if (server.connected) server.disconnect();
          return;
        }
        if (!server.connected) throw new ConnectionInterruptedError();
        this.server = server;
        this.connectedAt = Date.now();
        this.diagnose("gatt-connected");
        this.rememberConnectedDevice(device);
        device.addEventListener("gattserverdisconnected", this.onDisconnected);
        const ensureActive = (operation, originalError) => {
          if (epoch === this.epoch && this.server === server && server.connected && this.enabled()) return;
          const cause = !server.connected ? "gatt-disconnected" : epoch !== this.epoch ? "session-ended" : !this.enabled() ? "control-disabled" : "server-replaced";
          const original = originalError === void 0 ? null : diagnosticError(originalError);
          this.diagnose("discovery-interrupted", {
            stage,
            operation,
            cause,
            connected: server.connected,
            ...original ? { operationKind: original.kind, operationReason: original.reason } : {}
          }, "warn");
          throw new ConnectionInterruptedError();
        };
        ensureActive("before-services");
        let notifier = null, writer = null;
        let notifyService = "none", writeService = "none";
        let servicesFound = 0, missingServices = 0, failedServices = 0;
        for (const uuid of SERVICES) {
          const serviceCode = uuid.slice(4, 8);
          markStage(`service-${serviceCode}`);
          let service;
          try {
            service = await server.getPrimaryService(uuid);
          } catch (error) {
            ensureActive("get-service", error);
            const details = diagnosticError(error);
            if (details.reason === "not-found") missingServices++;
            else failedServices++;
            this.diagnose("service-unavailable", { service: serviceCode, ...details }, details.reason === "not-found" ? "info" : "warn");
            continue;
          }
          ensureActive("get-service");
          servicesFound++;
          this.diagnose("service-found", { service: serviceCode });
          markStage(`characteristics-${serviceCode}`);
          let characteristics;
          try {
            characteristics = await service.getCharacteristics();
          } catch (error) {
            ensureActive("get-characteristics", error);
            this.diagnose("characteristics-error", { service: serviceCode, ...diagnosticError(error) }, "warn");
            throw error;
          }
          ensureActive("get-characteristics");
          this.diagnose("service-characteristics", { service: serviceCode, count: characteristics.length });
          for (const [index, characteristic] of characteristics.entries()) {
            const properties = characteristic.properties;
            const notifyServiceAllowed = NOTIFY_SERVICES.has(serviceCode);
            const writeServiceAllowed = WRITE_SERVICES.has(serviceCode);
            this.diagnose("characteristic-discovered", {
              service: serviceCode,
              index,
              uuid: diagnosticUuid(characteristic.uuid),
              propertiesAvailable: !!properties,
              read: !!properties?.read,
              notify: !!properties?.notify,
              indicate: !!properties?.indicate,
              write: !!properties?.write,
              writeWithoutResponse: !!properties?.writeWithoutResponse,
              notifyMethod: typeof characteristic.startNotifications === "function",
              writeResponseMethod: typeof characteristic.writeValueWithResponse === "function",
              writeNoResponseMethod: typeof characteristic.writeValueWithoutResponse === "function",
              writeLegacyMethod: typeof characteristic.writeValue === "function",
              notifyServiceAllowed,
              writeServiceAllowed
            });
            const id = characteristic.uuid.toLowerCase();
            if (!notifier && notifyServiceAllowed && NOTIFY.has(id) && (characteristic.properties.notify || characteristic.properties.indicate)) {
              notifier = characteristic;
              notifyService = serviceCode;
            }
            if (!writer && writeServiceAllowed && WRITE.has(id) && (characteristic.properties.write || characteristic.properties.writeWithoutResponse)) {
              writer = characteristic;
              writeService = serviceCode;
            }
          }
          if (notifier && writer) break;
        }
        ensureActive("complete-discovery");
        this.diagnose("discovery-summary", { servicesFound, missingServices, failedServices, notify: !!notifier, write: !!writer });
        this.diagnose("characteristics", {
          notify: !!notifier,
          write: !!writer,
          notifyService,
          notifyUuid: diagnosticUuid(notifier?.uuid),
          writeService,
          writeUuid: diagnosticUuid(writer?.uuid)
        });
        if (!notifier || !writer) {
          if (!servicesFound) throw new Error(failedServices ? "\u65E0\u6CD5\u8BFB\u53D6\u65E7\u5E94\u7528\u4F7F\u7528\u7684 BLE \u670D\u52A1\uFF1B\u4E0D\u80FD\u5224\u65AD\u7279\u5F81\u662F\u5426\u5B58\u5728" : "\u672A\u627E\u5230\u65E7\u5E94\u7528\u4F7F\u7528\u7684 BLE \u670D\u52A1\uFF1B\u4E0D\u80FD\u8BFB\u53D6\u7279\u5F81");
          throw new Error("\u627E\u4E0D\u5230\u65E7\u5E94\u7528\u4F7F\u7528\u7684\u901A\u77E5/\u5199\u5165\u7279\u5F81\uFF1B\u8BF7\u6838\u5BF9\u5145\u7535\u6869\u578B\u53F7");
        }
        this.writer = writer;
        this.listener = (event) => {
          const view = event.target?.value;
          if (view && epoch === this.epoch) this.onBytes(view);
        };
        this.diagnose("characteristic-methods", {
          notifyMethod: typeof notifier.startNotifications === "function",
          writeResponse: typeof writer.writeValueWithResponse === "function",
          writeNoResponse: typeof writer.writeValueWithoutResponse === "function",
          writeLegacy: typeof writer.writeValue === "function"
        });
        this.notifier = notifier;
        notifier.addEventListener("characteristicvaluechanged", this.listener);
        markStage("notifications");
        this.diagnose("notifications-start", { notify: !!notifier.properties?.notify, indicate: !!notifier.properties?.indicate });
        try {
          await notifier.startNotifications();
        } catch (error) {
          ensureActive("start-notifications", error);
          this.diagnose("notifications-error", diagnosticError(error), "error");
          throw error;
        }
        ensureActive("start-notifications");
        markStage("connected");
        this.diagnose("notifications-started");
        if (!this.protocol) this.setPhase("detecting", "\u5DF2\u8FDE\u63A5\uFF0C\u7B49\u5F85\u8BBE\u5907\u62A5\u6587\u4EE5\u8FA8\u8BC6\u534F\u8BAE\u2026");
        if (!this.protocol && requested) this.chooseProtocol(requested, "\u7528\u6237\u6307\u5B9A");
        else if (!this.protocol) this.sniffTimer = setTimeout(() => {
          if (epoch !== this.epoch || this.protocol) return;
          const cached = this.loadVault().devices[device.id]?.protocol;
          this.diagnose("protocol-sniff-expired", { notifications: this.rxNotifications, bytes: this.rxBytes, parsed: this.decodedFrames, cached: cached === 1 || cached === 2 }, "warn");
          if (cached === 1 || cached === 2) this.chooseProtocol(cached, "\u4E0A\u6B21\u6210\u529F\u7684\u534F\u8BAE\uFF0C\u7B49\u5F85\u8BBE\u5907\u786E\u8BA4");
          else {
            this.setPhase("password", "\u6CA1\u6709\u6536\u5230\u534F\u8BAE\u62A5\u6587\uFF1B\u8BF7\u624B\u52A8\u9009\u62E9\u65E7\u7248\u6216\u65B0\u7248\u534F\u8BAE\uFF0C\u518D\u8F93\u5165\u5BC6\u7801\u3002");
            this.emit({ type: "auth-needed", message: "\u8BF7\u9009\u534F\u8BAE\u5E76\u8F93\u5165\u4E94\u4F4D\u84DD\u7259\u9A8C\u8BC1\u7801\u3002" });
          }
        }, 5e3);
      } catch (error) {
        this.diagnose("gatt-connect-error", { stage, ...diagnosticError(error) }, "error");
        if (epoch === this.epoch) {
          this.disconnect();
          this.emit({ type: "notice", message: `\u8FDE\u63A5\u5931\u8D25\uFF1A${message(error)}` });
        }
        throw error;
      }
    }
    chooseProtocol(version, source = "\u7528\u6237\u6307\u5B9A") {
      if (!this.server?.connected || !this.writer) throw new Error("\u8BBE\u5907\u5C1A\u672A\u5B8C\u6210\u8FDE\u63A5");
      if (this.authorized || this.pendingAuth) throw new Error("\u5DF2\u5F00\u59CB\u6388\u6743\uFF0C\u4E0D\u80FD\u5207\u6362\u534F\u8BAE");
      if (this.sniffTimer) clearTimeout(this.sniffTimer);
      this.sniffTimer = null;
      this.protocol = version;
      this.diagnose("protocol-selected", { version, source });
      this.emit({ type: "protocol", version, source });
      if (this.autoLoginTried) return;
      const saved = this.loadVault().devices[this.device.id];
      if (saved?.password && /^\d{5}$/.test(saved.password)) {
        this.diagnose("auth-cached-available");
        this.autoLoginTried = true;
        void this.login(saved.password, true).catch((error) => {
          this.diagnose("auth-cached-failed", diagnosticError(error), "warn");
          this.forgetPassword();
          this.setPhase("password", `\u81EA\u52A8\u6388\u6743\u5931\u8D25\uFF1A${message(error)}`);
          this.emit({ type: "auth-needed", message: "\u8BF7\u91CD\u65B0\u8F93\u5165\u84DD\u7259\u9A8C\u8BC1\u7801\u3002" });
        });
      } else {
        this.setPhase("password", "\u8BF7\u8F93\u5165\u4E94\u4F4D\u84DD\u7259\u9A8C\u8BC1\u7801\uFF1B\u9996\u6B21\u901A\u8FC7\u540E\u53EF\u4FDD\u5B58\u5E76\u81EA\u52A8\u8F93\u5165\u3002");
        this.emit({ type: "auth-needed", message: "\u8BF7\u8F93\u5165\u84DD\u7259\u9A8C\u8BC1\u7801\u3002" });
      }
    }
    async login(password, remember) {
      if (!this.writer || !this.protocol || !this.server?.connected || !this.device) throw new Error("\u8BF7\u5148\u8FDE\u63A5\u8BBE\u5907\u5E76\u8BC6\u522B\u534F\u8BAE");
      if (this.pendingAuth) throw new Error("\u6B63\u5728\u7B49\u5F85\u4E0A\u4E00\u6B21\u6388\u6743\u7684\u8BBE\u5907\u56DE\u590D");
      const frame = command(this.protocol, "auth", password);
      this.diagnose("auth-request", { version: this.protocol, remember });
      this.setPhase("authenticating", "\u6B63\u5728\u53D1\u9001\u9A8C\u8BC1\u7801\uFF0C\u7B49\u5F85\u8BBE\u5907\u786E\u8BA4\u2026");
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => this.rejectAuth(new Error("\u6388\u6743\u8D85\u65F6\uFF0C\u4E0D\u80FD\u786E\u8BA4\u8BBE\u5907\u662F\u5426\u63A5\u53D7\u5BC6\u7801"), "timeout"), 9e3);
        this.pendingAuth = { resolve, reject, timer, password, remember };
        void this.write(frame, "auth").catch((error) => this.rejectAuth(new Error(`\u53D1\u9001\u6388\u6743\u62A5\u6587\u5931\u8D25\uFF1A${message(error)}`), "write-error"));
      });
    }
    rejectAuth(error, reason = "unknown") {
      if (!this.pendingAuth) return;
      const pending = this.pendingAuth;
      this.pendingAuth = null;
      clearTimeout(pending.timer);
      this.diagnose("auth-unconfirmed", { connected: !!this.server?.connected, reason }, "warn");
      if (this.server?.connected) this.setPhase("password", error.message);
      pending.reject(error);
    }
    async refresh() {
      if (!this.authorized || !this.protocol) throw new Error("\u8BF7\u5148\u901A\u8FC7\u8BBE\u5907\u6388\u6743");
      if (this.pendingReservation) throw new Error("\u6B63\u5728\u7B49\u5F85\u9884\u7EA6\u56DE\u6267\uFF0C\u8BF7\u52FF\u540C\u65F6\u53D1\u9001\u540C\u6B65\u6307\u4EE4");
      await this.write(syncClock(this.protocol), "clock-sync");
      this.emit({ type: "notice", message: "\u5DF2\u53D1\u9001\u8BBE\u5907\u65F6\u949F\u540C\u6B65\u5E27\uFF0C\u7B49\u5F85\u72B6\u6001\u901A\u77E5\u3002" });
    }
    control(action) {
      if (!this.authorized || !this.protocol || !this.latest || Date.now() - this.latestAt > 2e4) throw new Error("\u8BBE\u5907\u72B6\u6001\u4E0D\u5B58\u5728\u6216\u5DF2\u8FC7\u671F\uFF1B\u8BF7\u5148\u5237\u65B0\u72B6\u6001");
      if (this.pendingControl || this.pendingReservation) throw new Error("\u4E0A\u4E00\u6761\u6307\u4EE4\u5C1A\u672A\u786E\u8BA4");
      const s = this.latest;
      if (action === "start" && (s.state !== "2" || s.gunFlag === "1" || s.selfStartFlag === "2" || s.mode === "3")) throw new Error("\u8BBE\u5907\u5F53\u524D\u4E0D\u6EE1\u8DB3\u542F\u52A8\u6761\u4EF6\uFF1A\u9700\u5C31\u7EEA\u3001\u63D2\u67AA\u3001\u65E0\u9884\u7EA6\u6216\u5373\u63D2\u5373\u5145\u51B2\u7A81");
      if (action === "stop" && s.state !== "4") throw new Error("\u53EA\u6709\u5145\u7535\u4E2D\u624D\u80FD\u505C\u6B62");
      if (action === "unlock" && (s.state === "4" || s.mode === "3" || s.lock === "0")) throw new Error("\u5145\u7535\u4E2D\u3001\u9884\u7EA6\u6A21\u5F0F\u6216\u5DF2\u89E3\u9501\u65F6\u4E0D\u80FD\u6267\u884C\u89E3\u9501");
      const frame = command(this.protocol, action);
      this.diagnose("control-request", { action, state: s.state });
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => this.rejectControl(new Error("\u8BBE\u5907\u672A\u8FD4\u56DE\u786E\u8BA4\u72B6\u6001\uFF1B\u5B9E\u9645\u72B6\u6001\u672A\u77E5\uFF0C\u8BF7\u5237\u65B0\u6838\u5BF9\uFF0C\u52FF\u76F4\u63A5\u91CD\u8BD5"), "timeout"), 1e4);
        this.pendingControl = { action, resolve, reject, timer };
        void this.write(frame, action).catch((error) => this.rejectControl(new Error(`\u53D1\u9001\u6307\u4EE4\u5931\u8D25\uFF1A${message(error)}`), "write-error"));
      });
    }
    submitReservation(reservation) {
      return this.reserve("submit", reservation);
    }
    cancelReservation() {
      return this.reserve("cancel");
    }
    reserve(action, reservation) {
      if (!this.authorized || !this.protocol || !this.latest || Date.now() - this.latestAt > 2e4) throw new Error("\u8BBE\u5907\u72B6\u6001\u4E0D\u5B58\u5728\u6216\u5DF2\u8FC7\u671F\uFF1B\u8BF7\u5148\u5237\u65B0\u72B6\u6001");
      if (this.pendingControl || this.pendingReservation || this.pendingAuth) throw new Error("\u4E0A\u4E00\u6761\u6307\u4EE4\u5C1A\u672A\u786E\u8BA4");
      const status2 = this.latest;
      if (action === "submit" && (status2.state !== "2" || status2.gunFlag === "1" || status2.lock === "0" || status2.selfStartFlag === "2" || status2.mode === "5")) {
        throw new Error("\u9884\u7EA6\u9700\u8981\u8BBE\u5907\u5C31\u7EEA\u3001\u5DF2\u63D2\u67AA\u4E0A\u9501\uFF0C\u4E14\u672A\u542F\u7528\u5373\u63D2\u5373\u5145\u6216\u65E0\u611F\u5145\u7535");
      }
      if (action === "cancel" && (status2.state === "4" || !this.canCancelReservation)) throw new Error("\u672A\u786E\u8BA4\u8BBE\u5907\u5904\u4E8E\u53EF\u53D6\u6D88\u7684\u9884\u7EA6\u72B6\u6001\uFF1B\u8BF7\u5148\u5237\u65B0\u72B6\u6001");
      const frame = reservationCommand(this.protocol, action, reservation);
      this.diagnose("reservation-request", { action, end: reservation?.end.kind ?? "none", state: status2.state });
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => this.rejectReservation(new Error("\u672A\u6536\u5230\u8BBE\u5907\u9884\u7EA6\u56DE\u6267\uFF1B\u5B9E\u9645\u7ED3\u679C\u672A\u77E5\uFF0C\u8BF7\u5237\u65B0\u6838\u5BF9\uFF0C\u52FF\u76F4\u63A5\u91CD\u8BD5"), "timeout"), 1e4);
        this.pendingReservation = { action, resolve, reject, timer };
        void this.write(frame, `reservation-${action}`).catch((error) => this.rejectReservation(new Error(`\u53D1\u9001\u9884\u7EA6\u6307\u4EE4\u5931\u8D25\uFF1A${message(error)}`), "write-error"));
      });
    }
    rejectReservation(error, reason = "unknown") {
      if (!this.pendingReservation) return;
      const pending = this.pendingReservation;
      this.pendingReservation = null;
      clearTimeout(pending.timer);
      this.diagnose("reservation-unconfirmed", { action: pending.action, reason }, "warn");
      pending.reject(error);
    }
    rejectControl(error, reason = "unknown") {
      if (!this.pendingControl) return;
      const pending = this.pendingControl;
      this.pendingControl = null;
      clearTimeout(pending.timer);
      this.diagnose("control-unconfirmed", { action: pending.action, reason }, "warn");
      pending.reject(error);
    }
    confirmControl() {
      if (!this.pendingControl) return;
      const pending = this.pendingControl;
      this.pendingControl = null;
      clearTimeout(pending.timer);
      this.diagnose("control-confirmed", { action: pending.action });
      pending.resolve();
    }
    onBytes(view) {
      const frames = this.decoder.feed(decodeAscii(view));
      this.rxNotifications++;
      this.rxBytes += view.byteLength;
      this.decodedFrames += frames.length;
      if (frames.some((frame) => frame.type !== "status") || this.rxNotifications <= 6 || !(this.rxNotifications & this.rxNotifications - 1)) {
        this.diagnose("rx-notification", {
          bytes: view.byteLength,
          parsed: frames.length,
          notifications: this.rxNotifications,
          totalBytes: this.rxBytes,
          totalParsed: this.decodedFrames
        });
      }
      for (const frame of frames) this.onFrame(frame);
    }
    onFrame(frame) {
      if (frame.type !== "status") this.diagnose("rx-frame", { type: frame.type, version: frame.protocol });
      if (!this.protocol) this.chooseProtocol(frame.protocol, "\u8BBE\u5907\u901A\u77E5");
      if (frame.protocol !== this.protocol) {
        this.diagnose("protocol-mismatch", { expected: this.protocol, actual: frame.protocol, type: frame.type }, "warn");
        this.emit({ type: "notice", message: "\u6536\u5230\u53E6\u4E00\u79CD\u534F\u8BAE\u7684\u62A5\u6587\uFF1B\u5DF2\u5FFD\u7565\uFF0C\u4E0D\u4F1A\u81EA\u52A8\u5207\u6362\u6388\u6743\u534F\u8BAE\u3002" });
        return;
      }
      if (frame.type === "auth" && !this.pendingAuth) {
        this.diagnose("auth-reply-ignored", { reason: "no-pending" }, "warn");
        return;
      }
      if (frame.type === "auth" && this.pendingAuth) {
        this.diagnose("auth-reply", { accepted: frame.ok });
        if (!frame.ok) {
          this.rejectAuth(new Error("\u8BBE\u5907\u62D2\u7EDD\u84DD\u7259\u9A8C\u8BC1\u7801"), "rejected");
          return;
        }
        const pending = this.pendingAuth;
        this.pendingAuth = null;
        clearTimeout(pending.timer);
        const vault = this.loadVault();
        const device = this.device;
        vault.lastId = device.id;
        vault.devices[device.id] = { name: device.name || "\u672A\u547D\u540D\u8BBE\u5907", protocol: this.protocol, ...pending.remember ? { password: pending.password } : {} };
        const persisted = this.storeVault(vault);
        this.diagnose("auth-saved", { remembered: pending.remember, persisted, version: this.protocol });
        this.setPhase("ready", "\u8BBE\u5907\u786E\u8BA4\u6388\u6743\u6210\u529F\uFF1B\u53EF\u4EE5\u8BFB\u53D6\u72B6\u6001\u5E76\u63A7\u5236\u3002");
        pending.resolve();
        void this.refresh().catch((error) => this.emit({ type: "notice", message: `\u540C\u6B65\u65F6\u949F/\u83B7\u53D6\u72B6\u6001\u5931\u8D25\uFF1A${message(error)}` }));
        return;
      }
      if (frame.type === "reservation") {
        const pending = this.pendingReservation;
        const matched = !!pending && pending.action === frame.action;
        this.diagnose("reservation-reply", { action: frame.action, accepted: frame.ok, matched });
        if (!matched || !pending) return;
        this.pendingReservation = null;
        clearTimeout(pending.timer);
        if (!frame.ok) {
          pending.reject(new Error("\u8BBE\u5907\u62D2\u7EDD\u9884\u7EA6\u64CD\u4F5C"));
          return;
        }
        this.reservationAccepted = frame.action === "submit";
        this.emit({ type: "reservation", action: frame.action, message: frame.action === "submit" ? "\u8BBE\u5907\u5DF2\u786E\u8BA4\u9884\u7EA6\u63D0\u4EA4\u3002" : "\u8BBE\u5907\u5DF2\u786E\u8BA4\u53D6\u6D88\u9884\u7EA6\u3002" });
        pending.resolve();
        return;
      }
      if (frame.type === "status" && !this.authorized) {
        this.diagnose("status-ignored", { reason: "not-authorized" });
        return;
      }
      if (frame.type === "status" && this.authorized) {
        if (this.reservationAccepted === false && frame.mode === "3") this.reservationAccepted = null;
        this.statusFrames++;
        const signature = [frame.state, frame.gunFlag, frame.mode, frame.lock, frame.selfStartFlag].join("|");
        if (signature !== this.lastStatusSignature || this.statusFrames <= 3 || !(this.statusFrames & this.statusFrames - 1)) {
          this.diagnose("status", {
            version: frame.protocol,
            state: frame.state,
            gun: frame.gunFlag,
            mode: frame.mode,
            lock: frame.lock,
            selfStart: frame.selfStartFlag,
            samples: this.statusFrames
          });
        }
        this.lastStatusSignature = signature;
        this.latest = frame;
        this.latestAt = Date.now();
        this.emit({ type: "status", status: frame });
        const action = this.pendingControl?.action;
        if (action === "start" && frame.state === "4" || action === "stop" && frame.state === "2" || action === "unlock" && frame.lock === "0") this.confirmControl();
      }
      if (frame.type === "ack" && this.pendingControl?.action === frame.action) {
        this.diagnose("control-ack", { action: frame.action, accepted: frame.ok, matched: true });
        if (!frame.ok) this.rejectControl(new Error("\u8BBE\u5907\u62D2\u7EDD\u8BE5\u5145\u7535\u64CD\u4F5C"), "rejected");
        else this.emit({ type: "notice", message: "\u8BBE\u5907\u5DF2\u63A5\u6536\u64CD\u4F5C\uFF0C\u7B49\u5F85\u72B6\u6001\u53D8\u5316\u518D\u786E\u8BA4\u5B8C\u6210\u3002" });
      } else if (frame.type === "ack") {
        this.diagnose("control-ack-ignored", { action: frame.action, reason: this.pendingControl ? "action-mismatch" : "no-pending" }, "warn");
      }
    }
    async write(text2, action) {
      if (!this.enabled()) throw new Error("\u771F\u673A\u63A7\u5236\u6A21\u5F0F\u5DF2\u5173\u95ED\uFF0C\u4E0D\u53D1\u9001\u84DD\u7259\u6307\u4EE4");
      const writer = this.writer;
      if (!writer || !this.server?.connected) throw new Error("\u84DD\u7259\u8FDE\u63A5\u5DF2\u65AD\u5F00");
      const bytes = encodeAscii(text2);
      this.diagnose("tx-attempt", { action, bytes: bytes.length });
      let method = "none";
      try {
        if (writer.properties.write && writer.writeValueWithResponse) {
          method = "with-response";
          await writer.writeValueWithResponse(bytes);
        } else if (writer.properties.writeWithoutResponse && writer.writeValueWithoutResponse) {
          method = "without-response";
          await writer.writeValueWithoutResponse(bytes);
        } else if (writer.writeValue) {
          method = "legacy";
          await writer.writeValue(bytes);
        } else throw new Error("\u8BE5\u8BBE\u5907\u7279\u5F81\u4E0D\u53EF\u5199");
        this.diagnose("tx-written", { action, method });
      } catch (error) {
        this.diagnose("tx-error", { action, method, ...diagnosticError(error) }, "error");
        throw error;
      }
    }
    disconnect() {
      this.epoch++;
      if (this.sniffTimer) clearTimeout(this.sniffTimer);
      this.sniffTimer = null;
      this.rejectAuth(new Error("\u84DD\u7259\u8FDE\u63A5\u5DF2\u65AD\u5F00"), "disconnect");
      this.rejectControl(new Error("\u84DD\u7259\u8FDE\u63A5\u5DF2\u65AD\u5F00\uFF1B\u6307\u4EE4\u5B9E\u9645\u7ED3\u679C\u672A\u77E5"), "disconnect");
      this.rejectReservation(new Error("\u84DD\u7259\u8FDE\u63A5\u5DF2\u65AD\u5F00\uFF1B\u9884\u7EA6\u5B9E\u9645\u7ED3\u679C\u672A\u77E5"), "disconnect");
      const server = this.server;
      if (this.device || server) this.diagnose("disconnect", { connected: !!server?.connected, stage: this.connectionStage });
      this.device?.removeEventListener("gattserverdisconnected", this.onDisconnected);
      if (this.notifier && this.listener) this.notifier.removeEventListener("characteristicvaluechanged", this.listener);
      this.device = null;
      this.server = null;
      this.writer = null;
      this.notifier = null;
      this.listener = null;
      try {
        if (server?.connected) server.disconnect();
      } catch {
      }
      this.protocol = null;
      this.latest = null;
      this.latestAt = 0;
      this.autoLoginTried = false;
      this.reservationAccepted = null;
      this.decoder.reset();
      this.rxNotifications = 0;
      this.rxBytes = 0;
      this.decodedFrames = 0;
      this.statusFrames = 0;
      this.lastStatusSignature = "";
      this.connectionStage = "offline";
      this.connectedAt = 0;
      this.setPhase("offline", "\u672A\u8FDE\u63A5\u5145\u7535\u6869");
    }
  };

  // src/build-info.ts
  function formatBuildInfo(info) {
    const date = new Date(info.builtAt);
    const time = Number.isFinite(date.getTime()) ? `${date.toISOString().slice(0, 19).replace("T", " ")} UTC` : "\u672A\u77E5";
    return `\u7248\u672C v${info.version} \xB7 \u63D0\u4EA4 ${info.revision} \xB7 \u6784\u5EFA ${time}`;
  }

  // src/countdown.ts
  function countdownTo(startAtMs, nowMs = Date.now()) {
    if (!Number.isFinite(startAtMs) || !Number.isFinite(nowMs)) throw new Error("\u9884\u7EA6\u5012\u8BA1\u65F6\u7684\u65F6\u95F4\u65E0\u6548");
    const seconds = Math.max(0, Math.ceil((startAtMs - nowMs) / 1e3));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds % 3600 / 60);
    const remainingSeconds = seconds % 60;
    return [hours, minutes, remainingSeconds].map((value) => String(value).padStart(2, "0")).join(":");
  }

  // src/main.ts
  function el(id) {
    const node = document.getElementById(id);
    if (!node) throw new Error(`\u7F51\u9875\u7F3A\u5C11\u5FC5\u8981\u5143\u7D20\uFF1A${id}`);
    return node;
  }
  var text = (id, value) => {
    el(id).textContent = value;
  };
  text("buildInfo", formatBuildInfo({ version: "0.1.0", revision: "89f533e", builtAt: "2026-09-27T04:38:08.395Z" }));
  var adapter = navigator.bluetooth;
  var diagnostics = new Diagnostics();
  var client = adapter ? new ChargerClient(adapter, handleEvent, () => window.isSecureContext, (event, data, level) => {
    diagnostics.add(event, data, level);
    refreshDiagnostics();
  }) : null;
  var phase = "offline";
  var busy = false;
  var statusAt = 0;
  var reservationResult = "";
  var reservationStartAutomatic = true;
  var confirmedReservation = null;
  var recentMessages = [];
  var pad2 = (value) => String(value).padStart(2, "0");
  function localMinute(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }
  function resetReservationStart() {
    reservationStartAutomatic = true;
    const input = el("reserveStart");
    input.defaultValue = localMinute(nextMidnight());
    input.value = input.defaultValue;
  }
  function selectedReservation() {
    const start = parseLocalMinute(el("reserveStart").value);
    const kind = el("reserveEnd").value;
    let end;
    if (kind === "full") end = { kind: "full" };
    else if (kind === "time") end = { kind: "time", minutes: Number(el("reserveHours").value) * 60 };
    else if (kind === "energy") end = { kind: "energy", kWh: Number(el("reserveEnergy").value) };
    else throw new Error("\u672A\u77E5\u7684\u9884\u7EA6\u7ED3\u675F\u65B9\u5F0F");
    const reservation = { start, end };
    validateReservation(reservation);
    return reservation;
  }
  function endLabel(end) {
    return end.kind === "full" ? "\u81EA\u52A8\u5145\u6EE1" : end.kind === "time" ? `\u5145\u7535 ${end.minutes / 60} \u5C0F\u65F6` : `\u5145\u7535 ${end.kWh} \u5EA6`;
  }
  function updateReservationCountdown() {
    const box = el("reserveCountdownBox");
    const currentDeviceId = client?.currentDevice?.id;
    if (!confirmedReservation || currentDeviceId && currentDeviceId !== confirmedReservation.deviceId) {
      box.hidden = true;
      return;
    }
    const now = Date.now();
    const status2 = client?.currentStatus;
    if (client?.authorized && status2 && now - statusAt < 2e4 && status2.state === "4") {
      confirmedReservation = null;
      box.hidden = true;
      return;
    }
    box.hidden = false;
    text("reserveCountdown", countdownTo(confirmedReservation.startsAt, now));
    text("reserveCountdownLabel", now < confirmedReservation.startsAt ? "\u540E\u5F00\u59CB\u5145\u7535\uFF08\u672C\u5730\u65F6\u949F\u4F30\u7B97\uFF09" : "\u9884\u7EA6\u65F6\u95F4\u5DF2\u5230\uFF0C\u7B49\u5F85\u8BBE\u5907\u72B6\u6001\u786E\u8BA4");
  }
  function environment() {
    const scheme = location.protocol === "https:" ? "https" : location.protocol === "file:" ? "file" : ["localhost", "127.0.0.1"].includes(location.hostname) ? "localhost" : "other";
    return { secureContext: window.isSecureContext, webBluetooth: !!adapter, getDevices: !!adapter?.getDevices, scheme };
  }
  function refreshDiagnostics(force = false) {
    const area = el("diagnosticsText");
    if (force || document.activeElement !== area) area.value = diagnostics.exportText(environment());
    if (!diagnostics.storageAvailable) text("diagnosticsHint", "\u6D4F\u89C8\u5668\u672A\u5141\u8BB8\u672C\u5730\u4FDD\u5B58\uFF1B\u5173\u95ED\u9875\u9762\u540E\u65E5\u5FD7\u53EF\u80FD\u4E22\u5931\u3002\u8BF7\u5148\u590D\u5236\u4E0A\u65B9\u6587\u672C\u3002");
  }
  var stateName = (status2) => {
    if (!status2) return "\u7B49\u5019\u8BBE\u5907\u5B9E\u65F6\u72B6\u6001";
    if (status2.state === "4") return "\u5145\u7535\u4E2D";
    if (status2.state === "3") return "\u8BBE\u5907\u62A5\u51FA\u6545\u969C";
    if (status2.state === "2") return "\u5DF2\u5C31\u7EEA";
    return `\u8BBE\u5907\u72B6\u6001 ${status2.state || "\u672A\u77E5"}\uFF08\u542B\u4E49\u672A\u6838\u5B9E\uFF09`;
  };
  function record(message2) {
    recentMessages.unshift(message2);
    if (recentMessages.length > 6) recentMessages.length = 6;
    text("liveLog", recentMessages.join("\n"));
  }
  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }
  function failure(action, error) {
    diagnostics.add("ui-error", { action, ...diagnosticError(error) }, "error");
    refreshDiagnostics();
    record(`${action}\u5931\u8D25\uFF1A${errorMessage(error)}`);
  }
  function handleEvent(event) {
    if (event.type === "phase") {
      phase = event.phase;
      if (phase === "offline" || phase === "connecting") reservationResult = "";
      diagnostics.add("phase", { phase });
      record(event.message);
    }
    if (event.type === "notice") record(event.message);
    if (event.type === "reservation") {
      reservationResult = event.message;
      record(event.message);
    }
    if (event.type === "protocol") record(`\u534F\u8BAE\uFF1A${event.version === 1 ? "\u65E7\u7248" : "\u65B0\u7248"}\uFF08${event.source}\uFF09`);
    if (event.type === "auth-needed") record(event.message);
    if (event.type === "status") {
      statusAt = Date.now();
      record("\u6536\u5230\u8BBE\u5907\u72B6\u6001\u901A\u77E5\u3002");
    }
    refreshDiagnostics();
    render();
  }
  function render() {
    const supported = !!adapter && window.isSecureContext;
    text("liveSupport", !window.isSecureContext ? "\u5F53\u524D\u4E0D\u662F\u5B89\u5168\u4E0A\u4E0B\u6587\uFF0CWeb Bluetooth \u4E0D\u53EF\u7528\uFF1B\u8BF7\u4ECE Bluefy \u6253\u5F00 HTTPS GitHub Pages \u5730\u5740\u3002" : !adapter ? "\u6D4F\u89C8\u5668\u672A\u63D0\u4F9B Web Bluetooth\u3002\u8BF7\u5728 iPhone \u7684 Bluefy \u4E2D\u6253\u5F00\u5DF2\u53D1\u5E03\u7684 HTTPS \u9875\u9762\u3002" : "\u68C0\u6D4B\u5230 Web Bluetooth API\uFF1B\u4ECD\u9700\u5B9E\u9645\u8BBE\u5907\u6388\u6743\u4E0E\u901A\u4FE1\u6D4B\u8BD5\u3002");
    el("liveSupport").className = `notice ${supported ? "light" : ""}`;
    const device = client?.currentDevice;
    const status2 = client?.currentStatus ?? null;
    const fresh = !!status2 && Date.now() - statusAt < 2e4;
    text("liveDevice", device ? `${device.name || "\u672A\u547D\u540D\u8BBE\u5907"} \xB7 ${client?.authorized ? "\u5DF2\u6388\u6743" : "\u672A\u6388\u6743"}` : client?.rememberedName ? `\u4E0A\u6B21\u8BBE\u5907\uFF1A${client.rememberedName}\uFF08\u672A\u8FDE\u63A5\uFF09` : "\u5C1A\u672A\u9009\u62E9\u8BBE\u5907");
    text("liveState", client?.authorized ? stateName(status2) : "\u672A\u53D6\u5F97\u8BBE\u5907\u5B9E\u65F6\u72B6\u6001");
    text("livePhase", client?.authorized ? "\u5DF2\u6388\u6743" : phase === "offline" ? "\u672A\u8FDE\u63A5" : phase === "password" ? "\u5F85\u8F93\u5165\u5BC6\u7801" : phase === "authenticating" ? "\u7B49\u8BBE\u5907\u786E\u8BA4" : "\u8FDE\u63A5\u4E2D");
    text("liveProtocolName", client?.currentProtocol === 1 ? "\u65E7\u7248\u534F\u8BAE" : client?.currentProtocol === 2 ? "\u65B0\u7248\u534F\u8BAE" : "\u7B49\u5F85\u8BC6\u522B");
    text("liveSoc", status2 && Number.isFinite(status2.soc) ? `${status2.soc}%` : "--");
    text("liveEnergy", status2 && Number.isFinite(status2.energyKWh) ? `${status2.energyKWh.toFixed(1)} kWh` : "--");
    text("liveMinutes", status2 && Number.isFinite(status2.minutes) ? `${status2.minutes} min` : "--");
    text("liveElectrical", status2 ? `\u7535\u538B ${status2.voltage} V \xB7 \u7535\u6D41 ${status2.currentA ?? "--"} A \xB7 \u529F\u7387\u539F\u503C ${status2.power}\uFF08\u5355\u4F4D\u672A\u6838\u5B9E\uFF09` : "\u65E0\u8BBE\u5907\u6570\u636E");
    text("liveFreshness", !status2 ? "\u5C1A\u672A\u6536\u5230\u8BBE\u5907\u72B6\u6001" : fresh ? "\u8BBE\u5907\u72B6\u6001\uFF1A\u521A\u66F4\u65B0\uFF08\u5B9E\u65F6\u901A\u77E5\uFF09" : "\u8BBE\u5907\u72B6\u6001\u5DF2\u8FC7\u671F\uFF0C\u64CD\u4F5C\u5DF2\u7981\u7528\uFF0C\u8BF7\u5237\u65B0");
    el("liveAuthBox").hidden = !device || !!client?.authorized;
    el("liveAuthorize").disabled = !client?.currentProtocol || phase === "authenticating" || busy;
    el("liveStart").disabled = !client?.authorized || !fresh || busy || !status2 || status2.state !== "2" || status2.gunFlag === "1" || status2.selfStartFlag === "2" || status2.mode === "3";
    el("liveStop").disabled = !client?.authorized || !fresh || busy || status2?.state !== "4";
    el("liveUnlock").disabled = !client?.authorized || !fresh || busy || !status2 || status2.state === "4" || status2.mode === "3" || status2.lock === "0";
    el("liveRefresh").disabled = !client?.authorized || busy;
    el("liveDisconnect").disabled = !device;
    el("liveChoose").disabled = !supported || busy;
    el("liveForgetPassword").disabled = !client?.rememberedName;
    const reservable = !!client?.authorized && fresh && !!status2 && status2.state === "2" && status2.gunFlag !== "1" && status2.lock !== "0" && status2.selfStartFlag !== "2" && status2.mode !== "5";
    el("reserveSubmit").disabled = !reservable || busy || !!client?.reservationPending;
    text("reserveSubmit", client?.canCancelReservation ? "\u4FEE\u6539\u9884\u7EA6" : "\u63D0\u4EA4\u9884\u7EA6");
    el("reserveCancel").disabled = !client?.authorized || !fresh || busy || !!client?.reservationPending || status2?.state === "4" || !client?.canCancelReservation;
    const reserveInput = el("reserveStart");
    if (reservationStartAutomatic && reserveInput.value !== localMinute(nextMidnight())) resetReservationStart();
    reserveInput.min = localMinute(/* @__PURE__ */ new Date());
    reserveInput.max = localMinute(new Date(Date.now() + 24 * 60 * 60 * 1e3));
    text("reserveState", !client?.authorized ? "\u8FDE\u63A5\u5E76\u6388\u6743\u540E\u53EF\u9884\u7EA6\u3002" : client.reservationPending ? "\u6307\u4EE4\u5DF2\u53D1\u9001\uFF0C\u7B49\u5F85\u8BBE\u5907\u9884\u7EA6\u56DE\u6267\uFF1B\u6B64\u65F6\u52FF\u91CD\u590D\u63D0\u4EA4\u3002" : reservationResult || !fresh ? reservationResult || "\u7B49\u5F85\u6700\u65B0\u8BBE\u5907\u72B6\u6001\uFF0C\u64CD\u4F5C\u6682\u4E0D\u53EF\u7528\u3002" : status2?.mode === "3" ? "\u8BBE\u5907\u901A\u77E5\u663E\u793A\u9884\u7EA6\u6A21\u5F0F\uFF1B\u53EF\u4FEE\u6539\u6216\u53D6\u6D88\u3002" : client.canCancelReservation ? "\u8BBE\u5907\u5DF2\u786E\u8BA4\u63D0\u4EA4\uFF0C\u5C1A\u5F85\u65B0\u7684\u9884\u7EA6\u6A21\u5F0F\u72B6\u6001\u901A\u77E5\u3002" : "\u8BBE\u5907\u672A\u62A5\u544A\u9884\u7EA6\u6A21\u5F0F\uFF1B\u53EF\u8BBE\u7F6E\u65B0\u7684\u9884\u7EA6\u3002");
    updateReservationCountdown();
  }
  function selectedProtocol() {
    const value = el("liveProtocol").value;
    return value === "1" ? 1 : value === "2" ? 2 : void 0;
  }
  el("liveChoose").addEventListener("click", () => {
    if (!client) return;
    void client.chooseDevice(selectedProtocol()).catch((error) => failure("\u9009\u62E9/\u8FDE\u63A5", error));
  });
  el("liveProtocol").addEventListener("change", () => {
    const version = selectedProtocol();
    if (!version || !client?.currentDevice || client.authorized) return;
    try {
      client.chooseProtocol(version);
    } catch (error) {
      failure("\u5207\u6362\u534F\u8BAE", error);
    }
    render();
  });
  el("liveAuthorize").addEventListener("click", () => {
    if (!client) return;
    const input = el("livePassword");
    const password = input.value;
    if (!/^\d{5}$/.test(password)) {
      diagnostics.add("auth-input-invalid");
      record("\u84DD\u7259\u9A8C\u8BC1\u7801\u5FC5\u987B\u662F\u4E94\u4F4D\u6570\u5B57\u3002");
      return;
    }
    input.value = "";
    const remember = el("rememberPassword").checked;
    void client.login(password, remember).catch((error) => failure("\u6388\u6743", error));
  });
  el("liveRefresh").addEventListener("click", () => {
    if (!client) return;
    if (!window.confirm("\u5C06\u5411\u5145\u7535\u6869\u53D1\u9001\u65E7\u5E94\u7528\u4F7F\u7528\u7684\u201C\u540C\u6B65\u8BBE\u5907\u65F6\u949F\u201D\u6307\u4EE4\uFF0C\u5E76\u7B49\u5F85\u72B6\u6001\u901A\u77E5\u3002\u7EE7\u7EED\u5417\uFF1F")) {
      diagnostics.add("ui-cancelled", { action: "clock-sync" });
      refreshDiagnostics();
      return;
    }
    void client.refresh().catch((error) => failure("\u540C\u6B65\u72B6\u6001", error));
  });
  async function control(action) {
    if (!client) return;
    const name = { start: "\u5F00\u59CB\u5145\u7535", stop: "\u505C\u6B62\u5145\u7535", unlock: "\u89E3\u9664\u7535\u5B50\u9501" }[action];
    if (!window.confirm(`\u786E\u5B9A\u5411\u771F\u5B9E\u5145\u7535\u6869\u53D1\u9001\u300C${name}\u300D\u6307\u4EE4\uFF1F
\u6536\u5230\u8BBE\u5907\u72B6\u6001\u53D8\u5316\u540E\u624D\u4F1A\u663E\u793A\u5B8C\u6210\u3002`)) {
      diagnostics.add("ui-cancelled", { action });
      refreshDiagnostics();
      return;
    }
    busy = true;
    render();
    record(`\u6B63\u5728\u53D1\u9001\u300C${name}\u300D\u5E76\u7B49\u5F85\u8BBE\u5907\u786E\u8BA4\u2026`);
    try {
      await client.control(action);
      record(`\u8BBE\u5907\u72B6\u6001\u5DF2\u786E\u8BA4\uFF1A${name}\u3002`);
    } catch (error) {
      failure(name, error);
    } finally {
      busy = false;
      render();
    }
  }
  for (const [id, action] of [["liveStart", "start"], ["liveStop", "stop"], ["liveUnlock", "unlock"]]) {
    el(id).addEventListener("click", () => void control(action));
  }
  el("reserveStart").addEventListener("input", () => {
    reservationStartAutomatic = false;
  });
  el("reserveTomorrow").addEventListener("click", () => {
    resetReservationStart();
    record("\u9884\u7EA6\u5F00\u59CB\u5DF2\u8BBE\u4E3A\u6B21\u65E5 00:00\uFF1B\u5C1A\u672A\u53D1\u9001\u3002");
  });
  el("reserveEnd").addEventListener("change", () => {
    const kind = el("reserveEnd").value;
    el("reserveTimeBox").hidden = kind !== "time";
    el("reserveEnergyBox").hidden = kind !== "energy";
  });
  async function reserve(action) {
    if (!client) return;
    let reservation;
    if (action === "submit") {
      try {
        reservation = selectedReservation();
      } catch (error) {
        diagnostics.add("reservation-input-error", diagnosticError(error), "warn");
        reservationResult = errorMessage(error);
        record(reservationResult);
        render();
        return;
      }
    }
    const label = action === "submit" ? "\u63D0\u4EA4\u9884\u7EA6" : "\u53D6\u6D88\u9884\u7EA6";
    const detail = reservation ? `
\u5F00\u59CB\uFF1A${localMinute(reservation.start).replace("T", " ")}\uFF08iPhone \u672C\u5730\u65F6\u95F4\uFF09
\u7ED3\u675F\uFF1A${endLabel(reservation.end)}` : "";
    if (!window.confirm(`\u786E\u5B9A\u5411\u771F\u5B9E\u5145\u7535\u6869${label}\uFF1F${detail}
\u4EC5\u6536\u5230\u8BBE\u5907\u5339\u914D\u56DE\u6267\u540E\u624D\u663E\u793A\u6210\u529F\u3002`)) {
      diagnostics.add("ui-cancelled", { action: `reservation-${action}` });
      refreshDiagnostics();
      return;
    }
    busy = true;
    reservationResult = `\u6B63\u5728${label}\uFF0C\u7B49\u5F85\u8BBE\u5907\u56DE\u6267\u2026`;
    render();
    const deviceId = client.currentDevice?.id;
    try {
      if (action === "submit") {
        await client.submitReservation(reservation);
        if (deviceId && client.currentDevice?.id === deviceId) confirmedReservation = { deviceId, startsAt: reservation.start.getTime() };
      } else {
        await client.cancelReservation();
        if (confirmedReservation?.deviceId === deviceId) confirmedReservation = null;
      }
      reservationResult = `\u8BBE\u5907\u5DF2\u786E\u8BA4${label}\uFF1B\u8BF7\u6838\u5BF9\u8BBE\u5907\u5F53\u524D\u9884\u7EA6\u72B6\u6001\u3002`;
      record(reservationResult);
    } catch (error) {
      reservationResult = `${label}\u672A\u786E\u8BA4\uFF1A${errorMessage(error)}`;
      failure(label, error);
    } finally {
      busy = false;
      render();
    }
  }
  el("reserveSubmit").addEventListener("click", () => void reserve("submit"));
  el("reserveCancel").addEventListener("click", () => void reserve("cancel"));
  el("liveDisconnect").addEventListener("click", () => {
    client?.disconnect();
    statusAt = 0;
    render();
  });
  el("liveForgetPassword").addEventListener("click", () => {
    if (!window.confirm("\u5220\u9664\u672C\u7F51\u7AD9\u4FDD\u5B58\u7684\u84DD\u7259\u9A8C\u8BC1\u7801\uFF1F\u4E0B\u6B21\u9700\u91CD\u65B0\u8F93\u5165\u3002")) return;
    client?.forgetPassword();
    diagnostics.add("password-forgotten");
    record("\u5DF2\u5220\u9664\u4FDD\u5B58\u7684\u9A8C\u8BC1\u7801\u3002");
    render();
  });
  el("liveForgetDevice").addEventListener("click", () => {
    if (!window.confirm("\u6E05\u9664\u672C\u7F51\u7AD9\u4FDD\u5B58\u7684\u5168\u90E8\u8BBE\u5907\u8BB0\u5F55\u548C\u9A8C\u8BC1\u7801\uFF0C\u5E76\u65AD\u5F00\u8FDE\u63A5\uFF1F")) return;
    client?.forgetDevice();
    statusAt = 0;
    confirmedReservation = null;
    diagnostics.add("device-records-forgotten");
    render();
  });
  el("copyDiagnostics").addEventListener("click", async () => {
    const value = diagnostics.exportText(environment());
    const area = el("diagnosticsText");
    area.value = value;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(value);
      text("diagnosticsHint", "\u65E5\u5FD7\u5DF2\u590D\u5236\u3002\u8D34\u51FA\u4E4B\u524D\u5EFA\u8BAE\u68C0\u67E5\u6587\u672C\u5185\u5BB9\u3002");
      diagnostics.add("log-copied", { method: "clipboard" });
    } catch {
      area.focus();
      area.select();
      let copied = false;
      try {
        copied = document.execCommand("copy");
      } catch {
      }
      text("diagnosticsHint", copied ? "\u65E5\u5FD7\u5DF2\u590D\u5236\uFF08\u517C\u5BB9\u65B9\u5F0F\uFF09\u3002" : "\u6D4F\u89C8\u5668\u7981\u6B62\u81EA\u52A8\u590D\u5236\uFF1B\u8BF7\u957F\u6309\u4E0A\u65B9\u6587\u672C\uFF0C\u5168\u9009\u540E\u624B\u52A8\u590D\u5236\u3002");
      diagnostics.add("log-copy-fallback", { copied }, copied ? "info" : "warn");
    }
  });
  el("selectDiagnostics").addEventListener("click", () => {
    const area = el("diagnosticsText");
    area.value = diagnostics.exportText(environment());
    area.focus();
    area.select();
    text("diagnosticsHint", "\u5DF2\u9009\u4E2D\u65E5\u5FD7\uFF1B\u53EF\u4EE5\u4F7F\u7528\u6D4F\u89C8\u5668\u590D\u5236\u83DC\u5355\u3002\u82E5\u672A\u9009\u4E2D\uFF0C\u8BF7\u957F\u6309\u6587\u672C\u624B\u52A8\u5168\u9009\u3002");
  });
  el("clearDiagnostics").addEventListener("click", () => {
    if (!window.confirm("\u6E05\u7A7A\u6B64\u6D4F\u89C8\u5668\u4FDD\u5B58\u7684\u8BCA\u65AD\u65E5\u5FD7\uFF1F\u4E0D\u4F1A\u5220\u9664\u5DF2\u4FDD\u5B58\u7684\u8BBE\u5907\u548C\u9A8C\u8BC1\u7801\u3002")) return;
    diagnostics.clear();
    recentMessages.length = 0;
    text("liveLog", "\u8BCA\u65AD\u65E5\u5FD7\u5DF2\u6E05\u7A7A\u3002");
    refreshDiagnostics(true);
    text("diagnosticsHint", "\u65E5\u5FD7\u5DF2\u6E05\u7A7A\u3002\u65B0\u7684\u8BBE\u5907\u4E8B\u4EF6\u4F1A\u91CD\u65B0\u5F00\u59CB\u8BB0\u5F55\u3002");
  });
  resetReservationStart();
  diagnostics.add("app-start", {
    ...environment(),
    schema: 3,
    buildVersion: "0.1.0",
    buildRevision: "89f533e",
    buildTimeUTC: "2026-09-27T04:38:08.395Z"
  });
  refreshDiagnostics(true);
  render();
  setInterval(render, 5e3);
  setInterval(updateReservationCountdown, 1e3);
  document.addEventListener("visibilitychange", updateReservationCountdown);
  if (client?.rememberedName && window.isSecureContext) {
    diagnostics.add("restore-auto-start", { remembered: true });
    refreshDiagnostics();
    record("\u5C1D\u8BD5\u6062\u590D\u4E0A\u6B21\u8BBE\u5907\u7684\u6D4F\u89C8\u5668\u6388\u6743\u2026");
    void client.restore().then((restored) => {
      if (!restored) record("\u672A\u627E\u5230\u53EF\u6062\u590D\u7684\u8BBE\u5907\uFF0C\u8BF7\u70B9\u51FB\u300C\u9009\u62E9 / \u66F4\u6362\u8BBE\u5907\u300D\u624B\u52A8\u8FDE\u63A5\u3002");
      render();
    });
  } else {
    diagnostics.add("restore-auto-skipped", { reason: !client ? "no-bluetooth-api" : !window.isSecureContext ? "insecure-context" : "no-record" });
    refreshDiagnostics();
  }
})();
