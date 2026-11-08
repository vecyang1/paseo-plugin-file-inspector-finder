/// <reference lib="dom" />
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import {
  VOICE_STT_PRESETS,
  type VoiceSttPreset,
  manageVoiceSttRpc,
} from "../shared/contracts";
import { isChineseLocale } from "./i18n";
import { syncPaseoThemeCssVariables } from "./theme-web";

export interface VoiceSttWebClient {
  call(
    def: typeof manageVoiceSttRpc,
    input: RpcInput<typeof manageVoiceSttRpc>,
  ): Promise<RpcOutput<typeof manageVoiceSttRpc>>;
  getLocale?(): string;
}

const VOICE_HELPER_STORAGE_KEY = "paseo:finder-plugin:voice-helper-config";

export function syncVoiceCustomModelPreferences(enabled: boolean): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(
      VOICE_HELPER_STORAGE_KEY,
      JSON.stringify({ enabled }),
    );
  } catch {
    // Ignore storage errors
  }
}

export function readVoiceCustomModelPreferences(): { enabled: boolean } {
  if (typeof window === "undefined" || !window.localStorage) {
    return { enabled: true };
  }
  try {
    const raw = window.localStorage.getItem(VOICE_HELPER_STORAGE_KEY);
    if (!raw) return { enabled: true };
    const parsed = JSON.parse(raw) as { enabled?: unknown };
    return { enabled: parsed.enabled !== false };
  } catch {
    return { enabled: true };
  }
}

interface VoiceCopy {
  customModelLabel: string;
  presetsLabel: string;
  customModelPlaceholder: string;
  applyBtn: string;
  applyingBtn: string;
  testBtn: string;
  testingBtn: string;
  appliedSuccessPrefix: string;
  testOkPrefix: string;
  testFailPrefix: string;
}

const COPY_EN: VoiceCopy = {
  customModelLabel: "Custom model",
  presetsLabel: "Presets",
  customModelPlaceholder: "Model ID (e.g. Qwen/Qwen3-ASR-1.7B)",
  applyBtn: "Apply",
  applyingBtn: "Saving…",
  testBtn: "Test",
  testingBtn: "Testing…",
  appliedSuccessPrefix: "Saved",
  testOkPrefix: "OK",
  testFailPrefix: "Failed",
};

const COPY_ZH: VoiceCopy = {
  customModelLabel: "自定义模型",
  presetsLabel: "快捷预设",
  customModelPlaceholder: "模型 ID（如 Qwen/Qwen3-ASR-1.7B）",
  applyBtn: "应用",
  applyingBtn: "保存中…",
  testBtn: "测试",
  testingBtn: "测试中…",
  appliedSuccessPrefix: "已保存",
  testOkPrefix: "通过",
  testFailPrefix: "失败",
};

const SHORT_PRESET_LABELS: Record<string, { en: string; zh: string }> = {
  "siliconflow-sensevoice-free": { en: "SenseVoiceSmall", zh: "SenseVoiceSmall" },
  "siliconflow-qwen3-asr": { en: "Qwen3-ASR-1.7B", zh: "Qwen3-ASR-1.7B" },
  "siliconflow-telespeech-free": { en: "TeleSpeechASR", zh: "TeleSpeechASR" },
  "gemini-audio-pool": { en: "Gemini Pool", zh: "Gemini 语音池" },
  "groq-whisper-turbo": { en: "Whisper LPU", zh: "Whisper LPU" },
  "local-parakeet": { en: "Parakeet Local", zh: "本地 Parakeet" },
};

function getCopy(locale?: string | null): { copy: VoiceCopy; zh: boolean } {
  const zh = isChineseLocale(
    locale ?? (typeof navigator !== "undefined" ? navigator.language : "en"),
  );
  return { copy: zh ? COPY_ZH : COPY_EN, zh };
}

function getShortPresetName(preset: VoiceSttPreset, zh: boolean): string {
  const mapped = SHORT_PRESET_LABELS[preset.id];
  if (mapped) return zh ? mapped.zh : mapped.en;
  const parts = preset.model.split("/");
  return parts[parts.length - 1] || preset.model;
}

