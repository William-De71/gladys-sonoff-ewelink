#!/usr/bin/env sh
# Render cover.svg to cover.jpg: exactly 800x534, JPEG, under 150 KB (store
# rules). Needs Inkscape (or rsvg-convert) and ImageMagick.
set -eu
cd "$(dirname "$0")/.."

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if command -v rsvg-convert >/dev/null 2>&1; then
  rsvg-convert -w 800 -h 534 cover.svg -o "$tmp/cover.png"
else
  inkscape cover.svg --export-type=png --export-width=800 --export-height=534 \
    --export-filename="$tmp/cover.png" >/dev/null 2>&1
fi
magick "$tmp/cover.png" -resize '800x534!' -strip -sampling-factor 4:2:0 -quality 86 cover.jpg

size="$(wc -c < cover.jpg)"
dimensions="$(magick identify -format '%wx%h' cover.jpg)"
echo "cover.jpg: ${dimensions}, ${size} bytes"
[ "$dimensions" = "800x534" ] || { echo "wrong dimensions" >&2; exit 1; }
[ "$size" -lt 153600 ] || { echo "over 150 KB" >&2; exit 1; }
