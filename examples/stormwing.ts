// Stormwing: a boss of the air that hangs low over the sea. Seen from a high camera it is a broad dark kite of two
// membranous wings with scalloped trailing edges, a gold crown on its head (the one bright thing: the face), a long
// whip tail ending in a diamond fluke. Idle: a slow beat whose tips lag the shoulders while the body bobs against it.
// Attack (the `strike` input, 0 to 1): it rears and cocks its wings down and back, then claps them up and forward
// over its head as it lunges, and lightning drops from the clap. Faces +x, y up; parts are authored in its own frame
// and placed on it (`rigid`), so the left side is the mirror of the right.

import {
  add, max, min, fract, beat, breathe, cos, draw, fan, spiralTube, input, keys, lift, chain, mirror, mix, mul, on, palette, param, place, polyline, rotateAbout,
  scene, sea, sin, smoothstep, spacing, strike, strand, sub, through, time, toon, vec3, abs, framed, surface, retarded,
  type Expr, type F, type Frame, type P3,
} from "../src/index.ts";
import { rigid } from "../src/geom/rig.ts";

const S = {
  hover: 5.2, bob: 0.3, girth: 0.95, tailSway: 1.1, tailRate: 0.22,
  beatRate: 0.3, beatAmp: 0.4, beatLag: 0.55, beatBias: 0.06,
  shoulder: [1.3, 0.3, 0.55] as const, upperArm: 2.4, forearm: 3.0,
  fingers: [[0.22, 4.4], [-0.7, 4.9], [-2.1, 4.6]] as const, // direction (x per unit out) and length
  hip: [-3.4, 0.0, 0.32] as const, sag: 0.1, scallop: 0.22,
  clapLift: 1.25, cock: 0.4, clapSweep: 1.05, rear: 0.35, lunge: 1.6,
  hornLength: 2.3, hornCurl: 1.5, crown: 2.4,
  // colour: a dark storm body and wings against the water, one bright gold crown, electric eyes and spine
  back: [0.13, 0.11, 0.27], belly: [0.62, 0.66, 0.82], membrane: [0.11, 0.09, 0.24], vein: [0.3, 0.6, 0.95], edge: [0.5, 0.46, 0.9],
  bone: [0.98, 0.9, 0.62], gold: [1.0, 0.76, 0.16], spark: [0.55, 1.0, 1.0], mouth: [0.85, 0.2, 0.32],
} as const;

const strikeIn = input("strike", "f32", [0]);
const span = param("stormwing.span", 1, { min: 0.6, max: 1.5 });
const tailLength = param("stormwing.tail", 9, { min: 4, max: 14 });
const crownSize = param("stormwing.crown", 1.35, { min: 0.3, max: 2.2 });

// ---- the attack and the hover --------------------------------------------------------------------------------------

const e = strike(strikeIn, { anticipation: 0.55, follow: 0.25 });
/** 1 at idle, low through the attack (the beat gives way to the strike pose). */
const idle = sub(1, mul(smoothstep(0.02, 0.18, strikeIn), mul(sub(1, smoothstep(0.85, 1, strikeIn)), 0.85)));
// The wind-up cocks the wings down less than the clap raises them, so the tips stay out of the sea.
const raise = add(mul(max(e, 0), S.clapLift), mul(min(e, 0), S.cock));
const wingAngle = (r: number) => add(mul(beat(r, { rate: S.beatRate, amplitude: S.beatAmp, lag: S.beatLag, bias: S.beatBias, down: 0.4 }), idle), raise);
const sweep = mul(e, S.clapSweep);
// The body rises as the wings come down (the stroke lifts it), rears in the wind-up and lunges at the hit.
const pitch = mul(e, -S.rear);
const lift0 = mul(sub(wingAngle(0), S.beatBias), -S.bob / S.beatAmp);
const root: Frame = {
  o: vec3(mul(e, S.lunge), add(S.hover, lift0), 0),
  x: vec3(cos(pitch), sin(pitch), 0), y: vec3(mul(sin(pitch), -1), cos(pitch), 0), z: lift<"vec3">([0, 0, 1]),
};
const onRoot = rigid(root);

// ---- wings: bones by forward kinematics with lagging joints, a fan between the fingers and the flank ---------------

