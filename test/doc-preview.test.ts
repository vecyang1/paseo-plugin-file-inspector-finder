import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import {
  SUPPORTED_DOCUMENT_EXTENSIONS,
  classifyDocumentKind,
  clampPanScroll,
  computeNextZoomStep,
  computeSyncedScrollOffset,
  isSupportedCompareExtension,
  isSupportedDocumentExtension,
  sanitizePreviewHtml,
} from "../shared/doc-preview-contracts";
import {
  DEFAULT_DOC_PREVIEW_PREFS,
  getDocPreviewRuntimeStatus,
  readDocPreviewPrefs,
  resetDocPreviewPrefs,
  runDocPreviewWebSelfTest,
  syncDocPreviewPrefs,
  syncDocumentPanelAssociations,
} from "../client/doc-preview-web";
import { FILE_PATH_TOKEN_REGEX } from "../client/web";
import {
  handleDiagnoseDocPreview,
  handleListSiblingDocuments,
  handlePreviewDocument,
} from "../server/doc-preview-handlers";

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  } as Storage;
}

function makeFakeHandlerContext(workspaceDir: string) {
  return {
    paseo: {
      workspaces: {
        ref: () => ({
          directory: workspaceDir,
          current: () => ({ workspaceDirectory: workspaceDir }),
          refresh: async () => ({ workspaceDirectory: workspaceDir }),
        }),
        list: async () => ({
          entries: [{ id: "wks_doc_test", name: "DocWorkspace", workspaceDirectory: workspaceDir }],
        }),
      },
    },
  } as never;
}

function createSampleOpenXmlFixtures(dir: string): {
  docxPath: string;
  xlsxPath: string;
  pptxPath: string;
  pdfPath: string;
  csvPath: string;
  mdPath: string;
} {
  const docxPath = path.join(dir, "sample-report.docx");
  const xlsxPath = path.join(dir, "sample-metrics.xlsx");
  const pptxPath = path.join(dir, "sample-deck.pptx");
  const pdfPath = path.join(dir, "sample-brief.pdf");
  const csvPath = path.join(dir, "sample-table.csv");
  const mdPath = path.join(dir, "sample-notes.md");

  fs.writeFileSync(csvPath, "Quarter,Revenue,Margin\nQ1,120000,42%\nQ2,165000,46%\n", "utf8");
  fs.writeFileSync(mdPath, "# Quarterly Notes\n\n- Pipeline verified\n- Margin expanded\n", "utf8");

  // Minimal valid 1-page PDF with text "Hello Paseo PDF Preview"
  const minimalPdf = [
    "%PDF-1.4",
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj",
    "4 0 obj << /Length 55 >> stream",
    "BT /F1 18 Tf 72 740 Td (Hello Paseo PDF Preview) Tj ET",
    "endstream endobj",
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    "xref",
    "0 6",
    "0000000000 65535 f ",
    "0000000009 00000 n ",
    "0000000058 00000 n ",
    "0000000115 00000 n ",
    "0000000241 00000 n ",
    "0000000346 00000 n ",
    "trailer << /Size 6 /Root 1 0 R >>",
    "startxref",
    "416",
    "%%EOF",
  ].join("\n");
  fs.writeFileSync(pdfPath, minimalPdf, "utf8");

  // Create valid ZIP-based .docx, .xlsx, .pptx via python3 stdlib zipfile
  const pyGen = `
import sys, zipfile

docx_p, xlsx_p, pptx_p = sys.argv[1], sys.argv[2], sys.argv[3]

with zipfile.ZipFile(docx_p, "w") as zf:
    zf.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    zf.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
    zf.writestr("word/document.xml", '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Executive Summary</w:t></w:r></w:p><w:p><w:r><w:t>Multi-document preview supports smooth scroll and drag.</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Metric</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Status</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Latency</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Fast</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>')

with zipfile.ZipFile(xlsx_p, "w") as zf:
    zf.writestr("xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Overview" sheetId="1" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><sheet name="Forecast" sheetId="2" r:id="rId2" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></sheets></workbook>')
    zf.writestr("xl/sharedStrings.xml", '<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Channel</t></si><si><t>ROAS</t></si><si><t>Search</t></si></sst>')
    zf.writestr("xl/worksheets/sheet1.xml", '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>4.2</v></c></row></sheetData></worksheet>')
    zf.writestr("xl/worksheets/sheet2.xml", '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Month</t></is></c><c r="B1"><v>100</v></c></row></sheetData></worksheet>')

with zipfile.ZipFile(pptx_p, "w") as zf:
    zf.writestr("ppt/slides/slide1.xml", '<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Architecture Deck</a:t></a:r></a:p><a:p><a:r><a:t>Slide 1 Subtitle</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>')
    zf.writestr("ppt/slides/slide2.xml", '<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Rollout Milestones</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>')
`;
  execFileSync("python3", ["-c", pyGen, docxPath, xlsxPath, pptxPath]);
  return { docxPath, xlsxPath, pptxPath, pdfPath, csvPath, mdPath };
}

