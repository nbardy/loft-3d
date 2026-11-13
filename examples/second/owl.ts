// An owl on a mooring post: a face that acts. Four expressions (sleepy, curious, alarmed, and a glare struck and held
// like a kabuki mie), a blink laid on the lids alone, a ruffle added on top; the glare snaps the head round in four
// frames and holds dead still while the ruffle goes on underneath it.
// Shows: `cast`, `score` and its layers (`show`, `only`, `added`, `during`), `struck`, and their checks `holdsStill`
// and `expressionsRead`. Ground: a calm sea; the post stands in it (`FLOOR`: one line to change).
//
// Theory, before running. A cast is channels and numbers, and an owl's face is six numbers (lids, their slant, pupils,
// head turn, head tilt, ear tufts): fits. The lids are paint on the eyeball (the lid's edge is a height on the ball,
// so a lid is an inequality, not a part). `struck` returns one weight for a `show` layer: fits; `holdsStill` reads the
// score the face is drawn from: fits. Predicted fight: none in these two modules; the risk is that `expressionsRead`
// needs world points ("marks") for things that exist only as paint (a lid's edge), so I compute them a second time.
//
// Scored. `struck` and `holdsStill` fit (held 1.77 s, every channel exactly its pose under a ruffle that kept moving).
// `cast` and `score` fit for faces; the blink fought: `only` could move channels only toward a named expression, so a
// shut lid had to be named one, and `expressionsRead` then failed it as a face never shown. Opened: `only({ lid: 1 }, w)`.
// The predicted friction was real but small: the lid's edge is paint, so its mark is that inequality written twice.
import {
  add, added, cast, during, lift, mix, mul, only, place, rigid, rotateAbout, scene, score, plane, show, sin, smoothstep, strand, struck, sub, time, toon, tremor, vec3,
  type F, type Frame, type P3,
} from "../../src/index.ts";
import { rotate } from "../../src/map/chart.ts";
import { expressionsRead, tolerance } from "../../src/check.ts";
import { holdsStill } from "../../src/geom/struck.ts";

const FLOOR = plane; // the ground under the post
const LOOP = 12, TOP = 2.2, EYE = 0.2, HEAD = 0.55;
const brown = [0.45, 0.32, 0.2] as const, buff = [0.92, 0.82, 0.62] as const, amber = [1.0, 0.62, 0.08] as const, ink = [0.05, 0.04, 0.03] as const;

// ---- the cast: six channels; each expression says only what it changes -------------------------------------------------
const owl = cast({ lid: 0.2, slant: 0, pupil: 0.45, turn: 0, tilt: 0, tufts: 0.3 }, {
  sleepy: { lid: 0.72, pupil: 0.3, tufts: 0, tilt: 0.12 },
  curious: { lid: 0, pupil: 0.8, tilt: 0.5, turn: 0.3 },
  alarmed: { lid: -0.15, pupil: 0.2, tufts: 1 },
  glare: { lid: 0.42, slant: 0.9, pupil: 0.25, turn: -0.6, tilt: -0.18, tufts: 1 },
});
const glare = struck(time, { from: 8.6, snap: 0.13, hold: 1.8, release: 0.9 });
const blinks = [1.2, 4.4, 6.0, 11.4].map((at) => during(time, { from: at, to: at + 0.06, rise: 0.06 }));
const face = score(owl, (t) => [
  show("sleepy", during(t, { from: 0.3, to: 2.4, rise: 0.6 })),
  show("curious", during(t, { from: 3.0, to: 5.2, rise: 0.25 })),
  show("alarmed", during(t, { from: 5.9, to: 7.8, rise: 0.08, fall: 0.6 })),
  // The fight: written first as `shut: { lid: 1 }` in the cast and `only("shut", ["lid"], w)`; then `expressionsRead`
  // failed with "never shown: shut", because a blink is no face. `only` now takes the numbers themselves.
  ...blinks.map((w) => only({ lid: 1 }, w)),
  added({ tilt: mul(tremor(t, 7, 1), 0.04), tufts: mul(tremor(t, 5, 2), 0.08) }), // the ruffle flows, so it is laid first
  show("glare", glare.weight), // struck last: at weight 1 it covers every layer under it
]);
const p = face.at(time);

