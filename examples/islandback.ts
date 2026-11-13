// Islandback: a huge crab walking sideways through the shallows with a spiral shell on its back like an island: a
// cream-and-moss spiral seen from above, ringed by eight red legs and led by one enormous claw (the face is the claw
// and the stalked eyes above it). Its feet are planted on the sea floor by a gait (an alternating tetrapod with a
// small wave down each side) and its legs reach them by closed-form inverse kinematics; the eyes look about on their
// own. The `slam` input (0 to 1) raises the big claw high and drives it down into the water ahead.
// Faces +x, walks toward its right (+z), y up; the sea floor is at y = -1.

import {
  abs, add, course, cos, draw, framed, gait, spiralTube, input, keys, lift, chain, lookAt, max, min, mix, mul, palette, param, place, ridgePhase,
  rotateAbout, scene, sea, coil, sin, smoothstep, spacing, strand, strike, sub, through, time, toon, vec3, whorl, unit, type F, type Frame, type P3,
} from "../src/index.ts";
import { rotate } from "../src/map/chart.ts";
import { rigid } from "../src/geom/rig.ts";

const S = {
  floor: -1, ride: 1.5, width: 3.2, length: 2.4, height: 1.05,
  stride: 2.1, period: 2.4, duty: 0.62, lift: 1.4, turning: 40,
  legRoots: [1.35, 0.5, -0.4, -1.3], legFeet: [[2.8, 6.6], [1.1, 7.4], [-0.9, 7.3], [-2.7, 6.4]] as const, legLengths: [3.0, 2.9, 1.2] as const,
  turns: 4.5, growth: 1.6, aperture: 1.75, umbilicus: 0.12, spire: 2.4, ridgesPerTurn: 7, sink: 0.9,
  bigClaw: 1.45, smallClaw: 0.65, slamReach: 2.6, slamRaise: 4.2,
  stalk: 2.6, eye: 0.48,
  // colour: complementary red-orange body on blue-green water; a high-value cream shell with dark bands and moss
  shellBody: [0.98, 0.9, 0.72], band: [0.45, 0.22, 0.14], moss: [0.36, 0.62, 0.22],
  back: [0.92, 0.3, 0.16], belly: [1.0, 0.85, 0.66], tip: [0.16, 0.07, 0.07], iris: [1.0, 0.92, 0.2], bone: [1.0, 0.94, 0.8],
} as const;

const slamIn = input("slam", "f32", [0]);
const legReach = param("islandback.legs", 1, { min: 0.7, max: 1.4 });
const shellSize = param("islandback.shell", 1, { min: 0.5, max: 1.5 });
const clawSize = param("islandback.claw", 1, { min: 0.5, max: 1.6 });

// ---- the walk: feet on the floor, the body carried over them ---------------------------------------------------------

/** Feet in order: left 0..3 then right 0..3 (front to back). Alternating tetrapods, each side a small wave toward the front. */
const sides = [-1, 1] as const;
const feetHome = sides.flatMap((s) => S.legFeet.map(([x, z]) => [x, S.floor, mul(legReach, s * z)] as const));
const phase = sides.flatMap((s) => S.legFeet.map((_, i) => ((i % 2 === 0) === (s < 0) ? 0 : 0.5) + 0.07 * i));
const walk = gait({
  feet: feetHome.map(([x, y, z]) => vec3(x, y, z)), phase, course: course.arc([0, 0, 0], -Math.PI / 2, S.turning, Math.PI / 2),
  stride: S.stride, pace: { kind: "time", period: S.period }, duty: S.duty, lift: S.lift,
});
// The body dips twice a cycle, as each tetrapod takes the weight, and rolls a little toward the leading side.
const bob = mul(cos(mul(time, (4 * Math.PI) / S.period)), 0.09);
const roll = mul(sin(mul(time, (2 * Math.PI) / S.period)), 0.04);
const g = walk.body;
const body: Frame = { o: add(g.o, mul(g.y, add(S.ride, bob))), x: g.x, y: rotateAbout(g.y, g.x, roll), z: rotateAbout(g.z, g.x, roll) };
const local = (p: readonly [number, number, number] | P3): P3 => add(body.o, rotate(body, lift<"vec3">(p)));
const at = (x: F | number, y: F | number, z: F | number): P3 => local(vec3(x, y, z));

