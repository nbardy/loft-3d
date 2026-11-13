// The closed forms soft things are drawn with, against brute-force numerical integration of the density they claim to
// integrate. These are the numbers every cloud pixel and every light-pass entry is made of; a sign slip, a wrong
// branch at the Simpson switch or a tail computed as a difference of nearly equal numbers shows here as a wrong
// optical depth, which on screen is only "the cloud looks a bit off".
import { expect, test } from "bun:test";
import { compileJs, draw, scene, sea, toon, variable, vec3, type Expr } from "../src/index.ts";
import { compileScene } from "../src/compile/index.ts";
import { gaussRay, gaussTail, GAUSS_WGSL } from "../src/soft/gauss.ts";
import { accessMedium, bank, blob, layer, medium, tauFunction, type Medium } from "../src/soft/medium.ts";
import { probe, stateAt } from "./compile.harness.ts";

/** Composite Simpson's rule with n (even) intervals. */
function simpson(f: (t: number) => number, a: number, b: number, n = 20000): number {
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  return (s * h) / 3;
}

type Case = { name: string; o: number[]; d: number[]; c: number[]; k: number[]; t0: number; t1: number };
const norm = (v: number[]) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
// Rays in world units against a puff exp(-|k (p - c)|^2); `k` 0 on an axis is a layer.
const CASES: Case[] = [
  { name: "through the centre", o: [-10, 0.5, 0.2], d: [1, 0, 0], c: [0, 0.5, 0.2], k: [0.5, 0.5, 0.5], t0: 0, t1: 30 },
  { name: "off centre, oblique", o: [-6, -3, 2], d: norm([1, 0.4, -0.2]), c: [1, 1, 0], k: [0.4, 0.7, 0.3], t0: 0, t1: 25 },
  { name: "clipped by a depth inside the puff", o: [-8, 0, 0], d: [1, 0, 0], c: [0, 0.3, 0], k: [0.5, 0.5, 0.5], t0: 0, t1: 7.2 },
  { name: "starting inside, ending in the far tail", o: [0.5, 0, 0], d: norm([1, 0.1, 0]), c: [0, 0, 0], k: [1, 1, 1], t0: 0, t1: 9 },
  { name: "a segment wholly in the near tail", o: [-9, 0, 0], d: [1, 0, 0], c: [0, 0, 0], k: [0.6, 0.6, 0.6], t0: 0, t1: 3 },
  { name: "a layer seen almost edge-on (Simpson branch)", o: [0, 1.2, 0], d: norm([1, -0.0005, 0.3]), c: [0, 0, 0], k: [0, 0.5, 0], t0: 0, t1: 60 },
  { name: "a layer crossed steeply", o: [0, 6, 0], d: norm([0.3, -1, 0.1]), c: [0, 0, 0], k: [0, 0.5, 0], t0: 0, t1: 12 },
];
const densityAt = (cs: Case) => (t: number) => {
  let q = 0;
  for (let a = 0; a < 3; a++) { const x = cs.k[a] * (cs.o[a] + cs.d[a] * t - cs.c[a]); q += x * x; }
  return Math.exp(-q);
};
const canonical = (cs: Case) => ({ O: [0, 1, 2].map((a) => cs.k[a] * (cs.o[a] - cs.c[a])).concat(0), D: [0, 1, 2].map((a) => cs.k[a] * cs.d[a]).concat(0) });
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-6);

// Catches: a wrong closed form (sign of the centre, scale by s), the Simpson switch on the wrong side, a tail lost to
// cancellation, the clip at t1 (scene depth) not honoured.
test("the CPU closed form of a Gaussian's optical depth matches numerical integration", () => {
  for (const cs of CASES) {
    const { O, D } = canonical(cs);
    const want = simpson(densityAt(cs), cs.t0, cs.t1);
    expect([cs.name, rel(gaussRay(O, D, cs.t0, cs.t1).tau, want) < 1e-4]).toEqual([cs.name, true]);
  }
  // Toward infinity (the sun): the tail against a long numerical integral.
  const cs = CASES[1];
  const { O, D } = canonical(cs);
  expect(rel(gaussTail(O, D), simpson(densityAt(cs), 0, 200, 200000))).toBeLessThan(1e-4);
});

const swell = sea({ swell: [{ direction: [1, 0], length: 10, height: 0.2, speed: 1 }] });
const box = { min: [-20, -2, -20], max: [20, 20, 20] } as const;
const OPTS = { bounds: box, sun: [1, 1, 1], sky: 1, forward: 0.3, shadowing: 1, detail: { kind: "none" }, haze: 0 } as const;

