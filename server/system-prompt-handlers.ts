import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { RpcInput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type {
  inspectSystemPromptRpc,
  SystemPromptSection,
} from "../shared/contracts.ts";

export function inspectPromptBoundary(raw: string): {
  boundaryOk: boolean;
  leakedAfterUserPromptChars: number;
} {
  if (!raw.trim()) return { boundaryOk: true, leakedAfterUserPromptChars: 0 };
  const m = /<user prompt>:\s*([\s\S]*)$/i.exec(raw);
  if (!m) return { boundaryOk: true, leakedAfterUserPromptChars: 0 };
  const after = (m[1] ?? "").trim();
  return {
    boundaryOk: after.length === 0,
    leakedAfterUserPromptChars: after.length,
  };
}

export function normalizePromptUserBoundary(raw: string): string {
  const markerRe = /\n*-{5,}\s*\n+<user prompt>:\s*|\n*<user prompt>:\s*/i;
  const m = markerRe.exec(raw);
  if (!m) return raw;
  const before = raw.slice(0, m.index).trimEnd();
  const after = raw.slice(m.index + m[0].length).trim();
  if (!after) return raw;
  const combined = before ? `${before}\n\n${after}` : after;
  return `${combined}\n-----------------\n\n<user prompt>:`;
}

export function cleanPromptTextPure(input: string, systemPrompt?: string): string {
  let text = input;
  const slashMarker = text.indexOf("\n\n<!-- vec-slash-directive -->\n");
  if (slashMarker !== -1) text = text.slice(0, slashMarker);
  text = text.replace(
    /^(?:\/(?:plan|goal|grill-me|browser|schedule|learn|deepagent)\s+)+(?=\u200b)/i,
    "",
  );
  if (text.startsWith("\u200b")) text = text.slice(1);
  const trimmedSys = systemPrompt ? systemPrompt.trim() : "";
  if (trimmedSys) {
    if (text.startsWith(trimmedSys)) {
      text = text.slice(trimmedSys.length).replace(/^[\r\n]+/, "");
    } else if (text.endsWith(trimmedSys)) {
      text = text.slice(0, -trimmedSys.length).replace(/[\r\n]+$/, "");
    } else if (text.includes(trimmedSys)) {
      text = text.replace(trimmedSys, "").trim();
    }
  }
  text = text.replace(
    /(?:\r?\n)*<system starter prompt in paseo>[\s\S]*?(?:-----------------[\s\S]*?<user prompt>:\s*|-----------------)/gi,
    "",
  );
  text = text.replace(/(?:\r?\n)*<system starter prompt in paseo>(?:\r?\n)*/gi, "");
  text = text.replace(
    /(?:\r?\n)*<!-- paseo-peers:start v\d+ -->[\s\S]*?(?:<!-- paseo-peers:end -->|(?=https?:\/\/|\n\n\S|$))/g,
    "",
  );
  text = text.replace(
    /^\s*<cadance>[\s\S]*?(?:<\/cadance>|(?=If u need make change to Paseo app)|(?=\r?\n\r?\n(?!\s*\/scheduled-task-rescheduler|\s*scan patterns|\s*reply concisly|\s*e2e test)))/gi,
    "",
  );
  text = text.replace(
    /^\s*If u need make change to Paseo app,\s*make sure it would survive auto updates and see if need contribute back to community auto\.?\s*/i,
    "",
  );
  text = text.replace(/^\s*<user prompt>:\s*/i, "");
  text = text.replace(
    /(?:\r?\n)*\/wheel-check or use context7 to check latest knowledge[\s\S]*?visually view if need or skip\.(?:\r?\n)*/gi,
    "",
  );
  text = text.replace(/^\u200b+/, "").replace(/\u200b+$/, "");
  const res = text.trim();
  return res.length > 0 ? res : input.trim();
}

export function parsePromptSections(raw: string): SystemPromptSection[] {
  if (!raw.trim()) return [];
  const sections: SystemPromptSection[] = [];
  const lines = raw.split("\n");
  let currentTitle = "Preamble";
  let currentLines: string[] = [];

  const flush = () => {
    if (currentLines.length > 0) {
      const body = currentLines.join("\n").trim();
      if (body) {
        sections.push({
          title: currentTitle,
          charCount: body.length,
          preview: body.slice(0, 160).replace(/\n+/g, " "),
        });
      }
      currentLines = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) {
      flush();
      const rawTitle = trimmed.replace(/^#+\s*/, "").trim();
      currentTitle = rawTitle.replace(/^\[(.*)\]$/, "$1").trim() || "Section";
    } else if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      flush();
      currentTitle = trimmed.slice(1, -1).trim() || "Section";
    } else {
      currentLines.push(line);
    }
  }
  flush();

  return sections.length > 0
    ? sections
    : [
        {
          title: "Full Instructions",
          charCount: raw.length,
          preview: raw.slice(0, 160).replace(/\n+/g, " "),
        },
      ];
}

export async function handleInspectSystemPrompt(
  input: RpcInput<typeof inspectSystemPromptRpc>,
  _context?: PluginHandlerContext,
) {
  const startMs = Date.now();
  const configPath = path.join(os.homedir(), ".paseo", "config.json");
  let appendSystemPrompt = "";
  let systemPrompt = "";
  let mtime: string | null = null;

  try {
    if (fs.existsSync(configPath)) {
      const stat = fs.statSync(configPath);
      mtime = stat.mtime.toISOString();
      const content = fs.readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(content) as {
        daemon?: { appendSystemPrompt?: string; systemPrompt?: string };
        systemPrompt?: string;
      };
      appendSystemPrompt = parsed.daemon?.appendSystemPrompt ?? "";
      systemPrompt = parsed.daemon?.systemPrompt ?? parsed.systemPrompt ?? "";
    }
  } catch (err) {
    appendSystemPrompt = `Error reading config.json: ${err instanceof Error ? err.message : String(err)}`;
  }

  if (input.action === "normalize_boundary" && appendSystemPrompt) {
    const normalized = normalizePromptUserBoundary(appendSystemPrompt);
    if (normalized !== appendSystemPrompt) {
      const paseoCandidates = [
        path.join(os.homedir(), ".local", "bin", "paseo"),
        "/opt/homebrew/bin/paseo",
        "/Applications/Paseo.app/Contents/Resources/bin/paseo",
      ];
      const paseoBin = paseoCandidates.find((p) => fs.existsSync(p)) ?? "paseo";
      execFileSync(
        paseoBin,
        ["daemon", "config", "set", "--string", "--", "daemon.appendSystemPrompt", normalized],
        { timeout: 15_000, stdio: "pipe" },
      );
      appendSystemPrompt = normalized;
      if (fs.existsSync(configPath)) {
        mtime = fs.statSync(configPath).mtime.toISOString();
      }
    }
  }

  const effectivePrompt = appendSystemPrompt || systemPrompt;
  const charCount = effectivePrompt.length;
  const lineCount = effectivePrompt ? effectivePrompt.split("\n").length : 0;
  const estimatedTokens = Math.ceil(charCount / 3.8);
  const boundary = inspectPromptBoundary(effectivePrompt);
  const sections = parsePromptSections(effectivePrompt);

  let testResult:
    | {
        inputChars: number;
        cleanedText: string;
        cleanedChars: number;
        strippedPrefix: boolean;
      }
    | undefined;

  if (input.action === "test_clean" && input.testInput) {
    const cleaned = cleanPromptTextPure(input.testInput, effectivePrompt);
    testResult = {
      inputChars: input.testInput.length,
      cleanedText: cleaned,
      cleanedChars: cleaned.length,
      strippedPrefix: cleaned !== input.testInput,
    };
  }

  const durationMs = Date.now() - startMs;
  return {
    ok: true,
    configPath,
    mtime,
    appendSystemPrompt,
    systemPrompt,
    charCount,
    lineCount,
    estimatedTokens,
    boundaryOk: boundary.boundaryOk,
    leakedAfterUserPromptChars: boundary.leakedAfterUserPromptChars,
    sections,
    cleanedPreview: effectivePrompt.slice(0, 300),
    testResult,
    message:
      input.action === "normalize_boundary"
        ? `Normalized <user prompt>: boundary to end (${charCount} chars)`
        : `System prompt loaded (${charCount} chars, ${sections.length} sections, ~${estimatedTokens} tokens)`,
    durationMs,
  };
}
