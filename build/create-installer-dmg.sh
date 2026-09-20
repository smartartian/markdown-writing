#!/bin/zsh
set -euo pipefail

APP_NAME='Markdown Writing'
APP_BUNDLE='Markdown Writing.app'
SOURCE_APP='build/bin/Markdown Writing.app'
OUTPUT_DMG="build/bin/${APP_NAME}-Installer.dmg"
VOLUME_NAME="${APP_NAME} Installer"
BACKGROUND='build/installer-background.png'
WINDOW_WIDTH=640
WINDOW_HEIGHT=400
APP_X=140
APP_Y=180
APPS_X=500
APPS_Y=180

if [ ! -d "$SOURCE_APP" ]; then
  echo "Missing built app at $SOURCE_APP" >&2
  exit 1
fi

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/md-editor-installer.XXXXXX")"
stage="$tmp_dir/stage"
dmg="$tmp_dir/raw.dmg"

mkdir -p "$stage"
cp -R "$SOURCE_APP" "$stage/$APP_BUNDLE"
ln -s /Applications "$stage/Applications"

hdiutil create -srcfolder "$stage" -volname "$VOLUME_NAME" -fs HFS+ -fsargs "-c c=64,a=16,e=16" -format UDRW "$dmg" >/dev/null

device="$(hdiutil attach -readwrite -nobrowse "$dmg" | tail -1 | awk '{print $1}')"
volume="/Volumes/${VOLUME_NAME}"

if [ ! -d "$volume" ]; then
  volume="$(find /Volumes -maxdepth 1 -type d -name "$VOLUME_NAME" -print -quit)"
fi

if [ ! -d "$volume" ]; then
  echo "Failed to mount installer dmg" >&2
  hdiutil detach "$device" -quiet >/dev/null 2>&1 || true
  exit 1
fi

cp "$BACKGROUND" "$volume/.background.png"
if [ -e "$volume/$APP_BUNDLE" ]; then
  xattr -d com.apple.quarantine "$volume/$APP_BUNDLE" >/dev/null 2>&1 || true
fi

osascript - >/dev/null 2>&1 || true <<'APPLESCRIPT'
tell application "Finder"
  tell disk "Markdown Writing Installer"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set the bounds of container window to {400, 100, 1040, 500}
    set viewOptions to the icon view options of container window
    set arrangement of viewOptions to not arranged
    set icon size of viewOptions to 96
    set background picture of viewOptions to file ".background.png"
    set position of item "Markdown Writing.app" of container window to {140, 180}
    set position of item "Applications" of container window to {500, 180}
    update without registering applications
    close
  end tell
end tell
APPLESCRIPT

hdiutil detach "$device" -quiet >/dev/null 2>&1 || true
hdiutil convert "$dmg" -format UDZO -o "$OUTPUT_DMG" -imagekey zlib-level=9 >/dev/null
rm -rf "$tmp_dir"
echo "$OUTPUT_DMG"
