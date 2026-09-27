import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("五个标签占据容器底行、内容区独立滚动，实验功能独立", () => {
  const html = readFileSync("index.html", "utf8");
  assert.match(html, /id="liveTabs" role="tablist"/);
  for (const [tab, panel] of [
    ["tabConnection", "tabPanelConnection"], ["tabCharge", "tabPanelCharge"],
    ["tabExperiment", "tabPanelExperiment"], ["tabFeedback", "tabPanelFeedback"], ["tabAbout", "tabPanelAbout"]
  ]) {
    assert.match(html, new RegExp(`id="${tab}"[^>]*aria-controls="${panel}"`));
    assert.match(html, new RegExp(`id="${panel}"[^>]*aria-labelledby="${tab}"`));
  }
  assert.match(html, /id="tabConnection"[^>]*><span class="connection-dot" id="livePhase"/);
  assert.match(html, /main \{ position:fixed; inset:0;[^}]*display:flex; flex-direction:column;/);
  assert.match(html, /\.live \{[^}]*display:flex; flex-direction:column;[^}]*overflow:hidden;/);
  assert.match(html, /\.screen \{[^}]*flex:1; min-height:0; overflow-y:auto;/);
  assert.match(html, /\.tabs \{ flex:none; width:100%; display:grid;/);
  assert.ok(html.indexOf('id="liveTabContent"') < html.indexOf('id="tabPanelConnection"'));
  assert.ok(html.indexOf('id="liveTabs"') > html.indexOf('id="tabPanelAbout"'));
  assert.match(html, /id="tabPanelCharge"[^>]*hidden>/);
  assert.match(html, /id="tabPanelExperiment"[^>]*hidden>/);
  assert.match(html, /id="tabPanelFeedback"[^>]*hidden>/);
  assert.match(html, /id="tabPanelAbout"[^>]*hidden>/);
  const connection = html.slice(html.indexOf('<section id="tabPanelConnection"'), html.indexOf('<section id="tabPanelCharge"'));
  const charge = html.slice(html.indexOf('<section id="tabPanelCharge"'), html.indexOf('<section id="tabPanelExperiment"'));
  const experiment = html.slice(html.indexOf('<section id="tabPanelExperiment"'), html.indexOf('<section id="tabPanelFeedback"'));
  assert.doesNotMatch(experiment, /手动实验：功率档位|id="experimentSend"|id="experimentGear"|id="experimentReportedPower"|id="experimentReportedGear"|23 0B 32/);
  assert.doesNotMatch(experiment, /<div class="notice"|未经旧设备验证|副作用|无回报不能证明/);
  assert.match(experiment, /id="experimentQueryVin"/);
  assert.match(experiment, /id="experimentQueryNetwork"/);
  assert.doesNotMatch(experiment, /id="experimentPile"|id="experimentGun"|id="experimentAutoQuery"/);
  assert.doesNotMatch(charge, /id="localChargeHistory"|本网页充电记录|尚未与真实充电桩及 Bluefy 联调/);
  assert.match(connection, /id="liveChoose"/);
  assert.match(connection, /id="liveForgetDevice"/);
  assert.doesNotMatch(connection, /id="liveStart"|id="reserveSubmit"/);
  assert.match(charge, /id="liveStart"/);
  assert.match(charge, /id="reserveSubmit"/);
  assert.doesNotMatch(html, /<header class="top">/);
  const about = html.slice(html.indexOf('<section id="tabPanelAbout"'));
  assert.match(about, /WattSaving · 充电桩控制/);
  assert.match(about, /id="buildInfo"/);
  assert.doesNotMatch(about, /个人用网页 · 非官方产品|真机控制 · 尚待实机验证/);
  assert.match(html, /id="liveLog" role="log" aria-live="off"/);
  assert.match(html, /\.log \{[^}]*max-height:240px; overflow-y:auto;/);
});

test("实验页和发送实现都不再提供档位写入；只保留手动查询", () => {
  const source = readFileSync("src/experimental.ts", "utf8") + readFileSync("src/ble.ts", "utf8") + readFileSync("src/main.ts", "utf8");
  assert.doesNotMatch(source, /experimentalGear|pendingGear|gear-reply|experimental-ack|0x32|手动实验：功率档位/);
  assert.match(source, /experimentalQueryCommand/);
  assert.match(source, /experimentalIdentityReady/);
});

test("刷新页面不会自动连接，只允许点击按钮恢复上次设备", () => {
  const source = readFileSync("src/main.ts", "utf8");
  const html = readFileSync("index.html", "utf8");
  assert.doesNotMatch(source, /restore-auto-start|reconnectLast\("auto"\)/);
  assert.match(source, /el\("liveRestore"\)\.addEventListener\("click", \(\) => \{ void reconnectLast\(\); \}\)/);
  assert.match(html, /打开或刷新页面不会自动连接/);
});

test("清空诊断的点击事件没有二次确认，错误处理调用弹框", () => {
  const source = readFileSync("src/main.ts", "utf8");
  const clearStart = source.indexOf('el("clearDiagnostics").addEventListener');
  const clearEnd = source.indexOf("const tabPairs", clearStart);
  assert.ok(clearStart >= 0 && clearEnd > clearStart);
  assert.doesNotMatch(source.slice(clearStart, clearEnd), /confirm\(/);
  assert.match(source.slice(clearStart, clearEnd), /diagnostics\.clear\(\); feedback\.clear\(\)/);
  assert.match(source, /function reportOperationError\(message: string\): void \{ record\(message\); showErrorModal\(message\); \}/);
  assert.match(source, /if \(event\.severity === "error"\) showErrorModal\(event\.message\)/);
  assert.match(source, /el\("liveTabContent"\)\.scrollTop = 0/);
});
