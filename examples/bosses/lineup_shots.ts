// The crab lineup's tempo, formations and shots (docs/lineup.md, "A drilled group"). Plain numbers, no scene: the scene
// (crab_lineup.ts), the deliverables (tools/lineup_deliver.ts) and the framing stand-in (tools/lineup_framing.ts) all
// read them here, so a camera is stated once.

import type { Camera } from "../../src/index.ts";
import { shotAt as filmShotAt, type Format, type Lens, type Shot } from "../recipes/film.ts";
export type { Format, Lens, Shot };

// ---- the tempo ----
export const BPM = 120;
/** Seconds in a beat (a count) and in a bar (4/4), and the loop: sixteen bars, 64 counts. */
export const BEAT = 60 / BPM, BAR = 4 * BEAT, BARS = 16, PERIOD = BARS * BAR;
/** Count c (0 is the loop's first downbeat), in seconds. */
export const beat = (c: number): number => c * BEAT;

// ---- the group: left to right as the camera sees it; the centre is the middle member ----
/** Where the faces look: far in front of the group (each crab faces +x; the camera's left is +z). */
export const AUDIENCE = [100, 3, 6] as const;
type XZ = readonly [number, number];
/**
 * The formations: every member's place (world x toward the camera, z the camera's left), left to right, seen from above
 * the heads (docs/lineup.md, "Framing from above"): depth in a formation is height on screen, so each has real depth.
 * The V is three rows 8 deep: the centre in front, a pair behind it 12 to the right and 15 to the left (every great claw
 * is on the camera's left, so the left wing stands 3 wider to keep the samurai's low face out from behind the
 * centre's claw), the outer pair behind them. The line is a shallow arc, 13 apart (the least width that keeps five
 * slam discs and five boats in their own lanes), its ends 8 back. The diagonal runs away from the camera, the fiddler
 * in front, each next member 6 back and 9 to the right.
 */
const DIAGONAL: readonly XZ[] = [[0, 18], [-6, 9], [-12, 0], [-18, -9], [-24, -18]];
/** The diagonal with member k stepped 8 forward, out of the group, for its solo (in the group a soloist's own low single
 * had its front-left neighbour's eyestalks, legs and gauntlet across its face). */
const soloing = (k: number): readonly XZ[] => DIAGONAL.map(([x, z], j) => [j === k ? x + 8 : x, z] as const);
export const PLACES: Readonly<Record<string, readonly XZ[]>> = {
  V: [[-16, 30], [-8, 15], [0, 0], [-8, -12], [-16, -24]],
  line: [[-8, 26], [-2, 13], [0, 0], [-2, -13], [-8, -26]],
  diagonal: DIAGONAL,
  // The diagonal slid 4 to the camera's left: the chorus's travel in step (count 42), not a change of formation.
  diagonalLeft: DIAGONAL.map(([x, z]) => [x, z + 4] as const),
  solo0: soloing(0), solo1: soloing(1), solo2: soloing(2), solo3: soloing(3), solo4: soloing(4),
};

// ---- the boats a host moves ----
/**
 * The host's inputs at loop time t. The shoved boats (`boat2.at`) are parked out of every frame (behind the cameras) all through: the slam
 * is about the water. Each thrown boat (`throw.land`, in its crab's axes) comes down where it is thrown, in the line's
 * foreground, on count 32; from the cut on 33 to the Grab's next cycle (the cut on 16, where it is home again) the
 * landing is a place far behind the group. Every move of a boat is on a cut. Checks read the defaults (the true places).
 */
// 150 in front of its crab: behind every camera (the furthest stands at world x 60; a parked boat at x 90 or more even
// through the quarter turn). Parked 70 behind, it was a row of small boats below the horizon in every raised shot.
export const PARKED = [150, 0] as const;
export function hostInputs(names: readonly string[], land: (k: number) => XZ, t: number): Record<string, readonly number[]> {
  const u = ((t % PERIOD) + PERIOD) % PERIOD, thrownParked = u >= beat(33) || u < beat(16);
  return Object.fromEntries(names.flatMap((n, k) => [[`${n}.throw.land`, thrownParked ? PARKED : land(k)], [`${n}.boat2.at`, PARKED]]));
}

// ---- the shots (a cut list of the film recipe, examples/recipes/film.ts) ----
type V3 = readonly [number, number, number];
const lens = (eye: V3, target: V3, fovY: number): Lens => ({ eye, target, fovY });
/** One member alone, straight in front of its place (a solo, a face): close enough that its body is a third of the height or more (docs/lineup.md, "Third staging"). */
const SINGLE: Readonly<Record<string, { readonly distance: number; readonly aim: number }>> = {
  fiddler: { distance: 26, aim: 3.2 }, mask: { distance: 31, aim: 3.4 }, islander: { distance: 30, aim: 3.4 }, bruiser: { distance: 30, aim: 3.4 }, stilt: { distance: 40, aim: 5.8 },
};
// A fifth further back and aimed 1.5 higher than first framed: in their solos the great claws go up, and at the first
// framing the fiddler's, the bruiser's and the tongs' fingers (their clicks) were above the frame.
const single = (variant: string, at: XZ): Lens => { const d = SINGLE[variant.split("+")[0]!] ?? SINGLE.islander!; return lens([at[0] + 1.2 * d.distance, 3, at[1]], [at[0], d.aim + 1.5, at[1]], 0.4); };

