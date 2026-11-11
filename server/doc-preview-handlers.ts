import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { execFile } from "node:child_process";
import * as crypto from "node:crypto";
import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import {
  type DocPreviewPage,
  type DocPreviewResponse,
  type DocPreviewSheet,
  type SiblingDocumentItem,
  SUPPORTED_COMPARE_EXTENSIONS,
  SUPPORTED_DOCUMENT_EXTENSIONS,
  classifyDocumentKind,
  type diagnoseDocPreviewRpc,
  isSupportedCompareExtension,
  type listSiblingDocumentsRpc,
  type previewDocumentRpc,
  sanitizePreviewHtml,
} from "../shared/doc-preview-contracts";
import {
  buildCandidatePaths,
  listAllWorkspaceDirectories,
  resolveWorkspaceDirectory,
} from "./handlers";

const execFileAsync = promisify(execFile);

const CACHE_VERSION = "v1";
const DOC_PREVIEW_CACHE_ROOT = path.join(os.tmpdir(), "paseo-doc-preview-cache");

const IGNORED_SCAN_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  ".turbo",
  ".venv",
  "venv",
  "__pycache__",
  ".cache",
  "graphify-out",
  "weknora-out",
]);

function buildEnhancedEnv(): NodeJS.ProcessEnv {
  const extraDirs = [
    path.join(os.homedir(), ".local", "bin"),
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ];
  const existing = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const merged = [...new Set([...extraDirs, ...existing])].join(path.delimiter);
  return {
    ...process.env,
    PATH: merged,
    PYTHONIOENCODING: "utf-8",
  };
}

function resolveBinaryCandidate(binName: string): string | null {
  const candidates = [
    path.join(os.homedir(), ".local", "bin", binName),
    path.join("/opt/homebrew/bin", binName),
    path.join("/usr/local/bin", binName),
    path.join("/usr/bin", binName),
    path.join("/bin", binName),
  ];
  for (const c of candidates) {
    try {
      fsSync.accessSync(c, fsSync.constants.X_OK);
      return c;
    } catch {
      // Try next
    }
  }
  return null;
}

let cachedPythonInfo: {
  bin: string | null;
  hasFitz: boolean;
  hasDocx: boolean;
  hasOpenpyxl: boolean;
} | null = null;

