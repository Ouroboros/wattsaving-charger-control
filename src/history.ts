import type { DeviceStatus, ReservationEnd } from "./protocol";

const KEY = "wattsaving-local-history-v1";
const LIMIT = 100;
export interface ChargeRecord {
  id: string;
  deviceId: string;
  startedAt: number | null;
  firstSeenAt: number;
  endedAt: number | null;
  state: "charging" | "ended";
  energyKWh: number | null;
  minutes: number | null;
}
export interface ReserveRecord {
  id: string;
  deviceId: string;
  submittedAt: number;
  startsAt: number;
  end: string;
  state: "accepted" | "observed" | "charging" | "ended" | "cancelled" | "replaced";
  updatedAt: number;
}
interface HistoryData { charges: ChargeRecord[]; reservations: ReserveRecord[]; }
const empty = (): HistoryData => ({ charges: [], reservations: [] });
const finiteTime = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const deviceRecord = (v: unknown): v is { id: string; deviceId: string } =>
  !!v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string" &&
  typeof (v as { deviceId?: unknown }).deviceId === "string";
export class LocalHistory {
  private data: HistoryData = empty();
  private lastLive = new Map<string, string>();
  readonly available: boolean;
  constructor(private readonly storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">) {
    let available = !!storage;
    try {
      const raw = storage?.getItem(KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          const obj = parsed as Partial<HistoryData>;
          this.data.charges = Array.isArray(obj.charges) ? obj.charges.filter(deviceRecord).slice(0, LIMIT) as ChargeRecord[] : [];
          this.data.reservations = Array.isArray(obj.reservations) ? obj.reservations.filter(deviceRecord).slice(0, LIMIT) as ReserveRecord[] : [];
        }
      }
    } catch { available = false; this.data = empty(); }
    this.available = available;
  }
  private save(): void {
    try { this.storage?.setItem(KEY, JSON.stringify(this.data)); } catch { /* 私密模式：仅保留本次页面的记录 */ }
  }
  charges(deviceId: string): ChargeRecord[] { return this.data.charges.filter(r => r.deviceId === deviceId); }
  reservations(deviceId: string): ReserveRecord[] { return this.data.reservations.filter(r => r.deviceId === deviceId); }
  latestDeviceId(): string | null {
    const charge = this.data.charges[0], reservation = this.data.reservations[0];
    return !charge ? reservation?.deviceId || null : !reservation || charge.firstSeenAt >= reservation.submittedAt ? charge.deviceId : reservation.deviceId;
  }
  latestReservation(deviceId: string): ReserveRecord | undefined {
    return this.reservations(deviceId).find(r => ["accepted", "observed", "charging"].includes(r.state) && finiteTime(r.startsAt));
  }
  trackStatus(deviceId: string, status: DeviceStatus, now = Date.now()): void {
    const previous = this.lastLive.get(deviceId);
    this.lastLive.set(deviceId, status.state);
    let changed = false;
    const active = this.data.charges.find(r => r.deviceId === deviceId && r.state === "charging");
    if (status.state === "4") {
      if (!active) {
        this.data.charges.unshift({ id: String(now), deviceId, startedAt: previous === "2" ? now : null,
          firstSeenAt: now, endedAt: null, state: "charging", energyKWh: Number.isFinite(status.energyKWh) ? status.energyKWh : null,
          minutes: Number.isFinite(status.minutes) ? status.minutes : null });
        this.data.charges = this.data.charges.slice(0, LIMIT);
        changed = true;
      } else if (active.energyKWh !== status.energyKWh || active.minutes !== status.minutes) {
        active.energyKWh = Number.isFinite(status.energyKWh) ? status.energyKWh : active.energyKWh;
        active.minutes = Number.isFinite(status.minutes) ? status.minutes : active.minutes;
        changed = true;
      }
    } else if (active) {
      active.state = "ended";
      // 只有本次页面确实观察到充电中 -> 非充电中，才记录结束观察时间。
      active.endedAt = previous === "4" ? now : null;
      active.energyKWh = Number.isFinite(status.energyKWh) ? status.energyKWh : active.energyKWh;
      active.minutes = Number.isFinite(status.minutes) ? status.minutes : active.minutes;
      changed = true;
    }
    const reservation = this.latestReservation(deviceId);
    if (reservation) {
      let state: ReserveRecord["state"] = reservation.state;
      if (status.mode === "3" && status.state !== "4" && state === "accepted") state = "observed";
      if (status.state === "4" && state === "observed") state = "charging";
      if (status.state !== "4" && state === "charging" && previous === "4") state = "ended";
      if (state !== reservation.state) { reservation.state = state; reservation.updatedAt = now; changed = true; }
    }
    if (changed) this.save();
  }
  acceptReservation(deviceId: string, startsAt: number, end: ReservationEnd, now = Date.now()): void {
    const previous = this.latestReservation(deviceId);
    if (previous) { previous.state = "replaced"; previous.updatedAt = now; }
    const label = end.kind === "full" ? "自动充满" : end.kind === "time" ? `${end.minutes / 60} 小时` : `${end.kWh} 度`;
    this.data.reservations.unshift({ id: String(now), deviceId, submittedAt: now, startsAt, end: label, state: "accepted", updatedAt: now });
    this.data.reservations = this.data.reservations.slice(0, LIMIT);
    this.save();
  }
  cancelReservation(deviceId: string, now = Date.now()): void {
    const reservation = this.latestReservation(deviceId);
    if (!reservation) return;
    reservation.state = "cancelled"; reservation.updatedAt = now; this.save();
  }
  clear(): void {
    this.data = empty(); this.lastLive.clear();
    try { this.storage?.removeItem(KEY); } catch { /* 浏览器拒绝本地存储 */ }
  }
}
