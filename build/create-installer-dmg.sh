#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
REPO_ROOT="${SCRIPT_DIR:h}"

resolve_path() {
  case "$1" in
    /*) print -r -- "$1" ;;
    *) print -r -- "${REPO_ROOT}/$1" ;;
  esac
}

APP_NAME="${APP_NAME:-Markdown Writing}"
APP_BUNDLE="${APP_BUNDLE:-${APP_NAME}.app}"
SOURCE_APP="$(resolve_path "${SOURCE_APP:-build/bin/Markdown Writing.app}")"
OUTPUT_DMG="$(resolve_path "${OUTPUT_DMG:-build/bin/${APP_NAME}-Installer.dmg}")"
VOLUME_NAME="${VOLUME_NAME:-${APP_NAME} Installer}"
BACKGROUND="$(resolve_path "${BACKGROUND:-build/installer-background.png}")"
WINDOW_WIDTH="${WINDOW_WIDTH:-640}"
WINDOW_HEIGHT="${WINDOW_HEIGHT:-400}"
WINDOW_X="${WINDOW_X:-400}"
WINDOW_Y="${WINDOW_Y:-100}"
APP_X="${APP_X:-140}"
APP_Y="${APP_Y:-200}"
APPS_X="${APPS_X:-500}"
APPS_Y="${APPS_Y:-200}"
ICON_SIZE="${ICON_SIZE:-104}"

if [[ ! -d "$SOURCE_APP" ]]; then
  print -u2 -- "Missing built app at $SOURCE_APP"
  exit 1
fi

if [[ ! -f "$BACKGROUND" ]]; then
  print -u2 -- "Missing installer background at $BACKGROUND"
  exit 1
fi

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/md-editor-installer.XXXXXX")"
stage="$tmp_dir/stage"
dmg="$tmp_dir/raw.dmg"
device=""
layout_volume_name="${VOLUME_NAME} Layout ${$}"

cleanup() {
  if [[ -n "$device" ]]; then
    hdiutil detach "$device" -quiet >/dev/null 2>&1 || true
  fi
  rm -rf "$tmp_dir"
}

trap cleanup EXIT INT TERM

mkdir -p "$stage"
ditto "$SOURCE_APP" "$stage/$APP_BUNDLE"
ln -s /Applications "$stage/Applications"

mkdir -p "${OUTPUT_DMG:h}"

hdiutil create \
  -srcfolder "$stage" \
  -volname "$layout_volume_name" \
  -fs HFS+ \
  -fsargs "-c c=64,a=16,e=16" \
  -format UDRW \
  -ov \
  "$dmg" >/dev/null

attach_output="$(hdiutil attach -readwrite -noautoopen "$dmg")"
device="$(print -r -- "$attach_output" | awk '/^\/dev\/disk/ { print $1; exit }')"
volume="$(print -r -- "$attach_output" | awk -F '\t' '$3 != "" { print $3; exit }')"

if [[ -z "$device" || ! -d "$volume" ]]; then
  print -u2 -- "Failed to mount installer dmg"
  exit 1
fi

mkdir -p "$volume/.background"
ditto "$BACKGROUND" "$volume/.background/background.png"
if [[ -e "$volume/$APP_BUNDLE" ]]; then
  xattr -d com.apple.quarantine "$volume/$APP_BUNDLE" >/dev/null 2>&1 || true
fi

osascript - \
  "$layout_volume_name" \
  "$APP_BUNDLE" \
  "$WINDOW_X" \
  "$WINDOW_Y" \
  "$WINDOW_WIDTH" \
  "$WINDOW_HEIGHT" \
  "$APP_X" \
  "$APP_Y" \
  "$APPS_X" \
  "$APPS_Y" \
  "$ICON_SIZE" \
  "$volume" <<'APPLESCRIPT'
on run argv
  set volumeName to item 1 of argv
  set appBundleName to item 2 of argv
  set windowX to item 3 of argv as integer
  set windowY to item 4 of argv as integer
  set windowWidth to item 5 of argv as integer
  set windowHeight to item 6 of argv as integer
  set appX to item 7 of argv as integer
  set appY to item 8 of argv as integer
  set appsX to item 9 of argv as integer
  set appsY to item 10 of argv as integer
  set iconSize to item 11 of argv as integer
  set volumePath to item 12 of argv

  tell application "Finder"
    set installerDisk to missing value
    repeat 40 times
      try
        set installerDisk to first disk whose name is volumeName
        exit repeat
      on error
        delay 0.25
      end try
    end repeat

    if installerDisk is missing value then error "Installer disk was not mounted"

    tell installerDisk
      open
      delay 1
      set installerWindow to container window
      set current view of installerWindow to icon view
      set toolbar visible of installerWindow to false
      set statusbar visible of installerWindow to false
      set bounds of installerWindow to {windowX, windowY, windowX + windowWidth, windowY + windowHeight}

      set viewOptions to the icon view options of installerWindow
      set arrangement of viewOptions to not arranged
      set icon size of viewOptions to iconSize
      set backgroundPicture to POSIX file (volumePath & "/.background/background.png") as alias
      set background picture of viewOptions to backgroundPicture

      set position of item appBundleName of installerWindow to {appX, appY}
      set position of item "Applications" of installerWindow to {appsX, appsY}
      update without registering applications
      delay 1
      close installerWindow
    end tell
  end tell
end run
APPLESCRIPT

sync
diskutil rename "$volume" "$VOLUME_NAME" >/dev/null
volume="/Volumes/${VOLUME_NAME}"

if [[ ! -d "$volume" ]]; then
  print -u2 -- "Failed to rename installer volume to $VOLUME_NAME"
  exit 1
fi

# 若同名卷已存在（例如旧 DMG 还挂着），rename 后 $volume 可能指向别的卷，这里用设备号确认。
# df 报的是分区（/dev/disk5s1），$device 是整盘（/dev/disk5），所以按前缀匹配。
mounted_device="$(df -P "$volume" 2>/dev/null | tail -n 1 | awk '{print $1}')"
if [[ "$mounted_device" != "$device"* ]]; then
  print -u2 -- "Volume $volume ($mounted_device) is not the installer volume ($device); eject the stale volume and retry"
  exit 1
fi

# 这些是 macOS 的卷元数据目录，可能不存在或只读，失败不应中断打包。
rm -rf "$volume/.fseventsd" "$volume/.Spotlight-V100" "$volume/.Trashes" 2>/dev/null || true
hdiutil detach "$device" -quiet
device=""

hdiutil convert \
  "$dmg" \
  -format UDZO \
  -imagekey zlib-level=9 \
  -ov \
  -o "$OUTPUT_DMG" >/dev/null

print -r -- "$OUTPUT_DMG"
