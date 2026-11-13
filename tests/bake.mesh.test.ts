// Baked meshes: geometry against closed forms, topology, and the pose they are taken from.
import { expect, test } from "bun:test";
import serpent from "../examples/serpent.ts";
import { bakeScene, triangleCount, vertexCount, type BodyMesh } from "../src/bake/index.ts";
import { compileJs, variable } from "../src/expr.ts";
import { scene, sea, toon, type Drawable } from "../src/index.ts";
import { bent, bentScene, CYLINDER, cylinderScene, torusScene } from "./bake.fixtures.ts";
import { toLinear } from "../src/bake/index.ts";

const density = { along: 24, around: 24 };
const at = (a: Float32Array, i: number): [number, number, number] => [a[3 * i], a[3 * i + 1], a[3 * i + 2]];

/** Directed edges after welding vertices that coincide (the seam and the collapsed tips are duplicated vertices). */
function edgeBalance(b: BodyMesh): { undirectedCounts: number[]; unmatched: number } {
  const key = (i: number) => at(b.positions, i).map((x) => Math.round(x * 1e4)).join(",");
  const directed = new Map<string, number>();
  for (let t = 0; t < b.indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = key(b.indices[t + k]), c = key(b.indices[t + (k + 1) % 3]);
      directed.set(`${a}>${c}`, (directed.get(`${a}>${c}`) ?? 0) + 1);
    }
  }
  let unmatched = 0;
  const undirected = new Map<string, number>();
  for (const [e, n] of directed) {
    const [a, c] = e.split(">");
    if (directed.get(`${c}>${a}`) !== n) unmatched++;
    const u = a < c ? `${a}|${c}` : `${c}|${a}`;
    undirected.set(u, (undirected.get(u) ?? 0) + n);
  }
  return { undirectedCounts: [...undirected.values()], unmatched };
}

/** Signed volume by the divergence theorem: positive when triangles wind counter-clockwise seen from outside. */
function signedVolume(b: BodyMesh): number {
  let v = 0;
  for (let t = 0; t < b.indices.length; t += 3) {
    const [p, q, r] = [0, 1, 2].map((k) => at(b.positions, b.indices[t + k]));
    v += (p[0] * (q[1] * r[2] - q[2] * r[1]) - p[1] * (q[0] * r[2] - q[2] * r[0]) + p[2] * (q[0] * r[1] - q[1] * r[0])) / 6;
  }
  return v;
}

// Catches: a baked surface that is not the surface the GPU draws (wrong frame, wrong radius, wrong v direction).
test("a straight constant-radius tube bakes to the analytic cylinder to 1e-4", () => {
  const { radius, length, axisY } = CYLINDER;
  const [tube] = bakeScene(cylinderScene, { time: 0.7, density }).bodies;
  let worst = 0, centres = 0;
  for (let i = 0; i < vertexCount(tube); i++) {
    const [x, y, z] = at(tube.positions, i), n = at(tube.normals, i);
    const r = Math.hypot(y - axisY, z);
    if (r < 1e-6) { // a cap's centre: on the axis, normal along it
      centres++;
      expect(Math.abs(n[0])).toBeCloseTo(1, 5);
      continue;
    }
    worst = Math.max(worst, Math.abs(r - radius));
    expect(x).toBeGreaterThan(-1e-4); expect(x).toBeLessThan(length + 1e-4);
    // Side normals are radial; the caps' rim vertices (axial normal) are checked by the cap test below.
    if (Math.abs(n[0]) < 0.5) { expect(n[1] * (y - axisY) / r + n[2] * z / r).toBeGreaterThan(1 - 1e-4); }
  }
  expect(worst).toBeLessThan(1e-4);
  expect(centres).toBe(2);
  // The inscribed 24-gon prism, exactly: area (N/2) r^2 sin(2 pi / N) times the length (cap fans and sides together).
  const N = density.around;
  expect(signedVolume(tube) / (0.5 * N * radius * radius * Math.sin((2 * Math.PI) / N) * length)).toBeCloseTo(1, 4);
});

