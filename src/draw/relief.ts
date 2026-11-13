// draw.relief: relief shell-traced on a surface, in the surface's own coordinates (docs/folding_and_tracing.md 3.3).
//
// The vertex stage draws the surface lifted to the top of a thin shell (`hMax` plus the ink width) and hands the
// fragment stage the surface's point, tangents, normal and normal derivatives there (src/relief/displace.ts,
// `shellFrame`, by differentiating the surface's own expressions). The fragment stage marches the view ray down through
// the shell in the surface's (u, v, height) coordinates until it meets the height function (src/relief/trace.ts),
// writes the hit's depth, and lights it with the height function's normal. Rays that miss are discarded, so spikes and
// scales have real silhouettes; rays that pass within the ink width are the silhouette's ink (the strand's inverted
// hull would outline the shell, not the relief). The march's sample count falls with the relief's size on screen, and
// relief below a pixel is not marched at all: the plain surface at the pixel's height, with the paint's shading.

import { f, variable, vec2, vec3 } from "../expr.ts";
import { readsBody } from "../style.ts";
import { emitShaderFn } from "../compile/bind.ts";
import { drawSpec, type Bakeable, type CompileContext, type Drawable, type Emitted, type Shader } from "../compile/context.ts";
import { lit } from "../compile/scene_wgsl.ts";
import type { Folded } from "../lib/fold.ts";
import type { F, P3, Skeleton, Surface, Warp } from "../map/types.ts";
import { displace, shellFrame, type ShellFrame } from "../relief/displace.ts";
import type { Height } from "../relief/height.ts";
import { traceMarch, tracePlain, type Traced } from "../relief/trace.ts";
import { nameId, type Grid } from "./surface.ts";

/** Where on the surface a height or a paint is asked: the surface's coordinates, and the cell of the fold they fall in. */
export type ReliefSite = { readonly u: F; readonly v: F; readonly cell: Folded<"vec2"> };
/** A painted point of the relief: its site and the relief's height there. */
export type ReliefPoint = ReliefSite & { readonly h: F };

export type ReliefOptions = {
  /** Height above the surface at a site, world units, in [0, hMax]. */
  readonly height: (at: ReliefSite) => F;
  /** The shell's thickness: the most the relief rises. */
  readonly hMax: number;
  /** A fold in (u, v) whose cell every site carries: one motif, any number of copies (`fold2.identity` for none). */
  readonly fold: Warp<"vec2">;
  /** Base colour of the relief at a point (lit by the style); by cell identity when the fold has cells. */
  readonly paint: (at: ReliefPoint) => P3;
  /** Most linear-search samples per pixel (near, grazing); fewer as the relief shrinks on screen. */
  readonly steps: number;
  /** The shell's grid in the vertex stage. */
  readonly grid: Grid;
  /** `ink`: the style's ink along the relief's own silhouette. */
  readonly outline: "ink" | "none";
};

/** Regula-falsi refinements of a bracketed hit: the error falls by about a factor of ten each on smooth relief. */
const REFINE = 5;
/** Fewest linear-search samples while marching at all. */
const MIN_STEPS = 6;
/** Samples per pixel of relief height on screen (divided by the cosine of the view to the surface, so grazing rays get more). */
const DENSITY = 0.6;
/** Below this many pixels of relief height the march is skipped; the relief's normal is fully used above DETAIL_FULL. */
const SUBPIXEL = 1, DETAIL_FULL = 4;
/** The shell's thickness at most this fraction of the local radius of curvature. */
const CURVATURE_CAP = 0.35;

const S = variable("s", "f32"), T = variable("t", "f32");
const U = variable("u", "f32"), V = variable("v", "f32"), H = variable("h", "f32");

/** The free variables the fragment stage's functions are written in: the interpolated shell frame and the ray. */
const FV = {
  base: variable("f_base", "vec3"), su: variable("f_su", "vec3"), sv: variable("f_sv", "vec3"),
  n: variable("f_n", "vec3"), nu: variable("f_nu", "vec3"), nv: variable("f_nv", "vec3"), uv: variable("f_uv", "vec2"),
  entry: variable("r_entry", "vec3"), dir: variable("r_dir", "vec3"), top: variable("r_top", "f32"),
  steps: variable("b_steps", "f32"), ink: variable("b_ink", "f32"), detail: variable("b_detail", "f32"),
};
const FRAME_ARGS = [["f_base", "vec3"], ["f_su", "vec3"], ["f_sv", "vec3"], ["f_n", "vec3"], ["f_nu", "vec3"], ["f_nv", "vec3"], ["f_uv", "vec2"],
  ["r_entry", "vec3"], ["r_dir", "vec3"], ["r_top", "f32"]] as const;

const INK_OF: Readonly<Record<ReliefOptions["outline"], { readonly width: (p: string) => string; readonly pad: (p: string) => string }>> = {
  // The shell's top clears the relief by the ink width, so the ink band beyond the relief's silhouette has room.
  ink: { width: (p) => `ink_width(${p})`, pad: (p) => `ink_width(${p})` },
  none: { width: () => "0.0", pad: () => "0.0" },
};

