// The sampled schedules of draw.field on the CPU: the distance brick's lookup (src/map/brick.ts), the classification
// that decides whether a field may be sampled at all, and the mesh extracted from the brick (src/map/nets.ts). What
// each test would catch is said at the test.
import { expect, test } from "bun:test";
import { add, bound, compileJs, draw, input, min, mul, param, scene, sea, sub, time, toon, variable, vec3, type F, type P3 } from "../src/index.ts";
import { bakeScene, writeGlb } from "../src/bake/index.ts";
import { bakeBrick, varianceOf, type Brick } from "../src/map/brick.ts";
import { surfaceNets, type TriangleMesh } from "../src/map/nets.ts";
import { fold3, kifs, sdBox3, sdSphere } from "../src/lib/index.ts";
import { rng } from "./lib.harness.ts";

const P = variable("p", "vec3");
type V3 = [number, number, number];
const cpuOf = (d: F) => {
  const run = compileJs([d]);
  return (x: number, y: number, z: number) => run({ vars: { p: [x, y, z] }, inputs: {}, params: {} })[0] as number;
};

/** A folded field: three kaleidoscopic levels of a mirrored sphere, its distance carried back by the fold's stretch. */
const fold = kifs({ count: 3, fold: fold3.mirror(0), scale: 2, offset: [1, 0.5, 0] });
const FIELDS: { name: string; d: F; box: { min: V3; max: V3 } }[] = [
  { name: "sphere", d: sdSphere(sub(P, vec3(0.1, 0.2, -0.1)), 1), box: { min: [-1.2, -1, -1.3], max: [1.3, 1.4, 1.1] } },
  { name: "box", d: sdBox3(sub(P, vec3(0.05, -0.1, 0.15)), vec3(0.65, 0.55, 0.7)), box: { min: [-1, -1, -1], max: [1, 1, 1.1] } },
  { name: "folded", d: (() => { const g = fold(P); return g.toWorld(sdSphere(g.x, 0.9)); })(), box: { min: [-1.6, -1.6, -1.6], max: [1.6, 1.6, 1.6] } },
];
const brickOf = (f: (typeof FIELDS)[number], cells: number): Brick => {
  const diag = Math.hypot(...f.box.max.map((x, i) => x - f.box.min[i]!));
  const cell = diag / cells;
  return bakeBrick(`t_${f.name}`, f.d, "p", { tag: () => 0, box: f.box, cell, band: cell });
};

// Catches: a lookup that interpolates the samples (trilinear exceeds a distance by up to half a cell diagonal across a
// thin part, and the march then steps through it), a sample filled by a bound that is not conservative (a skipped
// cube's interior), a wrong sign inside, off-by-one cell or corner indexing, and an empty coarse cell whose stored bound
// is not one. Stated errors: below the field by at most a cell diagonal within the band; never above it outside the
// solid beyond f32 rounding (1e-5 relative); in a coarse cell without a brick at least the band.
test("the brick's lookup is a lower bound of the field outside the solid, within a cell diagonal of it near the surface", () => {
  for (const f of FIELDS) {
    const b = brickOf(f, 96);
    const field = cpuOf(f.d);
    const r = rng(17);
    let above = 0, near = 0, worstNear = 0, inside = 0;
    for (let s = 0; s < 40000; s++) {
      const p: V3 = [0, 1, 2].map((a) => f.box.min[a]! + r() * (f.box.max[a]! - f.box.min[a]!)) as V3;
      const d = field(...p), l = b.lower(p);
      if (d >= 0 && l > d + 1e-5 * (1 + Math.abs(d))) above++;
      if (d < 0 && l >= 0) inside++;
      if (Math.abs(d) < b.band) { near++; worstNear = Math.max(worstNear, d - l); }
    }
    console.log(`brick ${f.name}: ${b.stats.evaluations} evaluations, ${b.stats.bricks} bricks of ${b.stats.coarse} cells; ${near} samples near the surface, worst shortfall ${(worstNear / b.cell).toFixed(3)} cells`);
    expect([f.name, above, inside]).toEqual([f.name, 0, 0]);
    expect(near).toBeGreaterThan(100);
    expect(worstNear).toBeLessThanOrEqual(b.error + 1e-6);
  }
});

