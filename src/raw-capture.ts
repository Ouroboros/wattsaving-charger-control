// 用户手动开启的临时抓包；仅保存在当前页面内存，不接入持久诊断日志。
export type RawDirection = "TX" | "RX";
const MAX_ENTRIES = 200;

export class RawCapture {
  private entries: string[] = [];
  enabled = false;
  get count(): number { return this.entries.length; }
  start(): void { this.enabled = true; }
  stop(): void { this.enabled = false; }
  clear(): void { this.entries = []; }
  record(direction: RawDirection, bytes: Uint8Array, at = new Date()): boolean {
    if (!this.enabled) return false;
    const hex = [...bytes].map(byte => byte.toString(16).padStart(2, "0").toUpperCase()).join(" ");
    const ascii = [...bytes].map(byte => byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".").join("");
    const label = direction === "TX" ? "TX 写入尝试" : "RX 通知";
    this.entries.push(`[${at.toLocaleString("zh-CN", { hour12: false })}] ${label} · ${bytes.length} 字节\nHEX: ${hex}\nASCII: ${ascii}`);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    return true;
  }
  toText(): string { return this.entries.join("\n\n"); }
}
