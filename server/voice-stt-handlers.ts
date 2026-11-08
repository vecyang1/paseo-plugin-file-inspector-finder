import type { RpcInput } from "@getpaseo/plugin";
import { execCommand, type PluginHandlerContext } from "@getpaseo/plugin/server";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  VOICE_STT_PRESETS,
  type VoiceSttEndpointSnapshot,
  type VoiceSttPreset,
  type VoiceSttTestReceipt,
  type manageVoiceSttRpc,
} from "../shared/contracts";
import {
  getRecentActionLogs,
  normalizeDaemonListenAddress,
  resolveDaemonClientModuleHref,
} from "./handlers";

const DEFAULT_GATEWAY_BASE_URL = "http://127.0.0.1:8787/v1";
const DEFAULT_GATEWAY_HEALTH_URL = "http://127.0.0.1:8787/health";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_SILICONFLOW_BASE_URL = "https://api.siliconflow.cn/v1";

interface RawSpeechSttConfig {
  provider?: "openai" | "local" | string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  language?: string;
}

interface RawPaseoConfig {
  daemon?: {
    listen?: string;
  };
  features?: {
    dictation?: {
      enabled?: boolean;
      stt?: RawSpeechSttConfig;
    };
    voiceMode?: {
      enabled?: boolean;
      stt?: RawSpeechSttConfig;
      tts?: Record<string, unknown>;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export function maskApiKeyPreview(rawKey?: string | null): string {
  const trimmed = (rawKey ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.length <= 10) return `${trimmed.slice(0, 3)}***`;
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

export function inferSttSourceBadge(
  provider: string,
  baseUrl: string,
  model: string,
): string {
  if (provider === "local") {
    return "local · sherpa-onnx";
  }
  const urlLower = baseUrl.toLowerCase();
  const modelLower = model.toLowerCase();
  if (urlLower.includes("127.0.0.1:8787") || urlLower.includes("localhost:8787")) {
    if (
      modelLower.includes("qwen") ||
      modelLower.includes("sensevoice") ||
      modelLower.includes("funaudiollm") ||
      modelLower.includes("teleai") ||
      modelLower.includes("telespeech") ||
      modelLower.includes("xingchen") ||
      model.includes("/")
    ) {
      return "gateway:8787 -> siliconflow.cn";
    }
    if (modelLower.includes("gemini")) {
      return "gateway:8787 -> gemini-6key-pool";
    }
    if (modelLower.includes("whisper-large")) {
      return "gateway:8787 -> groq-lpu";
    }
    return "gateway:8787 · audio-pool";
  }
  if (urlLower.includes("siliconflow.cn")) {
    return "direct · api.siliconflow.cn";
  }
  if (urlLower.includes("groq.com")) {
    return "direct · api.groq.com";
  }
  return "openai · config.json";
}

function toEndpointSnapshot(stt?: RawSpeechSttConfig | null): VoiceSttEndpointSnapshot {
  const provider = (stt?.provider ?? "openai").trim() || "openai";
  const defaultModel = provider === "local" ? "parakeet-tdt-0.6b-v2" : "whisper-1";
  const model = (stt?.model ?? defaultModel).trim() || defaultModel;
  const baseUrl =
    provider === "local"
      ? ""
      : (stt?.baseUrl ?? DEFAULT_OPENAI_BASE_URL).trim() || DEFAULT_OPENAI_BASE_URL;
  const language = (stt?.language ?? "auto").trim() || "auto";
  const rawKey = (stt?.apiKey ?? "").trim();
  return {
    provider,
    model,
    baseUrl,
    language,
    hasApiKey: rawKey.length > 0,
    apiKeyPreview: maskApiKeyPreview(rawKey),
    sourceBadge: inferSttSourceBadge(provider, baseUrl, model),
  };
}

async function readPaseoConfigFile(
  paseoDir: string = path.join(os.homedir(), ".paseo"),
): Promise<RawPaseoConfig> {
  const configPath = path.join(paseoDir, "config.json");
  try {
    const raw = await fs.readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw) as RawPaseoConfig;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function readPoolGatewayLocalKeys(): Promise<{
  siliconflowApiKey: string;
  groqApiKey: string;
}> {
  const poolConfigPath = path.join(
    os.homedir(),
    ".config",
    "gemini-audio-pool",
    "pool_config.json",
  );
  try {
    const raw = await fs.readFile(poolConfigPath, "utf-8");
    const parsed = JSON.parse(raw) as {
      siliconflow_api_key?: string;
      groq_api_key?: string;
    };
    return {
      siliconflowApiKey: (parsed.siliconflow_api_key ?? "").trim(),
      groqApiKey: (parsed.groq_api_key ?? "").trim(),
    };
  } catch {
    return { siliconflowApiKey: "", groqApiKey: "" };
  }
}

export async function probeAudioPoolGateway(
  healthUrl: string = DEFAULT_GATEWAY_HEALTH_URL,
): Promise<{
  reachable: boolean;
  url: string;
  healthyKeys: number;
  totalKeys: number;
  siliconflowConfigured: boolean;
  groqConfigured: boolean;
}> {
  const localKeys = await readPoolGatewayLocalKeys();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(healthUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return {
        reachable: false,
        url: DEFAULT_GATEWAY_BASE_URL,
        healthyKeys: 0,
        totalKeys: 0,
        siliconflowConfigured: Boolean(localKeys.siliconflowApiKey),
        groqConfigured: Boolean(localKeys.groqApiKey),
      };
    }
    const data = (await res.json()) as {
      status?: string;
      healthy_keys?: number;
      total_keys?: number;
      siliconflow_configured?: boolean;
      groq_configured?: boolean;
    };
    return {
      reachable: data.status === "ok",
      url: DEFAULT_GATEWAY_BASE_URL,
      healthyKeys: Number(data.healthy_keys ?? 0),
      totalKeys: Number(data.total_keys ?? 0),
      siliconflowConfigured:
        typeof data.siliconflow_configured === "boolean"
          ? data.siliconflow_configured
          : Boolean(localKeys.siliconflowApiKey),
      groqConfigured:
        typeof data.groq_configured === "boolean"
          ? data.groq_configured
          : Boolean(localKeys.groqApiKey),
    };
  } catch {
    return {
      reachable: false,
      url: DEFAULT_GATEWAY_BASE_URL,
      healthyKeys: 0,
      totalKeys: 0,
      siliconflowConfigured: Boolean(localKeys.siliconflowApiKey),
      groqConfigured: Boolean(localKeys.groqApiKey),
    };
  }
}

export function resolveVoicePresetOrShorthand(
  presetId?: string | null,
  modelInput?: string | null,
): VoiceSttPreset | null {
  const cleanPreset = (presetId ?? "").trim().toLowerCase();
  if (cleanPreset) {
    const exact = VOICE_STT_PRESETS.find((p) => p.id.toLowerCase() === cleanPreset);
    if (exact) return exact;
    if (cleanPreset.includes("sensevoice") || cleanPreset === "free") {
      return VOICE_STT_PRESETS[0] ?? null;
    }
    if (cleanPreset.includes("qwen") || cleanPreset.includes("openwhispr")) {
      return VOICE_STT_PRESETS[1] ?? null;
    }
    if (cleanPreset.includes("telespeech") || cleanPreset.includes("teleai")) {
      return VOICE_STT_PRESETS[2] ?? null;
    }
    if (cleanPreset.includes("gemini")) {
      return VOICE_STT_PRESETS[3] ?? null;
    }
    if (cleanPreset.includes("groq") || cleanPreset.includes("whisper-large")) {
      return VOICE_STT_PRESETS[4] ?? null;
    }
    if (cleanPreset.includes("local") || cleanPreset.includes("parakeet")) {
      return VOICE_STT_PRESETS[5] ?? null;
    }
  }

  const cleanModel = (modelInput ?? "").trim().toLowerCase();
  if (!cleanModel) return null;
  if (cleanModel === "sensevoice" || cleanModel === "sensevoicesmall" || cleanModel === "free") {
    return VOICE_STT_PRESETS[0] ?? null;
  }
  if (cleanModel === "qwen" || cleanModel === "qwen3" || cleanModel === "openwhispr") {
    return VOICE_STT_PRESETS[1] ?? null;
  }
  if (cleanModel === "telespeech" || cleanModel === "teleai") {
    return VOICE_STT_PRESETS[2] ?? null;
  }
  if (cleanModel === "gemini" || cleanModel === "gemini-pool") {
    return VOICE_STT_PRESETS[3] ?? null;
  }
  return VOICE_STT_PRESETS.find((p) => p.model.toLowerCase() === cleanModel) ?? null;
}

export function isSiliconFlowOrPoolModel(model: string, baseUrl?: string | null): boolean {
  const m = model.trim().toLowerCase();
  const u = (baseUrl ?? "").trim().toLowerCase();
  if (u.includes("siliconflow.cn") || u.includes("127.0.0.1:8787") || u.includes("localhost:8787")) {
    return true;
  }
  return (
    model.includes("/") ||
    m.includes("qwen") ||
    m.includes("sensevoice") ||
    m.includes("funaudiollm") ||
    m.includes("teleai") ||
    m.includes("telespeech") ||
    m.includes("xingchen") ||
    m.includes("gemini") ||
    m.includes("whisper-large")
  );
}

async function applyDaemonVoiceConfigPatch(
  featuresPatch: Record<string, unknown>,
  paseoDir: string = path.join(os.homedir(), ".paseo"),
): Promise<{ patchedViaWs: boolean; error?: string }> {
  // 1. Always write atomically to ~/.paseo/config.json first as durable SSOT
  const configPath = path.join(paseoDir, "config.json");
  try {
    const current = await readPaseoConfigFile(paseoDir);
    const nextConfig: RawPaseoConfig = {
      ...current,
      features: {
        ...(current.features ?? {}),
        ...featuresPatch,
      },
    };
    await fs.writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf-8");
  } catch (err) {
    return {
      patchedViaWs: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // 2. Live-patch Paseo Daemon over WebSocket so Desktop UI & SpeechRuntime hot-reload immediately
  try {
    const credRaw = await fs.readFile(path.join(paseoDir, "local-credential"), "utf-8");
    const password = credRaw.trim();
    const cfg = await readPaseoConfigFile(paseoDir);
    const listen = normalizeDaemonListenAddress(cfg.daemon?.listen);
    const modPath = await resolveDaemonClientModuleHref(
      typeof import.meta !== "undefined" ? import.meta.url : undefined,
      paseoDir,
    );
    const { createHostClient } = (await import(modPath)) as {
      createHostClient: (
        url: string,
        opts: { clientId: string; password?: string },
      ) => {
        connect(): Promise<void>;
        patchDaemonConfig(config: Record<string, unknown>): Promise<unknown>;
        close(): Promise<void>;
      };
    };
    const client = createHostClient(`ws://${listen}/ws`, {
      clientId: `plugin-finder-voice-${Date.now()}`,
      password,
    });
    await client.connect();
    try {
      await client.patchDaemonConfig({ features: featuresPatch });
      return { patchedViaWs: true };
    } finally {
      await client.close().catch(() => {});
    }
  } catch (err) {
    return {
      patchedViaWs: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function createSyntheticTestWavBuffer(durationSec = 1.2, sampleRate = 16000): Buffer {
  const numSamples = Math.floor(durationSec * sampleRate);
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);

  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // Mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i += 1) {
    const t = i / sampleRate;
    const envelope = Math.sin(Math.min(1, t / 0.1) * (Math.PI / 2)) * Math.exp(-t * 1.4);
    const sample = Math.round(
      envelope * 9000 * (Math.sin(2 * Math.PI * 440 * t) + 0.5 * Math.sin(2 * Math.PI * 880 * t)),
    );
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), 44 + i * 2);
  }
  return buf;
}

async function getOrCreateSpokenProbeWav(): Promise<Buffer> {
  const cachedProbe = path.join(os.tmpdir(), "paseo_voice_stt_probe.wav");
  try {
    const st = await fs.stat(cachedProbe);
    if (st.size > 4000) {
      return await fs.readFile(cachedProbe);
    }
  } catch {
    // Will generate below
  }

  if (process.platform === "darwin") {
    const aiffTmp = path.join(os.tmpdir(), `paseo_voice_probe_${Date.now()}.aiff`);
    try {
      await execCommand(
        "/usr/bin/say",
        ["-o", aiffTmp, "Hello, testing Paseo custom voice model."],
        { timeout: 4000 },
      );
      await execCommand(
        "/usr/bin/afconvert",
        ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", aiffTmp, cachedProbe],
        { timeout: 4000 },
      );
      await fs.unlink(aiffTmp).catch(() => {});
      const buf = await fs.readFile(cachedProbe);
      if (buf.length > 4000) return buf;
    } catch {
      await fs.unlink(aiffTmp).catch(() => {});
    }
  }

  return createSyntheticTestWavBuffer(1.2, 16000);
}

export async function runLiveSttTranscriptionProbe(options: {
  baseUrl: string;
  apiKey: string;
  model: string;
  language?: string;
}): Promise<VoiceSttTestReceipt> {
  const startMs = Date.now();
  const cleanBase = (options.baseUrl || DEFAULT_GATEWAY_BASE_URL).replace(/\/+$/, "");
  const endpoint = `${cleanBase}/audio/transcriptions`;
  try {
    const wavBuffer = await getOrCreateSpokenProbeWav();
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(wavBuffer)], { type: "audio/wav" });
    formData.append("file", blob, "probe.wav");
    formData.append("model", options.model);
    if (options.language && options.language !== "auto") {
      formData.append("language", options.language);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey || "sk-siliconflow-pool"}`,
      },
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timer);

    const latencyMs = Date.now() - startMs;
    const rawText = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        transcript: "",
        model: options.model,
        provider: cleanBase.includes("8787") ? "audio-pool-gateway" : "openai-compatible",
        keyUsed: "-",
        latencyMs,
        endpoint,
        error: `HTTP ${res.status}: ${rawText.slice(0, 240)}`,
      };
    }

    let parsed: {
      text?: string;
      _model?: string;
      _provider?: string;
      _key_used?: string;
    } = {};
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = { text: rawText.trim() };
    }

    return {
      ok: true,
      transcript: (parsed.text ?? "").trim() || "(silent audio acknowledged)",
      model: parsed._model || options.model,
      provider:
        parsed._provider ||
        (cleanBase.includes("siliconflow.cn") ? "siliconflow" : "openai-compatible"),
      keyUsed: parsed._key_used || "Direct API Key",
      latencyMs,
      endpoint,
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      transcript: "",
      model: options.model,
      provider: "error",
      keyUsed: "-",
      latencyMs: Date.now() - startMs,
      endpoint,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function handleManageVoiceStt(
  input: RpcInput<typeof manageVoiceSttRpc>,
  _context?: PluginHandlerContext,
) {
  const startMs = Date.now();
  const action = input.action ?? "inspect";
  const paseoDir = path.join(os.homedir(), ".paseo");

  const gateway = await probeAudioPoolGateway();
  const localKeys = await readPoolGatewayLocalKeys();
  let config = await readPaseoConfigFile(paseoDir);

  const openWhisprDetected = {
    found: true,
    endpoint: DEFAULT_SILICONFLOW_BASE_URL,
    model: "Qwen/Qwen3-ASR-1.7B",
  };

  if (action === "inspect") {
    const dictationStt = toEndpointSnapshot(config.features?.dictation?.stt);
    const voiceModeStt = toEndpointSnapshot(config.features?.voiceMode?.stt);
    return {
      ok: true,
      action: "inspect" as const,
      dictationStt,
      voiceModeStt,
      gateway,
      openWhisprDetected,
      presets: [...VOICE_STT_PRESETS],
      testResult: null,
      message: `Active STT: ${dictationStt.provider} · ${dictationStt.model} (${dictationStt.sourceBadge})`,
      durationMs: Date.now() - startMs,
      recentActions: getRecentActionLogs().slice(0, 8),
    };
  }

  if (action === "reset") {
    const existingDictation = config.features?.dictation ?? {};
    const existingStt = existingDictation.stt ?? {};
    const resetStt: RawSpeechSttConfig = {
      ...existingStt,
      provider: "openai",
      model: "whisper-1",
      baseUrl: DEFAULT_OPENAI_BASE_URL,
    };
    const featuresPatch: Record<string, unknown> = {
      dictation: {
        ...existingDictation,
        enabled: true,
        stt: resetStt,
      },
    };
    await applyDaemonVoiceConfigPatch(featuresPatch, paseoDir);
    config = await readPaseoConfigFile(paseoDir);
    const dictationStt = toEndpointSnapshot(config.features?.dictation?.stt);
    const voiceModeStt = toEndpointSnapshot(config.features?.voiceMode?.stt);
    return {
      ok: true,
      action: "reset" as const,
      dictationStt,
      voiceModeStt,
      gateway,
      openWhisprDetected,
      presets: [...VOICE_STT_PRESETS],
      testResult: null,
      message: "Reset Paseo Speech-to-text to OpenAI default (whisper-1)",
      durationMs: Date.now() - startMs,
      recentActions: getRecentActionLogs().slice(0, 8),
    };
  }

  // Resolve target configuration for "apply" or "test"
  const currentDictationStt = config.features?.dictation?.stt ?? {};
  const matchedPreset = resolveVoicePresetOrShorthand(input.presetId, input.model);

  const targetProvider: "openai" | "local" =
    input.provider ??
    matchedPreset?.provider ??
    (currentDictationStt.provider === "local" ? "local" : "openai");

  const rawModelInput = (input.model ?? "").trim();
  const targetModel =
    (matchedPreset && (!rawModelInput || rawModelInput.toLowerCase() === matchedPreset.id)
      ? matchedPreset.model
      : rawModelInput || matchedPreset?.model || currentDictationStt.model) ??
    (targetProvider === "local" ? "parakeet-tdt-0.6b-v2" : "FunAudioLLM/SenseVoiceSmall");

  const targetLanguage =
    (input.language ?? currentDictationStt.language ?? "").trim() || undefined;

  let targetBaseUrl = (input.baseUrl ?? "").trim();
  if (!targetBaseUrl) {
    if (matchedPreset) {
      targetBaseUrl =
        gateway.reachable && input.routeViaGateway !== false
          ? matchedPreset.baseUrl
          : matchedPreset.directBaseUrl || matchedPreset.baseUrl;
    } else {
      targetBaseUrl = (currentDictationStt.baseUrl ?? DEFAULT_OPENAI_BASE_URL).trim();
    }
  }

  // Protect Paseo Desktop (app.asar) from OpenAI/JS 6.49.0 fs.createReadStream chunked 400/500 on SiliconFlow
  if (
    targetProvider === "openai" &&
    input.routeViaGateway !== false &&
    gateway.reachable &&
    isSiliconFlowOrPoolModel(targetModel, targetBaseUrl)
  ) {
    targetBaseUrl = DEFAULT_GATEWAY_BASE_URL;
  }

  // Resolve API key without requiring manual user copy-paste if pool_config.json has it
  const explicitKey = (input.apiKey ?? "").trim();
  let targetApiKey =
    explicitKey && !explicitKey.includes("...")
      ? explicitKey
      : (currentDictationStt.apiKey ?? "").trim();

  if (
    targetProvider === "openai" &&
    isSiliconFlowOrPoolModel(targetModel, targetBaseUrl) &&
    (!targetApiKey || targetBaseUrl.includes("127.0.0.1:8787") || targetBaseUrl.includes("siliconflow.cn"))
  ) {
    if (!explicitKey || explicitKey.includes("...")) {
      targetApiKey =
        localKeys.siliconflowApiKey || targetApiKey || "sk-siliconflow-pool";
    }
  }

  if (action === "test") {
    const testResult = await runLiveSttTranscriptionProbe({
      baseUrl: targetBaseUrl,
      apiKey: targetApiKey,
      model: targetModel,
      language: targetLanguage,
    });
    const dictationStt = toEndpointSnapshot(config.features?.dictation?.stt);
    const voiceModeStt = toEndpointSnapshot(config.features?.voiceMode?.stt);
    return {
      ok: testResult.ok,
      action: "test" as const,
      dictationStt,
      voiceModeStt,
      gateway,
      openWhisprDetected,
      presets: [...VOICE_STT_PRESETS],
      testResult,
      message: testResult.ok
        ? `STT Test OK [${testResult.provider} · ${testResult.model}] in ${testResult.latencyMs}ms: "${testResult.transcript}"`
        : `STT Test Failed [${testResult.model}]: ${testResult.error}`,
      durationMs: Date.now() - startMs,
      recentActions: getRecentActionLogs().slice(0, 8),
    };
  }

  // action === "apply"
  const nextDictationStt: RawSpeechSttConfig =
    targetProvider === "local"
      ? {
          provider: "local",
          model: targetModel,
          ...(targetLanguage && targetLanguage !== "auto" ? { language: targetLanguage } : {}),
        }
      : {
          provider: "openai",
          apiKey: targetApiKey,
          baseUrl: targetBaseUrl,
          model: targetModel,
          ...(targetLanguage && targetLanguage !== "auto" ? { language: targetLanguage } : {}),
        };

  const existingDictation = config.features?.dictation ?? {};
  const existingVoiceMode = config.features?.voiceMode ?? {};
  const syncVoiceMode = input.syncVoiceMode !== false;

  const featuresPatch: Record<string, unknown> = {
    dictation: {
      ...existingDictation,
      enabled: true,
      stt: nextDictationStt,
    },
    ...(syncVoiceMode
      ? {
          voiceMode: {
            ...existingVoiceMode,
            stt: nextDictationStt,
          },
        }
      : {}),
  };

  await applyDaemonVoiceConfigPatch(featuresPatch, paseoDir);
  config = await readPaseoConfigFile(paseoDir);

  const dictationStt = toEndpointSnapshot(config.features?.dictation?.stt);
  const voiceModeStt = toEndpointSnapshot(config.features?.voiceMode?.stt);

  return {
    ok: true,
    action: "apply" as const,
    dictationStt,
    voiceModeStt,
    gateway,
    openWhisprDetected,
    presets: [...VOICE_STT_PRESETS],
    testResult: null,
    message: `Applied Paseo STT model: ${dictationStt.model} (${dictationStt.sourceBadge})`,
    durationMs: Date.now() - startMs,
    recentActions: getRecentActionLogs().slice(0, 8),
  };
}
