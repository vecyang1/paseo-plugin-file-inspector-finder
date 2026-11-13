import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type {
  IntakeDecisionItem,
  manageIntakeDecisionsRpc,
} from "../shared/intake-decisions-contracts";
import { navigateToPaseoWorkspace } from "./schedule-runs-web";
import { syncPaseoThemeCssVariables } from "./theme-web";
import type { MinimalWindow } from "./web";

type ManageDecisionsFn = (
  input: RpcInput<typeof manageIntakeDecisionsRpc>,
) => Promise<RpcOutput<typeof manageIntakeDecisionsRpc>>;

const DRAWER_ID = "paseo-finder-intake-decisions-overlay";
const STYLE_ID = "paseo-finder-intake-decisions-style";
const PREFS_KEY = "paseo:finder-plugin:intake-decisions-prefs";
const GLOBAL_HANDLE_KEY = "__paseoFinderIntakeDecisionsHandle";

export interface IntakeDecisionsPrefs {
  enableShortcut: boolean;
}

function detectZhLocale(win: Window): boolean {
  try {
    const htmlLang = win.document?.documentElement?.getAttribute("lang") ?? "";
    if (htmlLang.toLowerCase().startsWith("zh")) return true;
    const navLang = win.navigator?.language ?? "";
    return navLang.toLowerCase().startsWith("zh");
  } catch {
    return false;
  }
}

export function readIntakeDecisionsPrefs(
  win?: MinimalWindow | Window | null,
): IntakeDecisionsPrefs {
  try {
    const target = (win ?? (typeof window !== "undefined" ? window : null)) as
      | { localStorage?: { getItem(k: string): string | null } }
      | null;
    const raw = target?.localStorage?.getItem(PREFS_KEY);
    if (!raw) return { enableShortcut: true };
    const parsed = JSON.parse(raw) as Partial<IntakeDecisionsPrefs>;
    return { enableShortcut: parsed.enableShortcut !== false };
  } catch {
    return { enableShortcut: true };
  }
}

export function writeIntakeDecisionsPrefs(
  prefs: IntakeDecisionsPrefs,
  win?: MinimalWindow | Window | null,
): void {
  try {
    const target = (win ?? (typeof window !== "undefined" ? window : null)) as
      | { localStorage?: { setItem(k: string, v: string): void } }
      | null;
    target?.localStorage?.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage write errors in private contexts
  }
}

function bucketLabel(bucket: string, isZh: boolean): string {
  switch (bucket) {
    case "spend_or_purchase":
      return isZh ? "费用与采购" : "Spend & Purchase";
    case "external_outreach":
      return isZh ? "外部沟通" : "External Outreach";
    case "credentials_or_auth":
      return isZh ? "凭据与授权" : "Credentials & Auth";
    default:
      return isZh ? "产品与架构" : "Product & Scope";
  }
}

function ensureDrawerStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${DRAWER_ID} {
      position: fixed;
      inset: 0;
      z-index: 9998;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.36);
      padding: 20px;
      box-sizing: border-box;
      font-family: -apple-system, BlinkMacSystemFont, "Inter", "SF Pro Text", sans-serif;
    }
    .pf-id-card {
      width: min(900px, 95vw);
      height: min(640px, 88vh);
      display: flex;
      flex-direction: column;
      background: var(--paseo-finder-surface-0);
      color: var(--paseo-finder-fg);
      border: 1px solid var(--paseo-finder-border);
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.24);
    }
    .pf-id-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid var(--paseo-finder-border);
      background: var(--paseo-finder-surface-1);
      gap: 12px;
    }
    .pf-id-title-group {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .pf-id-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--paseo-finder-fg);
    }
    .pf-id-pill {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 999px;
      background: var(--paseo-finder-surface-2);
      color: var(--paseo-finder-fg-muted);
      border: 1px solid var(--paseo-finder-border);
      white-space: nowrap;
    }
    .pf-id-body {
      flex: 1;
      min-height: 0;
      display: grid;
      grid-template-columns: 300px 1fr;
    }
    @media (max-width: 720px) {
      .pf-id-body {
        grid-template-columns: 1fr;
      }
    }
    .pf-id-list {
      border-right: 1px solid var(--paseo-finder-border);
      overflow-y: auto;
      background: var(--paseo-finder-surface-1);
      padding: 6px;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .pf-id-row {
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 9px 10px;
      min-height: 44px;
      border-radius: 8px;
      border: 1px solid transparent;
      background: transparent;
      color: var(--paseo-finder-fg);
      text-align: left;
      cursor: pointer;
      box-sizing: border-box;
    }
    .pf-id-row:hover {
      background: var(--paseo-finder-surface-2);
    }
    .pf-id-row[data-active="true"] {
      background: var(--paseo-finder-surface-2);
      border-color: var(--paseo-finder-border-accent);
    }
    .pf-id-row-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      font-size: 11px;
      color: var(--paseo-finder-fg-muted);
    }
    .pf-id-row-title {
      font-size: 12.5px;
      font-weight: 500;
      line-height: 1.35;
      color: var(--paseo-finder-fg);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .pf-id-detail {
      padding: 16px 18px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
      background: var(--paseo-finder-surface-0);
    }
    .pf-id-detail-title {
      font-size: 15px;
      font-weight: 600;
      line-height: 1.4;
      color: var(--paseo-finder-fg);
      margin: 0;
    }
    .pf-id-summary {
      font-size: 12.5px;
      line-height: 1.55;
      color: var(--paseo-finder-fg-muted);
      padding: 10px 12px;
      border-radius: 8px;
      background: var(--paseo-finder-surface-1);
      border: 1px solid var(--paseo-finder-border);
    }
    .pf-id-options {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .pf-id-opt {
      flex-shrink: 0;
      display: flex;
      align-items: flex-start;
      gap: 10px;
      min-height: 44px;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid var(--paseo-finder-border);
      background: var(--paseo-finder-surface-1);
      color: var(--paseo-finder-fg);
      text-align: left;
      cursor: pointer;
      font-size: 12.5px;
      line-height: 1.45;
      box-sizing: border-box;
    }
    .pf-id-opt:hover {
      background: var(--paseo-finder-surface-2);
    }
    .pf-id-opt[data-selected="true"] {
      background: var(--paseo-finder-surface-2);
      border-color: var(--paseo-finder-primary);
    }
    .pf-id-opt-num {
      flex-shrink: 0;
      width: 20px;
      height: 20px;
      border-radius: 5px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 600;
      background: var(--paseo-finder-surface-3);
      color: var(--paseo-finder-fg);
    }
    .pf-id-input {
      flex-shrink: 0;
      width: 100%;
      min-height: 40px;
      padding: 8px 11px;
      border-radius: 8px;
      border: 1px solid var(--paseo-finder-border);
      background: var(--paseo-finder-surface-1);
      color: var(--paseo-finder-fg);
      font-size: 12.5px;
      box-sizing: border-box;
      outline: none;
    }
    .pf-id-input:focus {
      border-color: var(--paseo-finder-primary);
    }
    .pf-id-actions {
      flex-shrink: 0;
      position: sticky;
      bottom: -16px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      padding: 10px 0 4px;
      margin-top: auto;
      background: var(--paseo-finder-surface-0);
      border-top: 1px solid var(--paseo-finder-border);
    }
    .pf-id-btn {
      min-height: 36px;
      padding: 0 13px;
      border-radius: 8px;
      border: 1px solid var(--paseo-finder-border);
      background: var(--paseo-finder-surface-2);
      color: var(--paseo-finder-fg);
      font-size: 12.5px;
      font-weight: 500;
      cursor: pointer;
    }
    .pf-id-btn:hover {
      background: var(--paseo-finder-surface-3);
    }
    .pf-id-btn-primary {
      background: var(--paseo-finder-primary);
      color: var(--paseo-finder-primary-fg);
      border-color: var(--paseo-finder-primary);
    }
    .pf-id-btn-primary:hover {
      opacity: 0.92;
      background: var(--paseo-finder-primary);
    }
    .pf-id-preview {
      font-size: 11.5px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      line-height: 1.45;
      padding: 10px;
      border-radius: 8px;
      background: var(--paseo-finder-surface-1);
      border: 1px solid var(--paseo-finder-border);
      color: var(--paseo-finder-fg-muted);
      white-space: pre-wrap;
      max-height: 140px;
      overflow-y: auto;
    }
  `;
  doc.head.appendChild(style);
}

let activeManageRpc: ManageDecisionsFn | null = null;

export function bindIntakeDecisionsRpc(fn: ManageDecisionsFn): void {
  activeManageRpc = fn;
}

export async function openIntakeDecisionsDrawer(
  rpcOverride?: ManageDecisionsFn,
  initialTaskId?: string,
): Promise<boolean> {
  if (typeof window === "undefined" || !window.document?.body) return false;
  const rpc = rpcOverride ?? activeManageRpc;
  if (!rpc) return false;

  const doc = window.document;
  syncPaseoThemeCssVariables(doc, window);
  ensureDrawerStyles(doc);
  const isZh = detectZhLocale(window);

  const existing = doc.getElementById(DRAWER_ID);
  if (existing) existing.remove();

  const overlay = doc.createElement("div");
  overlay.id = DRAWER_ID;
  overlay.setAttribute("data-testid", "intake-decisions-drawer");

  const card = doc.createElement("div");
  card.className = "pf-id-card";
  overlay.appendChild(card);

  let items: IntakeDecisionItem[] = [];
  let selectedIdx = 0;
  let selectedChoice: number | undefined = undefined;
  let customNote = "";
  let previewBoxText = "";
  let statusBanner = "";
  let busy = false;

  const closeDrawer = () => {
    window.removeEventListener("keydown", onModalKeyDown, true);
    overlay.remove();
  };

  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) closeDrawer();
  });

  const selectTaskIndex = (idx: number) => {
    if (items.length === 0) {
      selectedIdx = 0;
      selectedChoice = undefined;
      return;
    }
    selectedIdx = Math.max(0, Math.min(items.length - 1, idx));
    const cur = items[selectedIdx];
    const rec = cur?.options.find((o) => o.recommended) ?? cur?.options[0];
    selectedChoice = rec?.index;
    customNote = "";
    previewBoxText = "";
  };

  const render = () => {
    card.replaceChildren();

    const header = doc.createElement("div");
    header.className = "pf-id-header";

    const titleGroup = doc.createElement("div");
    titleGroup.className = "pf-id-title-group";

    const hTitle = doc.createElement("span");
    hTitle.className = "pf-id-title";
    hTitle.textContent = isZh ? "待拍板任务队列" : "Task Decisions Queue";
    titleGroup.appendChild(hTitle);

    const countPill = doc.createElement("span");
    countPill.className = "pf-id-pill";
    countPill.setAttribute("data-testid", "intake-decisions-count");
    countPill.textContent = isZh ? `${items.length} 项待定` : `${items.length} pending`;
    titleGroup.appendChild(countPill);

    if (statusBanner) {
      const msgPill = doc.createElement("span");
      msgPill.className = "pf-id-pill";
      msgPill.textContent = statusBanner;
      titleGroup.appendChild(msgPill);
    }

    const headerActions = doc.createElement("div");
    headerActions.style.display = "flex";
    headerActions.style.gap = "6px";

    const refreshBtn = doc.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "pf-id-btn";
    refreshBtn.textContent = isZh ? "刷新" : "Refresh";
    refreshBtn.disabled = busy;
    refreshBtn.addEventListener("click", () => {
      void loadList(true);
    });
    headerActions.appendChild(refreshBtn);

    const closeBtn = doc.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "pf-id-btn";
    closeBtn.setAttribute("data-testid", "intake-decisions-close");
    closeBtn.textContent = isZh ? "关闭" : "Close";
    closeBtn.addEventListener("click", closeDrawer);
    headerActions.appendChild(closeBtn);

    header.appendChild(titleGroup);
    header.appendChild(headerActions);
    card.appendChild(header);

    const body = doc.createElement("div");
    body.className = "pf-id-body";

    const listEl = doc.createElement("div");
    listEl.className = "pf-id-list";

    if (items.length === 0) {
      const empty = doc.createElement("div");
      empty.style.padding = "24px 12px";
      empty.style.fontSize = "12.5px";
      empty.style.color = "var(--paseo-finder-fg-muted)";
      empty.textContent = busy
        ? isZh
          ? "正在读取队列..."
          : "Loading queue..."
        : isZh
          ? "当前没有等待拍板的阻塞任务。"
          : "No blocked tasks waiting for a decision.";
      listEl.appendChild(empty);
    } else {
      items.forEach((it, idx) => {
        const row = doc.createElement("button");
        row.type = "button";
        row.className = "pf-id-row";
        row.setAttribute("data-active", idx === selectedIdx ? "true" : "false");
        row.setAttribute("data-testid", `intake-decision-row-${it.shortId}`);

        const top = doc.createElement("div");
        top.className = "pf-id-row-top";
        const leftMeta = doc.createElement("span");
        leftMeta.textContent = `${it.shortId} · ${bucketLabel(it.bucket, isZh)}`;
        const rightMeta = doc.createElement("span");
        rightMeta.textContent = it.resumable
          ? isZh
            ? "原会话可续接"
            : "Resumable"
          : isZh
            ? "新建续跑"
            : "Spawn";
        top.appendChild(leftMeta);
        top.appendChild(rightMeta);

        const rowTitle = doc.createElement("div");
        rowTitle.className = "pf-id-row-title";
        rowTitle.textContent = it.title || it.shortId;

        row.appendChild(top);
        row.appendChild(rowTitle);
        row.addEventListener("click", () => {
          selectTaskIndex(idx);
          render();
        });
        listEl.appendChild(row);
      });
    }

    const detailEl = doc.createElement("div");
    detailEl.className = "pf-id-detail";

    const active = items[selectedIdx];
    if (active) {
      const dTitle = doc.createElement("h3");
      dTitle.className = "pf-id-detail-title";
      dTitle.textContent = active.title;
      detailEl.appendChild(dTitle);

      const metaLine = doc.createElement("div");
      metaLine.style.display = "flex";
      metaLine.style.flexWrap = "wrap";
      metaLine.style.gap = "6px";
      const metaItems = [
        `ID: ${active.shortId}`,
        active.profile,
        active.agentId
          ? isZh
            ? `会话: ${active.agentId.slice(0, 8)} (${active.agentLiveStatus ?? "idle"})`
            : `Agent: ${active.agentId.slice(0, 8)} (${active.agentLiveStatus ?? "idle"})`
          : isZh
            ? "无绑定会话"
            : "No bound agent",
        isZh ? `轮次: ${active.decisionRounds}` : `Rounds: ${active.decisionRounds}`,
      ];
      for (const m of metaItems) {
        const pill = doc.createElement("span");
        pill.className = "pf-id-pill";
        pill.textContent = m;
        metaLine.appendChild(pill);
      }
      detailEl.appendChild(metaLine);

      if (active.summary) {
        const sumBox = doc.createElement("div");
        sumBox.className = "pf-id-summary";
        sumBox.textContent = active.summary;
        detailEl.appendChild(sumBox);
      }

      if (active.options.length > 0) {
        const optsWrap = doc.createElement("div");
        optsWrap.className = "pf-id-options";
        for (const opt of active.options) {
          const optBtn = doc.createElement("button");
          optBtn.type = "button";
          optBtn.className = "pf-id-opt";
          optBtn.setAttribute("data-selected", selectedChoice === opt.index ? "true" : "false");
          optBtn.setAttribute("data-testid", `intake-decision-opt-${opt.index}`);

          const numBadge = doc.createElement("span");
          numBadge.className = "pf-id-opt-num";
          numBadge.textContent = String(opt.index);

          const txtSpan = doc.createElement("span");
          const alreadyTagged = /推荐|首选|recommended|preferred/i.test(opt.label);
          const recPrefix =
            opt.recommended && !alreadyTagged ? (isZh ? "[推荐] " : "[Recommended] ") : "";
          txtSpan.textContent = `${recPrefix}${opt.label}`;

          optBtn.appendChild(numBadge);
          optBtn.appendChild(txtSpan);
          optBtn.addEventListener("click", () => {
            selectedChoice = opt.index;
            render();
          });
          optsWrap.appendChild(optBtn);
        }
        detailEl.appendChild(optsWrap);
      }

      const noteInput = doc.createElement("input");
      noteInput.type = "text";
      noteInput.className = "pf-id-input";
      noteInput.setAttribute("data-testid", "intake-decision-note-input");
      noteInput.placeholder = isZh
        ? "补充拍板备注或自定义指令（可选）..."
        : "Optional custom instruction or decision note...";
      noteInput.value = customNote;
      noteInput.addEventListener("input", () => {
        customNote = noteInput.value;
      });
      detailEl.appendChild(noteInput);

      const actionBar = doc.createElement("div");
      actionBar.className = "pf-id-actions";

      const submitBtn = doc.createElement("button");
      submitBtn.type = "button";
      submitBtn.className = "pf-id-btn pf-id-btn-primary";
      submitBtn.setAttribute("data-testid", "intake-decision-submit");
      submitBtn.disabled = busy || (selectedChoice === undefined && !customNote.trim());
      submitBtn.textContent = isZh ? "拍板并续接原会话" : "Answer & Resume Session";
      submitBtn.addEventListener("click", () => {
        void runDecisionAction("answer", active);
      });
      actionBar.appendChild(submitBtn);

      const previewBtn = doc.createElement("button");
      previewBtn.type = "button";
      previewBtn.className = "pf-id-btn";
      previewBtn.setAttribute("data-testid", "intake-decision-preview-btn");
      previewBtn.disabled = busy || (selectedChoice === undefined && !customNote.trim());
      previewBtn.textContent = isZh ? "干跑预览" : "Dry-Run Preview";
      previewBtn.addEventListener("click", () => {
        void runDecisionAction("preview_answer", active);
      });
      actionBar.appendChild(previewBtn);

      if (active.workspaceId) {
        const openSessionBtn = doc.createElement("button");
        openSessionBtn.type = "button";
        openSessionBtn.className = "pf-id-btn";
        openSessionBtn.setAttribute("data-testid", "intake-decision-open-session");
        openSessionBtn.textContent = isZh ? "打开会话" : "Open Session";
        openSessionBtn.addEventListener("click", () => {
          const wsId = active.workspaceId;
          closeDrawer();
          if (wsId) navigateToPaseoWorkspace(wsId, active.agentId);
        });
        actionBar.appendChild(openSessionBtn);
      }

      const resolveBtn = doc.createElement("button");
      resolveBtn.type = "button";
      resolveBtn.className = "pf-id-btn";
      resolveBtn.setAttribute("data-testid", "intake-decision-resolve-done");
      resolveBtn.disabled = busy;
      resolveBtn.textContent = isZh ? "直接结案" : "Resolve Done";
      resolveBtn.addEventListener("click", () => {
        void runDecisionAction("resolve_done", active);
      });
      actionBar.appendChild(resolveBtn);

      detailEl.appendChild(actionBar);

      if (previewBoxText) {
        const pre = doc.createElement("div");
        pre.className = "pf-id-preview";
        pre.setAttribute("data-testid", "intake-decision-preview-output");
        pre.textContent = previewBoxText;
        detailEl.appendChild(pre);
      }
    }

    body.appendChild(listEl);
    body.appendChild(detailEl);
    card.appendChild(body);
  };

  const loadList = async (forceRefresh: boolean) => {
    busy = true;
    render();
    try {
      const res = await rpc({ action: "list", refresh: forceRefresh });
      items = res.items;
      if (initialTaskId) {
        const matchIdx = items.findIndex(
          (x) => x.shortId === initialTaskId || x.taskId === initialTaskId,
        );
        selectTaskIndex(matchIdx >= 0 ? matchIdx : 0);
      } else {
        selectTaskIndex(Math.min(selectedIdx, Math.max(0, items.length - 1)));
      }
      statusBanner = "";
    } catch (err) {
      statusBanner = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
      render();
    }
  };

  const runDecisionAction = async (
    action: "preview_answer" | "answer" | "resolve_done",
    target: IntakeDecisionItem,
  ) => {
    busy = true;
    render();
    try {
      const res = await rpc({
        action,
        taskId: target.shortId,
        choice: action === "resolve_done" ? undefined : selectedChoice,
        text: customNote.trim() || undefined,
      });
      if (!res.ok) {
        statusBanner = res.message;
        return;
      }
      if (action === "preview_answer" && res.preview) {
        previewBoxText = [
          `mode: ${res.preview.mode}`,
          `agent: ${res.preview.agentId ?? "-"} (${res.preview.agentStatus ?? "-"})`,
          `workspace: ${res.preview.workspaceId ?? "-"}`,
          `round: ${res.preview.round ?? 1}/${res.preview.maxDecisionRounds ?? 8}`,
          `decision: ${res.preview.decisionText}`,
          `nextReport: ${res.preview.nextReport ?? "-"}`,
        ].join("\n");
        statusBanner = isZh ? "预览就绪（未写入）" : "Preview ready (no writes)";
      } else {
        items = res.items;
        selectTaskIndex(Math.min(selectedIdx, Math.max(0, items.length - 1)));
        statusBanner = res.message;
      }
    } catch (err) {
      statusBanner = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
      render();
    }
  };

  const onModalKeyDown = (ev: KeyboardEvent) => {
    if (!doc.getElementById(DRAWER_ID)) return;
    const tag = (ev.target as HTMLElement | null)?.tagName?.toLowerCase();
    const inInput = tag === "input" || tag === "textarea";
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      closeDrawer();
      return;
    }
    if (inInput) return;
    if (ev.key === "ArrowDown" && items.length > 0) {
      ev.preventDefault();
      selectTaskIndex(selectedIdx + 1);
      render();
    } else if (ev.key === "ArrowUp" && items.length > 0) {
      ev.preventDefault();
      selectTaskIndex(selectedIdx - 1);
      render();
    } else if (/^[1-6]$/.test(ev.key)) {
      const n = Number.parseInt(ev.key, 10);
      const cur = items[selectedIdx];
      if (cur && cur.options.some((o) => o.index === n)) {
        ev.preventDefault();
        selectedChoice = n;
        render();
      }
    }
  };

  window.addEventListener("keydown", onModalKeyDown, true);
  doc.body.appendChild(overlay);
  await loadList(false);
  return true;
}

export function isIntakeDecisionsChord(ev: {
  key?: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): boolean {
  const isD = ev.code === "KeyD" || (ev.key ?? "").toLowerCase() === "d";
  return Boolean(isD && ev.metaKey && ev.ctrlKey && !ev.altKey && !ev.shiftKey);
}

export function installIntakeDecisionsEnhancer(
  winInput: MinimalWindow | Window | null,
  rpc: ManageDecisionsFn,
): () => void {
  bindIntakeDecisionsRpc(rpc);
  const win = winInput as Window | null;
  if (!win || typeof win.addEventListener !== "function") return () => {};

  const prev = (win as unknown as Record<string, (() => void) | undefined>)[GLOBAL_HANDLE_KEY];
  if (typeof prev === "function") {
    try {
      prev();
    } catch {
      // Ignore stale cleanup
    }
  }

  const onKeyDown = (ev: KeyboardEvent) => {
    if (!readIntakeDecisionsPrefs(win).enableShortcut) return;
    if (!isIntakeDecisionsChord(ev)) return;
    ev.preventDefault();
    ev.stopPropagation();
    const existing = win.document?.getElementById(DRAWER_ID);
    if (existing) {
      existing.remove();
    } else {
      void openIntakeDecisionsDrawer(rpc);
    }
  };

  win.addEventListener("keydown", onKeyDown, true);
  const cleanup = () => {
    win.removeEventListener("keydown", onKeyDown, true);
  };
  (win as unknown as Record<string, unknown>)[GLOBAL_HANDLE_KEY] = cleanup;
  return cleanup;
}