// ---- carapace ---------------------------------------------------------------------------------------------------------

// A short fat sweep with round tips half its length each is an ellipsoid: 2.4 long, 3.2 wide, 1.05 high.
const carapace = place(strand({
  name: "islandback", spine: (m) => through(m, [[-S.length, 0, 0], [0, 0.1, 0], [S.length, -0.05, 0]]), stations: 8,
  girth: S.width, section: { aspect: S.height / S.width, squareness: 2.4 }, tips: [{ round: 0.5 }, { round: 0.5 }],
  // A dark rim line where the red top meets the pale underside.
  paint: (_m, v) => mix(palette.countershade(v, { back: S.back, belly: S.belly }), vec3(...S.tip), smoothstep(0.06, 0.02, abs(sub(sin(mul(v, Math.PI * 2)), -0.2)))),
  detail: { along: 40, around: 40 }, up: [0, 1, 0],
}), rigid(body));

// ---- legs: three segments by inverse kinematics, the dactyl held pointing down onto the foot ------------------------

const segs = keys([[0, 1], [0.4, 0.85], [0.8, 0.5], [1, 0.18]]);
const legs = sides.flatMap((s, si) => S.legRoots.map((x, i) => {
  const k = si * 4 + i;
  const root = local([x, 0.1, s * S.width * 0.78]);
  const lengths = S.legLengths.map((l) => mul(legReach, l)) as unknown as readonly [F, F, F];
  const leg = chain({ root, target: walk.foot(k), lengths, bend: add(body.y, mul(body.z, s * 0.45)), foot: mul(body.y, -1) });
  // Thinner at each joint (the knots), tapering to a dark point.
  const pinch = (m: F) => leg.knots.slice(1, 3).reduce((p: F, kn) => sub(p, mul(smoothstep(0.05, 0, abs(sub(m, kn))), 0.3)), lift<"f32">(1));
  return strand({
    name: `leg${s < 0 ? "L" : "R"}${i}`, spine: leg.spine, stations: 24, girth: (m) => mul(mul(segs(m).x, 0.36), pinch(m)), tips: ["round", { point: 0.1 }],
    section: { aspect: 0.8 }, up: body.y,
    // Dark rings at the joints and a dark claw tip: the segments read even where the leg is thin.
    paint: (m, v) => mix(palette.countershade(v, { back: S.back, belly: S.belly }), vec3(...S.tip), max(smoothstep(0.8, 0.86, m), sub(1, smoothstep(0.012, 0.03, leg.knots.slice(1, 3).reduce((d: F, kn) => min(d, abs(sub(m, kn))), lift<"f32">(1)))))),
    detail: { along: 64, around: 12 },
  });
}));

// ---- claws: an arm by IK to a wrist target the slam envelope moves, a swollen palm, a fixed finger and a hinged one --

