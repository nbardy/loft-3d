// RECIPE: a film. One scene cut into shots and delivered in several formats. Copy this file beside your scene and
// edit it; it imports only the library's public entry. `bun tools/film.ts <your film module> <out dir> all` renders it.
//
// What it makes. A cut list per format: each cut, from an instant on, holds one shot, and a shot is a still camera or
// a move from one camera to another between two instants, eased in and out. `shotAt` gives the camera at any instant;
// that is all a host needs to draw the film, and all the runner (tools/film.ts) uses: one load of the scene, then a
// sheet of every shot's first frame, a sheet of one frame per count, a proof that a looping film's last frame runs
// into its first, the frame time, chosen frames, and clips at several frame rates with an optional sound file muxed on.
// From the library: only `Camera` and `Scene` (types); the cameras are plain numbers, eased on the CPU, a number per
// frame.
//
// Parameters (`film`): `scene`; `seconds`, the clip's length (for a looping scene, its period or a whole multiple);
// `tempo`, a count of `bpm` beats a minute and `perBar` to a bar, or `none` (then the strip is a frame a second);
// `formats`, each a name, a size in pixels and its own cut list (two formats usually share the timing and differ in
// where the cameras stand); `inputs`, the host's inputs at an instant, when the scene declares any. Cut times are
// seconds; on a tempo, write them as counts times the beat.
//
// What it cannot do:
// - perspective cameras only (no orthographic shot, no zoom that is not a change of `fovY`);
// - a move is a straight blend of eye, target and field of view: no arc round a subject (the eye cuts the chord), no
//   path through more than two cameras (chain moves cut to cut), one easing (the square ease in and out);
// - a cut is instant: no dissolve, wipe or fade, and the picture is the scene's own (no titles, no grade);
// - a camera does not follow anything: it is numbers, not an expression of the scene, so a subject that travels must
//   be framed by hand (or by `move`s that track it);
// - one tempo for the whole film.
//
// Copying it: change the cut list first (that is the film); then the move's ease (`ease` below) and how two lenses
// blend (`blend`). Relatives worth trying, each a change to `lensOf` alone:
// - an orbit: blend the eye's angle and distance round the target instead of its position (an arc, not a chord);
// - a camera that follows: make a lens a function of time that reads your rig on the CPU (`Probe` in the library
//   evaluates a scene's expressions there), and a still holds that function;
// - handheld: add a small noise of time to the eye and target after blending;
// - a path: a move through several lenses with `through`-style interpolation instead of two.
import type { Camera, Scene } from "../../src/index.ts";

type V3 = readonly [number, number, number];
/** A perspective camera: where the eye is, what it looks at, the vertical field of view in radians. */
export type Lens = { readonly eye: V3; readonly target: V3; readonly fovY: number };
/** What a cut holds: one camera, or a move from one to another between two instants (seconds), eased in and out. */
export type Shot =
  | { readonly kind: "still"; readonly name: string; readonly lens: Lens }
  | { readonly kind: "move"; readonly name: string; readonly from: Lens; readonly to: Lens; readonly start: number; readonly end: number };
/** From `at` seconds to the next cut's (the last to the end), this shot. */
export type Cut = { readonly at: number; readonly shot: Shot };
/** A format: its frame in pixels and its own cut list. */
export type Format = { readonly name: string; readonly width: number; readonly height: number; readonly cuts: readonly Cut[] };
export type Tempo = { readonly kind: "beats"; readonly bpm: number; readonly perBar: number } | { readonly kind: "none" };
export type Film = {
  readonly name: string;
  readonly scene: Scene;
  readonly seconds: number;
  readonly tempo: Tempo;
  readonly formats: readonly Format[];
  /** The host's inputs at an instant of the film (seconds from its start). */
  readonly inputs?: (t: number) => Readonly<Record<string, readonly number[]>>;
};

/** A film, checked: every format's cuts start at 0 and rise, every move ends after it starts, names are distinct. */
export function film(f: Film): Film {
  const bad = (why: string): never => { throw new Error(`film "${f.name}": ${why}`); };
  if (!(f.seconds > 0)) bad(`seconds must be positive, got ${f.seconds}`);
  if (f.formats.length === 0) bad("no formats");
  if (new Set(f.formats.map((x) => x.name)).size !== f.formats.length) bad("two formats share a name");
  for (const x of f.formats) {
    if (!(x.width > 0 && x.height > 0)) bad(`format "${x.name}": width and height must be positive`);
    if (x.cuts[0]?.at !== 0) bad(`format "${x.name}": the first cut must be at 0`);
    x.cuts.forEach((c, i) => {
      if (i > 0 && !(c.at > x.cuts[i - 1]!.at)) bad(`format "${x.name}": cut ${i} (${c.shot.name}) at ${c.at} is not after the one before`);
      if (c.shot.kind === "move" && !(c.shot.end > c.shot.start)) bad(`format "${x.name}": move "${c.shot.name}" ends before it starts`);
    });
  }
  return f;
}

/** The tempo's count, in seconds, and the name of an instant. The one dispatcher over tempos. */
export function counting(tempo: Tempo): { readonly seconds: number; readonly name: (t: number) => string } {
  switch (tempo.kind) {
    case "beats": {
      const beat = 60 / tempo.bpm, bar = tempo.perBar * beat;
      return { seconds: beat, name: (t) => `${t.toFixed(1)} s (bar ${Math.floor(t / bar) + 1} beat ${((t % bar) / beat + 1).toFixed(0)})` };
    }
    case "none": return { seconds: 1, name: (t) => `${t.toFixed(2)} s` };
  }
}

/** Ease in and out (the library's `slowInOut`, power 2), on the CPU: a camera is a number per frame. */
const ease = (u: number): number => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u));
const blend = (a: Lens, b: Lens, u: number): Lens => {
  const m = (x: number, y: number) => x + (y - x) * u;
  return { eye: [m(a.eye[0], b.eye[0]), m(a.eye[1], b.eye[1]), m(a.eye[2], b.eye[2])], target: [m(a.target[0], b.target[0]), m(a.target[1], b.target[1]), m(a.target[2], b.target[2])], fovY: m(a.fovY, b.fovY) };
};
/** A shot's lens at time t. The one dispatcher over shots. */
function lensOf(s: Shot, t: number): Lens {
  switch (s.kind) {
    case "still": return s.lens;
    case "move": return blend(s.from, s.to, ease(Math.min(Math.max((t - s.start) / (s.end - s.start), 0), 1)));
  }
}

/** The shot in force at time t (seconds; the last cut at or before it) and its camera. */
export function shotAt(f: Format, t: number): { readonly shot: Shot; readonly camera: Camera } {
  let cut = f.cuts[0]!;
  for (const c of f.cuts) if (c.at <= t) cut = c;
  const l = lensOf(cut.shot, t);
  return { shot: cut.shot, camera: { kind: "perspective", eye: [...l.eye], target: [...l.target], fovY: l.fovY } };
}
