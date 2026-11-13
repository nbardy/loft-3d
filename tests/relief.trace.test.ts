// The relief layer on the CPU backend (the same expressions the shaders run): displacement against closed forms, the
// shell tracer against analytic ray intersections on a flat patch and against the displaced surface on spheres of
// falling radius, and the sculpt layer's interpolation and wrap.
import { expect, test } from "bun:test";
import { add, compileJs, mul, sin, variable } from "../src/expr.ts";
import { displace } from "../src/relief/displace.ts";
import { bump, level, sum, type Height } from "../src/relief/height.ts";
import { sampleGrid, sculptLayer, SculptTable } from "../src/relief/sculpt.ts";
import { firstCrossing, plane, sphere, sphereDirNum, sphereUv, tracer, v3, type V3 } from "./relief.fixture.ts";

const U = variable("tu", "f32"), V = variable("tv", "f32");
const env = (u: number, v: number) => ({ vars: { tu: u, tv: v }, inputs: {}, params: {} });
const heightJs = (h: Height) => { const run = compileJs([h(U, V)]); return (u: number, v: number) => run(env(u, v))[0] as number; };

// Catches: a displaced normal taken from the base surface (or with the height's slope missing or of the wrong sign),
// and a point moved along the wrong direction or by the wrong amount.
test("a displaced sphere's point and normal equal the closed forms to 1e-4", () => {
  const R = 1.3, K = 3;
  const H: Height = (u, v) => add(0.1, mul(mul(sin(mul(v, 2 * Math.PI * K)), sin(mul(u, Math.PI))), 0.06));
  const Hn = (u: number, v: number) => 0.1 + 0.06 * Math.sin(2 * Math.PI * K * v) * Math.sin(Math.PI * u);
  const Hu = (u: number, v: number) => 0.06 * Math.sin(2 * Math.PI * K * v) * Math.PI * Math.cos(Math.PI * u);
  const Hv = (u: number, v: number) => 0.06 * 2 * Math.PI * K * Math.cos(2 * Math.PI * K * v) * Math.sin(Math.PI * u);
  const s = displace(sphere(R), H);
  const run = compileJs([s.point(U, V), s.normal(U, V)]);
  let worstP = 0, worstN = 0;
  for (let i = 1; i < 20; i++) for (let j = 0; j < 24; j++) {
    const u = i / 20, v = j / 24;
    const [p, n] = run(env(u, v)) as V3[];
    // Closed form: P = r(u, v) d(u, v) with r = R + H; Pu = Hu d + r du_d, Pv = Hv d + r dv_d.
    const th = Math.PI * u, ph = -2 * Math.PI * v, r = R + Hn(u, v);
    const d = sphereDirNum(u, v);
    const dth: V3 = [Math.cos(th) * Math.cos(ph), -Math.sin(th), Math.cos(th) * Math.sin(ph)];
    const dph: V3 = [-Math.sin(th) * Math.sin(ph), 0, Math.sin(th) * Math.cos(ph)];
    const pu = v3.add(v3.scale(d, Hu(u, v)), v3.scale(dth, r * Math.PI));
    const pv = v3.add(v3.scale(d, Hv(u, v)), v3.scale(dph, -2 * Math.PI * r));
    const want = v3.unit([pu[1] * pv[2] - pu[2] * pv[1], pu[2] * pv[0] - pu[0] * pv[2], pu[0] * pv[1] - pu[1] * pv[0]]);
    worstP = Math.max(worstP, v3.len(v3.sub(p, v3.scale(d, r))));
    worstN = Math.max(worstN, v3.len(v3.sub(n, want)));
  }
  expect(worstP).toBeLessThan(1e-4);
  expect(worstN).toBeLessThan(1e-4);
});

// ---- the tracer on a flat patch -----------------------------------------------------------------------------------

const TOP = 0.11;
const PATCH = { size: [1, 1] as [number, number], wrap: "none" as const };
/** Rays entering the top of the shell over the middle of the patch, at `deg` from the normal (toward +x). */
function shots(deg: number, n: number): { entry: V3; dir: V3; uv: [number, number] }[] {
  const a = (deg * Math.PI) / 180, d: V3 = [Math.sin(a), -Math.cos(a), 0];
  const out: { entry: V3; dir: V3; uv: [number, number] }[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    // Shifted back along the ray by half its run through the shell, so grazing rays cross the middle of the patch.
    const x = 0.35 + (0.3 * i) / (n - 1) - Math.tan(a) * TOP * 0.5, z = -(0.35 + (0.3 * j) / (n - 1));
    out.push({ entry: [x, TOP, z], dir: d, uv: [x, -z] });
  }
  return out;
}

