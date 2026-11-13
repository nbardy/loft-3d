// Papercraft: a folded-paper diorama under soft studio light. Bodies are shaded as flat facets without changing their
// geometry: the surface is cut by a 3D Voronoi lattice into cells, and each cell is lit with ONE normal, the
// surface's normal carried to the cell's site by the normal's screen-space derivatives (so a cell is a flat plane
// that touches the surface there), tilted a little per cell as a fold would. Fold lines run along the cell walls.
// The sea is layered cut-paper sheets with scalloped edges, each casting a small shadow on the one below. A post
// pass adds ambient occlusion in creases (from the opaque scene's depth) and paper fibre.

import { add, dot, fract, lift, max, mix, mul, normalize, param, round, saturate, smoothstep, sub, vec3, vec4, type Expr } from "../expr.ts";
import { cellular2, luminance, noise2 } from "../lib/index.ts";
import { fwidth, wgslFn } from "../lib/wgsl.ts";
import type { PostSpec } from "../compile/context.ts";
import type { Contact, Rgb, Style } from "../style.ts";
import { edgeOf, POST_COMMON, rgb } from "./shared.ts";
import { skyOf, type Sky } from "./sky.ts";

const C = {
  key: [1.06, 1.0, 0.9],
  fill: [0.6, 0.66, 0.78],
  sheetDeep: [0.42, 0.6, 0.74],
  sheetLight: [0.8, 0.89, 0.94],
  cut: [0.97, 0.98, 0.97],
  backdrop: [0.86, 0.88, 0.88],
  backdropTop: [0.7, 0.78, 0.84],
} as const satisfies Record<string, Rgb>;

/**
 * Size of a facet cell, world units; how far each fan triangle slopes toward its edge of the cell (a cell is folded
 * into a low pyramid, raised or sunk), and how far each is tilted at random, as shares of the normal.
 */
const CELL = 0.55, SLOPE = 0.24, TILT = 0.12;

/**
 * The facet at p: xyz its normal, w the distance (world units) from p to the nearest fold. The surface is cut into
 * the cells of a 3D Voronoi lattice, and each cell into a fan of triangles, one per neighbouring cell (the pixel's
 * triangle is the one toward its second-nearest site). A cell is lit with the surface's normal carried to its site
 * by the normal's screen-space derivatives (so it is a plane touching the surface there, not the surface itself),
 * and each fan triangle slopes from the site toward its edge: folded paper, from shading alone.
 * Derivatives come first, in uniform control flow (WGSL's rule); the search is the 27 neighbouring cells.
 */
const facet = wgslFn<"vec4">({
  name: "pc_facet", ret: "vec4", wgsl: /* wgsl */ `
fn pc_hash3(c: vec3<i32>) -> vec3<f32> {
  var h = (bitcast<u32>(c.x) * 73856093u) ^ (bitcast<u32>(c.y) * 19349663u) ^ (bitcast<u32>(c.z) * 83492791u);
  h = (h ^ (h >> 16u)) * 2246822519u;
  let a = (h ^ (h >> 13u)) * 3266489917u;
  let b = (a ^ (a >> 16u)) * 2654435761u;
  let d = (b ^ (b >> 15u)) * 2246822519u;
  return vec3<f32>(f32(a >> 8u), f32(b >> 8u), f32(d >> 8u)) / 16777216.0;
}
/// Screen offsets (a, b) with a dpx + b dpy nearest to r, in least squares (0 where the pixel's footprint is degenerate).
fn pc_screen(r: vec3<f32>, dpx: vec3<f32>, dpy: vec3<f32>) -> vec2<f32> {
  let g = vec3<f32>(dot(dpx, dpx), dot(dpx, dpy), dot(dpy, dpy));
  let det = g.x * g.z - g.y * g.y;
  let rhs = vec2<f32>(dot(r, dpx), dot(r, dpy));
  return select(vec2<f32>(0.0), clamp(vec2<f32>(g.z * rhs.x - g.y * rhs.y, g.x * rhs.y - g.y * rhs.x) / det, vec2<f32>(-400.0), vec2<f32>(400.0)), abs(det) > 1e-20);
}
/// The lattice lives in the surface's anchor space a (so the facets ride a moving body); directions found there are
/// carried to the world through the screen: the same screen offset applied to the world point's derivatives.
fn pc_facet(n: vec3<f32>, p: vec3<f32>, a: vec3<f32>) -> vec4<f32> {
  let dpx = dpdx(p);
  let dpy = dpdy(p);
  let dax = dpdx(a);
  let day = dpdy(a);
  let dnx = dpdx(n);
  let dny = dpdy(n);
  let q = a / ${CELL};
  let base = vec3<i32>(floor(q));
  var d1 = 1e9;
  var d2 = 1e9;
  var d3 = 1e9;
  var s1 = vec3<f32>(0.0);
  var s2 = vec3<f32>(0.0);
  var s3 = vec3<f32>(0.0);
  var id1 = vec3<i32>(0);
  var id2 = vec3<i32>(0);
  for (var k = -1; k <= 1; k++) {
    for (var j = -1; j <= 1; j++) {
      for (var i = -1; i <= 1; i++) {
        let c = base + vec3<i32>(i, j, k);
        let s = vec3<f32>(c) + 0.15 + 0.7 * pc_hash3(c);
        let d = dot(s - q, s - q);
        if (d < d1) { d3 = d2; s3 = s2; d2 = d1; s2 = s1; id2 = id1; d1 = d; s1 = s; id1 = c; }
        else if (d < d2) { d3 = d2; s3 = s2; d2 = d; s2 = s; id2 = c; }
        else if (d < d3) { d3 = d; s3 = s; }
      }
    }
  }
  // Distances to the bisectors (|q - b|^2 - |q - a|^2) / (2 |b - a|): the cell wall (sites 1, 2) and the spoke
  // between this fan triangle and the next (sites 2, 3).
  let wall = (d2 - d1) / (2.0 * max(length(s2 - s1), 1e-4)) * ${CELL};
  let spoke = (d3 - d2) / (2.0 * max(length(s3 - s2), 1e-4)) * ${CELL};
  // The surface normal carried to the site: the screen offset (a, b) that reaches it, then n + a dnx + b dny.
  let ab = pc_screen(s1 * ${CELL} - a, dax, day);
  let carried = n + ab.x * dnx + ab.y * dny;
  // A carried normal that turned past the surface's own (a cell across a sharp rim) keeps the surface's.
  let flat = select(n, normalize(carried), dot(carried, n) > 0.3 * length(carried));
  // The fan triangle slopes toward its edge of the cell: up for a raised cell, down for a sunk one.
  let w = pc_screen(s2 - s1, dax, day);
  let edge = w.x * dpx + w.y * dpy;
  let toward = edge - flat * dot(edge, flat);
  let raised = select(-1.0, 1.0, pc_hash3(id1).x > 0.35);
  let slope = toward / max(length(toward), 1e-5) * (${SLOPE} * raised);
  let jitter = (pc_hash3(id1 * 3 + id2 + vec3<i32>(17, 5, 11)) - 0.5) * ${TILT * 2};
  return vec4<f32>(normalize(flat + slope + jitter), min(wall, spoke));
}`,
});

