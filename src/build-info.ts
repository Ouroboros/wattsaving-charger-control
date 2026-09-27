export interface BuildInfo { version: string; revision: string; builtAt: string; }

const pad = (value: number): string => String(value).padStart(2, "0");

export function formatLocalBuildTime(builtAt: string): string {
  const date = new Date(builtAt);
  if (!Number.isFinite(date.getTime())) return "未知";
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const absolute = Math.abs(offset);
  const local = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return `${local} ${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

export function formatBuildInfo(info: BuildInfo): string {
  return `版本 v${info.version} · 提交 ${info.revision} · 构建（本地） ${formatLocalBuildTime(info.builtAt)}`;
}
