// Ships and whirlpools (examples/recipes/hull.ts and ship.ts, src/geom/afloat.ts and whirlpool.ts): the hull against its lines, a ship afloat
// against the swell's formula, the whirlpool's map (identity outside, a round trip inside, no edge at the rim), a point
// advected by the whirlpool's velocity against the map itself, and a body coiled by the whirlpool against its radii.
import { expect, test } from "bun:test";
import {
  afloatFrame, compileJs, lift, place, scene, sea, strand, through, toon, variable, vec3, whirlpool,
  type Env, type Expr,
} from "../src/index.ts";
import { compileScene } from "../src/compile/index.ts";
import { hull } from "../examples/recipes/hull.ts";
import { STATION_VEC4S } from "../src/map/transport.ts";
import { stateAt } from "./compile.harness.ts";

const env = (vars: Env["vars"], t = 0): Env => ({ vars, inputs: { time: t }, params: {} });
const U = variable("u", "f32"), V = variable("v", "f32");
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(...a.map((x, i) => x - b[i]));

// Catches: a loft whose knots are not at the stations (a non-uniform parameter, an off-by-one in the station count, the
// spline's phantom ends weighted wrongly), or a section parametrised inside out (the skin's normal facing in, which the
// one-sided hull would cull: an invisible ship).
test("a hull's skin passes through its station curves, and its normal points out of it", () => {
  const h = hull({ length: 12, beam: 3.4, depth: 1.3, freeboard: 1.1, castle: [0.5, 0.2], transom: 0.5, stations: 13 });
  const run = compileJs([h.skin.point(U, V), h.skin.normal(U, V), ...h.stations.map((s) => s.curve(V))]);
  let worst = 0, inward = 0;
  for (const [i, st] of h.stations.entries()) {
    for (let j = 0; j <= 40; j++) {
      const v = j / 40;
      const out = run(env({ u: st.u, v })) as number[][];
      worst = Math.max(worst, dist(out[0], out[2 + i]));
    }
  }
  // Outward: away from the hull's centreline (y = the station's mid-height, z = 0), checked over the whole skin
  // except the stem and the stern's last few percent, where the section closes to a line.
  for (let a = 1; a < 40; a++) for (let b = 1; b < 40; b++) {
    const u = 0.04 + (0.92 * a) / 40, v = b / 40;
    const [p, n] = run(env({ u, v })) as number[][];
    const keel = run(env({ u, v: 0.5 }))[0] as number[], top = run(env({ u, v: 0 }))[0] as number[];
    const centre = [p[0], (keel[1] + top[1]) / 2, 0];
    if (n[0] * 0 + n[1] * (p[1] - centre[1]) + n[2] * (p[2] - centre[2]) <= 0) inward++;
  }
  expect(worst).toBeLessThan(1e-9);
  expect(inward).toBe(0);
});

// Catches: afloat sampling the water in the wrong place (heading measured the other way, beam and length swapped,
// the sample points in the water's coordinates instead of the sea's), a pitch or roll of the wrong sign, or a height
// that is not the mean of what it sampled. Compared against the swell's formula evaluated independently in JS, over a
// sweep of times and headings.
test("a ship afloat on a known swell has the height and slope the swell's formula gives", () => {
  const swell = { direction: [0.8, 0.6] as [number, number], length: 18, height: 0.9, speed: 2.3, phase: 0.4 };
  const water = sea({ swell: [swell] });
  const k = (2 * Math.PI) / swell.length, A = swell.height / 2, w = k * swell.speed;
  const H = (x: number, z: number, t: number) => A * Math.sin(k * (0.8 * x + 0.6 * z) - w * t + swell.phase);
  const L = 9, B = 3, at: [number, number] = [2.5, -1.5];
  let worstH = 0, worstPitch = 0, worstRoll = 0, worstFrame = 0;
  for (const heading of [0, 0.7, 2.4, -1.9]) {
    const g = afloatFrame(water, { at, heading, length: L, beam: B });
    const run = compileJs([g.o, g.x, g.y, g.z]);
    for (let t = 0; t <= 6; t += 0.37) {
      const [o, x, y, z] = run(env({}, t)) as number[][];
      const f = [Math.cos(heading), Math.sin(heading)], s = [-Math.sin(heading), Math.cos(heading)];
      const bow = H(at[0] + f[0] * L / 2, at[1] + f[1] * L / 2, t), stern = H(at[0] - f[0] * L / 2, at[1] - f[1] * L / 2, t);
      const star = H(at[0] + s[0] * B / 2, at[1] + s[1] * B / 2, t), port = H(at[0] - s[0] * B / 2, at[1] - s[1] * B / 2, t);
      worstH = Math.max(worstH, Math.abs(o[1] - (bow + stern + star + port) / 4), Math.hypot(o[0] - at[0], o[2] - at[1]));
      // Pitch: rise of the bow axis per unit run; roll: rise of the starboard axis per unit run.
      worstPitch = Math.max(worstPitch, Math.abs(x[1] / Math.hypot(x[0], x[2]) - (bow - stern) / L));
      worstRoll = Math.max(worstRoll, Math.abs(z[1] / Math.hypot(z[0], z[2]) - (star - port) / B));
      // Orthonormal and right-handed: y = z cross x.
      const zx = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
      worstFrame = Math.max(worstFrame, dist(y, zx), Math.abs(Math.hypot(...x) - 1), Math.abs(Math.hypot(...z) - 1), Math.abs(x[0] * z[0] + x[1] * z[1] + x[2] * z[2]));
    }
  }
  expect(worstH).toBeLessThan(1e-9);
  expect(worstPitch).toBeLessThan(1e-9);
  // Roll is exact only to the extent the bow axis is level: the starboard axis is made perpendicular to it.
  expect(worstRoll).toBeLessThan(0.02);
  expect(worstFrame).toBeLessThan(1e-12);
});