async function resolvePythonCapabilities(): Promise<{
  bin: string | null;
  hasFitz: boolean;
  hasDocx: boolean;
  hasOpenpyxl: boolean;
}> {
  if (cachedPythonInfo) return cachedPythonInfo;
  const pyCandidates = [
    path.join(os.homedir(), ".local", "bin", "python3"),
    "/opt/homebrew/bin/python3",
    "/usr/local/bin/python3",
    "/usr/bin/python3",
  ].filter((p, idx, arr) => arr.indexOf(p) === idx && fsSync.existsSync(p));

  const env = buildEnhancedEnv();
  let fallbackBin: string | null = null;
  for (const bin of pyCandidates) {
    try {
      const { stdout } = await execFileAsync(
        bin,
        [
          "-c",
          "import json\nres={}\nfor m in ['fitz','docx','openpyxl']:\n try:\n  __import__(m); res[m]=True\n except Exception:\n  res[m]=False\nprint(json.dumps(res))",
        ],
        { env, timeout: 6000 },
      );
      const parsed = JSON.parse(stdout.trim()) as Record<string, boolean>;
      if (!fallbackBin) fallbackBin = bin;
      if (parsed.fitz || parsed.docx || parsed.openpyxl) {
        cachedPythonInfo = {
          bin,
          hasFitz: Boolean(parsed.fitz),
          hasDocx: Boolean(parsed.docx),
          hasOpenpyxl: Boolean(parsed.openpyxl),
        };
        return cachedPythonInfo;
      }
    } catch {
      // Try next python binary
    }
  }
  cachedPythonInfo = {
    bin: fallbackBin,
    hasFitz: false,
    hasDocx: false,
    hasOpenpyxl: false,
  };
  return cachedPythonInfo;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function formatRelativeTime(mtimeMs: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - mtimeMs) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapPaperHtml(bodyHtml: string, title?: string): string {
  return [
    "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><style>",
    "* { box-sizing: border-box; }",
    "body { margin: 0; padding: 24px; background: transparent; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Hiragino Sans', sans-serif; color: #111827; line-height: 1.6; }",
    ".paseo-doc-paper { background: #ffffff; color: #111827; max-width: 840px; margin: 0 auto 24px auto; padding: 44px 52px; border-radius: 6px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.12); overflow-x: auto; }",
    ".paseo-doc-slide { background: #ffffff; color: #111827; max-width: 920px; min-height: 480px; margin: 0 auto 24px auto; padding: 36px 44px; border-radius: 6px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.14); display: flex; flex-direction: column; justify-content: flex-start; gap: 12px; position: relative; }",
    ".paseo-doc-slide-num { font-size: 11px; color: #6b7280; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; margin-bottom: 4px; }",
    "h1, h2, h3, h4 { color: #111827; margin: 1em 0 0.45em 0; line-height: 1.3; }",
    "p { margin: 0 0 0.65em 0; }",
    "table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 13px; }",
    "th, td { border: 1px solid #d1d5db; padding: 6px 10px; text-align: left; vertical-align: top; }",
    "th { background: #f3f4f6; font-weight: 600; position: sticky; top: 0; }",
    "pre { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; overflow-x: auto; font-size: 12.5px; line-height: 1.5; }",
    "</style></head><body>",
    title ? `<div class="paseo-doc-paper">${bodyHtml}</div>` : bodyHtml,
    "</body></html>",
  ].join("\n");
}

function computeFileCacheKey(realPath: string, size: number, mtimeMs: number, dpi: number): string {
  return crypto
    .createHash("sha256")
    .update(`${CACHE_VERSION}:${realPath}:${size}:${Math.floor(mtimeMs)}:${dpi}`)
    .digest("hex")
    .slice(0, 24);
}

async function resolveExistingFilePath(
  context: PluginHandlerContext,
  rawPath: string,
  workspaceId?: string,
  workspaceRoot?: string,
): Promise<{ workspaceDir: string; resolvedPath: string; exists: boolean }> {
  const workspaceDir = await resolveWorkspaceDirectory(context, workspaceId, workspaceRoot);
  const extraRoots = await listAllWorkspaceDirectories(context, workspaceDir);
  const candidates = buildCandidatePaths(rawPath, workspaceDir, extraRoots);
  for (const candidate of candidates) {
    try {
      const st = await fs.stat(candidate);
      if (st.isFile()) {
        return { workspaceDir, resolvedPath: candidate, exists: true };
      }
    } catch {
      // Continue
    }
  }
  const fallback = candidates[0] ?? path.resolve(workspaceDir, rawPath);
  return { workspaceDir, resolvedPath: fallback, exists: false };
}

const PY_FITZ_PDF_SCRIPT = `
import fitz, json, os, sys

pdf_path = sys.argv[1]
cache_dir = sys.argv[2]
page_start = max(1, int(sys.argv[3]))
page_limit = max(1, int(sys.argv[4]))
dpi = max(72, min(240, int(sys.argv[5])))

os.makedirs(cache_dir, exist_ok=True)
doc = fitz.open(pdf_path)
total_pages = len(doc)
page_end = min(total_pages, page_start + page_limit - 1) if total_pages > 0 else 0
meta = doc.metadata or {}

pages_out = []
for pno in range(page_start, page_end + 1):
    page = doc[pno - 1]
    rect = page.rect
    png_path = os.path.join(cache_dir, f"page-{pno:04d}.png")
    cached_page = os.path.isfile(png_path) and os.path.getsize(png_path) > 0
    if not cached_page:
        pix = page.get_pixmap(dpi=dpi, alpha=False)
        pix.save(png_path)
        w_px, h_px = pix.width, pix.height
    else:
        scale = dpi / 72.0
        w_px = max(1, int(round(rect.width * scale)))
        h_px = max(1, int(round(rect.height * scale)))
    pages_out.append({
        "pageNumber": pno,
        "widthPx": w_px,
        "heightPx": h_px,
        "widthPt": round(float(rect.width), 2),
        "heightPt": round(float(rect.height), 2),
        "pngPath": png_path,
        "cached": cached_page,
        "text": page.get_text("text") or "",
    })

full_text_path = os.path.join(cache_dir, "full_text.json")
if os.path.isfile(full_text_path):
    try:
        with open(full_text_path, "r", encoding="utf-8") as fh:
            all_texts = json.load(fh)
    except Exception:
        all_texts = None
else:
    all_texts = None

if all_texts is None and total_pages <= 120:
    all_texts = []
    for idx in range(total_pages):
        txt = (doc[idx].get_text("text") or "").strip()
        if txt:
            all_texts.append(f"--- Page {idx + 1} ---\\n{txt}")
    try:
        with open(full_text_path, "w", encoding="utf-8") as fh:
            json.dump(all_texts, fh, ensure_ascii=False)
    except Exception:
        pass

print(json.dumps({
    "totalPages": total_pages,
    "pageStart": page_start if total_pages > 0 else 0,
    "pageEnd": page_end,
    "title": (meta.get("title") or "").strip(),
    "author": (meta.get("author") or "").strip(),
    "pages": pages_out,
    "plainText": "\\n\\n".join(all_texts or []),
}, ensure_ascii=False))
`;

const PY_STDLIB_OPENXML_SCRIPT = `
import html, json, os, re, sys, xml.etree.ElementTree as ET, zipfile

file_path = sys.argv[1]
ext = sys.argv[2].lower()

def esc(s):
    return html.escape(s or "")

def local_name(tag):
    return tag.split("}", 1)[-1] if "}" in tag else tag

out = {"kind": ext, "totalPages": 1, "html": "", "plainText": "", "sheets": []}

with zipfile.ZipFile(file_path, "r") as zf:
    names = set(zf.namelist())
    if ext == "docx":
        xml_bytes = zf.read("word/document.xml")
        root = ET.fromstring(xml_bytes)
        blocks = []
        texts = []
        body = next((c for c in root if local_name(c.tag) == "body"), root)
        for child in body:
            lname = local_name(child.tag)
            if lname == "p":
                runs = [t.text for t in child.iter() if local_name(t.tag) == "t" and t.text]
                line = "".join(runs).strip()
                if line:
                    texts.append(line)
                    style_el = next((s for s in child.iter() if local_name(s.tag) == "pStyle"), None)
                    style_val = ""
                    if style_el is not None:
                        for k, v in style_el.attrib.items():
                            if local_name(k) == "val":
                                style_val = v.lower()
                    if "heading1" in style_val or style_val == "title":
                        blocks.append(f"<h1>{esc(line)}</h1>")
                    elif "heading2" in style_val:
                        blocks.append(f"<h2>{esc(line)}</h2>")
                    elif "heading3" in style_val:
                        blocks.append(f"<h3>{esc(line)}</h3>")
                    else:
                        blocks.append(f"<p>{esc(line)}</p>")
            elif lname == "tbl":
                rows_html = []
                for tr in child:
                    if local_name(tr.tag) != "tr":
                        continue
                    cells = []
                    for tc in tr:
                        if local_name(tc.tag) != "tc":
                            continue
                        cell_txt = " ".join(
                            "".join(t.text for t in p.iter() if local_name(t.tag) == "t" and t.text).strip()
                            for p in tc if local_name(p.tag) == "p"
                        ).strip()
                        if cell_txt:
                            texts.append(cell_txt)
                        cells.append(f"<td>{esc(cell_txt)}</td>")
                    if cells:
                        rows_html.append("<tr>" + "".join(cells) + "</tr>")
                if rows_html:
                    blocks.append("<table>" + "".join(rows_html) + "</table>")
        out["html"] = '<div class="paseo-doc-paper">' + "\\n".join(blocks) + "</div>"
        out["plainText"] = "\\n".join(texts)
        out["totalPages"] = max(1, (len(out["plainText"]) // 2800) + 1)

    elif ext == "xlsx":
        shared = []
        if "xl/sharedStrings.xml" in names:
            sroot = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            for si in sroot:
                if local_name(si.tag) == "si":
                    shared.append("".join(t.text or "" for t in si.iter() if local_name(t.tag) == "t"))
        sheet_titles = []
        if "xl/workbook.xml" in names:
            wb = ET.fromstring(zf.read("xl/workbook.xml"))
            for el in wb.iter():
                if local_name(el.tag) == "sheet" and el.attrib.get("name"):
                    sheet_titles.append(el.attrib["name"])
        sheet_files = sorted(
            [n for n in names if n.startswith("xl/worksheets/sheet") and n.endswith(".xml")],
            key=lambda x: int(re.sub(r"\\D+", "", x) or "0"),
        )
        texts = []
        sheets_out = []
        for idx, sf in enumerate(sheet_files):
            sname = sheet_titles[idx] if idx < len(sheet_titles) else f"Sheet {idx + 1}"
            sroot = ET.fromstring(zf.read(sf))
            rows_data = []
            max_cols = 0
            for row_el in sroot.iter():
                if local_name(row_el.tag) != "row":
                    continue
                vals = []
                for c_el in row_el:
                    if local_name(c_el.tag) != "c":
                        continue
                    ctype = c_el.attrib.get("t", "")
                    val = ""
                    if ctype == "inlineStr":
                        val = "".join(t.text or "" for t in c_el.iter() if local_name(t.tag) == "t")
                    else:
                        v_el = next((v for v in c_el if local_name(v.tag) == "v"), None)
                        raw = v_el.text if v_el is not None and v_el.text else ""
                        if ctype == "s" and raw.isdigit() and int(raw) < len(shared):
                            val = shared[int(raw)]
                        else:
                            val = raw
                    vals.append(val)
                if any(v.strip() for v in vals):
                    rows_data.append(vals)
                    max_cols = max(max_cols, len(vals))
                    texts.append("\\t".join(vals))
                if len(rows_data) >= 300:
                    break
            tr_list = []
            for r_i, r_vals in enumerate(rows_data):
                padded = r_vals + [""] * (max_cols - len(r_vals))
                tag = "th" if r_i == 0 else "td"
                tr_list.append("<tr>" + "".join(f"<{tag}>{esc(v)}</{tag}>" for v in padded) + "</tr>")
            tbl_html = "<table>" + "".join(tr_list) + "</table>" if tr_list else "<p>Empty sheet</p>"
            sheets_out.append({
                "name": sname,
                "rowCount": len(rows_data),
                "colCount": max_cols,
                "html": f'<div class="paseo-doc-paper"><h3>{esc(sname)}</h3>{tbl_html}</div>',
            })
        out["sheets"] = sheets_out
        out["totalPages"] = max(1, len(sheets_out))
        out["html"] = "\\n".join(s["html"] for s in sheets_out)
        out["plainText"] = "\\n".join(texts)

    elif ext == "pptx":
        slide_files = sorted(
            [n for n in names if n.startswith("ppt/slides/slide") and n.endswith(".xml")],
            key=lambda x: int(re.sub(r"\\D+", "", x) or "0"),
        )
        slides_html = []
        texts = []
        for idx, sf in enumerate(slide_files):
            sroot = ET.fromstring(zf.read(sf))
            paras = []
            for p_el in sroot.iter():
                if local_name(p_el.tag) == "p":
                    line = "".join(t.text or "" for t in p_el.iter() if local_name(t.tag) == "t").strip()
                    if line:
                        paras.append(line)
            texts.append(f"--- Slide {idx + 1} ---\\n" + "\\n".join(paras))
            body_items = []
            for p_i, line in enumerate(paras):
                if p_i == 0:
                    body_items.append(f"<h2>{esc(line)}</h2>")
                else:
                    body_items.append(f"<p>{esc(line)}</p>")
            slides_html.append(
                f'<div class="paseo-doc-slide" data-doc-page="{idx + 1}">'
                f'<div class="paseo-doc-slide-num">Slide {idx + 1} / {len(slide_files)}</div>'
                + ("".join(body_items) or "<p></p>")
                + "</div>"
            )
        out["totalPages"] = max(1, len(slide_files))
        out["html"] = "\\n".join(slides_html)
        out["plainText"] = "\\n\\n".join(texts)

    elif ext in ("odt", "ods", "odp"):
        if "content.xml" in names:
            croot = ET.fromstring(zf.read("content.xml"))
            paras = []
            for el in croot.iter():
                if local_name(el.tag) in ("p", "h"):
                    txt = "".join(el.itertext()).strip()
                    if txt:
                        paras.append(txt)
            out["plainText"] = "\\n".join(paras)
            out["html"] = '<div class="paseo-doc-paper">' + "".join(f"<p>{esc(p)}</p>" for p in paras) + "</div>"
            out["totalPages"] = max(1, (len(out["plainText"]) // 2800) + 1)

    elif ext == "epub":
        html_files = [n for n in names if n.lower().endswith((".xhtml", ".html", ".htm"))]
        if "META-INF/container.xml" in names:
            try:
                croot = ET.fromstring(zf.read("META-INF/container.xml"))
                opf_path = next(
                    (el.attrib.get("full-path") for el in croot.iter() if el.attrib.get("full-path")),
                    None,
                )
                if opf_path and opf_path in names:
                    opf_dir = os.path.dirname(opf_path)
                    opf_root = ET.fromstring(zf.read(opf_path))
                    manifest = {}
                    for item in opf_root.iter():
                        if local_name(item.tag) == "item" and item.attrib.get("id") and item.attrib.get("href"):
                            manifest[item.attrib["id"]] = os.path.normpath(os.path.join(opf_dir, item.attrib["href"])).lstrip("./")
                    spine_files = []
                    for iref in opf_root.iter():
                        if local_name(iref.tag) == "itemref":
                            idref = iref.attrib.get("idref", "")
                            if idref in manifest and manifest[idref] in names:
                                spine_files.append(manifest[idref])
                    if spine_files:
                        html_files = spine_files
            except Exception:
                pass
        chapters = []
        texts = []
        for idx, hf in enumerate(html_files[:40]):
            raw = zf.read(hf).decode("utf-8", errors="replace")
            m = re.search(r"<body[^>]*>([\\s\\S]*?)</body>", raw, re.I)
            body_inner = m.group(1) if m else raw
            plain = re.sub(r"<[^>]+>", " ", body_inner)
            plain = re.sub(r"\\s+", " ", plain).strip()
            if plain:
                texts.append(plain)
            chapters.append(f'<div class="paseo-doc-paper" data-doc-page="{idx + 1}">{body_inner}</div>')
        out["totalPages"] = max(1, len(chapters))
        out["html"] = "\\n".join(chapters)
        out["plainText"] = "\\n\\n".join(texts)

print(json.dumps(out, ensure_ascii=False))
`;

async function pngFileToDataUrl(pngPath: string): Promise<string> {
  const buf = await fs.readFile(pngPath);
  return `data:image/png;base64,${buf.toString("base64")}`;
}

function readPngDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return {
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
    };
  }
  return null;
}

