// The lighting library drawn for comparison (docs/lighting.md): every named look of the woodblock style, and the print
// as it is, on the crab from `game` (true size and close) beside its painted reference; the four-crab lineup in the
// video's looks; the video look beside the reference pictures; clips; and the cost of each look.
//
//   bun tools/light_gallery.ts stills [--only a,b] [--force]   the crab, one process per look (a scene per process)
//   bun tools/light_gallery.ts lineup [--only a,b] [--force]   the lineup, t = 2.5 and 18, one load per look
//   bun tools/light_gallery.ts sheets                          the sheets, from the stills (ImageMagick)
//   bun tools/light_gallery.ts clips [--only a,b]              22 s of the crab's game camera per look
//   bun tools/light_gallery.ts cost [--rounds 3] [--scene crab|lineup] [--only a,b]
//
// Everything goes under out/shade/ (git-ignored). Each command prints one line per item, not the renderer's log.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { LOOKS } from "../src/style/woodblock.ts";

const OUT = "out/shade";
const CRAB = "examples/bosses/reefback_titan.ts", LINEUP = "examples/bosses/crab_lineup.ts";
/** The print as it is first, then the library. */
const ALL = ["asPrinted", ...Object.keys(LOOKS)];
const REFS: Readonly<Record<string, string>> = {
  flat: "shading/shade_flat", twoTone: "shading/shade_two_tone", threeTone: "shading/shade_three_tone", bokashi: "shading/shade_bokashi", hatched: "shading/shade_hatched",
  contact: "shading/shade_contact", rim: "shading/shade_rim", cel: "shading/shade_best_game", referencePalette: "crab_round4/stalk_hybrid", engraving: "shading/shade_hatched",
  sunset: "lineup/face_pass", engravingSunset: "lineup/lineup_wide",
};
const ART = `${process.env.HOME}/git/loft/docs/art_direction`;
/** The lineup's sun for the sunset looks: low behind the crabs (the camera looks down -x). */
const SUNSET_SUN = "-0.95,0.3,0.05";
const VIDEO_LOOKS = ["hatched", "engraving", "engravingSunset"];

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const only = flag("--only")?.split(",");
const pick = (names: readonly string[]) => names.filter((r) => only === undefined || only.includes(r));
const lightOf = (r: string): string[] => (r === "asPrinted" ? [] : ["--light", r]);
const sunOf = (r: string): string[] => (r.toLowerCase().includes("sunset") ? ["--input", `sun=${SUNSET_SUN}`] : []);

