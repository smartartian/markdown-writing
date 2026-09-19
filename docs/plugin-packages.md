# User Plugin Packages

Markdown Writing supports trusted local single-file Lattice plugins.

## Location

```text
macOS: ~/Library/Application Support/md-editor-desktop/plugins
Windows: %AppData%/md-editor-desktop/plugins
Linux: ~/.config/md-editor-desktop/plugins
```

The exact directory is available from `Plugins & Status > Open Folder`.

## Package Format

```json
{
  "schemaVersion": 1,
  "id": "example-plugin",
  "name": "Example Plugin",
  "version": "1.0.0",
  "description": "Example plugin.",
  "layer": "business",
  "inject": ["markdown"],
  "async": false,
  "entry": "ctx => { ctx.provide('exampleService', { ping: () => 'pong' }); }"
}
```

`entry` is executed as a trusted JavaScript function with the Lattice plugin context.

## Lifecycle

- Install imports a package and rebuilds the Lattice runtime.
- Upgrade requires the same plugin id and a higher version.
- Uninstall removes the user package and rebuilds the runtime.
- Protected built-in plugins cannot be replaced, upgraded, or uninstalled.
- Enable and disable choices are persisted and restored on the next startup.

Only install plugins you trust. User plugins run with application privileges.

A complete example is available at `frontend/public/plugin-example.json`.
