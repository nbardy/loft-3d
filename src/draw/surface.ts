// draw.surface: one drawable for every `Surface` (DESIGN.md 7.4). A grid of `grid.u.count x grid.v.count` cells is
// evaluated in the vertex stage from the surface's own expressions (point and normal), optionally once per instance
// of a set of `Points`; the fragment stage evaluates the look per pixel. The surface coordinates (u, v) reach the
// fragment stage, so paint is a function of the surface's coordinates (body coordinates for a body).

import { add, cos, f, lib, mix, mul, replace, topo, variable, vec2, vec3, vec4, type Expr, type In, type LibFn, scopedName } from "../expr.ts";
import { emitShaderFn } from "../compile/bind.ts";
import { drawSpec, type Bakeable, type CompileContext, type DetailSpec, type Drawable, type DrawSpec, type Emitted, type Phase, type Shader, type V3 } from "../compile/context.ts";
import { boundTable, gridDetail } from "./grid_detail.ts";
import { carry, posesOf, rotate, sizeBound } from "../map/chart.ts";
import { framedPose } from "../map/surface.ts";
import type { Chart, F, P3, Paint, Points, Posed, Poses, Skeleton, Surface } from "../map/types.ts";
import { readsBody, type Style } from "../style.ts";
import { lit } from "../compile/scene_wgsl.ts";
import { fwidth } from "../lib/wgsl.ts";
import { sunDir } from "../sun.ts";
import { refuseSurface } from "../mistakes.ts";
import { SceneError } from "../errors.ts";

/** How a grid direction is sampled: `count` cells, the cell corner at s in [0, 1] going to the coordinate `at(s)`. */
export type Sampling = { readonly count: number; readonly at: (s: F) => F };
export type Grid = { readonly u: Sampling; readonly v: Sampling };

/** Ways to sample [0, 1]. Sampling is a reparametrisation (a warp of the domain): it moves vertices, not paint. */
export const spacing = {
  even: (count: number): Sampling => ({ count, at: (s) => s }),
  /** Crowded toward both ends (2.5x denser there at the default), where tips close fast. */
  ends: (count: number, crowd = 0.6): Sampling => ({ count, at: (s) => mix(s, mul(cos(mul(s, Math.PI)), -0.5).add(0.5), crowd) }),
  /** Even, from `start` to `start + 1` without wrapping (round a tube: a vertex on the line `start`, a seam that interpolates continuously). */
  from: (count: number, start: number): Sampling => ({ count, at: (s) => s.add(start) }),
};

/** What a glazed surface's colour may read in the fragment stage. */
export type Fragment = {
  readonly world: P3;
  /** Pixel position (`@builtin(position).xy`). */
  readonly px: Expr<"vec2">;
  readonly u: F;
  readonly v: F;
  readonly style: Style;
  /** Unit direction toward the sun: a literal, or an expression when the scene's sun is a host input. */
  readonly sun: In<"vec3">;
};

/** Ink: the surface pushed out along its normal and drawn back faces only (`hull`), ink along its v = 1 edge (`border`, for sheets), or none. */
export type Outline = "hull" | "border" | "none";

export type Look =
  /** Base colour from `paint`, lit by the scene's style (with underwater tint), opaque. */
  | { readonly kind: "lit"; readonly paint: Paint; readonly sides: "one" | "two"; readonly outline: Outline }
  /** `paint` as the final colour, unlit, opaque: strokes and ink lines. */
  | { readonly kind: "flat"; readonly paint: Paint }
  /** Its own colour and alpha, blended over what is behind it (the sea): no depth write. */
  | { readonly kind: "glazed"; readonly colour: GlazedColour; readonly phase: Extract<Phase, "water" | "on-water" | "transparent">; readonly sceneDepth: boolean; readonly detail: GlazedDetail };

/**
 * A glazed surface's colour: one program, or one of several chosen per pixel. `choose` gives the index of the case
 * (0 .. cases.length - 1) and must be the same on all four pixels of each 2 x 2 quad (`quadMax` makes a value so): then
 * every pixel a derivative inside a case reads ran that case too, and the derivative is what the case alone would give.
 * Only the chosen case runs, so a case may skip work the others need (the sea: src/geom/sea.ts).
 */
