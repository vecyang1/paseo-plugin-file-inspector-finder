# Paseo Plugin: File Inspector & Finder Reveal (`file-inspector-finder`)

An official-SDK [Paseo](https://github.com/getpaseo/paseo) plugin (`@getpaseo/plugin` `>=0.15.0`) that adds **Reveal in Finder / Explorer**, **Open Containing Folder**, **Open in Default Preview / Code Editor**, **Image Pixel & Metadata Inspection**, and **Desktop Right-Click / `Option+Click` (`Alt+Click`)** across all Paseo file tabs, inline chat file links, headers, composer pills, `⌘K`, and `/reveal`.

Because it runs as a standard Paseo plugin in `~/.paseo/plugins/`, it **never modifies the signed `Paseo.app` bundle** and **survives every Paseo update**.

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

## 6 Built-in Surfaces

| # | Surface | How to Trigger | What It Does |
| :- | :--- | :--- | :--- |
| **1** | **Image Inspector & Finder File Panel** (`image-inspector`) | Automatically associated with `.png, .jpg, .jpeg, .gif, .webp, .svg, .bmp, .ico, .avif, .heic, .tif, .tiff` (for already-open tabs, right-click the tab -> `Open with... -> Image Inspector & Finder`) | Adds a top action toolbar inside image tabs (`📂 Reveal in Finder`, `📁 Open Folder`, `🖼️ Preview`, `💻 Editor`, `📋 Copy Path`, `📐 Relative Path`, Zoom `50%–300%`, Canvas background `Checker / Dark / Light`) + a bottom **UI Observability Bar** showing pixel resolution (`width × height px`), file size, modified time, parent directory, and execution receipt. |
| **2** | **Desktop Right-Click & `Option+Click` Helper** | • **`Option + Left-Click`** (`Alt + Click`) on any inline chat file link or file tab<br>• **Right-Click** on any inline chat file link or file tab<br>• Press **`⌘⇧R`** (`Ctrl+Shift+R`) | • `Option+Click` immediately reveals the file in Finder / Explorer (`open -R` / `explorer /select,`)<br>• Right-click opens a floating quick menu (`Reveal in Finder`, `Open Folder`, `Open in Preview`, `Copy Path`)<br>• Multi-workspace path resolution automatically finds relative paths or basenames across active Paseo workspaces. |
| **3** | **Workspace Header Button** (`📂`) | Click the `📂` (`FolderOpen`) icon in the top-right workspace header bar | Opens a popover showing the workspace root directory + recent images/files generated in the workspace with 1-click Finder reveal, without overwriting Paseo's project-wide `preferredEditorId`. |
| **4** | **Composer Pill** (`📂 Finder`) | Click `📂 Finder` in the bottom chat composer bar (next to Tasks / Subagents) | Browse and reveal workspace media directly from the chat input bar. |
| **5** | **Command Center (`⌘K`), Slash Commands (`/reveal`, `/finder`), & Agent Tool (`reveal_in_finder`)** | • Press `⌘K` and search `Finder`<br>• Type `/reveal [path-or-filename]` or `/finder` in chat<br>• Ask any agent to reveal a file | Keyboard-first and agent-callable file/folder reveal. |
| **6** | **Settings & Live Path Reconciler** (`Settings -> Plugins -> File Inspector & Finder`) | Open Paseo `Settings -> Plugins -> File Inspector & Finder` | • **Configure**: Default primary action, preferred code editor (`Antigravity`, `Cursor`, `VS Code`), default canvas background.<br>• **Reconcile / Test**: Enter any relative path, absolute path, or filename to inspect how the daemon resolves it on disk and test opening it with 1 click. |

---

##中文说明 (Chinese Overview)

`file-inspector-finder` 是基于 Paseo 官方 `@getpaseo/plugin` SDK 编写的增强插件，彻底解决 Paseo 内置图片预览器与聊天内联文件链接没有「**打开所在文件夹 / 在 Finder 中显示**」的问题，且**完全独立于 `Paseo.app` 安装包，升级 Paseo 绝不会被覆盖**。

### 一键安装

```bash
paseo plugin install git:vecyang1/paseo-plugin-file-inspector-finder
```

### 六大交互入口

1. **图片标签页顶部工具栏 (`Image Inspector & Finder`)**：自动关联全部图片格式（若旧标签页已打开，右键标签页选 `Open with... -> Image Inspector & Finder`），顶部提供 `📂 在 Finder 中显示 (open -R)`、`📁 打开所在文件夹`、`🖼️ 系统预览`、`💻 代码编辑器`、`📋 复制路径`、缩放 (`50%–300%`)、底色切换 (`灰格/暗底/亮底`)，底部实时显示像素尺寸（如 `4692×1860 px`）、体积、修改时间与父目录。
2. **聊天文件链接 / 标签页快捷键与右键菜单**：
   - 按住 **`Option (⌥) + 左键点击`** 聊天中的文件链接或标签页：**0 秒直接在 Finder 中高亮定位该文件**；
   - 在聊天文件链接或标签页上 **右键**：弹出快捷菜单（支持跨工作区解析相对路径与文件名）；
   - 按 **`⌘⇧R`**：直接在 Finder 中定位当前激活标签页文件。
3. **工作区右上角 `📂` 图标按钮**：一键打开工作区根目录或查看当前工作区最新生成的全部图片素材（不污染默认编辑器设置）。
4. **聊天输入框下方 `📂 Finder` 胶囊按钮**：在打字区旁随时呼出工作区图片与文件夹面板。
5. **命令中心 (`⌘K`) 与斜杠命令 (`/reveal`, `/finder`)**：支持在聊天框输入 `/reveal [文件名或路径]`。
6. **设置与实时路径对账器 (`Settings -> Plugins -> File Inspector & Finder`)**：支持配置默认打开动作、编辑器、画布底色，并提供实时路径解析验算器。

---

## Development & Verification

```bash
npm install
npm test
npm run typecheck
```

## License

MIT
