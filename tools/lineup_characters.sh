#!/bin/zsh
# Each crab's best large frame (from the 1080p clip) beside its expression reference, one row a crab.
# usage: zsh tools/lineup_characters.sh <clip> <out.webp> <t islander> <t fiddler> <t mask> <t stilt>
set -e
clip=$1 out=$2; shift 2
R=~/git/loft/docs/art_direction/crab_round4
refs=($R/expressions_sheet.webp $R/others/fiddler_expressions.webp $R/others/mask_expressions.webp $R/others/stilt_expressions.webp)
tmp=$(mktemp -d)
rows=()
for i in 1 2 3 4; do
  ffmpeg -v error -y -ss $argv[$i] -i $clip -frames:v 1 $tmp/f$i.png
  magick $tmp/f$i.png -resize x420 $tmp/a$i.png
  magick $refs[$i] -resize x420 $tmp/b$i.png
  magick $tmp/a$i.png $tmp/b$i.png +append $tmp/r$i.png
  rows+=$tmp/r$i.png
done
magick $rows -background '#202020' -gravity west -append -quality 88 $out
rm -rf $tmp
magick identify $out
