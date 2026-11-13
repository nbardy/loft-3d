#!/bin/bash
# Review pictures of the terraced back, each one small contact sheet (1600 px wide) under out/terraces/review/:
#   tools/terraces_review.sh views <name> <variant> <view,view,...> [time]     four or fewer of the turnaround scene's cameras
#   tools/terraces_review.sh times <name> <variant> <view> <t,t,...>           one camera at several times
# Prints one line per sheet. The turnaround scene (tools/terraces_turnaround.ts) holds the design's cameras and the
# paint-overs' (frontRight, backRight, backLeft, frontLeft), a stern view, two close-ups (join, lightBase) and `above`.
set -euo pipefail
cd "$(dirname "$0")/.."; out=out/terraces/review; mkdir -p "$out"
mode=$1; name=$2; variant=$3
case $mode in
  views) TURN_VARIANT=$variant bun src/cli/main.ts render tools/terraces_turnaround.ts --views "$4" --time "${5:-1}" --size 1280x800 --out "$out/$name.full.webp" | rg -o "rgba \w+|\d+ draw calls|\(\d+ triangles drawn" | paste -sd' ' - ;;
  times) TURN_VARIANT=$variant bun src/cli/main.ts frames tools/terraces_turnaround.ts --view "$4" --times "$5" --size 1280x800 --out "$out/$name.full.webp" | rg -c rgba ;;
esac
magick "$out/$name.full.webp" -resize 1600x -quality 88 "$out/$name.webp"; rm "$out/$name.full.webp"
echo "wrote $out/$name.webp"