const e = strike(slamIn, { anticipation: 1, follow: 0.15, timing: [0.4, 0.55, 0.62, 0.8] });
const raised = smoothstep(0, 1, max(mul(e, -1), 0)), driven = max(e, 0);
function claw(name: string, side: 1 | -1, size: number, slams: boolean) {
  const z = side * S.width * 0.5;
  const rest = vec3(S.length + 1.9 * size, 0.7, z + side * 1.2 * size);
  const target = slams ? add(rest, add(mul(vec3(-1.6, S.slamRaise, side * 0.4), raised), mul(vec3(S.slamReach, -2.4, -side * 0.6), driven))) : rest;
  const arm = chain({ root: local([S.length * 0.75, 0.2, z]), target: local(target), lengths: [mul(clawSize, 1.9 * size + 0.4), mul(clawSize, 1.7 * size + 0.4)], bend: add(mul(body.z, side), mul(body.y, -0.4)) });
  const [, elbow, wrist] = arm.joints;
  // At rest the palm folds in across the front of the face, as a crab holds its claws; in the slam it drives straight on.
  const along = unit(add(unit(sub(wrist, elbow)), mul(body.z, mul(sub(1, driven), -side * (slams ? 0.9 : 1.2)))));
  const len = mul(clawSize, 2.5 * size), fat = mul(clawSize, 0.95 * size);
  const armStrand = strand({ name: `${name}Arm`, spine: arm.spine, stations: 16, girth: (m) => mul(fat, sub(0.45, mul(m, 0.12))), tips: ["round", "round"], up: body.y,
    paint: (_m, v) => palette.countershade(v, { back: S.back, belly: S.belly }), detail: { along: 40, around: 14 } });
  const palm = strand({
    name: `${name}Palm`, spine: (m) => add(wrist, mul(along, mul(len, m))), stations: 6, girth: (m) => mul(fat, add(0.5, mul(sin(mul(m, Math.PI)), 0.28))),
    section: { aspect: 0.6 }, tips: [{ round: 0.3 }, { round: 0.3 }], up: body.y,
    paint: (m, v) => mix(palette.countershade(v, { back: S.back, belly: S.belly }), vec3(1, 0.62, 0.3), mul(smoothstep(0.4, 0.9, m), 0.4)), detail: { along: 24, around: 20 },
  });
  // The pincer opens sideways (in the palm's flat plane, so it reads as a V from above): wide in the wind-up, shut on the hit.
  const gape = slams ? add(0.25, sub(mul(raised, 0.6), mul(driven, 0.25))) : add(0.2, mul(sin(mul(time, 0.9)), 0.12));
  const finger = (fname: string, v: number, opens: number) => {
    const f = palm.frame(vec3(0.9, v, 0.35));
    const a = mul(gape, opens);
    const hinged: Frame = { o: f.o, x: rotateAbout(f.x, f.z, a), y: rotateAbout(f.y, f.z, a), z: f.z };
    return place(spiralTube({ name: fname, length: mul(len, 0.9), curl: 0.75, taper: 0.18, girth: mul(fat, 0.42), out: [1, -0.15, 0], toward: [0, -1, 0], paint: (m) => mix(vec3(...S.back), vec3(...S.bone), smoothstep(0.55, 0.75, m)) }), rigid(hinged));
  };
  return [armStrand, palm, finger(`${name}Fixed`, side > 0 ? 0.5 : 0, 0.35), finger(`${name}Dactyl`, side > 0 ? 0 : 0.5, 1)];
}
const claws = [...claw("crusher", 1, S.bigClaw, true), ...claw("cutter", -1, S.smallClaw, false)];

// ---- eyes on stalks, each looking about on its own -------------------------------------------------------------------

const eyes = sides.flatMap((s) => {
  const base = local([S.length * 0.95, S.height * 0.4, s * 0.8]);
  const wander = at(12, 0, add(mul(sin(add(mul(time, 0.41), s)), 9), mul(sin(mul(time, 1.3 + 0.2 * s)), 2)));
  const look = lookAt({ from: { o: base, x: body.x, y: body.y, z: body.z }, target: wander, yaw: 1.1, pitch: 0.5 });
  // The stalks lean forward past the shell's rim, so the eyes stand clear of it seen from above.
  const tip = add(base, add(add(mul(body.y, S.stalk), mul(body.x, S.stalk * 0.35)), mul(look.dir, S.stalk * 0.4)));
  const tag = s < 0 ? "L" : "R";
  const stalk = strand({ name: `stalk${tag}`, spine: (m) => through(m, [base, add(base, mul(body.y, S.stalk * 0.6)), tip]), stations: 6, girth: 0.2, tips: ["open", "round"], paint: S.back, detail: { along: 16, around: 10 } });
  // A ball whose spine points where it looks: the pupil is the end facing the target.
  const ball = strand({ name: `eye${tag}`, spine: (m) => add(tip, mul(look.dir, mul(sub(m, 0.5), S.eye * 2))), stations: 4, girth: S.eye, tips: [{ round: 0.5 }, { round: 0.5 }], up: body.y,
    paint: (m) => mix(mix(vec3(0.1, 0.05, 0.05), vec3(...S.iris), smoothstep(0.35, 0.45, m)), vec3(0.03, 0.02, 0.02), smoothstep(0.9, 0.93, m)), detail: { along: 14, around: 14 } });
  return [stalk, ball];
});