async function renderPdfWithPyMuPdf(
  pdfPath: string,
  cacheDir: string,
  pageStart: number,
  pageLimit: number,
  dpi: number,
  pyBin: string,
): Promise<{
  totalPages: number;
  loadedPageStart: number;
  loadedPageEnd: number;
  title?: string;
  author?: string;
  pages: DocPreviewPage[];
  plainText: string;
  cached: boolean;
} | null> {
  try {
    const { stdout } = await execFileAsync(
      pyBin,
      ["-c", PY_FITZ_PDF_SCRIPT, pdfPath, cacheDir, String(pageStart), String(pageLimit), String(dpi)],
      { env: buildEnhancedEnv(), timeout: 25000, maxBuffer: 32 * 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout.trim()) as {
      totalPages: number;
      pageStart: number;
      pageEnd: number;
      title?: string;
      author?: string;
      plainText?: string;
      pages: Array<{
        pageNumber: number;
        widthPx: number;
        heightPx: number;
        widthPt?: number;
        heightPt?: number;
        pngPath: string;
        cached: boolean;
        text?: string;
      }>;
    };
    const pages: DocPreviewPage[] = await Promise.all(
      parsed.pages.map(async (p) => ({
        pageNumber: p.pageNumber,
        widthPx: p.widthPx,
        heightPx: p.heightPx,
        widthPt: p.widthPt,
        heightPt: p.heightPt,
        imageDataUrl: await pngFileToDataUrl(p.pngPath),
        text: p.text,
      })),
    );
    const allCached = parsed.pages.length > 0 && parsed.pages.every((p) => p.cached);
    return {
      totalPages: parsed.totalPages,
      loadedPageStart: parsed.pageStart,
      loadedPageEnd: parsed.pageEnd,
      title: parsed.title || undefined,
      author: parsed.author || undefined,
      pages,
      plainText: parsed.plainText ?? "",
      cached: allCached,
    };
  } catch {
    return null;
  }
}

async function renderPdfWithPdftoppm(
  pdfPath: string,
  cacheDir: string,
  pageStart: number,
  pageLimit: number,
  dpi: number,
): Promise<{
  totalPages: number;
  loadedPageStart: number;
  loadedPageEnd: number;
  pages: DocPreviewPage[];
  cached: boolean;
} | null> {
  const pdftoppm = resolveBinaryCandidate("pdftoppm");
  if (!pdftoppm) return null;
  try {
    await fs.mkdir(cacheDir, { recursive: true });
    let totalPages = 0;
    const pdfinfo = resolveBinaryCandidate("pdfinfo");
    if (pdfinfo) {
      try {
        const { stdout } = await execFileAsync(pdfinfo, [pdfPath], {
          env: buildEnhancedEnv(),
          timeout: 6000,
        });
        const m = stdout.match(/^Pages:\s+(\d+)/m);
        if (m) totalPages = Number.parseInt(m[1], 10);
      } catch {
        // Ignore
      }
    }
    const pageEnd = totalPages > 0 ? Math.min(totalPages, pageStart + pageLimit - 1) : pageStart + pageLimit - 1;
    const outPrefix = path.join(cacheDir, "ppm");
    await execFileAsync(
      pdftoppm,
      ["-png", "-r", String(dpi), "-f", String(pageStart), "-l", String(pageEnd), pdfPath, outPrefix],
      { env: buildEnhancedEnv(), timeout: 25000 },
    );
    const entries = (await fs.readdir(cacheDir))
      .filter((n) => n.startsWith("ppm-") && n.endsWith(".png"))
      .sort();
    const pages: DocPreviewPage[] = [];
    for (const name of entries) {
      const numMatch = name.match(/ppm-0*(\d+)\.png$/);
      const pno = numMatch ? Number.parseInt(numMatch[1], 10) : pages.length + 1;
      if (pno < pageStart || pno > pageEnd) continue;
      const full = path.join(cacheDir, name);
      const buf = await fs.readFile(full);
      const dims = readPngDimensions(buf) ?? { width: 1200, height: 1697 };
      pages.push({
        pageNumber: pno,
        widthPx: dims.width,
        heightPx: dims.height,
        imageDataUrl: `data:image/png;base64,${buf.toString("base64")}`,
      });
    }
    if (pages.length === 0) return null;
    const finalTotal = totalPages > 0 ? totalPages : Math.max(...pages.map((p) => p.pageNumber));
    return {
      totalPages: finalTotal,
      loadedPageStart: pages[0].pageNumber,
      loadedPageEnd: pages[pages.length - 1].pageNumber,
      pages,
      cached: false,
    };
  } catch {
    return null;
  }
}

async function renderOfficeWithOfficeCli(
  filePath: string,
  ext: string,
): Promise<{
  htmlContent: string;
  plainText: string;
  totalPages: number;
} | null> {
  if (!["docx", "docm", "xlsx", "xlsm", "pptx", "pptm"].includes(ext)) return null;
  const officeCli = resolveBinaryCandidate("officecli");
  if (!officeCli) return null;
  try {
    const env = buildEnhancedEnv();
    const [{ stdout: rawHtml }, textRes] = await Promise.all([
      execFileAsync(officeCli, ["view", filePath, "html"], {
        env,
        timeout: 20000,
        maxBuffer: 32 * 1024 * 1024,
      }),
      execFileAsync(officeCli, ["view", filePath, "text", "--max-lines", "500"], {
        env,
        timeout: 12000,
        maxBuffer: 8 * 1024 * 1024,
      }).catch(() => ({ stdout: "" })),
    ]);
    if (!rawHtml || !rawHtml.trim()) return null;
    const cleaned = sanitizePreviewHtml(rawHtml);
    const plainText = textRes.stdout?.trim() ?? "";
    const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const bodyInner = (bodyMatch ? bodyMatch[1] : cleaned)
      .replace(/<style\b[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, "")
      .trim();
    const hasVisualEmbed = /<(?:img|svg|canvas|table)\b/i.test(bodyMatch ? bodyMatch[1] : cleaned);
    if (!plainText && !bodyInner && !hasVisualEmbed) {
      return null;
    }
    if (ext === "pptx" && !plainText && !/data-slide-index|class=["'][^"']*slide-page/i.test(cleaned)) {
      return null;
    }
    const pageMatches =
      cleaned.match(/class=["'][^"']*\b(?:page|slide)\b[^"']*["']/gi) ??
      cleaned.match(/<table\b/gi) ??
      [];
    return {
      htmlContent: cleaned,
      plainText,
      totalPages: Math.max(1, pageMatches.length),
    };
  } catch {
    return null;
  }
}

async function renderWithMacTextutil(
  filePath: string,
  ext: string,
): Promise<{ htmlContent: string; plainText: string; totalPages: number } | null> {
  if (process.platform !== "darwin") return null;
  if (!["doc", "docx", "rtf", "odt"].includes(ext)) return null;
  const textutil = resolveBinaryCandidate("textutil");
  if (!textutil) return null;
  try {
    const env = buildEnhancedEnv();
    const [{ stdout: rawHtml }, txtRes] = await Promise.all([
      execFileAsync(textutil, ["-convert", "html", "-stdout", filePath], {
        env,
        timeout: 15000,
        maxBuffer: 20 * 1024 * 1024,
      }),
      execFileAsync(textutil, ["-convert", "txt", "-stdout", filePath], {
        env,
        timeout: 10000,
        maxBuffer: 8 * 1024 * 1024,
      }).catch(() => ({ stdout: "" })),
    ]);
    if (!rawHtml || !rawHtml.trim()) return null;
    const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const styleMatch = rawHtml.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
    const inner = sanitizePreviewHtml(
      `${styleMatch ? `<style>${styleMatch[1]}</style>` : ""}${bodyMatch ? bodyMatch[1] : rawHtml}`,
    );
    const plainText = txtRes.stdout?.trim() ?? "";
    return {
      htmlContent: wrapPaperHtml(inner, path.basename(filePath)),
      plainText,
      totalPages: Math.max(1, Math.ceil(plainText.length / 2800)),
    };
  } catch {
    return null;
  }
}

async function renderZipDocumentWithPythonStdlib(
  filePath: string,
  ext: string,
  pyBin: string | null,
): Promise<{
  htmlContent: string;
  plainText: string;
  totalPages: number;
  sheets?: DocPreviewSheet[];
} | null> {
  if (!pyBin) return null;
  if (!["docx", "docm", "xlsx", "xlsm", "pptx", "pptm", "odt", "ods", "odp", "epub"].includes(ext)) return null;
  const normalizedZipExt =
    ext === "docm" ? "docx" : ext === "xlsm" ? "xlsx" : ext === "pptm" ? "pptx" : ext;
  try {
    const { stdout } = await execFileAsync(pyBin, ["-c", PY_STDLIB_OPENXML_SCRIPT, filePath, normalizedZipExt], {
      env: buildEnhancedEnv(),
      timeout: 20000,
      maxBuffer: 32 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout.trim()) as {
      totalPages: number;
      html: string;
      plainText: string;
      sheets?: DocPreviewSheet[];
    };
    if (!parsed.html && (!parsed.sheets || parsed.sheets.length === 0)) return null;
    return {
      htmlContent: wrapPaperHtml(sanitizePreviewHtml(parsed.html)),
      plainText: parsed.plainText ?? "",
      totalPages: Math.max(1, parsed.totalPages || 1),
      sheets: parsed.sheets && parsed.sheets.length > 0 ? parsed.sheets : undefined,
    };
  } catch {
    return null;
  }
}

async function renderWithMacQuickLook(
  filePath: string,
  cacheDir: string,
  pageStart: number,
  pageLimit: number,
  dpi: number,
  pyBin: string | null,
  hasFitz: boolean,
): Promise<{
  renderFormat: "pages" | "html";
  engine: string;
  totalPages: number;
  loadedPageStart: number;
  loadedPageEnd: number;
  pages: DocPreviewPage[];
  htmlContent?: string;
  plainText?: string;
} | null> {
  if (process.platform !== "darwin") return null;
  const qlmanage = resolveBinaryCandidate("qlmanage");
  if (!qlmanage) return null;
  const qlDir = path.join(cacheDir, "ql");
  try {
    await fs.mkdir(qlDir, { recursive: true });
    await execFileAsync(qlmanage, ["-p", "-o", qlDir, filePath], {
      env: buildEnhancedEnv(),
      timeout: 15000,
    }).catch(() => undefined);

    const entries = await fs.readdir(qlDir).catch(() => [] as string[]);
    const previewSubdir = entries.find((e) => e.endsWith(".qlpreview"));
    if (previewSubdir) {
      const fullPreviewDir = path.join(qlDir, previewSubdir);
      const subEntries = await fs.readdir(fullPreviewDir);
      const pdfFile = subEntries.find((e) => e.toLowerCase().endsWith(".pdf"));
      if (pdfFile && pyBin && hasFitz) {
        const pdfRes = await renderPdfWithPyMuPdf(
          path.join(fullPreviewDir, pdfFile),
          path.join(cacheDir, "ql-pdf"),
          pageStart,
          pageLimit,
          dpi,
          pyBin,
        );
        if (pdfRes && pdfRes.pages.length > 0) {
          return {
            renderFormat: "pages",
            engine: "quicklook+pymupdf",
            totalPages: pdfRes.totalPages,
            loadedPageStart: pdfRes.loadedPageStart,
            loadedPageEnd: pdfRes.loadedPageEnd,
            pages: pdfRes.pages,
            plainText: pdfRes.plainText,
          };
        }
      }
      const htmlFile = subEntries.find((e) => e.toLowerCase().endsWith(".html"));
      if (htmlFile) {
        const rawHtml = await fs.readFile(path.join(fullPreviewDir, htmlFile), "utf8");
        return {
          renderFormat: "html",
          engine: "quicklook-html",
          totalPages: 1,
          loadedPageStart: 1,
          loadedPageEnd: 1,
          pages: [],
          htmlContent: sanitizePreviewHtml(rawHtml),
        };
      }
    }

    // Fallback to high-res QuickLook thumbnail
    await execFileAsync(qlmanage, ["-t", "-s", "1600", "-o", qlDir, filePath], {
      env: buildEnhancedEnv(),
      timeout: 12000,
    });
    const afterThumb = await fs.readdir(qlDir);
    const pngName = afterThumb.find((n) => n.endsWith(".png"));
    if (!pngName) return null;
    const pngPath = path.join(qlDir, pngName);
    const buf = await fs.readFile(pngPath);
    const dims = readPngDimensions(buf) ?? { width: 1200, height: 1600 };
    return {
      renderFormat: "pages",
      engine: "quicklook-thumb",
      totalPages: 1,
      loadedPageStart: 1,
      loadedPageEnd: 1,
      pages: [
        {
          pageNumber: 1,
          widthPx: dims.width,
          heightPx: dims.height,
          imageDataUrl: `data:image/png;base64,${buf.toString("base64")}`,
        },
      ],
    };
  } catch {
    return null;
  }
}

function parseDelimitedTable(rawText: string, delimiter: string): DocPreviewSheet {
  const lines = rawText.split(/\r?\n/).filter((line) => line.length > 0).slice(0, 350);
  const rows: string[][] = [];
  let maxCols = 0;
  for (const line of lines) {
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delimiter && !inQuotes) {
        cells.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    cells.push(current);
    rows.push(cells);
    maxCols = Math.max(maxCols, cells.length);
  }
  const trs = rows.map((r, idx) => {
    const tag = idx === 0 ? "th" : "td";
    const padded = [...r, ...Array(Math.max(0, maxCols - r.length)).fill("")];
    return `<tr>${padded.map((c) => `<${tag}>${escapeHtml(c)}</${tag}>`).join("")}</tr>`;
  });
  return {
    name: "Sheet 1",
    rowCount: rows.length,
    colCount: maxCols,
    html: wrapPaperHtml(`<table>${trs.join("")}</table>`),
  };
}

function renderLightweightMarkdownOrTextHtml(rawText: string, ext: string): string {
  if (ext !== "md" && ext !== "markdown") {
    return wrapPaperHtml(`<pre>${escapeHtml(rawText)}</pre>`, "text");
  }
  const lines = rawText.split(/\r?\n/);
  const htmlParts: string[] = [];
  let inCode = false;
  let codeBuf: string[] = [];
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCode) {
        htmlParts.push(`<pre>${escapeHtml(codeBuf.join("\n"))}</pre>`);
        codeBuf = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }
    if (/^###\s+/.test(line)) {
      htmlParts.push(`<h3>${escapeHtml(line.replace(/^###\s+/, ""))}</h3>`);
    } else if (/^##\s+/.test(line)) {
      htmlParts.push(`<h2>${escapeHtml(line.replace(/^##\s+/, ""))}</h2>`);
    } else if (/^#\s+/.test(line)) {
      htmlParts.push(`<h1>${escapeHtml(line.replace(/^#\s+/, ""))}</h1>`);
    } else if (/^\s*[-*]\s+/.test(line)) {
      htmlParts.push(`<p>• ${escapeHtml(line.replace(/^\s*[-*]\s+/, ""))}</p>`);
    } else if (line.trim().length > 0) {
      htmlParts.push(`<p>${escapeHtml(line)}</p>`);
    }
  }
  if (codeBuf.length > 0) {
    htmlParts.push(`<pre>${escapeHtml(codeBuf.join("\n"))}</pre>`);
  }
  return wrapPaperHtml(htmlParts.join("\n"), "markdown");
}

export async function handlePreviewDocument(
  input: RpcInput<typeof previewDocumentRpc>,
  context: PluginHandlerContext,
): Promise<RpcOutput<typeof previewDocumentRpc>> {
  const startedAt = Date.now();
  const { workspaceDir, resolvedPath, exists } = await resolveExistingFilePath(
    context,
    input.path,
    input.workspaceId,
    input.workspaceRoot,
  );

  const fileName = path.basename(resolvedPath);
  const ext = path.extname(resolvedPath).replace(/^\./, "").toLowerCase();
  const kind = classifyDocumentKind(ext);
  const relRaw = path.relative(workspaceDir, resolvedPath);
  const relativePath = relRaw && !relRaw.startsWith("..") ? relRaw : resolvedPath;

  if (!exists) {
    return {
      ok: false,
      exists: false,
      absolutePath: resolvedPath,
      relativePath,
      fileName,
      extension: ext,
      sizeBytes: 0,
      sizeFormatted: "0 B",
      modifiedIso: "",
      modifiedRelative: "",
      kind,
      renderFormat: "error",
      engine: "none",
      cached: false,
      durationMs: Date.now() - startedAt,
      totalPages: 0,
      loadedPageStart: 0,
      loadedPageEnd: 0,
      hasMorePages: false,
      supportsNativeFrame: ext === "pdf",
      pages: [],
      errorMessage: `Document not found: ${input.path}`,
    };
  }

  const stat = await fs.stat(resolvedPath);
  const realPath = await fs.realpath(resolvedPath).catch(() => resolvedPath);
  const dpi = input.dpi ?? 144;
  const pageStart = input.pageStart ?? 1;
  const pageLimit = input.pageLimit ?? 6;
  const cacheKey = computeFileCacheKey(realPath, stat.size, stat.mtimeMs, dpi);
  const cacheDir = path.join(DOC_PREVIEW_CACHE_ROOT, cacheKey);

  if (input.forceRefresh) {
    await fs.rm(cacheDir, { recursive: true, force: true }).catch(() => undefined);
  }
  await fs.mkdir(cacheDir, { recursive: true });

  const baseFields = {
    ok: true,
    exists: true,
    absolutePath: realPath,
    relativePath,
    fileName,
    extension: ext,
    sizeBytes: stat.size,
    sizeFormatted: formatBytes(stat.size),
    modifiedIso: new Date(stat.mtimeMs).toISOString(),
    modifiedRelative: formatRelativeTime(stat.mtimeMs),
    kind,
  };

  const pyInfo = await resolvePythonCapabilities();

  // 1. PDF Pipeline
  if (ext === "pdf") {
    if (pyInfo.bin && pyInfo.hasFitz) {
      const fitzRes = await renderPdfWithPyMuPdf(
        realPath,
        cacheDir,
        pageStart,
        pageLimit,
        dpi,
        pyInfo.bin,
      );
      if (fitzRes && fitzRes.pages.length > 0) {
        return {
          ...baseFields,
          renderFormat: "pages",
          engine: "pymupdf",
          cached: fitzRes.cached,
          durationMs: Date.now() - startedAt,
          title: fitzRes.title,
          author: fitzRes.author,
          totalPages: fitzRes.totalPages,
          loadedPageStart: fitzRes.loadedPageStart,
          loadedPageEnd: fitzRes.loadedPageEnd,
          hasMorePages: fitzRes.loadedPageEnd < fitzRes.totalPages,
          supportsNativeFrame: true,
          pages: fitzRes.pages,
          plainText: fitzRes.plainText || undefined,
        };
      }
    }

    const ppmRes = await renderPdfWithPdftoppm(realPath, cacheDir, pageStart, pageLimit, dpi);
    if (ppmRes && ppmRes.pages.length > 0) {
      return {
        ...baseFields,
        renderFormat: "pages",
        engine: "pdftoppm",
        cached: ppmRes.cached,
        durationMs: Date.now() - startedAt,
        totalPages: ppmRes.totalPages,
        loadedPageStart: ppmRes.loadedPageStart,
        loadedPageEnd: ppmRes.loadedPageEnd,
        hasMorePages: ppmRes.loadedPageEnd < ppmRes.totalPages,
        supportsNativeFrame: true,
        pages: ppmRes.pages,
      };
    }

    return {
      ...baseFields,
      renderFormat: "native-only",
      engine: "document-frame",
      cached: false,
      durationMs: Date.now() - startedAt,
      totalPages: 1,
      loadedPageStart: 1,
      loadedPageEnd: 1,
      hasMorePages: false,
      supportsNativeFrame: true,
      pages: [],
    };
  }

  // 2. HTML Cache check for non-PDF documents
  const cachedHtmlJsonPath = path.join(cacheDir, "rendered_doc.json");
  if (!input.forceRefresh && fsSync.existsSync(cachedHtmlJsonPath)) {
    try {
      const raw = JSON.parse(await fs.readFile(cachedHtmlJsonPath, "utf8")) as Partial<DocPreviewResponse>;
      if (raw.renderFormat && (raw.htmlContent || (raw.pages && raw.pages.length > 0))) {
        return {
          ...baseFields,
          renderFormat: raw.renderFormat,
          engine: raw.engine ?? "cache",
          cached: true,
          durationMs: Date.now() - startedAt,
          totalPages: raw.totalPages ?? 1,
          loadedPageStart: raw.loadedPageStart ?? 1,
          loadedPageEnd: raw.loadedPageEnd ?? 1,
          hasMorePages: false,
          supportsNativeFrame: false,
          pages: raw.pages ?? [],
          sheets: raw.sheets,
          htmlContent: raw.htmlContent,
          plainText: raw.plainText,
        };
      }
    } catch {
      // Rebuild cache
    }
  }

  // 3. Compare-mode Image support
  if (kind === "image") {
    const buf = await fs.readFile(realPath);
    const mimeMap: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      gif: "image/gif",
      svg: "image/svg+xml",
    };
    const mime = mimeMap[ext] ?? "image/png";
    const dims = readPngDimensions(buf) ?? { width: 1200, height: 900 };
    return {
      ...baseFields,
      renderFormat: "pages",
      engine: "image-direct",
      cached: false,
      durationMs: Date.now() - startedAt,
      totalPages: 1,
      loadedPageStart: 1,
      loadedPageEnd: 1,
      hasMorePages: false,
      supportsNativeFrame: false,
      pages: [
        {
          pageNumber: 1,
          widthPx: dims.width,
          heightPx: dims.height,
          imageDataUrl: `data:${mime};base64,${buf.toString("base64")}`,
        },
      ],
    };
  }

  // 4. CSV / TSV / Markdown / Plain Text support (used in Multi-Doc Compare)
  if (ext === "csv" || ext === "tsv") {
    const rawText = await fs.readFile(realPath, "utf8");
    const sheet = parseDelimitedTable(rawText, ext === "tsv" ? "\t" : ",");
    return {
      ...baseFields,
      renderFormat: "sheets",
      engine: "delimited-table",
      cached: false,
      durationMs: Date.now() - startedAt,
      totalPages: 1,
      loadedPageStart: 1,
      loadedPageEnd: 1,
      hasMorePages: false,
      supportsNativeFrame: false,
      pages: [],
      sheets: [sheet],
      htmlContent: sheet.html,
      plainText: rawText.slice(0, 100000),
    };
  }

  if (kind === "text") {
    const rawText = await fs.readFile(realPath, "utf8");
    const htmlContent = renderLightweightMarkdownOrTextHtml(rawText, ext);
    return {
      ...baseFields,
      renderFormat: "html",
      engine: "markdown-paper",
      cached: false,
      durationMs: Date.now() - startedAt,
      totalPages: Math.max(1, Math.ceil(rawText.length / 3000)),
      loadedPageStart: 1,
      loadedPageEnd: 1,
      hasMorePages: false,
      supportsNativeFrame: false,
      pages: [],
      htmlContent,
      plainText: rawText.slice(0, 120000),
    };
  }

  // 5. Office CLI (docx / xlsx / pptx high-fidelity layout)
  const officeRes = await renderOfficeWithOfficeCli(realPath, ext);
  if (officeRes) {
    let sheets: DocPreviewSheet[] | undefined;
    if (ext === "xlsx") {
      const pySheets = await renderZipDocumentWithPythonStdlib(realPath, ext, pyInfo.bin);
      if (pySheets?.sheets && pySheets.sheets.length > 0) {
        sheets = pySheets.sheets;
      }
    }
    const payload = {
      renderFormat: sheets && sheets.length > 1 ? ("sheets" as const) : ("html" as const),
      engine: "officecli",
      totalPages: sheets ? sheets.length : officeRes.totalPages,
      loadedPageStart: 1,
      loadedPageEnd: sheets ? sheets.length : officeRes.totalPages,
      pages: [] as DocPreviewPage[],
      sheets,
      htmlContent: officeRes.htmlContent,
      plainText: officeRes.plainText || undefined,
    };
    await fs.writeFile(cachedHtmlJsonPath, JSON.stringify(payload), "utf8").catch(() => undefined);
    return {
      ...baseFields,
      ...payload,
      cached: false,
      durationMs: Date.now() - startedAt,
      hasMorePages: false,
      supportsNativeFrame: false,
    };
  }

  // 6. macOS textutil (doc / docx / rtf / odt)
  const textutilRes = await renderWithMacTextutil(realPath, ext);
  if (textutilRes) {
    const payload = {
      renderFormat: "html" as const,
      engine: "textutil",
      totalPages: textutilRes.totalPages,
      loadedPageStart: 1,
      loadedPageEnd: textutilRes.totalPages,
      pages: [] as DocPreviewPage[],
      htmlContent: textutilRes.htmlContent,
      plainText: textutilRes.plainText || undefined,
    };
    await fs.writeFile(cachedHtmlJsonPath, JSON.stringify(payload), "utf8").catch(() => undefined);
    return {
      ...baseFields,
      ...payload,
      cached: false,
      durationMs: Date.now() - startedAt,
      hasMorePages: false,
      supportsNativeFrame: false,
    };
  }

  // 7. Universal Python 3 stdlib OpenXML / ODF / EPUB parser
  const stdlibRes = await renderZipDocumentWithPythonStdlib(realPath, ext, pyInfo.bin);
  if (stdlibRes) {
    const payload = {
      renderFormat: stdlibRes.sheets ? ("sheets" as const) : ("html" as const),
      engine: "python-openxml",
      totalPages: stdlibRes.totalPages,
      loadedPageStart: 1,
      loadedPageEnd: stdlibRes.totalPages,
      pages: [] as DocPreviewPage[],
      sheets: stdlibRes.sheets,
      htmlContent: stdlibRes.htmlContent,
      plainText: stdlibRes.plainText || undefined,
    };
    await fs.writeFile(cachedHtmlJsonPath, JSON.stringify(payload), "utf8").catch(() => undefined);
    return {
      ...baseFields,
      ...payload,
      cached: false,
      durationMs: Date.now() - startedAt,
      hasMorePages: false,
      supportsNativeFrame: false,
    };
  }

  // 8. macOS QuickLook fallback (.pages, .numbers, .key, .ppt, .xls)
  const qlRes = await renderWithMacQuickLook(
    realPath,
    cacheDir,
    pageStart,
    pageLimit,
    dpi,
    pyInfo.bin,
    pyInfo.hasFitz,
  );
  if (qlRes) {
    return {
      ...baseFields,
      renderFormat: qlRes.renderFormat,
      engine: qlRes.engine,
      cached: false,
      durationMs: Date.now() - startedAt,
      totalPages: qlRes.totalPages,
      loadedPageStart: qlRes.loadedPageStart,
      loadedPageEnd: qlRes.loadedPageEnd,
      hasMorePages: qlRes.loadedPageEnd < qlRes.totalPages,
      supportsNativeFrame: false,
      pages: qlRes.pages,
      htmlContent: qlRes.htmlContent,
      plainText: qlRes.plainText,
    };
  }

  return {
    ...baseFields,
    renderFormat: "error",
    engine: "none",
    cached: false,
    durationMs: Date.now() - startedAt,
    totalPages: 0,
    loadedPageStart: 0,
    loadedPageEnd: 0,
    hasMorePages: false,
    supportsNativeFrame: false,
    pages: [],
    errorMessage: `No local preview converter matched .${ext}. Use Open with default application to view externally.`,
  };
}

export async function handleListSiblingDocuments(
  input: RpcInput<typeof listSiblingDocumentsRpc>,
  context: PluginHandlerContext,
): Promise<RpcOutput<typeof listSiblingDocumentsRpc>> {
  const workspaceRoot = await resolveWorkspaceDirectory(
    context,
    input.workspaceId,
    input.workspaceRoot,
  );

  let currentResolved = "";
  let currentDir = "";
  if (input.currentPath && input.currentPath.trim()) {
    const resolved = await resolveExistingFilePath(
      context,
      input.currentPath,
      input.workspaceId,
      workspaceRoot,
    );
    currentResolved = resolved.exists
      ? await fs.realpath(resolved.resolvedPath).catch(() => resolved.resolvedPath)
      : resolved.resolvedPath;
    currentDir = path.dirname(currentResolved);
  }

  const found = new Map<string, SiblingDocumentItem & { mtimeMs: number }>();

  const collectDir = async (dir: string, sameDirectory: boolean, maxDepth: number, depth = 0) => {
    if (depth > maxDepth || found.size >= 120) return;
    let entries: fsSync.Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name.startsWith(".")) continue;
      const fullPath = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!IGNORED_SCAN_DIRS.has(ent.name) && depth < maxDepth) {
          await collectDir(fullPath, false, maxDepth, depth + 1);
        }
        continue;
      }
      if (!ent.isFile() || !isSupportedCompareExtension(ent.name)) continue;
      const real = await fs.realpath(fullPath).catch(() => fullPath);
      if (currentResolved && real === currentResolved) continue;
      if (found.has(real)) continue;
      try {
        const st = await fs.stat(real);
        const ext = path.extname(real).replace(/^\./, "").toLowerCase();
        const relRaw = path.relative(workspaceRoot, real);
        const relativePath = relRaw && !relRaw.startsWith("..") ? relRaw : real;
        found.set(real, {
          fileName: path.basename(real),
          absolutePath: real,
          relativePath,
          extension: ext,
          kind: classifyDocumentKind(ext),
          sizeFormatted: formatBytes(st.size),
          modifiedRelative: formatRelativeTime(st.mtimeMs),
          sameDirectory: sameDirectory || (Boolean(currentDir) && path.dirname(real) === currentDir),
          mtimeMs: st.mtimeMs,
        });
      } catch {
        // Skip unreadable
      }
    }
  };

  if (currentDir) {
    await collectDir(currentDir, true, 1);
  }
  await collectDir(workspaceRoot, false, 3);

  const sorted = [...found.values()]
    .sort((a, b) => {
      if (a.sameDirectory !== b.sameDirectory) return a.sameDirectory ? -1 : 1;
      const aIsDoc = (SUPPORTED_DOCUMENT_EXTENSIONS as readonly string[]).includes(a.extension);
      const bIsDoc = (SUPPORTED_DOCUMENT_EXTENSIONS as readonly string[]).includes(b.extension);
      if (aIsDoc !== bIsDoc) return aIsDoc ? -1 : 1;
      return b.mtimeMs - a.mtimeMs;
    })
    .slice(0, input.limit ?? 24)
    .map(({ mtimeMs: _m, ...rest }) => rest);

  return {
    ok: true,
    workspaceRoot,
    items: sorted,
  };
}