const siteOf = (fold: Warp<"vec2">) => (u: F, v: F): ReliefSite => ({ u, v, cell: fold(vec2(u, v)) });

/** The `Drawable` that `draw.relief` returns: a height function ray-marched in a thin shell over a surface. A scene author gets it from `draw.relief`, not by constructing it. */
export class ReliefDrawable implements Drawable {
  readonly skeletons: readonly Skeleton[];
  readonly surfaces: readonly Bakeable[];
  /** The height as a function of (u, v), through the fold. */
  readonly heightOf: Height;

  constructor(readonly name: string, readonly surface: Surface, readonly o: ReliefOptions) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw new Error(`draw.relief "${name}": names must be identifiers (they name shaders)`);
    if (!(o.hMax > 0) || !Number.isFinite(o.hMax)) throw new Error(`draw.relief "${name}": hMax must be finite and > 0, got ${o.hMax}`);
    if (!(Number.isInteger(o.steps) && o.steps >= MIN_STEPS)) throw new Error(`draw.relief "${name}": steps must be an integer >= ${MIN_STEPS}, got ${o.steps}`);
    for (const [axis, s] of [["u", o.grid.u], ["v", o.grid.v]] as const) {
      if (!(Number.isInteger(s.count) && s.count >= 1)) throw new Error(`draw.relief "${name}": grid.${axis}.count must be a positive integer, got ${s.count}`);
    }
    const site = siteOf(o.fold);
    this.heightOf = (u, v) => o.height(site(u, v));
    this.skeletons = [surface.skeleton];
    // The baker gets the relief as displacement of the surface: the same height, sampled on the grid.
    const heightOf = this.heightOf;
    this.surfaces = [{ name, surface: displace(surface, heightOf), paint: (u, v) => o.paint({ ...site(u, v), h: heightOf(u, v) }), grid: o.grid, sides: "one", copy: 0 }];
  }

  draws(ctx: CompileContext): Emitted {
    const n = this.name, key = `relief.${n}`;
    const NU = this.o.grid.u.count, NV = this.o.grid.v.count;
    const fns = [this.vertexFn(ctx), this.traceFn(ctx, `march_${n}`, "march"), this.traceFn(ctx, `plain_${n}`, "plain"), this.paintFn(ctx), this.anchorFn(ctx)];
    const ink = INK_OF[this.o.outline];
    const code = [
      `override NU: u32 = ${NU}u;`,
      `override NV: u32 = ${NV}u;`,
      `const HMAX: f32 = ${lit(this.o.hMax)};`,
      `const ID: f32 = ${lit(nameId(this.name))};`,
      /* wgsl */ `
struct ReliefV { base: vec3<f32>, su: vec3<f32>, sv: vec3<f32>, n: vec3<f32>, nu: vec3<f32>, nv: vec3<f32>, uv: vec2<f32> };
struct ReliefHit { kind: f32, world: vec3<f32>, uvh: vec3<f32>, normal: vec3<f32> };`,
      ...fns.map((f) => f.code),
      /* wgsl */ `
struct VOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) world: vec3<f32>,
  @location(1) base: vec3<f32>,
  @location(2) su: vec3<f32>,
  @location(3) sv: vec3<f32>,
  @location(4) n: vec3<f32>,
  @location(5) nu: vec3<f32>,
  @location(6) nv: vec3<f32>,
  @location(7) uv: vec2<f32>,
  @location(8) top: f32,
};
@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  let ij = vec2<u32>((vi / 6u) / NV, (vi / 6u) % NV) + quad_corner(vi % 6u);
  let s = shell_${n}(f32(ij.x) / f32(NU), f32(ij.y) / f32(NV));
  // The shell is never thicker than a third of the surface's radius of curvature (|dN| / |dS| along u and v): past
  // that the tracer's second-order model invents hits. Found at the spiral shell's apex (2026-11-11), where the tube is
  // thinner than the relief's shell and stray slivers hung below it. Relief taller than the cap is clipped there.
  let kappa = max(length(s.nu) / max(length(s.su), 1e-9), length(s.nv) / max(length(s.sv), 1e-9));
  let top = min(HMAX * 1.02 + ${ink.pad("s.base")}, ${lit(CURVATURE_CAP)} / max(kappa, 1e-6));
  let p = s.base + s.n * top;
  var out: VOut;
  out.clip = frame.view_proj * vec4<f32>(p, 1.0);
  out.world = p;
  out.base = s.base; out.su = s.su; out.sv = s.sv; out.n = s.n; out.nu = s.nu; out.nv = s.nv; out.uv = s.uv;
  out.top = top;
  return out;
}
struct FOut { @location(0) colour: vec4<f32>, @builtin(frag_depth) depth: f32 };
@fragment fn fs(in: VOut) -> FOut {
  let d = view_dir(in.world);
  let n = normalize(in.n);
  // Relief height on screen, in pixels: what decides whether to march, and how finely.
  let hpix = HMAX / pixel_world(in.world);
  let inkw = ${ink.width("in.world")};
  var r: ReliefHit;
  if (hpix < ${lit(SUBPIXEL)}) {
    r = plain_${n}(in.base, in.su, in.sv, n, in.nu, in.nv, in.uv, in.world, d, in.top, inkw);
  } else {
    let slant = max(abs(dot(d, n)), 0.15);
    let steps = clamp(ceil(hpix * ${lit(DENSITY)} / slant), ${lit(MIN_STEPS)}, ${lit(this.o.steps)});
    r = march_${n}(in.base, in.su, in.sv, n, in.nu, in.nv, in.uv, in.world, d, in.top, steps, inkw, smoothstep(${lit(SUBPIXEL)}, ${lit(DETAIL_FULL)}, hpix));
  }
  if (r.kind < 0.25) { discard; }
  let eye = -d;
  let depth = sea_height(r.world.xz) - r.world.y;
  let base = paint_${n}(r.uvh.x, r.uvh.y, r.uvh.z);
  let anchor = anchor_${n}(r.uvh.x, r.uvh.y);
  // Both are evaluated (the style's shading takes screen-space derivatives, which need uniform control flow).
  let lit_c = shade(base, r.normal, eye, r.world, depth, r.uvh.xy, anchor, ID);
  let ink_c = ink(base, r.normal, eye, r.world, depth, r.uvh.xy, anchor, ID);
  let clip = frame.view_proj * vec4<f32>(r.world, 1.0);
  var out: FOut;
  out.colour = vec4<f32>(select(lit_c, ink_c, r.kind < 0.75), ${ctx.markOut("mark(base, r.normal, eye, r.world, depth, r.uvh.xy, anchor, ID)", false)});
  out.depth = clip.z / clip.w;
  return out;
}`,
    ].join("\n");
    // One module, four emitted functions: a library function two of them call must be defined once.
    const shader: Shader = { code, libs: [...new Set(fns.flatMap((f) => f.libs))] };
    return {
      shaders: { [key]: shader },
      draws: [drawSpec({ label: n, shader: key, vertices: 6 * NU * NV, instances: 1, constants: { NU, NV }, cull: "back" })],
    };
  }

  /** `fn shell_<name>(s, t) -> ReliefV`: the surface's shell frame at grid corner (s, t). */
  private vertexFn(ctx: CompileContext): Shader {
    const u = this.o.grid.u.at(S), v = this.o.grid.v.at(T);
    const fr = shellFrame(this.surface, u, v);
    return emitShaderFn(ctx.slots, {
      name: `shell_${this.name}`, args: [["s", "f32"], ["t", "f32"]], out: "ReliefV",
      roots: [fr.base, fr.su, fr.sv, fr.n, fr.nu, fr.nv, vec2(u, v)], ret: (x) => `ReliefV(${x.join(", ")})`,
    });
  }

  /** The march (or the plain fallback) as a function of the interpolated frame and the ray. */
  private traceFn(ctx: CompileContext, name: string, which: "march" | "plain"): Shader {
    const fr: ShellFrame = { base: FV.base, su: FV.su, sv: FV.sv, n: FV.n, nu: FV.nu, nv: FV.nv };
    const ray = { entry: FV.entry, dir: FV.dir, top: FV.top };
    const t: Traced = which === "march"
      ? traceMarch(fr, FV.uv, ray, this.heightOf, { steps: FV.steps, refine: f(REFINE), ink: FV.ink, detail: FV.detail })
      : tracePlain(fr, FV.uv, ray, this.heightOf, FV.ink);
    const args = which === "march" ? [...FRAME_ARGS, ["b_steps", "f32"], ["b_ink", "f32"], ["b_detail", "f32"]] as const : [...FRAME_ARGS, ["b_ink", "f32"]] as const;
    return emitShaderFn(ctx.slots, { name, args, out: "ReliefHit", roots: [t.kind, t.world, t.uvh, t.normal], ret: (x) => `ReliefHit(${x.join(", ")})` });
  }

  /** `fn anchor_<name>(u, v) -> vec3`: the surface's anchor at the hit (0 for a style that does not read it). */
  private anchorFn(ctx: CompileContext): Shader {
    const anchor = readsBody(ctx.style) ? this.surface.anchor(U, V) : vec3(0, 0, 0);
    return emitShaderFn(ctx.slots, { name: `anchor_${this.name}`, args: [["u", "f32"], ["v", "f32"]], out: "vec3<f32>", roots: [anchor], ret: (x) => x[0] });
  }

  /** `fn paint_<name>(u, v, h) -> vec3`. */
  private paintFn(ctx: CompileContext): Shader {
    return emitShaderFn(ctx.slots, { name: `paint_${this.name}`, args: [["u", "f32"], ["v", "f32"], ["h", "f32"]], out: "vec3<f32>", roots: [this.o.paint({ ...siteOf(this.o.fold)(U, V), h: H })], ret: (x) => x[0] });
  }
}


/** Relief shell-traced on a surface, in its own coordinates (scales, spikes, barnacles). */
export function drawRelief(name: string, surface: Surface, o: ReliefOptions): ReliefDrawable {
  return new ReliefDrawable(name, surface, o);
}
