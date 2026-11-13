// One step down from each component: every thing here is something the component's own call cannot make, built from
// the mechanism it exports. Each is a few lines; the comment above it says what the closed form could not do.
//
//   back row:  a keeled coil with a flared lip (coilAt) | a smoke ring (billows) | a ribbed pod (loft) | a lantern on a cart (pendulum, ropes)
//   front row: a saw-toothed fin (sheetOnEdges)         | a curling frill (fan between bent rays)   | a hooked arm (chain + polyline)
import {
  add, bent, billows, chain, clamp, coilAt, COIL_TOPOLOGY, cos, draw, fan, fract, jolt, lift, loft, max, medium, mix, mul, pendulum,
  polyline, pow, ropes, sea, scene, sheet, sheetOnEdges, sin, smoothstep, spacing, strand, sub, surface, TAU, time, toon, vec3,
  type F, type In,
} from "../src/index.ts";

const two = { sides: "two", outline: "border" } as const;

// ---- coil: a section of my own (a sharp keel on the outer side, flattened) that flares into a lip over the last
// tenth of a whorl. `coil` alone takes an ellipse; `coilAt` places any section point at any whorl position.
const turret = coilAt({ turns: 5.5, growth: 1.5, aperture: 0.6, umbilicus: 0.05, spire: 2.2 });
const keeled = (u: F, phi: F): readonly [F, F] => {
  const lip = add(1, mul(smoothstep(0.9, 1, u), 0.5)), keel = mul(pow(max(cos(phi), 0), 24), 0.45);
  return [mul(mul(add(cos(phi), keel), 0.6), lip), mul(mul(sin(phi), 0.42), lip)];
};
const coiled = draw.surface("keeledCoil", surface((u, v) => { const [x, y] = keeled(u, mul(v, -TAU)); return add(turret(u, x, y), vec3(-8.5, 2.8, -4)); }, COIL_TOPOLOGY), {
  paint: (u, v) => mix(vec3(0.85, 0.72, 0.55), vec3(0.55, 0.3, 0.22), smoothstep(0.4, 0.6, fract(mul(v, 4)))), grid: { u: spacing.even(240), v: spacing.even(48) }, ...two,
});

// ---- cloud: a smoke ring. `cloud` fills a solid of revolution about a vertical axis, which has no hole; `billows`
// boils and drifts puffs placed anywhere, here round a circle in a vertical plane.
const ring = billows(Array.from({ length: 36 }, (_, i) => {
  const a = (i / 36) * TAU;
  return { at: [-3 + 1.3 * Math.cos(a), 2.4 + 1.3 * Math.sin(a), -4] as const, radii: [0.34, 0.34, 0.34] as const, density: 4 };
}), { turbulence: 0.25, billow: 0.3, drift: [0, 0.05, 0], colour: [0.96, 0.95, 0.92], seed: 3, seconds: 10 });
const smoke = draw.density("smokeRing", medium("smoke", { puffs: ring.puffs }), {
  bounds: ring.bounds, sun: [1, 0.97, 0.9], sky: 1.2, forward: 0.3, shadowing: 0.35, detail: { kind: "none" }, haze: 0,
});

// ---- hull: a lofted body that is not a ship's. `hull` lofts stations its lines plan decides; `loft` lofts any row
// of curves: here seven ribbed rings, a gourd lying on its side.
const ringAt = (x: number, r: number) => (v: In<"f32">) => {
  const a = mul(v, TAU), rr = mul(add(1, mul(cos(mul(a, 7)), 0.1)), r);
  return vec3(x, add(1.4, mul(rr, sin(a))), add(-4, mul(rr, cos(a))));
};
const pod = draw.surface("pod", loft([0.03, 0.5, 0.85, 0.95, 0.8, 0.5, 0.03].map((r, i) => ringAt(1.4 + i * 0.55, r))), {
  paint: (u) => mix(vec3(0.45, 0.6, 0.25), vec3(0.9, 0.8, 0.35), smoothstep(0.3, 0.5, fract(mul(u, 7)))), grid: { u: spacing.even(84), v: spacing.even(40) }, ...two,
});

