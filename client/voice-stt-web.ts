/// <reference lib="dom" />
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import {
  VOICE_STT_PRESETS,
  type VoiceSttPreset,
  manageVoiceSttRpc,
} from "../shared/contracts";
import { isChineseLocale } from "./i18n";

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
  panelTitle: string;
  panelSubtitle: string;
  activeModelPrefix: string;
  gatewayOnlineBadge: string;
  gatewayOfflineBadge: string;
  customModelPlaceholder: string;
  applyBtn: string;
  applyingBtn: string;
  testBtn: string;
  testingBtn: string;
  resetBtn: string;
  routeGatewayHint: string;
  appliedSuccessPrefix: string;
  testOkPrefix: string;
  testFailPrefix: string;
}

const COPY_EN: VoiceCopy = {
  panelTitle: "Custom STT Models & SiliconFlow Presets",
  panelSubtitle:
    "Unlock SiliconFlow free ASR (SenseVoiceSmall, TeleSpeechASR), OpenWhispr Qwen3-ASR-1.7B, Gemini 6-Key Pool, or any custom model ID.",
  activeModelPrefix: "Active STT:",
  gatewayOnlineBadge: "Audio Pool :8787 Ready",
  gatewayOfflineBadge: "Direct API Mode",
  customModelPlaceholder:
    "Enter any custom STT model ID (e.g. FunAudioLLM/SenseVoiceSmall or Qwen/Qwen3-ASR-1.7B)...",
  applyBtn: "Apply Custom Model",
  applyingBtn: "Applying...",
  testBtn: "Test STT",
  testingBtn: "Testing...",
  resetBtn: "Reset Default",
  routeGatewayHint:
    "Auto-routes SiliconFlow & Gemini models via local Audio Pool Gateway (:8787) to fix Paseo chunked stream uploads and enable 6-key failover.",
  appliedSuccessPrefix: "Applied STT model:",
  testOkPrefix: "STT Probe OK",
  testFailPrefix: "STT Probe Error",
};

const COPY_ZH: VoiceCopy = {
  panelTitle: "自定义语音模型与硅基流动免费预设",
  panelSubtitle:
    "一键启用硅基流动免费语音模型 (SenseVoiceSmall / TeleSpeechASR)、OpenWhispr 同款 Qwen3-ASR-1.7B、Gemini 6-Key 轮询池，或输入任意自定义模型 ID。",
  activeModelPrefix: "当前生效模型：",
  gatewayOnlineBadge: "本地语音网关 :8787 就绪",
  gatewayOfflineBadge: "直连 API 模式",
  customModelPlaceholder:
    "输入任意自定义语音模型 ID（如 FunAudioLLM/SenseVoiceSmall 或 Qwen/Qwen3-ASR-1.7B）...",
  applyBtn: "应用此模型",
  applyingBtn: "应用中...",
  testBtn: "测试转录",
  testingBtn: "测试中...",
  resetBtn: "恢复默认",
  routeGatewayHint:
    "自动通过本地语音池网关 (:8787) 转发硅基流动请求，修复桌面端分块流式上传报错并附带 6-Key 自动容灾。",
  appliedSuccessPrefix: "已切换语音模型：",
  testOkPrefix: "转录实测通过",
  testFailPrefix: "转录测试失败",
};

function getCopy(locale?: string | null): { copy: VoiceCopy; zh: boolean } {
  const zh = isChineseLocale(locale ?? (typeof navigator !== "undefined" ? navigator.language : "en"));
  return { copy: zh ? COPY_ZH : COPY_EN, zh };
}

