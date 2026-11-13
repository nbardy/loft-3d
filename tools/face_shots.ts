// Pictures of a crab variant's face at named instants, for an expression sheet (docs/art_direction/DIRECTION.md,
// Round 4): each instant from the `face` camera, and from the `game` camera at 1280 x 800 with the head cut out at its
// true size and enlarged. One variant per process; the sheets are laid out from these files with ImageMagick.
//
//   bun tools/face_shots.ts <variant> <out dir> posing=18,greedy=2.4,...
//
// Writes <out>/<name>_face.webp (960 x 600), <name>_game.webp (the whole frame), <name>_big.webp (a 320 x 200 window
// on the head, doubled) and <name>_true.webp (the middle 200 x 140 of that window at its true size).

import { compile, parseVariantAsk, type Artefact } from "../src/index.ts";
import { resolveCamera } from "../src/cli/cameras.ts";
import { writeWebp, type Frame } from "../src/cli/image.ts";
import { headlessHost } from "../src/cli/load.ts";
import { cameraMatrices, project } from "../src/host/camera.ts";
import { design } from "../examples/bosses/reefback_titan.ts";

const [variant, out, list] = process.argv.slice(2);
if (variant === undefined || out === undefined || list === undefined) throw new Error("usage: bun tools/face_shots.ts <variant> <out dir> name=seconds,...");
const shots = list.split(",").map((item) => {
  const [name, at] = item.split("=");
  const t = Number(at);
  if (name === undefined || name === "" || !Number.isFinite(t)) throw new Error(`face_shots: "${item}" is not name=seconds`);
  return { name, t };
});

const resolved = design.resolve(parseVariantAsk(variant));
const built = design.build(resolved);
const artefact = compile(built.scene) as Artefact;
const loaded = await (await headlessHost()).load(artefact);

const GAME = { width: 1280, height: 800 }, FACE = { width: 960, height: 600 }, CUT = { width: 320, height: 200 }, TRUE = { width: 200, height: 140 }, TIMES = 2;
// Where the head is in the game frame: the carapace's front end, a little above the body's ride, at rest. The crab
// walks in place, so one window serves every instant.
const n = resolved.numbers as { readonly carapace: { readonly to: number }; readonly ride: number };
const game = resolveCamera(artefact, "game");
const at = project(cameraMatrices(game, GAME.width / GAME.height), [n.carapace.to, n.ride + 0.9, 0], GAME.width, GAME.height);
const x0 = Math.round(Math.min(Math.max(at.x - CUT.width / 2, 0), GAME.width - CUT.width)), y0 = Math.round(Math.min(Math.max(at.y - CUT.height / 2, 0), GAME.height - CUT.height));

/** A window of a frame, each pixel `times` pixels square. */
function cut(f: Frame, x: number, y: number, w: number, h: number, times: number): Frame {
  const rgba = new Uint8Array(w * times * h * times * 4);
  for (let j = 0; j < h * times; j++) for (let i = 0; i < w * times; i++) {
    const from = ((y + Math.floor(j / times)) * f.width + x + Math.floor(i / times)) * 4;
    rgba.set(f.rgba.subarray(from, from + 4), (j * w * times + i) * 4);
  }
  return { width: w * times, height: h * times, rgba };
}

for (const s of shots) {
  const face: Frame = { ...FACE, rgba: await loaded.frame({ camera: resolveCamera(artefact, "face"), ...FACE, time: s.t }) };
  const whole: Frame = { ...GAME, rgba: await loaded.frame({ camera: game, ...GAME, time: s.t }) };
  writeWebp(`${out}/${s.name}_face.webp`, face);
  writeWebp(`${out}/${s.name}_game.webp`, whole);
  writeWebp(`${out}/${s.name}_true.webp`, cut(whole, x0 + (CUT.width - TRUE.width) / 2, y0 + (CUT.height - TRUE.height) / 2, TRUE.width, TRUE.height, 1));
  writeWebp(`${out}/${s.name}_big.webp`, cut(whole, x0, y0, CUT.width, CUT.height, TIMES));
  console.log(`${s.name.padEnd(12)} t=${s.t}`);
}
loaded.destroy();
console.log(`wrote ${shots.length} instants of ${resolved.label} to ${out}  (game window at ${x0}, ${y0}, ${CUT.width} x ${CUT.height})`);