// ---- the head: turned and tilted by the score, on a body on a post ----------------------------------------------------
const neck: P3 = vec3(0, TOP + 1.05, 0);
const yx = rotateAbout([1, 0, 0], [0, 1, 0], p.turn), yz = rotateAbout([0, 0, 1], [0, 1, 0], p.turn);
const head: Frame = { o: add(neck, vec3(0, HEAD * 0.8, 0)), x: yx, y: rotateAbout([0, 1, 0], yx, p.tilt), z: rotateAbout(yz, yx, p.tilt) };
const at = (q: readonly [number, number, number] | P3): P3 => add(head.o, rotate(head, lift<"vec3">(q)));
const ball = (name: string, r: number, len: number, paint: (m: F, v: F) => P3, aspect = 1) => strand({
  name, spine: (m) => vec3(mul(sub(m, 0.5), len), 0, 0), stations: 6, girth: r, section: { aspect }, tips: [{ round: 0.5 }, { round: 0.5 }],
  paint, detail: { along: 24, around: 24 }, up: [0, 1, 0],
});
// An eye looks along +x. On the ball, height = sin(2 pi v) and side = cos(2 pi v), each times the section's radius; the
// lid covers what is above 1 - 2 lid, tilted by the slant (inner corner down: a frown).
const eyePaint = (side: 1 | -1) => (m: F, v: F): P3 => {
  const r = sin(mul(m, Math.PI)), h = mul(sin(mul(v, Math.PI * 2)), r), across = mul(sin(mul(add(v, 0.25), Math.PI * 2)), r);
  const edge = add(sub(1, mul(p.lid, 2)), mul(mul(across, p.slant), -0.6 * side));
  const iris = mix(vec3(...amber), vec3(...ink), smoothstep(sub(1.02, mul(p.pupil, 0.22)), sub(1.0, mul(p.pupil, 0.22)), add(m, 0.12)));
  return mix(mix(vec3(...buff), iris, smoothstep(0.7, 0.74, m)), vec3(...brown), smoothstep(sub(edge, 0.03), edge, h));
};
const eyes = ([-1, 1] as const).map((s) => place(ball(`eye${s < 0 ? "L" : "R"}`, EYE, EYE * 2, eyePaint(s)), rigid({ ...head, o: at([HEAD * 0.62, 0.05, s * 0.24]) })));
const skull = place(ball("head", HEAD, HEAD * 1.6, (m, v) => mix(vec3(...brown), vec3(...buff), smoothstep(0.55, 0.8, m)), 0.95), rigid(head));
const beak = place(strand({ name: "beak", spine: (m) => vec3(add(HEAD * 0.7, mul(m, 0.15)), sub(-0.08, mul(m, 0.12)), 0), stations: 4, girth: (m) => mul(sub(1, m), 0.07), tips: ["round", "point"], paint: ink, detail: { along: 8, around: 8 } }), rigid(head));
const tufts = ([-1, 1] as const).map((s) => place(strand({
  name: `tuft${s < 0 ? "L" : "R"}`, stations: 4, girth: (m) => mul(sub(1, m), 0.09), tips: ["round", "point"], paint: brown, detail: { along: 10, around: 8 },
  spine: (m) => add(vec3(0.1, HEAD * 0.75, s * 0.28), mul(vec3(-0.15, mix(0.1, 0.45, p.tufts), mul(mix(0.35, 0.08, p.tufts), s)), m)),
}), rigid(head)));
const body = place(ball("body", 0.62, 1.5, (m, v) => mix(vec3(...brown), vec3(...buff), mul(smoothstep(0.1, 0.6, sin(mul(add(v, 0.5), Math.PI * 2))), 0.7)), 0.9),
  rigid({ o: vec3(0, TOP + 0.55, 0), x: vec3(0, 1, 0), y: vec3(-1, 0, 0), z: vec3(0, 0, 1) }));
const post = strand({ name: "post", spine: (m) => vec3(0, mul(m, TOP), 0), stations: 4, girth: 0.32, tips: ["open", "open"], paint: [0.3, 0.24, 0.2], detail: { along: 4, around: 16 } });

export default scene({
  ground: FLOOR, things: [post, body, skull, beak, ...eyes, ...tufts],
  style: toon({ bands: 3, outline: 0.03 }), sun: [0.5, 0.8, 0.4], period: LOOP,
  cameras: { game: { kind: "perspective", eye: [8, 4.6, 3], target: [0, 2.1, 0], fovY: 0.6 }, face: { kind: "perspective", eye: [4, 3.9, 0.4], target: [0, 3.7, 0], fovY: 0.4 } },
});

// Marks: drawn lengths the check projects. The lid is paint, so its edge is the paint's inequality computed again here.
const lidEdge = at(vec3(HEAD * 0.62 + EYE * 0.55, add(0.05, mul(sub(1, mul(p.lid, 2)), EYE * 0.8)), 0.24));
const tuftTip = at(vec3(-0.05, mix(0.1, 0.45, p.tufts), mix(0.63, 0.36, p.tufts)));
export const checks = [
  holdsStill(face, { glare }, { period: LOOP, within: tolerance.units(1e-4) }),
  expressionsRead(face, { beak: { from: head.o, to: at([HEAD * 0.85, -0.2, 0]) }, tuft: { from: head.o, to: tuftTip }, lid: { from: at([HEAD * 0.62, 0.05, 0.24]), to: lidEdge } }, {
    camera: "game", period: LOOP, apart: tolerance.share(0.08), of: { from: at([0, 0, -0.24]), to: at([0, 0, 0.24]) },
  }),
];