const R = 20;
const pool = whirlpool({ at: [3, -2], radius: R, spin: 0.3, depth: 5, drift: 0.4 });
const P = variable("p", "vec2"), T = variable("t", "f32");

// Catches: a map that leaks outside its radius (a select dropped, a smooth falloff instead of exactly nothing), an
// inverse that drifts from the forward map at large times (the clock c t entering one with the wrong sign), or a
// branch of tan taken on the wrong side near the centre or the rim.
test("the whirlpool is the identity outside its radius and round-trips inside it", () => {
  const f = pool.flow(P, T);
  const run = compileJs([f.xz, pool.toLocal(P, T), pool.toLocal(f.xz, T), f.turn, pool.dip(P)]);
  let worstTrip = 0, outsideMoved = 0, tested = 0;
  for (let i = 0; i < 4000; i++) {
    const r = R * 1.6 * Math.sqrt((i * 0.618034) % 1), a = i * 2.39996, t = (i % 50) * 12.1; // up to 10 minutes
    const p = [3 + r * Math.cos(a), -2 + r * Math.sin(a)];
    const [fwd, back, trip, turn, dip] = run(env({ p, t })) as [number[], number[], number[], number, number];
    if (r >= R) {
      outsideMoved = Math.max(outsideMoved, dist(fwd, p), dist(back, p), Math.abs(turn), Math.abs(dip));
    } else if (r > 0.02 * R) {
      worstTrip = Math.max(worstTrip, dist(trip, p) / R);
      tested++;
    }
  }
  expect(tested).toBeGreaterThan(1000);
  expect(outsideMoved).toBe(0);
  // f64 on the CPU; the map is two tangents and two arctangents deep.
  expect(worstTrip).toBeLessThan(1e-9);
});

// Catches: a funnel or a flow that ends at the rim with a kink (a visible ring where the whirlpool meets the open
// sea): the water's height and slope just inside the rim must match just outside, at any time.
test("the sea a whirlpool deforms has no edge at the rim", () => {
  const water = sea({ swell: [{ direction: [1, 0.3], length: 15, height: 0.6, speed: 1.5 }], deform: [pool] });
  const X = variable("x", "vec2");
  const run = compileJs([water.height(X), water.gradient(X)]);
  let worstH = 0, worstG = 0;
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2, t = i * 3.7;
    const at = (r: number) => run(env({ x: [3 + r * Math.cos(a), -2 + r * Math.sin(a)] }, t)) as [number, number[]];
    const [hi, gi] = at(R * (1 - 1e-4)), [ho, go] = at(R * (1 + 1e-4));
    worstH = Math.max(worstH, Math.abs(hi - ho));
    worstG = Math.max(worstG, dist(gi, go));
  }
  // Across 2e-4 R = 4e-3 units: the swell's own slope (at most 0.13) moves the height by up to 5e-4.
  expect(worstH).toBeLessThan(1e-3);
  expect(worstG).toBeLessThan(1e-3);
});