test("DocPreview 1: document format classification & FILE_PATH_TOKEN_REGEX match binary document links", () => {
  assert.equal(classifyDocumentKind("Resume.pdf"), "pdf");
  assert.equal(classifyDocumentKind("Proposal.DOCX"), "word");
  assert.equal(classifyDocumentKind("Budget.xlsx"), "spreadsheet");
  assert.equal(classifyDocumentKind("Roadmap.pptx"), "presentation");
  assert.equal(classifyDocumentKind("Handbook.epub"), "ebook");
  assert.equal(classifyDocumentKind("Deck.key"), "iwork");
  assert.equal(classifyDocumentKind("unknown.bin"), "unknown");

  for (const ext of SUPPORTED_DOCUMENT_EXTENSIONS) {
    assert.equal(isSupportedDocumentExtension(`report.${ext}`), true);
    assert.equal(isSupportedCompareExtension(`report.${ext}`), true);
  }
  assert.equal(isSupportedDocumentExtension("notes.md"), false);
  assert.equal(isSupportedCompareExtension("notes.md"), true);

  for (const token of [
    "Vector_Resume.pdf",
    "Vector_Resume.docx",
    "Q4_Financials.xlsx",
    "Product_Pitch.pptx",
    "Manual_v2.epub",
  ]) {
    assert.equal(FILE_PATH_TOKEN_REGEX.test(token), true, `expected regex match for ${token}`);
  }
});

test("DocPreview 2: pan drag clamping, zoom steps, sync-scroll ratio, and HTML sanitizer invariants", () => {
  const selfRes = runDocPreviewWebSelfTest();
  assert.equal(selfRes.ok, true, selfRes.summary);

  // Boundary clamping prevents negative scroll or overshooting scrollWidth/scrollHeight
  assert.deepEqual(
    clampPanScroll({
      startScrollLeft: 20,
      startScrollTop: 30,
      deltaX: 100,
      deltaY: -5000,
      maxScrollLeft: 400,
      maxScrollTop: 900,
    }),
    { scrollLeft: 0, scrollTop: 900 },
  );

  // Sync scroll handles 0-scrollable containers safely without NaN
  assert.equal(
    computeSyncedScrollOffset({
      sourceScrollTop: 0,
      sourceScrollHeight: 400,
      sourceClientHeight: 400,
      targetScrollHeight: 1000,
      targetClientHeight: 400,
    }),
    0,
  );

  assert.equal(computeNextZoomStep(3, "in"), 3);
  assert.equal(computeNextZoomStep(0.5, "out"), 0.5);

  const sanitized = sanitizePreviewHtml(
    `<div class="page" onload="bad()"><p>Clean text</p><script>steal()</script><iframe src="x"></iframe><a href="javascript:alert(1)">Link</a></div>`,
  );
  assert.equal(sanitized.includes("<script"), false);
  assert.equal(sanitized.includes("<iframe"), false);
  assert.equal(sanitized.includes("onload"), false);
  assert.equal(sanitized.includes("javascript:"), false);
  assert.equal(sanitized.includes("Clean text"), true);
});

