// Deliver a film (examples/recipes/film.ts) from one load of its scene:
//
//   bun tools/film.ts <film module> <out dir> <what> [--fps 30,60] [--pick t,t,...] [--strip-width 960] [--scale 1] [--sound song.wav]
//
// <what> is `all` or a comma list of:
//   shots   per format: the first frame of every shot (a tenth of a count in), to check the framing of the edit
//   strip   per format: a frame per count, a tenth of a count after it (a frame a second when the film has no tempo)
//   seam    per format: the frames at 0 and at the end must be the same picture, and the step across the seam no larger
//           than ordinary consecutive frames' (only for a scene that loops with a period dividing the film's length;
//           `all` leaves it out, and says so, for one that does not)
//   time    per format: GPU time of a normal frame, the first shot at t = 1
//   clips   per format and frame rate: exactly the film's length, H.264; with --sound (a WAV of the same length) muxed on
// --pick adds a 3 x 3 sheet of those instants in the first format, and the first as thumbnail.webp. --scale draws every
// picture at that fraction of its size (a quick proof of the whole delivery). Every sheet's line carries the hash of its
// pixels, so two deliveries can be compared. A README.txt describes what was written; its lines are also returned.
//
// The film module's default export is a `Film`. Another tool may call `deliver` with a film it built (tools/lineup_deliver.ts).
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loopTime, OPEN } from "../src/artefact.ts";
import { contactSheet, writeWebp, type Frame } from "../src/cli/image.ts";
import { openVideo } from "../src/cli/video.ts";
import { compile } from "../src/compile/index.ts";
import { headlessDevice } from "../src/host/headless.ts";
import { createHost } from "../src/host/host.ts";
import { counting, shotAt, type Film, type Format } from "../examples/recipes/film.ts";
import { muxSong } from "./mux_song.ts";

export const DELIVERABLES = ["shots", "strip", "seam", "time", "clips"] as const;
export type Deliverable = (typeof DELIVERABLES)[number];
export type Options = {
  /** `all`: every deliverable the film admits (the seam only when it loops). */
  readonly what: readonly Deliverable[] | "all"; readonly fps: readonly number[]; readonly pick: readonly number[];
  readonly stripWidth: number; readonly scale: number; readonly sound?: string;
};

const hash = (px: Uint8Array): string => createHash("sha256").update(px).digest("hex").slice(0, 16);
const change = (a: Uint8Array, b: Uint8Array): number => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i]! - b[i]!); return s / a.length; };

