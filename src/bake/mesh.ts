// bakeScene: evaluate a scene at one time into plain triangle meshes, one per surface it draws.
//
// Any `Surface` bakes the same way: its expressions (point, normal, paint) are sampled on the CPU on the grid its
// drawable draws it on (the same spacing, so baked rings sit where drawn ones do), over the tables the pose pass
// fills at that time. The surfaces are found through the scene's own structure (`Drawable.surfaces`); the surface's
// topology says how the grid closes: periodic edges are seams, poles collapse a row to a point, caps get a flat disc.
// Triangles wind counter-clockwise seen from the side d/du x d/dv points to, which is the side its normal faces.

import { compileScene, type CpuFn } from "../compile/index.ts";
import type { MeshBakeable, SurfaceBakeable } from "../compile/context.ts";
import { f, variable, type Expr } from "../expr.ts";
import type { End, Topology } from "../map/types.ts";
import type { Scene } from "../scene.ts";

export type Density = { readonly along: number; readonly around: number };
export type BakeOptions = { readonly time: number; readonly density: Density };

export type BodyMesh = {
  readonly name: string;
  /** A closed solid (every edge shared by two triangles), or a sheet (two-sided in the file's material). */
  readonly closed: boolean;
  readonly doubleSided: boolean;
  readonly positions: Float32Array; // xyz
  readonly normals: Float32Array; // xyz, unit
  readonly uvs: Float32Array; // the surface's own (u, v): body coordinates (m, v) for a body
  readonly colors: Float32Array; // linear rgb in [0, 1] (glTF COLOR_0 is linear)
  readonly indices: Uint32Array; // counter-clockwise seen from the normal side
};
export type Skipped = { readonly name: string; readonly reason: string };
export type Baked = { readonly time: number; readonly bodies: readonly BodyMesh[]; readonly skipped: readonly Skipped[] };

export const vertexCount = (b: BodyMesh): number => b.positions.length / 3;
export const triangleCount = (b: BodyMesh): number => b.indices.length / 3;

/** sRGB (display-referred, as Loft authors colour) to linear, per channel (IEC 61966-2-1). */
export const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

type Vertex = { readonly pos: readonly number[]; readonly normal: readonly number[]; readonly uv: readonly [number, number]; readonly colour: readonly number[] };

class Builder {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly uv: number[] = [];
  private readonly col: number[] = [];
  private readonly idx: number[] = [];
  constructor(private readonly name: string) {}

  vertex(v: Vertex): number {
    const all = [...v.pos, ...v.normal, ...v.uv, ...v.colour];
    // A NaN here would reach the file and fail in someone else's viewer; fail where the surface is known instead.
    if (all.some((x) => !Number.isFinite(x))) throw new Error(`bake: surface "${this.name}" evaluated to a non-finite vertex (${all.join(", ")})`);
    const n = this.pos.length / 3;
    this.pos.push(...v.pos);
    this.nrm.push(...v.normal);
    this.uv.push(...v.uv);
    this.col.push(...v.colour.map((c) => toLinear(Math.min(1, Math.max(0, c)))));
    return n;
  }
  triangle(a: number, b: number, c: number): void { this.idx.push(a, b, c); }

  finish(closed: boolean, doubleSided: boolean): BodyMesh {
    return {
      name: this.name, closed, doubleSided,
      positions: Float32Array.from(this.pos), normals: Float32Array.from(this.nrm), uvs: Float32Array.from(this.uv),
      colors: Float32Array.from(this.col), indices: Uint32Array.from(this.idx),
    };
  }
}

const isClosed = (t: Topology): boolean => t.v === "periodic" && (t.u === "periodic" || t.u.every((e) => e !== "free"));
const endsOf = (t: Topology): readonly [End, End] => (t.u === "periodic" ? ["free", "free"] : t.u);

const U = variable("u", "f32"), W = variable("v", "f32");

