import { ChargerClient, reservationBlockReason, type BleAdapter, type ChargerEvent } from "./ble";
import { formatBuildInfo, formatLocalBuildTime } from "./build-info";
import { FeedbackHistory, shouldPaintStatusFeedback, STATUS_FEEDBACK_INTERVAL_MS } from "./feedback";
import { RawCapture } from "./raw-capture";
import type { ExperimentalQuery } from "./experimental";
import { showTab, tabIndexForKey } from "./tabs";

declare const __BUILD_VERSION__: string;
declare const __BUILD_REVISION__: string;
declare const __BUILD_TIME__: string;
import { Diagnostics, diagnosticError, type DiagnosticEnvironment } from "./diagnostics";
import { countdownTo } from "./countdown";
import { nextMidnight, parseLocalMinute, validateReservation, type AdminAction, type ControlAction, type DeviceStatus, type Reservation, type ReservationEnd, type Version } from "./protocol";

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`网页缺少必要元素：${id}`);
  return node as T;
}
const text = (id: string, value: string): void => { el(id).textContent = value; };
text("buildInfo", formatBuildInfo({ version: __BUILD_VERSION__, revision: __BUILD_REVISION__, builtAt: __BUILD_TIME__ }));
const adapter = (navigator as Navigator & { bluetooth?: BleAdapter }).bluetooth;
const diagnostics = new Diagnostics();
const rawCapture = new RawCapture();
// 移除旧版网页生成的本地充电/预约记录；不影响设备和验证码存储。
try { window.localStorage.removeItem("wattsaving-local-history-v1"); } catch { /* 浏览器本地存储不可用 */ }
const client = adapter ? new ChargerClient(adapter, handleEvent, () => window.isSecureContext, (event, data, level) => {
  diagnostics.add(event, data, level);
  refreshDiagnostics();
}, (direction, bytes) => {
  if (rawCapture.record(direction, bytes)) refreshRawCapture();
}) : null;
let phase = "offline";
let busy = false;
let statusAt = 0;
let staleLoggedFor = 0;
let reservationResult = "";
let adminMessage = "";
let experimentQueryResult = "";
let lastBlockedReservation = "";
let reservationStartAutomatic = true;
let confirmedReservation: { deviceId: string; startsAt: number } | null = null;
const feedback = new FeedbackHistory(100);
let lastFeedbackPaintAt = 0;
let feedbackDirty = false;
let errorDialogs = 0;
const pad = (value: number): string => String(value).padStart(2, "0");
function localMinute(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function resetReservationStart(): void {
  reservationStartAutomatic = true;
  const input = el<HTMLInputElement>("reserveStart");
  input.defaultValue = localMinute(nextMidnight());
  input.value = input.defaultValue;
}
function selectedReservation(): Reservation {
  const start = parseLocalMinute(el<HTMLInputElement>("reserveStart").value);
  const kind = el<HTMLSelectElement>("reserveEnd").value;
  let end: ReservationEnd;
  if (kind === "full") end = { kind: "full" };
  else if (kind === "time") end = { kind: "time", minutes: Number(el<HTMLSelectElement>("reserveHours").value) * 60 };
  else if (kind === "energy") end = { kind: "energy", kWh: Number(el<HTMLSelectElement>("reserveEnergy").value) };
  else throw new Error("未知的预约结束方式");
  const reservation = { start, end };
  validateReservation(reservation);
  return reservation;
}
function endLabel(end: ReservationEnd): string {
  return end.kind === "full" ? "自动充满" : end.kind === "time" ? `充电 ${end.minutes / 60} 小时` : `充电 ${end.kWh} 度`;
}
function updateReservationCountdown(): void {
  const box = el("reserveCountdownBox");
  const currentDeviceId = client?.currentDevice?.id;
  if (!client?.authorized || !currentDeviceId || !confirmedReservation || currentDeviceId !== confirmedReservation.deviceId) { box.hidden = true; return; }
  const now = Date.now();
  const status = client?.currentStatus;
  if (client?.authorized && status && now - statusAt < 20000 && status.state === "4") {
    confirmedReservation = null;
    box.hidden = true;
    return;
  }
  box.hidden = false;
  text("reserveCountdown", countdownTo(confirmedReservation.startsAt, now));
  text("reserveCountdownLabel", now < confirmedReservation.startsAt ?
    "后开始充电（本地时钟估算）" : "预约时间已到，等待设备状态确认");
}
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
function refreshRawCapture(force = false): void {
  const area = el<HTMLTextAreaElement>("rawCaptureText");
  const followLatest = area.scrollHeight - area.scrollTop - area.clientHeight < 24;
  if (force || document.activeElement !== area) area.value = rawCapture.toText();
  if (followLatest) area.scrollTop = area.scrollHeight;
  text("rawCaptureToggle", rawCapture.enabled ? "停止抓包" : "开始抓包");
  text("rawCaptureState", `${rawCapture.enabled ? "抓包中" : "已停止"} · ${rawCapture.count} 条`);
  el<HTMLButtonElement>("rawCaptureCopy").disabled = !rawCapture.count;
  el<HTMLButtonElement>("rawCaptureClear").disabled = !rawCapture.count;
}
const stateName = (status: DeviceStatus | null): string => {
  if (!status) return "等候设备实时状态";
  if (status.state === "4") return "充电中";
  if (status.state === "3") return "设备报出故障";
  if (status.state === "2") return "已就绪";
  if (status.state === "5") return "充电结束";
  if (status.state === "6") return "未插枪";
  if (status.state === "7") return "配置中";
  return `设备状态 ${status.state || "未知"}（含义未核实）`;
};
const stateLabels: Record<string, string> = { "2": "准备", "3": "故障", "4": "充电", "5": "结束", "6": "未插枪", "7": "配置中" };
const modeLabels: Record<string, string> = { "0": "待机", "1": "VIN", "2": "蓝牙", "3": "预约", "4": "即插即充", "5": "无感充电" };
const faultLabelsNew: Record<string, string> = {
  "0000": "工作正常", "0001": "CC1连接异常", "0002": "BMS通信故障", "0003": "BMS通信超时（超时次数大于3次）",
  "0009": "电子锁故障", "0010": "直流接触器黏连故障", "0012": "急停按钮被按下", "0014": "电池电压与充电机输出范围不匹配",
  "0018": "模块输出过/欠压", "0030": "直流接触器拒动故障"
};
function faultDescription(status: DeviceStatus): string {
  if (status.protocol === 2) return faultLabelsNew[status.power] || "原小程序未提供该故障码释义";
  return status.power === "0000" ? "工作正常" : "旧协议的故障释义依设备子型号而异，当前未能判定；请核对原小程序";
}
function faultAdvice(status: DeviceStatus): string {
  if (status.protocol !== 2 || !faultLabelsNew[status.power]) return "当前无法按设备子型号核实排查方法，请核对原小程序或联系售后。";
  if (status.power === "0000") return "无故障。";
  if (status.power === "0012") return "原小程序提示：将急停键弹起复位；若仍未解决，请联系售后。";
  return "原小程序提示：解除电子锁并拔除充电枪，重新插枪并再次启动；若仍未解决，请联系售后。";
}
function duration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return "--";
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}min`;
}
function paintFeedback(): void {
  const box = el("liveLog");
  const followLatest = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
  // 自由文本仅显示在页面中，不进入可导出的脱敏诊断日志。
  box.textContent = feedback.toText() || "暂无设备反馈";
  if (followLatest) box.scrollTop = box.scrollHeight;
  lastFeedbackPaintAt = Date.now();
  feedbackDirty = false;
}
function record(message: string, throttleStatus = false): void {
  const now = Date.now();
  const repeated = feedback.add(message, now);
  if (throttleStatus && !shouldPaintStatusFeedback(repeated, now, lastFeedbackPaintAt)) {
    feedbackDirty = true;
    return;
  }
  paintFeedback();
}
function showErrorModal(message: string): void { errorDialogs++; window.alert(message); }
function reportOperationError(message: string): void { record(message); showErrorModal(message); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function failure(action: string, error: unknown): void {
  diagnostics.add("ui-error", { action, ...diagnosticError(error) }, "error");
  refreshDiagnostics();
  reportOperationError(`${action}失败：${errorMessage(error)}`);
}
function handleEvent(event: ChargerEvent): void {
  if (event.type === "phase") {
    phase = event.phase;
    if (phase === "offline" || phase === "connecting") {
      reservationResult = ""; adminMessage = ""; experimentQueryResult = "";
    }
    diagnostics.add("phase", { phase }); record(event.message);
  }
  if (event.type === "notice") { record(event.message); if (event.severity === "error") showErrorModal(event.message); }
  if (event.type === "admin-auth-state") {
    adminMessage = event.message; record(event.message);
    if (event.severity === "error") showErrorModal(event.message);
  }
  if (event.type === "reservation") { reservationResult = event.message; record(event.message); }
  if (event.type === "protocol") record(`协议：${event.version === 1 ? "旧版" : "新版"}（${event.source}）`);
  if (event.type === "auth-needed") record(event.message);
  if (event.type === "status") {
    if (lastBlockedReservation && reservationResult === lastBlockedReservation && reservationBlockReason(event.status) !== lastBlockedReservation) reservationResult = "";
    statusAt = Date.now(); staleLoggedFor = 0; record("收到设备状态通知。", true);
  }
  refreshDiagnostics();
  render();
}
function render(): void {
  if (feedbackDirty && Date.now() - lastFeedbackPaintAt >= STATUS_FEEDBACK_INTERVAL_MS) paintFeedback();
  const supported = !!adapter && window.isSecureContext;
  el("liveSupport").hidden = supported;
  if (!supported) text("liveSupport", !window.isSecureContext ? "当前不是安全上下文，Web Bluetooth 不可用；请从 Bluefy 打开 HTTPS GitHub Pages 地址。" :
    "浏览器未提供 Web Bluetooth。请在 iPhone 的 Bluefy 中打开已发布的 HTTPS 页面。");
  const device = client?.currentDevice;
  const status = client?.currentStatus ?? null;
  const fresh = !!status && Date.now() - statusAt < 20000;
  if (client?.authorized && status && !fresh && statusAt && staleLoggedFor !== statusAt) {
    staleLoggedFor = statusAt;
    diagnostics.add("status-stale", { ageMs: Date.now() - statusAt, state: status.state,
      page: document.visibilityState, connected: !!device?.gatt?.connected });
    refreshDiagnostics();
  }
  text("liveDevice", device ? `${device.name || "未命名设备"} · ${client?.authorized ? "已授权" : "未授权"}` :
    client?.rememberedName ? `上次设备：${client.rememberedName}（未连接）` : "尚未选择设备");
  text("liveState", client?.authorized ? stateName(status) : "未取得设备实时状态");
  const connected = !!device?.gatt?.connected;
  const connectionLabel = client?.authorized ? "已连接，已授权" : connected ? "已连接，未授权" : phase === "connecting" ? "连接中" : "未连接";
  const indicator = el("livePhase");
  indicator.className = `connection-dot${connected ? " connected" : ""}`;
  indicator.setAttribute("aria-label", connectionLabel);
  indicator.title = connectionLabel;
  text("liveProtocolName", client?.currentProtocol === 1 ? "旧版协议" : client?.currentProtocol === 2 ? "新版协议" : "等待识别");
  text("liveSoc", status && Number.isFinite(status.soc) ? `${status.soc}%` : "--");
  el("liveSocRing").style.setProperty("--soc", status && Number.isFinite(status.soc) ? `${Math.max(0, Math.min(100, status.soc))}%` : "0%");
  text("liveStateCode", status ? stateLabels[status.state] || `状态 ${status.state}` : "--");
  text("liveMode", status ? modeLabels[status.mode] || `模式 ${status.mode || "未知"}` : "--");
  text("liveLock", status ? status.lock === "0" ? "断开" : status.lock === "1" ? "闭合" : `状态 ${status.lock}` : "--");
  text("liveEnergy", status && Number.isFinite(status.energyKWh) ? `${status.energyKWh.toFixed(1)} kWh` : "--");
  text("liveMinutes", status ? duration(status.minutes) : "--");
  text("liveRemaining", status ? duration(status.remainingMinutes) : "--");
  text("liveVoltage", status ? `${status.voltage} V` : "--");
  text("liveCurrent", status && status.currentA !== null ? `${status.currentA} A` : "--");
  text("liveFault", status ? status.power || "--" : "--");
  text("liveElectrical", status ? `故障状态：${faultDescription(status)}（${status.power || "未报告"}）` : "无设备数据");
  el<HTMLButtonElement>("liveFaultDetail").disabled = !status;
  text("liveFreshness", !status ? "尚未收到设备状态" : fresh ? "设备状态：刚更新（实时通知）" : "设备状态已过期，操作已禁用，请刷新");
  text("experimentQueryResult", experimentQueryResult || "尚未发起 APP 查询。");
  text("experimentIdentityStatus", client?.experimentalIdentityReady ?
    "已从当前设备 54 通知取得查询字段。" : "等待当前设备 54 通知。");
  for (const id of ["experimentQueryVin", "experimentQueryNetwork"])
    el<HTMLButtonElement>(id).disabled = !client?.experimentalIdentityReady || busy || !!client.experimentalPending || !!client.adminPending;
  const loginProgress = el("liveLoginProgress");
  loginProgress.hidden = !device || phase !== "authenticating" || !!client?.authorized;
  if (!loginProgress.hidden) text("liveLoginProgress", client?.automaticLoginPending ? "正在自动登录，等待设备确认…" : "正在验证验证码，等待设备确认…");
  el("liveAuthBox").hidden = !device || phase !== "password" || !!client?.authorized;
  el<HTMLButtonElement>("liveAuthorize").disabled = !client?.currentProtocol || phase === "authenticating" || busy;
  el<HTMLButtonElement>("liveStart").disabled = !client?.authorized || !fresh || busy || !!client.adminPending;
  el<HTMLButtonElement>("liveStop").disabled = !client?.authorized || !fresh || busy || !!client.adminPending || status?.state !== "4";
  el<HTMLButtonElement>("liveUnlock").disabled = !client?.authorized || !fresh || busy || !!client.adminPending || !status || status.state === "4" || status.mode === "3" || status.lock === "0";
  el<HTMLButtonElement>("liveRefresh").disabled = !client?.authorized || busy || !!client.adminPending;
  el<HTMLButtonElement>("liveDisconnect").disabled = !device;
  el<HTMLButtonElement>("liveChoose").disabled = !supported || busy;
  el<HTMLButtonElement>("liveRestore").disabled = !supported || !client?.rememberedName || busy || !!device;
  el<HTMLButtonElement>("liveForgetPassword").disabled = !client?.rememberedName;
  const adminPanel = el("adminPanel");
  adminPanel.hidden = !client?.authorized;
  const adminReady = !!client?.administratorAuthorized;
  el("adminAuthBox").hidden = adminReady || !!client?.automaticAdministratorLoginPending;
  el("adminControls").hidden = !adminReady;
  el<HTMLButtonElement>("adminLogin").disabled = !client?.authorized || !!client.adminPending || busy;
  for (const id of ["adminPlugOn", "adminPlugOff", "adminChangeBluetoothPassword", "adminChangePassword"])
    el<HTMLButtonElement>(id).disabled = !adminReady || !fresh || busy || !!client?.adminPending;
  for (const id of ["adminMuteOn", "adminMuteOff"])
    el<HTMLButtonElement>(id).disabled = !adminReady || !fresh || busy || !!client?.adminPending || client?.currentProtocol !== 2;
  el<HTMLButtonElement>("adminPair").disabled = !adminReady || !fresh || busy || !!client?.adminPending || !client?.pairingAvailable;
  text("adminPairHint", client?.currentProtocol === 2 && !client.pairingAvailable ?
    "当前连接未发现原小程序所需的 FF03 配对通知特征；不能启动无感配对。" :
    "仅新版协议有静音和无感配对指令；配对回执不等于手机已完成系统蓝牙配对。");
  const authMode = el<HTMLSelectElement>("adminAuthMode");
  authMode.disabled = !adminReady || busy;
  if (document.activeElement !== authMode) authMode.value = client?.manualBluetoothLogin ? "manual" : "auto";
  text("adminState", adminMessage || (adminReady ? "管理员已验证；管理操作仍需设备回执。" : "管理员权限未验证。"));
  const reservationBlocked = status ? reservationBlockReason(status) : null;
  el<HTMLButtonElement>("reserveSubmit").disabled = !client?.authorized || !fresh || busy || !!client?.reservationPending || !!client?.adminPending;
  text("reserveSubmit", client?.canCancelReservation ? "修改预约" : "提交预约");
  el<HTMLButtonElement>("reserveCancel").disabled = !client?.authorized || !fresh || busy || !!client?.reservationPending || !!client?.adminPending || status?.state === "4" || !client?.canCancelReservation;
  const reserveInput = el<HTMLInputElement>("reserveStart");
  if (reservationStartAutomatic && reserveInput.value !== localMinute(nextMidnight())) resetReservationStart();
  reserveInput.min = localMinute(new Date());
  reserveInput.max = localMinute(new Date(Date.now() + 24 * 60 * 60 * 1000));
  text("reserveState", !client?.authorized ? "连接并授权后可预约。" : client.reservationPending ? "指令已发送，等待设备预约回执；此时勿重复提交。" :
    reservationResult || !fresh ? reservationResult || "等待最新设备状态，操作暂不可用。" : status?.mode === "3" ? "设备通知显示预约模式；可修改或取消。" :
    reservationBlocked ? reservationBlocked : client.canCancelReservation ? "设备已确认提交，尚待新的预约模式状态通知。" : "设备未报告预约模式；可设置新的预约。");
  updateReservationCountdown();
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
async function reconnectLast(): Promise<void> {
  if (!client || busy) return;
  diagnostics.add("restore-request", { source: "button", remembered: !!client.rememberedName, getDevices: !!adapter?.getDevices });
  busy = true; render();
  const dialogsBefore = errorDialogs;
  try {
    const found = await client.restore();
    diagnostics.add("restore-finish", { source: "button", discovered: found });
    if (!found && errorDialogs === dialogsBefore) {
      const explanation = "Bluefy 未返回上次设备的浏览器授权；网页不能仅凭名称或 ID 连接，请用「选择 / 更换设备」重新授权。";
      record(explanation);
      showErrorModal(explanation);
    }
  } catch (error) { failure("恢复设备", error); }
  finally { busy = false; render(); }
}
el("liveRestore").addEventListener("click", () => { void reconnectLast(); });
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
  if (!/^\d{5}$/.test(password)) { diagnostics.add("auth-input-invalid"); reportOperationError("蓝牙验证码必须是五位数字。"); return; }
  input.value = "";
  const remember = el<HTMLInputElement>("rememberPassword").checked;
  void client.login(password, remember).catch(error => failure("授权", error));
});
el("liveRefresh").addEventListener("click", () => {
  if (!client) return;
  if (!window.confirm("将向充电桩发送旧应用使用的“同步设备时钟”指令，并等待状态通知。继续吗？")) {
    diagnostics.add("ui-cancelled", { action: "clock-sync" }); refreshDiagnostics(); return;
  }
  void client.refresh().catch(error => failure("同步状态", error));
});
for (const [id, query, label, reply] of [
  ["experimentQueryVin", "vin-list", "VIN 列表", "75"],
  ["experimentQueryNetwork", "network-info", "4G 信息", "94"]
] as const satisfies readonly (readonly [string, ExperimentalQuery, string, string])[]) {
  el(id).addEventListener("click", () => {
    if (!client?.experimentalIdentityReady || client.experimentalPending || busy) return;
    if (!window.confirm(`向当前设备发送「${label}」查询？`)) return;
    busy = true; experimentQueryResult = `${label}查询已请求，等待设备 ${reply} 回报…`; render();
    void client.experimentalQuery(query).then(result => {
      experimentQueryResult = query === "vin-list" ? result === "accepted" ? "75/01：设备已接受。" :
        "收到 75 回报，结果码非 01。" : "收到校验有效的 94 回报。";
    }, error => {
      experimentQueryResult = `${label}查询未确认：${errorMessage(error)}`;
      failure(`${label}查询`, error);
    }).finally(() => { busy = false; render(); });
  });
}
async function control(action: ControlAction): Promise<void> {
  if (!client) return;
  const name = { start: "开始充电", stop: "停止充电", unlock: "解除电子锁" }[action];
  if (action === "start" && client.currentStatus) {
    const s = client.currentStatus;
    const blocked = s.gunFlag === "1" ? "请先插枪" : s.selfStartFlag === "2" ? "请先取消即插即充功能" :
      s.mode === "3" ? "请先取消预约充电" : s.state !== "2" ? "请先拔枪再插枪" : null;
    diagnostics.add("control-gate", { action, allowed: !blocked, state: s.state, gun: s.gunFlag, mode: s.mode, selfStart: s.selfStartFlag });
    if (blocked) { reportOperationError(`无法${name}：${blocked}`); refreshDiagnostics(); return; }
  }
  if (!window.confirm(`确定向真实充电桩发送「${name}」指令？\n收到设备状态变化后才会显示完成。`)) {
    diagnostics.add("ui-cancelled", { action }); refreshDiagnostics(); return;
  }
  busy = true; render(); record(`正在发送「${name}」并等待设备确认…`);
  try { await client.control(action); record(`设备状态已确认：${name}。`); }
  catch (error) { failure(name, error); }
  finally { busy = false; render(); }
}
for (const [id, action] of [["liveStart", "start"], ["liveStop", "stop"], ["liveUnlock", "unlock"]] as const) {
  el(id).addEventListener("click", () => void control(action));
}
el("reserveStart").addEventListener("input", () => { reservationStartAutomatic = false; });
el("reserveTomorrow").addEventListener("click", () => { resetReservationStart(); record("预约开始已设为次日 00:00；尚未发送。"); });
el("reserveEnd").addEventListener("change", () => {
  const kind = el<HTMLSelectElement>("reserveEnd").value;
  el("reserveTimeBox").hidden = kind !== "time";
  el("reserveEnergyBox").hidden = kind !== "energy";
});
async function reserve(action: "submit" | "cancel"): Promise<void> {
  if (!client) return;
  let reservation: Reservation | undefined;
  if (action === "submit") {
    const status = client.currentStatus;
    if (status) {
      const blocked = reservationBlockReason(status);
      diagnostics.add("reservation-ui-gate", { allowed: !blocked, state: status.state, gun: status.gunFlag,
        lock: status.lock, mode: status.mode, selfStart: status.selfStartFlag });
      if (blocked) { lastBlockedReservation = blocked; reservationResult = blocked; reportOperationError(blocked); refreshDiagnostics(); render(); return; }
      lastBlockedReservation = "";
    }
    try { reservation = selectedReservation(); }
    catch (error) { diagnostics.add("reservation-input-error", diagnosticError(error), "warn"); reservationResult = errorMessage(error); reportOperationError(`预约输入错误：${reservationResult}`); render(); return; }
  }
  const label = action === "submit" ? "提交预约" : "取消预约";
  const detail = reservation ? `\n开始：${localMinute(reservation.start).replace("T", " ")}（iPhone 本地时间）\n结束：${endLabel(reservation.end)}` : "";
  if (!window.confirm(`确定向真实充电桩${label}？${detail}\n仅收到设备匹配回执后才显示成功。`)) {
    diagnostics.add("ui-cancelled", { action: `reservation-${action}` }); refreshDiagnostics(); return;
  }
  busy = true; reservationResult = `正在${label}，等待设备回执…`; render();
  const deviceId = client.currentDevice?.id;
  try {
    if (action === "submit") {
      await client.submitReservation(reservation!);
      if (deviceId && client.currentDevice?.id === deviceId) {
        confirmedReservation = { deviceId, startsAt: reservation!.start.getTime() };
      }
    } else {
      await client.cancelReservation();
      if (confirmedReservation?.deviceId === deviceId) confirmedReservation = null;
    }
    reservationResult = `设备已确认${label}；请核对设备当前预约状态。`;
    record(reservationResult);
  } catch (error) {
    reservationResult = `${label}未确认：${errorMessage(error)}`;
    failure(label, error);
  } finally { busy = false; render(); }
}
const adminNames: Record<AdminAction, string> = {
  "admin-auth": "管理员认证", "plug-on": "设置即插即充", "plug-off": "取消即插即充",
  "mute-on": "设置静音", "mute-off": "取消静音", pair: "开启无感配对窗口",
  "bluetooth-password": "修改蓝牙验证码", "admin-password": "修改管理员验证码"
};
async function runAdmin(action: AdminAction, inputId?: string): Promise<void> {
  if (!client) return;
  const label = adminNames[action];
  const input = inputId ? el<HTMLInputElement>(inputId) : null;
  const value = input?.value;
  if (input && (!/^\d{5}$/.test(value ?? "") || action !== "admin-auth" && Number(value) > 65535)) {
    reportOperationError(`${label}：请输入五位数字${action === "admin-auth" ? "" : "，且数值不大于 65535"}。`); return;
  }
  if (action !== "admin-auth") {
    const warning = action === "plug-on" ? "原小程序提示：即插即充可能被他人使用。" :
      action === "pair" ? "设备打开配对窗口后，还须在 iOS 系统完成配对；回执不能证明无感充电已经启用。" :
      action === "bluetooth-password" ? "设备确认后会删除旧的蓝牙验证码缓存，下一次需输入新的验证码。" : "";
    if (!window.confirm(`确定向真实设备执行「${label}」？${warning}\n仅设备返回匹配回执才视为接受操作。`)) return;
  }
  if (input) input.value = "";
  busy = true; adminMessage = `正在${label}，等待设备回执…`; render();
  try {
    await client.admin(action, value, el<HTMLInputElement>("rememberAdminPassword").checked);
    adminMessage = action === "pair" ? "设备已确认开启配对窗口；请在 iOS 系统完成配对并现场核对是否进入无感模式。" :
      action === "bluetooth-password" ? "设备已确认修改；旧验证码缓存已删除，重新连接时须输入新验证码并由设备验证。" :
      action === "admin-password" ? "设备已确认修改；旧管理员验证码缓存已删除，请用新验证码重新验证。" :
      action === "mute-on" || action === "mute-off" ? "设备已接受静音操作；状态报文不含静音标志，请现场核对。" :
      action === "admin-auth" ? "设备已确认管理员权限。" : `设备已接受${label}；请等后续设备状态核对。`;
    record(adminMessage);
  } catch (error) { adminMessage = `${label}未确认`; failure(label, error); }
  finally { busy = false; render(); }
}
for (const [id, action, input] of [
  ["adminLogin", "admin-auth", "adminPassword"], ["adminPlugOn", "plug-on"], ["adminPlugOff", "plug-off"],
  ["adminMuteOn", "mute-on"], ["adminMuteOff", "mute-off"], ["adminPair", "pair"],
  ["adminChangeBluetoothPassword", "bluetooth-password", "adminNewBluetoothPassword"],
  ["adminChangePassword", "admin-password", "adminNewPassword"]
] as const) el(id).addEventListener("click", () => void runAdmin(action, input));
el("adminAuthMode").addEventListener("change", () => {
  if (!client?.administratorAuthorized) return;
  try { client.setManualBluetoothLogin(el<HTMLSelectElement>("adminAuthMode").value === "manual");
    adminMessage = "已保存本网页认证方式；连接时仍需设备确认蓝牙验证码。"; render(); }
  catch (error) { failure("保存认证方式", error); }
});
el("liveFaultDetail").addEventListener("click", () => {
  const status = client?.currentStatus;
  if (status) window.alert(`故障状态：${status.power || "未报告"}\n${faultDescription(status)}\n${faultAdvice(status)}\n仅依据本次设备状态通知。`);
});
el("reserveSubmit").addEventListener("click", () => void reserve("submit"));
el("reserveCancel").addEventListener("click", () => void reserve("cancel"));
el("liveDisconnect").addEventListener("click", () => { client?.disconnect(); statusAt = 0; render(); });
el("liveForgetPassword").addEventListener("click", () => {
  if (!window.confirm("删除本网站保存的蓝牙和管理员验证码？下次需重新输入。")) return;
  client?.forgetPassword(); client?.forgetAdminPassword(); diagnostics.add("password-forgotten"); record("已删除保存的两类验证码。"); render();
});
el("liveForgetDevice").addEventListener("click", () => {
  if (!window.confirm("清除本网站保存的设备记录和验证码，并断开连接？")) return;
  client?.forgetDevice(); statusAt = 0; confirmedReservation = null; diagnostics.add("device-records-forgotten"); render();
});
el("rawCaptureToggle").addEventListener("click", () => {
  if (rawCapture.enabled) rawCapture.stop(); else rawCapture.start();
  refreshRawCapture(true);
});
el("rawCaptureClear").addEventListener("click", () => { rawCapture.clear(); refreshRawCapture(true); });
el("rawCaptureCopy").addEventListener("click", async () => {
  const value = rawCapture.toText();
  if (!value) return;
  const area = el<HTMLTextAreaElement>("rawCaptureText");
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
    await navigator.clipboard.writeText(value);
    text("rawCaptureHint", "抓包已复制。");
  } catch {
    area.value = value; area.focus(); area.select();
    let copied = false;
    try { copied = document.execCommand("copy"); } catch { /* 允许手动选择 */ }
    text("rawCaptureHint", copied ? "抓包已复制。" : "已选中抓包文本，可手动复制。");
  }
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
    if (!copied) reportOperationError("复制日志失败：请长按日志文本，手动全选并复制。");
  }
});
el("selectDiagnostics").addEventListener("click", () => {
  const area = el<HTMLTextAreaElement>("diagnosticsText");
  area.value = diagnostics.exportText(environment());
  area.focus(); area.select();
  text("diagnosticsHint", "已选中日志；可以使用浏览器复制菜单。若未选中，请长按文本手动全选。");
});
el("clearDiagnostics").addEventListener("click", () => {
  diagnostics.clear(); feedback.clear(); feedbackDirty = false; lastFeedbackPaintAt = 0;
  text("liveLog", "暂无设备反馈"); el("liveLog").scrollTop = 0;
  refreshDiagnostics(true);
  text("diagnosticsHint", "日志已清空。新的设备事件会重新开始记录。");
});
const tabPairs = ([
  ["tabConnection", "tabPanelConnection"],
  ["tabCharge", "tabPanelCharge"],
  ["tabExperiment", "tabPanelExperiment"],
  ["tabFeedback", "tabPanelFeedback"],
  ["tabAbout", "tabPanelAbout"]
] as const).map(([tabId, panelId]) => ({ tab: el<HTMLButtonElement>(tabId), panel: el(panelId) }));
function activateTab(index: number): void {
  showTab(tabPairs, index);
  el("liveTabContent").scrollTop = 0;
}
tabPairs.forEach(({ tab }, index) => tab.addEventListener("click", () => activateTab(index)));
el("liveTabs").addEventListener("keydown", event => {
  const current = tabPairs.findIndex(({ tab }) => tab === event.target);
  const next = tabIndexForKey(event.key, current, tabPairs.length);
  if (next === null) return;
  event.preventDefault();
  activateTab(next);
  tabPairs[next].tab.focus();
});
activateTab(0);
resetReservationStart();
diagnostics.add("app-start", { ...environment(), schema: 4,
  buildVersion: __BUILD_VERSION__, buildRevision: __BUILD_REVISION__, buildTimeLocal: formatLocalBuildTime(__BUILD_TIME__) });
refreshDiagnostics(true);
refreshRawCapture(true);
render();
setInterval(render, 5000);
setInterval(updateReservationCountdown, 1000);
document.addEventListener("visibilitychange", () => {
  diagnostics.add("page-visibility", { state: document.visibilityState, connected: !!client?.currentDevice?.gatt?.connected,
    authorized: !!client?.authorized, statusAgeMs: statusAt ? Date.now() - statusAt : null });
  refreshDiagnostics(); updateReservationCountdown();
});
window.addEventListener("pagehide", event => {
  rawCapture.stop(); rawCapture.clear(); refreshRawCapture(true);
  diagnostics.add("page-hide", { persisted: event.persisted, connected: !!client?.currentDevice?.gatt?.connected,
    authorized: !!client?.authorized, statusAgeMs: statusAt ? Date.now() - statusAt : null });
});
window.addEventListener("pageshow", event => {
  diagnostics.add("page-show", { persisted: event.persisted, connected: !!client?.currentDevice?.gatt?.connected,
    authorized: !!client?.authorized, statusAgeMs: statusAt ? Date.now() - statusAt : null });
  refreshDiagnostics(); refreshRawCapture(true); render();
});
// 页面加载与刷新只渲染离线状态；恢复连接必须由用户点击「一键连接上次设备」。