export type GlazedColour =
  | { readonly kind: "one"; readonly colour: (f: Fragment) => Expr<"vec4"> }
  | { readonly kind: "cases"; readonly choose: (f: Fragment) => Expr<"f32">; readonly cases: readonly ((f: Fragment) => Expr<"vec4">)[] };

/** A glazed surface's grid: as authored, or laid over the screen by the host (the sea). */
export type GlazedDetail = { readonly kind: "fixed" } | Extract<DetailSpec, { kind: "projected" }>;

/** One copy, or one per pose (points are poses with an even size). */
type Copies = { readonly kind: "one" } | { readonly kind: "poses"; readonly poses: Poses };

const S = variable("s", "f32"), T = variable("t", "f32"), I = variable("i", "f32");
const U = variable("u", "f32"), V = variable("v", "f32");
/** What paint is told besides (u, v), as the fragment stage binds it (`PaintAt`). */
const AT = { world: variable("p_world", "vec3"), normal: variable("p_normal", "vec3"), copy: variable("p_copy", "f32") };

/**
 * The `Drawable` that `draw.surface`, `draw.glazed` and `draw.curve` return: a (u, v) surface drawn as a grid in the
 * vertex stage. A scene author gets it from `draw`, not by constructing it.
 */
export class SurfaceDrawable implements Drawable {
  readonly skeletons: readonly Skeleton[];
  readonly surfaces: readonly Bakeable[];

  constructor(
    readonly name: string,
    readonly surface: Surface,
    readonly grid: Grid,
    readonly look: Look,
    readonly copies: Copies,
  ) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw new Error(`draw.surface "${name}": names must be identifiers (they name shaders)`);
    this.name = scopedName(name);
    // Refused here, by the user's name, before anything is built from them (src/mistakes.ts).
    refuseSurface(name, surface, grid, look, () => surface.point(U, V), look.kind === "glazed" ? undefined : () => look.paint(U, V, AT));
    if (look.kind === "lit" && look.sides === "two" && look.outline === "hull") throw new SceneError(`draw.surface "${name}"`, `sides "two" with outline "hull"`, "a hull outline only on a one-sided surface (it draws the back faces)", `outline: "border"`);
    this.skeletons = skeletonsOf(surface, copies);
    this.surfaces = bakeablesOf(this, copies);
  }

  /** The same surface and look, one copy per point. */
  instanced(name: string, points: Points): SurfaceDrawable {
    return new SurfaceDrawable(name, this.surface, this.grid, this.look, { kind: "poses", poses: posesOf(points) });
  }

  /** The same surface and look, one copy per pose: turned, and scaled along each axis (normals included). */
  posed(name: string, poses: Poses): SurfaceDrawable {
    return new SurfaceDrawable(name, this.surface, this.grid, this.look, { kind: "poses", poses });
  }

  /**
   * This drawable carried through a chart, for parts of something that is itself being placed there whole (the
   * serpent's fins and teeth, coiled into a whirlpool with it). Copies keep their shape: each copy's frame is carried
   * (placement acts on the skeleton). A single surface has no skeleton to carry, so its points are mapped through the
   * chart and its normals turned with the chart's frame: right for thin things riding a placed body (a fin), which
   * the chart bends with that body; a solid would be sheared (DESIGN.md 7.6), so place a body instead.
   */
  through(chart: Chart): SurfaceDrawable {
    return new SurfaceDrawable(this.name, carriedSurface(this.surface, this.copies, chart), this.grid, this.look, carriedCopies(this.copies, chart));
  }

  draws(ctx: CompileContext): Emitted {
    const key = `surface.${this.name}`;
    const vertex = vertexFn(ctx, this, `surf_${this.name}`);
    const frag = fragment(ctx, this);
    const instances = countOf(this.copies);
    const NU = this.grid.u.count, NV = this.grid.v.count;
    const detail = detailOf(ctx, this);
    const code = [
      cellsWgsl(detail, NU, NV),
      frag.overrides,
      `const ID: f32 = ${lit(nameId(this.name))};`,
      vertex.code, frag.fns.code,
      /* wgsl */ `
struct VOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) world: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
  @location(3) anchor: vec3<f32>,
  @location(4) @interpolate(flat) id: f32,
  @location(5) @interpolate(flat) copy: f32,
};
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let n = grid_cells(ii);
  let ij = vec2<u32>((vi / 6u) / n.y, (vi / 6u) % n.y) + quad_corner(vi % 6u);
  let s = surf_${this.name}(f32(ij.x) / f32(n.x), f32(ij.y) / f32(n.y), f32(ii));
  let p = ${frag.push};
  var out: VOut;
  out.clip = frame.view_proj * vec4<f32>(p, 1.0);
  out.world = p;
  out.normal = s.normal;
  out.uv = s.uv;
  out.anchor = s.anchor;
  out.id = copy_id(ID, ii);
  out.copy = f32(ii);
  return out;
}
${frag.main}`,
    ].join("\n");
    const base = { label: this.name, shader: key, vertices: 6 * NU * NV, instances, constants: constantsOf(detail, NU, NV), detail: detail.spec };
    const shader: Shader = { code, libs: [...vertex.libs, ...frag.fns.libs] };
    return { shaders: { [key]: shader }, draws: frag.draws(base) };
  }
}

