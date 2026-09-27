// 本地诊断记录：只收集事件与安全字段，不采集 BLE 原始帧或密码。
export type DiagnosticLevel = "info" | "warn" | "error";
export type DiagnosticValue = string | number | boolean | null;
export interface DiagnosticEntry {
  at: string;
  level: DiagnosticLevel;
  event: string;
  data: Record<string, DiagnosticValue>;
}
export interface DiagnosticEnvironment {
  secureContext: boolean;
  webBluetooth: boolean;
  getDevices: boolean;
  scheme: "https" | "file" | "localhost" | "other";
}
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const KEY = "wattsaving-diagnostics-v1";
const MAX_ENTRIES = 160;
const MAX_CHARS = 32000;
const HIDDEN_FIELD = /pass(word)?|secret|token|device.?id|device.?name|alias|mac|path|url|ssid|vin|raw|payload|frame|message/i;
const SAFE_ERROR_NAMES = new Set(["Error", "TypeError", "NotFoundError", "NotAllowedError", "SecurityError", "NetworkError", "NotSupportedError", "InvalidStateError", "AbortError", "TimeoutError", "OperationError", "DataError", "ConnectionInterruptedError"]);
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// 不记录浏览器/设备自由文本错误；只记录有限的异常类别和推断的失败阶段原因。
export function diagnosticError(error: unknown): { kind: string; reason: string } {
  const name = error instanceof Error ? error.name : "unknown";
  const kind = SAFE_ERROR_NAMES.has(name) ? name : "other";
  const text = `${name} ${error instanceof Error ? error.message : ""}`.toLowerCase();
  const reason = /connectioninterrupted/.test(text) ? "connection-interrupted" :
    /cancel|abort/.test(error instanceof Error ? error.message.toLowerCase() : "") ? "cancelled" :
    /not.?found|unknown service|unknown characteristic|unavailable|not available|\bmissing\b|does not exist|no such/.test(text) ? "not-found" :
    /permission|not.?allowed|security|unauthori[sz]ed|access denied/.test(text) ? "permission" :
    /bluetooth.*(?:off|disabled)|powered off/.test(text) ? "bluetooth-off" :
    /disconnect|not connected|connection lost/.test(text) ? "disconnected" :
    /time.?out/.test(text) ? "timeout" :
    /unsupported|not supported|not implemented/.test(text) ? "unsupported" :
    /busy|in progress/.test(text) ? "busy" :
    /length|too long|exceed|\bmtu\b/.test(text) ? "size-or-mtu" : "unspecified";
  return { kind, reason };
}

export class Diagnostics {
  private readonly storage: Store | null;
  private readonly secrets = new Set<string>();
  private entries: DiagnosticEntry[] = [];
  private persistOk = true;
  constructor(storage?: Store | null) {
    if (storage !== undefined) this.storage = storage;
    else {
      try { this.storage = typeof localStorage !== "undefined" ? localStorage : null; }
      catch { this.storage = null; }
    }
    this.persistOk = this.storage !== null;
    try {
      const value: unknown = JSON.parse(this.storage?.getItem(KEY) ?? "null");
      if (Array.isArray(value)) {
        this.entries = value.slice(-MAX_ENTRIES).filter((entry): entry is DiagnosticEntry =>
          !!entry && typeof entry === "object" && typeof entry.at === "string" && typeof entry.event === "string" &&
          ["info", "warn", "error"].includes(entry.level) && !!entry.data && typeof entry.data === "object"
        ).map(entry => this.cleanEntry(entry));
      }
    } catch { this.persistOk = false; }
  }
  get storageAvailable(): boolean { return this.persistOk; }
  get recent(): readonly DiagnosticEntry[] { return this.entries; }
  hide(value: string): void { if (value.length >= 3) this.secrets.add(value); }
  sanitize(input: string): string {
    let safe = input.slice(0, 600);
    for (const secret of this.secrets) safe = safe.replace(new RegExp(escapeRegExp(secret), "gi"), "[REDACTED]");
    return safe
      .replace(/@%PD-100-0-181-\d{5}-@/gi, "[AUTH_FRAME]")
      .replace(/80100000\d{5}000006\d?/g, "[AUTH_FRAME]")
      .replace(/@%[a-z]{2}-[^@\r\n]{0,600}-@/gi, "[BLE_FRAME]")
      .replace(/\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi, "[DEVICE_ID]")
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[DEVICE_ID]")
      .replace(/(?:[a-z]:\\|\/mnt\/|\/Users\/|\/home\/)[^\s"']+/gi, "[LOCAL_PATH]")
      .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, "[EMAIL]")
      .replace(/\b\d{5,}\b/g, "[NUMBER]");
  }
  private cleanData(data: Record<string, DiagnosticValue>): Record<string, DiagnosticValue> {
    const safe: Record<string, DiagnosticValue> = {};
    for (const [key, value] of Object.entries(data).slice(0, 16)) {
      const field = key.replace(/[^a-z0-9_-]/gi, "_").slice(0, 32);
      if (!field) continue;
      safe[field] = HIDDEN_FIELD.test(field) ? "[REDACTED]" : typeof value === "string" ? this.sanitize(value) :
        typeof value === "number" && Number.isFinite(value) ? value : typeof value === "boolean" || value === null ? value : "[REDACTED]";
    }
    return safe;
  }
  private cleanEntry(entry: DiagnosticEntry): DiagnosticEntry {
    return { at: this.sanitize(entry.at).slice(0, 32), level: entry.level, event: entry.event.replace(/[^a-z0-9_.-]/gi, "_").slice(0, 60), data: this.cleanData(entry.data) };
  }
  add(event: string, data: Record<string, DiagnosticValue> = {}, level: DiagnosticLevel = "info"): void {
    const entry = this.cleanEntry({ at: new Date().toISOString(), level, event, data });
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    let json = JSON.stringify(this.entries);
    while (json.length > MAX_CHARS && this.entries.length > 1) {
      this.entries.shift(); json = JSON.stringify(this.entries);
    }
    try { this.storage?.setItem(KEY, json); }
    catch { this.persistOk = false; }
  }
  exportText(environment: DiagnosticEnvironment): string {
    // 再清洗一次：将此前存储的记录与新加入的隐藏词一并脱敏。
    const entries = this.entries.map(entry => this.cleanEntry(entry));
    return ["WattSaving diagnostics v5 (no passwords, device IDs or raw BLE frames)",
      `environment: ${JSON.stringify(environment)}`,
      `localPersistence: ${this.storageAvailable ? "available" : "unavailable"}`,
      ...entries.map(entry => JSON.stringify(entry))].join("\n");
  }
  clear(): void {
    this.entries = []; this.secrets.clear();
    try { this.storage?.removeItem(KEY); }
    catch { this.persistOk = false; }
  }
}