function buildNativeVoiceSheetRows(
  doc: Document,
  client: VoiceSttWebClient,
  testId: string,
): HTMLElement {
  const { copy, zh } = getCopy(client.getLocale?.());
  const theme = syncPaseoThemeCssVariables(doc as never);
  const container = doc.createElement("div");
  container.setAttribute("data-testid", testId);
  container.style.cssText = [
    "margin-top: 8px",
    "padding: 12px 14px",
    "border-radius: 10px",
    `background: ${theme.surface0}`,
    `border: 1px solid ${theme.border}`,
    "display: flex",
    "flex-direction: column",
    "gap: 10px",
    "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, sans-serif",
  ].join(";");

  // Row 1: Left label ("Custom model") + Right compact input & quiet buttons (matches Paseo "Base URL" row)
  const mainRow = doc.createElement("div");
  mainRow.style.cssText =
    "display: flex; flex-direction: row; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;";

  const labelEl = doc.createElement("div");
  labelEl.textContent = copy.customModelLabel;
  labelEl.style.cssText = `font-size: 13px; font-weight: 400; color: ${theme.foreground}; flex-shrink: 0;`;

  const controlsRight = doc.createElement("div");
  controlsRight.style.cssText =
    "display: flex; flex-direction: row; align-items: center; gap: 6px; flex: 1; justify-content: flex-end; min-width: 220px;";

  const modelInput = doc.createElement("input");
  modelInput.type = "text";
  modelInput.setAttribute("data-testid", `${testId}-model-input`);
  modelInput.placeholder = copy.customModelPlaceholder;
  modelInput.style.cssText = [
    "width: 175px",
    "max-width: 100%",
    "padding: 6px 10px",
    "border-radius: 6px",
    `background: ${theme.surface2}`,
    "border: 1px solid transparent",
    `color: ${theme.foreground}`,
    "font-size: 12.5px",
    "outline: none",
  ].join(";");

  const applyBtn = doc.createElement("button");
  applyBtn.type = "button";
  applyBtn.setAttribute("data-testid", `${testId}-apply-btn`);
  applyBtn.textContent = copy.applyBtn;
  applyBtn.style.cssText = [
    "padding: 6px 10px",
    "border-radius: 6px",
    `background: ${theme.surface2}`,
    `color: ${theme.foreground}`,
    "font-size: 12px",
    "font-weight: 500",
    `border: 1px solid ${theme.border}`,
    "cursor: pointer",
    "flex-shrink: 0",
  ].join(";");

  const testBtn = doc.createElement("button");
  testBtn.type = "button";
  testBtn.setAttribute("data-testid", `${testId}-test-btn`);
  testBtn.textContent = copy.testBtn;
  testBtn.style.cssText = [
    "padding: 6px 10px",
    "border-radius: 6px",
    "background: transparent",
    `color: ${theme.foregroundMuted}`,
    "font-size: 12px",
    "font-weight: 500",
    `border: 1px solid ${theme.border}`,
    "cursor: pointer",
    "flex-shrink: 0",
  ].join(";");

  controlsRight.appendChild(modelInput);
  controlsRight.appendChild(applyBtn);
  controlsRight.appendChild(testBtn);
  mainRow.appendChild(labelEl);
  mainRow.appendChild(controlsRight);
  container.appendChild(mainRow);

  // Row 2: Subtle hairline divider + compact segmented preset pills (matches Paseo "Local | OpenAI" segmented style)
  const presetsRow = doc.createElement("div");
  presetsRow.style.cssText = [
    "display: flex",
    "flex-direction: row",
    "align-items: center",
    "justify-content: space-between",
    "gap: 8px",
    "flex-wrap: wrap",
    "padding-top: 8px",
    `border-top: 1px solid ${theme.borderAccent}`,
  ].join(";");

  const presetsLabel = doc.createElement("div");
  presetsLabel.textContent = copy.presetsLabel;
  presetsLabel.style.cssText = `font-size: 12px; font-weight: 400; color: ${theme.foregroundMuted}; flex-shrink: 0;`;

  const chipsGroup = doc.createElement("div");
  chipsGroup.style.cssText =
    "display: flex; flex-direction: row; flex-wrap: wrap; gap: 4px; justify-content: flex-end; flex: 1;";

  let activeModelValue = "";
  const presetButtons = new Map<string, HTMLButtonElement>();

  const updateChipHighlight = (modelId: string) => {
    activeModelValue = modelId;
    for (const preset of VOICE_STT_PRESETS) {
      const btn = presetButtons.get(preset.id);
      if (!btn) continue;
      const isSelected = preset.model.toLowerCase() === modelId.trim().toLowerCase();
      btn.style.background = isSelected ? theme.surface2 : "transparent";
      btn.style.borderColor = isSelected ? theme.border : "transparent";
      btn.style.color = isSelected ? theme.foreground : theme.foregroundMuted;
      btn.style.fontWeight = isSelected ? "500" : "400";
    }
  };

  // Compact 1-line inline receipt (hidden until user clicks Apply or Test)
  const receiptBox = doc.createElement("div");
  receiptBox.setAttribute("data-testid", `${testId}-receipt`);
  receiptBox.style.cssText = [
    "display: none",
    "padding-top: 6px",
    `border-top: 1px solid ${theme.borderAccent}`,
    "font-size: 11.5px",
    `color: ${theme.foregroundMuted}`,
    "line-height: 1.35",
  ].join(";");

  const showReceipt = (text: string, isError = false) => {
    receiptBox.style.display = "block";
    receiptBox.style.color = isError ? theme.statusDanger : theme.statusSuccess;
    receiptBox.textContent = text;
  };

  const syncSheetNativeInputs = (baseUrl: string) => {
    const baseUrlInput = doc.querySelector<HTMLInputElement>(
      '[data-testid="voice-base-url-input"]',
    );
    if (baseUrlInput && baseUrl) {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      if (nativeSetter) {
        nativeSetter.call(baseUrlInput, baseUrl);
        baseUrlInput.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        baseUrlInput.value = baseUrl;
      }
    }
  };

  const triggerApply = async (opts: { preset?: VoiceSttPreset; customModel?: string }) => {
    const modelToApply = (opts.preset?.model ?? opts.customModel ?? modelInput.value).trim();
    if (!modelToApply) return;
    modelInput.value = modelToApply;
    updateChipHighlight(modelToApply);
    applyBtn.disabled = true;
    applyBtn.textContent = copy.applyingBtn;
    try {
      const res = await client.call(manageVoiceSttRpc, {
        action: "apply",
        presetId: opts.preset?.id,
        model: modelToApply,
        source: "voice-sheet",
      });
      syncSheetNativeInputs(res.dictationStt.baseUrl);
      showReceipt(
        `${copy.appliedSuccessPrefix}: ${res.dictationStt.model} (${res.dictationStt.sourceBadge})`,
        !res.ok,
      );
    } catch (err) {
      showReceipt(err instanceof Error ? err.message : String(err), true);
    } finally {
      applyBtn.disabled = false;
      applyBtn.textContent = copy.applyBtn;
    }
  };

  const triggerTest = async () => {
    const modelToTest =
      modelInput.value.trim() || activeModelValue || "FunAudioLLM/SenseVoiceSmall";
    testBtn.disabled = true;
    testBtn.textContent = copy.testingBtn;
    try {
      const res = await client.call(manageVoiceSttRpc, {
        action: "test",
        model: modelToTest,
        source: "voice-sheet",
      });
      if (res.testResult?.ok) {
        showReceipt(
          `${copy.testOkPrefix} (${res.testResult.latencyMs}ms): "${res.testResult.transcript}"`,
          false,
        );
      } else {
        showReceipt(
          `${copy.testFailPrefix}: ${res.testResult?.error ?? res.message}`,
          true,
        );
      }
    } catch (err) {
      showReceipt(err instanceof Error ? err.message : String(err), true);
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = copy.testBtn;
    }
  };

  for (const preset of VOICE_STT_PRESETS) {
    const chip = doc.createElement("button");
    chip.type = "button";
    chip.setAttribute("data-testid", `${testId}-preset-${preset.id}`);
    chip.textContent = getShortPresetName(preset, zh);
    chip.title = zh ? preset.descriptionZh : preset.description;
    chip.style.cssText = [
      "padding: 4px 8px",
      "border-radius: 6px",
      "font-size: 11.5px",
      "font-weight: 400",
      "background: transparent",
      "border: 1px solid transparent",
      `color: ${theme.foregroundMuted}`,
      "cursor: pointer",
      "transition: background 0.12s ease, color 0.12s ease",
    ].join(";");
    chip.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      void triggerApply({ preset });
    });
    presetButtons.set(preset.id, chip);
    chipsGroup.appendChild(chip);
  }

  presetsRow.appendChild(presetsLabel);
  presetsRow.appendChild(chipsGroup);
  container.appendChild(presetsRow);
  container.appendChild(receiptBox);

  applyBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    void triggerApply({ customModel: modelInput.value });
  });

  modelInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      ev.stopPropagation();
      void triggerApply({ customModel: modelInput.value });
    }
  });

  testBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    void triggerTest();
  });

  void client
    .call(manageVoiceSttRpc, { action: "inspect" })
    .then((snap) => {
      modelInput.value = snap.dictationStt.model;
      updateChipHighlight(snap.dictationStt.model);
    })
    .catch(() => {});

  return container;
}