/**
 * How a drawn surface's grid size is chosen: fixed at the authored counts, or by the host from the surface's size on
 * screen (lit surfaces: bodies, sheets, hulls, sails). Glazed surfaces (the sea's own grid is its business; markers and
 * smears on it) and flat strokes (whose grids carry structure, such as a ship's ropes joined by zero-width cells) stay
 * fixed.
 */
type SurfaceDetail = { readonly kind: "fixed" | "grid" | "projected"; readonly spec: DetailSpec };

function detailOf(ctx: CompileContext, d: SurfaceDrawable): SurfaceDetail {
  switch (d.look.kind) {
    case "lit": {
      const at = { u: d.grid.u.at, v: d.grid.v.at };
      const bound = boundTable(d.name, d.surface, at, d.copies);
      ctx.table(bound);
      return { kind: "grid", spec: gridDetail(bound, d.surface, at, d.copies, d.grid.u.count, d.grid.v.count) };
    }
    case "flat": return { kind: "fixed", spec: { kind: "fixed" } };
    case "glazed": return d.look.detail.kind === "fixed" ? { kind: "fixed", spec: d.look.detail } : { kind: "projected", spec: d.look.detail };
  }
}
/** `fn grid_cells(ii) -> vec2<u32>`: the cell counts this instance is drawn with. */
function cellsWgsl(d: SurfaceDetail, nu: number, nv: number): string {
  switch (d.kind) {
    case "fixed": return `override NU: u32 = ${nu}u;\noverride NV: u32 = ${nv}u;\nfn grid_cells(ii: u32) -> vec2<u32> { return vec2<u32>(NU, NV); }`;
    case "grid": return `override LOFT_DETAIL_SLOT: u32 = 0u;\nfn grid_cells(ii: u32) -> vec2<u32> { return vec2<u32>(loft_detail[LOFT_DETAIL_SLOT + ii].xy); }`;
    case "projected": return `override LOFT_DETAIL_SLOT: u32 = 0u;\nfn grid_cells(ii: u32) -> vec2<u32> { return vec2<u32>(loft_detail[LOFT_DETAIL_SLOT].xy); }`;
  }
}
function constantsOf(d: SurfaceDetail, nu: number, nv: number): Readonly<Record<string, number>> {
  switch (d.kind) {
    case "fixed": return { NU: nu, NV: nv };
    case "grid": case "projected": return {};
  }
}

const countOf = (c: Copies): number => {
  switch (c.kind) {
    case "one": return 1;
    case "poses": return c.poses.count;
  }
};

