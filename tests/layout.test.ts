import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("三个标签与面板正确关联，状态入口始终可见", () => {
  const html = readFileSync("index.html", "utf8");
  assert.match(html, /id="liveTabs" role="tablist"/);
  for (const [tab, panel] of [
    ["tabControl", "tabPanelControl"], ["tabReservation", "tabPanelReservation"], ["tabFeedback", "tabPanelFeedback"]
  ]) {
    assert.match(html, new RegExp(`id="${tab}"[^>]*aria-controls="${panel}"`));
    assert.match(html, new RegExp(`id="${panel}"[^>]*aria-labelledby="${tab}"`));
  }
  assert.ok(html.indexOf('id="livePhase"') < html.indexOf('id="liveTabs"'));
  assert.match(html, /id="tabPanelReservation"[^>]*hidden>/);
  assert.match(html, /id="tabPanelFeedback"[^>]*hidden>/);
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