/**
 * Ambient occlusion from the opaque scene's depth: points of the scene within R of the pixel's surface point and above
 * its tangent plane darken it, then paper fibre (screen-fixed: the picture is the sheet) and a studio falloff.
 */
const STUDIO = /* wgsl */ `${POST_COMMON}
const PC_TAPS: u32 = 16u;
const PC_R: f32 = 0.6;
@fragment fn fs(in: PostIn) -> @location(0) vec4<f32> {
  var c = post_color(in.uv).rgb;
  let px = in.px.xy;
  let scale = max(frame.viewport.y / 800.0, 0.375);
  if (sty_solid(px) && !sty_submerged(px)) {
    let p = scene_position(px);
    let n = sty_normal(px, max(round(1.5 * scale), 1.0));
    let rpx = clamp(PC_R / pixel_world(p), 3.0 * scale, 60.0 * scale);
    let turn = 6.2831853 * fract(52.9829189 * fract(dot(floor(px), vec2<f32>(0.06711056, 0.00583715))));
    var occ = 0.0;
    for (var i = 0u; i < PC_TAPS; i++) {
      let t = (f32(i) + 0.5) / f32(PC_TAPS);
      let a = f32(i) * 2.3999632 + turn;
      let q = scene_position(px + vec2<f32>(cos(a), sin(a)) * rpx * sqrt(t));
      let v = q - p;
      let l = length(v);
      occ += max(dot(n, v) / max(l, 1e-4) - 0.15, 0.0) * (1.0 - smoothstep(0.5 * PC_R, 1.5 * PC_R, l));
    }
    c *= 1.0 - 0.75 * occ / f32(PC_TAPS);
  }
  let q = px / scale;
  let fibre = sty_noise(q * vec2<f32>(0.11, 0.9)) * 0.55 + sty_noise(q * vec2<f32>(0.9, 0.12)) * 0.45;
  let tooth = sty_hash(vec2<i32>(px));
  let vignette = 1.0 - 0.18 * smoothstep(0.35, 0.8, length(in.uv - 0.5));
  return vec4<f32>(c * vignette * (1.0 + (fibre - 0.5) * 0.06 + (tooth - 0.5) * 0.03), 1.0);
}
`;

export const PAPERCRAFT_POST = { studio: { label: "papercraft studio", wgsl: STUDIO } } as const satisfies Record<string, PostSpec>;

/** Paint as coloured card: less saturated, never quite black or white. */
const card = (c: Expr<"vec3">): Expr<"vec3"> => {
  const grey = mul(vec3(1.04, 1.0, 0.93), luminance(c));
  return add(mul(mix(c, grey, 0.45), 0.78), 0.2);
};

