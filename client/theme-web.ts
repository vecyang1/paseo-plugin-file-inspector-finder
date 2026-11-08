import {
  PASEO_THEMES,
  type PaseoThemeName,
  type PaseoThemeTokens,
  derivePaseoIdentityColorHex,
  deriveProjectIconInitial,
  normalizePaseoThemeName,
} from "../shared/paseo-theme";
import type { MinimalElement } from "./web";

interface MinimalThemeDoc {
  body?: MinimalElement | null;
  documentElement?: MinimalElement | null;
  querySelector?(selector: string): MinimalElement | null;
  querySelectorAll?(selector: string): ArrayLike<MinimalElement>;
}

interface MinimalThemeWin {
  document?: MinimalThemeDoc;
  localStorage?: {
    getItem(key: string): string | null;
  };
  getComputedStyle?(el: MinimalElement): {
    backgroundColor?: string;
    color?: string;
  } | null;
  matchMedia?(query: string): { matches?: boolean } | null;
}

function parseRgbTriplet(raw: string | undefined | null): [number, number, number] | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed === "transparent" || trimmed === "rgba(0, 0, 0, 0)") {
    return null;
  }
  const rgbMatch = trimmed.match(
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([0-9.]+))?\s*\)$/,
  );
  if (rgbMatch) {
    const alpha = rgbMatch[4] !== undefined ? Number.parseFloat(rgbMatch[4]) : 1;
    if (Number.isFinite(alpha) && alpha < 0.15) return null;
    return [
      Number.parseInt(rgbMatch[1] ?? "0", 10),
      Number.parseInt(rgbMatch[2] ?? "0", 10),
      Number.parseInt(rgbMatch[3] ?? "0", 10),
    ];
  }
  const hex = trimmed.startsWith("#") ? trimmed.slice(1) : "";
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ];
  }
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return [
      Number.parseInt(`${hex[0]}${hex[0]}`, 16),
      Number.parseInt(`${hex[1]}${hex[1]}`, 16),
      Number.parseInt(`${hex[2]}${hex[2]}`, 16),
    ];
  }
  return null;
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toLowerCase();
}

function matchThemeBySurfaceHex(hex: string): PaseoThemeName | null {
  const lower = hex.toLowerCase();
  if (lower === "#ffffff" || lower === "#fafafa" || lower === "#f4f4f5") return "light";
  if (lower === "#181b1a" || lower === "#1e2120" || lower === "#141716") return "dark";
  if (lower === "#18181b" || lower === "#1f1f22" || lower === "#131316") return "zinc";
  if (lower === "#161820" || lower === "#1c1e27" || lower === "#121420") return "midnight";
  if (lower === "#1f1f1e" || lower === "#262523" || lower === "#1a1918") return "claude";
  if (lower === "#282c34" || lower === "#2f333d" || lower === "#21252d") return "ghostty";
  if (lower === "#000000" || lower === "#0a0a0a") return "pureBlack";
  return null;
}

function detectThemeFromComputedDom(
  doc: MinimalThemeDoc | null | undefined,
  win: MinimalThemeWin | null | undefined,
): PaseoThemeName | null {
  if (!doc || !win?.getComputedStyle) return null;
  const probes: (MinimalElement | null | undefined)[] = [
    doc.querySelector?.('[data-testid="workspace-header-title"]')?.parentElement?.parentElement,
    doc.querySelector?.("#root")?.children?.[0],
    doc.querySelector?.("#root"),
    doc.body,
    doc.documentElement,
    doc.querySelector?.('[data-testid^="sidebar-project-row-"]')?.parentElement?.parentElement,
  ];

  for (const el of probes) {
    if (!el) continue;
    try {
      const bg = win.getComputedStyle(el)?.backgroundColor;
      const rgb = parseRgbTriplet(bg);
      if (!rgb) continue;
      const hex = rgbToHex(rgb);
      const exact = matchThemeBySurfaceHex(hex);
      if (exact) return exact;
      const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
      return lum >= 0.55 ? "light" : "dark";
    } catch {
      // Ignore computed style error in mock DOM
    }
  }
  return null;
}