const X: P3 = lift<"vec3">([-1, 0, 0]), Y: P3 = lift<"vec3">([0, 1, 0]);
const out = (x: number) => { const l = Math.hypot(x, 1); return lift<"vec3">([x / l, 0, 1 / l]); };
/** A rest direction raised by the beat at r (about the body's x) and swept by the attack (about y). */
const turn = (d: P3, r: number) => rotateAbout(rotateAbout(d, X, wingAngle(r)), Y, sweep);
const sh = lift<"vec3">(S.shoulder);
const elbow = add(sh, mul(turn(out(0.3), 0), mul(span, S.upperArm)));
const wrist = add(elbow, mul(turn(out(0.1), 0.3), mul(span, S.forearm)));
const fingers = S.fingers.map(([dx, len]) => {
  const mid = add(wrist, mul(turn(out(dx), 0.6), mul(span, len / 2)));
  return [mid, add(mid, mul(turn(out(dx * 1.15), 1), mul(span, len / 2)))] as const;
});
const knotsOf = (ls: readonly number[]) => { const t = ls.reduce((a, b) => a + b); let c = 0; return [0, ...ls.map((l) => (c += l) / t)].map((k) => lift<"f32">(k)); };
const rays = [
  ...fingers.map(([mid, tip], k) => (m: Expr<"f32"> | number) => polyline(lift<"f32">(m), [sh, elbow, wrist, mid, tip], knotsOf([S.upperArm, S.forearm, S.fingers[k][1] / 2, S.fingers[k][1] / 2]))),
  (m: Expr<"f32"> | number) => mix(sh, lift<"vec3">(S.hip), m),
];
const membrane = fan({ rays, sag: S.sag, scallop: S.scallop, slack: 2.5 });
// Dark membrane, a pale band along the scalloped edge, and electric veins running out between the rays.
const wingPaint = (u: F, v: F) => {
  const vein = mul(smoothstep(0.06, 0.0, abs(sub(fract(mul(u, 6)), 0.5))), smoothstep(0.25, 0.55, v));
  return mix(mix(vec3(...S.membrane), vec3(...S.vein), mul(vein, 0.6)), vec3(...S.edge), smoothstep(0.82, 0.97, v));
};
const wingGrid = { u: spacing.even(3 * 14), v: spacing.even(24) };
const wingR = framed(membrane, { frame: root, scale: lift<"f32">(1) });
const wingL = framed(mirror.surface(membrane), { frame: root, scale: lift<"f32">(1) });

/** A bone along a polyline, thinner at its joint. */
const bone = (name: string, pts: readonly P3[], ls: readonly number[], girth: number) => {
  const k = knotsOf(ls);
  return strand({
    name, spine: (m) => polyline(m, pts, k), stations: 16, tips: ["round", { point: 0.25 }],
    girth: (m) => mul(girth, sub(1, add(mul(m, 0.55), mul(smoothstep(0.08, 0, abs(sub(m, k[1]))), 0.3)))),
    paint: S.bone, detail: { along: 40, around: 10 },
  });
};
const bonesR = [bone("armR", [sh, elbow, wrist], [S.upperArm, S.forearm], 0.24), ...fingers.map(([mid, tip], k) => bone(`finger${k}R`, [wrist, mid, tip], [1, 1], 0.13))];
const bones = bonesR.flatMap((b) => [place(b, onRoot), place(mirror(b, b.name.replace(/R$/, "L")), onRoot)]);

// ---- body and tail --------------------------------------------------------------------------------------------------

const TAIL = 5;
const spinePoints = [vec3(3.3, 0.35, 0), vec3(1.8, 0.15, 0), vec3(0, 0, 0), vec3(-1.9, 0, 0),
  ...Array.from({ length: TAIL }, (_, i) => {
    const p = (i + 1) / TAIL, clock = retarded(time, p, 1.2);
    const sway = mul(sin(mul(sub(mul(p, 1.6), mul(clock, S.tailRate)), Math.PI * 2)), S.tailSway * p ** 1.2);
    // The tail whips up in the wind-up and down at the hit.
    return vec3(add(-1.9, mul(tailLength, -p)), add(-0.35 * p, mul(e, -0.9 * p * p)), sway);
  })];
