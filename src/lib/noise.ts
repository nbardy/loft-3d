// Hashing and noise. CPU and GPU agree because the hash is integer arithmetic (a PCG hash on u32), never
// `fract(sin(x) * big)`, whose result depends on the precision of `sin`.
//
// Lattice coordinates are `floor(p)` cast through i32 (then reinterpreted as u32), so negative cells hash the same on
// both sides. The CPU twin uses `Math.imul` and `>>> 0` for the u32 wrap-around. Coordinates beyond +-2^31 are out of
// range (WGSL saturates the cast, JavaScript wraps); nothing in a scene is that far from the origin.
import { add, div, f, lift, lib, mul, TAU, type Expr, type In, type LibFn } from "../expr.ts";

// ---- integer hash, twice ------------------------------------------------------------------------------------------

const pcg = (v: number): number => {
  const s = (Math.imul(v, 747796405) + 2891336453) >>> 0;
  const w = Math.imul((s >>> ((s >>> 28) + 4)) ^ s, 277803737);
  return ((w >>> 22) ^ w) >>> 0;
};
/** The top 24 bits of a hash as a float in [0, 1): exactly representable in f32, so CPU and GPU agree bit for bit. */
const unit = (h: number): number => (h >>> 8) / 16777216;
const lat = (x: number): number => (Math.floor(x) | 0) >>> 0;
const h2u = (x: number, y: number): number => pcg((x + pcg(y)) >>> 0);
const h3u = (x: number, y: number, z: number): number => pcg((x + pcg((y + pcg(z)) >>> 0)) >>> 0);

// Helper functions the public ones call. They are never called from an expression, so their CPU twin is "gpu-only".
const helper = (name: string, ret: LibFn["ret"], wgsl: string, deps: readonly LibFn[] = []): LibFn => ({ name, ret, wgsl, js: "gpu-only", deps });

const PCG = helper("loft_pcg", "f32", `fn loft_pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}`);
const UNIT = helper("loft_unit", "f32", `fn loft_unit(h: u32) -> f32 { return f32(h >> 8u) * (1.0 / 16777216.0); }`);
const LAT = helper("loft_lat", "f32", `fn loft_lat(x: f32) -> u32 { return bitcast<u32>(i32(floor(x))); }`);
const H2 = helper("loft_h2", "f32", `fn loft_h2(x: u32, y: u32) -> u32 { return loft_pcg(x + loft_pcg(y)); }`, [PCG]);
const H3 = helper("loft_h3", "f32", `fn loft_h3(x: u32, y: u32, z: u32) -> u32 { return loft_pcg(x + loft_pcg(y + loft_pcg(z))); }`, [PCG]);
const GRAD2 = helper("loft_grad2", "vec2", `fn loft_grad2(h: u32) -> vec2<f32> {
  let a = loft_unit(h) * 6.283185307179586;
  return vec2<f32>(cos(a), sin(a));
}`, [UNIT]);
// A direction uniform on the sphere: z uniform in [-1, 1], azimuth uniform. (1-z)(1+z) rather than 1-z*z keeps the
// radius accurate in f32 near the poles, where 1-z*z cancels.
const GRAD3 = helper("loft_grad3", "vec3", `fn loft_grad3(h: u32) -> vec3<f32> {
  let z = 1.0 - 2.0 * loft_unit(h);
  let a = loft_unit(loft_pcg(h)) * 6.283185307179586;
  let r = sqrt((1.0 - z) * (1.0 + z));
  return vec3<f32>(r * cos(a), r * sin(a), z);
}`, [UNIT, PCG]);
const grad2 = (h: number): [number, number] => { const a = unit(h) * TAU; return [Math.cos(a), Math.sin(a)]; };
const grad3 = (h: number): [number, number, number] => {
  const z = 1 - 2 * unit(h), a = unit(pcg(h)) * TAU, r = Math.sqrt((1 - z) * (1 + z));
  return [r * Math.cos(a), r * Math.sin(a), z];
};

// ---- hashes -------------------------------------------------------------------------------------------------------

