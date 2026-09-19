# Theme Configuration

User themes are JSON files stored in the application theme directory.

## Locations

```text
macOS: ~/Library/Application Support/md-editor-desktop/themes
Windows: %AppData%/md-editor-desktop/themes
Linux: ~/.config/md-editor-desktop/themes
```

The exact path is shown on `Appearance > Theme Style`.

## Schema

```json
{
  "schemaVersion": 1,
  "id": "my-theme",
  "name": { "zh-CN": "我的主题", "en": "My Theme" },
  "description": { "zh-CN": "说明", "en": "Description" },
  "variants": {
    "light": { "tokens": {} },
    "dark": { "tokens": {} }
  }
}
```

`id` must match `^[a-z0-9][a-z0-9_-]{1,63}$`. Missing tokens inherit from the built-in Paper theme.

Each provided variant becomes a separate selectable theme. Light and dark selections are stored independently, including when the application follows the system appearance.

## Tokens

```text
bgPage
surface
surfaceSecondary
sidebarBg
sidebarItemHover
sidebarItemActive
sidebarText
sidebarTextDim
titlebarBg
titlebarText
titlebarTextDim
foreground
heading
secondary
placeholder
border
divider
primary
primaryHover
accent
accentSoft
error
success
```

Only known tokens and valid CSS colors are applied. Unknown or invalid entries are ignored and reported in Appearance settings.

A complete example is available at `frontend/public/theme-example.json`.