function buildVoiceEnhancerCard(
  doc: Document,
  client: VoiceSttWebClient,
  surface: "sheet" | "settings-page",
  testId: string,
): HTMLElement {
  const { copy, zh } = getCopy(client.getLocale?.());
  const container = doc.createElement("div");
  container.setAttribute("data-testid", testId);
  container.style.cssText = [
    "margin-top: 12px",
    "margin-bottom: 8px",
    "padding: 12px 14px",
    "border-radius: 10px",
    "background: rgba(16, 185, 129, 0.06)",
    "border: 1px solid rgba(16, 185, 129, 0.28)",
    "display: flex",
    "flex-direction: column",
    "gap: 10px",
    "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, sans-serif",
  ].join(";");

  // 1. Header Row
  const headerRow = doc.createElement("div");
  headerRow.style.cssText =
    "display: flex; flex-direction: row; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;";

  const titleEl = doc.createElement("div");
  titleEl.textContent = copy.panelTitle;
  titleEl.style.cssText = "font-size: 12.5px; font-weight: 600; color: #10b981;";

  const statusBadge = doc.createElement("div");
  statusBadge.setAttribute("data-testid", `${testId}-status-badge`);
  statusBadge.textContent = copy.gatewayOnlineBadge;
  statusBadge.style.cssText = [
    "font-size: 11px",
    "font-weight: 500",
    "padding: 2px 8px",
    "border-radius: 999px",
    "background: rgba(16, 185, 129, 0.14)",
    "color: #34d399",
    "border: 1px solid rgba(16, 185, 129, 0.3)",
  ].join(";");

  headerRow.appendChild(titleEl);
  headerRow.appendChild(statusBadge);
  container.appendChild(headerRow);

  // 2. Subtitle
  const subEl = doc.createElement("div");
  subEl.textContent = copy.panelSubtitle;
  subEl.style.cssText = "font-size: 11.5px; color: #9ca3af; line-height: 1.4;";
  container.appendChild(subEl);

  // 3. Preset Chips Row
  const chipsRow = doc.createElement("div");
  chipsRow.style.cssText = "display: flex; flex-direction: row; flex-wrap: wrap; gap: 6px;";

  let activeModelValue = "";
  const presetButtons = new Map<string, HTMLButtonElement>();

  const updateChipHighlight = (modelId: string) => {
    activeModelValue = modelId;
    for (const preset of VOICE_STT_PRESETS) {
      const btn = presetButtons.get(preset.id);
      if (!btn) continue;
      const isSelected = preset.model.toLowerCase() === modelId.trim().toLowerCase();
      btn.style.background = isSelected ? "rgba(16, 185, 129, 0.22)" : "rgba(24, 28, 27, 0.85)";
      btn.style.borderColor = isSelected ? "#10b981" : "rgba(255, 255, 255, 0.12)";
      btn.style.color = isSelected ? "#ecfdf5" : "#d1d5db";
    }
  };

  // 4. Custom Model Input + Action Buttons Row
  const inputRow = doc.createElement("div");
  inputRow.style.cssText =
    "display: flex; flex-direction: row; align-items: center; gap: 6px; flex-wrap: wrap;";

  const modelInput = doc.createElement("input");
  modelInput.type = "text";
  modelInput.setAttribute("data-testid", `${testId}-model-input`);
  modelInput.placeholder = copy.customModelPlaceholder;
  modelInput.style.cssText = [
    "flex: 1",
    "min-width: 210px",
    "padding: 6px 10px",
    "border-radius: 6px",
    "background: rgba(12, 15, 14, 0.9)",
    "border: 1px solid rgba(255, 255, 255, 0.16)",
    "color: #f3f4f6",
    "font-size: 12px",
    "font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    "outline: none",
  ].join(";");

  const applyBtn = doc.createElement("button");
  applyBtn.type = "button";
  applyBtn.setAttribute("data-testid", `${testId}-apply-btn`);
  applyBtn.textContent = copy.applyBtn;
  applyBtn.style.cssText = [
    "padding: 6px 12px",
    "border-radius: 6px",
    "background: #10b981",
    "color: #052e16",
    "font-size: 12px",
    "font-weight: 600",
    "border: none",
    "cursor: pointer",
  ].join(";");

  const testBtn = doc.createElement("button");
  testBtn.type = "button";
  testBtn.setAttribute("data-testid", `${testId}-test-btn`);
  testBtn.textContent = copy.testBtn;
  testBtn.style.cssText = [
    "padding: 6px 10px",
    "border-radius: 6px",
    "background: rgba(31, 36, 35, 0.9)",
    "color: #e5e7eb",
    "font-size: 12px",
    "font-weight: 500",
    "border: 1px solid rgba(255, 255, 255, 0.14)",
    "cursor: pointer",
  ].join(";");

  // Receipt line
  const receiptBox = doc.createElement("div");
  receiptBox.setAttribute("data-testid", `${testId}-receipt`);
  receiptBox.style.cssText = [
    "display: none",
    "padding: 7px 10px",
    "border-radius: 6px",
    "background: rgba(10, 13, 12, 0.85)",
    "border: 1px solid rgba(255, 255, 255, 0.1)",
    "font-size: 11.5px",
    "color: #d1d5db",
    "font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    "line-height: 1.4",
  ].join(";");

  const showReceipt = (text: string, isError = false) => {
    receiptBox.style.display = "block";
    receiptBox.style.borderColor = isError
      ? "rgba(239, 68, 68, 0.5)"
      : "rgba(16, 185, 129, 0.45)";
    receiptBox.style.color = isError ? "#fca5a5" : "#a7f3d0";
    receiptBox.textContent = text;
  };

  // Sync with Paseo's modal inputs when inside SpeechProviderSheet
  const syncSheetNativeInputs = (baseUrl: string) => {
    if (surface !== "sheet") return;
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
        source: surface === "sheet" ? "voice-sheet" : "settings-ui",
      });
      statusBadge.textContent = `${copy.activeModelPrefix} ${res.dictationStt.model} (${res.dictationStt.sourceBadge})`;
      syncSheetNativeInputs(res.dictationStt.baseUrl);
      showReceipt(
        `✓ ${copy.appliedSuccessPrefix} ${res.dictationStt.model} · Base URL: ${res.dictationStt.baseUrl || "local"}`,
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
    const modelToTest = modelInput.value.trim() || activeModelValue || "FunAudioLLM/SenseVoiceSmall";
    testBtn.disabled = true;
    testBtn.textContent = copy.testingBtn;
    try {
      const res = await client.call(manageVoiceSttRpc, {
        action: "test",
        model: modelToTest,
        source: surface === "sheet" ? "voice-sheet" : "settings-ui",
      });
      if (res.testResult?.ok) {
        showReceipt(
          `✓ ${copy.testOkPrefix} [${res.testResult.provider} · ${res.testResult.model}] ${res.testResult.latencyMs}ms — "${res.testResult.transcript}"`,
          false,
        );
      } else {
        showReceipt(
          `✗ ${copy.testFailPrefix}: ${res.testResult?.error ?? res.message}`,
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
    const labelText = zh ? preset.labelZh : preset.label;
    chip.textContent = `${labelText} (${preset.badge})`;
    chip.title = zh ? preset.descriptionZh : preset.description;
    chip.style.cssText = [
      "padding: 5px 9px",
      "border-radius: 999px",
      "font-size: 11.5px",
      "font-weight: 500",
      "background: rgba(24, 28, 27, 0.85)",
      "border: 1px solid rgba(255, 255, 255, 0.12)",
      "color: #d1d5db",
      "cursor: pointer",
      "transition: all 0.12s ease",
    ].join(";");
    chip.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      void triggerApply({ preset });
    });
    presetButtons.set(preset.id, chip);
    chipsRow.appendChild(chip);
  }

  container.appendChild(chipsRow);

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

  inputRow.appendChild(modelInput);
  inputRow.appendChild(applyBtn);
  inputRow.appendChild(testBtn);
  container.appendChild(inputRow);
  container.appendChild(receiptBox);

  // Initial inspect to populate current state
  void client
    .call(manageVoiceSttRpc, { action: "inspect" })
    .then((snap) => {
      modelInput.value = snap.dictationStt.model;
      updateChipHighlight(snap.dictationStt.model);
      const gwTag = snap.gateway.reachable
        ? `${copy.gatewayOnlineBadge} (${snap.gateway.healthyKeys}/${snap.gateway.totalKeys})`
        : copy.gatewayOfflineBadge;
      statusBadge.textContent = `${copy.activeModelPrefix} ${snap.dictationStt.model} · ${gwTag}`;
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

  let injected = 0;

  // 1. Inside Speech-to-text modal (`[data-testid="voice-provider-sheet"]`)
  const sheet = doc.querySelector<HTMLElement>('[data-testid="voice-provider-sheet"]');
  if (sheet && !sheet.querySelector('[data-testid="paseo-finder-voice-stt-sheet-enhancer"]')) {
    const isSttSheet = Boolean(
      sheet.querySelector('[data-testid="voice-language-select"]') ||
        (sheet.textContent ?? "").toLowerCase().includes("speech-to-text") ||
        (sheet.textContent ?? "").includes("语音转文字"),
    );
    if (isSttSheet) {
      const card = buildVoiceEnhancerCard(
        doc,
        client,
        "sheet",
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

  // 2. Inside Settings -> Voice page (`[data-testid="voice-settings"]`)
  const voiceSettings = doc.querySelector<HTMLElement>('[data-testid="voice-settings"]');
  if (
    voiceSettings &&
    !voiceSettings.querySelector('[data-testid="paseo-finder-voice-settings-card"]')
  ) {
    const card = buildVoiceEnhancerCard(
      doc,
      client,
      "settings-page",
      "paseo-finder-voice-settings-card",
    );
    voiceSettings.appendChild(card);
    injected += 1;
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
  const schedulePass = () => {
    if (rafId !== null) return;
    if (typeof requestAnimationFrame === "function") {
      rafId = requestAnimationFrame(() => {
        rafId = null;
        injectVoiceSttEnhancersIntoDom(doc, client);
      });
    } else {
      injectVoiceSttEnhancersIntoDom(doc, client);
    }
  };

  injectVoiceSttEnhancersIntoDom(doc, client);

  const observer =
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
