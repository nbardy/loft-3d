#!/bin/bash
# Lays out the pictures tools/face_shots.ts wrote into two sheets (ImageMagick):
#
#   tools/face_sheet.sh <shots dir> <out dir> <reference dir> "name:label ..." "name:reference ..."
#
# - <out>/expression_sheet.webp: each named instant from the `face` camera, and under it the `game` camera's window on
#   the head, doubled, with the same window at its true size inset. Four to a row.
# - <out>/against_references.webp: for each name that has a reference picture, the two renders beside the reference.
set -euo pipefail
shots=$1; out=$2; refs=$3; names=$4; pairs=$5
tmp=$(mktemp -d)
bar() { magick -size "$1"x22 xc:'#0e1420' -fill '#ece2c8' -pointsize 13 -gravity west -annotate +8+0 "$2" "$3"; }

tiles=()
for item in $names; do
  n=${item%%:*}; label=${item#*:}; label=${label//_/ }
  bar 640 "$label  |  face camera" "$tmp/${n}_a.png"
  magick "$shots/${n}_face.webp" -resize 640x400! "$tmp/${n}_b.png"
  bar 640 "$label  |  game camera, 1280x800 frame: doubled; inset at true size" "$tmp/${n}_c.png"
  magick "$shots/${n}_big.webp" \( "$shots/${n}_true.webp" -bordercolor '#ece2c8' -border 1 \) -gravity southwest -geometry +6+6 -composite "$tmp/${n}_d.png"
  magick "$tmp/${n}_a.png" "$tmp/${n}_b.png" "$tmp/${n}_c.png" "$tmp/${n}_d.png" -append "$tmp/${n}.png"
  tiles+=("$tmp/${n}.png")
done
magick montage "${tiles[@]}" -tile 4x -geometry +0+0 -background '#0e1420' "$tmp/sheet.png"
magick "$tmp/sheet.png" -quality 92 "$out/expression_sheet.webp"

rows=()
for item in $pairs; do
  n=${item%%:*}; ref=${item#*:}
  bar 1920 "$n  |  render from the face camera  |  render from the game camera (doubled)  |  reference: $ref" "$tmp/${n}_h.png"
  magick "$shots/${n}_face.webp" -resize 640x400! "$tmp/${n}_r1.png"
  magick "$refs/$ref" -resize 640x400^ -gravity center -extent 640x400 "$tmp/${n}_r3.png"
  magick "$tmp/${n}_r1.png" "$shots/${n}_big.webp" "$tmp/${n}_r3.png" +append "$tmp/${n}_row.png"
  magick "$tmp/${n}_h.png" "$tmp/${n}_row.png" -append "$tmp/${n}_pair.png"
  rows+=("$tmp/${n}_pair.png")
done
magick "${rows[@]}" -append -quality 92 "$out/against_references.webp"
rm -rf "$tmp"
echo "wrote $out/expression_sheet.webp and $out/against_references.webp"