/**
 * Resolves the active Paseo theme tokens (`light`, `dark`, `zinc`, `midnight`, `claude`, `ghostty`, `pureBlack`)
 * from Paseo's stored settings, Unistyles root classes, and live DOM surface luminance.
 */
export function resolveActivePaseoTheme(
  docOverride?: MinimalThemeDoc | Document | null,
  winOverride?: MinimalThemeWin | Window | null,
): PaseoThemeTokens {
  const globalWin =
    (winOverride as MinimalThemeWin | null | undefined) ??
    (typeof globalThis !== "undefined"
      ? ((globalThis as unknown as { window?: MinimalThemeWin }).window ?? null)
      : null);
  const doc = (docOverride as MinimalThemeDoc | null | undefined) ?? globalWin?.document ?? null;

  let systemPrefersDark = false;
  try {
    const mq = globalWin?.matchMedia?.("(prefers-color-scheme: dark)");
    if (mq && typeof mq.matches === "boolean") {
      systemPrefersDark = mq.matches;
    }
  } catch {
    // Ignore
  }

  // 1. Check Unistyles root class on <html> (`light`, `dark`, `darkZinc`, `darkMidnight`, `darkClaude`, `darkGhostty`, `darkPureBlack`)
  const rootClasses = (doc?.documentElement?.className ?? "").split(/\s+/).filter(Boolean);
  for (const cls of rootClasses) {
    const matched = normalizePaseoThemeName(cls, systemPrefersDark);
    if (matched) {
      return PASEO_THEMES[matched];
    }
  }

  // 2. Check Paseo `@paseo:app-settings` / `@paseo:settings` in localStorage
  try {
    const storage = globalWin?.localStorage;
    if (storage) {
      for (const key of ["@paseo:app-settings", "@paseo:settings"]) {
        const raw = storage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw) as {
          theme?: string;
          themePreference?: string;
          appearance?: { theme?: string };
        };
        const rawPref =
          parsed?.theme ?? parsed?.themePreference ?? parsed?.appearance?.theme ?? null;
        if (rawPref && rawPref !== "auto") {
          const matched = normalizePaseoThemeName(rawPref, systemPrefersDark);
          if (matched) {
            return PASEO_THEMES[matched];
          }
        }
      }
    }
  } catch {
    // Ignore storage parse error
  }

  // 3. Check live rendered DOM background color (handles `theme: "auto"` and instant live theme switches)
  const domDetected = detectThemeFromComputedDom(doc, globalWin);
  if (domDetected) {
    return PASEO_THEMES[domDetected];
  }

  // 4. Fallback to system color scheme (defaulting to Paseo `light` when system is light, `dark` when dark)
  return systemPrefersDark ? PASEO_THEMES.dark : PASEO_THEMES.light;
}

/**
 * Syncs `--paseo-finder-*` CSS custom properties onto `document.documentElement` so stylesheet rules
 * (such as inline rename input & scrollbars) automatically match Paseo's active theme.
 */
