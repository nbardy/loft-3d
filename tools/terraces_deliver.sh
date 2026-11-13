#!/bin/bash
# The round's pictures, under out/terraces/final/ (then copied to ~/git/loft/out/terraces/ by hand):
#   paintovers.webp   each paint-over beside ours from the same camera (game, front, rear_left, rear_right, side)
#   headland.webp     the headland above, the terraces below, through far, back, game, face (bruiser)
#   turnaround.webp   frontRight, backRight, backLeft, frontLeft, stern, above
#   closeups.webp     the join, the light's base
#   game.mp4, back.mp4  one 22 s cycle
#   tools/terraces_deliver.sh [stills|clips|all]
set -uo pipefail
cd "$(dirname "$0")/.."; out=out/terraces/final; mkdir -p "$out"; po=docs/art_direction/crab_round5
R="bun src/cli/main.ts render"
turn() { TURN_VARIANT=$1 $R tools/terraces_turnaround.ts --views "$2" --time 1 --size 1280x800 --out "$3" | rg -o 'rgba \w+' | paste -sd' ' -; }
if [ "${1:-all}" != clips ]; then
  for v in game frontRight backRight backLeft frontLeft; do turn bruiser "$v" "$out/ours_$v.webp"; done
  magick montage "$po/back_paintover_game.webp" "$out/ours_game.webp" "$po/back_paintover_front.webp" "$out/ours_frontRight.webp" \
    "$po/back_paintover_rear_left.webp" "$out/ours_backRight.webp" "$po/back_paintover_rear_right.webp" "$out/ours_backLeft.webp" \
    "$po/back_paintover_side.webp" "$out/ours_frontLeft.webp" -tile 2x5 -geometry 800x500+4+4 "$out/paintovers.webp"
  turn bruiser,back=headland far,back,game,face "$out/h_head.webp"; turn bruiser far,back,game,face "$out/h_ours.webp"
  magick "$out/h_head.webp" -resize 1600x "$out/h_head.webp"; magick "$out/h_ours.webp" -resize 1600x "$out/h_ours.webp"
  magick montage "$out/h_head.webp" "$out/h_ours.webp" -tile 2x1 -geometry +6+6 "$out/headland.webp"
  turn bruiser frontRight,backRight,backLeft,frontLeft "$out/t1.webp"; turn bruiser stern,above,game,back "$out/t2.webp"
  magick "$out/t1.webp" "$out/t2.webp" +append -resize 2400x "$out/turnaround.webp"
  turn bruiser join "$out/c_join.webp"; turn bruiser lightBase "$out/c_light.webp"
  magick "$out/c_join.webp" "$out/c_light.webp" +append "$out/closeups.webp"
  rm -f "$out"/ours_*.webp "$out"/h_*.webp "$out"/t1.webp "$out"/t2.webp "$out"/c_*.webp
fi
if [ "${1:-all}" != stills ]; then
  for v in game back; do bun src/cli/main.ts clip examples/bosses/reefback_titan.ts --variant bruiser --view "$v" --seconds 22 --fps 30 --size 1280x800 --out "$out/$v.mp4" | tail -1; done
fi
ls -la "$out"
