// A hand-written Artefact: what the compiler will emit for a small scene, written out by hand so the host can be
// built and tested first. It is also the worked example of the contract in src/artefact.ts.
//
// The scene: a swaying tube (a stand-in for a strand) built in the vertex shader from a `stations` table that the
// pose function animates with time, a checkered ground quad, a pool of water the tube dips through, a translucent fin
// along the tube's back, a construction overlay that marks each station, and two post passes (ink, then paper). It
// uses each contract feature at least once:
//   curve()                girth profile (row 0) and fin height (row 1)
//   params[...]            "tube.girth" scales the radius in the vertex shader; "tube.sway" drives the pose
//   inputs[...]            "tube.belly" (vec3) colours the underside; "time" (slot 0) is filled from View.time
//   override               SEG, the number of segments around the tube, set per draw through `constants`
//   transparent draw       the fin: straight alpha over, no depth write, no culling
//   sceneDepth             the water: scene_position gives how far below the surface the opaque world is, which
//                          sets the water's opacity and draws foam where the surface meets the tube
//   post                   "ink" draws lines on the near side of depth edges; "paper" adds grain and a vignette
//                          (two passes, so the chaining of post_color is exercised)
//   construction layer     station markers, shown only when View.construction is set
//   cameras                "three" (perspective) and "side" (orthographic)

import { CURVE_N, handPose, type Artefact, type Draw, type FrameState } from "../artefact.ts";

const STATIONS = 24;
const SEG = 20;

// ---- curve rows (what `keys(...)` will sample into the curve table) -------------------------------------------

type Keys = readonly (readonly [number, number])[];
/** Piecewise-linear keys sampled into one row of CURVE_N vec4s (value in x; y, z, w zero). */
function row(keys: Keys): Float32Array {
  const out = new Float32Array(CURVE_N * 4);
  for (let s = 0; s < CURVE_N; s++) {
    const x = s / (CURVE_N - 1);
    let k = 0;
    while (k < keys.length - 2 && x > keys[k + 1]![0]) k++;
    const [x0, y0] = keys[k]!, [x1, y1] = keys[k + 1]!;
    out[s * 4] = y0 + (y1 - y0) * Math.min(1, Math.max(0, (x - x0) / (x1 - x0)));
  }
  return out;
}
const GIRTH_ROW = 0, FIN_ROW = 1;
const curves = new Float32Array(2 * CURVE_N * 4);
curves.set(row([[0, 0.04], [0.08, 0.42], [0.3, 0.5], [0.8, 0.3], [1, 0.02]]), GIRTH_ROW * CURVE_N * 4);
curves.set(row([[0, 0], [0.18, 0], [0.42, 0.85], [0.8, 0], [1, 0]]), FIN_ROW * CURVE_N * 4);

