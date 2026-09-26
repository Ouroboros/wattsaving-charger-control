// 旧小程序 pages/password/password.js 与 pages/index/index.js 中已核实的报文。
// 未确认“次日 00:00”的语义，因此故意不提供预约指令。
export type Version = 1 | 2;
export type ControlAction = "start" | "stop" | "unlock";
export interface DeviceStatus {
  type: "status";
  protocol: Version;
  soc: number;
  energyKWh: number;
  minutes: number;
  state: string;
  remainingMinutes: number;
  lock: string;
  mode: string;
  power: string;
  voltage: string;
  currentA: number | null;
  gunFlag: string;
  selfStartFlag: string;
  vinFlag: string;
}
export type Frame = DeviceStatus |
  { type: "auth"; protocol: Version; ok: boolean; code: string } |
  { type: "ack"; protocol: 2; action: "start" | "stop"; ok: boolean; code: string } |
  { type: "unknown"; protocol: 2; code: string };

const commands: Record<Version, Record<ControlAction, string>> = {
  1: { start: "80116000000000000062", stop: "80126000000000000063", unlock: "80166000000000000067" },
  2: { start: "@%PD-102-0-181-@", stop: "@%PD-104-0-181-@", unlock: "@%PD-108-0-181-@" }
};
const numeric = (value: string | undefined): boolean => /^\d+$/.test(value ?? "");
export function checksum(body: string): string {
  if (body.length !== 19 || !numeric(body)) throw new Error("旧版帧主体须为 19 位数字");
  return String([...body].reduce((sum, digit) => sum + Number(digit), 0) % 10);
}
function appendChecksum(body: string): string { return body + checksum(body); }
export function command(protocol: Version, action: "auth" | ControlAction, password?: string): string {
  if (action === "auth") {
    if (!/^\d{5}$/.test(password ?? "")) throw new Error("蓝牙验证码须为五位数字");
    return protocol === 1 ? appendChecksum(`80100000${password}000006`) : `@%PD-100-0-181-${password}-@`;
  }
  return commands[protocol][action];
}
export function syncClock(protocol: Version, date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  const parts = [String(date.getFullYear()), pad(date.getMonth() + 1), pad(date.getDate()), pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())];
  return protocol === 1 ? appendChecksum(`821${parts.join("")}06`) : `@%PD-204-0-181-${parts.join("-")}-@`;
}
function status(protocol: Version, fields: string[]): DeviceStatus | null {
  if (fields.length < 13 || !fields.slice(0, 3).every(numeric) || ![fields[3], fields[5], fields[10]].every(numeric)) return null;
  return {
    type: "status", protocol, soc: Number(fields[0]), energyKWh: Number(fields[1]) / 10,
    minutes: Number(fields[2]), state: fields[3], remainingMinutes: Number(fields[4]),
    lock: fields[5], mode: fields[6], power: fields[7], voltage: fields[8],
    currentA: numeric(fields[9]) ? Number(fields[9]) / 10 : null,
    gunFlag: fields[10], selfStartFlag: fields[11], vinFlag: fields[12]
  };
}
export function parseNew(frame: string): Frame | null {
  if (!frame.startsWith("@%DP-") || !frame.endsWith("-@")) return null;
  const parts = frame.split("-");
  const code = parts[1];
  if (code === "101") return { type: "auth", protocol: 2, ok: parts[4] === "1", code: parts[4] ?? "" };
  if (code === "103" || code === "105") return { type: "ack", protocol: 2, action: code === "103" ? "start" : "stop", ok: parts[4] === "1", code: parts[4] ?? "" };
  if (code === "107") return status(2, parts.slice(4, 17));
  return { type: "unknown", protocol: 2, code: code ?? "" };
}
export function parseOld(frame: string): Frame | null {
  if (!/^\d{40}$/.test(frame)) return null;
  const first = frame.slice(0, 20), second = frame.slice(20);
  if (first[19] !== checksum(first.slice(0, 19)) || second[19] !== checksum(second.slice(0, 19))) return null;
  const header = first[0] + second[0], trailer = first[18] + second[18];
  if (header === "88" && first[1] + second[1] === "88" && trailer === "11") {
    const code = first[4] + second[4];
    return { type: "auth", protocol: 1, ok: code === "33", code };
  }
  if (!["88", "77", "66"].includes(header) || trailer !== "66" || first[2] !== "1" || second[2] !== "2") return null;
  return status(1, [frame.slice(8, 11), frame.slice(11, 15), frame.slice(15, 18), frame[27], frame.slice(4, 7), frame[3], frame[23], frame.slice(28, 32), frame.slice(35, 38), frame.slice(32, 35), frame[24], frame[26], frame[25]]);
}
export class FrameDecoder {
  private buffer = "";
  reset(): void { this.buffer = ""; }
  feed(chunk: string): Frame[] {
    this.buffer += chunk;
    const frames: Frame[] = [];
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
        if (parsed) { frames.push(parsed); this.buffer = this.buffer.slice(40); }
        else this.buffer = this.buffer.slice(1);
      } else if ("@%DP-".startsWith(this.buffer)) break;
      else this.buffer = this.buffer.slice(1);
    }
    return frames;
  }
}