/** The studio backdrop: graded to a cooler top over the view's height 0..0.6; the deep sheet below the horizon. */
const SKY: Sky = { horizon: C.backdrop, washes: [{ ink: C.backdropTop, from: 0, to: 0.6 }], below: C.sheetDeep, sun: { kind: "none" }, clouds: { kind: "none" } };

/**
 * The folded-paper style: bodies cut into flat facets lit as separate planes, the water as layered cut-paper sheets
 * with scalloped edges and small shadows, soft studio light, and a post pass of crease occlusion and paper fibre.
 */
export function papercraft(): Style {
  const outline = param("papercraft.outline", 0.0, { min: 0, max: 0.1 });
  /** Sheet k's colour: one of the blues between deep and light, by a golden-ratio walk so neighbours differ. */
  const sheet = (k: Expr<"f32">): Expr<"vec3"> => mix(rgb(C.sheetDeep), rgb(C.sheetLight), add(mul(fract(mul(k, 0.618034)), 0.55), 0.25));
  return {
    name: "papercraft",
    outline,
    clear: C.backdrop,
    post: [PAPERCRAFT_POST.studio],
    shade: (ctx) => {
      const f = facet(ctx.normal, ctx.world, ctx.anchor);
      const n = f.xyz;
      // Soft studio light: a wrapped warm key from the sun's side, a cool fill from above.
      // The key comes from the sun's side but leans toward the camera and up, as a studio key over a model does,
      // so the side a high game camera sees is lit.
      const keyDir = normalize(add(add(ctx.sun, mul(ctx.view, 0.7)), vec3(0, 0.4, 0)));
      const key = saturate(mul(add(dot(n, keyDir), 0.1), 1 / 1.1));
      const fill = add(0.5, mul(n.y, 0.12));
      const light = add(mul(rgb(C.fill), fill), mul(rgb(C.key), mul(key, 0.68)));
      // Fold lines along the cell walls: a pixel or so wide at any distance.
      const fw = max(fwidth(f.w), 1e-5);
      const fold = sub(1, smoothstep(mul(fw, 0.6), mul(fw, 1.6), f.w));
      return mul(mul(card(ctx.base), light), sub(1, mul(fold, 0.14)));
    },
    // The hull is the card's cut edge: a little darker than the card.
    ink: (ctx) => mul(card(ctx.base), 0.55),
    mark: () => lift<"f32">(1),
    water: (ctx) => {
      const xz = ctx.world.xz;
      // Sheets laid along the swell, two edges per wavelength of the largest swell, bent by the height field and
      // round scattered domes so each edge is a chain of arcs. Each sheet is one of a few blues.
      const domes = cellular2(mul(xz, 0.3)).x;
      const s = add(add(mul(ctx.phase, 2), mul(ctx.crest, 0.35)), mul(domes, 0.2));
      const k = round(s);
      const x = sub(s, k);
      const fw = max(fwidth(s), 1e-4);
      const cover = smoothstep(mul(fw, -1), fw, x);
      let c: Expr<"vec3"> = mix(sheet(sub(k, 1)), sheet(k), cover);
      // The sheet above shades the one below near its edge; the cut edge itself catches the light.
      const shade = mul(mul(smoothstep(-0.35, 0, x), sub(1, cover)), 0.22);
      const cut = mul(mul(sub(1, smoothstep(0, add(0.05, fw), x)), cover), 0.35);
      c = mix(mul(c, sub(1, shade)), rgb(C.cut), cut);
      // Far off, the sheets merge into one tone instead of shimmering.
      c = mix(c, mix(rgb(C.sheetDeep), rgb(C.sheetLight), 0.52), smoothstep(0.12, 0.35, fw));
      c = collared(c, ctx.contact, xz);
      // Distance haze toward the backdrop.
      c = mix(c, rgb(C.backdrop), saturate(mul(sub(ctx.distance, 40), 1 / 120)));
      return vec4(c, 1);
    },
    shadow: (ctx) => vec4(mul(rgb(C.sheetDeep), 0.55), mul(ctx.amount, 0.35)),
    // A plane: one sheet of the cut-paper white, its shadow as the water's, hazed toward the backdrop as the water is.
    ground: (ctx) => mix(mix(mul(rgb(C.cut), 0.92), mul(rgb(C.sheetDeep), 0.55), mul(ctx.shadow, 0.35)), rgb(C.backdrop), saturate(mul(sub(ctx.distance, 40), 1 / 120))),
    sky: (ctx) => skyOf(SKY, ctx),
  };
}

/** Foam: a white cut-paper collar with scalloped edges and a shadow under it; none where no body is near. */
function collared(c: Expr<"vec3">, contact: Contact, xz: Expr<"vec2">): Expr<"vec3"> {
  switch (contact.kind) {
    case "clear": return c;
    case "near": {
      const collar = sub(contact.band, mul(cellular2(mul(xz, 3.5)).x, 0.45));
      const foam = edgeOf(collar, 0.1, 0.01);
      return mix(mul(c, sub(1, mul(mul(edgeOf(collar, -0.05, 0.01), edgeOf(contact.band, 0.05, 0.01)), 0.2))), rgb(C.cut), foam);
    }
  }
}