function carriedSurface(s: Surface, c: Copies, chart: Chart): Surface {
  switch (c.kind) {
    case "one": return {
      point: (u, v) => chart.frame(s.point(u, v)).o,
      normal: (u, v) => rotate(chart.frame(s.point(u, v)), s.normal(u, v)),
      anchor: s.anchor, // carried, not moved: its pattern rides it
      topology: s.topology,
      skeleton: { joints: s.skeleton.joints, joint: (k) => { const j = s.skeleton.joint(k); return { p: chart.frame(j.p).o, r: j.r }; } },
    };
    case "poses": return s; // the copies' frames are carried instead
  }
}
function carriedCopies(c: Copies, chart: Chart): Copies {
  switch (c.kind) {
    case "one": return c;
    case "poses": {
      const ps = c.poses;
      return { kind: "poses", poses: { count: ps.count, at: (i) => { const a = ps.at(i); return { frame: carry(chart, a.frame), size: a.size }; } } };
    }
  }
}

function skeletonsOf(s: Surface, c: Copies): readonly Skeleton[] {
  switch (c.kind) {
    case "one": return [s.skeleton];
    // Each copy casts with the surface's own chain carried by its placement (copies used not to cast at all, so a
    // fleet of instanced ships or a ring of spikes left no shadow on the water).
    case "poses": return s.skeleton.joints < 2 ? [] : Array.from({ length: c.poses.count }, (_, i) => {
      const at = c.poses.at(f(i));
      return { joints: s.skeleton.joints, joint: (k: number) => posedJoint(s.skeleton.joint(k), at) };
    });
  }
}

/** A joint of a copy's chain carried by its pose. A radius under a per-axis size takes the largest axis (conservative). */
function posedJoint(j: { readonly p: P3; readonly r: F }, at: Posed): { readonly p: P3; readonly r: F } {
  const z = at.size;
  switch (z.kind) {
    case "even": return { p: add(at.frame.o, mul(rotate(at.frame, j.p), z.k)), r: mul(j.r, z.k) };
    case "axes": return { p: add(at.frame.o, rotate(at.frame, mul(j.p, z.k))), r: mul(j.r, sizeBound(z)) };
  }
}

function bakeablesOf(d: SurfaceDrawable, c: Copies): readonly Bakeable[] {
  const look = d.look;
  switch (look.kind) {
    case "glazed": return []; // its colour reads the camera and the scene's depth: there is nothing to bake
    case "lit": return copiesOf(d, c, look.paint, look.sides);
    case "flat": return []; // flat surfaces are strokes facing the camera: they have no shape to bake
  }
}
function copiesOf(d: SurfaceDrawable, c: Copies, paint: Paint, sides: "one" | "two"): readonly Bakeable[] {
  switch (c.kind) {
    case "one": return [{ name: d.name, surface: d.surface, paint, grid: d.grid, sides, copy: 0 }];
    case "poses": return Array.from({ length: c.poses.count }, (_, i) => ({ name: `${d.name}_${i}`, surface: framedPose(d.surface, c.poses.at(f(i))), paint, grid: d.grid, sides, copy: i }));
  }
}

/** `fn <name>(s, t, i) -> SurfV`: grid corner (s, t) of instance i to a world point, normal and (u, v). */
function vertexFn(ctx: CompileContext, d: SurfaceDrawable, name: string): Shader {
  const u = d.grid.u.at(S), v = d.grid.v.at(T);
  const s = placedSurface(d.surface, d.copies);
  const normal = vertexNormal(d.look, s, u, v);
  // Only for a style that reads it: a body's anchor fetches its stations again, which toon would pay for nothing.
  const anchor = readsBody(ctx.style) ? s.anchor(u, v) : vec3(0, 0, 0);
  return emitShaderFn(ctx.slots, {
    name, args: [["s", "f32"], ["t", "f32"], ["i", "f32"]], out: "SurfV",
    roots: [s.point(u, v), normal, vec2(u, v), anchor], ret: (o) => `SurfV(${o.join(", ")})`,
  });
}