// Catches: a march that brackets the wrong interval, a refinement that does not converge, rays mapped into the
// patch's coordinates with the wrong inverse (a wrong u, v or height scale shows at any non-perpendicular angle).
test("on a ramp the shell tracer finds the analytic hit to 1e-5 at perpendicular, 45 and 75 degree views", () => {
  const slope = 0.06;
  const H: Height = (u) => add(0.02, mul(u, slope));
  const tr = tracer(plane(1), H, { refine: 5, ink: 0 });
  for (const deg of [0, 45, 75]) {
    let worst = 0;
    for (const s of shots(deg, 21)) {
      // y = 0.02 + slope x along e + t d.
      const t = (0.02 + slope * s.entry[0] - s.entry[1]) / (s.dir[1] - slope * s.dir[0]);
      const r = tr.march(s, TOP, 16);
      expect(r.kind).toBe(1);
      worst = Math.max(worst, v3.len(v3.sub(r.world, v3.add(s.entry, v3.scale(s.dir, t)))));
    }
    expect(worst).toBeLessThan(1e-5);
  }
});

// Catches: the same, on a height whose slope is unbounded at its rim (the hardest case for a linear search), and a
// relief normal built with the wrong tangents. The stated tolerance: every perpendicular ray to 1e-5; at 75 degrees,
// 99.5% of rays to 1e-4 (1e-3 of the bump's radius), and the rest only where the true hit is within 6 degrees of
// tangent (a linear search with 32 samples can step over a sliver that thin).
test("on a hemisphere bump the shell tracer finds the analytic hit, perpendicular and grazing", () => {
  const R = 0.1, C: V3 = [0.5, 0, -0.5];
  const H = bump(PATCH, { at: [0.5, 0.5], radius: R, height: R, profile: "dome" });
  const tr = tracer(plane(1), H, { refine: 5, ink: 0 });
  const truth = (e: V3, d: V3): { t: number; cos: number } => {
    const oc = v3.sub(e, C), b = v3.dot(oc, d), c = v3.dot(oc, oc) - R * R, disc = b * b - c;
    if (disc >= 0) {
      const t = -b - Math.sqrt(disc), p = v3.add(e, v3.scale(d, t));
      if (p[1] >= 0) return { t, cos: -v3.dot(v3.unit(v3.sub(p, C)), d) };
    }
    return { t: -e[1] / d[1], cos: -d[1] };
  };
  let worstPerp = 0, worstNormal = 0;
  for (const s of shots(0, 31)) {
    const r = tr.march(s, TOP, 16);
    const want = v3.add(s.entry, v3.scale(s.dir, truth(s.entry, s.dir).t));
    worstPerp = Math.max(worstPerp, v3.len(v3.sub(r.world, want)));
    const off = Math.hypot(s.entry[0] - C[0], s.entry[2] - C[2]);
    if (off < 0.9 * R) worstNormal = Math.max(worstNormal, 1 - v3.dot(r.normal, v3.unit(v3.sub(r.world, C))));
  }
  expect(worstPerp).toBeLessThan(1e-5);
  expect(worstNormal).toBeLessThan(1e-6);

  const grazing = shots(75, 61);
  let good = 0;
  for (const s of grazing) {
    const want = truth(s.entry, s.dir);
    const err = v3.len(v3.sub(tr.march(s, TOP, 32).world, v3.add(s.entry, v3.scale(s.dir, want.t))));
    if (err < 1e-4) good++;
    else expect(want.cos).toBeLessThan(Math.sin((6 * Math.PI) / 180));
  }
  expect(good / grazing.length).toBeGreaterThan(0.995);
});

// ---- the tracer on curved surfaces --------------------------------------------------------------------------------

/**
 * The worst distance between the tracer's hit and the true intersection of the ray with the displaced sphere (f64
 * root finding on |X| - R - H(angles of X)), over rays entering at the shell's top across a patch near the equator.
 */
function curvedError(R: number, deg: number, hMax: number): { worst: number; disagree: number } {
  const patch = { size: [Math.PI * R, 2 * Math.PI * R] as [number, number], wrap: "v" as const };
  const H = sum(level(0.2 * hMax), bump(patch, { at: [0.5, 0.1], radius: 1.5 * hMax, height: 0.8 * hMax, profile: "smooth" }));
  const Hn = heightJs(H);
  const top = 1.1 * hMax;
  const tr = tracer(sphere(R), H, { refine: 6, ink: 0 });
  let worst = 0, disagree = 0;
  for (let i = 0; i < 15; i++) for (let j = 0; j < 15; j++) {
    const uv: [number, number] = [0.5 + (0.3 * hMax / R) * (i / 14 - 0.5) * 4, 0.1 + (0.3 * hMax / R) * (j / 14 - 0.5)];
    const n = sphereDirNum(uv[0], uv[1]), e = v3.scale(n, R + top);
    const tu = v3.unit(v3.sub(sphereDirNum(uv[0] + 1e-4, uv[1]), n));
    const a = (deg * Math.PI) / 180, d = v3.unit(v3.add(v3.scale(n, -Math.cos(a)), v3.scale(tu, Math.sin(a))));
    const g = (t: number) => { const X = v3.add(e, v3.scale(d, t)); const [u, v] = sphereUv(X); return v3.len(X) - R - Hn(u, v); };
    const t = firstCrossing(g, (4 * top) / Math.cos(a));
    const r = tr.march({ uv, entry: e, dir: d }, top, 32);
    // A ray that misses the displaced sphere should miss in the tracer too (a silhouette), and the reverse.
    if (r.kind !== (t === null ? 0 : 1)) disagree++;
    else if (t !== null) worst = Math.max(worst, v3.len(v3.sub(r.world, v3.add(e, v3.scale(d, t)))));
  }
  return { worst, disagree };
}