// Catches: a velocity that is not the derivative of the map (a sign, a missing chain-rule term through the clock), or
// an Eulerian drift evaluated at the wrong water (forward instead of inverse). A point advected with RK4 by the drift
// field must stay with the point placed at the same whirlpool coordinates.
test("a point advected by the whirlpool's velocity stays with an object placed at the same coordinates", () => {
  const water = sea({ swell: [{ direction: [1, 0], length: 15, height: 0.5, speed: 1.5 }], deform: [pool] });
  const vortex = pool.in(water);
  const X = variable("x", "vec2");
  const drift = compileJs([vortex.drift(X)]);
  const v = (x: number[], t: number) => drift(env({ x }, t))[0] as number[];
  const c = [3 + 11, -2 + 4];
  const placed = compileJs([vortex.frame(vec3(c[0], 0, c[1])).o, vortex.velocity(vec3(c[0], 0, c[1]))]);
  const at = (t: number) => placed(env({}, t)) as number[][];
  let x = [at(0)[0][0], at(0)[0][2]];
  const dt = 0.02, steps = 1500; // 30 s
  let worst = 0;
  for (let i = 0; i < steps; i++) {
    const t = i * dt;
    const k1 = v(x, t), k2 = v([x[0] + k1[0] * dt / 2, x[1] + k1[1] * dt / 2], t + dt / 2);
    const k3 = v([x[0] + k2[0] * dt / 2, x[1] + k2[1] * dt / 2], t + dt / 2), k4 = v([x[0] + k3[0] * dt, x[1] + k3[1] * dt], t + dt);
    x = [x[0] + (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]), x[1] + (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])];
    const o = at(t + dt)[0];
    worst = Math.max(worst, Math.hypot(x[0] - o[0], x[1] - o[2]));
  }
  // The object moved a long way (round the whirlpool and inward), and the advected point stayed with it.
  const travelled = dist(at(0)[0], at(steps * dt)[0]);
  expect(travelled).toBeGreaterThan(8);
  expect(worst).toBeLessThan(1e-6);
  // The Lagrangian velocity is the time derivative of the placed point, vertical motion included.
  for (const t of [0.5, 7, 19]) {
    const h = 1e-4, d = at(t + h)[0].map((a, i) => (a - at(t - h)[0][i]) / (2 * h));
    expect(dist(at(t)[1], d)).toBeLessThan(1e-6);
  }
});

// Catches: placement acting on the skin instead of the skeleton (cross-sections sheared by the winding), and stretch
// measured on the placed spine (the coil several times longer than the body as authored, so volume preservation
// thinned it by 1 / sqrt(stretch): the defect fixed in src/map/sweep.ts). The coiled body's radii must equal the
// unplaced body's at the same time, while its spine is much longer.
test("a body coiled by the whirlpool keeps its cross-section radii", () => {
  const water = sea({ swell: [{ direction: [1, 0.2], length: 12, height: 0.4, speed: 1.2 }], deform: [pool] });
  const spec = {
    spine: (m: Expr<"f32">) => through(m, [[3 + 2, -0.3, -2], vec3(3 + 7, -0.2, -2), [3 + 12, 0, -2], [3 + 17, -0.3, -2]]),
    stations: 40, girth: (m: Expr<"f32">) => lift<"f32">(0.4).add(m.mul(0.2)), paint: [1, 1, 1] as const,
  };
  const free = strand({ ...spec, name: "eelFree" });
  const coiled = place(strand({ ...spec, name: "eelCoil" }), pool.in(water));
  const c = compileScene(scene({ ground: water, things: [free, coiled], style: toon(), sun: [0, 1, 0] }));
  let worstR = 0;
  for (const t of [0, 3, 11]) {
    const frame = c.frame(stateAt(c.artefact, t));
    const a = frame.table(free.table), b = frame.table(coiled.table);
    let lenFree = 0, lenCoil = 0;
    for (let k = 0; k < 40; k++) {
      const o = k * STATION_VEC4S * 4;
      worstR = Math.max(worstR, Math.abs(a[o + 8] - b[o + 8]) / 0.6, Math.abs(a[o + 9] - b[o + 9]) / 0.6);
      if (k > 0) {
        const p = o - STATION_VEC4S * 4;
        lenFree += Math.hypot(a[o] - a[p], a[o + 1] - a[p + 1], a[o + 2] - a[p + 2]);
        lenCoil += Math.hypot(b[o] - b[p], b[o + 1] - b[p + 1], b[o + 2] - b[p + 2]);
      }
    }
    expect(lenCoil / lenFree).toBeGreaterThan(1.5);
  }
  // Both are f32 tables filled from the same local spine.
  expect(worstR).toBeLessThan(1e-6);
});