/** A glazed surface's colour does not read the vertex normal, so it is not computed. */
function vertexNormal(look: Look, s: Surface, u: F, v: F): P3 {
  switch (look.kind) {
    case "lit": case "flat": return s.normal(u, v);
    case "glazed": return vec4(0, 0, 0, 0).xyz;
  }
}

function placedSurface(s: Surface, c: Copies): Surface {
  switch (c.kind) {
    case "one": return s;
    case "poses": return framedPose(s, c.poses.at(I));
  }
}

type Base = Pick<DrawSpec, "label" | "shader" | "vertices" | "instances" | "constants" | "detail">;
type Frag = { readonly overrides: string; readonly fns: Shader; readonly push: string; readonly main: string; readonly draws: (b: Base) => DrawSpec[] };

const LIT_PRE = /* wgsl */ `
  let eye = -view_dir(in.world);
  let depth = sea_height(in.world.xz) - in.world.y;`;

function fragment(ctx: CompileContext, d: SurfaceDrawable): Frag {
  const look = d.look;
  const paintFn = (paint: Paint): Shader => emitShaderFn(ctx.slots, {
    name: `paint_${d.name}`, args: [["u", "f32"], ["v", "f32"], ["p_world", "vec3"], ["p_normal", "vec3"], ["p_copy", "f32"]], out: "vec3<f32>", roots: [paint(U, V, AT)], ret: (o) => o[0],
  });
  switch (look.kind) {
    case "lit": {
      const face = look.sides === "one" ? "1.0" : "select(-1.0, 1.0, front)";
      const head = `@fragment fn fs(in: VOut, @builtin(front_facing) front: bool) -> @location(0) vec4<f32> {
  let n = ${face} * normalize(in.normal);${LIT_PRE}
  let base = paint_${d.name}(in.uv.x, in.uv.y, in.world, n, in.copy);`;
      const cull = look.sides === "one" ? "back" : "none";
      switch (look.outline) {
        case "hull": return hullOutline(ctx, head, paintFn(look.paint), cull);
        case "border": return {
          overrides: "", fns: paintFn(look.paint), push: "s.pos",
          // Ink along the v = 1 edge, in the surface's own coordinates: about two pixels wide at any distance.
          main: `${head}
  let fw = fwidth(in.uv.y);
  let edge = 1.0 - smoothstep(fw * 1.0, fw * 2.2, 1.0 - in.uv.y);
  return vec4<f32>(mix(shade(base, n, eye, in.world, depth, in.uv, in.anchor, in.id), ink(base, n, eye, in.world, depth, in.uv, in.anchor, in.id), edge), ${ctx.markOut("mark(base, n, eye, in.world, depth, in.uv, in.anchor, in.id)", false)});
}`,
          draws: (b) => [drawSpec({ ...b, cull })],
        };
        case "none": return {
          overrides: "", fns: paintFn(look.paint), push: "s.pos",
          main: `${head}
  return vec4<f32>(shade(base, n, eye, in.world, depth, in.uv, in.anchor, in.id), ${ctx.markOut("mark(base, n, eye, in.world, depth, in.uv, in.anchor, in.id)", false)});
}`,
          draws: (b) => [drawSpec({ ...b, cull })],
        };
      }
    }
    case "flat": return {
      overrides: "", fns: paintFn(look.paint), push: "s.pos",
      main: `@fragment fn fs(in: VOut) -> @location(0) vec4<f32> { return vec4<f32>(paint_${d.name}(in.uv.x, in.uv.y, in.world, normalize(in.normal), in.copy), 1.0); }`,
      draws: (b) => [drawSpec({ ...b, cull: "none" })],
    };
    case "glazed": {
      const draws = (b: Base): DrawSpec[] => [drawSpec({ ...b, phase: look.phase, cull: "none", depthWrite: false, blend: "alpha", sceneDepth: look.sceneDepth })];
      return { overrides: "", push: "s.pos", ...glazedColour(ctx, d.name, look.colour), draws };
    }
  }
}

const GLAZED_ARGS = [["f_world", "vec3"], ["f_px", "vec2"], ["u", "f32"], ["v", "f32"]] as const;
const GLAZED_CALL = "(in.world, in.clip.xy, in.uv.x, in.uv.y)";