// Catches: the WGSL twin drifting from the JavaScript one (a typo in a coefficient of erfc, a select with its arms
// swapped), and f32 accuracy below what a cloud needs, on the same cases.
test("the GPU closed form matches numerical integration in f32", async () => {
  const m = medium("g", { puffs: [blob({ centre: [0, 1, 0], radii: [1, 1, 1], density: 1, colour: [1, 1, 1] })] });
  const a = compileScene(scene({ ground: swell, things: [draw.density("gcloud", m, OPTS)], style: toon(), sun: [0, 1, 0] })).artefact;
  const code = `fn probe(i: u32, x: vec4<f32>) -> vec4<f32> {
  let c = cases[i];
  return vec4<f32>(loft_gauss_ray(c[0], c[1], c[2].x, c[2].y), 0.0);
}`;
  const rows = CASES.map((cs) => { const { O, D } = canonical(cs); return `array<vec4<f32>, 3>(vec4<f32>(${O.join(", ")}), vec4<f32>(${D.join(", ")}), vec4<f32>(${cs.t0}, ${cs.t1}, 0.0, 0.0))`; });
  const module = `${GAUSS_WGSL}\nconst cases = array<array<vec4<f32>, 3>, ${CASES.length}>(${rows.join(", ")});\n`;
  const got = await probe(a, stateAt(a, 0), module, code, CASES.map(() => [0]));
  CASES.forEach((cs, i) => expect([cs.name, rel(got[i][0], simpson(densityAt(cs), cs.t0, cs.t1)) < 1e-4]).toEqual([cs.name, true]));
}, 60000);

/** Numerical optical depth of a medium's own density expression along a ray (the CPU backend of `Medium.density`). */
function numericTau(m: Medium, o: number[], d: number[], t0: number, t1: number): number {
  const P = variable("p", "vec3");
  const run = compileJs([m.density(P as Expr<"vec3">)]);
  return simpson((t) => run({ vars: { p: [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t] }, inputs: {}, params: {} })[0] as number, t0, t1, 4000);
}

// Catches: optical depths of a medium's parts not adding (a blob skipped by its cluster's sphere or the closest-approach
// cull while it still contributes, the per-frame sort losing or duplicating a blob, a lane read from the wrong entry), and a fog bank's edge split wrong (fog on the clear side, the
// soft edge's term left out, a ray parallel to the edge). The GPU sums the medium's own table; the reference
// integrates the medium's density expression.
test("a medium's optical depth on the GPU is the sum of its parts, as numerically integrated", async () => {
  const m = medium("pair", {
    puffs: [
      blob({ centre: [0, 4, 0], radii: [2, 1.5, 2], density: 0.8, colour: [1, 1, 1] }),
      blob({ centre: [1.5, 4.5, 0.5], radii: [1.2, 1.2, 1.2], density: 1.3, colour: [1, 1, 1] }),
      layer({ height: 0, thickness: 1.5, density: 0.1, colour: [1, 1, 1] }),
    ],
    banks: [bank({ height: 1, thickness: 2, density: 0.2, colour: [1, 1, 1], edge: { through: [3, 0], clear: [1, 0.2], softness: 1.5 } })],
  });
  const c = compileScene(scene({ ground: swell, things: [draw.density("paircloud", m, OPTS)], style: toon(), sun: [0.3, 1, 0.2] }));
  const tau = tauFunction(m, "probe_tau", accessMedium(m, [0, 1, 0], (t) => ({ wgsl: `t_${t.name}` })));
  const rays: { o: number[]; d: number[]; t0: number; t1: number }[] = [
    { o: [-12, 4.2, 0.1], d: [1, 0, 0], t0: 0, t1: 30 },          // through both blobs
    { o: [-10, 0.8, -3], d: norm([1, 0.02, 0.15]), t0: 0, t1: 25 }, // along the fog, across the bank's edge
    { o: [6, 8, 1], d: norm([-0.3, -1, 0]), t0: 0, t1: 9 },         // down through a blob into the layer, clipped
    { o: [-4, 1, -10], d: [0, 0, 1], t0: 0, t1: 20 },               // parallel to the bank's edge, inside the fog
  ];
  const code = `${tau.code}
fn probe(i: u32, x: vec4<f32>) -> vec4<f32> { let r = rays[i]; return vec4<f32>(probe_tau(r[0].xyz, r[1].xyz, r[2].x, r[2].y), 0.0, 0.0, 0.0); }`;
  const module = `${tau.libs.map((l) => l.wgsl).join("\n")}\nconst rays = array<array<vec4<f32>, 3>, ${rays.length}>(${rays.map((r) => `array<vec4<f32>, 3>(vec4<f32>(${r.o.join(", ")}, 0.0), vec4<f32>(${r.d.join(", ")}, 0.0), vec4<f32>(${r.t0}, ${r.t1}, 0.0, 0.0))`).join(", ")});\n`;
  const got = await probe(c.artefact, stateAt(c.artefact, 0), module, code, rays.map(() => [0]));
  rays.forEach((r, i) => expect([i, rel(got[i][0], numericTau(m, r.o, r.d, r.t0, r.t1)) < 1e-4]).toEqual([i, true]));
}, 60000);
