/// <reference lib="dom" />
/**
 * Reads the settings rows off the rendered detail pane (`settings-detail-pane`).
 *
 * Paseo v0.15.3 gives settings rows no test ids and its class names are generated, so rows are
 * recognised by what the eye uses too (measured in the web harness, 2026-11-09):
 *   page title     the first text >= 20px                       ("Overview", 26px)
 *   group heading  <= 13px, muted, flush with the page title     ("Daemon", "Danger zone")
 *   row title      >= 13.5px, foreground colour, inset < 80px    ("Keep daemon running after quit")
 *   row hint       the row title's next text sibling, smaller and muted
 * Values, chips and small buttons ("Default", "Restart", "localhost:6767") do not qualify.
 * Colours are compared with the page title's own colour, so every theme works the same.
 *
 * SELF-CONTAINED ON PURPOSE: `scripts/build-settings-search-seed.mts` hands this function to
 * Playwright's `page.evaluate`, which ships only its source text. A helper defined outside the
 * body would be undefined inside the page.
 */
export interface HarvestedSettingsPage {
  label: string;
  entries: Array<{ title: string; hint?: string; group?: string }>;
  leaves: number;
}

export function harvestSettingsDetailPane(root: Element | null): HarvestedSettingsPage | null {
  if (!root) return null;
  const win = root.ownerDocument?.defaultView;
  if (!win) return null;
  const TEXT = '[dir="auto"]';
  const CONTROL =
    'button,[role="button"],[role="switch"],[role="radio"],[role="checkbox"],[role="tab"],[role="link"],a,input,textarea,select';
  const norm = (value: string | null | undefined): string => (value ?? "").replace(/\s+/g, " ").trim();
  const isLeaf = (el: Element): boolean => el.matches(TEXT) && !el.querySelector(TEXT);
  const rootWidth = root.getBoundingClientRect().width || 1;

  interface Info {
    el: Element;
    text: string;
    size: number;
    color: string;
    x: number;
    shown: boolean;
    smallControl: boolean;
  }
  const infos: Info[] = [];
  const byEl = new Map<Element, Info>();
  for (const el of Array.from(root.querySelectorAll(TEXT))) {
    if (!isLeaf(el)) continue;
    const cs = win.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const control = el.closest(CONTROL);
    // A whole-row pressable ("Pair device", a plugin row) still names a setting; a button does not.
    const smallControl = control
      ? control.getBoundingClientRect().width < rootWidth * 0.45
      : false;
    const info: Info = {
      el,
      text: norm(el.textContent),
      size: parseFloat(cs.fontSize) || 0,
      color: cs.color,
      x: rect.left,
      shown: rect.width > 0 && rect.height > 0 && cs.visibility !== "hidden",
      smallControl,
    };
    infos.push(info);
    byEl.set(el, info);
  }

  const title = infos.find((info) => info.shown && info.size >= 20 && info.text);
  if (!title) return null;
  const fg = title.color;
  const baseX = title.x;
  const entries: HarvestedSettingsPage["entries"] = [];
  const used = new Set<Element>();
  let group: string | undefined;

  for (const info of infos) {
    if (info === title || !info.shown || !info.text || info.smallControl || used.has(info.el)) {
      continue;
    }
    if (info.size >= 20) continue;
    const inset = info.x - baseX;
    if (Math.abs(inset) <= 4 && info.size <= 13 && info.color !== fg) {
      group = info.text;
      continue;
    }
    if (inset > 4 && inset < 80 && info.size >= 13.5 && info.color === fg) {
      let hint: string | undefined;
      const sibling = info.el.nextElementSibling;
      const next = sibling ? byEl.get(sibling) : undefined;
      if (next && next.text && next.size < info.size && next.color !== fg) {
        hint = next.text;
        used.add(next.el);
      }
      entries.push({ title: info.text, ...(hint ? { hint } : {}), ...(group ? { group } : {}) });
      continue;
    }
    // A row made of a hint and a button only ("Restart and also close every terminal ...").
    if (
      inset > 4 &&
      inset < 80 &&
      info.size <= 13 &&
      info.color !== fg &&
      info.text.length >= 24 &&
      /\s/.test(info.text)
    ) {
      const previous = info.el.previousElementSibling;
      if (!previous || !byEl.has(previous)) {
        entries.push({ title: info.text, ...(group ? { group } : {}) });
      }
    }
  }
  return { label: title.text, entries, leaves: infos.length };
}
