#!/bin/bash
# The `game` rgba hashes that must not move (base at three times; islander and fiddler at two), one line each.
#   tools/terraces_hashes.sh [variant ...]     default: base islander fiddler
set -uo pipefail
cd "$(dirname "$0")/.."; tmp=out/terraces/hash; mkdir -p "$tmp"
for v in "${@:-base islander fiddler}"; do for v1 in $v; do
  case $v1 in base) times="1.0 3.6 11.3" ;; *) times="1.0 11.3" ;; esac
  for t in $times; do
    h=$(bun src/cli/main.ts render examples/bosses/reefback_titan.ts --variant "$v1" --views game --time "$t" --size 1280x800 --out "$tmp/h.webp" 2>&1 | rg -o 'rgba \w+' | head -1)
    echo "$v1 t=$t $h"
  done
done; done
rm -rf "$tmp"
