// A paper lantern on a fishing pole in the wind, and a moth that cannot leave it alone.
// Shows: `bent` (the pole bows in the gusts, its upper part crooking a beat late), `pendulum` (the lantern swings on its
// cord, driven by the pole's tip: nobody keys the swing), `dart` and `chosen` (the moth jumps between places round the
// lantern at uneven intervals) with `tremor` laid over it. Ground: a calm sea; the pole is planted in it (`FLOOR`).
//
// Theory, before running. The pendulum is linear, so its answer to the tip's motion is the sum of its answers to each
// gust; the tip moves k units per radian of bow, and k comes from `bentTip` in plain numbers. The cord is 0.9 long, so
// the lantern swings at sqrt(9.8 / 0.9) / 2 pi = 0.53 Hz (1.9 s); the gusts are 2.7 s and 1.1 s, off resonance on both
// sides: it follows the slow gust nearly in step and swings against the fast one (172 degrees late). The tip moves
// about 3.3 units per radian of bow (the bow's weight averages 2/3 along the pole), so the slow gust (0.06) swings the
// lantern 0.28 rad and the fast one (0.025) 0.18: a swing of up to about 0.45 rad, 26 degrees.
// Predicted fits: all three. Predicted friction: `pendulum` swings in one plane only (its `answer` is one angle), and
// its drive is a sine of a pivot along a line; the bent pole's tip moves on an arc, so the drive is an approximation.
// The pole is planted leaning (`lean`), so the lantern hangs clear of it: upright, the first render swung the lantern
// back through the pole (0.39 of swing against 0.54 of pole slope under the tip); leaning 0.45 the pole is ~1.0 away.
// The moth travels by angle, not straight, between its places; the check below would fail a straight line through the
// lantern. Predicted least distance: 0.6 (nearest place) - 0.22 (lantern) - ~0.08 (moth, tremor) = ~0.3.
//
// Scored. `bent`, `pendulum` and `dart` fit, used as they are; `bentTip` gave the drive's gain in plain numbers. The moth
// kept 0.356 from the lantern (predicted ~0.3). The lantern's clearance from the pole missed: predicted ~0.39, measured
// 0.150 (t = 21.0), not explained. The one-plane limit of `pendulum` did not bite here, because the wind is along x;
// a wind that turns would need two pendulums, one per plane (linear, so that is exact for small swings).
import {
  add, bent, bentTip, chosen, cos, dart, lift, mix, mul, pendulum, scene, plane, sin, smoothstep, strand, sub, sway, time, toon, tremor, vec3, type F,
} from "../../src/index.ts";
import { staysClear } from "../../src/check.ts";

const FLOOR = plane; // the bank the pole is planted in
const POLE = { root: [0, 0, 0] as const, along: [0, 1, 0] as const, a: [1, 0, 0] as const, b: [0, 0, 1] as const, length: 5, lean: [0.45, 0] as const };
const CORD = 0.9, LAG = 0.15, LOOP = 29.7; // 11 slow gusts and 27 fast ones

// ---- the wind: two gusts; the pole's crook reads the same wind LAG seconds late (a whip) -------------------------------
const GUSTS = [{ amp: 0.06, period: 2.7, phase: 0 }, { amp: 0.025, period: 1.1, phase: 1 }] as const;
const wind = (t: F): F => GUSTS.reduce<F>((w, g) => add(w, mul(sin(add(mul(t, (2 * Math.PI) / g.period), g.phase)), g.amp)), lift<"f32">(0.2));
const pole = bent({ ...POLE, bow: [wind(time), 0], crook: [mul(wind(sub(time, LAG)), 0.7), 0], sharp: 2.5 });