/** One surface: a (rows + 1) x (cols + 1) grid of samples, its pole rows collapsed and its cap ends closed. */
function bakeSurface(s: SurfaceBakeable, cpu: (roots: readonly Expr[]) => CpuFn, frame: Parameters<CpuFn>[0], d: Density): BodyMesh {
  const p = s.surface.point(U, W), n = s.surface.normal(U, W);
  const run = cpu([p, n, s.paint(U, W, { world: p, normal: n, copy: f(s.copy) })]);
  const uAt = cpu([s.grid.u.at(U)]), vAt = cpu([s.grid.v.at(W)]);
  const rows = d.along, cols = d.around;
  const us = Array.from({ length: rows + 1 }, (_, i) => uAt(frame, { u: i / rows })[0] as number);
  const vs = Array.from({ length: cols + 1 }, (_, j) => vAt(frame, { v: j / cols })[0] as number);
  const b = new Builder(s.name);
  const sample = (u: number, v: number): Vertex => {
    const [pos, normal, colour] = run(frame, { u, v }) as number[][];
    return { pos, normal, uv: [u, v], colour };
  };
  const at: number[][] = us.map((u) => vs.map((v) => b.vertex(sample(u, v))));
  const [first, last] = endsOf(s.surface.topology);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = at[i][j], bb = at[i + 1][j], c = at[i + 1][j + 1], e = at[i][j + 1];
      // A pole at u = 0 makes a = e, so (a, c, e) is the degenerate one; at u = 1, bb = c, so (a, bb, c) is.
      if (!(last === "pole" && i === rows - 1)) b.triangle(a, bb, c);
      if (!(first === "pole" && i === 0)) b.triangle(a, c, e);
    }
  }
  const cap = (end: 0 | 1): void => {
    const u = us[end === 0 ? 0 : rows];
    // The ring without its seam duplicate when v is periodic.
    const ring = vs.slice(0, s.surface.topology.v === "periodic" ? cols : cols + 1).map((v) => sample(u, v));
    const centre = [0, 1, 2].map((k) => ring.reduce((t, r) => t + r.pos[k], 0) / ring.length);
    // Newell's normal of the ring, turned to face out of the solid: along +d/du at u = 1, -d/du at u = 0.
    const nw = [0, 0, 0];
    ring.forEach((p, j) => {
      const q = ring[(j + 1) % ring.length];
      nw[0] += (p.pos[1] - q.pos[1]) * (p.pos[2] + q.pos[2]);
      nw[1] += (p.pos[2] - q.pos[2]) * (p.pos[0] + q.pos[0]);
      nw[2] += (p.pos[0] - q.pos[0]) * (p.pos[1] + q.pos[1]);
    });
    const inner = sample(us[end === 0 ? 1 : rows - 1], vs[0]).pos;
    const outward = [0, 1, 2].map((k) => ring[0].pos[k] - inner[k]);
    const flip = nw[0] * outward[0] + nw[1] * outward[1] + nw[2] * outward[2] < 0;
    const l = Math.hypot(...nw) * (flip ? -1 : 1);
    const normal = nw.map((x) => x / l);
    const rim = ring.map((r) => b.vertex({ ...r, normal }));
    const mid = b.vertex({ pos: centre, normal, uv: [u, 0], colour: ring[0].colour });
    rim.forEach((p, j) => {
      const q = rim[(j + 1) % rim.length];
      // Newell's normal follows the ring's order: (mid, p, q) faces it, so flipping the normal flips the fan.
      if (flip) b.triangle(mid, q, p); else b.triangle(mid, p, q);
    });
  };
  if (first === "cap") cap(0);
  if (last === "cap") cap(1);
  return b.finish(isClosed(s.surface.topology), s.sides === "two");
}

const MP = variable("bake_p", "vec3"), MN = variable("bake_n", "vec3");

/** A triangle mesh (a field's): its own vertices, normals and triangles, the paint evaluated at each vertex. */
function bakeMesh(m: MeshBakeable, cpu: (roots: readonly Expr[]) => CpuFn, frame: Parameters<CpuFn>[0]): BodyMesh {
  const run = cpu([m.paint({ p: MP, normal: MN })]);
  const b = new Builder(m.name);
  const { positions: P, normals: N, indices } = m.mesh;
  for (let i = 0; i < P.length / 3; i++) {
    const pos = [P[i * 3]!, P[i * 3 + 1]!, P[i * 3 + 2]!], normal = [N[i * 3]!, N[i * 3 + 1]!, N[i * 3 + 2]!];
    const colour = run(frame, { bake_p: pos, bake_n: normal })[0] as number[];
    // A mesh has no surface coordinates; its uvs are 0.
    b.vertex({ pos, normal, uv: [0, 0], colour });
  }
  for (let t = 0; t < indices.length; t += 3) b.triangle(indices[t]!, indices[t + 1]!, indices[t + 2]!);
  return b.finish(true, false);
}

export function bakeScene(scene: Scene, options: BakeOptions): Baked {
  const { time, density } = options;
  if (!Number.isFinite(time)) throw new Error(`bake: time must be a finite number, got ${time}`);
  if (!(Number.isInteger(density.along) && density.along >= 2)) throw new Error(`bake: density.along must be an integer >= 2, got ${density.along}`);
  if (!(Number.isInteger(density.around) && density.around >= 3)) throw new Error(`bake: density.around must be an integer >= 3, got ${density.around}`);
  const c = compileScene(scene);
  const a = c.artefact;
  // The frame state the host would build: time, and every other input and parameter at its default.
  const inputs = new Float32Array(Math.max(1, a.inputFloats));
  for (const s of a.inputs) inputs.set(s.name === "time" ? [time] : s.def, s.slot);
  const frame = c.frame({ time, inputs, params: Float32Array.from(a.params.map((p) => p.def)), curves: a.curves });
  // The two kinds of bakeable are told apart by their `mesh` member (compile/context.ts).
  const bodies = scene.things.flatMap((t) => t.surfaces.map((s) => ("mesh" in s ? bakeMesh(s, c.cpu, frame) : bakeSurface(s, c.cpu, frame, density))));
  const skipped = scene.things.filter((t) => t.surfaces.length === 0).map((t) => ({ name: t.name, reason: "draws no surface that can be evaluated on the CPU" }));
  return { time, bodies, skipped };
}
