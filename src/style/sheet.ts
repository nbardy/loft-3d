// The style sheet: one image, a row per style and a column per example scene, every cell from the same camera.
//
//   bun src/style/sheet.ts [--out out/style_sheet.webp] [--size 640x400] [--time 1.3] [--styles toon,woodblock]
//
// Rows, top to bottom: the styles in STYLES order (toon, woodblock, biolume, papercraft). Columns, left to right:
// examples/serpent.ts, examples/shell.ts, examples/serpent_scales.ts.

import type { Camera } from "../artefact.ts";
import { parseSize, UsageError } from "../cli/args.ts";
import { writeWebp, type Frame } from "../cli/image.ts";
import { compile } from "../compile/index.ts";
import { headlessDevice } from "../host/headless.ts";
import { createHost } from "../host/index.ts";
import type { Scene } from "../scene.ts";
import { STYLE_NAMES, styleNamed, withStyle } from "./index.ts";

/** A high game camera that frames every example: the serpent's length and the shell's height. */
export const SHEET_CAMERA: Camera = { kind: "perspective", eye: [12.5, 12.5, 14.5], target: [0.3, 1.2, 0], fovY: 0.6 };

const EXAMPLES = ["serpent", "shell", "serpent_scales"] as const;

/** Cells in row-major order into one image: `columns` across. */
export function grid(frames: readonly Frame[], columns: number): Frame {
  const { width, height } = frames[0]!;
  const rows = Math.ceil(frames.length / columns);
  const W = width * columns;
  const rgba = new Uint8Array(W * height * rows * 4);
  frames.forEach((f, i) => {
    const x0 = (i % columns) * width, y0 = Math.floor(i / columns) * height;
    for (let y = 0; y < height; y++) rgba.set(f.rgba.subarray(y * width * 4, (y + 1) * width * 4), ((y0 + y) * W + x0) * 4);
  });
  return { width: W, height: height * rows, rgba };
}

function flag(argv: readonly string[], name: string, def: string): string {
  const i = argv.indexOf(name);
  if (i < 0) return def;
  const v = argv[i + 1];
  if (v === undefined) throw new UsageError(`${name} needs a value`);
  return v;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const out = flag(argv, "--out", "out/style_sheet.webp");
  const size = parseSize(flag(argv, "--size", "640x400"));
  const time = Number(flag(argv, "--time", "1.3"));
  const styles = flag(argv, "--styles", STYLE_NAMES.join(",")).split(",");
  const host = createHost(await headlessDevice());
  const scenes = await Promise.all(EXAMPLES.map(async (e) => ((await import(`../../examples/${e}.ts`)) as { default: Scene }).default));
  const frames: Frame[] = [];
  for (const s of styles) {
    for (const [i, scene] of scenes.entries()) {
      const loaded = await host.load(compile(withStyle(scene, styleNamed(s))));
      frames.push({ ...size, rgba: await loaded.frame({ camera: SHEET_CAMERA, ...size, time }) });
      loaded.destroy();
      console.log(`${s} x ${EXAMPLES[i]}`);
    }
  }
  const sheet = grid(frames, EXAMPLES.length);
  writeWebp(out, sheet);
  console.log(`wrote ${out}  ${sheet.width}x${sheet.height}  rows [${styles.join(", ")}]  columns [${EXAMPLES.join(", ")}]`);
}