// ---- the lantern: a pendulum hung from the tip, driven by the tip's sway along x ------------------------------------------
// Tip travel per radian of bow and of crook, from the same law in plain numbers (small angles: linear).
const per = (bend: "bow" | "crook") => (bentTip({ ...POLE, [bend]: [0.01, 0] }).tip[0] - bentTip(POLE).tip[0]) / 0.01;
const swing = pendulum({ length: CORD, gravity: 9.8, damping: 0.08 });
const psi = swing.answer(time, GUSTS.flatMap((g) => [
  sway(g.amp * per("bow"), g.period, g.phase),
  sway(g.amp * 0.7 * per("crook"), g.period, g.phase - (2 * Math.PI * LAG) / g.period),
]));
const lantern = add(pole.tip, vec3(mul(sin(psi), CORD), mul(cos(psi), -CORD), 0));

// ---- the moth: a place round the lantern for each hold, chosen by hashing the hold's number ----------------------------
const flit = dart(time, { every: 0.8, snap: 0.2, period: LOOP, seed: 4 });
const angle = (k: F) => mul(chosen(k, 1), Math.PI * 2), height = (k: F) => mul(sub(chosen(k, 2), 0.5), 0.7), reach = (k: F) => add(0.6, mul(chosen(k, 3), 0.35));
const [th, y, r] = [angle, height, reach].map((f) => mix(f(flit.before), f(flit.now), flit.arrive)) as [F, F, F];
const moth = add(add(lantern, vec3(mul(cos(th), r), y, mul(sin(th), r))), mul(vec3(tremor(time, 9, 1), tremor(time, 7, 2), tremor(time, 8, 3)), 0.03));
const flap = mul(sin(mul(time, Math.PI * 2 * 7)), 0.9);

// ---- drawn --------------------------------------------------------------------------------------------------------------
const rod = strand({ name: "pole", spine: pole.spine, stations: 24, girth: (m) => mix(0.08, 0.025, m), tips: ["open", "round"], paint: [0.35, 0.22, 0.12], detail: { along: 48, around: 10 } });
const cord = strand({ name: "cord", spine: (m) => mix(pole.tip, lantern, m), stations: 4, girth: 0.012, paint: [0.1, 0.08, 0.06], detail: { along: 4, around: 6 } });
const paper = strand({
  name: "paper", spine: (m) => add(lantern, vec3(0, mul(sub(m, 1), 0.55), 0)), stations: 8, girth: (m) => mul(sin(mul(m, Math.PI)), 0.22), tips: ["round", "round"],
  paint: (m) => mix(vec3(1.0, 0.86, 0.45), vec3(0.85, 0.2, 0.1), smoothstep(0.86, 0.9, sin(mul(m, Math.PI * 9)))), detail: { along: 30, around: 16 },
});
const wings = ([-1, 1] as const).map((s) => strand({
  name: s < 0 ? "wingL" : "wingR", spine: (m) => add(moth, mul(vec3(mul(cos(flap), s * 0.12), mul(sin(flap), 0.12), 0.02), m)), stations: 4,
  girth: (m) => mul(sin(mul(m, Math.PI)), 0.07), section: { aspect: 0.15 }, paint: [0.82, 0.76, 0.66], detail: { along: 8, around: 8 },
}));
const mothBody = strand({ name: "moth", spine: (m) => add(moth, vec3(0, 0, mul(sub(m, 0.5), 0.12))), stations: 4, girth: 0.025, paint: [0.4, 0.33, 0.25], detail: { along: 6, around: 8 } });

export default scene({
  ground: FLOOR, things: [rod, cord, paper, mothBody, ...wings],
  style: toon({ bands: 3, outline: 0.03 }), sun: [-0.3, 0.7, 0.6], period: LOOP,
  cameras: { game: { kind: "perspective", eye: [5, 4.5, 10], target: [2.2, 2.8, 0], fovY: 0.62 } },
});

export const checks = [
  staysClear(mothBody, { kind: "body", body: paper }, { until: LOOP, rate: 30, label: "the moth never flies through the lantern" }),
  staysClear(paper, { kind: "body", body: rod }, { until: LOOP, rate: 30, label: "the lantern never swings into the pole" }),
];