const girth = keys([[0, 0.4], [0.14, 0.8], [0.3, 0.95], [0.45, 0.55], [0.62, 0.26], [1, 0.12]]);
const breath = breathe({ rate: 0.18, depth: 0.05 });
const body = place(strand({
  name: "stormwing", spine: (m) => through(m, spinePoints), stations: 36,
  girth: (m) => mul(mul(girth(m).x, S.girth), breath), section: { aspect: 0.8, squareness: 2.2 }, tips: [{ round: 0.04 }, { point: 0.06 }],
  // An electric stripe down the back leads the eye to the head.
  paint: (m, v) => mix(palette.countershade(v, { back: S.back, belly: S.belly }), vec3(...S.spark), mul(smoothstep(0.035, 0.015, abs(sub(v, 0.25))), smoothstep(0.98, 0.6, m))),
  detail: { along: 120, around: 24 }, level: 1,
}), onRoot);

// The fluke: a diamond of four rays on the tail's own frame near its tip, so it swings with the tail.
const tailEnd = body.frame(vec3(0.93, 0.25, 0));
const flukeRays = [[-0.95, 1.5], [-0.35, 2.4], [0.35, 2.4], [0.95, 1.5]].map(([a, l]) => (r: Expr<"f32"> | number) =>
  add(tailEnd.o, mul(add(mul(tailEnd.x, Math.cos(a)), mul(tailEnd.z, Math.sin(a))), mul(lift<"f32">(r), l))));
const fluke = draw.surface("fluke", fan({ rays: flukeRays, sag: 0.05, scallop: 0.3 }), { paint: (u, v) => mix(vec3(...S.membrane), vec3(...S.gold), mul(smoothstep(0.6, 1, v), 0.7)), grid: { u: spacing.even(36), v: spacing.even(8) }, sides: "two", outline: "border" });

// ---- head: a wedge that scans, a jaw that drops for the roar, swept horns, a gold crown, sparking eyes -------------

const yaw = mul(sin(mul(time, 0.37)), mul(idle, 0.3));
const nod = add(mul(sin(mul(time, 0.53)), 0.06), mul(e, 0.25));
const neck = lift<"vec3">([3.1, 0.35, 0]);
const headPose = (p: In3) => add(neck, rotateAbout(rotateAbout(sub(lift<"vec3">(p), neck), Y, yaw), lift<"vec3">([0, 0, -1]), nod));
type In3 = readonly [number, number, number] | P3;
const skull = keys([[0, 0.55], [0.3, 0.72], [0.72, 0.44], [1, 0.18]]);
const head = place(strand({
  name: "swHead", spine: (m) => through(m, ([[2.9, 0.35, 0], [3.9, 0.5, 0], [4.9, 0.36, 0], [6.0, 0.08, 0]] as const).map((p) => headPose(p))), stations: 10,
  girth: (m) => skull(m).x, section: { aspect: 0.7, squareness: 2.6 }, tips: [{ round: 0.2 }, { round: 0.08 }],
  // A pale bony beak forward of the eyes, so the face reads as the bright end of a dark body; the palate shows when the jaw drops.
  paint: (m, v) => mix(mix(palette.countershade(v, { back: S.back, belly: S.belly }), vec3(...S.bone), smoothstep(0.6, 0.66, m)),
    vec3(...S.mouth), mul(smoothstep(0.8, 0.9, mul(sin(mul(v, Math.PI * 2)), -1)), smoothstep(0.35, 0.45, m))),
  detail: { along: 40, around: 24 },
}), onRoot);
const gape = add(0.08, mul(smoothstep(0.3, 0.55, strikeIn), mul(sub(1, smoothstep(0.7, 0.95, strikeIn)), 0.55)));
const hinge = lift<"vec3">([3.7, 0.12, 0]);
const jawAt = (d: number) => headPose(add(hinge, mul(vec3(cos(gape), mul(sin(gape), -1), 0), d)));
const jaw = place(strand({
  name: "swJaw", spine: (m) => through(m, [jawAt(-0.2), jawAt(0.9), jawAt(1.9)]), stations: 6, girth: (m) => mix(0.36, 0.12, m),
  section: { aspect: 0.4 }, tips: [{ round: 0.2 }, { round: 0.15 }],
  paint: (_m, v) => mix(vec3(...S.belly), vec3(...S.mouth), smoothstep(0.75, 0.85, sin(mul(v, Math.PI * 2)))), detail: { along: 20, around: 16 },
}), onRoot);
const hornR = spiralTube({ name: "swHornR", length: S.hornLength, curl: S.hornCurl, taper: 0.15, girth: 0.17, out: [-0.2, 1, 0.3], toward: [-1, 0, 0.1], paint: S.bone });
const horns = [place(hornR, on(head, [0.3, 0.25 - 0.09, 0.9])), place(mirror(hornR, "swHornL"), on(head, [0.3, 0.25 + 0.09, 0.9]))];
const eyeR = strand({
  name: "swEyeR", spine: (m) => through(m, [[0, -0.2, 0], [0, 0.2, 0]]), stations: 4, girth: 0.2, tips: [{ round: 0.5 }, { round: 0.5 }],
  // A dark socket ring round a white-hot iris: the eyes spark like the stripe.
  paint: (m) => mix(mix(vec3(0.05, 0.04, 0.12), vec3(...S.spark), smoothstep(0.55, 0.62, m)), vec3(1, 1, 1), smoothstep(0.82, 0.9, m)), detail: { along: 14, around: 14 },
});
const eyes = [place(eyeR, on(head, [0.55, 0.25 - 0.14, 0.85])), place(mirror(eyeR, "swEyeL"), on(head, [0.55, 0.25 + 0.14, 0.85]))];
// The crown: five gold rays fanned back from the skull, lying over the neck: the brightest shape, seen from above.
const crownRoot = head.frame(vec3(0.3, 0.25, 0.7));
const crown = draw.surface("crown", fan({
  rays: [[-0.85, 0.5, 1], [-1, 0.6, 0.45], [-1, 0.75, 0], [-1, 0.6, -0.45], [-0.85, 0.5, -1]].map((d, k) => (r: Expr<"f32"> | number) =>
    add(crownRoot.o, mul(add(add(mul(crownRoot.x, d[0]), mul(crownRoot.y, d[1])), mul(crownRoot.z, d[2])), mul(mul(lift<"f32">(r), crownSize), S.crown * (k === 2 ? 1.15 : 1))))),
  sag: -0.08, scallop: 0.35,
}), { paint: (u, v) => mix(mul(vec3(...S.gold), 0.75), vec3(...S.gold), v), grid: { u: spacing.even(48), v: spacing.even(10) }, sides: "two", outline: "border" });