/**
 * The group's framings (docs/lineup.md, "Framing from above"), by format: raised, wide, close to the front member and
 * pitched down, so that depth in the formation becomes height in the frame, the front member is large, the others
 * step back up the frame, rear faces show above the front members' heads, and the horizon and the sunset are a band at
 * the top. `raised(front, z, height, distance, pitch, fovY)`: the eye `distance` in front of the front member (world x)
 * at `z`, `height` above the water, pitched down `pitch` degrees.
 */
export const raised = (front: number, z: number, height: number, distance: number, pitch: number, fovY: number): Lens => {
  const p = (pitch * Math.PI) / 180, x = front + distance;
  return lens([x, height, z], [x - 10 * Math.cos(p), height - 10 * Math.sin(p), z], fovY);
};
export const GROUP = {
  wide: {
    V: raised(0, 3, 20, 34, 15, 0.8), line: raised(0, 0, 24, 40, 17, 0.8), lineLow: raised(0, 0, 24, 40, 17, 0.8),
    // The throw's push-in ends further back and pitched less than first framed (22, 36, 18): the boats thrown over the
    // heads top out about 26 up, and from there they left the frame's top for a second (docs/lineup.md, "Deeper").
    lineClose: raised(0, 0, 22, 44, 13, 0.8), diagonal: raised(0, 9, 20, 30, 22, 0.8), diagonalIn: raised(0, 9, 20, 28, 22, 0.8),
  },
  // The square, searched with the formations as they are (tools/lineup_framing.ts --search square; docs/lineup.md,
  // "Deeper"): steep, with the horizon 2% from the top (a first search without that bound came out lower and left a
  // band of empty sea over the group), the group whole across the frame, every face clear in the V and the diagonal.
  square: {
    V: raised(0, 3, 40, 46, 22, 0.8), line: raised(0, 0, 40, 50, 22, 0.8), lineLow: raised(0, 0, 40, 53, 22, 0.8),
    lineClose: raised(0, 0, 40, 50, 22, 0.8), diagonal: raised(0, 9, 36, 38, 22, 0.8), diagonalIn: raised(0, 9, 36, 39, 22, 0.8),
  },
} as const;

/**
 * The edit, in counts: the group in frame for 52 of 64, cut to a member only for its solo and one face. The V opens and
 * pulls back as the group sidesteps into the line (4 to 8); the slam on the line; a cut on 16 to a lower framing that
 * pushes in through the throw; the islander's face on 33 (the boats have landed); the group sidesteps into the diagonal
 * as the camera pushes in (34 to 48); each soloist alone for its two counts; back to the V (58 to 62), held still
 * across the seam on the struck pose, so the loop's seam is inside one shot.
 */
function edit(f: keyof typeof GROUP, line: readonly string[]): Format["cuts"] {
  const G = GROUP[f], at = (c: number) => beat(c);
  const cuts: { at: number; shot: Shot }[] = [
    { at: at(0), shot: { kind: "move", name: "open", from: G.V, to: G.line, start: at(4), end: at(8) } },
    { at: at(16), shot: { kind: "move", name: "throw", from: G.lineLow, to: G.lineClose, start: at(16), end: at(26) } },
    { at: at(33), shot: { kind: "still", name: "face", lens: single(line[2]!, PLACES.line![2]!) } },
    { at: at(34), shot: { kind: "move", name: "chorus", from: G.line, to: G.diagonalIn, start: at(34), end: at(46) } },
    ...line.map((v, k) => ({ at: at(48 + 2 * k), shot: { kind: "still" as const, name: `solo${k}`, lens: single(v, PLACES[`solo${k}`]![k]!) } })),
    { at: at(58), shot: { kind: "move", name: "button", from: G.diagonal, to: G.V, start: at(58), end: at(62) } },
  ];
  return cuts;
}
export function formats(line: readonly string[]): { readonly wide: Format; readonly square: Format } {
  return { wide: { name: "wide", width: 1920, height: 1080, cuts: edit("wide", line) }, square: { name: "square", width: 1080, height: 1080, cuts: edit("square", line) } };
}
export type FormatName = "wide" | "square";

/** The shot in force at time t (wrapped into the loop), and its camera. */
export function shotAt(f: Format, t: number): { readonly shot: Shot; readonly camera: Camera } {
  return filmShotAt(f, ((t % PERIOD) + PERIOD) % PERIOD);
}
