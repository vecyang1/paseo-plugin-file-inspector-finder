import { WORKSPACE_LABEL_COLORS, type WorkspaceLabelColor } from "./contracts";

export const PASEO_THEME_NAMES = [
  "light",
  "dark",
  "zinc",
  "midnight",
  "claude",
  "ghostty",
  "pureBlack",
] as const;

export type PaseoThemeName = (typeof PASEO_THEME_NAMES)[number];

export interface PaseoThemeTokens {
  name: PaseoThemeName;
  colorScheme: "light" | "dark";
  surface0: string;
  surface1: string;
  surface2: string;
  surface3: string;
  surface4: string;
  surfaceSidebar: string;
  surfaceSidebarHover: string;
  surfaceSidebarSelected: string;
  foreground: string;
  foregroundMuted: string;
  foregroundExtraMuted: string;
  border: string;
  borderAccent: string;
  accent: string;
  accentBright: string;
  accentForeground: string;
  primary: string;
  primaryForeground: string;
  destructive: string;
  statusSuccess: string;
  statusSuccessTint: string;
  statusDanger: string;
  statusDangerTint: string;
  statusWarning: string;
  statusWarningTint: string;
  statusDotRunning: string;
  interactionHighlight: string;
  backdrop: string;
  shadowSm: string;
  shadowMd: string;
  shadowLg: string;
}

/**
 * Exact Paseo v0.15.3 canonical theme tokens (synchronized with `REGISTERED_THEMES` in module 346).
 */
