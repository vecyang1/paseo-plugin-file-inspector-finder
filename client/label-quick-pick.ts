import { digitFromKeyEvent, isMacPlatform } from "./model-quick-switch-web";

export type LabelNumberShortcutMode = "empty-input" | "modifier-only";

export const MAX_NUMBERED_LABEL_CHIPS = 9;

export interface LabelKeyEventLike {
  key?: string;
  code?: string;
  keyCode?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  repeat?: boolean;
}

export interface ResolveLabelDigitInput {
  event: LabelKeyEventLike;
  digitMode: LabelNumberShortcutMode;
  isTitleInputFocused: boolean;
  isLabelInputFocused: boolean;
  labelInputValue: string;
  catalogLength: number;
  isMac: boolean;
}

export interface LabelDigitAction {
  /** 1-based chip index (1..9). */
  index: number;
  /** True when the key should be swallowed without toggling (e.g. Cmd+8 with 5 labels). */
  swallowOnly: boolean;
}

/**
 * Resolve whether a keydown inside the quick labels bar should toggle a numbered tag (1-9),
 * only swallow a conflicting workspace-switch shortcut, or pass through to text input.
 */
export function resolveLabelDigitAction(
  input: ResolveLabelDigitInput,
): LabelDigitAction | null {
  const {
    event,
    digitMode,
    isTitleInputFocused,
    isLabelInputFocused,
    labelInputValue,
    catalogLength,
    isMac,
  } = input;

  if (event.isComposing || event.key === "Process" || event.keyCode === 229) {
    return null;
  }
  if (event.altKey || event.shiftKey) {
    return null;
  }

  const digit = digitFromKeyEvent(event);
  if (digit === null || digit < 1 || digit > MAX_NUMBERED_LABEL_CHIPS) {
    return null;
  }

  const primaryMod = isMac ? Boolean(event.metaKey) : Boolean(event.ctrlKey);
  const secondaryMod = isMac ? Boolean(event.ctrlKey) : Boolean(event.metaKey);
  if (secondaryMod) {
    return null;
  }

  if (primaryMod) {
    return {
      index: digit,
      swallowOnly: digit > catalogLength,
    };
  }

  if (digitMode === "modifier-only") {
    return null;
  }
  if (isTitleInputFocused) {
    return null;
  }
  if (isLabelInputFocused && labelInputValue.length > 0) {
    return null;
  }
  if (digit <= catalogLength) {
    return {
      index: digit,
      swallowOnly: false,
    };
  }
  if (isLabelInputFocused) {
    return null;
  }
  return {
    index: digit,
    swallowOnly: true,
  };
}

export function labelHintTextFor(input: {
  index: number;
  digitMode: LabelNumberShortcutMode;
  isTitleInputFocused: boolean;
  labelInputValue: string;
  isMac: boolean;
}): string {
  const { index, digitMode, isTitleInputFocused, labelInputValue, isMac } = input;
  const plainActive =
    digitMode === "empty-input" && !isTitleInputFocused && labelInputValue.length === 0;
  if (plainActive) {
    return String(index);
  }
  return isMac ? `⌘${index}` : `Ctrl ${index}`;
}

export { isMacPlatform };