export async function deliver(film: Film, dir: string, o: Options): Promise<readonly string[]> {
  for (const r of o.fps) if (!(r > 0 && Number.isInteger(r))) throw new Error(`film: whole frame rates, got ${r}`);
  if (!(o.scale > 0)) throw new Error(`film: --scale must be positive, got ${o.scale}`);
  mkdirSync(dir, { recursive: true });
  let t0 = performance.now();
  const artefact = compile(film.scene);
  const compileMs = performance.now() - t0;
  t0 = performance.now();
  const loaded = await createHost(await headlessDevice()).load(artefact);
  const loadMs = performance.now() - t0;
  const loop = artefact.loop ?? OPEN, count = counting(film.tempo), L = film.seconds;
  console.log(`film ${film.name}: ${L} s; compile ${(compileMs / 1000).toFixed(1)} s, load ${(loadMs / 1000).toFixed(1)} s; ${artefact.stats.draws} draws`);
  // Whether the film loops: the scene's period divides its length. The camera at the end is then the camera at 0.
  const loops = loop.kind === "every" && Math.abs(L / loop.seconds - Math.round(L / loop.seconds)) < 1e-9;
  const wrap = (t: number) => ((t % L) + L) % L;

  const at = (f: Format, t: number, width: number, height: number): Promise<Uint8Array> =>
    loaded.frame({ camera: shotAt(f, wrap(t)).camera, width, height, time: loopTime(loop, t), inputs: film.inputs?.(t) ?? {} });
  /** A frame of a format `width` wide (its height by the format's aspect, even). */
  const shot = async (f: Format, t: number, width: number): Promise<Frame> => { const height = Math.round((width * f.height) / f.width / 2) * 2; return { width, height, rgba: await at(f, t, width, height) }; };
  const full = (f: Format) => Math.round((f.width * o.scale) / 2) * 2;
  const sw = Math.round(o.stripWidth * o.scale), square = (f: Format) => f.width === f.height;
  const sheet = async (name: string, f: Format, times: readonly number[], width: number): Promise<void> => {
    const frames: Frame[] = [];
    for (const t of times) frames.push(await shot(f, t, width));
    const s = contactSheet(frames);
    writeWebp(`${dir}/${name}`, s);
    console.log(`wrote ${dir}/${name}  ${s.width}x${s.height}  rgba ${hash(s.rgba)}  times [${times.map((t) => +t.toFixed(3)).join(", ")}]`);
  };
  const readme: string[] = [
    `${film.name}: ${L} s${loops ? ", a loop (the camera and the scene at the end are those at 0)" : ""}. Tempo: ${film.tempo.kind === "beats" ? `${film.tempo.bpm} BPM, ${film.tempo.perBar} to the bar` : "none"}.`,
    "", "Shots:", ...film.formats.flatMap((f) => f.cuts.map((c) => `  ${f.name} ${f.width}x${f.height}: from ${count.name(c.at)}, ${c.shot.name} (${c.shot.kind})`)), "",
  ];

  const what = o.what === "all" ? DELIVERABLES.filter((d) => d !== "seam" || loops) : o.what;
  if (o.what === "all" && !loops) { console.log("seam: left out (the scene does not loop with a period dividing the film)"); readme.push("No seam: the scene does not loop with a period dividing the film.", ""); }
  // One handler per deliverable; this switch is the only place that knows them all.
  for (const d of what) {
    switch (d) {
      case "shots":
        for (const f of film.formats) await sheet(`shots_${f.name}.webp`, f, f.cuts.map((c) => c.at + 0.1 * count.seconds), square(f) ? Math.round(sw * 0.5625) : sw);
        break;
      case "strip": {
        const times = Array.from({ length: Math.round(L / count.seconds) }, (_, c) => (c + 0.1) * count.seconds);
        for (const f of film.formats) await sheet(`strip_${f.name}.webp`, f, times, square(f) ? Math.round(sw * 0.28) : Math.round(sw / 2));
        break;
      }
      case "seam": {
        if (!loops) throw new Error(`film "${film.name}": no seam to prove: the scene ${loop.kind === "every" ? `loops every ${loop.seconds} s, which does not divide ${L} s` : "does not loop"}`);
        const seam: string[] = [];
        for (const f of film.formats) {
          const W = full(f), H = Math.round((W * f.height) / f.width / 2) * 2, dt = 1 / 30, px = (t: number) => at(f, t, W, H);
          const first = await px(0), again = await px(L), last = await px(L - dt), before = await px(L - 2 * dt);
          const ordinary: number[] = [];
          for (let k = 0; k < 32; k++) { const t = (k + 0.37) * (L / 32); ordinary.push(change(await px(t), await px(t + dt))); }
          const sorted = [...ordinary].sort((x, y) => x - y), median = sorted[Math.floor(sorted.length / 2)]!;
          seam.push(
            `${f.name} ${W}x${H}:`,
            `  frame at t = 0: ${hash(first)}; at t = ${L} (the end): ${hash(again)}   ${hash(first) === hash(again) ? "the same picture" : "DIFFERENT"}`,
            `  across the seam (t = ${(L - dt).toFixed(4)} to 0): mean change of a channel ${change(last, first).toFixed(3)} (${shotAt(f, wrap(L - dt)).shot.name === shotAt(f, 0).shot.name ? "inside one shot" : "a cut"})`,
            `  the two frames before it: ${change(before, last).toFixed(3)}; ordinary consecutive frames at ${ordinary.length} instants: median ${median.toFixed(3)}, least ${sorted[0]!.toFixed(3)}, most ${sorted[sorted.length - 1]!.toFixed(3)}: ${(change(before, last) / median).toFixed(2)} times the median`,
          );
          writeWebp(`${dir}/seam_${f.name}.webp`, contactSheet([{ width: W, height: H, rgba: before }, { width: W, height: H, rgba: last }, { width: W, height: H, rgba: first }]));
        }
        writeFileSync(`${dir}/seam_proof.txt`, seam.join("\n") + "\n");
        console.log(seam.join("\n"));
        readme.push("The seam:", ...seam, "");
        break;
      }
      case "time": {
        const timing: string[] = [];
        for (const f of film.formats) {
          const W = full(f), H = Math.round((W * f.height) / f.width / 2) * 2, rounds: number[] = [];
          for (let r = 0; r < 8; r++) rounds.push((await loaded.frameGpu({ camera: shotAt(f, 1).camera, width: W, height: H, time: 1 }, 20)).ms);
          const s = [...rounds].sort((x, y) => x - y);
          timing.push(`normal frame, ${f.name} ${W} x ${H}, t = 1: least ${s[0]!.toFixed(2)} ms, median ${s[4]!.toFixed(2)} ms GPU (8 rounds, least of 20 frames each)`);
        }
        console.log(timing.join("\n"));
        readme.push(...timing, "");
        break;
      }
      case "clips": {
        for (const f of film.formats) for (const fps of o.fps) {
          const n = Math.round(L * fps), name = `${film.name}_${f.name}_${fps}fps.mp4`, W = full(f), H = Math.round((W * f.height) / f.width / 2) * 2;
          const silent = o.sound === undefined ? `${dir}/${name}` : `${dir}/silent_${name}`, video = openVideo(silent, W, H, fps);
          const start = performance.now();
          for (let i = 0; i < n; i++) await video.write(await at(f, i / fps, W, H));
          await video.finish();
          if (o.sound !== undefined) { console.log(muxSong(silent, o.sound, `${dir}/${name}`)); rmSync(silent); }
          console.log(`wrote ${dir}/${name}  ${n} frames at ${fps} fps (${((performance.now() - start) / 1000).toFixed(0)} s)`);
          readme.push(`${name}: ${W}x${H}, ${n} frames at ${fps} fps${o.sound === undefined ? ", no sound" : `, sound ${o.sound}`}`);
        }
        readme.push("");
        break;
      }
    }
  }
  if (o.pick.length > 0) {
    const f = film.formats[0]!;
    await sheet("picks.webp", f, o.pick.slice(0, 9), Math.round(640 * o.scale));
    const thumb = await shot(f, o.pick[0]!, full(f));
    writeWebp(`${dir}/thumbnail.webp`, contactSheet([thumb]));
    readme.push(`picks.webp, thumbnail.webp: ${f.name} at ${o.pick.slice(0, 9).map(count.name).join(", ")}`, "");
  }
  readme.push(`compile ${(compileMs / 1000).toFixed(0)} s, load ${(loadMs / 1000).toFixed(0)} s; ${artefact.stats.draws} draws`);
  writeFileSync(`${dir}/README.txt`, readme.join("\n") + "\n");
  loaded.destroy();
  return readme;
}