/** The fragment stage of a glazed surface: its colour function(s), and `fs`. */
function glazedColour(ctx: CompileContext, name: string, colour: GlazedColour): Pick<Frag, "fns" | "main"> {
  const W = variable("f_world", "vec3"), PX = variable("f_px", "vec2");
  const fr: Fragment = { world: W, px: PX, u: U, v: V, style: ctx.style, sun: sunDir(ctx.sunAt) };
  const fn = (fname: string, root: Expr): Shader => emitShaderFn(ctx.slots, { name: fname, args: GLAZED_ARGS, out: root.ty === "f32" ? "f32" : "vec4<f32>", roots: [root], ret: (o) => o[0]! });
  switch (colour.kind) {
    case "one": return {
      fns: fn(`colour_${name}`, colour.colour(fr)),
      main: `@fragment fn fs(in: VOut) -> @location(0) vec4<f32> { return colour_${name}${GLAZED_CALL}; }`,
    };
    case "cases": {
      const n = colour.cases.length;
      if (n < 2) throw new Error(`draw.surface "${name}": a glazed colour in cases needs at least two, got ${n}`);
      const choose = fn(`choose_${name}`, colour.choose(fr));
      const cases = colour.cases.map((c, k) => quadDerivatives(`colour_${name}_${k}`, fn(`colour_${name}_${k}`, quadSafe(c(fr)))));
      const libs = [...new Set([...choose.libs, ...cases.flatMap((c) => c.libs)])];
      const arms = cases.map((_, k) => `    ${k === n - 1 ? `case ${k}u, default` : `case ${k}u`}: { return colour_${name}_${k}${GLAZED_CALL}; }`);
      return {
        fns: { code: [choose.code, ...cases.map((c) => c.code)].join("\n"), libs },
        // The case is the same on each 2 x 2 quad (GlazedColour), so the branch is uniform where derivatives are taken.
        main: `@fragment fn fs(in: VOut) -> @location(0) vec4<f32> {
  switch u32(choose_${name}${GLAZED_CALL}) {
${arms.join("\n")}
  }
}`,
      };
    }
  }
}

/** The same colour reading a changed fragment (a mirrored surface reads u flipped). */
export function withFragment(c: GlazedColour, g: (f: Fragment) => Fragment): GlazedColour {
  switch (c.kind) {
    case "one": return { kind: "one", colour: (f) => c.colour(g(f)) };
    case "cases": return { kind: "cases", choose: (f) => c.choose(g(f)), cases: c.cases.map((k) => (f: Fragment) => k(g(f))) };
  }
}

