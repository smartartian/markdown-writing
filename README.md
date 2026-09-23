# Markdown Writing

Markdown Writing is a desktop Markdown editor built with Wails, Go, SQLite, and a vanilla JavaScript frontend.

Current release: `0.0.2`. See [CHANGELOG.md](CHANGELOG.md) for release notes.

## Features

- Block-oriented Markdown editing with a source mode fallback
- SQLite document library and local `.md` file workflow
- Recent files, file tree navigation, outline navigation, and autosave
- Atomic file saving, recycle bin storage, and crash recovery snapshots
- Markdown, text, image, PDF, and Word-compatible HTML export
- Theme system with light/dark modes, four built-in palettes, and JSON-based user themes
- Sanitized Markdown rendering for embedded HTML
- Path-scoped desktop file access

## Frontend Structure

- `core/state.js`: shared application state
- `services/document-store.js`: selects the browser or Wails storage adapter
- `services/browser-adapter.js`: browser-mode file storage
- `services/wails-adapter.js`: Wails/Go storage bindings
- `modules/editor.js`: Markdown block parsing and rendering
- `modules/file-tree.js`: document tree rendering and delegated navigation
- `modules/settings.js`: settings UI and persistence
- `i18n/index.js`: interface language resolution, translations, and runtime switching
- `themes/`: theme schema, built-in palettes, validation, migration, and CSS variable application
- `plugin-runtime/index.js`: Lattice application runtime and plugin inventory bridge
- `modules/export.js`: Markdown, text, image, PDF, and Word export
- `main.js`: application orchestration and view composition

The self-developed editor foundation lives in `frontend/src/editor-core/`.
The first layer provides immutable documents, stable block IDs, reversible
transactions, revision conflict detection, and Markdown golden tests.
It now also includes selection mapping, composition handling, command
registration, parser worker support, and model-level undo/redo.

Custom theme files are documented in [docs/theme-config.md](docs/theme-config.md).
Trusted local plugin packages are documented in [docs/plugin-packages.md](docs/plugin-packages.md).

## Development

Install frontend dependencies:

```sh
cd frontend
npm install
```

Run the desktop app in development mode:

```sh
wails dev
```

Run checks:

```sh
go test ./...
go vet ./...
cd frontend && npm run build
cd ../website && npm run check && npm test
```

## Build

```sh
wails build
```

The macOS application is generated under `build/bin/`.

## Official Website

The standalone product website lives in `website/`. Preview it with:

```sh
python3 -m http.server 4173 -d website
```

Pushes that change `website/` deploy the static site through GitHub Pages.
The release workflow also refreshes `website/releases.json` whenever a GitHub
Release is published.

## Manual GUI QA

Native IME, close, save-failure, table, code block, drag-and-drop, and large-document checks are documented in `docs/manual-qa.md`.

## Data Locations

SQLite data is stored in the user's application config directory:

```text
<user-config>/md-editor-desktop/markdown-writing.db
```

File-system documents remain in the folder selected by the user.

## Security Notes

- Rendered Markdown is sanitized before insertion into the DOM.
- Desktop file operations are limited to the active document directory or files explicitly opened by the user.
- Local file writes use a temporary file and atomic rename to reduce corruption risk.
