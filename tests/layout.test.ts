import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("四个标签置顶、连接灯在标题内，充电与预约同页", () => {
  const html = readFileSync("index.html", "utf8");
  assert.match(html, /id="liveTabs" role="tablist"/);
  for (const [tab, panel] of [
    ["tabConnection", "tabPanelConnection"], ["tabCharge", "tabPanelCharge"],
    ["tabFeedback", "tabPanelFeedback"], ["tabAbout", "tabPanelAbout"]
  ]) {
    assert.match(html, new RegExp(`id="${tab}"[^>]*aria-controls="${panel}"`));
    assert.match(html, new RegExp(`id="${panel}"[^>]*aria-labelledby="${tab}"`));
  }
  assert.match(html, /id="tabConnection"[^>]*><span class="connection-dot" id="livePhase"/);
  assert.match(html, /\.tabs \{ position:sticky; top:0;/);
  assert.match(html, /id="tabPanelCharge"[^>]*hidden>/);
  assert.match(html, /id="tabPanelFeedback"[^>]*hidden>/);
  assert.match(html, /id="tabPanelAbout"[^>]*hidden>/);
  const connection = html.slice(html.indexOf('<section id="tabPanelConnection"'), html.indexOf('<section id="tabPanelCharge"'));
  const charge = html.slice(html.indexOf('<section id="tabPanelCharge"'), html.indexOf('<section id="tabPanelFeedback"'));
  assert.match(connection, /id="liveChoose"/);
  assert.match(connection, /id="liveForgetDevice"/);
  assert.doesNotMatch(connection, /id="liveStart"|id="reserveSubmit"/);
  assert.match(charge, /id="liveStart"/);
  assert.match(charge, /id="reserveSubmit"/);
  assert.doesNotMatch(html, /<header class="top">/);
  const about = html.slice(html.indexOf('<section id="tabPanelAbout"'));
  assert.match(about, /WattSaving · 充电桩控制/);
  assert.match(about, /id="buildInfo"/);
  assert.match(html, /id="liveLog" role="log" aria-live="off"/);
  assert.match(html, /\.log \{[^}]*max-height:240px; overflow-y:auto;/);
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
});