// Catches: a tracer that is first order in curvature (dropping the second fundamental form, or the height's
// stretching of the tangents), which shows as an error falling only as 1 / R. Measured (DESIGN.md 8): the error is
// C hMax (hMax / R)^2 with C about 0.7-1.3 at 60 degrees from the normal and 4-5.3 at 75; silhouettes (hit or miss)
// agree with the displaced sphere for R >= 10 hMax at 60 degrees and R >= 40 hMax at 75. Perpendicular rays are exact
// (the radial line is a coordinate line of the shell).
test("relief on a sphere stays within C hMax (hMax/R)^2 of the displaced sphere, second order in curvature", () => {
  const h = 0.1;
  for (const R of [1, 2, 4]) expect(curvedError(R, 0, h).worst).toBeLessThan(1e-9);
  const e60 = [1, 2, 4, 8].map((R) => curvedError(R, 60, h));
  [1, 2, 4, 8].forEach((R, k) => {
    expect(e60[k].disagree).toBe(0);
    expect(e60[k].worst).toBeLessThan(1.5 * h * (h / R) ** 2);
  });
  // Second order: doubling R divides the error by about 4 (3 allows for the higher-order terms near R = 10 hMax).
  for (let k = 0; k + 1 < e60.length; k++) expect(e60[k].worst / e60[k + 1].worst).toBeGreaterThan(3);
  for (const R of [4, 8]) {
    const e = curvedError(R, 75, h);
    expect(e.disagree).toBe(0);
    expect(e.worst).toBeLessThan(6 * h * (h / R) ** 2);
  }
});

// ---- the sculpt layer ---------------------------------------------------------------------------------------------

function sculptJs(h: Height) {
  const run = compileJs([h(U, V)]);
  const tables = new Map<unknown, Float32Array>();
  return (u: number, v: number): number => run({
    ...env(u, v),
    tables: (t) => {
      let data = tables.get(t);
      if (!data) {
        data = new Float32Array(t.entries * t.lanes * 4);
        (t as SculptTable).prepare()({ env: env(0, 0), table: () => { throw new Error("no"); } }, data);
        tables.set(t, data);
      }
      return data;
    },
  })[0] as number;
}

// Catches: an off-by-one in the cell or the wrapped neighbour, slopes from the wrong neighbours, samples laid out
// transposed, and a closed direction that clamps instead of wrapping (the cell between the last and the first sample
// would then be flat or wrong). Smooth periodic data is reproduced to the bicubic bound everywhere, the seam included.
test("a sculpt layer interpolates its samples, wraps in the closed direction and clamps in the open one", () => {
  const NU = 13, NV = 9;
  const fn = (u: number, v: number) => 0.05 * Math.cos(Math.PI * u) * Math.sin(2 * Math.PI * v) + 0.02 * u;
  const samples = sampleGrid(fn, [NU, NV], { wrap: "v" });
  const look = sculptJs(sculptLayer("sculptTest", samples, [NU, NV], { wrap: "v" }));
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
    expect(Math.abs(look(i / (NU - 1), j / NV) - samples[i + NU * j])).toBeLessThan(1e-7);
  }
  let worst = 0;
  for (let k = 0; k <= 200; k++) for (const u of [0, 0.31, 0.77, 1]) {
    const v = k / 200;
    worst = Math.max(worst, Math.abs(look(u, v) - fn(u, v)));
    // Periodic in v: one turn on, and a turn back.
    expect(Math.abs(look(u, v + 1) - look(u, v))).toBeLessThan(1e-7);
    expect(Math.abs(look(u, v - 1) - look(u, v))).toBeLessThan(1e-7);
  }
  // Catmull-Rom on 9 samples a period: a few percent of the 0.05 amplitude, at the seam as anywhere.
  expect(worst).toBeLessThan(2.5e-3);
  // Open in u: beyond the ends it holds the end values.
  expect(Math.abs(look(-0.3, 0.4) - look(0, 0.4))).toBeLessThan(1e-7);
  expect(Math.abs(look(1.4, 0.4) - look(1, 0.4))).toBeLessThan(1e-7);
});