// ---- the pose pass: stations along a moving spine, with rotation-minimising frames ------------------------------

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const axpy = (s: number, a: V3, b: V3): V3 => [b[0] + s * a[0], b[1] + s * a[1], b[2] + s * a[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => { const l = Math.sqrt(dot(a, a)); return [a[0] / l, a[1] / l, a[2] / l]; };

function spine(m: number, t: number, sway: number): V3 {
  const TAU = 2 * Math.PI;
  return [-4 + 8 * m, 1.2 + 0.25 * Math.sin(TAU * (m - 0.3 * t)), sway * Math.sin(TAU * (1.1 * m - 0.4 * t)) * (0.3 + 0.7 * m)];
}

/** Quaternion (x, y, z, w) of the rotation whose matrix has columns a, b, c. */
function quat(a: V3, b: V3, c: V3): [number, number, number, number] {
  const tr = a[0] + b[1] + c[2];
  if (tr > 0) { const s = 2 * Math.sqrt(tr + 1); return [(b[2] - c[1]) / s, (c[0] - a[2]) / s, (a[1] - b[0]) / s, s / 4]; }
  if (a[0] > b[1] && a[0] > c[2]) { const s = 2 * Math.sqrt(1 + a[0] - b[1] - c[2]); return [s / 4, (b[0] + a[1]) / s, (c[0] + a[2]) / s, (b[2] - c[1]) / s]; }
  if (b[1] > c[2]) { const s = 2 * Math.sqrt(1 + b[1] - a[0] - c[2]); return [(b[0] + a[1]) / s, s / 4, (c[1] + b[2]) / s, (c[0] - a[2]) / s]; }
  const s = 2 * Math.sqrt(1 + c[2] - a[0] - b[1]);
  return [(c[0] + a[2]) / s, (c[1] + b[2]) / s, s / 4, (a[1] - b[0]) / s];
}

/** Input slots: 0 time (f32), 1..3 belly colour (vec3). Param slots: 0 girth, 1 sway. */
function pose(state: FrameState): Record<string, Float32Array> {
  const sway = state.params[1]!;
  const p = Array.from({ length: STATIONS }, (_, i) => spine(i / (STATIONS - 1), state.time, sway));
  const tangent = p.map((_, i) => unit(sub(p[Math.min(i + 1, STATIONS - 1)]!, p[Math.max(i - 1, 0)]!)));
  // Rotation-minimising frames by double reflection (Wang, Juettler, Zheng, Liu 2008), seeded with the normal
  // nearest world up, so the tube does not roll as the spine sways.
  const normal: V3[] = [unit(axpy(-tangent[0]![1], tangent[0]!, [0, 1, 0]))];
  for (let i = 0; i + 1 < STATIONS; i++) {
    const v1 = sub(p[i + 1]!, p[i]!), c1 = dot(v1, v1);
    const rL = axpy((-2 / c1) * dot(v1, normal[i]!), v1, normal[i]!);
    const tL = axpy((-2 / c1) * dot(v1, tangent[i]!), v1, tangent[i]!);
    const v2 = sub(tangent[i + 1]!, tL), c2 = dot(v2, v2);
    normal.push(unit(c2 > 0 ? axpy((-2 / c2) * dot(v2, rL), v2, rL) : rL)); // c2 = 0: the spine is straight here, no second reflection
  }
  let arc = 0;
  const out = new Float32Array(STATIONS * 3 * 4);
  for (let i = 0; i < STATIONS; i++) {
    if (i > 0) arc += Math.sqrt(dot(sub(p[i]!, p[i - 1]!), sub(p[i]!, p[i - 1]!)));
    const t = tangent[i]!, n = normal[i]!;
    out.set([...p[i]!, arc], i * 12);                      // p: position, w = arc length (normalised below)
    out.set(quat(t, n, cross(t, n)), i * 12 + 4);           // q: local x = tangent, y = normal, z = binormal
    out.set([1, 0.8, 1, 0], i * 12 + 8);                   // r: half-width factor, half-height factor, stretch
  }
  for (let i = 0; i < STATIONS; i++) out[i * 12 + 3]! /= arc;
  return { stations: out };
}

// ---- WGSL -------------------------------------------------------------------------------------------------------

const sceneWgsl = /* wgsl */ `
@group(1) @binding(0) var<storage, read> stations: array<vec4<f32>>;

const STATIONS: u32 = ${STATIONS}u;
const GIRTH_ROW: u32 = ${GIRTH_ROW}u;
const FIN_ROW: u32 = ${FIN_ROW}u;
const P_GIRTH: u32 = 0u;   // params slot of "tube.girth"
const I_BELLY: u32 = 1u;   // inputs slot of "tube.belly" (vec3)

struct Station { p: vec3<f32>, arc: f32, q: vec4<f32>, r: vec4<f32> };
fn station(i: u32) -> Station {
  let p = stations[i * 3u];
  return Station(p.xyz, p.w, stations[i * 3u + 1u], stations[i * 3u + 2u]);
}
/// Rotate v by the unit quaternion q.
fn qrot(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}
fn sun() -> vec3<f32> { return normalize(vec3<f32>(-0.5, 0.8, -0.35)); }
/// Corner c (0..5) of a quad as (along, around) offsets, wound counter-clockwise seen from outside the tube.
fn quad_corner(c: u32) -> vec2<u32> {
  return array<vec2<u32>, 6>(vec2(0u, 0u), vec2(0u, 1u), vec2(1u, 1u), vec2(0u, 0u), vec2(1u, 1u), vec2(1u, 0u))[c];
}
`;

const tube = /* wgsl */ `
override SEG: u32 = 12u;
struct Out { @builtin(position) clip: vec4<f32>, @location(0) normal: vec3<f32>, @location(1) colour: vec3<f32> };

@vertex fn vs(@builtin(vertex_index) vi: u32) -> Out {
  let quad = vi / 6u;
  let c = quad_corner(vi % 6u);
  let i = quad / SEG + c.x;                 // station
  let j = (quad % SEG + c.y) % SEG;         // segment around
  let s = station(i);
  let m = f32(i) / f32(STATIONS - 1u);
  let theta = 6.2831853 * f32(j) / f32(SEG);
  let radius = curve(GIRTH_ROW, m).x * params[P_GIRTH];
  let local = vec3<f32>(0.0, cos(theta) * s.r.x, sin(theta) * s.r.y);
  let world = s.p + qrot(s.q, local * radius);
  var out: Out;
  out.clip = frame.view_proj * vec4<f32>(world, 1.0);
  out.normal = qrot(s.q, normalize(vec3<f32>(0.0, cos(theta) / s.r.x, sin(theta) / s.r.y)));
  // Countershading: a dark back, the belly colour from a host input underneath, and a band at m along the body.
  let back = vec3<f32>(0.18, 0.16, 0.38);
  let belly = vec3<f32>(inputs[I_BELLY], inputs[I_BELLY + 1u], inputs[I_BELLY + 2u]);
  out.colour = mix(belly, back, smoothstep(-0.3, 0.3, out.normal.y));
  return out;
}

@fragment fn fs(in: Out) -> @location(0) vec4<f32> {
  let n = normalize(in.normal);
  let light = 0.35 + 0.65 * smoothstep(0.0, 0.08, dot(n, sun()));   // two soft toon bands
  return vec4<f32>(in.colour * light, 1.0);
}
`;

const ground = /* wgsl */ `
const HALF: f32 = 12.0;
struct Out { @builtin(position) clip: vec4<f32>, @location(0) xz: vec2<f32> };

@vertex fn vs(@builtin(vertex_index) vi: u32) -> Out {
  // Two triangles at y = 0, counter-clockwise seen from above.
  let corner = array<vec2<f32>, 6>(vec2(-1.0, -1.0), vec2(-1.0, 1.0), vec2(1.0, 1.0), vec2(-1.0, -1.0), vec2(1.0, 1.0), vec2(1.0, -1.0))[vi];
  var out: Out;
  out.xz = corner * HALF;
  out.clip = frame.view_proj * vec4<f32>(out.xz.x, 0.0, out.xz.y, 1.0);
  return out;
}

@fragment fn fs(in: Out) -> @location(0) vec4<f32> {
  // A unit checker, antialiased with screen-space derivatives (MSAA only smooths triangle edges).
  let f = fract(in.xz * 0.5) - 0.5;
  let w = fwidth(in.xz * 0.5);
  let edge = clamp(abs(f) / max(w, vec2<f32>(1e-4)), vec2<f32>(0.0), vec2<f32>(1.0));
  // Where one pixel spans most of a square (grazing angles), fade to the mean instead of aliasing into moire.
  let checker = mix(0.5 - 0.5 * sign(f.x * f.y) * min(edge.x, edge.y), 0.5, smoothstep(0.25, 0.75, max(w.x, w.y)));
  let fade = smoothstep(HALF, HALF * 0.6, length(in.xz));
  let colour = mix(vec3<f32>(0.62, 0.70, 0.74), vec3<f32>(0.50, 0.58, 0.64), checker);
  return vec4<f32>(mix(vec3<f32>(0.80, 0.86, 0.90), colour, fade), 1.0);
}
`;

const fin = /* wgsl */ `
struct Out { @builtin(position) clip: vec4<f32>, @location(0) up: f32 };

@vertex fn vs(@builtin(vertex_index) vi: u32) -> Out {
  // A strip standing on the tube's back: (STATIONS - 1) quads, base on the skin, tip raised along the frame normal.
  let c = quad_corner(vi % 6u);
  let i = vi / 6u + c.x;
  let s = station(i);
  let m = f32(i) / f32(STATIONS - 1u);
  let base = curve(GIRTH_ROW, m).x * params[P_GIRTH] * s.r.y;
  let h = base + curve(FIN_ROW, m).x * f32(c.y);
  var out: Out;
  out.clip = frame.view_proj * vec4<f32>(s.p + qrot(s.q, vec3<f32>(0.0, h, 0.0)), 1.0);
  out.up = f32(c.y);
  return out;
}

@fragment fn fs(in: Out) -> @location(0) vec4<f32> {
  return vec4<f32>(0.92, 0.30, 0.34, 0.25 + 0.4 * in.up);
}
`;

const water = /* wgsl */ `
const WATER_Y: f32 = 1.05;
const POOL: vec2<f32> = vec2<f32>(6.5, 3.2);   // half extents in x and z
const FOAM: f32 = 0.09;                         // depth below the surface, in world units, that reads as foam
struct Out { @builtin(position) clip: vec4<f32> };

@vertex fn vs(@builtin(vertex_index) vi: u32) -> Out {
  let corner = array<vec2<f32>, 6>(vec2(-1.0, -1.0), vec2(-1.0, 1.0), vec2(1.0, 1.0), vec2(-1.0, -1.0), vec2(1.0, 1.0), vec2(1.0, -1.0))[vi] * POOL;
  return Out(frame.view_proj * vec4<f32>(corner.x, WATER_Y, corner.y, 1.0));
}

@fragment fn fs(in: Out) -> @location(0) vec4<f32> {
  // Seen from above the water, whatever opaque lies behind the surface lies below it, so below >= 0 here.
  let below = WATER_Y - scene_position(in.clip.xy).y;
  let deep = 1.0 - exp(-1.6 * below);
  let tint = mix(vec3<f32>(0.42, 0.74, 0.78), vec3<f32>(0.10, 0.33, 0.48), deep);
  let foam = 1.0 - smoothstep(0.4 * FOAM, FOAM, below);
  return vec4<f32>(mix(tint, vec3<f32>(0.97, 0.98, 1.0), foam), mix(0.3 + 0.5 * deep, 0.95, foam));
}
`;

// Post passes: only fs; POST_WGSL supplies PostIn, post_vs, post_color, scene_depth and scene_position.
const ink = /* wgsl */ `
const INK: vec3<f32> = vec3<f32>(0.10, 0.09, 0.16);
/// Distance along the view direction to the opaque surface at px (both camera kinds).
fn view_depth(px: vec2<f32>) -> f32 { return dot(scene_position(px) - frame.eye.xyz, frame.forward.xyz); }

@fragment fn fs(in: PostIn) -> @location(0) vec4<f32> {
  // Ink only the NEAR side of a depth edge: a pixel whose neighbour is farther. Testing both sides would draw every
  // edge twice, once on each surface. A step must be large relative to the depth (so a plane receding from a far
  // camera is not an edge) and in world units (so a plane passing under the eye, where depth nears 0, is not either).
  let z = view_depth(in.px.xy);
  var edge = 0.0;
  for (var k = 0u; k < 4u; k++) {
    let o = array<vec2<f32>, 4>(vec2(1.0, 0.0), vec2(-1.0, 0.0), vec2(0.0, 1.0), vec2(0.0, -1.0))[k];
    let d = view_depth(in.px.xy + o) - z;
    edge = max(edge, min(smoothstep(0.03, 0.08, d / z), smoothstep(0.25, 0.5, d)));
  }
  // Lines fade with distance, so the far rim of the ground (which meets the empty background) stays soft.
  let ink = edge * smoothstep(22.0, 15.0, z);
  return vec4<f32>(mix(post_color(in.uv).rgb, INK, ink), 1.0);
}
`;

const paper = /* wgsl */ `
/// A hash of the pixel index (DESIGN.md: no randomness except hashes of indices).
fn grain_hash(p: vec2<u32>) -> f32 {
  var h = p.x * 1664525u + p.y * 1013904223u;
  h = (h ^ (h >> 16u)) * 2246822519u;
  h = (h ^ (h >> 13u)) * 3266489917u;
  return f32(h ^ (h >> 16u)) / 4294967295.0;
}

@fragment fn fs(in: PostIn) -> @location(0) vec4<f32> {
  let c = post_color(in.uv).rgb;
  let vignette = 1.0 - 0.3 * smoothstep(0.45, 0.85, length(in.uv - 0.5));
  let grain = (grain_hash(vec2<u32>(in.px.xy)) - 0.5) * 0.05;
  return vec4<f32>(c * vignette + grain, 1.0);
}
`;

const marks = /* wgsl */ `
const SIZE_PX: f32 = 7.0;
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> @builtin(position) vec4<f32> {
  // A square of SIZE_PX pixels at each station, drawn at depth 0 so the overlay is never hidden.
  let corner = array<vec2<f32>, 6>(vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(1.0, 1.0), vec2(-1.0, -1.0), vec2(1.0, 1.0), vec2(-1.0, 1.0))[vi];
  let clip = frame.view_proj * vec4<f32>(station(ii).p, 1.0);
  let offset = corner * SIZE_PX * frame.viewport.zw * clip.w;
  return vec4<f32>(clip.xy + offset, 0.0, clip.w);
}
@fragment fn fs() -> @location(0) vec4<f32> { return vec4<f32>(1.0, 0.85, 0.1, 1.0); }
`;

// ---- the draw list ----------------------------------------------------------------------------------------------

const draw = (d: Pick<Draw, "label" | "shader" | "vertices"> & Partial<Draw>): Draw => ({
  instances: 1, pass: "opaque", cull: "back", depthWrite: true, blend: "none", layer: "scene", constants: {}, detail: { kind: "fixed" }, ...d,
});
const draws: Draw[] = [
  draw({ label: "ground", shader: "ground", vertices: 6 }),
  draw({ label: "tube", shader: "tube", vertices: (STATIONS - 1) * SEG * 6, constants: { SEG } }),
  draw({ label: "water", shader: "water", vertices: 6, pass: "transparent", cull: "none", depthWrite: false, blend: "alpha", sceneDepth: true }),
  draw({ label: "fin", shader: "fin", vertices: (STATIONS - 1) * 6, pass: "transparent", cull: "none", depthWrite: false, blend: "alpha" }),
  draw({ label: "station marks", shader: "marks", vertices: 6, instances: STATIONS, pass: "transparent", cull: "none", depthWrite: false, layer: "construction" }),
];

export const fixture: Artefact = {
  version: 1,
  clear: [0.86, 0.9, 0.94],
  inputs: [
    { name: "time", ty: "f32", slot: 0, def: [0] },
    { name: "tube.belly", ty: "vec3", slot: 1, def: [0.93, 0.84, 0.6] },
  ],
  inputFloats: 4,
  params: [
    { name: "tube.girth", slot: 0, def: 1, min: 0.3, max: 2 },
    { name: "tube.sway", slot: 1, def: 0.8, min: 0, max: 2 },
  ],
  curves,
  dynamic: [{ name: "stations", binding: 0, vec4s: STATIONS * 3 }],
  sceneWgsl,
  shaders: { tube, ground, water, fin, marks, ink, paper },
  draws,
  post: [{ label: "ink", shader: "ink" }, { label: "paper", shader: "paper" }],
  ...handPose([{ name: "stations", binding: 0, vec4s: STATIONS * 3 }], pose, "a hand-written fixture: its stations are JavaScript"),
  cameras: {
    three: { kind: "perspective", eye: [-7, 5, -9], target: [0, 1, 0], fovY: 0.7 },
    side: { kind: "orthographic", eye: [0, 1.5, 12], target: [0, 1, 0], height: 5 },
  },
  stats: {
    maxTriangles: draws.filter((d) => d.layer === "scene").reduce((n, d) => n + (d.vertices / 3) * d.instances, 0),
    draws: draws.length,
    curveRows: 2,
    stations: STATIONS,
  },
};