test("DocPreview 3: filePanelAssociations & preferences persist and toggle cleanly", () => {
  const storage = createMemoryStorage();
  const countOn = syncDocumentPanelAssociations("file-inspector-finder", "doc-inspector", true, storage);
  assert.equal(countOn, SUPPORTED_DOCUMENT_EXTENSIONS.length);

  const statusOn = getDocPreviewRuntimeStatus(storage);
  assert.equal(statusOn.associatedCount, SUPPORTED_DOCUMENT_EXTENSIONS.length);
  assert.deepEqual(statusOn.prefs, DEFAULT_DOC_PREVIEW_PREFS);

  syncDocPreviewPrefs(
    {
      defaultInteractionMode: "select",
      defaultPdfMode: "native",
      defaultDropBehavior: "tabs",
      autoAssociateDocumentPanels: false,
    },
    storage,
  );
  const prefsUpdated = readDocPreviewPrefs(storage);
  assert.equal(prefsUpdated.defaultInteractionMode, "select");
  assert.equal(prefsUpdated.defaultPdfMode, "native");
  assert.equal(prefsUpdated.defaultDropBehavior, "tabs");
  assert.equal(getDocPreviewRuntimeStatus(storage).associatedCount, 0);

  const restored = resetDocPreviewPrefs(storage);
  assert.deepEqual(restored, DEFAULT_DOC_PREVIEW_PREFS);
  assert.equal(getDocPreviewRuntimeStatus(storage).associatedCount, SUPPORTED_DOCUMENT_EXTENSIONS.length);
});

test("DocPreview 4: server renders DOCX, XLSX, PPTX, PDF, CSV, MD and caches repeat reads", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-doc-test-"));
  try {
    const fixtures = createSampleOpenXmlFixtures(tmpDir);
    const ctx = makeFakeHandlerContext(tmpDir);

    // DOCX
    const docx1 = await handlePreviewDocument(
      { path: "sample-report.docx", pageStart: 1, pageLimit: 6, dpi: 120 },
      ctx,
    );
    assert.equal(docx1.ok, true);
    assert.equal(docx1.kind, "word");
    assert.ok((docx1.htmlContent ?? "").includes("Executive Summary"));
    const docx2 = await handlePreviewDocument(
      { path: "sample-report.docx", pageStart: 1, pageLimit: 6, dpi: 120 },
      ctx,
    );
    assert.equal(docx2.cached, true);

    // XLSX (multi-sheet)
    const xlsxRes = await handlePreviewDocument(
      { path: "sample-metrics.xlsx", pageStart: 1, pageLimit: 6, dpi: 120 },
      ctx,
    );
    assert.equal(xlsxRes.ok, true);
    assert.equal(xlsxRes.kind, "spreadsheet");
    assert.ok((xlsxRes.sheets?.length ?? 0) >= 2 || (xlsxRes.htmlContent ?? "").includes("Channel"));

    // PPTX (multi-slide)
    const pptxRes = await handlePreviewDocument(
      { path: "sample-deck.pptx", pageStart: 1, pageLimit: 6, dpi: 120 },
      ctx,
    );
    assert.equal(pptxRes.ok, true);
    assert.equal(pptxRes.kind, "presentation");
    assert.ok(pptxRes.totalPages >= 2 || (pptxRes.htmlContent ?? "").includes("Architecture Deck"));

    // PDF
    const pdfRes = await handlePreviewDocument(
      { path: "sample-brief.pdf", pageStart: 1, pageLimit: 6, dpi: 120 },
      ctx,
    );
    assert.equal(pdfRes.ok, true);
    assert.equal(pdfRes.kind, "pdf");
    assert.equal(pdfRes.supportsNativeFrame, true);
    assert.ok(pdfRes.totalPages >= 1);

    // Sibling discovery for Multi-Doc Compare
    const siblings = await handleListSiblingDocuments(
      { currentPath: "sample-brief.pdf", limit: 10 },
      ctx,
    );
    assert.equal(siblings.ok, true);
    const names = siblings.items.map((i) => i.fileName);
    assert.ok(names.includes("sample-report.docx"));
    assert.ok(names.includes("sample-metrics.xlsx"));
    assert.ok(!names.includes("sample-brief.pdf"), "current file excluded from compare candidates");

    // Diagnostics & probe
    const diag = await handleDiagnoseDocPreview(
      { action: "probe", path: "sample-report.docx" },
      ctx,
    );
    assert.equal(diag.ok, true);
    assert.equal(diag.probeResult?.ok, true);

    // Missing file fails cleanly without throwing
    const missing = await handlePreviewDocument(
      { path: "does-not-exist.pdf", pageStart: 1, pageLimit: 6, dpi: 120 },
      ctx,
    );
    assert.equal(missing.ok, false);
    assert.equal(missing.exists, false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
