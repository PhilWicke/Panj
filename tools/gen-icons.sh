#!/bin/sh
# App icons from the two SVG drawings: app/assets/icon.svg becomes icons/icon-512.png and
# icons/icon-192.png, app/assets/icon-maskable.svg (the same drawing inside the central 60
# percent) becomes icons/maskable-512.png. Renders with Quick Look (qlmanage) and resizes with
# sips, both part of macOS. When Quick Look leaves no PNG or a blank one (1 KB or less) it falls
# back to the cached Playwright headless shell; nothing is ever downloaded. Each PNG must stay
# under 60 KB. Run from the repository root: npm run icons.
set -eu

cd "$(dirname "$0")/.."

ICONS=app/assets/icons
MAX_BYTES=61440
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# bytes of a file
size() {
  wc -c < "$1" | tr -d ' '
}

# The newest cached headless shell, or nothing.
headless_shell() {
  best=''
  best_rev=0
  for candidate in "$HOME"/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell; do
    [ -x "$candidate" ] || continue
    rev=${candidate#"$HOME"/Library/Caches/ms-playwright/chromium_headless_shell-}
    rev=${rev%%/*}
    case $rev in '' | *[!0-9]*) continue ;; esac
    if [ "$rev" -gt "$best_rev" ]; then
      best_rev=$rev
      best=$candidate
    fi
  done
  printf '%s' "$best"
}

# render <svg> <png>: a 512 x 512 PNG of the drawing
render() {
  svg=$1
  png=$2
  qlmanage -t -s 512 -o "$tmp" "$svg" > /dev/null 2>&1 || true
  thumb="$tmp/$(basename "$svg").png"
  if [ -f "$thumb" ] && [ "$(size "$thumb")" -gt 1024 ]; then
    mv "$thumb" "$png"
    return
  fi
  shell=$(headless_shell)
  if [ -z "$shell" ]; then
    echo "Quick Look could not render $svg and no cached headless shell was found" >&2
    exit 1
  fi
  echo "Quick Look could not render $svg, using $shell"
  "$shell" --headless --disable-gpu --screenshot="$png" --window-size=512,512 --hide-scrollbars \
    --user-data-dir="$tmp/profile" "file://$PWD/$svg" > /dev/null 2>&1 || true
  if [ ! -f "$png" ] || [ "$(size "$png")" -le 1024 ]; then
    echo "The headless shell could not render $svg either" >&2
    exit 1
  fi
}

mkdir -p "$ICONS"
render app/assets/icon.svg "$tmp/icon.png"
render app/assets/icon-maskable.svg "$tmp/maskable.png"
sips -z 512 512 "$tmp/icon.png" --out "$ICONS/icon-512.png" > /dev/null
sips -z 192 192 "$tmp/icon.png" --out "$ICONS/icon-192.png" > /dev/null
sips -z 512 512 "$tmp/maskable.png" --out "$ICONS/maskable-512.png" > /dev/null

status=0
for file in "$ICONS/icon-192.png" "$ICONS/icon-512.png" "$ICONS/maskable-512.png"; do
  bytes=$(size "$file")
  echo "$file $(sips -g pixelWidth "$file" | awk '/pixelWidth/ { print $2 }')x$(sips -g pixelHeight "$file" | awk '/pixelHeight/ { print $2 }') $bytes bytes"
  if [ "$bytes" -ge "$MAX_BYTES" ]; then
    echo "$file is 60 KB or larger; simplify the drawing" >&2
    status=1
  fi
done
exit $status
