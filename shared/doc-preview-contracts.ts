import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { SUPPORTED_IMAGE_EXTENSIONS } from "./contracts";

export const SUPPORTED_DOCUMENT_EXTENSIONS = [
  "pdf",
  "docx",
  "docm",
  "doc",
  "xlsx",
  "xlsm",
  "xls",
  "pptx",
  "pptm",
  "ppt",
  "rtf",
  "odt",
  "ods",
  "odp",
  "epub",
  "pages",
  "numbers",
  "key",
] as const;

export type SupportedDocumentExtension = (typeof SUPPORTED_DOCUMENT_EXTENSIONS)[number];

export const SUPPORTED_COMPARE_EXTRA_EXTENSIONS = [
  "md",
  "markdown",
  "txt",
  "csv",
  "tsv",
  "json",
] as const;

export const SUPPORTED_COMPARE_EXTENSIONS = [
  ...SUPPORTED_DOCUMENT_EXTENSIONS,
  ...SUPPORTED_IMAGE_EXTENSIONS,
  ...SUPPORTED_COMPARE_EXTRA_EXTENSIONS,
] as const;

export const DocPreviewKindSchema = z.enum([
  "pdf",
  "word",
  "spreadsheet",
  "presentation",
  "ebook",
  "iwork",
  "image",
  "text",
  "unknown",
]);

export type DocPreviewKind = z.infer<typeof DocPreviewKindSchema>;

export const DocInteractionModeSchema = z.enum(["pan", "select"]);
export type DocInteractionMode = z.infer<typeof DocInteractionModeSchema>;

export const DocPdfRenderModeSchema = z.enum(["canvas", "native", "text"]);
export type DocPdfRenderMode = z.infer<typeof DocPdfRenderModeSchema>;

export const DocCompareLayoutSchema = z.enum(["single", "split", "stack"]);
export type DocCompareLayout = z.infer<typeof DocCompareLayoutSchema>;

export const DocDropBehaviorSchema = z.enum(["compare", "tabs"]);
export type DocDropBehavior = z.infer<typeof DocDropBehaviorSchema>;

export const DOC_ZOOM_STEPS = [0.5, 0.75, 0.9, 1, 1.25, 1.5, 2, 2.5, 3] as const;