async function computeCacheStats(): Promise<{ count: number; bytes: number }> {
  let count = 0;
  let bytes = 0;
  async function walk(dir: string) {
    let entries: fsSync.Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(full);
      } else if (ent.isFile()) {
        try {
          const st = await fs.stat(full);
          count += 1;
          bytes += st.size;
        } catch {
          // Ignore
        }
      }
    }
  }
  await walk(DOC_PREVIEW_CACHE_ROOT);
  return { count, bytes };
}

export async function handleDiagnoseDocPreview(
  input: RpcInput<typeof diagnoseDocPreviewRpc>,
  context: PluginHandlerContext,
): Promise<RpcOutput<typeof diagnoseDocPreviewRpc>> {
  if (input.action === "clear_cache") {
    await fs.rm(DOC_PREVIEW_CACHE_ROOT, { recursive: true, force: true }).catch(() => undefined);
  }

  const pyInfo = await resolvePythonCapabilities();
  const officeCli = resolveBinaryCandidate("officecli");
  const pdftoppm = resolveBinaryCandidate("pdftoppm");
  const textutil = process.platform === "darwin" ? resolveBinaryCandidate("textutil") : null;
  const qlmanage = process.platform === "darwin" ? resolveBinaryCandidate("qlmanage") : null;

  const engines = [
    {
      id: "pymupdf",
      available: Boolean(pyInfo.bin && pyInfo.hasFitz),
      detail: pyInfo.bin && pyInfo.hasFitz ? `${pyInfo.bin} (fitz)` : "not installed",
    },
    {
      id: "officecli",
      available: Boolean(officeCli),
      detail: officeCli ?? "not installed",
    },
    {
      id: "pdftoppm",
      available: Boolean(pdftoppm),
      detail: pdftoppm ?? "not installed",
    },
    {
      id: "textutil",
      available: Boolean(textutil),
      detail: textutil ?? "unavailable",
    },
    {
      id: "quicklook",
      available: Boolean(qlmanage),
      detail: qlmanage ?? "unavailable",
    },
    {
      id: "python-openxml",
      available: Boolean(pyInfo.bin),
      detail: pyInfo.bin ? `${pyInfo.bin} (stdlib zipfile+xml)` : "not installed",
    },
  ];

  let probeResult: DocPreviewResponse | undefined;
  if (input.action === "probe" && input.path && input.path.trim()) {
    probeResult = await handlePreviewDocument(
      {
        workspaceId: input.workspaceId,
        workspaceRoot: input.workspaceRoot,
        path: input.path.trim(),
        pageStart: 1,
        pageLimit: 3,
        dpi: 144,
      },
      context,
    );
  }

  const cacheStats = await computeCacheStats();
  const availableCount = engines.filter((e) => e.available).length;
  const message =
    input.action === "clear_cache"
      ? "Cleared document preview render cache."
      : probeResult
        ? probeResult.ok
          ? `Rendered ${probeResult.fileName} via ${probeResult.engine} (${probeResult.totalPages}p, ${probeResult.durationMs}ms)`
          : probeResult.errorMessage ?? "Probe failed"
        : `${availableCount}/${engines.length} engines active · ${SUPPORTED_DOCUMENT_EXTENSIONS.length} formats registered`;

  return {
    ok: probeResult ? probeResult.ok : true,
    supportedExtensions: [...SUPPORTED_DOCUMENT_EXTENSIONS],
    compareExtensions: [...SUPPORTED_COMPARE_EXTENSIONS],
    engines,
    cacheDir: DOC_PREVIEW_CACHE_ROOT,
    cacheFileCount: cacheStats.count,
    cacheBytesFormatted: formatBytes(cacheStats.bytes),
    probeResult,
    message,
  };
}