// ---- lightning from the clap: a stroke whose width flashes only around the hit ---------------------------------------

const flash = mul(smoothstep(0.47, 0.51, strikeIn), sub(1, smoothstep(0.56, 0.7, strikeIn)));
// Thrown forward along the sea toward the target, so the bolt has length seen from above, not only from the side.
const top = add(root.o, vec3(4, 2.5, 0)), bottom = vec3(add(mul(e, S.lunge), 15), -0.2, 1.5);
const bolt = draw.curve("bolt", (u) => add(mix(top, bottom, u), vec3(0, mul(sin(mul(u, 31)), 0.5), mul(sin(add(mul(u, 47), 1)), 0.9))), {
  width: (u) => mul(flash, mul(sub(1.2, u), 0.45)), paint: () => vec3(1, 1, 0.8), segments: 48,
});

const drawWing = (name: string, s: typeof wingR) => draw.surface(name, s, { paint: wingPaint, grid: wingGrid, sides: "two", outline: "border" });

export default scene({
  ground: sea({ swell: [{ direction: [1, 0.3], length: 14, height: 0.35, speed: 1.1 }, { direction: [-0.3, 1], length: 6.5, height: 0.12, speed: 0.8, phase: 1.3 }] }),
  things: [body, head, jaw, ...horns, ...eyes, crown, drawWing("wingR", wingR), drawWing("wingL", wingL), ...bones, fluke, bolt],
  style: toon({ bands: 3, outline: 0.04 }),
  sun: [-0.45, 0.75, 0.5],
  cameras: {
    front: { kind: "perspective", eye: [26, 7, 4], target: [0, 4.5, 0], fovY: 0.6 },
    side: { kind: "perspective", eye: [-1, 6, 34], target: [-1, 4, 0], fovY: 0.6 },
    top: { kind: "orthographic", eye: [-1, 40, 0.001], target: [-1, 0, 0], height: 24 },
    three: { kind: "perspective", eye: [16, 13, 20], target: [0, 4, 0], fovY: 0.6 },
    game: { kind: "perspective", eye: [16, 34, 22], target: [0, 2, 0], fovY: 0.6 },
    face: { kind: "perspective", eye: [13, 9, 5.5], target: [4.6, 5.4, 0], fovY: 0.5 },
  },
});
