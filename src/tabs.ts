export interface TabPair {
  tab: Pick<HTMLButtonElement, "setAttribute" | "tabIndex">;
  panel: Pick<HTMLElement, "hidden">;
}

export function showTab(pairs: readonly TabPair[], selected: number): void {
  if (selected < 0 || selected >= pairs.length) throw new RangeError("未知标签页");
  pairs.forEach(({ tab, panel }, index) => {
    const active = index === selected;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    panel.hidden = !active;
  });
}

export function tabIndexForKey(key: string, current: number, count: number): number | null {
  if (count < 1 || current < 0 || current >= count) return null;
  if (key === "ArrowRight") return (current + 1) % count;
  if (key === "ArrowLeft") return (current + count - 1) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}
