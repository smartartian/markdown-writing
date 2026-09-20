# Changelog

## 0.0.2 - 2026-09-21

Browser and desktop workflow release.

### Added

- Browser mode now uses the File System Access API to open, create, and save documents directly to local files and folders when supported.
- Native drag-and-drop document opening, export file dialogs, and reveal-in-file-manager actions on the desktop.
- File-tree context menus, inline renaming, active-folder highlighting, and automatic reveal of the current document.
- Split-pane layout controls for the home recent-files panel and the editor sidebar.
- A customizable DMG installer layout for macOS releases.

### Changed

- Improved Markdown block editing so plain text is not escaped, paragraph breaks use standard blank lines, and generated list markers stay compact.
- Refined opening and editing recently used files, including matching file-tree navigation and hover states.
- Improved export handling across Markdown, text, PNG, PDF, and Word-compatible output.
- Updated desktop window dragging and file-drop behavior for a more stable Wails experience.
- Updated application and website version metadata to `0.0.2`.

### Fixed

- Fixed blocking issues with browser-mode file save-back, block-editor line breaks, and list Markdown output.
- Fixed the missing application favicon request.

## 0.0.1 - 2026-09-19

Initial public desktop release.

### Added

- Local-first Markdown desktop editor built with Wails, Go, SQLite, and vanilla JavaScript.
- Self-developed editor core with immutable document revisions, transactions, selection mapping, composition handling, commands, and model-level undo/redo.
- Block-oriented Markdown editing, source mode, revision-aware saving, atomic file replacement, version history, recycle bin, and crash recovery snapshots.
- Markdown, text, PNG, PDF, and Word-compatible export.
- In-document find and replace with next, previous, replace, replace-all, and case-sensitive matching.
- File-tree create, rename, and delete actions with recycle-bin recovery.
- Percentage image widths through `{width=50%}` Markdown metadata and a configurable default width for newly inserted images.
- A real plugin inventory and status panel backed by Lattice `pluginInventory` and `pluginManager`.
- Runtime plugin controls for enable, disable, restart, and retry, with protected application plugins kept read-only.
- Interface language settings with Follow System, Chinese, and English options.
- Four built-in theme families with light and dark variants, plus JSON-based user themes.
- Light and dark themes are selected independently and can use different theme families in system mode.
- User plugin packages can be installed, upgraded, uninstalled, logged, and restored across launches.

### Changed

- Updated application version metadata to `0.0.1`.
- Content width is configured as a percentage and now defaults to `70%`, with automatic migration from older pixel values.
- Markdown body text, headings, and table headers consistently follow the configured editor font.
- Markdown editing, rendering, and shortcut services are represented as one Markdown Editor Core plugin.
- System theme selection now reports the resolved system appearance and keeps `color-scheme` in sync.
- Theme tokens now drive the settings workspace, sidebar, editor shell, and plugin status panel consistently.

### Notes

- This is the first public version and desktop packages are published through GitHub Releases.
- macOS builds are unsigned unless a separate signing configuration is added.
