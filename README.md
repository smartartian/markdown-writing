# Markdown Writing

Markdown Writing is a desktop Markdown editor built with Wails, Go, SQLite, and a vanilla JavaScript frontend.

## Features

- Block-oriented Markdown editing with a source mode fallback
- SQLite document library and local `.md` file workflow
- Recent files, file tree navigation, outline navigation, and autosave
- Revision-aware saving, version history, recycle bin, and crash recovery snapshots
- Markdown, text, image, PDF, and Word-compatible HTML export
- Sanitized Markdown rendering for embedded HTML
- Path-scoped desktop file access

## Frontend Structure

- `core/state.js`: shared application state
- `services/document-store.js`: selects the browser or Wails storage adapter
- `services/browser-adapter.js`: browser-mode file and local database storage
- `services/wails-adapter.js`: Wails/Go storage bindings
- `modules/editor.js`: Markdown block parsing and rendering
- `modules/file-tree.js`: document tree rendering and delegated navigation
- `modules/settings.js`: settings UI and persistence
- `modules/export.js`: Markdown, text, image, PDF, and Word export
- `main.js`: application orchestration and view composition

The self-developed editor foundation lives in `frontend/src/editor-core/`.
The first layer provides immutable documents, stable block IDs, reversible
transactions, revision conflict detection, and Markdown golden tests.
It now also includes selection mapping, composition handling, command
registration, parser worker support, and model-level undo/redo.

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

## Manual GUI QA

Native IME, close, save-failure, external-change, table, code block, drag-and-drop, and large-document checks are documented in `docs/manual-qa.md`.

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
