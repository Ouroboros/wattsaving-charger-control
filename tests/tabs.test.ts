import assert from "node:assert/strict";
import test from "node:test";
import { showTab, tabIndexForKey, type TabPair } from "../src/tabs";

test("标签切换只显示选中分区，并同步键盘焦点和 aria-selected", () => {
  const attributes: Map<string, string>[] = [];
  const pairs: TabPair[] = Array.from({ length: 3 }, () => {
    const attrs = new Map<string, string>();
    attributes.push(attrs);
    return { tab: { setAttribute(name: string, value: string) { attrs.set(name, value); }, tabIndex: -1 },
      panel: { hidden: true } };
  });
  showTab(pairs, 1);
  assert.deepEqual(pairs.map(({ panel }) => panel.hidden), [true, false, true]);
  assert.deepEqual(pairs.map(({ tab }) => tab.tabIndex), [-1, 0, -1]);
  assert.deepEqual(attributes.map(attrs => attrs.get("aria-selected")), ["false", "true", "false"]);
  showTab(pairs, 2);
  assert.deepEqual(pairs.map(({ panel }) => panel.hidden), [true, true, false]);
  assert.throws(() => showTab(pairs, 3), RangeError);
});

test("左右键可循环切换标签，Home/End 定位首尾", () => {
  assert.equal(tabIndexForKey("ArrowRight", 2, 3), 0);
  assert.equal(tabIndexForKey("ArrowLeft", 0, 3), 2);
  assert.equal(tabIndexForKey("Home", 2, 3), 0);
  assert.equal(tabIndexForKey("End", 0, 3), 2);
  assert.equal(tabIndexForKey("Enter", 1, 3), null);
  assert.equal(tabIndexForKey("ArrowRight", -1, 3), null);
});
