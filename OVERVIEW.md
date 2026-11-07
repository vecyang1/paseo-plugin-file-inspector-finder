File Inspector and Finder Reveal extends Paseo with native Finder / Explorer reveal, system preview, editor launch, and image metadata inspection across file tabs, inline chat file links, and workspace headers.

## Capabilities

- **Native file tab context menu extension**: Adds `Reveal in Finder`, `Open containing folder`, and `Open in Preview` directly inside Paseo's native file tab context menu right below `Copy file path`, with monochrome Lucide icons and zero overlapping menus.
- **Inline chat file link actions & shortcuts**: Supports right-click context actions (while suppressing Electron's duplicate fallback menu), `Option+Click` (`Alt+Click`) instant Finder reveal on any file link or tab, and `⌘⇧R` to reveal the active file tab.
- **Image Inspector file panel (`image-inspector`)**: Enhances `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.bmp`, `.ico`, `.avif`, `.heic`, `.tif`, and `.tiff` tabs with a top toolbar (`Reveal in Finder`, `Open containing folder`, `Open in Preview`, code editor launch, `Copy file path`, `Copy relative path`), zoom (`50%` to `300%`), Dark/Checker/Light canvas backgrounds, and a metadata bar showing pixel dimensions, file size, and modified time.
- **Workspace header popover and Explorer panel (`finder-panel`)**: Lists recently generated or modified images and files in the workspace with one-click Reveal, Preview, and Copy Path actions without altering Paseo's project-wide preferred editor.
- **Command Center (`⌘K`) and slash commands (`/reveal`, `/finder`)**: Reveals the latest workspace image, workspace root, or any relative/absolute file path directly from the keyboard or chat composer.
- **Native single-language localization**: Automatically follows Paseo's active UI language (`en` or `zh`) via `@getpaseo/plugin/client` translations.
- **Settings and path reconciler (`Settings -> Plugins -> File Inspector & Finder`)**: Configure default opener target, preferred editor, canvas background, and test daemon path resolution interactively.
