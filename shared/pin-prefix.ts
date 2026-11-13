export const DEFAULT_PIN_PREFIX = "[pin] ";

export interface PinPrefixSplitResult {
  hasPin: boolean;
  pinPrefix: string;
  rest: string;
}

export interface PinSyncTitleResult {
  changed: boolean;
  nextTitle: string | null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Normalizes a configured pin prefix so it always contains a non-empty token
 * followed by a single space when separating from a title.
 */
export function normalizePinPrefix(raw?: string | null): string {
  if (typeof raw !== "string") return DEFAULT_PIN_PREFIX;
  const trimmed = raw.trim();
  if (!trimmed) return DEFAULT_PIN_PREFIX;
  return `${trimmed} `;
}

/**
 * Splits a leading `[pin] ` (or configured custom pin prefix) from a workspace title.
 * Also recognizes a leading done marker before `[pin] ` (e.g. `d [pin] Task`) so
 * toggling done or unpinning never leaves a duplicate or stranded `[pin]` token.
 */
export function splitPinPrefix(
  title: string | null | undefined,
  prefix: string = DEFAULT_PIN_PREFIX,
): PinPrefixSplitResult {
  const norm = normalizePinPrefix(prefix);
  const token = norm.trim();
  const trimmed = (title ?? "").trim();
  if (!trimmed) {
    return { hasPin: false, pinPrefix: "", rest: "" };
  }

  const escaped = escapeRegExp(token);
  const leadingRe = new RegExp(`^(${escaped})(?:\\s+(.*))?$`, "i");
  const leadingMatch = trimmed.match(leadingRe);
  if (leadingMatch) {
    return {
      hasPin: true,
      pinPrefix: `${leadingMatch[1]} `,
      rest: (leadingMatch[2] ?? "").trimStart(),
    };
  }

  const afterDoneRe = new RegExp(`^(d(?:\\s+|[-_:]\\s*))(${escaped})(?:\\s+(.*))?$`, "i");
  const afterDoneMatch = trimmed.match(afterDoneRe);
  if (afterDoneMatch) {
    const donePart = afterDoneMatch[1];
    const pinPart = afterDoneMatch[2];
    const tail = (afterDoneMatch[3] ?? "").trimStart();
    return {
      hasPin: true,
      pinPrefix: `${pinPart} `,
      rest: tail ? `${donePart}${tail}` : donePart.trim(),
    };
  }

  return {
    hasPin: false,
    pinPrefix: "",
    rest: trimmed,
  };
}

export function hasPinPrefix(
  title: string | null | undefined,
  prefix: string = DEFAULT_PIN_PREFIX,
): boolean {
  return splitPinPrefix(title, prefix).hasPin;
}

export function applyPinPrefix(
  title: string | null | undefined,
  prefix: string = DEFAULT_PIN_PREFIX,
): string {
  const norm = normalizePinPrefix(prefix);
  const trimmed = (title ?? "").trim();
  if (!trimmed || trimmed === "main") {
    return norm.trim();
  }
  const split = splitPinPrefix(trimmed, norm);
  if (split.hasPin) {
    return trimmed;
  }
  return `${norm}${trimmed}`;
}

export function removePinPrefix(
  title: string | null | undefined,
  prefix: string = DEFAULT_PIN_PREFIX,
): string | null {
  const norm = normalizePinPrefix(prefix);
  const trimmed = (title ?? "").trim();
  if (!trimmed) return null;
  const split = splitPinPrefix(trimmed, norm);
  if (!split.hasPin) {
    return trimmed;
  }
  const rest = split.rest.trim();
  return rest.length > 0 ? rest : null;
}

export function computePinSyncedTitle(
  currentTitle: string | null | undefined,
  pinned: boolean,
  prefix: string = DEFAULT_PIN_PREFIX,
): PinSyncTitleResult {
  const norm = normalizePinPrefix(prefix);
  const raw = (currentTitle ?? "").trim();
  if (pinned) {
    if (hasPinPrefix(raw, norm)) {
      return { changed: false, nextTitle: raw || null };
    }
    const nextTitle = applyPinPrefix(raw, norm);
    return {
      changed: nextTitle !== raw,
      nextTitle,
    };
  }
  if (!hasPinPrefix(raw, norm)) {
    return { changed: false, nextTitle: raw || null };
  }
  return {
    changed: true,
    nextTitle: removePinPrefix(raw, norm),
  };
}
