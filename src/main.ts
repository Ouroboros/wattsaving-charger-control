import { ChargerClient, type BleAdapter, type ChargerEvent } from "./ble";
import { Diagnostics, type DiagnosticEnvironment } from "./diagnostics";
import type { ControlAction, DeviceStatus, Version } from "./protocol";

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`网页缺少必要元素：${id}`);
  return node as T;
}
const text = (id: string, value: string): void => { el(id).textContent = value; };
const adapter = (navigator as Navigator & { bluetooth?: BleAdapter }).bluetooth;
const diagnostics = new Diagnostics();
const client = adapter ? new ChargerClient(adapter, handleEvent, () => window.isSecureContext, (event, data, level) => {
  diagnostics.add(event, data, level);
  refreshDiagnostics();
}) : null;
let phase = "offline";
let busy = false;
let statusAt = 0;
const recentMessages: string[] = [];
function environment(): DiagnosticEnvironment {
  const scheme = location.protocol === "https:" ? "https" : location.protocol === "file:" ? "file" :
    ["localhost", "127.0.0.1"].includes(location.hostname) ? "localhost" : "other";
  return { secureContext: window.isSecureContext, webBluetooth: !!adapter, getDevices: !!adapter?.getDevices, scheme };
}
function refreshDiagnostics(force = false): void {
  const area = el<HTMLTextAreaElement>("diagnosticsText");
  if (force || document.activeElement !== area) area.value = diagnostics.exportText(environment());
  if (!diagnostics.storageAvailable) text("diagnosticsHint", "浏览器未允许本地保存；关闭页面后日志可能丢失。请先复制上方文本。");
}
const stateName = (status: DeviceStatus | null): string => {
  if (!status) return "等候设备实时状态";
  if (status.state === "4") return "充电中";
  if (status.state === "3") return "设备报出故障";
  if (status.state === "2") return "已就绪";
  return `设备状态 ${status.state || "未知"}（含义未核实）`;
};
function record(message: string): void {
  // 页面短暂展示用户反馈；不把自由文本写进可导出的诊断日志，避免设备名混入日志。
  recentMessages.unshift(message);
  if (recentMessages.length > 6) recentMessages.length = 6;
  text("liveLog", recentMessages.join("\n"));
}
function errorKind(error: unknown): string { return error instanceof Error ? error.name : "unknown"; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function failure(action: string, error: unknown): void {
  diagnostics.add("ui-error", { action, kind: errorKind(error) }, "error");
  refreshDiagnostics();
  record(`${action}失败：${errorMessage(error)}`);
}
function handleEvent(event: ChargerEvent): void {
  if (event.type === "phase") { phase = event.phase; diagnostics.add("phase", { phase }); record(event.message); }
  if (event.type === "notice") record(event.message);
  if (event.type === "protocol") record(`协议：${event.version === 1 ? "旧版" : "新版"}（${event.source}）`);
  if (event.type === "auth-needed") record(event.message);
  if (event.type === "status") { statusAt = Date.now(); record("收到设备状态通知。"); }
  refreshDiagnostics();
  render();
}
function render(): void {
  const supported = !!adapter && window.isSecureContext;
  text("liveSupport", !window.isSecureContext ? "当前不是安全上下文，Web Bluetooth 不可用；请从 Bluefy 打开 HTTPS GitHub Pages 地址。" :
    !adapter ? "浏览器未提供 Web Bluetooth。请在 iPhone 的 Bluefy 中打开已发布的 HTTPS 页面。" : "检测到 Web Bluetooth API；仍需实际设备授权与通信测试。");
  el("liveSupport").className = `notice ${supported ? "light" : ""}`;
  const device = client?.currentDevice;
  const status = client?.currentStatus ?? null;
  const fresh = !!status && Date.now() - statusAt < 20000;
  text("liveDevice", device ? `${device.name || "未命名设备"} · ${client?.authorized ? "已授权" : "未授权"}` :
    client?.rememberedName ? `上次设备：${client.rememberedName}（未连接）` : "尚未选择设备");
  text("liveState", client?.authorized ? stateName(status) : "未取得设备实时状态");
  text("livePhase", client?.authorized ? "已授权" : phase === "offline" ? "未连接" : phase === "password" ? "待输入密码" : phase === "authenticating" ? "等设备确认" : "连接中");
  text("liveProtocolName", client?.currentProtocol === 1 ? "旧版协议" : client?.currentProtocol === 2 ? "新版协议" : "等待识别");
  text("liveSoc", status && Number.isFinite(status.soc) ? `${status.soc}%` : "--");
  text("liveEnergy", status && Number.isFinite(status.energyKWh) ? `${status.energyKWh.toFixed(1)} kWh` : "--");
  text("liveMinutes", status && Number.isFinite(status.minutes) ? `${status.minutes} min` : "--");
  text("liveElectrical", status ? `电压 ${status.voltage} V · 电流 ${status.currentA ?? "--"} A · 功率原值 ${status.power}（单位未核实）` : "无设备数据");
  text("liveFreshness", !status ? "尚未收到设备状态" : fresh ? "设备状态：刚更新（实时通知）" : "设备状态已过期，操作已禁用，请刷新");
  el("liveAuthBox").hidden = !device || !!client?.authorized;
  el<HTMLButtonElement>("liveAuthorize").disabled = !client?.currentProtocol || phase === "authenticating" || busy;
  el<HTMLButtonElement>("liveStart").disabled = !client?.authorized || !fresh || busy || !status || status.state !== "2" || status.gunFlag === "1" || status.selfStartFlag === "2" || status.mode === "3";
  el<HTMLButtonElement>("liveStop").disabled = !client?.authorized || !fresh || busy || status?.state !== "4";
  el<HTMLButtonElement>("liveUnlock").disabled = !client?.authorized || !fresh || busy || !status || status.state === "4" || status.mode === "3" || status.lock === "0";
  el<HTMLButtonElement>("liveRefresh").disabled = !client?.authorized || busy;
  el<HTMLButtonElement>("liveDisconnect").disabled = !device;
  el<HTMLButtonElement>("liveChoose").disabled = !supported || busy;
  el<HTMLButtonElement>("liveForgetPassword").disabled = !client?.rememberedName;
}
function selectedProtocol(): Version | undefined {
  const value = el<HTMLSelectElement>("liveProtocol").value;
  return value === "1" ? 1 : value === "2" ? 2 : undefined;
}
el("liveChoose").addEventListener("click", () => {
  if (!client) return;
  // 设备选择器必须从点击事件直接调用。
  void client.chooseDevice(selectedProtocol()).catch(error => failure("选择/连接", error));
});
el("liveProtocol").addEventListener("change", () => {
  const version = selectedProtocol();
  if (!version || !client?.currentDevice || client.authorized) return;
  try { client.chooseProtocol(version); } catch (error) { failure("切换协议", error); }
  render();
});
el("liveAuthorize").addEventListener("click", () => {
  if (!client) return;
  const input = el<HTMLInputElement>("livePassword");
  const password = input.value;
  if (!/^\d{5}$/.test(password)) { diagnostics.add("auth-input-invalid"); record("蓝牙验证码必须是五位数字。"); return; }
  input.value = "";
  const remember = el<HTMLInputElement>("rememberPassword").checked;
  void client.login(password, remember).catch(error => failure("授权", error));
});
el("liveRefresh").addEventListener("click", () => {
  if (!client || !window.confirm("将向充电桩发送旧应用使用的“同步设备时钟”指令，并等待状态通知。继续吗？")) return;
  void client.refresh().catch(error => failure("同步状态", error));
});
async function control(action: ControlAction): Promise<void> {
  if (!client) return;
  const name = { start: "开始充电", stop: "停止充电", unlock: "解除电子锁" }[action];
  if (!window.confirm(`确定向真实充电桩发送「${name}」指令？\n收到设备状态变化后才会显示完成。`)) return;
  busy = true; render(); record(`正在发送「${name}」并等待设备确认…`);
  try { await client.control(action); record(`设备状态已确认：${name}。`); }
  catch (error) { failure(name, error); }
  finally { busy = false; render(); }
}
for (const [id, action] of [["liveStart", "start"], ["liveStop", "stop"], ["liveUnlock", "unlock"]] as const) {
  el(id).addEventListener("click", () => void control(action));
}
el("liveDisconnect").addEventListener("click", () => { client?.disconnect(); statusAt = 0; render(); });
el("liveForgetPassword").addEventListener("click", () => {
  if (!window.confirm("删除本网站保存的蓝牙验证码？下次需重新输入。")) return;
  client?.forgetPassword(); diagnostics.add("password-forgotten"); record("已删除保存的验证码。"); render();
});
el("liveForgetDevice").addEventListener("click", () => {
  if (!window.confirm("清除本网站保存的全部设备记录和验证码，并断开连接？")) return;
  client?.forgetDevice(); statusAt = 0; diagnostics.add("device-records-forgotten"); render();
});
el("copyDiagnostics").addEventListener("click", async () => {
  const value = diagnostics.exportText(environment());
  const area = el<HTMLTextAreaElement>("diagnosticsText");
  area.value = value;
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
    await navigator.clipboard.writeText(value);
    text("diagnosticsHint", "日志已复制。贴出之前建议检查文本内容。");
    diagnostics.add("log-copied", { method: "clipboard" });
  } catch {
    area.focus(); area.select();
    let copied = false;
    try { copied = document.execCommand("copy"); } catch { /* Bluefy 可能禁止自动复制 */ }
    text("diagnosticsHint", copied ? "日志已复制（兼容方式）。" : "浏览器禁止自动复制；请长按上方文本，全选后手动复制。");
    diagnostics.add("log-copy-fallback", { copied }, copied ? "info" : "warn");
  }
});
el("selectDiagnostics").addEventListener("click", () => {
  const area = el<HTMLTextAreaElement>("diagnosticsText");
  area.value = diagnostics.exportText(environment());
  area.focus(); area.select();
  text("diagnosticsHint", "已选中日志；可以使用浏览器复制菜单。若未选中，请长按文本手动全选。");
});
el("clearDiagnostics").addEventListener("click", () => {
  if (!window.confirm("清空此浏览器保存的诊断日志？不会删除已保存的设备和验证码。")) return;
  diagnostics.clear(); recentMessages.length = 0; text("liveLog", "诊断日志已清空。");
  refreshDiagnostics(true);
  text("diagnosticsHint", "日志已清空。新的设备事件会重新开始记录。");
});
diagnostics.add("app-start", { ...environment() });
refreshDiagnostics(true);
render();
setInterval(render, 5000);
if (client?.rememberedName && window.isSecureContext) {
  record("尝试恢复上次设备的浏览器授权…");
  void client.restore().then(restored => { if (!restored) record("未找到可恢复的设备，请点击「选择 / 更换设备」手动连接。"); render(); });
}