function run(cmd: string, argv: readonly string[]): string {
  const r = spawnSync(cmd, argv, { encoding: "utf8", maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`${cmd} ${argv.join(" ")}\n${(r.stdout + r.stderr).split("\n").filter((l) => /rror|throw|at /.test(l)).slice(0, 12).join("\n")}`);
  return r.stdout + r.stderr;
}
const loft = (argv: readonly string[]): string => run("bun", ["src/cli/main.ts", ...argv]);
const hashes = (log: string): string => log.split("\n").filter((l) => l.includes("rgba")).map((l) => l.trim().split(/\s+/).slice(-1)[0]).join(" ");

function stills(): void {
  mkdirSync(`${OUT}/stills`, { recursive: true });
  for (const r of pick(ALL)) {
    const out = `${OUT}/stills/crab_${r}.webp`;
    if (existsSync(out) && !args.includes("--force")) continue;
    const t = performance.now();
    const log = loft(["render", CRAB, "--variant", "bruiser", ...lightOf(r), ...sunOf(r), "--views", "game,face", "--time", "6.3", "--size", "1280x800", "--out", out]);
    console.log(`crab_${r}  ${((performance.now() - t) / 1000).toFixed(0)} s  ${hashes(log)}`);
  }
}

function lineup(): void {
  mkdirSync(`${OUT}/lineup`, { recursive: true });
  for (const r of pick(["asPrinted", ...VIDEO_LOOKS])) {
    const out = `${OUT}/lineup/${r}.webp`;
    if (existsSync(out) && !args.includes("--force")) continue;
    const t = performance.now();
    loft(["frames", LINEUP, ...lightOf(r), ...sunOf(r), "--view", "lineup", "--times", "2.5,18", "--size", "1280x720", "--out", out]);
    console.log(`lineup_${r}  ${((performance.now() - t) / 1000).toFixed(0)} s  ${run("magick", ["identify", "-format", "%wx%h", out])}`);
  }
}

const label = (text: string, size = 20): string[] => ["-gravity", "NorthWest", "-fill", "white", "-undercolor", "#000000b0", "-pointsize", String(size), "-annotate", "+6+4", ` ${text} `];

function sheets(): void {
  const tmp = `${OUT}/tiles`;
  mkdirSync(tmp, { recursive: true });
  // The crab: game at true size (the crab's part of the frame), game doubled on the claw, face, the reference.
  const rows: string[] = [];
  for (const r of ALL) {
    const src = `${OUT}/stills/crab_${r}.webp`;
    if (!existsSync(src)) continue;
    const t = (i: number, argv: readonly string[]) => { const d = `${tmp}/${r}_${i}.png`; run("magick", [src, ...argv, d]); return d; };
    const files = [
      t(0, ["-crop", "640x400+200+40", "+repage", ...label(`${r}: game, true size`)]),
      t(1, ["-crop", "320x200+330+150", "+repage", "-filter", "point", "-resize", "640x400!", ...label("game x2")]),
      t(2, ["-crop", "1280x800+1280+0", "+repage", "-resize", "640x400!", ...label("face")]),
    ];
    const ref = REFS[r];
    const d = `${tmp}/${r}_ref.png`;
    if (ref !== undefined) run("magick", [`${ART}/${ref}.webp`, "-resize", "640x400^", "-gravity", "center", "-extent", "640x400", ...label(`reference: ${ref}`), d]);
    else run("magick", ["-size", "640x400", "xc:#101018", d]);
    files.push(d);
    const row = `${tmp}/row_${r}.png`;
    run("magick", [...files, "+append", row]);
    rows.push(row);
  }
  if (rows.length > 0) {
    run("magick", [...rows, "-append", "-quality", "92", `${OUT}/sheet_looks.webp`]);
    run("magick", [`${OUT}/sheet_looks.webp`, "-resize", "1600x", "-quality", "90", `${OUT}/sheet_looks_small.webp`]);
    console.log(`wrote ${OUT}/sheet_looks.webp, sheet_looks_small.webp (${rows.length} rows)`);
  }
  // The lineup: a row per look, t = 2.5 and 18.
  const lines: string[] = [];
  for (const r of ["asPrinted", ...VIDEO_LOOKS]) {
    const strip = `${OUT}/lineup/${r}.webp`;
    if (!existsSync(strip)) continue;
    const tiles = ["2.5", "18"].map((time, i) => { const d = `${tmp}/line_${r}_${i}.png`; run("magick", [strip, "-crop", `1280x720+${i * 1280}+0`, "+repage", "-resize", "960x540!", ...label(`${r}: t = ${time}`), d]); return d; });
    const row = `${tmp}/linerow_${r}.png`;
    run("magick", [...tiles, "+append", row]);
    lines.push(row);
  }
  if (lines.length > 0) { run("magick", [...lines, "-append", "-quality", "90", `${OUT}/sheet_lineup.webp`]); console.log(`wrote ${OUT}/sheet_lineup.webp (${lines.length} rows)`); }
  // The video look beside its references: the lineup in `engraving` and `engravingSunset`, lineup_wide, stalk_hybrid, the crab close.
  const eng = `${OUT}/lineup/engraving.webp`, sun = `${OUT}/lineup/engravingSunset.webp`;
  if (existsSync(eng) && existsSync(sun)) {
    const first = (strip: string) => { const d = `${tmp}/first_${strip.length}_${strip.endsWith("Sunset.webp") ? 1 : 0}.png`; run("magick", [strip, "-crop", "1280x720+0+0", "+repage", d]); return d; };
    const a = `${tmp}/v0.png`, b = `${tmp}/v1.png`, c = `${tmp}/v2.png`, d = `${tmp}/v3.png`;
    run("magick", [first(eng), "-resize", "960x540!", ...label("ours: engraving, t = 2.5", 22), a]);
    run("magick", [`${ART}/lineup/lineup_wide.webp`, "-resize", "960x540^", "-gravity", "center", "-extent", "960x540", ...label("reference: lineup_wide", 22), b]);
    run("magick", [first(sun), "-resize", "960x540!", ...label("ours: engravingSunset, sun behind, t = 2.5", 22), c]);
    const crab = `${OUT}/stills/crab_engraving.webp`;
    if (existsSync(crab)) {
      const e = `${tmp}/v4.png`, f = `${tmp}/v5.png`;
      run("magick", [crab, "-crop", "1280x800+1280+0", "+repage", "-resize", "864x540!", ...label("ours: engraving, face", 22), e]);
      run("magick", [`${ART}/crab_round4/stalk_hybrid.webp`, "-resize", "x540", ...label("reference: stalk_hybrid", 22), f]);
      run("magick", [e, f, "+append", "-resize", "960x540!", d]);
    } else run("magick", [`${ART}/crab_round4/stalk_hybrid.webp`, "-resize", "960x540^", "-gravity", "center", "-extent", "960x540", d]);
    run("magick", [a, b, "+append", `${tmp}/vt.png`]);
    run("magick", [c, d, "+append", `${tmp}/vb.png`]);
    run("magick", [`${tmp}/vt.png`, `${tmp}/vb.png`, "-append", "-quality", "90", `${OUT}/sheet_video_look.webp`]);
    console.log(`wrote ${OUT}/sheet_video_look.webp`);
  }
  rmSync(tmp, { recursive: true, force: true });
}

function clips(): void {
  mkdirSync(`${OUT}/clips`, { recursive: true });
  for (const r of pick(["hatched", "engraving"])) {
    const out = `${OUT}/clips/crab_${r}_22s.mp4`;
    if (existsSync(out) && !args.includes("--force")) continue;
    loft(["clip", CRAB, "--variant", "bruiser", ...lightOf(r), "--view", "game", "--seconds", flag("--seconds") ?? "22", "--fps", "30", "--size", "1280x800", "--out", out]);
    console.log(`wrote ${out}`);
  }
}

/** The normal frame in ms, as `loft profile` prints it. */
function frameMs(scene: string, extra: readonly string[], view: string, size: string): number {
  const text = loft(["profile", scene, ...extra, "--view", view, "--size", size, "--frames", "30"]);
  const m = /normal frame: ([\d.]+) ms/.exec(text);
  if (!m) throw new Error(`no normal frame in:\n${text.slice(0, 400)}`);
  return Number(m[1]);
}

function cost(): void {
  const rounds = Number(flag("--rounds") ?? "3");
  const which = flag("--scene") ?? "crab";
  const [scene, extra, view, size] = which === "lineup" ? [LINEUP, [] as string[], "lineup", "1280x800"] : [CRAB, ["--variant", "bruiser"], "game", "1280x800"];
  const file = `${OUT}/cost_${which}.json`;
  const seen: Record<string, { base: number[]; with: number[] }> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  for (let k = 0; k < rounds; k++) {
    for (const r of pick(Object.keys(LOOKS))) {
      // Alternated, the print as it is beside each look, so a pair shares the GPU's clock state as nearly as it can.
      // A shader module fails to build now and then ("null character found", AGENTS.md): skip the pair, say so, go on.
      let base: number, lit: number;
      try { base = frameMs(scene, extra, view, size); lit = frameMs(scene, [...extra, "--light", r], view, size); }
      catch (e) { console.log(`round ${k}  ${r.padEnd(16)} failed: ${String(e).split("\n").find((l) => /rror/.test(l)) ?? "?"}`); continue; }
      (seen[r] ??= { base: [], with: [] }).base.push(base);
      seen[r]!.with.push(lit);
      console.log(`round ${k}  ${r.padEnd(16)} as printed ${base.toFixed(2)}  with ${lit.toFixed(2)}  difference ${(lit - base).toFixed(2)} ms`);
      writeFileSync(file, JSON.stringify(seen, null, 1));
    }
  }
}

switch (args[0]) {
  case "stills": stills(); break;
  case "lineup": lineup(); break;
  case "sheets": sheets(); break;
  case "clips": clips(); break;
  case "cost": cost(); break;
  default: console.error("usage: bun tools/light_gallery.ts stills|lineup|sheets|clips|cost [--only a,b] [--force]"); process.exit(2);
}

