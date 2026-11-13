// `loft variants <design.ts>`: every named variant of a design (rows) through its comparison cameras (columns, the
// design's `compare` unless --views), for an art director to compare. Writes one picture per variant and camera
// (<out>/<variant>/<camera>.webp) and one labelled sheet (<out>/sheet.webp): beside each row its name, the slots it
// changes from base, the numbers it changes, and its one-line description.
//
// Each variant is built, compiled and drawn in turn in one process, one loaded artefact at a time.
import type { Artefact } from "../artefact.ts";
import type { Command } from "./args.ts";
import { resolveCamera } from "./cameras.ts";
import { writeWebp, type Frame } from "./image.ts";
import { blank, drawText, paste, textWidth } from "./label.ts";
import { headlessHost, styled } from "./load.ts";
import { subjectAt } from "./variant.ts";

const INK: readonly [number, number, number] = [236, 226, 200], DIM: readonly [number, number, number] = [160, 152, 136], PAPER: readonly [number, number, number] = [22, 22, 26];
const LABEL_W = 320, HEAD_H = 44;

/** Words into lines of at most `chars` characters. */
function wrap(text: string, chars: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(/\s+/).filter((w) => w !== "")) {
    const last = lines.at(-1);
    if (last !== undefined && last.length + 1 + word.length <= chars) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

export async function variants(cmd: Extract<Command, { kind: "variants" }>): Promise<void> {
  const subject = await subjectAt(cmd.path);
  if (subject.kind !== "design") throw new Error(`${cmd.path} exports a scene, not a design: it has no variants to compare (docs/variants.md)`);
  const d = subject.design;
  const rows = cmd.only.kind === "all" ? d.variants : cmd.only.names;
  const views = cmd.views.kind === "design" ? d.spec.compare : cmd.views.names;
  // Every name is checked before anything is compiled: a typo costs nothing.
  const resolved = rows.map((v) => d.resolve({ variant: v, picks: [] }));
  const { compile } = (await import("../index.ts")) as { compile: (s: unknown) => Artefact };
  const host = await headlessHost();

  const { width: w, height: h } = cmd.size;
  const sheet = blank(LABEL_W + views.length * w, HEAD_H + rows.length * h, PAPER);
  views.forEach((v, j) => drawText(sheet, v, LABEL_W + j * w + Math.max(8, (w - textWidth(v, 3)) / 2), 12, 3, INK));

  for (const [i, r] of resolved.entries()) {
    const t = performance.now();
    const built = d.build(r);
    const artefact = compile(await styled(built.scene, cmd.style, cmd.light));
    const loaded = await host.load(artefact);
    for (const [j, view] of views.entries()) {
      const rgba = await loaded.frame({ camera: resolveCamera(artefact, view), ...cmd.size, time: cmd.time });
      const frame: Frame = { ...cmd.size, rgba };
      writeWebp(`${cmd.out}/${r.label}/${view}.webp`, frame);
      paste(sheet, frame, LABEL_W + j * w, HEAD_H + i * h);
    }
    loaded.destroy();

    // The row's label: name, the slots it changes, the numbers it changes, what it is.
    const changed = d.slots.filter((s) => r.choice[s] !== "base").map((s) => `${s}=${r.choice[s]}`);
    const base = d.spec.numbers as Record<string, unknown>, mine = r.numbers as Record<string, unknown>;
    const numbers = Object.keys(base).filter((k) => JSON.stringify(base[k]) !== JSON.stringify(mine[k]));
    let y = HEAD_H + i * h + 12;
    drawText(sheet, r.label, 12, y, 3, INK); y += 34;
    for (const line of [...changed, ...(numbers.length > 0 ? wrap(`numbers: ${numbers.join(", ")}`, 24) : [])]) { drawText(sheet, line, 12, y, 2, INK); y += 20; }
    y += 8;
    for (const line of wrap(d.about(rows[i]!), 24)) { drawText(sheet, line, 12, y, 2, DIM); y += 20; }
    console.log(`${r.label.padEnd(24)} ${((performance.now() - t) / 1000).toFixed(1)} s  ${[...changed, ...numbers.map((k) => `${k}*`)].join(" ") || "(base)"}`);
  }

  writeWebp(`${cmd.out}/sheet.webp`, sheet);
  console.log(`wrote ${cmd.out}/sheet.webp  ${sheet.width}x${sheet.height}  rows [${rows.join(", ")}]  columns [${views.join(", ")}]  t=${cmd.time}`);
}
