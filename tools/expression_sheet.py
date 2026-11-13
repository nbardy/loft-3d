#!/usr/bin/env python3
"""A face's expressions as two sheets (docs/art_direction/DIRECTION.md, Rounds 3 and 4).

  python3 tools/expression_sheet.py --variant fiddler --out out/faces_fs/fiddler \
      --times 17.3,1.6,3.7,7.9,11.3,12.2 --labels "at rest,wanting,straining,triumphant,furious,wincing" \
      --centre 745,265 --reference docs/art_direction/crab_round4/others/fiddler_expressions.webp

Writes, under --out:
  expression_sheet.webp   each expression from the `face` camera, and under it a window of the `game` camera's
                          1280x800 frame enlarged, with the same place inset at its true size; labelled.
  beside_reference.webp   each expression from the `face` camera beside its panel of the reference sheet (3 x 2 panels).
The frames come from `loft frames` (one process per camera). Needs ImageMagick (`magick`).
"""
import argparse
import os
import subprocess
import sys

SCENE = "examples/bosses/reefback_titan.ts"
W, H = 1280, 800          # the game frame
INSET = (240, 170)        # the window shown at true size


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"failed: {' '.join(cmd)}\n{r.stdout}\n{r.stderr}")
    return r.stdout


def frames(variant, view, times, size, out):
    run(["bun", "src/cli/main.ts", "frames", SCENE, "--variant", variant, "--view", view, "--times", ",".join(times), "--size", f"{size[0]}x{size[1]}", "--out", out])


def tiles(sheet, size, count, stem):
    """Cut a `frames` sheet (a grid of `size` tiles, row by row) into its tiles."""
    run(["magick", sheet, "-crop", f"{size[0]}x{size[1]}", "+repage", f"{stem}_%d.png"])
    return [f"{stem}_{i}.png" for i in range(count)]


def labelled(src, text, out, width):
    run(["magick", src, "-resize", f"{width}x", "-background", "#0d1420", "-fill", "#dddddd", "-pointsize", "15", "-gravity", "northwest",
         "-splice", "0x26", "-annotate", "+8+5", text, out])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--variant", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--times", required=True)
    ap.add_argument("--labels", required=True)
    ap.add_argument("--centre", required=True, help="x,y in the game frame: the middle of the window shown")
    ap.add_argument("--window", default="320x200", help="the window of the game frame shown enlarged to 640 wide (320x200 is doubled)")
    ap.add_argument("--reference", help="a 3 x 2 sheet of the same six expressions")
    ap.add_argument("--keep", action="store_true", help="reuse frames already rendered under --out")
    a = ap.parse_args()
    times, labels = a.times.split(","), a.labels.split(",")
    if len(times) != len(labels):
        sys.exit(f"{len(times)} times but {len(labels)} labels")
    cx, cy = (int(v) for v in a.centre.split(","))
    WIN = tuple(int(v) for v in a.window.split("x"))
    scale = 640 / WIN[0]
    scaled = "doubled" if scale == 2 else f"enlarged {scale:g} times"
    os.makedirs(a.out, exist_ok=True)
    tmp = os.path.join(a.out, "_tmp")
    os.makedirs(tmp, exist_ok=True)
    face_sheet, game_sheet = os.path.join(a.out, "face_frames.webp"), os.path.join(a.out, "game_frames.webp")
    if not (a.keep and os.path.exists(face_sheet)):
        frames(a.variant, "face", times, (640, 400), face_sheet)
    if not (a.keep and os.path.exists(game_sheet)):
        frames(a.variant, "game", times, (W, H), game_sheet)
    face = tiles(face_sheet, (640, 400), len(times), os.path.join(tmp, "face"))
    game = tiles(game_sheet, (W, H), len(times), os.path.join(tmp, "game"))

    cells = []
    for i, (t, label) in enumerate(zip(times, labels)):
        top = os.path.join(tmp, f"cell_face_{i}.png")
        labelled(face[i], f"{label}  t={t}  |  face camera", top, 640)
        x0, y0 = max(0, min(W - WIN[0], cx - WIN[0] // 2)), max(0, min(H - WIN[1], cy - WIN[1] // 2))
        ix, iy = max(0, min(W - INSET[0], cx - INSET[0] // 2)), max(0, min(H - INSET[1], cy - INSET[1] // 2))
        doubled, inset, both = (os.path.join(tmp, f"{k}_{i}.png") for k in ("doubled", "inset", "both"))
        run(["magick", game[i], "-crop", f"{WIN[0]}x{WIN[1]}+{x0}+{y0}", "+repage", "-filter", "point", "-resize", "640x", doubled])
        run(["magick", game[i], "-crop", f"{INSET[0]}x{INSET[1]}+{ix}+{iy}", "+repage", "-bordercolor", "white", "-border", "1", inset])
        run(["magick", doubled, inset, "-gravity", "southwest", "-geometry", "+6+6", "-composite", both])
        bottom = os.path.join(tmp, f"cell_game_{i}.png")
        labelled(both, f"{label}  t={t}  |  game camera, 1280x800 frame: {scaled}; inset at true size", bottom, 640)
        cell = os.path.join(tmp, f"cell_{i}.png")
        run(["magick", top, bottom, "-append", cell])
        cells.append(cell)
    sheet = os.path.join(a.out, "expression_sheet.webp")
    run(["magick", "montage", *cells, "-tile", "3x", "-geometry", "+0+0", "-background", "#0d1420", "-quality", "95", sheet])
    print(f"wrote {sheet}")

    if a.reference:
        rw, rh = (int(v) for v in run(["magick", "identify", "-format", "%w %h", a.reference]).split())
        pw, ph = rw // 3, rh // 2
        pairs = []
        for i, (t, label) in enumerate(zip(times, labels)):
            ref, pair = os.path.join(tmp, f"ref_{i}.png"), os.path.join(tmp, f"pair_{i}.png")
            run(["magick", a.reference, "-crop", f"{pw}x{ph}+{(i % 3) * pw}+{(i // 3) * ph}", "+repage", "-resize", "x400", ref])
            side = os.path.join(tmp, f"pair_raw_{i}.png")
            run(["magick", ref, face[i], "+append", side])
            labelled(side, f"{label}: the reference, and the build at t={t} (face camera)", pair, int(run(["magick", "identify", "-format", "%w", side])))
            pairs.append(pair)
        beside = os.path.join(a.out, "beside_reference.webp")
        run(["magick", "montage", *pairs, "-tile", "2x", "-geometry", "+4+4", "-background", "#0d1420", "-quality", "95", beside])
        print(f"wrote {beside}")
    for f in os.listdir(tmp):
        os.remove(os.path.join(tmp, f))
    os.rmdir(tmp)


if __name__ == "__main__":
    main()