const HASH2 = {
  name: "loft_hash2", ret: "f32", deps: [H2, LAT, UNIT],
  wgsl: `fn loft_hash2(p: vec2<f32>) -> f32 { return loft_unit(loft_h2(loft_lat(p.x), loft_lat(p.y))); }`,
  js: (p: number[]) => unit(h2u(lat(p[0]), lat(p[1]))),
} satisfies LibFn;
const HASH3 = {
  name: "loft_hash3", ret: "f32", deps: [H3, LAT, UNIT],
  wgsl: `fn loft_hash3(p: vec3<f32>) -> f32 { return loft_unit(loft_h3(loft_lat(p.x), loft_lat(p.y), loft_lat(p.z))); }`,
  js: (p: number[]) => unit(h3u(lat(p[0]), lat(p[1]), lat(p[2]))),
} satisfies LibFn;
const HASH22 = {
  name: "loft_hash22", ret: "vec2", deps: [H2, LAT, UNIT, PCG],
  wgsl: `fn loft_hash22(p: vec2<f32>) -> vec2<f32> {
  let h = loft_h2(loft_lat(p.x), loft_lat(p.y));
  return vec2<f32>(loft_unit(h), loft_unit(loft_pcg(h)));
}`,
  js: (p: number[]) => { const h = h2u(lat(p[0]), lat(p[1])); return [unit(h), unit(pcg(h))]; },
} satisfies LibFn;
const HASH33 = {
  name: "loft_hash33", ret: "vec3", deps: [H3, LAT, UNIT, PCG],
  wgsl: `fn loft_hash33(p: vec3<f32>) -> vec3<f32> {
  let h = loft_h3(loft_lat(p.x), loft_lat(p.y), loft_lat(p.z));
  let h1 = loft_pcg(h);
  return vec3<f32>(loft_unit(h), loft_unit(h1), loft_unit(loft_pcg(h1)));
}`,
  js: (p: number[]) => { const h = h3u(lat(p[0]), lat(p[1]), lat(p[2])), h1 = pcg(h); return [unit(h), unit(h1), unit(pcg(h1))]; },
} satisfies LibFn;

/** A hash of the integer cell containing p, uniform in [0, 1). Constant inside each unit cell. */
export const hash2 = (p: In<"vec2">): Expr<"f32"> => lib<"f32">(HASH2, p);
/** A hash of the integer cell containing p, uniform in [0, 1). Constant inside each unit cube. */
export const hash3 = (p: In<"vec3">): Expr<"f32"> => lib<"f32">(HASH3, p);
/** Two independent hashes of the integer cell containing p, each in [0, 1). */
export const hash22 = (p: In<"vec2">): Expr<"vec2"> => lib<"vec2">(HASH22, p);
/** Three independent hashes of the integer cell containing p, each in [0, 1). */
export const hash33 = (p: In<"vec3">): Expr<"vec3"> => lib<"vec3">(HASH33, p);

// ---- gradient noise -----------------------------------------------------------------------------------------------

// With unit gradients the 2D maximum is sqrt(2)/2 and the 3D maximum is sqrt(3)/2; these scales bring both to 1.
const SCALE2 = Math.SQRT2;
const SCALE3 = 2 / Math.sqrt(3);
const quintic = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const NOISE2 = {
  name: "loft_noise2", ret: "f32", deps: [H2, LAT, GRAD2],
  wgsl: `fn loft_noise2(p: vec2<f32>) -> f32 {
  let ix = loft_lat(p.x);
  let iy = loft_lat(p.y);
  let f = p - floor(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let a = dot(loft_grad2(loft_h2(ix, iy)), f);
  let b = dot(loft_grad2(loft_h2(ix + 1u, iy)), f - vec2<f32>(1.0, 0.0));
  let c = dot(loft_grad2(loft_h2(ix, iy + 1u)), f - vec2<f32>(0.0, 1.0));
  let d = dot(loft_grad2(loft_h2(ix + 1u, iy + 1u)), f - vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * ${SCALE2};
}`,
  js: (p: number[]) => {
    const ix = lat(p[0]), iy = lat(p[1]);
    const x = p[0] - Math.floor(p[0]), y = p[1] - Math.floor(p[1]);
    const corner = (cx: number, cy: number): number => {
      const g = grad2(h2u((ix + cx) >>> 0, (iy + cy) >>> 0));
      return g[0] * (x - cx) + g[1] * (y - cy);
    };
    const ux = quintic(x), uy = quintic(y);
    return lerp(lerp(corner(0, 0), corner(1, 0), ux), lerp(corner(0, 1), corner(1, 1), ux), uy) * SCALE2;
  },
} satisfies LibFn;

