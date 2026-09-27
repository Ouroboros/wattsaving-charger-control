// 旧小程序 pages/password/password.js、pages/index/index.js、pages/reserve/reserve.js 中的报文。
export type Version = 1 | 2;
export type ControlAction = "start" | "stop" | "unlock";
export type AdminAction = "admin-auth" | "plug-on" | "plug-off" | "mute-on" | "mute-off" | "pair" | "bluetooth-password" | "admin-password";
export type ReservationEnd = { kind: "full" } | { kind: "time"; minutes: number } | { kind: "energy"; kWh: number };
export interface Reservation { start: Date; end: ReservationEnd; }
export type ReservationAction = "submit" | "cancel";
export function nextMidnight(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
}
// datetime-local 没有时区后缀；显式按设备使用者的本地时间解析并拒绝不存在的时间。
export function parseLocalMinute(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("预约时间格式无效");
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute) {
    throw new Error("预约时间不是有效的本地时间");
  }
  return date;
}
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
  { type: "reservation"; protocol: Version; action: ReservationAction; ok: boolean; code: string } |
  { type: "admin"; protocol: Version; action: AdminAction | "mute"; ok: boolean; code: string } |
  { type: "unknown"; protocol: 2; code: string };

const commands: Record<Version, Record<ControlAction, string>> = {
  1: { start: "80116000000000000062", stop: "80126000000000000063", unlock: "80166000000000000067" },
  2: { start: "@%PD-102-0-181-@", stop: "@%PD-104-0-181-@", unlock: "@%PD-108-0-181-@" }
};
const numeric = (value: string | undefined): boolean => /^\d+$/.test(value ?? "");
const pad = (value: number): string => String(value).padStart(2, "0");
const calendar = (date: Date): string[] => [String(date.getFullYear()), pad(date.getMonth() + 1), pad(date.getDate()), pad(date.getHours()), pad(date.getMinutes())];
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
export function adminCommand(protocol: Version, action: AdminAction, password?: string): string {
  const needsValue = action === "admin-auth" || action === "bluetooth-password" || action === "admin-password";
  if (needsValue && !/^\d{5}$/.test(password ?? "")) throw new Error("管理员验证或新密码须为五位数字");
  if (action !== "admin-auth" && needsValue && Number(password) > 65535) throw new Error("新密码不能大于 65535");
  if (!needsValue && password !== undefined) throw new Error("此管理操作不得携带密码");
  if (protocol === 1) {
    if (["mute-on", "mute-off", "pair"].includes(action)) throw new Error("旧版协议没有此管理功能");
    if (needsValue) {
      const selector = action === "admin-auth" ? "1" : action === "bluetooth-password" ? "2" : "4";
      return appendChecksum(`8010${selector}000${password}000006`);
    }
    const selector = action === "plug-on" ? "8" : "9";
    return appendChecksum(`801${selector}6${"0".repeat(13)}6`);
  }
  const codes: Record<AdminAction, string> = {
    "admin-auth": "120", "plug-on": "110", "plug-off": "112", "mute-on": "202", "mute-off": "202",
    "pair": "136", "bluetooth-password": "118", "admin-password": "132"
  };
  const value = action === "mute-on" || action === "pair" ? "1" : action === "mute-off" ? "0" : needsValue ? password! : "@";
  return action === "plug-on" || action === "plug-off" ? `@%PD-${codes[action]}-0-181-@` : `@%PD-${codes[action]}-0-181-${value}-@`;
}
export function syncClock(protocol: Version, date = new Date()): string {
  const parts = [...calendar(date), pad(date.getSeconds())];
  return protocol === 1 ? appendChecksum(`821${parts.join("")}06`) : `@%PD-204-0-181-${parts.join("-")}-@`;
}
export function validateReservation(reservation: Reservation, now = new Date()): void {
  const start = reservation.start;
  if (!(start instanceof Date) || !Number.isFinite(start.getTime()) || !Number.isFinite(now.getTime()) || start.getFullYear() < 1000 || start.getFullYear() > 9999 || start.getSeconds() || start.getMilliseconds()) {
    throw new Error("预约开始时间无效，须精确到分钟");
  }
  const offset = start.getTime() - now.getTime();
  if (offset <= 0 || offset > 24 * 60 * 60 * 1000) throw new Error("预约开始时间须在未来 24 小时内");
  if (reservation.end.kind === "time" && (!Number.isInteger(reservation.end.minutes) || reservation.end.minutes < 60 || reservation.end.minutes > 720 || reservation.end.minutes % 60 !== 0)) {
    throw new Error("预约时长仅支持 1 至 12 小时（整小时）");
  }
  if (reservation.end.kind === "energy" && (!Number.isInteger(reservation.end.kWh) || reservation.end.kWh < 5 || reservation.end.kWh > 99 || reservation.end.kWh % 5 !== 0 && reservation.end.kWh !== 99)) {
    throw new Error("预约电量仅支持 5 至 95 度（每档 5 度）或 99 度");
  }
  if (!["full", "time", "energy"].includes(reservation.end.kind)) throw new Error("未知的充电结束方式");
}
export function reservationCommand(protocol: Version, action: ReservationAction, reservation?: Reservation, now = new Date()): string {
  if (action === "cancel") {
    if (reservation) throw new Error("取消预约不得携带新的预约条件");
    return protocol === 1 ? "80176000000000000068" : "@%PD-116-0-181-@";
  }
  if (action !== "submit" || !reservation) throw new Error("提交预约须提供开始时间与结束条件");
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
  if ((code === "115" || code === "117") && (parts[4] === "0" || parts[4] === "1")) return { type: "reservation", protocol: 2, action: code === "115" ? "submit" : "cancel", ok: parts[4] === "1", code: parts[4] };
  const adminCodes: Record<string, AdminAction | "mute"> = { "121": "admin-auth", "111": "plug-on", "113": "plug-off", "119": "bluetooth-password", "133": "admin-password", "203": "mute", "137": "pair" };
  if (adminCodes[code] && (parts[4] === "0" || parts[4] === "1")) return { type: "admin", protocol: 2, action: adminCodes[code], ok: parts[4] === "1", code: parts[4] };
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
  if (header === "88" && first[1] + second[1] === "88" && trailer === "66") {
    const kind = first[3] + second[3];
    const adminKinds: Record<string, [AdminAction, number]> = {
      "44": ["admin-auth", 7], "55": ["bluetooth-password", 8], "66": ["plug-on", 9],
      "77": ["plug-off", 10], "88": ["admin-password", 11]
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