/** The command line's options; `argv` keeps the positional arguments. */
export function parseOptions(argv: string[]): Options {
  const flag = (name: string, d: string): string => { const i = argv.indexOf(name); if (i < 0) return d; const v = argv[i + 1]; if (v === undefined) throw new Error(`${name} needs a value`); argv.splice(i, 2); return v; };
  const list = (s: string) => s.split(",").filter((x) => x !== "");
  const fps = list(flag("--fps", "30")).map(Number), pick = list(flag("--pick", "")).map(Number);
  const stripWidth = Number(flag("--strip-width", "960")), scale = Number(flag("--scale", "1")), sound = flag("--sound", "");
  const what = argv.splice(1, 1)[0];
  if (what === undefined) throw new Error(`film: expected <out dir> <all, or a comma list of ${DELIVERABLES.join(", ")}>`);
  const named = what === "all" ? "all" : list(what).map((w) => { if (!(DELIVERABLES as readonly string[]).includes(w)) throw new Error(`film: no deliverable "${w}": [${DELIVERABLES.join(", ")}]`); return w as Deliverable; });
  return { what: named, fps, pick, stripWidth, scale, sound: sound === "" ? undefined : resolve(sound) };
}

if (import.meta.main) {
  const argv = process.argv.slice(2), module = argv.shift();
  if (module === undefined) throw new Error("usage: bun tools/film.ts <film module> <out dir> <all|shots,strip,seam,time,clips> [--fps 30] [--pick t,...] [--strip-width 960] [--scale 1] [--sound song.wav]");
  const o = parseOptions(argv);
  if (argv.length !== 1) throw new Error(`film: expected one out dir, got [${argv.join(" ")}]`);
  await deliver((await import(resolve(module))).default as Film, argv[0]!, o);
  process.exit(0);
}