const CORNER3 = helper("loft_corner3", "f32", `fn loft_corner3(i: vec3<u32>, d: vec3<f32>) -> f32 { return dot(loft_grad3(loft_h3(i.x, i.y, i.z)), d); }`, [H3, GRAD3]);
const NOISE3 = {
  name: "loft_noise3", ret: "f32", deps: [CORNER3, LAT],
  wgsl: `fn loft_noise3(p: vec3<f32>) -> f32 {
  let i = vec3<u32>(loft_lat(p.x), loft_lat(p.y), loft_lat(p.z));
  let f = p - floor(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let c000 = loft_corner3(i, f);
  let c100 = loft_corner3(i + vec3<u32>(1u, 0u, 0u), f - vec3<f32>(1.0, 0.0, 0.0));
  let c010 = loft_corner3(i + vec3<u32>(0u, 1u, 0u), f - vec3<f32>(0.0, 1.0, 0.0));
  let c110 = loft_corner3(i + vec3<u32>(1u, 1u, 0u), f - vec3<f32>(1.0, 1.0, 0.0));
  let c001 = loft_corner3(i + vec3<u32>(0u, 0u, 1u), f - vec3<f32>(0.0, 0.0, 1.0));
  let c101 = loft_corner3(i + vec3<u32>(1u, 0u, 1u), f - vec3<f32>(1.0, 0.0, 1.0));
  let c011 = loft_corner3(i + vec3<u32>(0u, 1u, 1u), f - vec3<f32>(0.0, 1.0, 1.0));
  let c111 = loft_corner3(i + vec3<u32>(1u, 1u, 1u), f - vec3<f32>(1.0, 1.0, 1.0));
  let z0 = mix(mix(c000, c100, u.x), mix(c010, c110, u.x), u.y);
  let z1 = mix(mix(c001, c101, u.x), mix(c011, c111, u.x), u.y);
  return mix(z0, z1, u.z) * ${SCALE3};
}`,
  js: (p: number[]) => {
    const ix = lat(p[0]), iy = lat(p[1]), iz = lat(p[2]);
    const x = p[0] - Math.floor(p[0]), y = p[1] - Math.floor(p[1]), z = p[2] - Math.floor(p[2]);
    const corner = (cx: number, cy: number, cz: number): number => {
      const g = grad3(h3u((ix + cx) >>> 0, (iy + cy) >>> 0, (iz + cz) >>> 0));
      return g[0] * (x - cx) + g[1] * (y - cy) + g[2] * (z - cz);
    };
    const ux = quintic(x), uy = quintic(y), uz = quintic(z);
    const z0 = lerp(lerp(corner(0, 0, 0), corner(1, 0, 0), ux), lerp(corner(0, 1, 0), corner(1, 1, 0), ux), uy);
    const z1 = lerp(lerp(corner(0, 0, 1), corner(1, 0, 1), ux), lerp(corner(0, 1, 1), corner(1, 1, 1), ux), uy);
    return lerp(z0, z1, uz) * SCALE3;
  },
} satisfies LibFn;

/** Smooth gradient noise (quintic interpolation): range [-1, 1], exactly 0 at integer lattice points. */
export const noise2 = (p: In<"vec2">): Expr<"f32"> => lib<"f32">(NOISE2, p);
/** Smooth gradient noise (quintic interpolation): range [-1, 1], exactly 0 at integer lattice points. */
export const noise3 = (p: In<"vec3">): Expr<"f32"> => lib<"f32">(NOISE3, p);

/**
 * Fractal sum controls. `octaves` is a compile-time count (the sum is unrolled); each octave multiplies the frequency
 * by `lacunarity` and the amplitude by `gain`.
 */
export type Fbm = { readonly octaves: number; readonly lacunarity: In<"f32">; readonly gain: In<"f32"> };

// Each octave is also shifted by a distinct dyadic offset. Gradient noise is 0 on every integer lattice point, and with
// lacunarity 2 the lattices of all octaves coincide, so without the shift the sum would be 0 along whole lines of
// the plane and share its structure between octaves. Dyadic offsets keep the f32 arithmetic exact for lacunarity 2.
const OFFSET = [37.5, 19.25, 11.125] as const;

function octavesOf(spec: Fbm): number {
  if (!Number.isInteger(spec.octaves) || spec.octaves < 1) throw new Error(`fbm: octaves must be a positive integer, got ${spec.octaves}`);
  return spec.octaves;
}

/** Fractal gradient noise, normalised by the total amplitude so the range stays within [-1, 1]. */
export function fbm2(p: In<"vec2">, spec: Fbm): Expr<"f32"> {
  const n = octavesOf(spec);
  let q: Expr<"vec2"> = lift<"vec2">(p);
  let amp: Expr<"f32"> = f(1);
  let sum: Expr<"f32"> = f(0), total: Expr<"f32"> = f(0);
  for (let i = 0; i < n; i++) {
    sum = add(sum, mul(noise2(q), amp));
    total = add(total, amp);
    amp = mul(amp, spec.gain);
    q = add(mul(q, spec.lacunarity), lift<"vec2">([OFFSET[0], OFFSET[1]]));
  }
  return div(sum, total);
}