export const PASEO_THEMES: Record<PaseoThemeName, PaseoThemeTokens> = {
  light: {
    name: "light",
    colorScheme: "light",
    surface0: "#ffffff",
    surface1: "#fafafa",
    surface2: "#f4f4f5",
    surface3: "#e4e4e7",
    surface4: "#d4d4d8",
    surfaceSidebar: "#f4f4f5",
    surfaceSidebarHover: "#e4e4e7",
    surfaceSidebarSelected: "#d4d4d8",
    foreground: "#1a1a1e",
    foregroundMuted: "#71717a",
    foregroundExtraMuted: "#a1a1aa",
    border: "#e4e4e7",
    borderAccent: "#ececf1",
    accent: "#20744A",
    accentBright: "#239956",
    accentForeground: "#ffffff",
    primary: "#18181b",
    primaryForeground: "#fafafa",
    destructive: "#b04138",
    statusSuccess: "#3e704a",
    statusSuccessTint: "#3e704a1f",
    statusDanger: "#9d433b",
    statusDangerTint: "#9d433b1f",
    statusWarning: "#7b5d39",
    statusWarningTint: "#7b5d391f",
    statusDotRunning: "#268ae0",
    interactionHighlight: "rgba(0, 0, 0, 0.06)",
    backdrop: "rgba(0, 0, 0, 0.35)",
    shadowSm: "0 2px 8px rgba(0, 0, 0, 0.08)",
    shadowMd: "0 4px 16px rgba(0, 0, 0, 0.06)",
    shadowLg: "0 8px 24px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04)",
  },
  dark: {
    name: "dark",
    colorScheme: "dark",
    surface0: "#181B1A",
    surface1: "#1E2120",
    surface2: "#272A29",
    surface3: "#434645",
    surface4: "#595B5B",
    surfaceSidebar: "#141716",
    surfaceSidebarHover: "#1E2120",
    surfaceSidebarSelected: "#272A29",
    foreground: "#fafafa",
    foregroundMuted: "#A1A5A4",
    foregroundExtraMuted: "#717574",
    border: "#252B2A",
    borderAccent: "#2F3534",
    accent: "#20744A",
    accentBright: "#7ccba0",
    accentForeground: "#ffffff",
    primary: "#fafafa",
    primaryForeground: "#181B1A",
    destructive: "#c64f43",
    statusSuccess: "#6cb17b",
    statusSuccessTint: "#6cb17b29",
    statusDanger: "#d8847b",
    statusDangerTint: "#d8847b29",
    statusWarning: "#c09664",
    statusWarningTint: "#c0966429",
    statusDotRunning: "#5caaf6",
    interactionHighlight: "rgba(255, 255, 255, 0.08)",
    backdrop: "rgba(0, 0, 0, 0.50)",
    shadowSm: "0 2px 4px rgba(0, 0, 0, 0.25)",
    shadowMd: "0 4px 8px rgba(0, 0, 0, 0.25)",
    shadowLg: "0 12px 24px rgba(0, 0, 0, 0.40)",
  },
  zinc: {
    name: "zinc",
    colorScheme: "dark",
    surface0: "#18181b",
    surface1: "#1f1f22",
    surface2: "#27272a",
    surface3: "#3f3f46",
    surface4: "#52525b",
    surfaceSidebar: "#131316",
    surfaceSidebarHover: "#1f1f22",
    surfaceSidebarSelected: "#27272a",
    foreground: "#fafafa",
    foregroundMuted: "#a1a1aa",
    foregroundExtraMuted: "#71717a",
    border: "#27272a",
    borderAccent: "#303036",
    accent: "#e4e4e7",
    accentBright: "#fafafa",
    accentForeground: "#18181b",
    primary: "#fafafa",
    primaryForeground: "#18181b",
    destructive: "#c44a4a",
    statusSuccess: "#6cb17b",
    statusSuccessTint: "#6cb17b29",
    statusDanger: "#d8847b",
    statusDangerTint: "#d8847b29",
    statusWarning: "#c09664",
    statusWarningTint: "#c0966429",
    statusDotRunning: "#5caaf6",
    interactionHighlight: "rgba(255, 255, 255, 0.08)",
    backdrop: "rgba(0, 0, 0, 0.50)",
    shadowSm: "0 2px 4px rgba(0, 0, 0, 0.25)",
    shadowMd: "0 4px 8px rgba(0, 0, 0, 0.25)",
    shadowLg: "0 12px 24px rgba(0, 0, 0, 0.40)",
  },
  midnight: {
    name: "midnight",
    colorScheme: "dark",
    surface0: "#161820",
    surface1: "#1c1e27",
    surface2: "#252731",
    surface3: "#3c3e4c",
    surface4: "#535564",
    surfaceSidebar: "#121420",
    surfaceSidebarHover: "#1c1e27",
    surfaceSidebarSelected: "#252731",
    foreground: "#fafafa",
    foregroundMuted: "#9a9db0",
    foregroundExtraMuted: "#6b6e82",
    border: "#242636",
    borderAccent: "#2e3040",
    accent: "#3b6fcf",
    accentBright: "#7eaaeb",
    accentForeground: "#ffffff",
    primary: "#fafafa",
    primaryForeground: "#161820",
    destructive: "#c44a52",
    statusSuccess: "#6cb17b",
    statusSuccessTint: "#6cb17b29",
    statusDanger: "#d8847b",
    statusDangerTint: "#d8847b29",
    statusWarning: "#c09664",
    statusWarningTint: "#c0966429",
    statusDotRunning: "#5caaf6",
    interactionHighlight: "rgba(255, 255, 255, 0.08)",
    backdrop: "rgba(0, 0, 0, 0.50)",
    shadowSm: "0 2px 4px rgba(0, 0, 0, 0.25)",
    shadowMd: "0 4px 8px rgba(0, 0, 0, 0.25)",
    shadowLg: "0 12px 24px rgba(0, 0, 0, 0.40)",
  },
  claude: {
    name: "claude",
    colorScheme: "dark",
    surface0: "#1f1f1e",
    surface1: "#262523",
    surface2: "#2f2d2b",
    surface3: "#4a4745",
    surface4: "#605d5b",
    surfaceSidebar: "#1a1918",
    surfaceSidebarHover: "#262523",
    surfaceSidebarSelected: "#2f2d2b",
    foreground: "#fafafa",
    foregroundMuted: "#ada9a5",
    foregroundExtraMuted: "#78746f",
    border: "#2c2a27",
    borderAccent: "#36332f",
    accent: "#d97757",
    accentBright: "#e89a7f",
    accentForeground: "#ffffff",
    primary: "#fafafa",
    primaryForeground: "#1f1f1e",
    destructive: "#cf513e",
    statusSuccess: "#6cb17b",
    statusSuccessTint: "#6cb17b29",
    statusDanger: "#d8847b",
    statusDangerTint: "#d8847b29",
    statusWarning: "#c09664",
    statusWarningTint: "#c0966429",
    statusDotRunning: "#5caaf6",
    interactionHighlight: "rgba(255, 255, 255, 0.08)",
    backdrop: "rgba(0, 0, 0, 0.50)",
    shadowSm: "0 2px 4px rgba(0, 0, 0, 0.25)",
    shadowMd: "0 4px 8px rgba(0, 0, 0, 0.25)",
    shadowLg: "0 12px 24px rgba(0, 0, 0, 0.40)",
  },
  ghostty: {
    name: "ghostty",
    colorScheme: "dark",
    surface0: "#282c34",
    surface1: "#2f333d",
    surface2: "#383c48",
    surface3: "#4a4f5e",
    surface4: "#5b6175",
    surfaceSidebar: "#21252d",
    surfaceSidebarHover: "#2f333d",
    surfaceSidebarSelected: "#383c48",
    foreground: "#fafafa",
    foregroundMuted: "#c8ccd8",
    foregroundExtraMuted: "#a0a4b2",
    border: "#353a47",
    borderAccent: "#3f4454",
    accent: "#3570e0",
    accentBright: "#b4d0fc",
    accentForeground: "#ffffff",
    primary: "#fafafa",
    primaryForeground: "#282c34",
    destructive: "#c44a55",
    statusSuccess: "#6cb17b",
    statusSuccessTint: "#6cb17b29",
    statusDanger: "#d8847b",
    statusDangerTint: "#d8847b29",
    statusWarning: "#c09664",
    statusWarningTint: "#c0966429",
    statusDotRunning: "#5caaf6",
    interactionHighlight: "rgba(255, 255, 255, 0.08)",
    backdrop: "rgba(0, 0, 0, 0.50)",
    shadowSm: "0 2px 4px rgba(0, 0, 0, 0.25)",
    shadowMd: "0 4px 8px rgba(0, 0, 0, 0.25)",
    shadowLg: "0 12px 24px rgba(0, 0, 0, 0.40)",
  },
  pureBlack: {
    name: "pureBlack",
    colorScheme: "dark",
    surface0: "#000000",
    surface1: "#0a0a0a",
    surface2: "#111111",
    surface3: "#202020",
    surface4: "#2d2d2d",
    surfaceSidebar: "#000000",
    surfaceSidebarHover: "#0a0a0a",
    surfaceSidebarSelected: "#111111",
    foreground: "#fafafa",
    foregroundMuted: "#a1a1aa",
    foregroundExtraMuted: "#71717a",
    border: "#1c1c1c",
    borderAccent: "#242424",
    accent: "#20744A",
    accentBright: "#7ccba0",
    accentForeground: "#ffffff",
    primary: "#fafafa",
    primaryForeground: "#000000",
    destructive: "#c44a4a",
    statusSuccess: "#6cb17b",
    statusSuccessTint: "#6cb17b29",
    statusDanger: "#d8847b",
    statusDangerTint: "#d8847b29",
    statusWarning: "#c09664",
    statusWarningTint: "#c0966429",
    statusDotRunning: "#5caaf6",
    interactionHighlight: "rgba(255, 255, 255, 0.08)",
    backdrop: "rgba(0, 0, 0, 0.55)",
    shadowSm: "0 2px 4px rgba(0, 0, 0, 0.35)",
    shadowMd: "0 4px 8px rgba(0, 0, 0, 0.35)",
    shadowLg: "0 12px 24px rgba(0, 0, 0, 0.55)",
  },
};

