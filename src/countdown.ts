// 预约倒计时仅使用当前网页时钟估算，不代表充电桩已按时启动。
export function countdownTo(startAtMs: number, nowMs = Date.now()): string {
  if (!Number.isFinite(startAtMs) || !Number.isFinite(nowMs)) throw new Error("预约倒计时的时间无效");
  const seconds = Math.max(0, Math.ceil((startAtMs - nowMs) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remainingSeconds = seconds % 60;
  return [hours, minutes, remainingSeconds].map(value => String(value).padStart(2, "0")).join(":");
}