// ---- pendulum: a lantern on a cart that runs at 2 units/s from t = 0.5 to 1.5. A pivot path that is piecewise linear
// is exactly one jolt at each key (its change of speed), so a keyed path is a list of jolts. The string is a rope.
const swing = pendulum({ length: 2, gravity: 9.8, damping: 0.08 });
const psi = swing.answer(time, [jolt(sub(time, 0.5), 2), jolt(sub(time, 1.5), -2)]);
const pivot = vec3(add(7.8, mul(sub(clamp(time, 0.5, 1.5), 0.5), 2)), 3.4, -4);
const bob = add(pivot, vec3(mul(sin(psi), 2), mul(cos(psi), -2), 0));
const lantern = [
  strand({ name: "track", spine: (m) => vec3(add(7.3, mul(m, 3.2)), 3.45, -4), girth: 0.06, paint: [0.35, 0.25, 0.2], stations: 4 }),
  ropes("lanternString", [{ a: pivot, b: bob, sag: 0 }], { width: 0.02, colour: [0.2, 0.15, 0.12] }),
  strand({ name: "lantern", spine: (m) => add(bob, vec3(0, mul(m, -0.5), 0)), girth: 0.2, paint: [0.95, 0.7, 0.3], stations: 4 }),
];

// ---- sheetOn: a saw-toothed fin. `sheetOn` scallops its edge by one law (sag between rays); `sheetOnEdges` gives
// the root and the edge, and `sheet` takes any edge between them: here each tooth rises and drops.
const eel = strand({
  name: "eel", spine: (m) => vec3(add(-9.5, mul(m, 5)), add(0.5, mul(sin(mul(m, 5)), 0.25)), 3),
  girth: (m) => add(mul(sin(mul(m, Math.PI)), 0.35), 0.04), paint: [0.3, 0.45, 0.5],
});
const fin = sheetOnEdges({ on: eel, from: 0.15, to: 0.85, height: 0.8, sag: 0, rake: 0.3 });
const teeth = (x: In<"f32">) => mix(fin.root(x), fin.edge(x), sub(1, mul(fract(mul(lift<"f32">(x), 7)), 0.7)));
const sawFin = draw.surface("sawFin", sheet(fin.root, teeth), { paint: () => vec3(0.75, 0.35, 0.25), grid: { u: spacing.even(140), v: spacing.even(2) }, ...two });

// ---- fan: a frill that curls out of its plane. A fan's cloth follows its rays, so rays that are `bent` stalks (each
// crooked toward the viewer, the outer ones bowed apart) make a curling frill.
const rays = [-2, -1, 0, 1, 2].map((k) => {
  const a = k * 0.32;
  return bent({ root: [0, 0.3, 3], along: [Math.sin(a), Math.cos(a), 0], a: [Math.cos(a), -Math.sin(a), 0], b: [0, 0, 1], length: 2.4, bow: [k * 0.1, 0], crook: [0, 1.4] }).spine;
});
const frill = [
  draw.surface("frill", fan({ rays, sag: 0.12, scallop: 0.35 }), { paint: (_u, v) => mix(vec3(0.3, 0.5, 0.75), vec3(0.9, 0.85, 0.6), v), grid: { u: spacing.even(40), v: spacing.even(20) }, ...two }),
  ...rays.map((r, k) => strand({ name: `frillRay${k}`, spine: r, girth: 0.035, paint: [0.2, 0.25, 0.4], stations: 16 })),
];

// ---- chain: an arm with a hooked claw. `chain` reaches with two or three straight segments; its joints go through
// `polyline` with one more of my own (a hook past the tip), a kink no chain's law makes.
const arm = chain({ root: [6, 0.3, 3], target: vec3(add(7.6, mul(sin(time), 0.3)), 2, 3), lengths: [1.5, 1.3], bend: [-1, 0.2, 0] });
const hook = add(arm.joints[2]!, vec3(0.55, -0.45, 0));
const knots = [0, 0.427, 0.798, 1].map((k) => lift<"f32">(k));
const hookArm = strand({ name: "hookArm", spine: (m) => polyline(m, [...arm.joints, hook], knots), girth: (m) => mix(lift<"f32">(0.2), lift<"f32">(0.06), m), tips: ["round", "point"], paint: [0.8, 0.45, 0.3] });

export default scene({
  ground: sea({ swell: [{ direction: [1, 0.2], length: 9, height: 0.08, speed: 0.8 }] }),
  things: [coiled, pod, ...lantern, eel, sawFin, ...frill, hookArm, smoke],
  style: toon({ bands: 3, outline: 0.04 }),
  sun: [-0.4, 0.8, 0.45],
  cameras: {
    three: { kind: "perspective", eye: [0, 8, 19], target: [0, 1.6, -0.5], fovY: 0.8 },
  },
});