export function injectVoiceSttEnhancersIntoDom(
  doc: Document,
  client: VoiceSttWebClient,
): number {
  const prefs = readVoiceCustomModelPreferences();
  if (!prefs.enabled) return 0;

  // Remove any legacy duplicate card from the background Voice settings page
  doc
    .querySelectorAll('[data-testid="paseo-finder-voice-settings-card"]')
    .forEach((el) => el.remove());

  let injected = 0;

  // Single-surface exclusive injection: only inside the active Speech-to-text modal sheet
  const sheet = doc.querySelector<HTMLElement>('[data-testid="voice-provider-sheet"]');
  if (sheet && !sheet.querySelector('[data-testid="paseo-finder-voice-stt-sheet-enhancer"]')) {
    const isSttSheet = Boolean(
      sheet.querySelector('[data-testid="voice-language-select"]') ||
        (sheet.textContent ?? "").toLowerCase().includes("speech-to-text") ||
        (sheet.textContent ?? "").includes("语音转文字"),
    );
    if (isSttSheet) {
      const card = buildNativeVoiceSheetRows(
        doc,
        client,
        "paseo-finder-voice-stt-sheet-enhancer",
      );
      const saveBtn = sheet.querySelector('[data-testid="voice-provider-save"]');
      const footerRow = saveBtn?.parentElement;
      if (footerRow?.parentElement) {
        footerRow.parentElement.insertBefore(card, footerRow);
      } else {
        sheet.appendChild(card);
      }
      injected += 1;
    }
  }

  return injected;
}

