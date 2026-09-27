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
  function adminCommand(protocol, action, password) {
    const needsValue = action === "admin-auth" || action === "bluetooth-password" || action === "admin-password";
    if (needsValue && !/^\d{5}$/.test(password ?? "")) throw new Error("\u7BA1\u7406\u5458\u9A8C\u8BC1\u6216\u65B0\u5BC6\u7801\u987B\u4E3A\u4E94\u4F4D\u6570\u5B57");
    if (action !== "admin-auth" && needsValue && Number(password) > 65535) throw new Error("\u65B0\u5BC6\u7801\u4E0D\u80FD\u5927\u4E8E 65535");
    if (!needsValue && password !== void 0) throw new Error("\u6B64\u7BA1\u7406\u64CD\u4F5C\u4E0D\u5F97\u643A\u5E26\u5BC6\u7801");
    if (protocol === 1) {
      if (["mute-on", "mute-off", "pair"].includes(action)) throw new Error("\u65E7\u7248\u534F\u8BAE\u6CA1\u6709\u6B64\u7BA1\u7406\u529F\u80FD");
      if (needsValue) {
        const selector2 = action === "admin-auth" ? "1" : action === "bluetooth-password" ? "2" : "4";
        return appendChecksum(`8010${selector2}000${password}000006`);
      }
      const selector = action === "plug-on" ? "8" : "9";
      return appendChecksum(`801${selector}6${"0".repeat(13)}6`);
    }
    const codes = {
      "admin-auth": "120",
      "plug-on": "110",
      "plug-off": "112",
      "mute-on": "202",
      "mute-off": "202",
      "pair": "136",
      "bluetooth-password": "118",
      "admin-password": "132"
    };
    const value = action === "mute-on" || action === "pair" ? "1" : action === "mute-off" ? "0" : needsValue ? password : "@";
    return action === "plug-on" || action === "plug-off" ? `@%PD-${codes[action]}-0-181-@` : `@%PD-${codes[action]}-0-181-${value}-@`;
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
    const adminCodes = { "121": "admin-auth", "111": "plug-on", "113": "plug-off", "119": "bluetooth-password", "133": "admin-password", "203": "mute", "137": "pair" };
    if (adminCodes[code] && (parts[4] === "0" || parts[4] === "1")) return { type: "admin", protocol: 2, action: adminCodes[code], ok: parts[4] === "1", code: parts[4] };
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
      const kind = first[3] + second[3];
      const adminKinds = {
        "44": ["admin-auth", 7],
        "55": ["bluetooth-password", 8],
        "66": ["plug-on", 9],
        "77": ["plug-off", 10],
        "88": ["admin-password", 11]
      };
      const admin = adminKinds[kind];
      if (admin) {
        const response = first[admin[1]] + second[admin[1]];
        return { type: "admin", protocol: 1, action: admin[0], ok: response === "33" && kind === "44" || response === "22" && kind !== "44", code: response };
      }
      const code = first[5] + second[5];
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
        "WattSaving diagnostics v5 (no passwords, device IDs or raw BLE frames)",
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

  // src/experimental.ts
  function experimentalGearCommand(pile, gun, gear) {
    if (!/^[0-9a-fA-F]{8}$/.test(pile)) throw new Error("\u6869\u7F16\u7801\u987B\u4E3A\u4ECE App \u5B9E\u5305\u6838\u5B9E\u7684 8 \u4F4D\u5341\u516D\u8FDB\u5236\u6570");
    if (!/^[0-9a-fA-F]{2}$/.test(gun)) throw new Error("\u67AA\u53F7\u987B\u4E3A\u4ECE App \u5B9E\u5305\u6838\u5B9E\u7684 2 \u4F4D\u5341\u516D\u8FDB\u5236\u6570");
    if (!Number.isInteger(gear) || gear < 0 || gear > 3) throw new Error("\u5B9E\u9A8C\u6027\u6863\u4F4D\u4EC5\u5141\u8BB8 0\uFF5E3");
    const frame = new Uint8Array(new ArrayBuffer(11));
    frame.set([35, 11, 50]);
    for (let i = 0; i < 4; i++) frame[3 + i] = Number.parseInt(pile.slice(i * 2, i * 2 + 2), 16);
    frame[7] = Number.parseInt(gun, 16);
    frame[8] = gear;
    frame[9] = 102;
    frame[10] = frame.slice(0, 10).reduce((sum, byte) => sum + byte, 0) & 255;
    return frame;
  }
  function parseExperimentalFrame(bytes) {
    if (bytes.length < 5 || bytes.length !== bytes[1] || bytes[0] !== 35 || bytes[bytes.length - 2] !== 102 || (bytes.slice(0, -1).reduce((sum, byte) => sum + byte, 0) & 255) !== bytes[bytes.length - 1]) return null;
    if (bytes[2] === 130 && bytes.length >= 11) return { type: "gear-reply", code: bytes[8], accepted: bytes[8] === 1 };
    if (bytes[2] === 84 && bytes.length >= 55) return {
      type: "power-report",
      powerTenths: bytes[50] | bytes[51] << 8,
      gear: bytes[52]
    };
    return null;
  }
  var ExperimentalDecoder = class {
    constructor() {
      __publicField(this, "buffer", []);
    }
    reset() {
      this.buffer = [];
    }
    feed(chunk) {
      const frames = [];
      const text2 = [];
      for (const byte of chunk) {
        this.buffer.push(byte);
        while (this.buffer.length) {
          if (this.buffer[0] !== 35) {
            text2.push(this.buffer.shift());
            continue;
          }
          if (this.buffer.length < 2) break;
          const length = this.buffer[1];
          if (length < 5 || length > 128) {
            text2.push(this.buffer.shift());
            continue;
          }
          if (this.buffer.length < length) break;
          const packet = Uint8Array.from(this.buffer.slice(0, length));
          const valid = packet[0] === 35 && packet[1] === length && packet[length - 2] === 102 && (packet.slice(0, -1).reduce((sum, part) => sum + part, 0) & 255) === packet[length - 1];
          if (!valid) {
            text2.push(this.buffer.shift());
            continue;
          }
          this.buffer.splice(0, length);
          const parsed = parseExperimentalFrame(packet);
          if (parsed) frames.push(parsed);
        }
      }
      return { frames, text: Uint8Array.from(text2) };
    }
  };

  // src/ble.ts
  var KEY2 = "wattsaving-ble-devices-v1";
  var AUTH_MODE_KEY = "wattsaving-auth-always-ask-v1";
  var UUID = (short) => `0000${short}-0000-1000-8000-00805f9b34fb`;
  var SERVICES = ["ff00", "ffe0", "ffe5"].map(UUID);
  var NOTIFY_SERVICES = /* @__PURE__ */ new Set(["ff00", "ffe0"]);
  var WRITE_SERVICES = /* @__PURE__ */ new Set(["ff00", "ffe5"]);
  var NOTIFY = /* @__PURE__ */ new Set([UUID("ff01"), UUID("ffe4")]);
  var PAIR_NOTIFY = UUID("ff03");
  var WRITE = /* @__PURE__ */ new Set([UUID("ff02"), UUID("ffe9")]);
  var ConnectionInterruptedError = class extends Error {
    constructor() {
      super("\u84DD\u7259\u8FDE\u63A5\u5728\u670D\u52A1\u53D1\u73B0\u671F\u95F4\u5DF2\u4E2D\u6B62\uFF1B\u65E0\u6CD5\u5224\u65AD\u8BBE\u5907\u7684\u670D\u52A1\u6216\u7279\u5F81\u662F\u5426\u5B58\u5728");
      this.name = "ConnectionInterruptedError";
    }
  };
  function reservationBlockReason(status2) {
    if (status2.state === "4" && status2.mode !== "3") return "\u5F53\u524D\u5904\u4E8E\u5145\u7535\u4E2D\uFF0C\u4E0D\u80FD\u8FDB\u884C\u9884\u7EA6\u64CD\u4F5C";
    if (status2.selfStartFlag === "2") return "\u8BF7\u5148\u53D6\u6D88\u5373\u63D2\u5373\u5145\u529F\u80FD";
    if (status2.mode === "5") return "\u8BF7\u5148\u53D6\u6D88\u65E0\u611F\u5145\u7535\u529F\u80FD";
    if (status2.state !== "2") return "\u8BBE\u5907\u4E0D\u5728\u5145\u7535\u51C6\u5907\u72B6\u6001\uFF0C\u8BF7\u5148\u62D4\u67AA\u518D\u63D2\u67AA";
    if (status2.gunFlag === "1") return "\u8BF7\u5148\u63D2\u67AA";
    return null;
  }
  function diagnosticUuid(value) {
    if (typeof value !== "string") return "missing";
    const id = value.toLowerCase();
    if (/^[0-9a-f]{4}$/.test(id)) return id;
    if (/^0000[0-9a-f]{4}$/.test(id)) return id.slice(4);
    const base = /^([0-9a-f]{8})-0000-1000-8000-00805f9b34fb$/.exec(id);
    if (base) return base[1].startsWith("0000") ? base[1].slice(4) : base[1];
    return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id) ? "custom128" : "unexpected-format";
  }
  function comparableUuid(value) {
    const id = value.toLowerCase();
    if (/^[0-9a-f]{4}$/.test(id)) return UUID(id);
    if (/^0000[0-9a-f]{4}$/.test(id)) return `${id}-0000-1000-8000-00805f9b34fb`;
    return id;
  }
  function uuidForm(value) {
    const id = value.toLowerCase();
    if (/^[0-9a-f]{4}$/.test(id)) return "short16";
    if (/^[0-9a-f]{8}$/.test(id)) return "short32";
    if (/^[0-9a-f]{8}-0000-1000-8000-00805f9b34fb$/.test(id)) return "standard128";
    return "other";
  }
  function message(error) {
    return error instanceof Error ? error.message : String(error);
  }
  function pageVisibility() {
    if (typeof document === "undefined") return "unavailable";
    return ["visible", "hidden", "prerender"].includes(document.visibilityState) ? document.visibilityState : "other";
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
      __publicField(this, "recentDevice", null);
      // 本次页面已授权的对象；断开后仍可直接重连。
      __publicField(this, "server", null);
      __publicField(this, "writer", null);
      __publicField(this, "notifier", null);
      __publicField(this, "pairingNotifier", null);
      __publicField(this, "listener", null);
      __publicField(this, "decoder", new FrameDecoder());
      __publicField(this, "experimentalDecoder", new ExperimentalDecoder());
      __publicField(this, "rxNotifications", 0);
      __publicField(this, "rxBytes", 0);
      __publicField(this, "decodedFrames", 0);
      __publicField(this, "unknownFrames", 0);
      __publicField(this, "statusFrames", 0);
      __publicField(this, "lastStatusSignature", "");
      __publicField(this, "epoch", 0);
      __publicField(this, "sniffTimer", null);
      __publicField(this, "autoLoginTried", false);
      __publicField(this, "autoLoginInProgress", false);
      __publicField(this, "protocol", null);
      __publicField(this, "phase", "offline");
      __publicField(this, "connectionStage", "offline");
      __publicField(this, "connectionSource", "direct");
      __publicField(this, "stageAt", 0);
      __publicField(this, "attempt", 0);
      __publicField(this, "attemptStartedAt", 0);
      __publicField(this, "connectedAt", 0);
      __publicField(this, "lastObserved", null);
      // 仅本页内保留；诊断不导出设备标识。
      __publicField(this, "latest", null);
      __publicField(this, "latestAt", 0);
      __publicField(this, "pendingAuth", null);
      __publicField(this, "pendingControl", null);
      __publicField(this, "pendingReservation", null);
      __publicField(this, "pendingAdmin", null);
      __publicField(this, "pendingGear", null);
      __publicField(this, "adminVerified", false);
      __publicField(this, "reservationAccepted", null);
      __publicField(this, "fallbackVault", { lastId: "", devices: {} });
      __publicField(this, "onDisconnected", () => {
        this.diagnose("unexpected-disconnect", {
          attempt: this.attempt,
          stage: this.connectionStage,
          phase: this.phase,
          page: pageVisibility(),
          connected: !!this.server?.connected,
          afterConnectedMs: this.connectedAt ? Math.max(0, Date.now() - this.connectedAt) : null,
          stageMs: this.stageAt ? Math.max(0, Date.now() - this.stageAt) : null,
          ...this.statusTrace(),
          pendingAuth: !!this.pendingAuth,
          pendingControl: !!this.pendingControl,
          pendingReservation: !!this.pendingReservation,
          pendingAdmin: !!this.pendingAdmin,
          pendingGear: !!this.pendingGear,
          notifications: this.rxNotifications
        }, "warn");
        this.diagnose("disconnect-rx-summary", {
          attempt: this.attempt,
          notifications: this.rxNotifications,
          totalBytes: this.rxBytes,
          parsed: this.decodedFrames,
          unknown: this.unknownFrames,
          statuses: this.statusFrames
        });
        const waitingForOperation = !!(this.pendingAuth || this.pendingControl || this.pendingReservation || this.pendingAdmin);
        const chooserStillConnecting = this.connectionSource === "chooser" && this.phase === "connecting";
        this.disconnect("gatt-event");
        this.emit({
          type: "notice",
          message: "\u8BBE\u5907\u5DF2\u65AD\u7EBF\uFF1B\u9875\u9762\u6570\u636E\u4E0D\u518D\u89C6\u4E3A\u5B9E\u65F6\u3002",
          ...waitingForOperation || chooserStillConnecting ? {} : { severity: "error" }
        });
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
    get automaticLoginPending() {
      return this.autoLoginInProgress && this.phase === "authenticating";
    }
    get reservationPending() {
      return !!this.pendingReservation;
    }
    get adminPending() {
      return !!this.pendingAdmin;
    }
    get experimentalPending() {
      return !!this.pendingGear;
    }
    get administratorAuthorized() {
      return this.authorized && this.adminVerified;
    }
    get pairingAvailable() {
      return this.protocol === 2 && !!this.pairingNotifier;
    }
    get manualBluetoothLogin() {
      try {
        return localStorage.getItem(AUTH_MODE_KEY) === "1";
      } catch {
        return false;
      }
    }
    setManualBluetoothLogin(value) {
      try {
        if (value) localStorage.setItem(AUTH_MODE_KEY, "1");
        else localStorage.removeItem(AUTH_MODE_KEY);
      } catch {
        throw new Error("\u6D4F\u89C8\u5668\u62D2\u7EDD\u4FDD\u5B58\u8BA4\u8BC1\u65B9\u5F0F");
      }
    }
    get canCancelReservation() {
      return this.reservationAccepted === null ? this.latest?.mode === "3" : this.reservationAccepted;
    }
    get rememberedName() {
      const saved = this.loadVault();
      return saved.devices[saved.lastId]?.name ?? null;
    }
    statusTrace() {
      const observed = this.lastObserved;
      if (!observed || !this.device?.id || observed.deviceId !== this.device.id) return { lastState: "unavailable", statusAgeMs: null };
      return {
        lastState: observed.state,
        lastGun: observed.gun,
        lastMode: observed.mode,
        lastLock: observed.lock,
        statusAgeMs: Math.max(0, Date.now() - observed.at)
      };
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
        this.emit({ type: "notice", message: "\u6D4F\u89C8\u5668\u672A\u5141\u8BB8\u672C\u5730\u5B58\u50A8\uFF1B\u672C\u6B21\u8BBE\u5907\u548C\u5BC6\u7801\u4E0D\u4F1A\u5728\u4E0B\u6B21\u6253\u5F00\u65F6\u4FDD\u7559\u3002", severity: "error" });
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
      this.recentDevice = device;
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
      this.disconnect("forget-device");
      this.lastObserved = null;
      this.recentDevice = null;
      this.storeVault({ lastId: "", devices: {} });
      try {
        localStorage.removeItem(AUTH_MODE_KEY);
      } catch {
      }
      this.emit({ type: "notice", message: "\u5DF2\u6E05\u9664\u8BE5\u7F51\u7AD9\u4FDD\u5B58\u7684\u8BBE\u5907\u548C\u84DD\u7259\u9A8C\u8BC1\u7801\u3002" });
    }
    setPhase(phase2, message2) {
      this.phase = phase2;
      this.emit({ type: "phase", phase: phase2, message: message2 });
    }
    async restore() {
      const id = this.loadVault().lastId;
      if (!id || !this.enabled()) {
        this.diagnose("restore-skipped", { reason: !id ? "no-record" : "control-disabled", remembered: !!id });
        return false;
      }
      let attemptedConnection = false;
      try {
        const inPage = this.recentDevice?.id === id ? this.recentDevice : null;
        if (inPage) {
          this.diagnose("restore-source", { source: "current-page" });
          attemptedConnection = true;
          await this.connect(inPage, void 0, "current-page");
          return true;
        }
        if (!this.adapter.getDevices) {
          this.diagnose("restore-unavailable", { reason: "get-devices-missing" }, "warn");
          return false;
        }
        this.diagnose("restore-search", { source: "browser-grants" });
        const devices = await this.adapter.getDevices();
        const remembered = devices.find((device) => device.id === id);
        this.diagnose("restore-result", { found: !!remembered, candidates: devices.length, enabled: this.enabled() });
        if (!remembered || !this.enabled()) {
          this.diagnose("restore-unavailable", { reason: "grant-not-returned", candidates: devices.length }, "warn");
          return false;
        }
        this.diagnose("restore-source", { source: "browser-grants" });
        attemptedConnection = true;
        await this.connect(remembered, void 0, "browser-grants");
        return true;
      } catch (error) {
        this.diagnose("restore-error", diagnosticError(error), "warn");
        this.emit({
          type: "notice",
          message: `\u6062\u590D\u4E0A\u6B21\u8BBE\u5907\u5931\u8D25\uFF1A${message(error)}\uFF1B\u8BF7\u70B9\u51FB\u9009\u62E9\u8BBE\u5907\u3002`,
          ...attemptedConnection ? {} : { severity: "error" }
        });
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
      await this.connect(device, protocol, "chooser");
    }
    async connect(device, requested, source = "direct") {
      if (!this.enabled()) throw new Error("\u771F\u673A\u63A7\u5236\u6A21\u5F0F\u672A\u542F\u7528");
      this.disconnect("replace-connection");
      const epoch = this.epoch;
      this.device = device;
      const attempt = ++this.attempt;
      this.connectionSource = source;
      const startedAt = Date.now();
      this.attemptStartedAt = startedAt;
      let stage = "gatt", stageAt = startedAt;
      this.connectionStage = stage;
      this.stageAt = stageAt;
      const markStage = (next) => {
        stage = next;
        stageAt = Date.now();
        if (epoch === this.epoch) {
          this.connectionStage = next;
          this.stageAt = stageAt;
        }
      };
      this.diagnose("gatt-connect-start", { attempt, source, page: pageVisibility(), ...this.statusTrace() });
      this.setPhase("connecting", `\u6B63\u5728\u8FDE\u63A5 ${device.name || "\u672A\u547D\u540D\u8BBE\u5907"}\u2026`);
      try {
        if (!device.gatt) throw new Error("\u8BBE\u5907\u4E0D\u63D0\u4F9B GATT \u670D\u52A1");
        const server = await device.gatt.connect();
        if (epoch !== this.epoch || !this.enabled()) {
          this.diagnose("connect-stale", { connected: server.connected, sessionChanged: epoch !== this.epoch, enabled: this.enabled() }, "warn");
          if (server.connected) {
            this.diagnose("gatt-disconnect-call", { reason: "stale-connect", stage });
            server.disconnect();
            this.diagnose("gatt-disconnect-result", { connected: server.connected });
          }
          return;
        }
        if (!server.connected) throw new ConnectionInterruptedError();
        this.server = server;
        this.connectedAt = Date.now();
        this.diagnose("gatt-connected", { attempt, connectMs: Date.now() - startedAt, page: pageVisibility() });
        this.diagnose("auth-gate", { stage: "await-characteristics" });
        this.rememberConnectedDevice(device);
        device.addEventListener("gattserverdisconnected", this.onDisconnected);
        const ensureActive = (operation, originalError) => {
          if (epoch === this.epoch && this.server === server && server.connected && this.enabled()) return;
          const cause = !server.connected ? "gatt-disconnected" : epoch !== this.epoch ? "session-ended" : !this.enabled() ? "control-disabled" : "server-replaced";
          const original = originalError === void 0 ? null : diagnosticError(originalError);
          this.diagnose("discovery-interrupted", {
            attempt,
            stage,
            operation,
            cause,
            connected: server.connected,
            stageMs: Math.max(0, Date.now() - stageAt),
            ...original ? { operationKind: original.kind, operationReason: original.reason } : {}
          }, "warn");
          throw new ConnectionInterruptedError();
        };
        ensureActive("before-services");
        let notifier = null, writer = null, pairingNotifier = null;
        let notifyService = "none", writeService = "none";
        let servicesFound = 0, missingServices = 0, failedServices = 0;
        for (const uuid of SERVICES) {
          const serviceCode = uuid.slice(4, 8);
          markStage(`service-${serviceCode}`);
          this.diagnose("service-query-start", { attempt, service: serviceCode, connected: server.connected });
          const queryAt = Date.now();
          let service;
          try {
            service = await server.getPrimaryService(uuid);
          } catch (error) {
            const details = diagnosticError(error);
            const interrupted = !server.connected || epoch !== this.epoch;
            this.diagnose("service-query-finish", {
              attempt,
              service: serviceCode,
              outcome: interrupted ? "interrupted" : details.reason === "not-found" ? "missing" : "failed",
              durationMs: Date.now() - queryAt,
              connected: server.connected
            }, interrupted ? "warn" : "info");
            ensureActive("get-service", error);
            if (details.reason === "not-found") missingServices++;
            else failedServices++;
            this.diagnose("service-unavailable", { service: serviceCode, ...details }, details.reason === "not-found" ? "info" : "warn");
            continue;
          }
          this.diagnose("service-query-finish", {
            attempt,
            service: serviceCode,
            outcome: server.connected && epoch === this.epoch ? "found" : "interrupted",
            durationMs: Date.now() - queryAt,
            connected: server.connected
          });
          ensureActive("get-service");
          servicesFound++;
          this.diagnose("service-found", { service: serviceCode });
          markStage(`characteristics-${serviceCode}`);
          this.diagnose("characteristics-query-start", { attempt, service: serviceCode, connected: server.connected });
          const characteristicsAt = Date.now();
          let characteristics;
          try {
            characteristics = await service.getCharacteristics();
          } catch (error) {
            const interrupted = !server.connected || epoch !== this.epoch;
            this.diagnose("characteristics-query-finish", {
              attempt,
              service: serviceCode,
              outcome: interrupted ? "interrupted" : "failed",
              durationMs: Date.now() - characteristicsAt,
              connected: server.connected
            }, "warn");
            ensureActive("get-characteristics", error);
            this.diagnose("characteristics-error", { service: serviceCode, ...diagnosticError(error) }, "warn");
            throw error;
          }
          this.diagnose("characteristics-query-finish", {
            attempt,
            service: serviceCode,
            outcome: server.connected && epoch === this.epoch ? "found" : "interrupted",
            durationMs: Date.now() - characteristicsAt,
            connected: server.connected
          });
          ensureActive("get-characteristics");
          this.diagnose("service-characteristics", { service: serviceCode, count: characteristics.length });
          for (const [index, characteristic] of characteristics.entries()) {
            const properties = characteristic.properties;
            const id = comparableUuid(characteristic.uuid);
            const notifyServiceAllowed = NOTIFY_SERVICES.has(serviceCode);
            const writeServiceAllowed = WRITE_SERVICES.has(serviceCode);
            const notifyUuidMatch = NOTIFY.has(id);
            const writeUuidMatch = WRITE.has(id);
            const selectedNotify = !notifier && notifyServiceAllowed && notifyUuidMatch && !!(properties?.notify || properties?.indicate);
            const selectedWrite = !writer && writeServiceAllowed && writeUuidMatch && !!(properties?.write || properties?.writeWithoutResponse);
            this.diagnose("characteristic-discovered", {
              service: serviceCode,
              index,
              uuid: diagnosticUuid(characteristic.uuid),
              uuidForm: uuidForm(characteristic.uuid),
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
            this.diagnose("characteristic-selection", {
              service: serviceCode,
              index,
              uuid: diagnosticUuid(characteristic.uuid),
              uuidForm: uuidForm(characteristic.uuid),
              notifyServiceAllowed,
              writeServiceAllowed,
              notifyUuidMatch,
              writeUuidMatch,
              notifyProperty: !!(properties?.notify || properties?.indicate),
              writeProperty: !!(properties?.write || properties?.writeWithoutResponse),
              selectedNotify,
              selectedWrite
            });
            if (selectedNotify) {
              notifier = characteristic;
              notifyService = serviceCode;
            }
            if (selectedWrite) {
              writer = characteristic;
              writeService = serviceCode;
            }
            if (serviceCode === "ff00" && id === PAIR_NOTIFY && (properties?.notify || properties?.indicate)) pairingNotifier = characteristic;
          }
          if (notifier && writer) break;
        }
        ensureActive("complete-discovery");
        this.diagnose("discovery-summary", { servicesFound, missingServices, failedServices, notify: !!notifier, write: !!writer, pairingNotify: !!pairingNotifier });
        this.diagnose("characteristics", {
          notify: !!notifier,
          write: !!writer,
          notifyService,
          notifyUuid: diagnosticUuid(notifier?.uuid),
          writeService,
          writeUuid: diagnosticUuid(writer?.uuid)
        });
        if (!notifier || !writer) {
          this.diagnose("discovery-missing", { servicesFound, failedServices, notify: !!notifier, write: !!writer }, "error");
          if (!servicesFound) throw new Error(failedServices ? "\u65E0\u6CD5\u8BFB\u53D6\u65E7\u5E94\u7528\u4F7F\u7528\u7684 BLE \u670D\u52A1\uFF1B\u4E0D\u80FD\u5224\u65AD\u7279\u5F81\u662F\u5426\u5B58\u5728" : "\u672A\u627E\u5230\u65E7\u5E94\u7528\u4F7F\u7528\u7684 BLE \u670D\u52A1\uFF1B\u4E0D\u80FD\u8BFB\u53D6\u7279\u5F81");
          throw new Error("\u627E\u4E0D\u5230\u65E7\u5E94\u7528\u4F7F\u7528\u7684\u901A\u77E5/\u5199\u5165\u7279\u5F81\uFF1B\u8BF7\u6838\u5BF9\u5145\u7535\u6869\u578B\u53F7");
        }
        this.writer = writer;
        this.pairingNotifier = pairingNotifier;
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
        this.diagnose("notifications-start", { attempt, notify: !!notifier.properties?.notify, indicate: !!notifier.properties?.indicate });
        const notificationsAt = Date.now();
        try {
          await notifier.startNotifications();
        } catch (error) {
          ensureActive("start-notifications", error);
          this.diagnose("notifications-error", diagnosticError(error), "error");
          throw error;
        }
        ensureActive("start-notifications");
        markStage("connected");
        this.diagnose("notifications-started", { attempt, durationMs: Date.now() - notificationsAt });
        if (!this.protocol) {
          this.diagnose("auth-gate", { stage: "await-protocol" });
          this.setPhase("detecting", "\u5DF2\u8FDE\u63A5\uFF0C\u7B49\u5F85\u8BBE\u5907\u62A5\u6587\u4EE5\u8FA8\u8BC6\u534F\u8BAE\u2026");
        }
        if (!this.protocol && requested) this.chooseProtocol(requested, "\u7528\u6237\u6307\u5B9A");
        else if (!this.protocol) this.sniffTimer = setTimeout(() => {
          if (epoch !== this.epoch || this.protocol) return;
          const cached = this.loadVault().devices[device.id]?.protocol;
          this.diagnose("protocol-sniff-expired", { notifications: this.rxNotifications, bytes: this.rxBytes, parsed: this.decodedFrames, cached: cached === 1 || cached === 2 }, "warn");
          if (cached === 1 || cached === 2) this.chooseProtocol(cached, "\u4E0A\u6B21\u6210\u529F\u7684\u534F\u8BAE\uFF0C\u7B49\u5F85\u8BBE\u5907\u786E\u8BA4");
          else {
            this.diagnose("auth-gate", { stage: "await-manual-protocol" });
            this.setPhase("password", "\u6CA1\u6709\u6536\u5230\u534F\u8BAE\u62A5\u6587\uFF1B\u8BF7\u624B\u52A8\u9009\u62E9\u65E7\u7248\u6216\u65B0\u7248\u534F\u8BAE\uFF0C\u518D\u8F93\u5165\u5BC6\u7801\u3002");
            this.emit({ type: "auth-needed", message: "\u8BF7\u9009\u534F\u8BAE\u5E76\u8F93\u5165\u4E94\u4F4D\u84DD\u7259\u9A8C\u8BC1\u7801\u3002" });
          }
        }, 5e3);
      } catch (error) {
        this.diagnose("gatt-connect-error", {
          attempt,
          stage,
          elapsedMs: Date.now() - startedAt,
          stageMs: Math.max(0, Date.now() - stageAt),
          page: pageVisibility(),
          connected: !!device.gatt?.connected,
          ...diagnosticError(error)
        }, "error");
        if (epoch === this.epoch) {
          this.disconnect("connect-error");
          this.emit({
            type: "notice",
            message: `\u8FDE\u63A5\u5931\u8D25\uFF1A${message(error)}`,
            ...source === "chooser" ? {} : { severity: "error" }
          });
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
      if (!this.manualBluetoothLogin && saved?.password && /^\d{5}$/.test(saved.password)) {
        this.diagnose("auth-gate", { stage: "cached-password" });
        this.diagnose("auth-cached-available");
        this.autoLoginTried = true;
        this.autoLoginInProgress = true;
        void this.login(saved.password, true).then(
          () => {
            this.autoLoginInProgress = false;
          },
          (error) => {
            this.autoLoginInProgress = false;
            this.diagnose("auth-cached-failed", diagnosticError(error), "warn");
            this.forgetPassword();
            this.setPhase("password", `\u81EA\u52A8\u6388\u6743\u5931\u8D25\uFF1A${message(error)}`);
            this.emit({ type: "notice", message: "\u81EA\u52A8\u6388\u6743\u5931\u8D25\uFF0C\u8BF7\u91CD\u65B0\u8F93\u5165\u84DD\u7259\u9A8C\u8BC1\u7801\u3002", severity: "error" });
            this.emit({ type: "auth-needed", message: "\u8BF7\u91CD\u65B0\u8F93\u5165\u84DD\u7259\u9A8C\u8BC1\u7801\u3002" });
          }
        );
      } else {
        this.diagnose("auth-gate", { stage: "await-password-input" });
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
      if (this.pendingReservation || this.pendingAdmin || this.pendingGear) throw new Error("\u6B63\u5728\u7B49\u5F85\u8BBE\u5907\u64CD\u4F5C\u56DE\u6267\uFF0C\u8BF7\u52FF\u540C\u65F6\u53D1\u9001\u540C\u6B65\u6307\u4EE4");
      await this.write(syncClock(this.protocol), "clock-sync");
      this.emit({ type: "notice", message: "\u5DF2\u53D1\u9001\u8BBE\u5907\u65F6\u949F\u540C\u6B65\u5E27\uFF0C\u7B49\u5F85\u72B6\u6001\u901A\u77E5\u3002" });
    }
    experimentalGear(pile, gun, gear) {
      if (!this.authorized || !this.latest || Date.now() - this.latestAt > 2e4) throw new Error("\u987B\u5148\u53D6\u5F97\u8FD1\u671F\u8BBE\u5907\u6388\u6743\u72B6\u6001\uFF1B\u4E0D\u80FD\u51ED\u65E7\u72B6\u6001\u5C1D\u8BD5\u6863\u4F4D");
      if (this.pendingAuth || this.pendingControl || this.pendingReservation || this.pendingAdmin || this.pendingGear) throw new Error("\u4E0A\u4E00\u6761\u8BBE\u5907\u64CD\u4F5C\u5C1A\u672A\u786E\u8BA4");
      const bytes = experimentalGearCommand(pile, gun, gear);
      this.diagnose("experimental-gear-request", { gear, bytes: bytes.length });
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => this.rejectExperimental(new Error("\u672A\u540C\u65F6\u6536\u5230 82/01 \u56DE\u6267\u548C 54 \u6863\u4F4D\u72B6\u6001\uFF1B\u7ED3\u679C\u672A\u77E5\uFF0C\u8BF7\u73B0\u573A\u6838\u5BF9\uFF0C\u52FF\u76F4\u63A5\u91CD\u8BD5"), "timeout"), 12e3);
        this.pendingGear = { gear, ack: false, observed: false, resolve, reject, timer };
        void this.writeBytes(bytes, "experimental-gear").catch((error) => this.rejectExperimental(new Error(`\u53D1\u9001\u5B9E\u9A8C\u6027\u6863\u4F4D\u62A5\u6587\u5931\u8D25\uFF1A${message(error)}`), "write-error"));
      });
    }
    rejectExperimental(error, reason) {
      const pending = this.pendingGear;
      if (!pending) return;
      this.pendingGear = null;
      clearTimeout(pending.timer);
      this.diagnose("experimental-gear-unconfirmed", { gear: pending.gear, reason, replyAccepted: pending.ack, statusMatched: pending.observed }, "warn");
      pending.reject(error);
    }
    confirmExperimental() {
      const pending = this.pendingGear;
      if (!pending || !pending.ack || !pending.observed) return;
      this.pendingGear = null;
      clearTimeout(pending.timer);
      this.diagnose("experimental-gear-confirmed", { gear: pending.gear, evidence: "82-ack-and-54-status" });
      pending.resolve();
    }
    control(action) {
      if (!this.authorized || !this.protocol || !this.latest || Date.now() - this.latestAt > 2e4) throw new Error("\u8BBE\u5907\u72B6\u6001\u4E0D\u5B58\u5728\u6216\u5DF2\u8FC7\u671F\uFF1B\u8BF7\u5148\u5237\u65B0\u72B6\u6001");
      if (this.pendingControl || this.pendingReservation || this.pendingAdmin || this.pendingGear) throw new Error("\u4E0A\u4E00\u6761\u6307\u4EE4\u5C1A\u672A\u786E\u8BA4");
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
    admin(action, password) {
      if (!this.authorized || !this.protocol || !this.device) throw new Error("\u8BF7\u5148\u8FDE\u63A5\u5E76\u901A\u8FC7\u8BBE\u5907\u84DD\u7259\u6388\u6743");
      if (action !== "admin-auth" && !this.adminVerified) throw new Error("\u8BF7\u5148\u4F7F\u7528\u72EC\u7ACB\u7BA1\u7406\u5458\u9A8C\u8BC1\u7801\u53D6\u5F97\u8BBE\u5907\u786E\u8BA4");
      if (this.pendingAuth || this.pendingControl || this.pendingReservation || this.pendingAdmin || this.pendingGear) throw new Error("\u4E0A\u4E00\u6761\u8BBE\u5907\u64CD\u4F5C\u5C1A\u672A\u786E\u8BA4");
      if (action !== "admin-auth" && (!this.latest || Date.now() - this.latestAt > 2e4)) throw new Error("\u8BBE\u5907\u72B6\u6001\u5DF2\u8FC7\u671F\uFF1B\u7BA1\u7406\u64CD\u4F5C\u9700\u8981\u6700\u65B0\u8BBE\u5907\u72B6\u6001");
      const status2 = this.latest;
      if (action === "plug-on" && (status2?.mode === "3" || status2?.mode === "5")) throw new Error("\u8BF7\u5148\u53D6\u6D88\u9884\u7EA6\u6216\u65E0\u611F\u5145\u7535\u6A21\u5F0F");
      if (action === "pair" && (status2?.mode === "3" || status2?.selfStartFlag === "2")) throw new Error("\u8BF7\u5148\u53D6\u6D88\u9884\u7EA6\u6216\u5373\u63D2\u5373\u5145\u6A21\u5F0F");
      if (action === "pair" && !this.pairingNotifier) throw new Error("\u672A\u53D1\u73B0\u539F\u5C0F\u7A0B\u5E8F\u914D\u5BF9\u6240\u9700\u7684 FF03 \u901A\u77E5\u7279\u5F81\uFF1B\u4E0D\u80FD\u542F\u52A8\u65E0\u611F\u914D\u5BF9");
      const frame = adminCommand(this.protocol, action, password);
      this.diagnose("admin-request", { action, version: this.protocol });
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => this.rejectAdmin(new Error("\u8BBE\u5907\u7BA1\u7406\u56DE\u6267\u8D85\u65F6\uFF0C\u7ED3\u679C\u672A\u77E5\uFF0C\u8BF7\u6838\u5BF9\u72B6\u6001\u540E\u518D\u64CD\u4F5C"), "timeout"), 1e4);
        this.pendingAdmin = { action, resolve, reject, timer };
        void this.write(frame, action).catch((error) => this.rejectAdmin(new Error(`\u53D1\u9001\u7BA1\u7406\u6307\u4EE4\u5931\u8D25\uFF1A${message(error)}`), "write-error"));
      });
    }
    rejectAdmin(error, reason = "unknown") {
      const pending = this.pendingAdmin;
      if (!pending) return;
      this.pendingAdmin = null;
      clearTimeout(pending.timer);
      this.diagnose("admin-unconfirmed", { action: pending.action, reason }, "warn");
      pending.reject(error);
    }
    submitReservation(reservation) {
      return this.reserve("submit", reservation);
    }
    cancelReservation() {
      return this.reserve("cancel");
    }
    reserve(action, reservation) {
      if (!this.authorized || !this.protocol || !this.latest || Date.now() - this.latestAt > 2e4) throw new Error("\u8BBE\u5907\u72B6\u6001\u4E0D\u5B58\u5728\u6216\u5DF2\u8FC7\u671F\uFF1B\u8BF7\u5148\u5237\u65B0\u72B6\u6001");
      if (this.pendingControl || this.pendingReservation || this.pendingAuth || this.pendingAdmin || this.pendingGear) throw new Error("\u4E0A\u4E00\u6761\u6307\u4EE4\u5C1A\u672A\u786E\u8BA4");
      const status2 = this.latest;
      if (action === "submit") {
        const blocked = reservationBlockReason(status2);
        this.diagnose("reservation-gate", {
          allowed: !blocked,
          state: status2.state,
          gun: status2.gunFlag,
          lock: status2.lock,
          mode: status2.mode,
          selfStart: status2.selfStartFlag
        });
        if (blocked) throw new Error(blocked);
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
      const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
      const experimental = this.experimentalDecoder.feed(bytes);
      const text2 = new DataView(experimental.text.buffer, experimental.text.byteOffset, experimental.text.byteLength);
      const frames = this.decoder.feed(decodeAscii(text2));
      this.rxNotifications++;
      this.rxBytes += view.byteLength;
      this.decodedFrames += frames.length + experimental.frames.length;
      if (frames.some((frame) => frame.type !== "status" && frame.type !== "unknown") || this.rxNotifications <= 6 || !(this.rxNotifications & this.rxNotifications - 1)) {
        this.diagnose("rx-notification", {
          bytes: view.byteLength,
          parsed: frames.length,
          notifications: this.rxNotifications,
          totalBytes: this.rxBytes,
          totalParsed: this.decodedFrames
        });
      }
      for (const frame of frames) this.onFrame(frame);
      for (const frame of experimental.frames) this.onExperimentalFrame(frame);
    }
    onExperimentalFrame(frame) {
      if (!this.authorized) {
        this.diagnose("experimental-reply-ignored", { reason: "not-authorized" });
        return;
      }
      if (frame.type === "power-report") {
        this.emit({ type: "experimental-power", gear: frame.gear, powerTenths: frame.powerTenths });
        const pending2 = this.pendingGear;
        if (pending2 && frame.gear === pending2.gear) {
          pending2.observed = true;
          this.confirmExperimental();
        }
        return;
      }
      const pending = this.pendingGear;
      if (!pending) {
        this.diagnose("experimental-reply-ignored", { reason: "no-pending" });
        return;
      }
      this.emit({ type: "experimental-ack", gear: pending.gear, accepted: frame.accepted });
      if (!frame.accepted) {
        this.rejectExperimental(new Error("\u8BBE\u5907 82 \u56DE\u6267\u672A\u8FD4\u56DE 01\uFF1B\u62D2\u7EDD\u6216\u7ED3\u679C\u672A\u77E5"), "rejected");
        return;
      }
      pending.ack = true;
      this.confirmExperimental();
    }
    onFrame(frame) {
      if (frame.type === "unknown") {
        this.unknownFrames++;
        if (this.unknownFrames <= 3 || !(this.unknownFrames & this.unknownFrames - 1)) {
          this.diagnose("rx-unknown-summary", { version: frame.protocol, count: this.unknownFrames });
        }
      } else if (frame.type !== "status") this.diagnose("rx-frame", { type: frame.type, version: frame.protocol });
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
        void this.refresh().catch((error) => this.emit({ type: "notice", message: `\u540C\u6B65\u65F6\u949F/\u83B7\u53D6\u72B6\u6001\u5931\u8D25\uFF1A${message(error)}`, severity: "error" }));
        return;
      }
      if (frame.type === "admin") {
        const pending = this.pendingAdmin;
        const matched = !!pending && (frame.action === pending.action || frame.action === "mute" && (pending.action === "mute-on" || pending.action === "mute-off"));
        this.diagnose("admin-reply", { action: frame.action, accepted: frame.ok, matched });
        if (!matched || !pending) return;
        if (pending.action === "pair" && frame.ok && this.pairingNotifier) {
          const epoch = this.epoch;
          void this.pairingNotifier.startNotifications().then(() => {
            if (this.pendingAdmin !== pending) return;
            this.pendingAdmin = null;
            clearTimeout(pending.timer);
            if (this.epoch === epoch && this.authorized) pending.resolve();
            else pending.reject(new Error("\u914D\u5BF9\u901A\u77E5\u5EFA\u7ACB\u671F\u95F4\u84DD\u7259\u5DF2\u65AD\u7EBF\uFF1B\u5B9E\u9645\u7ED3\u679C\u672A\u77E5"));
          }, (error) => this.rejectAdmin(new Error(`\u8BBE\u5907\u5DF2\u6253\u5F00\u914D\u5BF9\u7A97\u53E3\uFF0C\u4F46\u65E0\u6CD5\u8BA2\u9605\u914D\u5BF9\u901A\u77E5\uFF1A${message(error)}`), "pair-notify-error"));
          return;
        }
        this.pendingAdmin = null;
        clearTimeout(pending.timer);
        if (!frame.ok) {
          pending.reject(new Error("\u8BBE\u5907\u62D2\u7EDD\u7BA1\u7406\u5458\u9A8C\u8BC1\u6216\u8BBE\u7F6E"));
          return;
        }
        if (pending.action === "admin-auth") this.adminVerified = true;
        if (pending.action === "admin-password") this.adminVerified = false;
        if (pending.action === "bluetooth-password") this.forgetPassword();
        pending.resolve();
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
        if (signature !== this.lastStatusSignature) {
          this.diagnose("status-transition", {
            attempt: this.attempt,
            fromState: this.latest?.state ?? "none",
            toState: frame.state,
            fromMode: this.latest?.mode ?? "none",
            toMode: frame.mode,
            gun: frame.gunFlag,
            lock: frame.lock,
            sincePreviousMs: this.latestAt ? Math.max(0, Date.now() - this.latestAt) : null
          });
        }
        this.lastStatusSignature = signature;
        this.latest = frame;
        this.latestAt = Date.now();
        if (this.device?.id) this.lastObserved = {
          deviceId: this.device.id,
          at: this.latestAt,
          state: frame.state,
          gun: frame.gunFlag,
          mode: frame.mode,
          lock: frame.lock
        };
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
    write(text2, action) {
      return this.writeBytes(encodeAscii(text2), action);
    }
    async writeBytes(bytes, action) {
      if (!this.enabled()) throw new Error("\u771F\u673A\u63A7\u5236\u6A21\u5F0F\u5DF2\u5173\u95ED\uFF0C\u4E0D\u53D1\u9001\u84DD\u7259\u6307\u4EE4");
      const writer = this.writer;
      if (!writer || !this.server?.connected) throw new Error("\u84DD\u7259\u8FDE\u63A5\u5DF2\u65AD\u5F00");
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
    disconnect(reason = "user") {
      const context = {
        attempt: this.attempt,
        phase: this.phase,
        page: pageVisibility(),
        afterConnectedMs: this.connectedAt ? Math.max(0, Date.now() - this.connectedAt) : null,
        ...this.statusTrace(),
        pendingAuth: !!this.pendingAuth,
        pendingControl: !!this.pendingControl,
        pendingReservation: !!this.pendingReservation,
        pendingAdmin: !!this.pendingAdmin
      };
      this.epoch++;
      this.autoLoginInProgress = false;
      if (this.sniffTimer) clearTimeout(this.sniffTimer);
      this.sniffTimer = null;
      this.rejectAuth(new Error("\u84DD\u7259\u8FDE\u63A5\u5DF2\u65AD\u5F00"), "disconnect");
      this.rejectControl(new Error("\u84DD\u7259\u8FDE\u63A5\u5DF2\u65AD\u5F00\uFF1B\u6307\u4EE4\u5B9E\u9645\u7ED3\u679C\u672A\u77E5"), "disconnect");
      this.rejectReservation(new Error("\u84DD\u7259\u8FDE\u63A5\u5DF2\u65AD\u5F00\uFF1B\u9884\u7EA6\u5B9E\u9645\u7ED3\u679C\u672A\u77E5"), "disconnect");
      this.rejectAdmin(new Error("\u84DD\u7259\u8FDE\u63A5\u5DF2\u65AD\u5F00\uFF1B\u7BA1\u7406\u64CD\u4F5C\u7ED3\u679C\u672A\u77E5"), "disconnect");
      this.rejectExperimental(new Error("\u84DD\u7259\u8FDE\u63A5\u5DF2\u65AD\u5F00\uFF1B\u6863\u4F4D\u64CD\u4F5C\u7ED3\u679C\u672A\u77E5"), "disconnect");
      this.adminVerified = false;
      const server = this.server;
      if (this.device || server) this.diagnose("disconnect", {
        reason,
        initiatedBy: reason === "gatt-event" ? "gatt-event" : "page",
        connected: !!server?.connected,
        stage: this.connectionStage,
        ...context
      });
      this.device?.removeEventListener("gattserverdisconnected", this.onDisconnected);
      if (this.notifier && this.listener) this.notifier.removeEventListener("characteristicvaluechanged", this.listener);
      this.device = null;
      this.server = null;
      this.writer = null;
      this.notifier = null;
      this.pairingNotifier = null;
      this.listener = null;
      if (server?.connected) {
        this.diagnose("gatt-disconnect-call", { reason, stage: this.connectionStage });
        try {
          server.disconnect();
          this.diagnose("gatt-disconnect-result", { connected: server.connected });
        } catch (error) {
          this.diagnose("gatt-disconnect-error", diagnosticError(error), "warn");
        }
      }
      this.protocol = null;
      this.latest = null;
      this.latestAt = 0;
      this.autoLoginTried = false;
      this.reservationAccepted = null;
      this.decoder.reset();
      this.experimentalDecoder.reset();
      this.rxNotifications = 0;
      this.rxBytes = 0;
      this.decodedFrames = 0;
      this.unknownFrames = 0;
      this.statusFrames = 0;
      this.lastStatusSignature = "";
      this.connectionStage = "offline";
      this.stageAt = 0;
      this.connectedAt = 0;
      this.setPhase("offline", "\u672A\u8FDE\u63A5\u5145\u7535\u6869");
    }
  };

  // src/build-info.ts
  var pad2 = (value) => String(value).padStart(2, "0");
  function formatLocalBuildTime(builtAt) {
    const date = new Date(builtAt);
    if (!Number.isFinite(date.getTime())) return "\u672A\u77E5";
    const offset = -date.getTimezoneOffset();
    const sign = offset >= 0 ? "+" : "-";
    const absolute = Math.abs(offset);
    const local = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
    return `${local} ${sign}${pad2(Math.floor(absolute / 60))}:${pad2(absolute % 60)}`;
  }
  function formatBuildInfo(info) {
    return `\u7248\u672C v${info.version} \xB7 \u63D0\u4EA4 ${info.revision} \xB7 \u6784\u5EFA\uFF08\u672C\u5730\uFF09 ${formatLocalBuildTime(info.builtAt)}`;
  }

  // src/feedback.ts
  var STATUS_FEEDBACK_INTERVAL_MS = 3e4;
  var pad3 = (value) => String(value).padStart(2, "0");
  function feedbackTimestamp(at) {
    const date = new Date(at);
    return `${date.getFullYear()}-${pad3(date.getMonth() + 1)}-${pad3(date.getDate())} ${pad3(date.getHours())}:${pad3(date.getMinutes())}:${pad3(date.getSeconds())}`;
  }
  function shouldPaintStatusFeedback(repeated, now, lastPaintedAt) {
    return !repeated || now < lastPaintedAt || now - lastPaintedAt >= STATUS_FEEDBACK_INTERVAL_MS;
  }
  var FeedbackHistory = class {
    constructor(limit = 100) {
      this.limit = limit;
      __publicField(this, "entries", []);
    }
    add(message2, at = Date.now()) {
      const last = this.entries[this.entries.length - 1];
      if (last?.message === message2) {
        last.at = at;
        last.repeats++;
        return true;
      }
      this.entries.push({ message: message2, at, repeats: 0 });
      if (this.entries.length > this.limit) this.entries.shift();
      return false;
    }
    clear() {
      this.entries.length = 0;
    }
    get size() {
      return this.entries.length;
    }
    toText() {
      return this.entries.map(({ message: message2, at, repeats }) => `[${feedbackTimestamp(at)}] ${message2}${repeats ? ` +${repeats}` : ""}`).join("\n");
    }
  };

  // src/history.ts
  var KEY3 = "wattsaving-local-history-v1";
  var LIMIT = 100;
  var empty = () => ({ charges: [], reservations: [] });
  var finiteTime = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;
  var deviceRecord = (v) => !!v && typeof v === "object" && typeof v.id === "string" && typeof v.deviceId === "string";
  var LocalHistory = class {
    constructor(storage) {
      this.storage = storage;
      __publicField(this, "data", empty());
      __publicField(this, "lastLive", /* @__PURE__ */ new Map());
      __publicField(this, "available");
      let available = !!storage;
      try {
        const raw = storage?.getItem(KEY3);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") {
            const obj = parsed;
            this.data.charges = Array.isArray(obj.charges) ? obj.charges.filter(deviceRecord).slice(0, LIMIT) : [];
            this.data.reservations = Array.isArray(obj.reservations) ? obj.reservations.filter(deviceRecord).slice(0, LIMIT) : [];
          }
        }
      } catch {
        available = false;
        this.data = empty();
      }
      this.available = available;
    }
    save() {
      try {
        this.storage?.setItem(KEY3, JSON.stringify(this.data));
      } catch {
      }
    }
    charges(deviceId) {
      return this.data.charges.filter((r) => r.deviceId === deviceId);
    }
    reservations(deviceId) {
      return this.data.reservations.filter((r) => r.deviceId === deviceId);
    }
    latestDeviceId() {
      const charge = this.data.charges[0], reservation = this.data.reservations[0];
      return !charge ? reservation?.deviceId || null : !reservation || charge.firstSeenAt >= reservation.submittedAt ? charge.deviceId : reservation.deviceId;
    }
    latestReservation(deviceId) {
      return this.reservations(deviceId).find((r) => ["accepted", "observed", "charging"].includes(r.state) && finiteTime(r.startsAt));
    }
    trackStatus(deviceId, status2, now = Date.now()) {
      const previous = this.lastLive.get(deviceId);
      this.lastLive.set(deviceId, status2.state);
      let changed = false;
      const active = this.data.charges.find((r) => r.deviceId === deviceId && r.state === "charging");
      if (status2.state === "4") {
        if (!active) {
          this.data.charges.unshift({
            id: String(now),
            deviceId,
            startedAt: previous === "2" ? now : null,
            firstSeenAt: now,
            endedAt: null,
            state: "charging",
            energyKWh: Number.isFinite(status2.energyKWh) ? status2.energyKWh : null,
            minutes: Number.isFinite(status2.minutes) ? status2.minutes : null
          });
          this.data.charges = this.data.charges.slice(0, LIMIT);
          changed = true;
        } else if (active.energyKWh !== status2.energyKWh || active.minutes !== status2.minutes) {
          active.energyKWh = Number.isFinite(status2.energyKWh) ? status2.energyKWh : active.energyKWh;
          active.minutes = Number.isFinite(status2.minutes) ? status2.minutes : active.minutes;
          changed = true;
        }
      } else if (active) {
        active.state = "ended";
        active.endedAt = previous === "4" ? now : null;
        active.energyKWh = Number.isFinite(status2.energyKWh) ? status2.energyKWh : active.energyKWh;
        active.minutes = Number.isFinite(status2.minutes) ? status2.minutes : active.minutes;
        changed = true;
      }
      const reservation = this.latestReservation(deviceId);
      if (reservation) {
        let state = reservation.state;
        if (status2.mode === "3" && status2.state !== "4" && state === "accepted") state = "observed";
        if (status2.state === "4" && state === "observed") state = "charging";
        if (status2.state !== "4" && state === "charging" && previous === "4") state = "ended";
        if (state !== reservation.state) {
          reservation.state = state;
          reservation.updatedAt = now;
          changed = true;
        }
      }
      if (changed) this.save();
    }
    acceptReservation(deviceId, startsAt, end, now = Date.now()) {
      const previous = this.latestReservation(deviceId);
      if (previous) {
        previous.state = "replaced";
        previous.updatedAt = now;
      }
      const label = end.kind === "full" ? "\u81EA\u52A8\u5145\u6EE1" : end.kind === "time" ? `${end.minutes / 60} \u5C0F\u65F6` : `${end.kWh} \u5EA6`;
      this.data.reservations.unshift({ id: String(now), deviceId, submittedAt: now, startsAt, end: label, state: "accepted", updatedAt: now });
      this.data.reservations = this.data.reservations.slice(0, LIMIT);
      this.save();
    }
    cancelReservation(deviceId, now = Date.now()) {
      const reservation = this.latestReservation(deviceId);
      if (!reservation) return;
      reservation.state = "cancelled";
      reservation.updatedAt = now;
      this.save();
    }
    clear() {
      this.data = empty();
      this.lastLive.clear();
      try {
        this.storage?.removeItem(KEY3);
      } catch {
      }
    }
  };

  // src/tabs.ts
  function showTab(pairs, selected) {
    if (selected < 0 || selected >= pairs.length) throw new RangeError("\u672A\u77E5\u6807\u7B7E\u9875");
    pairs.forEach(({ tab, panel }, index) => {
      const active = index === selected;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      panel.hidden = !active;
    });
  }
  function tabIndexForKey(key, current, count) {
    if (count < 1 || current < 0 || current >= count) return null;
    if (key === "ArrowRight") return (current + 1) % count;
    if (key === "ArrowLeft") return (current + count - 1) % count;
    if (key === "Home") return 0;
    if (key === "End") return count - 1;
    return null;
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
  text("buildInfo", formatBuildInfo({ version: "0.1.0", revision: "8f66f22", builtAt: "2026-09-27T18:10:52.252Z" }));
  var adapter = navigator.bluetooth;
  var diagnostics = new Diagnostics();
  var localStorageAccess;
  try {
    localStorageAccess = window.localStorage;
  } catch {
  }
  var history = new LocalHistory(localStorageAccess);
  var client = adapter ? new ChargerClient(adapter, handleEvent, () => window.isSecureContext, (event, data, level) => {
    diagnostics.add(event, data, level);
    refreshDiagnostics();
  }) : null;
  var phase = "offline";
  var busy = false;
  var statusAt = 0;
  var staleLoggedFor = 0;
  var reservationResult = "";
  var adminMessage = "";
  var experimentResult = "";
  var experimentReport = null;
  var lastBlockedReservation = "";
  var reservationStartAutomatic = true;
  var confirmedReservation = null;
  var feedback = new FeedbackHistory(100);
  var lastFeedbackPaintAt = 0;
  var feedbackDirty = false;
  var errorDialogs = 0;
  var pad4 = (value) => String(value).padStart(2, "0");
  function localMinute(date) {
    return `${date.getFullYear()}-${pad4(date.getMonth() + 1)}-${pad4(date.getDate())}T${pad4(date.getHours())}:${pad4(date.getMinutes())}`;
  }
  function formatHistoryTime(value) {
    return value && Number.isFinite(value) ? new Date(value).toLocaleString("zh-CN") : "\u672A\u77E5";
  }
  function renderHistory() {
    const id = client?.currentDevice?.id || history.latestDeviceId();
    const charges = id ? history.charges(id) : [];
    const reservations = id ? history.reservations(id) : [];
    const show = (boxId, entries) => {
      const box = el(boxId);
      box.replaceChildren();
      if (!entries.length) {
        box.textContent = "\u6682\u65E0\u672C\u7F51\u9875\u8BB0\u5F55";
        return;
      }
      const list = document.createElement("ol");
      list.className = "history-list";
      for (const entry of entries) {
        const item = document.createElement("li");
        item.textContent = entry;
        list.append(item);
      }
      box.append(list);
    };
    show("localChargeHistory", charges.map((r) => `\u9996\u6B21\u89C2\u5BDF\u5230\u5145\u7535\uFF1A${formatHistoryTime(r.firstSeenAt)}${r.startedAt ? "\uFF08\u89C2\u5BDF\u5230\u51C6\u5907\u2192\u5145\u7535\uFF09" : "\uFF08\u51C6\u786E\u5F00\u59CB\u65F6\u95F4\u672A\u77E5\uFF09"}
\u505C\u6B62\u89C2\u5BDF\uFF1A${r.state === "charging" ? "\u4E0A\u6B21\u89C2\u5BDF\u5230\u5145\u7535\u4E2D\uFF0C\u5F53\u524D\u9700\u6838\u5BF9" : r.endedAt ? formatHistoryTime(r.endedAt) : "\u79BB\u7EBF\u671F\u95F4\u53D1\u751F\uFF0C\u51C6\u786E\u65F6\u95F4\u672A\u77E5"}
\u5DF2\u5145\u65F6\u957F\uFF1A${r.minutes !== null && Number.isFinite(r.minutes) ? duration(r.minutes) : "\u672A\u77E5"} \xB7 \u7535\u91CF\uFF1A${r.energyKWh !== null && Number.isFinite(r.energyKWh) ? `${r.energyKWh.toFixed(1)} kWh` : "\u672A\u77E5"}`));
    const names = { accepted: "\u8BBE\u5907\u5DF2\u63A5\u53D7\uFF0C\u5F85\u6838\u5BF9\u6A21\u5F0F", observed: "\u66FE\u89C2\u5BDF\u5230\u9884\u7EA6\u6A21\u5F0F", charging: "\u540E\u7EED\u89C2\u5BDF\u5230\u5145\u7535\u4E2D", ended: "\u540E\u7EED\u89C2\u5BDF\u5230\u505C\u6B62\u5145\u7535", cancelled: "\u8BBE\u5907\u5DF2\u786E\u8BA4\u53D6\u6D88", replaced: "\u88AB\u672C\u7F51\u9875\u65B0\u9884\u7EA6\u66FF\u6362" };
    show("localReserveHistory", reservations.map((r) => `\u63D0\u4EA4\uFF1A${formatHistoryTime(r.submittedAt)} \xB7 \u9884\u7EA6\uFF1A${formatHistoryTime(r.startsAt)}
\u7ED3\u675F\u65B9\u5F0F\uFF1A${r.end} \xB7 \u672C\u5730\u8BB0\u5F55\uFF1A${names[r.state] || "\u72B6\u6001\u672A\u77E5"}`));
    text("localHistoryHint", history.available ? "\u4EC5\u5B58\u50A8\u5728\u6B64\u6D4F\u89C8\u5668\u7684\u7F51\u7AD9\u6570\u636E\u4E2D\u3002" : "\u6D4F\u89C8\u5668\u7981\u6B62\u672C\u5730\u5B58\u50A8\uFF1B\u8BB0\u5F55\u4EC5\u5728\u672C\u6B21\u9875\u9762\u6709\u6548\u3002");
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
    if (!client?.authorized || !currentDeviceId || !confirmedReservation || currentDeviceId !== confirmedReservation.deviceId) {
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
    text("reserveCountdownLabel", now < confirmedReservation.startsAt ? confirmedReservation.source === "restored" ? "\u540E\u5F00\u59CB\u5145\u7535\uFF08\u4EC5\u672C\u5730\u8BB0\u5F55\uFF1B\u8BBE\u5907\u65F6\u95F4\u4E0D\u53EF\u6838\u5BF9\uFF09" : "\u540E\u5F00\u59CB\u5145\u7535\uFF08\u672C\u5730\u65F6\u949F\u4F30\u7B97\uFF09" : "\u9884\u7EA6\u65F6\u95F4\u5DF2\u5230\uFF0C\u7B49\u5F85\u8BBE\u5907\u72B6\u6001\u786E\u8BA4");
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
    if (status2.state === "5") return "\u5145\u7535\u7ED3\u675F";
    if (status2.state === "6") return "\u672A\u63D2\u67AA";
    if (status2.state === "7") return "\u914D\u7F6E\u4E2D";
    return `\u8BBE\u5907\u72B6\u6001 ${status2.state || "\u672A\u77E5"}\uFF08\u542B\u4E49\u672A\u6838\u5B9E\uFF09`;
  };
  var stateLabels = { "2": "\u51C6\u5907", "3": "\u6545\u969C", "4": "\u5145\u7535", "5": "\u7ED3\u675F", "6": "\u672A\u63D2\u67AA", "7": "\u914D\u7F6E\u4E2D" };
  var modeLabels = { "0": "\u5F85\u673A", "1": "VIN", "2": "\u84DD\u7259", "3": "\u9884\u7EA6", "4": "\u5373\u63D2\u5373\u5145", "5": "\u65E0\u611F\u5145\u7535" };
  var faultLabelsNew = {
    "0000": "\u5DE5\u4F5C\u6B63\u5E38",
    "0001": "CC1\u8FDE\u63A5\u5F02\u5E38",
    "0002": "BMS\u901A\u4FE1\u6545\u969C",
    "0003": "BMS\u901A\u4FE1\u8D85\u65F6\uFF08\u8D85\u65F6\u6B21\u6570\u5927\u4E8E3\u6B21\uFF09",
    "0009": "\u7535\u5B50\u9501\u6545\u969C",
    "0010": "\u76F4\u6D41\u63A5\u89E6\u5668\u9ECF\u8FDE\u6545\u969C",
    "0012": "\u6025\u505C\u6309\u94AE\u88AB\u6309\u4E0B",
    "0014": "\u7535\u6C60\u7535\u538B\u4E0E\u5145\u7535\u673A\u8F93\u51FA\u8303\u56F4\u4E0D\u5339\u914D",
    "0018": "\u6A21\u5757\u8F93\u51FA\u8FC7/\u6B20\u538B",
    "0030": "\u76F4\u6D41\u63A5\u89E6\u5668\u62D2\u52A8\u6545\u969C"
  };
  function faultDescription(status2) {
    if (status2.protocol === 2) return faultLabelsNew[status2.power] || "\u539F\u5C0F\u7A0B\u5E8F\u672A\u63D0\u4F9B\u8BE5\u6545\u969C\u7801\u91CA\u4E49";
    return status2.power === "0000" ? "\u5DE5\u4F5C\u6B63\u5E38" : "\u65E7\u534F\u8BAE\u7684\u6545\u969C\u91CA\u4E49\u4F9D\u8BBE\u5907\u5B50\u578B\u53F7\u800C\u5F02\uFF0C\u5F53\u524D\u672A\u80FD\u5224\u5B9A\uFF1B\u8BF7\u6838\u5BF9\u539F\u5C0F\u7A0B\u5E8F";
  }
  function faultAdvice(status2) {
    if (status2.protocol !== 2 || !faultLabelsNew[status2.power]) return "\u5F53\u524D\u65E0\u6CD5\u6309\u8BBE\u5907\u5B50\u578B\u53F7\u6838\u5B9E\u6392\u67E5\u65B9\u6CD5\uFF0C\u8BF7\u6838\u5BF9\u539F\u5C0F\u7A0B\u5E8F\u6216\u8054\u7CFB\u552E\u540E\u3002";
    if (status2.power === "0000") return "\u65E0\u6545\u969C\u3002";
    if (status2.power === "0012") return "\u539F\u5C0F\u7A0B\u5E8F\u63D0\u793A\uFF1A\u5C06\u6025\u505C\u952E\u5F39\u8D77\u590D\u4F4D\uFF1B\u82E5\u4ECD\u672A\u89E3\u51B3\uFF0C\u8BF7\u8054\u7CFB\u552E\u540E\u3002";
    return "\u539F\u5C0F\u7A0B\u5E8F\u63D0\u793A\uFF1A\u89E3\u9664\u7535\u5B50\u9501\u5E76\u62D4\u9664\u5145\u7535\u67AA\uFF0C\u91CD\u65B0\u63D2\u67AA\u5E76\u518D\u6B21\u542F\u52A8\uFF1B\u82E5\u4ECD\u672A\u89E3\u51B3\uFF0C\u8BF7\u8054\u7CFB\u552E\u540E\u3002";
  }
  function duration(minutes) {
    if (!Number.isFinite(minutes) || minutes < 0) return "--";
    return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}min`;
  }
  function paintFeedback() {
    const box = el("liveLog");
    const followLatest = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
    box.textContent = feedback.toText() || "\u6682\u65E0\u8BBE\u5907\u53CD\u9988";
    if (followLatest) box.scrollTop = box.scrollHeight;
    lastFeedbackPaintAt = Date.now();
    feedbackDirty = false;
  }
  function record(message2, throttleStatus = false) {
    const now = Date.now();
    const repeated = feedback.add(message2, now);
    if (throttleStatus && !shouldPaintStatusFeedback(repeated, now, lastFeedbackPaintAt)) {
      feedbackDirty = true;
      return;
    }
    paintFeedback();
  }
  function showErrorModal(message2) {
    errorDialogs++;
    window.alert(message2);
  }
  function reportOperationError(message2) {
    record(message2);
    showErrorModal(message2);
  }
  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }
  function failure(action, error) {
    diagnostics.add("ui-error", { action, ...diagnosticError(error) }, "error");
    refreshDiagnostics();
    reportOperationError(`${action}\u5931\u8D25\uFF1A${errorMessage(error)}`);
  }
  function handleEvent(event) {
    if (event.type === "phase") {
      phase = event.phase;
      if (phase === "offline" || phase === "connecting") {
        reservationResult = "";
        adminMessage = "";
        experimentResult = "";
        experimentReport = null;
        el("experimentPile").value = "";
        el("experimentGun").value = "";
      }
      diagnostics.add("phase", { phase });
      record(event.message);
    }
    if (event.type === "notice") {
      record(event.message);
      if (event.severity === "error") showErrorModal(event.message);
    }
    if (event.type === "reservation") {
      reservationResult = event.message;
      record(event.message);
    }
    if (event.type === "experimental-power" && client?.authorized && client.currentDevice?.id) {
      experimentReport = { deviceId: client.currentDevice.id, gear: event.gear, powerTenths: event.powerTenths, at: Date.now() };
    }
    if (event.type === "experimental-ack") {
      experimentResult = event.accepted ? `\u8BBE\u5907 82/01 \u5DF2\u63A5\u53D7\u6863\u4F4D ${event.gear}\uFF1B\u7B49\u5F85 54 \u72B6\u6001\u786E\u8BA4\u3002` : `\u8BBE\u5907 82 \u56DE\u6267\u672A\u63A5\u53D7\u6863\u4F4D ${event.gear}\u3002`;
    }
    if (event.type === "protocol") record(`\u534F\u8BAE\uFF1A${event.version === 1 ? "\u65E7\u7248" : "\u65B0\u7248"}\uFF08${event.source}\uFF09`);
    if (event.type === "auth-needed") record(event.message);
    if (event.type === "status") {
      const deviceId = client?.currentDevice?.id;
      if (deviceId) {
        history.trackStatus(deviceId, event.status);
        const saved = history.latestReservation(deviceId);
        if (event.status.mode === "3" && saved && (!confirmedReservation || confirmedReservation.deviceId !== deviceId)) {
          confirmedReservation = { deviceId, startsAt: saved.startsAt, source: "restored" };
        }
      }
      if (lastBlockedReservation && reservationResult === lastBlockedReservation && reservationBlockReason(event.status) !== lastBlockedReservation) reservationResult = "";
      statusAt = Date.now();
      staleLoggedFor = 0;
      record("\u6536\u5230\u8BBE\u5907\u72B6\u6001\u901A\u77E5\u3002", true);
    }
    refreshDiagnostics();
    render();
  }
  function render() {
    if (feedbackDirty && Date.now() - lastFeedbackPaintAt >= STATUS_FEEDBACK_INTERVAL_MS) paintFeedback();
    const supported = !!adapter && window.isSecureContext;
    el("liveSupport").hidden = supported;
    if (!supported) text("liveSupport", !window.isSecureContext ? "\u5F53\u524D\u4E0D\u662F\u5B89\u5168\u4E0A\u4E0B\u6587\uFF0CWeb Bluetooth \u4E0D\u53EF\u7528\uFF1B\u8BF7\u4ECE Bluefy \u6253\u5F00 HTTPS GitHub Pages \u5730\u5740\u3002" : "\u6D4F\u89C8\u5668\u672A\u63D0\u4F9B Web Bluetooth\u3002\u8BF7\u5728 iPhone \u7684 Bluefy \u4E2D\u6253\u5F00\u5DF2\u53D1\u5E03\u7684 HTTPS \u9875\u9762\u3002");
    const device = client?.currentDevice;
    const status2 = client?.currentStatus ?? null;
    const fresh = !!status2 && Date.now() - statusAt < 2e4;
    if (client?.authorized && status2 && !fresh && statusAt && staleLoggedFor !== statusAt) {
      staleLoggedFor = statusAt;
      diagnostics.add("status-stale", {
        ageMs: Date.now() - statusAt,
        state: status2.state,
        page: document.visibilityState,
        connected: !!device?.gatt?.connected
      });
      refreshDiagnostics();
    }
    text("liveDevice", device ? `${device.name || "\u672A\u547D\u540D\u8BBE\u5907"} \xB7 ${client?.authorized ? "\u5DF2\u6388\u6743" : "\u672A\u6388\u6743"}` : client?.rememberedName ? `\u4E0A\u6B21\u8BBE\u5907\uFF1A${client.rememberedName}\uFF08\u672A\u8FDE\u63A5\uFF09` : "\u5C1A\u672A\u9009\u62E9\u8BBE\u5907");
    text("liveState", client?.authorized ? stateName(status2) : "\u672A\u53D6\u5F97\u8BBE\u5907\u5B9E\u65F6\u72B6\u6001");
    const connected = !!device?.gatt?.connected;
    const connectionLabel = client?.authorized ? "\u5DF2\u8FDE\u63A5\uFF0C\u5DF2\u6388\u6743" : connected ? "\u5DF2\u8FDE\u63A5\uFF0C\u672A\u6388\u6743" : phase === "connecting" ? "\u8FDE\u63A5\u4E2D" : "\u672A\u8FDE\u63A5";
    const indicator = el("livePhase");
    indicator.className = `connection-dot${connected ? " connected" : ""}`;
    indicator.setAttribute("aria-label", connectionLabel);
    indicator.title = connectionLabel;
    text("liveProtocolName", client?.currentProtocol === 1 ? "\u65E7\u7248\u534F\u8BAE" : client?.currentProtocol === 2 ? "\u65B0\u7248\u534F\u8BAE" : "\u7B49\u5F85\u8BC6\u522B");
    text("liveSoc", status2 && Number.isFinite(status2.soc) ? `${status2.soc}%` : "--");
    el("liveSocRing").style.setProperty("--soc", status2 && Number.isFinite(status2.soc) ? `${Math.max(0, Math.min(100, status2.soc))}%` : "0%");
    text("liveStateCode", status2 ? stateLabels[status2.state] || `\u72B6\u6001 ${status2.state}` : "--");
    text("liveMode", status2 ? modeLabels[status2.mode] || `\u6A21\u5F0F ${status2.mode || "\u672A\u77E5"}` : "--");
    text("liveLock", status2 ? status2.lock === "0" ? "\u65AD\u5F00" : status2.lock === "1" ? "\u95ED\u5408" : `\u72B6\u6001 ${status2.lock}` : "--");
    text("liveEnergy", status2 && Number.isFinite(status2.energyKWh) ? `${status2.energyKWh.toFixed(1)} kWh` : "--");
    text("liveMinutes", status2 ? duration(status2.minutes) : "--");
    text("liveRemaining", status2 ? duration(status2.remainingMinutes) : "--");
    text("liveVoltage", status2 ? `${status2.voltage} V` : "--");
    text("liveCurrent", status2 && status2.currentA !== null ? `${status2.currentA} A` : "--");
    text("liveFault", status2 ? status2.power || "--" : "--");
    text("liveElectrical", status2 ? `\u6545\u969C\u72B6\u6001\uFF1A${faultDescription(status2)}\uFF08${status2.power || "\u672A\u62A5\u544A"}\uFF09` : "\u65E0\u8BBE\u5907\u6570\u636E");
    el("liveFaultDetail").disabled = !status2;
    text("liveFreshness", !status2 ? "\u5C1A\u672A\u6536\u5230\u8BBE\u5907\u72B6\u6001" : fresh ? "\u8BBE\u5907\u72B6\u6001\uFF1A\u521A\u66F4\u65B0\uFF08\u5B9E\u65F6\u901A\u77E5\uFF09" : "\u8BBE\u5907\u72B6\u6001\u5DF2\u8FC7\u671F\uFF0C\u64CD\u4F5C\u5DF2\u7981\u7528\uFF0C\u8BF7\u5237\u65B0");
    const report = client?.authorized && experimentReport?.deviceId === device?.id ? experimentReport : null;
    const reportFresh = !!report && Date.now() - report.at < 2e4;
    text("experimentReportedGear", reportFresh ? String(report.gear) : "--");
    text("experimentReportedPower", reportFresh ? String(report.powerTenths / 10) : "--");
    text("experimentReportAge", !report ? "\u5C1A\u672A\u6536\u5230\u6709\u6548\u7684\u4E8C\u8FDB\u5236 54 \u901A\u77E5\u3002" : reportFresh ? `\u6536\u5230\u8BBE\u5907 54 \u901A\u77E5\uFF08${new Date(report.at).toLocaleTimeString("zh-CN")}\uFF09\uFF1B\u4EC5\u4E3A\u88AB\u52A8\u8BFB\u53D6\u3002` : "\u4E0A\u6B21 54 \u901A\u77E5\u5DF2\u8FC7\u671F\uFF1B\u5F53\u524D\u529F\u7387\u548C\u6863\u4F4D\u672A\u77E5\u3002");
    text("experimentResult", experimentResult || "\u5C1A\u672A\u6267\u884C\u5B9E\u9A8C\u64CD\u4F5C\u3002");
    const pile = el("experimentPile").value;
    const gun = el("experimentGun").value;
    el("experimentSend").disabled = !client?.authorized || !fresh || busy || !!client?.experimentalPending || !/^[0-9a-fA-F]{8}$/.test(pile) || !/^[0-9a-fA-F]{2}$/.test(gun);
    const loginProgress = el("liveLoginProgress");
    loginProgress.hidden = !device || phase !== "authenticating" || !!client?.authorized;
    if (!loginProgress.hidden) text("liveLoginProgress", client?.automaticLoginPending ? "\u6B63\u5728\u81EA\u52A8\u767B\u5F55\uFF0C\u7B49\u5F85\u8BBE\u5907\u786E\u8BA4\u2026" : "\u6B63\u5728\u9A8C\u8BC1\u9A8C\u8BC1\u7801\uFF0C\u7B49\u5F85\u8BBE\u5907\u786E\u8BA4\u2026");
    el("liveAuthBox").hidden = !device || phase !== "password" || !!client?.authorized;
    el("liveAuthorize").disabled = !client?.currentProtocol || phase === "authenticating" || busy;
    el("liveStart").disabled = !client?.authorized || !fresh || busy;
    el("liveStop").disabled = !client?.authorized || !fresh || busy || status2?.state !== "4";
    el("liveUnlock").disabled = !client?.authorized || !fresh || busy || !status2 || status2.state === "4" || status2.mode === "3" || status2.lock === "0";
    el("liveRefresh").disabled = !client?.authorized || busy;
    el("liveDisconnect").disabled = !device;
    el("liveChoose").disabled = !supported || busy;
    el("liveRestore").disabled = !supported || !client?.rememberedName || busy || !!device;
    el("liveForgetPassword").disabled = !client?.rememberedName;
    const adminPanel = el("adminPanel");
    adminPanel.hidden = !client?.authorized;
    const adminReady = !!client?.administratorAuthorized;
    el("adminAuthBox").hidden = adminReady;
    el("adminControls").hidden = !adminReady;
    el("adminLogin").disabled = !client?.authorized || !!client.adminPending || busy;
    for (const id of ["adminPlugOn", "adminPlugOff", "adminChangeBluetoothPassword", "adminChangePassword"])
      el(id).disabled = !adminReady || !fresh || busy || !!client?.adminPending;
    for (const id of ["adminMuteOn", "adminMuteOff"])
      el(id).disabled = !adminReady || !fresh || busy || !!client?.adminPending || client?.currentProtocol !== 2;
    el("adminPair").disabled = !adminReady || !fresh || busy || !!client?.adminPending || !client?.pairingAvailable;
    text("adminPairHint", client?.currentProtocol === 2 && !client.pairingAvailable ? "\u5F53\u524D\u8FDE\u63A5\u672A\u53D1\u73B0\u539F\u5C0F\u7A0B\u5E8F\u6240\u9700\u7684 FF03 \u914D\u5BF9\u901A\u77E5\u7279\u5F81\uFF1B\u4E0D\u80FD\u542F\u52A8\u65E0\u611F\u914D\u5BF9\u3002" : "\u4EC5\u65B0\u7248\u534F\u8BAE\u6709\u9759\u97F3\u548C\u65E0\u611F\u914D\u5BF9\u6307\u4EE4\uFF1B\u914D\u5BF9\u56DE\u6267\u4E0D\u7B49\u4E8E\u624B\u673A\u5DF2\u5B8C\u6210\u7CFB\u7EDF\u84DD\u7259\u914D\u5BF9\u3002");
    const authMode = el("adminAuthMode");
    authMode.disabled = !adminReady || busy;
    if (document.activeElement !== authMode) authMode.value = client?.manualBluetoothLogin ? "manual" : "auto";
    text("adminState", adminMessage || (adminReady ? "\u7BA1\u7406\u5458\u5DF2\u9A8C\u8BC1\uFF1B\u7BA1\u7406\u64CD\u4F5C\u4ECD\u9700\u8BBE\u5907\u56DE\u6267\u3002" : "\u7BA1\u7406\u5458\u6743\u9650\u672A\u9A8C\u8BC1\u3002"));
    const reservationBlocked = status2 ? reservationBlockReason(status2) : null;
    el("reserveSubmit").disabled = !client?.authorized || !fresh || busy || !!client?.reservationPending;
    text("reserveSubmit", client?.canCancelReservation ? "\u4FEE\u6539\u9884\u7EA6" : "\u63D0\u4EA4\u9884\u7EA6");
    el("reserveCancel").disabled = !client?.authorized || !fresh || busy || !!client?.reservationPending || status2?.state === "4" || !client?.canCancelReservation;
    const reserveInput = el("reserveStart");
    if (reservationStartAutomatic && reserveInput.value !== localMinute(nextMidnight())) resetReservationStart();
    reserveInput.min = localMinute(/* @__PURE__ */ new Date());
    reserveInput.max = localMinute(new Date(Date.now() + 24 * 60 * 60 * 1e3));
    text("reserveState", !client?.authorized ? "\u8FDE\u63A5\u5E76\u6388\u6743\u540E\u53EF\u9884\u7EA6\u3002" : client.reservationPending ? "\u6307\u4EE4\u5DF2\u53D1\u9001\uFF0C\u7B49\u5F85\u8BBE\u5907\u9884\u7EA6\u56DE\u6267\uFF1B\u6B64\u65F6\u52FF\u91CD\u590D\u63D0\u4EA4\u3002" : reservationResult || !fresh ? reservationResult || "\u7B49\u5F85\u6700\u65B0\u8BBE\u5907\u72B6\u6001\uFF0C\u64CD\u4F5C\u6682\u4E0D\u53EF\u7528\u3002" : status2?.mode === "3" ? "\u8BBE\u5907\u901A\u77E5\u663E\u793A\u9884\u7EA6\u6A21\u5F0F\uFF1B\u53EF\u4FEE\u6539\u6216\u53D6\u6D88\u3002" : reservationBlocked ? reservationBlocked : client.canCancelReservation ? "\u8BBE\u5907\u5DF2\u786E\u8BA4\u63D0\u4EA4\uFF0C\u5C1A\u5F85\u65B0\u7684\u9884\u7EA6\u6A21\u5F0F\u72B6\u6001\u901A\u77E5\u3002" : "\u8BBE\u5907\u672A\u62A5\u544A\u9884\u7EA6\u6A21\u5F0F\uFF1B\u53EF\u8BBE\u7F6E\u65B0\u7684\u9884\u7EA6\u3002");
    updateReservationCountdown();
    renderHistory();
  }
  function selectedProtocol() {
    const value = el("liveProtocol").value;
    return value === "1" ? 1 : value === "2" ? 2 : void 0;
  }
  el("liveChoose").addEventListener("click", () => {
    if (!client) return;
    void client.chooseDevice(selectedProtocol()).catch((error) => failure("\u9009\u62E9/\u8FDE\u63A5", error));
  });
  async function reconnectLast(source) {
    if (!client || busy) return;
    diagnostics.add("restore-request", { source, remembered: !!client.rememberedName, getDevices: !!adapter?.getDevices });
    busy = true;
    render();
    const dialogsBefore = errorDialogs;
    try {
      const found = await client.restore();
      diagnostics.add("restore-finish", { source, discovered: found });
      if (!found && errorDialogs === dialogsBefore) {
        const explanation = "Bluefy \u672A\u8FD4\u56DE\u4E0A\u6B21\u8BBE\u5907\u7684\u6D4F\u89C8\u5668\u6388\u6743\uFF1B\u7F51\u9875\u4E0D\u80FD\u4EC5\u51ED\u540D\u79F0\u6216 ID \u8FDE\u63A5\uFF0C\u8BF7\u7528\u300C\u9009\u62E9 / \u66F4\u6362\u8BBE\u5907\u300D\u91CD\u65B0\u6388\u6743\u3002";
        record(explanation);
        if (source === "button") showErrorModal(explanation);
      }
    } catch (error) {
      failure("\u6062\u590D\u8BBE\u5907", error);
    } finally {
      busy = false;
      render();
    }
  }
  el("liveRestore").addEventListener("click", () => {
    void reconnectLast("button");
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
      reportOperationError("\u84DD\u7259\u9A8C\u8BC1\u7801\u5FC5\u987B\u662F\u4E94\u4F4D\u6570\u5B57\u3002");
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
  for (const id of ["experimentPile", "experimentGun"]) el(id).addEventListener("input", render);
  el("experimentSend").addEventListener("click", () => {
    if (!client || busy || !client.authorized || !client.currentStatus || Date.now() - statusAt >= 2e4) return;
    const pile = el("experimentPile").value;
    const gun = el("experimentGun").value;
    const gear = Number(el("experimentGear").value);
    let packet;
    try {
      packet = experimentalGearCommand(pile, gun, gear);
    } catch (error) {
      reportOperationError(errorMessage(error));
      return;
    }
    const hex = [...packet].map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" ");
    if (!window.confirm(`\u5B9E\u9A8C\u547D\u4EE4\uFF0C\u65E7\u8BBE\u5907\u672A\u9A8C\u8BC1\u3002\u6863\u4F4D ${gear} \u4E0E 22\uFF0F7\uFF0F11\uFF0F16 kW \u7684\u5BF9\u5E94\u5173\u7CFB\u672A\u77E5\u3002
\u8BF7\u786E\u8BA4\u6869\u7F16\u7801\u548C\u67AA\u53F7\u5C5E\u4E8E\u5F53\u524D\u8BBE\u5907\uFF0C\u4E14\u5F53\u524D\u53EF\u73B0\u573A\u6838\u5BF9\u3002
\u5C06\u53D1\u9001\u539F\u59CB\u5B57\u8282\uFF1A${hex}
\u4EC5 82/01 \u52A0 54 \u72B6\u6001\u5339\u914D\u624D\u663E\u793A\u53CC\u91CD\u786E\u8BA4\uFF1B\u65E0\u81EA\u52A8\u91CD\u8BD5\u3002\u7EE7\u7EED\u5417\uFF1F`)) return;
    busy = true;
    experimentResult = `\u5DF2\u8BF7\u6C42\u6863\u4F4D ${gear}\uFF0C\u7B49\u5F85\u8BBE\u5907 82 \u56DE\u6267\u53CA 54 \u72B6\u6001\u2026`;
    render();
    void client.experimentalGear(pile, gun, gear).then(() => {
      experimentResult = `\u8BBE\u5907 82/01 \u5DF2\u63A5\u53D7\u300154 \u5DF2\u62A5\u544A\u6863\u4F4D ${gear}\uFF1B\u5B9E\u9645\u8F93\u51FA\u529F\u7387\u987B\u73B0\u573A\u6838\u5BF9\u3002`;
    }, (error) => {
      experimentResult = `\u6863\u4F4D ${gear} \u672A\u5F97\u5230\u53CC\u91CD\u786E\u8BA4\uFF1A${errorMessage(error)}`;
      failure("\u5B9E\u9A8C\u6863\u4F4D", error);
    }).finally(() => {
      busy = false;
      render();
    });
  });
  async function control(action) {
    if (!client) return;
    const name = { start: "\u5F00\u59CB\u5145\u7535", stop: "\u505C\u6B62\u5145\u7535", unlock: "\u89E3\u9664\u7535\u5B50\u9501" }[action];
    if (action === "start" && client.currentStatus) {
      const s = client.currentStatus;
      const blocked = s.gunFlag === "1" ? "\u8BF7\u5148\u63D2\u67AA" : s.selfStartFlag === "2" ? "\u8BF7\u5148\u53D6\u6D88\u5373\u63D2\u5373\u5145\u529F\u80FD" : s.mode === "3" ? "\u8BF7\u5148\u53D6\u6D88\u9884\u7EA6\u5145\u7535" : s.state !== "2" ? "\u8BF7\u5148\u62D4\u67AA\u518D\u63D2\u67AA" : null;
      diagnostics.add("control-gate", { action, allowed: !blocked, state: s.state, gun: s.gunFlag, mode: s.mode, selfStart: s.selfStartFlag });
      if (blocked) {
        reportOperationError(`\u65E0\u6CD5${name}\uFF1A${blocked}`);
        refreshDiagnostics();
        return;
      }
    }
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
      const status2 = client.currentStatus;
      if (status2) {
        const blocked = reservationBlockReason(status2);
        diagnostics.add("reservation-ui-gate", {
          allowed: !blocked,
          state: status2.state,
          gun: status2.gunFlag,
          lock: status2.lock,
          mode: status2.mode,
          selfStart: status2.selfStartFlag
        });
        if (blocked) {
          lastBlockedReservation = blocked;
          reservationResult = blocked;
          reportOperationError(blocked);
          refreshDiagnostics();
          render();
          return;
        }
        lastBlockedReservation = "";
      }
      try {
        reservation = selectedReservation();
      } catch (error) {
        diagnostics.add("reservation-input-error", diagnosticError(error), "warn");
        reservationResult = errorMessage(error);
        reportOperationError(`\u9884\u7EA6\u8F93\u5165\u9519\u8BEF\uFF1A${reservationResult}`);
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
        if (deviceId && client.currentDevice?.id === deviceId) {
          confirmedReservation = { deviceId, startsAt: reservation.start.getTime(), source: "session" };
          history.acceptReservation(deviceId, reservation.start.getTime(), reservation.end);
        }
      } else {
        await client.cancelReservation();
        if (confirmedReservation?.deviceId === deviceId) confirmedReservation = null;
        if (deviceId) history.cancelReservation(deviceId);
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
  var adminNames = {
    "admin-auth": "\u7BA1\u7406\u5458\u8BA4\u8BC1",
    "plug-on": "\u8BBE\u7F6E\u5373\u63D2\u5373\u5145",
    "plug-off": "\u53D6\u6D88\u5373\u63D2\u5373\u5145",
    "mute-on": "\u8BBE\u7F6E\u9759\u97F3",
    "mute-off": "\u53D6\u6D88\u9759\u97F3",
    pair: "\u5F00\u542F\u65E0\u611F\u914D\u5BF9\u7A97\u53E3",
    "bluetooth-password": "\u4FEE\u6539\u84DD\u7259\u9A8C\u8BC1\u7801",
    "admin-password": "\u4FEE\u6539\u7BA1\u7406\u5458\u9A8C\u8BC1\u7801"
  };
  async function runAdmin(action, inputId) {
    if (!client) return;
    const label = adminNames[action];
    const input = inputId ? el(inputId) : null;
    const value = input?.value;
    if (input && (!/^\d{5}$/.test(value ?? "") || action !== "admin-auth" && Number(value) > 65535)) {
      reportOperationError(`${label}\uFF1A\u8BF7\u8F93\u5165\u4E94\u4F4D\u6570\u5B57${action === "admin-auth" ? "" : "\uFF0C\u4E14\u6570\u503C\u4E0D\u5927\u4E8E 65535"}\u3002`);
      return;
    }
    if (action !== "admin-auth") {
      const warning = action === "plug-on" ? "\u539F\u5C0F\u7A0B\u5E8F\u63D0\u793A\uFF1A\u5373\u63D2\u5373\u5145\u53EF\u80FD\u88AB\u4ED6\u4EBA\u4F7F\u7528\u3002" : action === "pair" ? "\u8BBE\u5907\u6253\u5F00\u914D\u5BF9\u7A97\u53E3\u540E\uFF0C\u8FD8\u987B\u5728 iOS \u7CFB\u7EDF\u5B8C\u6210\u914D\u5BF9\uFF1B\u56DE\u6267\u4E0D\u80FD\u8BC1\u660E\u65E0\u611F\u5145\u7535\u5DF2\u7ECF\u542F\u7528\u3002" : action === "bluetooth-password" ? "\u8BBE\u5907\u786E\u8BA4\u540E\u4F1A\u5220\u9664\u65E7\u7684\u84DD\u7259\u9A8C\u8BC1\u7801\u7F13\u5B58\uFF0C\u4E0B\u4E00\u6B21\u9700\u8F93\u5165\u65B0\u7684\u9A8C\u8BC1\u7801\u3002" : "";
      if (!window.confirm(`\u786E\u5B9A\u5411\u771F\u5B9E\u8BBE\u5907\u6267\u884C\u300C${label}\u300D\uFF1F${warning}
\u4EC5\u8BBE\u5907\u8FD4\u56DE\u5339\u914D\u56DE\u6267\u624D\u89C6\u4E3A\u63A5\u53D7\u64CD\u4F5C\u3002`)) return;
    }
    if (input) input.value = "";
    busy = true;
    adminMessage = `\u6B63\u5728${label}\uFF0C\u7B49\u5F85\u8BBE\u5907\u56DE\u6267\u2026`;
    render();
    try {
      await client.admin(action, value);
      adminMessage = action === "pair" ? "\u8BBE\u5907\u5DF2\u786E\u8BA4\u5F00\u542F\u914D\u5BF9\u7A97\u53E3\uFF1B\u8BF7\u5728 iOS \u7CFB\u7EDF\u5B8C\u6210\u914D\u5BF9\u5E76\u73B0\u573A\u6838\u5BF9\u662F\u5426\u8FDB\u5165\u65E0\u611F\u6A21\u5F0F\u3002" : action === "bluetooth-password" ? "\u8BBE\u5907\u5DF2\u786E\u8BA4\u4FEE\u6539\uFF1B\u65E7\u9A8C\u8BC1\u7801\u7F13\u5B58\u5DF2\u5220\u9664\uFF0C\u91CD\u65B0\u8FDE\u63A5\u65F6\u987B\u8F93\u5165\u65B0\u9A8C\u8BC1\u7801\u5E76\u7531\u8BBE\u5907\u9A8C\u8BC1\u3002" : action === "admin-password" ? "\u8BBE\u5907\u5DF2\u786E\u8BA4\u4FEE\u6539\uFF1B\u539F\u7BA1\u7406\u5458\u6743\u9650\u5DF2\u5931\u6548\uFF0C\u8BF7\u7528\u65B0\u9A8C\u8BC1\u7801\u91CD\u65B0\u9A8C\u8BC1\u3002" : action === "mute-on" || action === "mute-off" ? "\u8BBE\u5907\u5DF2\u63A5\u53D7\u9759\u97F3\u64CD\u4F5C\uFF1B\u72B6\u6001\u62A5\u6587\u4E0D\u542B\u9759\u97F3\u6807\u5FD7\uFF0C\u8BF7\u73B0\u573A\u6838\u5BF9\u3002" : action === "admin-auth" ? "\u8BBE\u5907\u5DF2\u786E\u8BA4\u7BA1\u7406\u5458\u6743\u9650\u3002" : `\u8BBE\u5907\u5DF2\u63A5\u53D7${label}\uFF1B\u8BF7\u7B49\u540E\u7EED\u8BBE\u5907\u72B6\u6001\u6838\u5BF9\u3002`;
      record(adminMessage);
    } catch (error) {
      adminMessage = `${label}\u672A\u786E\u8BA4`;
      failure(label, error);
    } finally {
      busy = false;
      render();
    }
  }
  for (const [id, action, input] of [
    ["adminLogin", "admin-auth", "adminPassword"],
    ["adminPlugOn", "plug-on"],
    ["adminPlugOff", "plug-off"],
    ["adminMuteOn", "mute-on"],
    ["adminMuteOff", "mute-off"],
    ["adminPair", "pair"],
    ["adminChangeBluetoothPassword", "bluetooth-password", "adminNewBluetoothPassword"],
    ["adminChangePassword", "admin-password", "adminNewPassword"]
  ]) el(id).addEventListener("click", () => void runAdmin(action, input));
  el("adminAuthMode").addEventListener("change", () => {
    if (!client?.administratorAuthorized) return;
    try {
      client.setManualBluetoothLogin(el("adminAuthMode").value === "manual");
      adminMessage = "\u5DF2\u4FDD\u5B58\u672C\u7F51\u9875\u8BA4\u8BC1\u65B9\u5F0F\uFF1B\u8FDE\u63A5\u65F6\u4ECD\u9700\u8BBE\u5907\u786E\u8BA4\u84DD\u7259\u9A8C\u8BC1\u7801\u3002";
      render();
    } catch (error) {
      failure("\u4FDD\u5B58\u8BA4\u8BC1\u65B9\u5F0F", error);
    }
  });
  el("liveFaultDetail").addEventListener("click", () => {
    const status2 = client?.currentStatus;
    if (status2) window.alert(`\u6545\u969C\u72B6\u6001\uFF1A${status2.power || "\u672A\u62A5\u544A"}
${faultDescription(status2)}
${faultAdvice(status2)}
\u4EC5\u4F9D\u636E\u672C\u6B21\u8BBE\u5907\u72B6\u6001\u901A\u77E5\u3002`);
  });
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
    if (!window.confirm("\u6E05\u9664\u672C\u7F51\u7AD9\u4FDD\u5B58\u7684\u8BBE\u5907\u8BB0\u5F55\u3001\u9A8C\u8BC1\u7801\u53CA\u5168\u90E8\u672C\u5730\u5145\u7535/\u9884\u7EA6\u5386\u53F2\uFF0C\u5E76\u65AD\u5F00\u8FDE\u63A5\uFF1F")) return;
    client?.forgetDevice();
    history.clear();
    statusAt = 0;
    confirmedReservation = null;
    diagnostics.add("device-records-forgotten");
    render();
  });
  el("localHistoryClear").addEventListener("click", () => {
    if (!window.confirm("\u786E\u5B9A\u5220\u9664\u6B64\u6D4F\u89C8\u5668\u4E2D\u6240\u6709\u8BBE\u5907\u7684\u672C\u7F51\u9875\u5145\u7535\u53CA\u9884\u7EA6\u8BB0\u5F55\uFF1F\u65E0\u6CD5\u6062\u590D\u3002")) return;
    history.clear();
    confirmedReservation = null;
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
      if (!copied) reportOperationError("\u590D\u5236\u65E5\u5FD7\u5931\u8D25\uFF1A\u8BF7\u957F\u6309\u65E5\u5FD7\u6587\u672C\uFF0C\u624B\u52A8\u5168\u9009\u5E76\u590D\u5236\u3002");
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
    diagnostics.clear();
    feedback.clear();
    feedbackDirty = false;
    lastFeedbackPaintAt = 0;
    text("liveLog", "\u6682\u65E0\u8BBE\u5907\u53CD\u9988");
    el("liveLog").scrollTop = 0;
    refreshDiagnostics(true);
    text("diagnosticsHint", "\u65E5\u5FD7\u5DF2\u6E05\u7A7A\u3002\u65B0\u7684\u8BBE\u5907\u4E8B\u4EF6\u4F1A\u91CD\u65B0\u5F00\u59CB\u8BB0\u5F55\u3002");
  });
  var tabPairs = [
    ["tabConnection", "tabPanelConnection"],
    ["tabCharge", "tabPanelCharge"],
    ["tabExperiment", "tabPanelExperiment"],
    ["tabFeedback", "tabPanelFeedback"],
    ["tabAbout", "tabPanelAbout"]
  ].map(([tabId, panelId]) => ({ tab: el(tabId), panel: el(panelId) }));
  function activateTab(index) {
    showTab(tabPairs, index);
    el("liveTabContent").scrollTop = 0;
  }
  tabPairs.forEach(({ tab }, index) => tab.addEventListener("click", () => activateTab(index)));
  el("liveTabs").addEventListener("keydown", (event) => {
    const current = tabPairs.findIndex(({ tab }) => tab === event.target);
    const next = tabIndexForKey(event.key, current, tabPairs.length);
    if (next === null) return;
    event.preventDefault();
    activateTab(next);
    tabPairs[next].tab.focus();
  });
  activateTab(0);
  resetReservationStart();
  diagnostics.add("app-start", {
    ...environment(),
    schema: 4,
    buildVersion: "0.1.0",
    buildRevision: "8f66f22",
    buildTimeLocal: formatLocalBuildTime("2026-09-27T18:10:52.252Z")
  });
  refreshDiagnostics(true);
  render();
  setInterval(render, 5e3);
  setInterval(updateReservationCountdown, 1e3);
  document.addEventListener("visibilitychange", () => {
    diagnostics.add("page-visibility", {
      state: document.visibilityState,
      connected: !!client?.currentDevice?.gatt?.connected,
      authorized: !!client?.authorized,
      statusAgeMs: statusAt ? Date.now() - statusAt : null
    });
    refreshDiagnostics();
    updateReservationCountdown();
  });
  window.addEventListener("pagehide", (event) => {
    el("experimentPile").value = "";
    el("experimentGun").value = "";
    experimentReport = null;
    diagnostics.add("page-hide", {
      persisted: event.persisted,
      connected: !!client?.currentDevice?.gatt?.connected,
      authorized: !!client?.authorized,
      statusAgeMs: statusAt ? Date.now() - statusAt : null
    });
  });
  window.addEventListener("pageshow", (event) => {
    diagnostics.add("page-show", {
      persisted: event.persisted,
      connected: !!client?.currentDevice?.gatt?.connected,
      authorized: !!client?.authorized,
      statusAgeMs: statusAt ? Date.now() - statusAt : null
    });
    refreshDiagnostics();
    render();
  });
  if (client?.rememberedName && window.isSecureContext) {
    diagnostics.add("restore-auto-start", { remembered: true });
    refreshDiagnostics();
    record("\u5C1D\u8BD5\u6062\u590D\u4E0A\u6B21\u8BBE\u5907\u7684\u6D4F\u89C8\u5668\u6388\u6743\u2026");
    void reconnectLast("auto");
  } else {
    diagnostics.add("restore-auto-skipped", { reason: !client ? "no-bluetooth-api" : !window.isSecureContext ? "insecure-context" : "no-record" });
    refreshDiagnostics();
  }
})();