// ---- the shell: a Raup spiral with ridges folded into its section, moss on the upper side of every whorl --------------

const turns = S.turns;
const spiral = coil({ turns, growth: S.growth, aperture: S.aperture, umbilicus: S.umbilicus, spire: S.spire, section: { aspect: 1.1, ridges: { perTurn: S.ridgesPerTurn, height: 0.035 } } });
// Apex up, its last whorl sunk onto the carapace. The aperture is at the shell's -x facing its -z (where the coil
// grows at u = 1 for 4.5 turns), so a quarter turn back puts it on the crab's left, opening backward, away from view.
const yawShell = -Math.PI / 2;
const c = (S.aperture * (1 + S.umbilicus)) / (1 - S.umbilicus);
const shellHeight = S.spire * c + S.aperture * 1.1;
const shellFrame: Frame = { o: local([-1.1, S.height + shellHeight - S.sink, 0]), x: rotateAbout(body.x, body.y, yawShell), y: body.y, z: rotateAbout(body.z, body.y, yawShell) };
const shellPaint = (u: F, v: F) => {
  // Round the section: (cos, sin) of its angle, sin up. The suture (where a whorl meets the one above) is upper-inner.
  const across = cos(mul(v, Math.PI * 2)), up = sin(mul(v, -Math.PI * 2));
  const suture = smoothstep(0.9, 0.97, add(mul(across, -0.6), mul(up, 0.8)));
  const ridge = smoothstep(0.84, 0.96, ridgePhase(u, turns, S.ridgesPerTurn));
  const banded = mix(mix(vec3(...S.shellBody), vec3(...S.band), mul(ridge, 0.5)), vec3(...S.band), suture);
  // Moss settles on the top of each whorl, thicker toward the old apex: from above, a green and cream spiral.
  return mix(banded, vec3(...S.moss), mul(smoothstep(0.3, 0.55, up), smoothstep(turns - 0.4, turns - 1.4, whorl(u, turns))));
};
const shellDrawn = draw.surface("shell", framed(spiral, { frame: shellFrame, scale: shellSize }), { paint: shellPaint, grid: { u: spacing.even(220), v: spacing.even(32) }, sides: "one", outline: "hull" });

export default scene({
  ground: sea({ swell: [{ direction: [1, 0.3], length: 12, height: 0.18, speed: 0.9 }, { direction: [-0.3, 1], length: 5.5, height: 0.06, speed: 0.7, phase: 1.3 }] }),
  things: [carapace, shellDrawn, ...legs, ...claws, ...eyes],
  style: toon({ bands: 3, outline: 0.04 }),
  sun: [-0.45, 0.75, 0.5],
  cameras: {
    front: { kind: "perspective", eye: [30, 9, -6], target: [2, 2, 1], fovY: 0.6 },
    side: { kind: "perspective", eye: [2, 6, 32], target: [0, 2, 0], fovY: 0.6 },
    top: { kind: "orthographic", eye: [0, 40, 0.001], target: [0, 0, 1], height: 26 },
    three: { kind: "perspective", eye: [20, 15, 22], target: [0, 2, 1], fovY: 0.6 },
    game: { kind: "perspective", eye: [16, 34, 22], target: [0, 1, 1], fovY: 0.6 },
    face: { kind: "perspective", eye: [13, 7.5, 4.5], target: [2.5, 2.8, 0.6], fovY: 0.55 },
  },
});
