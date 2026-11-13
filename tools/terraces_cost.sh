#!/bin/bash
# The terraces' cost against the headland on the bruiser (and the base atoll): `rounds` alternated profiles from
# `game` at 1280 x 800, t = 1, one line each (the normal frame; see .claude/skills/frame-time/SKILL.md). Then one
# per-draw listing of each back's own draws, under out/terraces/cost/.
#   tools/terraces_cost.sh [rounds]
set -uo pipefail
cd "$(dirname "$0")/.."; out=out/terraces/cost; mkdir -p "$out"
for r in $(seq "${1:-4}"); do
  for v in bruiser bruiser,back=headland bruiser,back=base; do
    bun src/cli/main.ts profile examples/bosses/reefback_titan.ts --variant "$v" --view game --size 1280x800 --time 1 2>&1 | tee "$out/$r.$v.txt" | rg -o 'normal frame: [0-9.]+ ms' | sed "s|^|$r $v |"
  done
done