export function installDesktopVoiceSttEnhancer(
  client: VoiceSttWebClient,
  docOverride?: Document | null,
): () => void {
  const doc = docOverride ?? (typeof document !== "undefined" ? document : null);
  if (!doc || !doc.body) return () => {};

  let rafId: number | null = null;
  let observer: MutationObserver | null = null;
  const runInjectPass = () => {
    const injected = injectVoiceSttEnhancersIntoDom(doc, client);
    if (injected > 0) {
      observer?.takeRecords();
    }
  };
  const schedulePass = () => {
    if (rafId !== null) return;
    if (typeof requestAnimationFrame === "function") {
      rafId = requestAnimationFrame(() => {
        rafId = null;
        runInjectPass();
      });
    } else {
      runInjectPass();
    }
  };

  runInjectPass();

  observer =
    typeof MutationObserver !== "undefined"
      ? new MutationObserver(() => {
          schedulePass();
        })
      : null;

  observer?.observe(doc.body, { childList: true, subtree: true });

  return () => {
    if (rafId !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(rafId);
    }
    observer?.disconnect();
    doc
      .querySelectorAll(
        '[data-testid="paseo-finder-voice-stt-sheet-enhancer"], [data-testid="paseo-finder-voice-settings-card"]',
      )
      .forEach((el) => el.remove());
  };
}
