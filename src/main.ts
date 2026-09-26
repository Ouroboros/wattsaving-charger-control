import { ChargerClient, type BleAdapter, type ChargerEvent } from "./ble";
import type { ControlAction, DeviceStatus, Version } from "./protocol";

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`网页缺少必要元素：${id}`);
  return node as T;
}
const text = (id: string, value: string): void => { el(id).textContent = value; };
const adapter = (navigator as Navigator & { bluetooth?: BleAdapter }).bluetooth;
let realMode = false;
const client = adapter ? new ChargerClient(adapter, handleEvent, () => realMode) : null;
let phase = "offline";
let busy = false;
let statusAt = 0;
const log: string[] = [];
const stateName = (status: DeviceStatus | null): string => {
  if (!status) return "等候设备实时状态";
  if (status.state === "4") return "充电中";
  if (status.state === "3") return "设备报出故障";
  if (status.state === "2") return "已就绪";
  return `设备状态 ${status.state || "未知"}（含义未核实）`;
};
function record(message: string): void {
  log.unshift(message);
  if (log.length > 6) log.length = 6;
  text("liveLog", log.join("\n"));
}
function handleEvent(event: ChargerEvent): void {
  if (event.type === "phase") { phase = event.phase; record(event.message); }
  if (event.type === "notice") record(event.message);
  if (event.type === "protocol") record(`协议：${event.version === 1 ? "旧版" : "新版"}（${event.source}）`);
  if (event.type === "auth-needed") record(event.message);
  if (event.type === "status") { statusAt = Date.now(); record("收到设备状态通知。"); }
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
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function switchMode(real: boolean): void {
  const wasReal = realMode;
  realMode = real;
  if (!real && wasReal) { client?.disconnect(); statusAt = 0; }
  el("reviewPanel").hidden = real;
  el("demoWorkspace").hidden = real;
  el("liveWorkspace").hidden = !real;
  el("appLayout").classList.toggle("live-mode", real);
  text("modeBadge", real ? "真机模式 · 指令会发送到设备" : "模拟评审 · 不发送指令");
  el<HTMLButtonElement>("showDemo").setAttribute("aria-pressed", String(!real));
  el<HTMLButtonElement>("showLive").setAttribute("aria-pressed", String(real));
  render();
  if (real && !wasReal && client?.rememberedName) {
    record(`上次设备：${client.rememberedName}；尝试恢复浏览器授权…`);
    void client.restore().then(restored => { if (!restored) record("浏览器未提供可恢复的设备，请点击「选择设备」手动连接。"); render(); });
  }
}
el("showDemo").addEventListener("click", () => switchMode(false));
el("showLive").addEventListener("click", () => switchMode(true));
el("liveChoose").addEventListener("click", () => {
  if (!client) return;
  // 保持浏览器设备选择器与用户点击同一任务栈。
  void client.chooseDevice(selectedProtocol()).catch(error => { record(`选择/连接失败：${errorMessage(error)}`); render(); });
});
el("liveProtocol").addEventListener("change", () => {
  const version = selectedProtocol();
  if (!version || !client?.currentDevice || client.authorized) return;
  try { client.chooseProtocol(version); } catch (error) { record(errorMessage(error)); }
  render();
});
el("liveAuthorize").addEventListener("click", () => {
  if (!client) return;
  const input = el<HTMLInputElement>("livePassword");
  const password = input.value;
  if (!/^\d{5}$/.test(password)) { record("蓝牙验证码必须是五位数字。"); return; }
  input.value = "";
  const remember = el<HTMLInputElement>("rememberPassword").checked;
  void client.login(password, remember).catch(error => record(`授权失败：${errorMessage(error)}`));
});
el("liveRefresh").addEventListener("click", () => {
  if (!client || !window.confirm("将向充电机发送旧应用使用的“同步设备时钟”指令，并等待状态通知。继续吗？")) return;
  void client.refresh().catch(error => record(`同步失败：${errorMessage(error)}`));
});
async function control(action: ControlAction): Promise<void> {
  if (!client) return;
  const name = { start: "开始充电", stop: "停止充电", unlock: "解除电子锁" }[action];
  if (!window.confirm(`确定向真实充电机发送「${name}」指令？\n收到设备状态变化后才会显示完成。`)) return;
  busy = true; render(); record(`正在发送「${name}」并等待设备确认…`);
  try { await client.control(action); record(`设备状态已确认：${name}。`); }
  catch (error) { record(`${name}未确认：${errorMessage(error)}`); }
  finally { busy = false; render(); }
}
for (const [id, action] of [["liveStart", "start"], ["liveStop", "stop"], ["liveUnlock", "unlock"]] as const) {
  el(id).addEventListener("click", () => void control(action));
}
el("liveDisconnect").addEventListener("click", () => { client?.disconnect(); statusAt = 0; render(); });
el("liveForgetPassword").addEventListener("click", () => {
  if (!window.confirm("删除本网站保存的蓝牙验证码？下次需重新输入。")) return;
  client?.forgetPassword(); record("已删除保存的验证码。"); render();
});
el("liveForgetDevice").addEventListener("click", () => {
  if (!window.confirm("清除本网站保存的全部设备记录和验证码，并断开连接？")) return;
  client?.forgetDevice(); statusAt = 0; render();
});
switchMode(!!adapter && window.isSecureContext);
setInterval(() => { if (!el("liveWorkspace").hidden) render(); }, 5000);
