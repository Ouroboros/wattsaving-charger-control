export interface BuildInfo { version: string; revision: string; builtAt: string; }

export function formatBuildInfo(info: BuildInfo): string {
  const date = new Date(info.builtAt);
  const time = Number.isFinite(date.getTime()) ? `${date.toISOString().slice(0, 19).replace("T", " ")} UTC` : "未知";
  return `版本 v${info.version} · 提交 ${info.revision} · 构建 ${time}`;
}