// Catches: a field that reads time, an input or a param baked as if it never changed (it would freeze), and a static
// field refused (it would never get the cheap schedules). The classification is by the expression's leaves.
test("a field that reads time, an input or a param changes; one that does not is static", () => {
  const ball = sdSphere(P, 1);
  expect(varianceOf(ball).kind).toBe("static");
  const moving = varianceOf(sdSphere(sub(P, vec3(mul(time, 0.5), 0, 0)), 1));
  expect(moving).toEqual({ kind: "changing", reads: ['input "time"'] });
  expect(varianceOf(add(ball, input("t.bulge", "f32", [0]))).kind).toBe("changing");
  expect(varianceOf(add(ball, param("t.radius", 0.2))).kind).toBe("changing");
});

/** Every undirected edge and how many triangles use it. */
function edgeUse(m: TriangleMesh): Map<string, number> {
  const use = new Map<string, number>();
  for (let t = 0; t < m.indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = m.indices[t + k]!, b = m.indices[t + ((k + 1) % 3)]!;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      use.set(key, (use.get(key) ?? 0) + 1);
    }
  }
  return use;
}

// Catches: a hole (a crossing edge whose quad is dropped, a vertex missing on a brick's face), a doubled face, a
// winding that faces in (the mesh is drawn with back faces culled, so it would vanish), and vertices left off the
// surface (the Newton step skipped or pointed the wrong way). Stated tolerance: |field| at a vertex below 2% of a cell.
test("the extracted mesh is closed, faces out, and its vertices lie on the surface", () => {
  for (const f of FIELDS) {
    const b = brickOf(f, 96);
    const field = cpuOf(f.d);
    const m = surfaceNets(b, field);
    const tris = m.indices.length / 3, verts = m.positions.length / 3;
    const open = [...edgeUse(m).values()].filter((n) => n !== 2).length;
    let worst = 0, inward = 0;
    for (let v = 0; v < verts; v++) worst = Math.max(worst, Math.abs(field(m.positions[v * 3]!, m.positions[v * 3 + 1]!, m.positions[v * 3 + 2]!)));
    for (let t = 0; t < m.indices.length; t += 3) {
      const [a, bb, c] = [0, 1, 2].map((k) => m.indices[t + k]!);
      const at = (i: number, k: number) => m.positions[i * 3 + k]!;
      const u = [0, 1, 2].map((k) => at(bb!, k) - at(a!, k)), w = [0, 1, 2].map((k) => at(c!, k) - at(a!, k));
      const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
      const vn = [0, 1, 2].map((k) => m.normals[a! * 3 + k]! + m.normals[bb! * 3 + k]! + m.normals[c! * 3 + k]!);
      if (n[0]! * vn[0]! + n[1]! * vn[1]! + n[2]! * vn[2]! <= 0) inward++;
    }
    console.log(`mesh ${f.name}: ${verts} vertices, ${tris} triangles, ${open} edges not shared by two, ${inward} facing in, worst |field| ${(worst / b.cell).toFixed(4)} cells`);
    expect(tris).toBeGreaterThan(500);
    expect([f.name, open]).toEqual([f.name, 0]);
    expect(inward).toBeLessThan(tris * 0.01);
    expect(worst).toBeLessThan(0.02 * b.cell);
  }
});

// Catches: a meshed field the baker skips (bakeable as a surface only) or bakes with the wrong paint or an open body.
test("a field drawn as a mesh bakes to a closed body painted at its vertices", () => {
  const c = vec3(0, 1, 0);
  const ball = draw.field("ball", (p: P3) => min(sdSphere(sub(p, c), 0.8), sdSphere(sub(p, vec3(0.7, 1.2, 0)), 0.4)), {
    bounds: bound.box([-1, 0, -1], [1.3, 2, 1]), paint: ({ p }) => vec3(0.5, p.y.mul(0.5), 0.25), steps: 32, outline: "none", schedule: "mesh",
  });
  const baked = bakeScene(scene({ ground: sea({ swell: [] }), things: [ball], style: toon(), sun: [0, 1, 0] }), { time: 0, density: { along: 8, around: 8 } });
  expect(baked.skipped.map((s) => s.name)).not.toContain("ball");
  const body = baked.bodies[0]!;
  expect(body.closed).toBe(true);
  // Green is the paint's p.y / 2, converted to linear (glTF COLOR_0): the vertex's own height.
  const toLinear = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  let worst = 0;
  for (let v = 0; v < body.positions.length / 3; v++) worst = Math.max(worst, Math.abs(body.colors[v * 3 + 1]! - toLinear(body.positions[v * 3 + 1]! * 0.5)));
  expect(worst).toBeLessThan(1e-4);
  expect([...edgeUse({ positions: body.positions, normals: body.normals, indices: body.indices }).values()].every((n) => n === 2)).toBe(true);
  expect(writeGlb(baked).byteLength).toBeGreaterThan(body.positions.byteLength);
});