/** Fractal gradient noise, normalised by the total amplitude so the range stays within [-1, 1]. */
export function fbm3(p: In<"vec3">, spec: Fbm): Expr<"f32"> {
  const n = octavesOf(spec);
  let q: Expr<"vec3"> = lift<"vec3">(p);
  let amp: Expr<"f32"> = f(1);
  let sum: Expr<"f32"> = f(0), total: Expr<"f32"> = f(0);
  for (let i = 0; i < n; i++) {
    sum = add(sum, mul(noise3(q), amp));
    total = add(total, amp);
    amp = mul(amp, spec.gain);
    q = add(mul(q, spec.lacunarity), lift<"vec3">([OFFSET[0], OFFSET[1], OFFSET[2]]));
  }
  return div(sum, total);
}

// ---- cellular noise -----------------------------------------------------------------------------------------------

// One jittered feature point per unit cell, found by searching the 3x3 (or 3x3x3) neighbourhood. That search can miss the
// true second-nearest point when the jitter is extreme; both backends search identically, so they still agree.
const CELLULAR2 = {
  name: "loft_cellular2", ret: "vec2", deps: [H2, LAT, UNIT, PCG],
  wgsl: `fn loft_cellular2(p: vec2<f32>) -> vec2<f32> {
  let ix = loft_lat(p.x);
  let iy = loft_lat(p.y);
  let f = p - floor(p);
  var d1 = 8.0;
  var d2 = 8.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let h = loft_h2(ix + bitcast<u32>(i), iy + bitcast<u32>(j));
      let r = vec2<f32>(f32(i), f32(j)) + vec2<f32>(loft_unit(h), loft_unit(loft_pcg(h))) - f;
      let d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
  }
  return vec2<f32>(sqrt(d1), sqrt(d2));
}`,
  js: (p: number[]) => {
    const ix = lat(p[0]), iy = lat(p[1]);
    const x = p[0] - Math.floor(p[0]), y = p[1] - Math.floor(p[1]);
    let d1 = 8, d2 = 8;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const h = h2u((ix + i) >>> 0, (iy + j) >>> 0);
      const rx = i + unit(h) - x, ry = j + unit(pcg(h)) - y;
      const d = rx * rx + ry * ry;
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    return [Math.sqrt(d1), Math.sqrt(d2)];
  },
} satisfies LibFn;

const CELLULAR3 = {
  name: "loft_cellular3", ret: "vec2", deps: [H3, LAT, UNIT, PCG],
  wgsl: `fn loft_cellular3(p: vec3<f32>) -> vec2<f32> {
  let ix = loft_lat(p.x);
  let iy = loft_lat(p.y);
  let iz = loft_lat(p.z);
  let f = p - floor(p);
  var d1 = 8.0;
  var d2 = 8.0;
  for (var k = -1; k <= 1; k++) {
    for (var j = -1; j <= 1; j++) {
      for (var i = -1; i <= 1; i++) {
        let h = loft_h3(ix + bitcast<u32>(i), iy + bitcast<u32>(j), iz + bitcast<u32>(k));
        let h1 = loft_pcg(h);
        let r = vec3<f32>(f32(i), f32(j), f32(k)) + vec3<f32>(loft_unit(h), loft_unit(h1), loft_unit(loft_pcg(h1))) - f;
        let d = dot(r, r);
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
      }
    }
  }
  return vec2<f32>(sqrt(d1), sqrt(d2));
}`,
  js: (p: number[]) => {
    const ix = lat(p[0]), iy = lat(p[1]), iz = lat(p[2]);
    const x = p[0] - Math.floor(p[0]), y = p[1] - Math.floor(p[1]), z = p[2] - Math.floor(p[2]);
    let d1 = 8, d2 = 8;
    for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const h = h3u((ix + i) >>> 0, (iy + j) >>> 0, (iz + k) >>> 0), h1 = pcg(h);
      const rx = i + unit(h) - x, ry = j + unit(h1) - y, rz = k + unit(pcg(h1)) - z;
      const d = rx * rx + ry * ry + rz * rz;
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    return [Math.sqrt(d1), Math.sqrt(d2)];
  },
} satisfies LibFn;

/** Distance to the nearest (x) and second-nearest (y) jittered feature point, one per unit cell: both in [0, ~1.5]. */
export const cellular2 = (p: In<"vec2">): Expr<"vec2"> => lib<"vec2">(CELLULAR2, p);
/** Distance to the nearest (x) and second-nearest (y) jittered feature point, one per unit cube: both in [0, ~1.7]. */
export const cellular3 = (p: In<"vec3">): Expr<"vec2"> => lib<"vec2">(CELLULAR3, p);