export function classifyDocumentKind(pathOrExt: string): DocPreviewKind {
  const clean = pathOrExt.trim().toLowerCase();
  const dotIdx = clean.lastIndexOf(".");
  const ext = dotIdx >= 0 ? clean.slice(dotIdx + 1) : clean;
  if (ext === "pdf") return "pdf";
  if (ext === "docx" || ext === "docm" || ext === "doc" || ext === "rtf" || ext === "odt") {
    return "word";
  }
  if (
    ext === "xlsx" ||
    ext === "xlsm" ||
    ext === "xls" ||
    ext === "ods" ||
    ext === "csv" ||
    ext === "tsv"
  ) {
    return "spreadsheet";
  }
  if (ext === "pptx" || ext === "pptm" || ext === "ppt" || ext === "odp") return "presentation";
  if (ext === "epub") return "ebook";
  if (ext === "pages" || ext === "numbers" || ext === "key") return "iwork";
  if ((SUPPORTED_IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return "image";
  if (ext === "md" || ext === "markdown" || ext === "txt" || ext === "json") return "text";
  return "unknown";
}

export function isSupportedDocumentExtension(pathOrExt: string): boolean {
  const clean = pathOrExt.trim().toLowerCase();
  const dotIdx = clean.lastIndexOf(".");
  const ext = dotIdx >= 0 ? clean.slice(dotIdx + 1) : clean;
  return (SUPPORTED_DOCUMENT_EXTENSIONS as readonly string[]).includes(ext);
}

export function isSupportedCompareExtension(pathOrExt: string): boolean {
  const clean = pathOrExt.trim().toLowerCase();
  const dotIdx = clean.lastIndexOf(".");
  const ext = dotIdx >= 0 ? clean.slice(dotIdx + 1) : clean;
  return (SUPPORTED_COMPARE_EXTENSIONS as readonly string[]).includes(ext);
}

export function computeNextZoomStep(currentZoom: number, direction: "in" | "out"): number {
  const clamped = Math.max(DOC_ZOOM_STEPS[0], Math.min(DOC_ZOOM_STEPS[DOC_ZOOM_STEPS.length - 1], currentZoom));
  if (direction === "in") {
    for (const step of DOC_ZOOM_STEPS) {
      if (step > clamped + 0.01) return step;
    }
    return DOC_ZOOM_STEPS[DOC_ZOOM_STEPS.length - 1];
  }
  for (let i = DOC_ZOOM_STEPS.length - 1; i >= 0; i -= 1) {
    if (DOC_ZOOM_STEPS[i] < clamped - 0.01) return DOC_ZOOM_STEPS[i];
  }
  return DOC_ZOOM_STEPS[0];
}

export function clampPanScroll(input: {
  startScrollLeft: number;
  startScrollTop: number;
  deltaX: number;
  deltaY: number;
  maxScrollLeft: number;
  maxScrollTop: number;
}): { scrollLeft: number; scrollTop: number } {
  const maxL = Math.max(0, input.maxScrollLeft);
  const maxT = Math.max(0, input.maxScrollTop);
  const nextLeft = Math.max(0, Math.min(maxL, Math.round(input.startScrollLeft - input.deltaX)));
  const nextTop = Math.max(0, Math.min(maxT, Math.round(input.startScrollTop - input.deltaY)));
  return { scrollLeft: nextLeft, scrollTop: nextTop };
}

export function computeSyncedScrollOffset(input: {
  sourceScrollTop: number;
  sourceScrollHeight: number;
  sourceClientHeight: number;
  targetScrollHeight: number;
  targetClientHeight: number;
}): number {
  const sourceMax = Math.max(0, input.sourceScrollHeight - input.sourceClientHeight);
  const targetMax = Math.max(0, input.targetScrollHeight - input.targetClientHeight);
  if (sourceMax <= 0 || targetMax <= 0) return 0;
  const ratio = Math.max(0, Math.min(1, input.sourceScrollTop / sourceMax));
  return Math.round(ratio * targetMax);
}

/**
 * Strip executable scripts, event attributes, and dangerous URL protocols from rendered Office/EPUB HTML
 * before mounting inside our isolated Shadow DOM preview surface.
 */
export function sanitizePreviewHtml(rawHtml: string): string {
  if (!rawHtml) return "";
  return rawHtml
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<(?:iframe|object|embed|applet|meta\s+http-equiv)\b[^>]*>/gi, "")
    .replace(/\s+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src|xlink:href)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1=$2#$2');
}

export const DocPreviewPageSchema = z.object({
  pageNumber: z.number().int().min(1),
  widthPx: z.number().int().min(1),
  heightPx: z.number().int().min(1),
  widthPt: z.number().optional(),
  heightPt: z.number().optional(),
  imageDataUrl: z.string().optional(),
  text: z.string().optional(),
  label: z.string().optional(),
});

export type DocPreviewPage = z.infer<typeof DocPreviewPageSchema>;

export const DocPreviewSheetSchema = z.object({
  name: z.string(),
  rowCount: z.number().int().min(0),
  colCount: z.number().int().min(0),
  html: z.string(),
});

export type DocPreviewSheet = z.infer<typeof DocPreviewSheetSchema>;

export const DocPreviewResponseSchema = z.object({
  ok: z.boolean(),
  exists: z.boolean(),
  absolutePath: z.string(),
  relativePath: z.string(),
  fileName: z.string(),
  extension: z.string(),
  sizeBytes: z.number(),
  sizeFormatted: z.string(),
  modifiedIso: z.string(),
  modifiedRelative: z.string(),
  kind: DocPreviewKindSchema,
  renderFormat: z.enum(["pages", "html", "sheets", "text", "native-only", "error"]),
  engine: z.string(),
  cached: z.boolean(),
  durationMs: z.number(),
  title: z.string().optional(),
  author: z.string().optional(),
  totalPages: z.number().int().min(0),
  loadedPageStart: z.number().int().min(0),
  loadedPageEnd: z.number().int().min(0),
  hasMorePages: z.boolean(),
  supportsNativeFrame: z.boolean(),
  pages: z.array(DocPreviewPageSchema),
  sheets: z.array(DocPreviewSheetSchema).optional(),
  htmlContent: z.string().optional(),
  plainText: z.string().optional(),
  errorMessage: z.string().optional(),
});

export type DocPreviewResponse = z.infer<typeof DocPreviewResponseSchema>;

export const previewDocumentRpc = defineRpc({
  name: "finder.preview_document",
  input: z.object({
    workspaceId: z.string().optional(),
    workspaceRoot: z.string().optional(),
    path: z.string(),
    pageStart: z.number().int().min(1).default(1),
    pageLimit: z.number().int().min(1).max(24).default(6),
    dpi: z.number().int().min(72).max(240).default(144),
    forceRefresh: z.boolean().optional(),
  }),
  output: DocPreviewResponseSchema,
});

export const SiblingDocumentItemSchema = z.object({
  fileName: z.string(),
  absolutePath: z.string(),
  relativePath: z.string(),
  extension: z.string(),
  kind: DocPreviewKindSchema,
  sizeFormatted: z.string(),
  modifiedRelative: z.string(),
  sameDirectory: z.boolean(),
});

export type SiblingDocumentItem = z.infer<typeof SiblingDocumentItemSchema>;

export const listSiblingDocumentsRpc = defineRpc({
  name: "finder.list_sibling_documents",
  input: z.object({
    workspaceId: z.string().optional(),
    workspaceRoot: z.string().optional(),
    currentPath: z.string().optional(),
    limit: z.number().int().min(1).max(60).default(24),
  }),
  output: z.object({
    ok: z.boolean(),
    workspaceRoot: z.string(),
    items: z.array(SiblingDocumentItemSchema),
  }),
});

export const DocPreviewEngineStatusSchema = z.object({
  id: z.string(),
  available: z.boolean(),
  detail: z.string(),
});

export const diagnoseDocPreviewRpc = defineRpc({
  name: "finder.diagnose_doc_preview",
  input: z.object({
    action: z.enum(["status", "probe", "clear_cache"]).default("status"),
    workspaceId: z.string().optional(),
    workspaceRoot: z.string().optional(),
    path: z.string().optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    supportedExtensions: z.array(z.string()),
    compareExtensions: z.array(z.string()),
    engines: z.array(DocPreviewEngineStatusSchema),
    cacheDir: z.string(),
    cacheFileCount: z.number().int().min(0),
    cacheBytesFormatted: z.string(),
    probeResult: DocPreviewResponseSchema.optional(),
    message: z.string(),
  }),
});
