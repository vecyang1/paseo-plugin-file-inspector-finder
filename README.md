# Paseo Plugin: File Inspector & Finder Reveal (`file-inspector-finder`)

An official-SDK [Paseo](https://github.com/getpaseo/paseo) plugin (`@getpaseo/plugin` `>=0.15.3`) that natively extends Paseo with **Zero-Popup Double-Click & `F2` Inline Workspace/Tab Rename**, **Sidebar Folder Drag & Drop Workspace Import (Auto-Dedupe)**, **Colored Workspace Labels (`⌘⇧L`)**, **Reveal in Finder / Explorer**, **Open containing folder**, **Open in Preview / Code Editor**, **Image Pixel & Metadata Inspection**, and **Desktop Right-Click / `Option+Click` (`Alt+Click`)** across sidebars, file tabs, inline chat file links, workspace headers, `⌘K`, and slash commands.

- **Native-First & Conflict-Free**: Mounts an inline text editor directly inside left sidebar workspace rows (`sidebar-workspace-row-*`), top workspace header titles (`workspace-header-title`), and agent tabs (`workspace-tab-agent_*`) with zero modal popup; extends Paseo's official file tab context menu (`workspace-tab-context-*`) **in-place** right below `Copy file path`; suppresses Electron's fallback `Copy / Paste / Select All` menu when right-clicking inline chat file links; and leaves Paseo's native File Explorer menu untouched.
- **Native Single-Language i18n (`defineTranslations` / `useTranslation`)**: Automatically follows Paseo's active UI language (`en` or `zh` / `zh-CN`) in a single clean language without mixed bilingual labels or emoji clutter.
- **Update-Safe**: Runs in `~/.paseo/plugins/` and survives every `Paseo.app` upgrade.

Addresses community requests in [Discussion #4636](https://github.com/getpaseo/paseo/discussions/4636), [getpaseo/paseo#6482](https://github.com/getpaseo/paseo/issues/6482), [getpaseo/paseo#6691](https://github.com/getpaseo/paseo/issues/6691), and [Discussion #6123](https://github.com/getpaseo/paseo/discussions/6123).

---

## Quick Install (1 Command)

Make sure **Settings -> Plugins -> Enable plugins** is turned on in Paseo, then run:

```bash
paseo plugin install git:vecyang1/paseo-plugin-file-inspector-finder
```

Verify it is running:

```bash
paseo plugin ls
```

---

## Native Surfaces & Capabilities

| # | Surface | How to Trigger | What It Does |
| :- | :--- | :--- | :--- |
| **1** | **Zero-Popup Double-Click & `F2` Inline Rename** | • **Double-click** any left sidebar workspace row, the top workspace header title, or any agent tab<br>• Press **`F2`** or **`⌘⇧E`** (or run `⌘K -> Quick Rename Workspace Title`) | • Replaces the title text in-place with an inline `<input>` pre-selected with the full untruncated title—zero modal dialog or popup.<br>• Press **`Enter`** or click outside to save; press **`Escape`** to cancel.<br>• Safe for CJK / Pinyin IME composition (`isComposing`) and shielded against composer focus-theft during workspace switches. |
| **2** | **Sidebar Folder Drag & Drop Workspace Import (Auto-Dedupe)** | • Drag one or more folders (or files) from Finder onto Paseo's left `Workspaces` sidebar (or Home `Add project` card)<br>• Hold **`Option` (`Alt`)** while dropping to force a new workspace thread | • **If workspace does not yet exist**: registers the project + creates the workspace and switches Paseo to it immediately.<br>• **If workspace already exists**: switches directly to the existing workspace with zero duplication.<br>• Dropping a file onto the sidebar automatically resolves its parent folder.<br>• Leaves chat composer & terminal file drops completely untouched. |
| **3** | **In-Place Native File Tab Context Menu Extension** | Right-click any open file tab in Paseo | Injects `Reveal in Finder`, `Open containing folder`, and `Open in Preview` directly inside Paseo's native tab context menu right below `Copy file path`—zero overlapping menus. |
| **4** | **Inline Chat File Link Context Menu & `Option+Click`** | • **Right-Click** any inline file path in chat<br>• **`Option + Left-Click`** (`Alt + Click`) any file link or tab<br>• Press **`⌘⇧R`** (`Ctrl+Shift+R`) | • Right-click opens a clean native-styled menu (`Reveal in Finder`, `Open containing folder`, `Open in Preview`, `Copy file path`) while suppressing Electron's duplicate OS menu<br>• `Option+Click` immediately reveals the file in Finder (`open -R`)<br>• `⌘⇧R` reveals the active file tab in Finder. |
| **5** | **Image Inspector File Panel** (`image-inspector`) | Automatically associated with `.png, .jpg, .jpeg, .gif, .webp, .svg, .bmp, .ico, .avif, .heic, .tif, .tiff` | Adds a top action toolbar inside image tabs (`Reveal in Finder`, `Open containing folder`, `Open in Preview`, `Antigravity / Cursor / VS Code`, `Copy file path`, `Copy relative path`, Zoom `50%–300%`, Canvas background `Dark / Checker / Light`) + metadata bar (`width × height px`, size, modified time, full path). |
| **6** | **Workspace Header Popover & Explorer Panel** | Click the `FolderOpen` icon in the top-right workspace header bar | Opens a popover with quick `Folder -> Workspace` path import, thread rename/labels, workspace root directory, and recent images/files generated in the workspace with 1-click Finder reveal. |
| **7** | **Command Center (`⌘K`), Slash Commands (`/open-folder`, `/reveal`, `/rename`, `/label`), & Agent Tools** | • Press `⌘K` and search `Folder`, `Finder`, `Rename`, or `Label`<br>• Type `/open-folder <path>`, `/reveal [path]`, `/rename <title>`, or `/label <name> [color]` in chat | Keyboard-first and agent-callable folder workspace import (`import_folder_workspace`), file reveal (`reveal_in_finder`), and thread metadata management (`manage_thread_metadata`). |
| **8** | **Quick Colored Workspace Label Bar (`⌘⇧L`)** | Press **`⌘⇧L`** (`Ctrl+Shift+L`) | Opens an instant floating Workspace Label Bar (and top card inside the Header Popover) to toggle catalog labels or create new colored labels in 1 click. |
| **9** | **Settings & Live Reconcilers** (`Settings -> Plugins -> File Inspector & Finder`) | Open Paseo `Settings -> Plugins -> File Inspector & Finder` | • **Configure**: Toggle inline double-click rename, sidebar folder drop, default drop behavior (`open-or-create` vs `always-create`), default primary action, preferred code editor, canvas background, shortcuts.<br>• **Reconcile / Test**: Inspect, live-apply, or reset active workspace titles (`[workspace-meta]` receipt log), pre-check (`dryRun`) folder deduplication, and test daemon path resolution interactively. |

---

## Development & Verification

```bash
npm install
npm test
npm run typecheck
```

## License

MIT