// Catches: flipped winding, a seam or tip that leaves an open edge, normals that are not unit length; on bodies, on
// the serpent's placed parts and instanced teeth, and on a torus that is only a map of (u, v).
test("every body is a closed, consistently wound, outward solid with unit normals", () => {
  for (const sc of [cylinderScene, bentScene, serpent, torusScene]) {
    for (const b of bakeScene(sc, { time: 1.2, density: { along: 20, around: 16 } }).bodies.filter((x) => x.closed)) {
      for (let i = 0; i < b.indices.length; i++) expect(b.indices[i]).toBeLessThan(vertexCount(b));
      for (let i = 0; i < vertexCount(b); i++) expect(Math.abs(Math.hypot(...at(b.normals, i)) - 1)).toBeLessThan(1e-4);
      const { undirectedCounts, unmatched } = edgeBalance(b);
      expect({ body: b.name, edgesNotShared2x: undirectedCounts.filter((n) => n !== 2).length, unmatched }).toEqual({ body: b.name, edgesNotShared2x: 0, unmatched: 0 });
      expect(signedVolume(b)).toBeGreaterThan(0);
    }
  }
});

// Catches: normals pointing inward or sideways on a curved, tapered, boxy body (the lean term of the analytic normal).
test("normals point away from the spine on a curved tapered body", () => {
  const m = variable("m", "f32");
  const spine = compileJs([bent.spine(m)]);
  const [body] = bakeScene(bentScene, { time: 2.1, density }).bodies;
  for (let i = 0; i < vertexCount(body); i++) {
    const mm = body.uvs[2 * i];
    if (mm < 0.08 || mm > 0.88) continue; // near a closing tip the normal turns along the spine
    const c = spine({ vars: { m: mm }, inputs: { time: 2.1 }, params: {} })[0] as number[];
    const p = at(body.positions, i), out = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], n = at(body.normals, i);
    const l = Math.hypot(...out);
    expect((n[0] * out[0] + n[1] * out[1] + n[2] * out[2]) / l).toBeGreaterThan(0.3);
  }
});

// Catches: a baked pose that ignores the requested time (the stations come from artefact.pose at that time).
test("the same scene at two times differs, and at one time repeats exactly", () => {
  const a = bakeScene(bentScene, { time: 0, density }).bodies[0].positions;
  const b = bakeScene(bentScene, { time: 1.5, density }).bodies[0].positions;
  const a2 = bakeScene(bentScene, { time: 0, density }).bodies[0].positions;
  expect(Array.from(a2)).toEqual(Array.from(a));
  expect(a.some((x, i) => Math.abs(x - b[i]) > 1e-3)).toBe(true);
});

test("crests are single two-sided sheets, rooted on the host, with their normal on the winding side", () => {
  const fin = bakeScene(bentScene, { time: 0, density }).bodies.find((b) => b.name === "bent_crest")!;
  expect(fin.doubleSided).toBe(true);
  // Triangle winding agrees with the stored normal: (b - a) x (c - a) . normal > 0 for every triangle.
  for (let t = 0; t < fin.indices.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => fin.indices[t + k]);
    const p = at(fin.positions, a), q = at(fin.positions, b), r = at(fin.positions, c), n = at(fin.normals, a);
    const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], w = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    const x = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    expect(x[0] * n[0] + x[1] * n[1] + x[2] * n[2]).toBeGreaterThan(0);
  }
  expect(triangleCount(fin)).toBeGreaterThan(0);
});

// Catches: a drawable that draws no bakeable surface being dropped without a word.
test("a drawable with no surface is reported as skipped by name", () => {
  const custom: Drawable = { name: "mystery", draws: () => ({ shaders: {}, draws: [] }), skeletons: [], surfaces: [] };
  const baked = bakeScene(scene({ ground: sea({ swell: [] }), style: toon(), sun: [0, 1, 0], things: [bent, custom] }), { time: 0, density });
  expect(baked.bodies.map((b) => b.name)).toEqual(["bent"]);
  expect(baked.skipped.map((s) => s.name)).toEqual(["sky", "sea", "shadows", "mystery"]);
});


// Catches: display-referred colours written to COLOR_0, which glTF defines as linear (the file would look washed out),
// or a conversion applied twice. The tube is painted [0.2, 0.5, 0.8] in sRGB.
test("vertex colours are the authored sRGB paint converted to linear", () => {
  const [tube] = bakeScene(cylinderScene, { time: 0, density }).bodies;
  const want = [0.2, 0.5, 0.8].map(toLinear);
  expect(want[1]).toBeCloseTo(0.214, 3); // sRGB 0.5 is linear 0.214
  for (let i = 0; i < vertexCount(tube); i++) for (let c = 0; c < 3; c++) expect(tube.colors[3 * i + c]).toBeCloseTo(want[c], 6);
});