/**
 * Exact Paseo `identityColor` / `ProjectIconView` palette (module 3552).
 */
export const PASEO_IDENTITY_BG_HEX: Record<WorkspaceLabelColor, string> = {
  violet: "#7a6aa8",
  sky: "#3d7ea6",
  emerald: "#388068",
  orange: "#a4673a",
  pink: "#b05c80",
  indigo: "#6a70b8",
  teal: "#368080",
  red: "#b06260",
  amber: "#8f7838",
  blue: "#5179b0",
};

export const PASEO_IDENTITY_FG_LIGHT_HEX: Record<WorkspaceLabelColor, string> = {
  violet: "#6d49b5",
  sky: "#3d6985",
  emerald: "#3e6e5d",
  orange: "#845838",
  pink: "#974168",
  indigo: "#5251c2",
  teal: "#3e6d6c",
  red: "#9c4243",
  amber: "#716239",
  blue: "#39649e",
};

export const PASEO_IDENTITY_FG_DARK_HEX: Record<WorkspaceLabelColor, string> = {
  violet: "#a392d5",
  sky: "#6aa6ce",
  emerald: "#6cae96",
  orange: "#cc8f64",
  pink: "#d87da3",
  indigo: "#9299d5",
  teal: "#6cacab",
  red: "#d88381",
  amber: "#b29d64",
  blue: "#7ba1d5",
};

/**
 * Paseo's deterministic 32-bit identity color hash (`deriveIdentityColorName` in module 3552).
 */
export function derivePaseoIdentityColorName(seed: string): WorkspaceLabelColor {
  let hash = 0;
  for (const ch of seed) {
    hash = (31 * hash + ch.charCodeAt(0)) >>> 0;
  }
  return WORKSPACE_LABEL_COLORS[hash % WORKSPACE_LABEL_COLORS.length] ?? "violet";
}

export function derivePaseoIdentityColorHex(seed: string): string {
  return PASEO_IDENTITY_BG_HEX[derivePaseoIdentityColorName(seed)];
}

/**
 * Matches Paseo's `projectIconPlaceholderLabelFromDisplayName(name).charAt(0).toUpperCase()` (module 3663).
 */
export function deriveProjectIconInitial(projectName: string): string {
  const trimmed = projectName.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split("/").filter(Boolean);
  const last = parts[parts.length - 1] ?? trimmed;
  return last.charAt(0).toUpperCase() || "?";
}

/**
 * Normalize Unistyles class names or stored theme preferences into a canonical `PaseoThemeName`.
 */
export function normalizePaseoThemeName(
  raw: string | null | undefined,
  systemPrefersDark = false,
): PaseoThemeName | null {
  if (!raw) return null;
  const clean = raw.trim();
  if (!clean) return null;
  if (clean === "auto") {
    return systemPrefersDark ? "dark" : "light";
  }
  if (clean === "light" || clean === "pluginLight") return "light";
  if (clean === "dark" || clean === "pluginDark") return "dark";
  if (clean === "zinc" || clean === "darkZinc") return "zinc";
  if (clean === "midnight" || clean === "darkMidnight") return "midnight";
  if (clean === "claude" || clean === "darkClaude") return "claude";
  if (clean === "ghostty" || clean === "darkGhostty") return "ghostty";
  if (clean === "pureBlack" || clean === "darkPureBlack" || clean === "pure-black") {
    return "pureBlack";
  }
  return null;
}