export function syncPaseoThemeCssVariables(
  docOverride?: MinimalThemeDoc | Document | null,
  winOverride?: MinimalThemeWin | Window | null,
): PaseoThemeTokens {
  const tokens = resolveActivePaseoTheme(docOverride, winOverride);
  const globalWin =
    (winOverride as MinimalThemeWin | null | undefined) ??
    (typeof globalThis !== "undefined"
      ? ((globalThis as unknown as { window?: MinimalThemeWin }).window ?? null)
      : null);
  const doc = (docOverride as MinimalThemeDoc | null | undefined) ?? globalWin?.document ?? null;
  const root = doc?.documentElement;
  if (root?.style) {
    const styleObj = root.style as Record<string, unknown> & {
      setProperty?: (k: string, v: string) => void;
    };
    const setVar = (k: string, v: string) => {
      if (typeof styleObj.setProperty === "function") {
        styleObj.setProperty(k, v);
      }
      styleObj[k] = v;
    };
    setVar("--paseo-finder-surface-0", tokens.surface0);
    setVar("--paseo-finder-surface-1", tokens.surface1);
    setVar("--paseo-finder-surface-2", tokens.surface2);
    setVar("--paseo-finder-surface-3", tokens.surface3);
    setVar("--paseo-finder-surface-4", tokens.surface4);
    setVar("--paseo-finder-fg", tokens.foreground);
    setVar("--paseo-finder-fg-muted", tokens.foregroundMuted);
    setVar("--paseo-finder-fg-extra-muted", tokens.foregroundExtraMuted);
    setVar("--paseo-finder-border", tokens.border);
    setVar("--paseo-finder-border-accent", tokens.borderAccent);
    setVar("--paseo-finder-accent", tokens.accent);
    setVar("--paseo-finder-accent-bright", tokens.accentBright);
    setVar("--paseo-finder-primary", tokens.primary);
    setVar("--paseo-finder-primary-fg", tokens.primaryForeground);
    setVar("--paseo-finder-running", tokens.statusDotRunning);
  }
  root?.setAttribute?.("data-paseo-finder-theme", tokens.name);
  return tokens;
}

/**
 * Resolves the exact project square icon badge (`backgroundColor`, `initial`, or `iconDataUri`)
 * matching Paseo's left sidebar `ProjectIconView` (`sidebar-project-row-${viewKey}`).
 */
export function resolveSidebarProjectVisual(
  doc: MinimalThemeDoc | null | undefined,
  win: MinimalThemeWin | null | undefined,
  project: {
    projectId: string;
    projectKey?: string | null;
    projectName: string;
  },
): {
  backgroundColor: string;
  initial: string;
  iconDataUri: string | null;
  viewKey: string;
} {
  const initial = deriveProjectIconInitial(project.projectName);
  const cleanName = project.projectName.trim().toLowerCase();
  const cleanId = project.projectId.trim();
  const cleanKey = (project.projectKey ?? "").trim();

  let matchedRow: MinimalElement | null = null;
  let matchedViewKey = cleanKey || cleanId || project.projectName;

  const rows = doc?.querySelectorAll?.('[data-testid^="sidebar-project-row-"]');
  if (rows) {
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (!row) continue;
      const tid = row.getAttribute?.("data-testid") ?? "";
      const viewKey = tid.replace(/^sidebar-project-row-/, "");
      if (
        (cleanKey && (viewKey === cleanKey || tid.endsWith(`:${cleanKey}`))) ||
        (cleanId && (viewKey === cleanId || tid.endsWith(`:${cleanId}`))) ||
        (cleanName && (row.textContent ?? "").trim().toLowerCase() === cleanName)
      ) {
        matchedRow = row;
        if (viewKey) matchedViewKey = viewKey;
        break;
      }
    }
  }

  let iconDataUri: string | null = null;
  let domBgColor: string | null = null;

  if (matchedRow) {
    const imgEl = matchedRow.querySelector?.("img");
    const src = imgEl?.getAttribute?.("src");
    if (src && src.trim()) {
      iconDataUri = src.trim();
    }
    const divs = matchedRow.querySelectorAll?.("div");
    if (divs && win?.getComputedStyle) {
      for (let i = 0; i < Math.min(divs.length, 10); i += 1) {
        const div = divs[i];
        if (!div) continue;
        const inlineBg = div.style?.backgroundColor;
        const computedBg = inlineBg || win.getComputedStyle(div)?.backgroundColor;
        const rgb = parseRgbTriplet(computedBg);
        if (!rgb) continue;
        // Skip neutral grays/whites from row hover backgrounds; pick the saturated identity badge color
        const maxC = Math.max(rgb[0], rgb[1], rgb[2]);
        const minC = Math.min(rgb[0], rgb[1], rgb[2]);
        if (maxC - minC >= 18) {
          domBgColor = rgbToHex(rgb);
          break;
        }
      }
    }
  }

  return {
    backgroundColor: domBgColor ?? derivePaseoIdentityColorHex(matchedViewKey),
    initial,
    iconDataUri,
    viewKey: matchedViewKey,
  };
}
