# Paseo Plugin: File Inspector & Finder Reveal (`file-inspector-finder`)

An official-SDK [Paseo](https://github.com/getpaseo/paseo) plugin (`@getpaseo/plugin` `>=0.15.0`) that natively extends Paseo with **Reveal in Finder / Explorer**, **Open containing folder**, **Open in Preview / Code Editor**, **Image Pixel & Metadata Inspection**, and **Desktop Right-Click / `Option+Click` (`Alt+Click`)** across file tabs, inline chat file links, workspace headers, `⌘K`, and `/reveal`.

- **Native-First & Conflict-Free**: Extends Paseo's official file tab context menu (`workspace-tab-context-*`) **in-place** right below `Copy file path` (using Paseo's own menu DOM structure and monochrome Lucide icons), suppresses Electron's fallback `Copy / Paste / Select All` menu when right-clicking inline chat file links, and leaves Paseo's native File Explorer menu untouched.
- **Native Single-Language i18n (`defineTranslations` / `useTranslation`)**: Automatically follows Paseo's active UI language (`en` or `zh` / `zh-CN`) in a single clean language without mixed bilingual labels or emoji clutter.
- **Update-Safe**: Runs in `~/.paseo/plugins/` and survives every `Paseo.app` upgrade.

Addresses community requests in [getpaseo/paseo#6482](https://github.com/getpaseo/paseo/issues/6482), [getpaseo/paseo#6691](https://github.com/getpaseo/paseo/issues/6691), and [Discussion #6123](https://github.com/getpaseo/paseo/discussions/6123).

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
| **1** | **In-Place Native File Tab Context Menu Extension** | Right-click any open file tab in Paseo | Injects `Reveal in Finder`, `Open containing folder`, and `Open in Preview` directly inside Paseo's native tab context menu right below `Copy file path`—zero overlapping menus. |
| **2** | **Inline Chat File Link Context Menu & `Option+Click`** | • **Right-Click** any inline file path in chat<br>• **`Option + Left-Click`** (`Alt + Click`) any file link or tab<br>• Press **`⌘⇧R`** (`Ctrl+Shift+R`) | • Right-click opens a clean native-styled menu (`Reveal in Finder`, `Open containing folder`, `Open in Preview`, `Copy file path`) while suppressing Electron's duplicate OS menu<br>• `Option+Click` immediately reveals the file in Finder (`open -R`)<br>• `⌘⇧R` reveals the active file tab in Finder. |
| **3** | **Image Inspector File Panel** (`image-inspector`) | Automatically associated with `.png, .jpg, .jpeg, .gif, .webp, .svg, .bmp, .ico, .avif, .heic, .tif, .tiff` | Adds a top action toolbar inside image tabs (`Reveal in Finder`, `Open containing folder`, `Open in Preview`, `Antigravity / Cursor / VS Code`, `Copy file path`, `Copy relative path`, Zoom `50%–300%`, Canvas background `Dark / Checker / Light`) + metadata bar (`width × height px`, size, modified time, full path). |
| **4** | **Workspace Header Popover & Explorer Panel** | Click the `FolderOpen` icon in the top-right workspace header bar | Opens a popover showing the workspace root directory + recent images/files generated in the workspace with 1-click Finder reveal, without overwriting Paseo's project-wide `preferredEditorId`. |
| **5** | **Command Center (`⌘K`), Slash Commands (`/reveal`, `/finder`, `/rename`, `/label`), & Agent Tools** | • Press `⌘K` and search `Finder`, `Rename`, or `Label`<br>• Type `/reveal [path]`, `/rename <title>`, or `/label <name> [color]` in chat<br>• Ask any agent to reveal a file or rename/label the thread | Keyboard-first and agent-callable file reveal (`reveal_in_finder`) + thread metadata management (`manage_thread_metadata`). |
| **6** | **Quick Thread Rename & Workspace Label Bar (`F2` / `⌘⇧E` / `⌘⇧L` / Double-Click Header)** | • Press **`F2`** or **`⌘⇧E`** (or **double-click** the top workspace header title)<br>• Press **`⌘⇧L`** for quick label toggle/creation | Opens an instant floating Thread Rename & Label Bar (and top card inside the Header Popover) to edit the workspace title, toggle catalog labels, or create new colored labels in 1 click. |
| **7** | **Settings & Live Path Reconciler** (`Settings -> Plugins -> File Inspector & Finder`) | Open Paseo `Settings -> Plugins -> File Inspector & Finder` | • **Configure**: Default primary action, preferred code editor, default canvas background, quick rename/label shortcuts, optional composer pill.<br>• **Reconcile / Test**: Enter any relative path, absolute path, or filename to inspect how the daemon resolves it on disk and test opening it with 1 click. |

---

## Development & Verification

```bash
npm install
npm test
npm run typecheck
```

## License

MIT