/** `fwidth` for a case of a glazed colour: the same, with WGSL's uniformity diagnostic off (GlazedColour says why). */
const FWIDTH = (fwidth(variable("x", "f32")).node as Extract<Expr["node"], { op: "lib" }>).fn;
const FWIDTH_QUAD: LibFn = { name: "loft_fwidth_quad", ret: "f32", wgsl: "@diagnostic(off, derivative_uniformity) fn loft_fwidth_quad(x: f32) -> f32 { return fwidth(x); }", js: "gpu-only" };
const DERIVATIVE = /\b(fwidth|dpdx|dpdy)(Fine|Coarse)?\s*\(/;
const QUAD_COVERED = /@diagnostic\(off,\s*derivative_uniformity\)/;

/** A case's colour with every `fwidth` replaced by FWIDTH_QUAD. */
function quadSafe(root: Expr<"vec4">): Expr<"vec4"> {
  const by = new Map<number, Expr>();
  for (const e of topo([root])) if (e.node.op === "lib" && e.node.fn === FWIDTH) by.set(e.id, lib<"f32">(FWIDTH_QUAD, ...e.node.args));
  return replace([root], by)[0] as Expr<"vec4">;
}

/** A case's function as emitted, refused if it still reaches a derivative WGSL would reject in a branch. */
function quadDerivatives(name: string, s: Shader): Shader {
  // A library function that turns the diagnostic off for itself has said its derivatives are of values every pixel of
  // the quad computes (FWIDTH_QUAD; the sea's contact level): it is covered.
  const reaches = (l: LibFn): boolean => !QUAD_COVERED.test(l.wgsl) && (DERIVATIVE.test(l.wgsl) || (l.deps ?? []).some(reaches));
  const bad = s.libs.filter(reaches).map((l) => l.name);
  if (bad.length > 0 || /\bloft_fwidth\(/.test(s.code)) throw new Error(`draw.surface: case function "${name}" takes a derivative quadSafe does not cover (${bad.join(", ") || "loft_fwidth in a loop"}); give it a quad-safe twin`);
  return s;
}

/** A closed surface's ink: a second draw pushed out along the normal (hull), or a flag for the screen pass. */
function hullOutline(ctx: CompileContext, head: string, paint: Shader, cull: DrawSpec["cull"]): Frag {
  switch (ctx.outline) {
    case "hull": return {
      overrides: "override INK: f32 = 0.0;", fns: paint, push: "s.pos + s.normal * (INK * ink_width(s.pos))",
      // INK is an override, so this branch is uniform (the style's shading takes screen-space derivatives), and the
      // outline pass does not pay for the shading it would throw away.
      main: `${head}
  let mk = mark(base, n, eye, in.world, depth, in.uv, in.anchor, in.id);
  if (INK > 0.5) { return vec4<f32>(ink(base, n, eye, in.world, depth, in.uv, in.anchor, in.id), mk); }
  return vec4<f32>(shade(base, n, eye, in.world, depth, in.uv, in.anchor, in.id), mk);
}`,
      draws: (b) => [
        drawSpec({ ...b, cull, constants: { ...b.constants, INK: 0 } }),
        drawSpec({ ...b, label: `${b.label} outline`, cull: "front", constants: { ...b.constants, INK: 1 } }),
      ],
    };
    case "screen": return {
      overrides: "", fns: paint, push: "s.pos",
      main: `${head}
  return vec4<f32>(shade(base, n, eye, in.world, depth, in.uv, in.anchor, in.id), ${ctx.markOut("mark(base, n, eye, in.world, depth, in.uv, in.anchor, in.id)", true)});
}`,
      draws: (b) => [drawSpec({ ...b, cull })],
    };
  }
}

/** Options for a lit surface. */
export type SurfaceOptions = { readonly paint: Paint; readonly grid: Grid; readonly sides: "one" | "two"; readonly outline: Outline };

/** A surface, lit by the scene's style. */
export function drawSurface(name: string, surface: Surface, o: SurfaceOptions): SurfaceDrawable {
  return new SurfaceDrawable(name, surface, o.grid, { kind: "lit", paint: o.paint, sides: o.sides, outline: o.outline }, { kind: "one" });
}

/** A surface with its own colour and alpha over what is behind it (the sea; a decal surface). */
export function drawGlazed(name: string, surface: Surface, o: { readonly colour: ((f: Fragment) => Expr<"vec4">) | GlazedColour; readonly grid: Grid; readonly phase: Extract<Phase, "water" | "on-water" | "transparent">; readonly sceneDepth: boolean; readonly detail?: GlazedDetail }): SurfaceDrawable {
  const colour: GlazedColour = typeof o.colour === "function" ? { kind: "one", colour: o.colour } : o.colour;
  return new SurfaceDrawable(name, surface, o.grid, { kind: "glazed", colour, phase: o.phase, sceneDepth: o.sceneDepth, detail: o.detail ?? { kind: "fixed" } }, { kind: "one" });
}

/** A surface whose paint is its final colour (a stroke, an ink line). */
export function drawFlat(name: string, surface: Surface, o: { readonly paint: Paint; readonly grid: Grid }): SurfaceDrawable {
  return new SurfaceDrawable(name, surface, o.grid, { kind: "flat", paint: o.paint }, { kind: "one" });
}


/** A stable identity in [0, 1) for a drawable, from its name (FNV-1a): the same body gets the same patterns everywhere. */
export function nameId(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193) >>> 0;
  return (h >>> 8) / 16777216;
}
