// RECIPE: a sea serpent at any size. Copy this file and edit it; it imports only the library's public entry.
//
// What it makes, and from what. The anatomy of examples/serpent.ts with every head measure multiplied by `size` and the
// body's girth given by the scene, every drawable's name prefixed so two wyrms can share a scene (examples/serpent.ts
// builds one at one size: its girth is a global param, and params are global by name). The body is a `strand` on the
// scene's spine with a girth curve (`keys`) and countershaded, banded paint (`palette`); the head, jaw, eyes and horns
// are strands carried `on` the body and the head (so they ride its coordinates); the teeth are `draw.points`; the
// dorsal crest and the tail fins are `crest`s standing on the body. Head toward the spine's m = 0.
//
// Parameters (`WyrmSpec`): the spine (a function of m: it may move in time), stations and rings along it, girth, size,
// gape (an expression), colours, the crest's span and height, the bands, and a paint to replace the default.
//
// What it cannot do:
// - another head: the skull, jaw, horns and teeth are serpent.ts's, only scaled (no snout length or horn count of its own);
// - limbs, or anything not carried on the body or the head;
// - a body section that is not one rounded oval (aspect 1.05, squareness 2.2) along all its length;
// - a spine it does not get from the scene: it swims only as the scene's spine moves.
//
// Copying it: change the girth curve and the head's `section` first (they are the silhouette), then the paint.
// Relatives worth trying: the same build on a spine that coils (the library's `spiralLine` gives one) is a snake
// at rest; the head's strands with `forward` turned down and a longer jaw are an eel's; the crest made `fan`s is a
// dragon's frill.

import {
  abs, add, cos, sheetOn, cross, dot, draw, keys, lift, lt, mix, mod, mul, normalize, on, palette, place, points, rotateAbout as rotate,
  select, sin, smoothstep, strand, sub, TAU, through, time, vec3,
  type Drawable, type F, type In, type P3, type Strand,
} from "../../../src/index.ts";

export type Rgb = readonly [number, number, number];

export type WyrmColours = {
  readonly back: Rgb; readonly belly: Rgb; readonly band: Rgb; readonly membrane: Rgb;
  readonly bone: Rgb; readonly iris: Rgb; readonly mouth: Rgb;
};

export type WyrmSpec = {
  readonly name: string;
  readonly spine: (m: F) => P3;
  readonly stations: number;
  /** Half-width at the widest point of the body, world units. */
  readonly girth: number;
  /** Head measures relative to examples/serpent.ts (1 = a 2.2-long skull). */
  readonly size: number;
  /** Jaw opening, radians. */
  readonly gape: In<"f32">;
  readonly colours: WyrmColours;
  /** Rings along the body (the strand's vertex grid). */
  readonly along: number;
  /** Dorsal crest span on m and peak height (world units). */
  readonly crest: { readonly from: number; readonly to: number; readonly height: number };
  /** Saddle bands painted down the back. */
  readonly bands: number;
  /** Body paint (m, v); default countershading with saddle bands. */
  readonly paint?: (m: F, v: F) => P3;
};

export type Wyrm = {
  readonly body: Strand; readonly head: Strand; readonly jaw: Strand; readonly eyes: readonly Strand[];
  readonly things: readonly Drawable[];
};

export function wyrm(s: WyrmSpec): Wyrm {
  const n = (part: string) => `${s.name}${part}`;
  const C = s.colours, k = s.size;
  const girth = keys([[0, 0.55], [0.035, 0.62], [0.12, 0.92], [0.3, 1], [0.6, 0.95], [0.85, 0.75], [1, 0.25]]);
  const bodyPaint = s.paint ?? ((m: F, v: F) => palette.bands(m, v, palette.countershade(v, { back: C.back, belly: C.belly }), { colour: C.band, count: s.bands, width: 0.45, from: 0.06, to: 0.96 }));
  const body = strand({
    name: s.name, spine: s.spine, stations: s.stations,
    girth: (m) => mul(girth(m).x, s.girth), section: { aspect: 1.05, squareness: 2.2 },
    tips: [{ round: 0.01 }, { point: 0.05 }], level: 1.2, paint: bodyPaint,
    detail: { along: s.along, around: 28 },
  });

  // ---- head: the anatomy of examples/serpent.ts at `size` ---------------------------------------------------------
  const PITCH = 0.24;
  const X: In<"vec3"> = [1, 0, 0], Y: In<"vec3"> = [0, 1, 0], Z: In<"vec3"> = [0, 0, 1];
  const forward = rotate(mul(lift<"vec3">(X), -1), Z, PITCH);
  const crown = rotate(Y, Z, PITCH);
  const hw = 0.65 * k, hh = 0.475 * k, hl = 2.2 * k;
  const backOfHead = mul(lift<"vec3">(X), 0.12 * hl);
  const skullPoints = [0, 0.35, 0.7, 1].map((u) => add(backOfHead, sub(mul(forward, hl * u), mul(crown, 0.06 * hl * u * u))));
  const section = (at: readonly number[], width: readonly number[], height: readonly number[]) => ({
    girth: keys(at.map((x, i) => [x, width[i]] as const)), aspect: keys(at.map((x, i) => [x, height[i] / width[i]] as const)),
  });
  const skull = section([0, 0.3, 0.62, 1], [hw * 0.8, hw, hw * 0.78, hw * 0.45], [hh * 0.85, hh, hh * 0.72, hh * 0.36]);
  const head = place(strand({
    name: n("Head"), spine: (m) => through(m, skullPoints), stations: 12,
    girth: (m) => skull.girth(m).x, section: { aspect: (m) => skull.aspect(m).x, squareness: 2.8 },
    tips: [{ round: 0.22 }, { round: 0.1 }], up: crown,
    paint: (m, v) => mix(
      palette.countershade(v, { back: mix(vec3(...C.back), vec3(...C.band), smoothstep(0.55, 1.0, m)), belly: C.belly }),
      vec3(...C.mouth), mul(smoothstep(0.8, 0.9, mul(sin(mul(v, TAU)), -1)), smoothstep(0.3, 0.4, m))),
    detail: { along: 48, around: 28 },
  }), on(body, [0, 0.25, 0]));

  const gape = lift<"f32">(s.gape);
  const jawDir = vec3(cos(gape), sin(gape), 0);
  const hinge = vec3(0, hh * 0.9, 0);
  const jl = 1.5 * k;
  const chin = section([0, 0.45, 1], [hw * 0.7, hw * 0.72, hw * 0.43], [hh * 0.3, hh * 0.26, hh * 0.16]);
  const jaw = place(strand({
    name: n("Jaw"),
    spine: (m) => through(m, [sub(hinge, mul(jawDir, 0.15 * jl)), add(hinge, mul(jawDir, 0.5 * jl)), add(hinge, mul(jawDir, jl))]),
    stations: 8, girth: (m) => chin.girth(m).x, section: { aspect: (m) => chin.aspect(m).x, squareness: 2.6 },
    tips: [{ round: 0.15 }, { round: 0.12 }], up: vec3(sin(gape), mul(cos(gape), -1), 0),
    paint: (_m, v) => mix(palette.countershade(v, { back: C.back, belly: C.belly }), vec3(...C.mouth), smoothstep(0.75, 0.85, sin(mul(v, TAU)))),
    detail: { along: 32, around: 24 },
  }), on(head, [0.25, 0.75, 0]));

  function hornAt(name: string, v: number) {
    const TIGHTEN = 0.45, N = 7, curl = 1.9, length = 1.7 * k, hg = 0.17 * k;
    const o = normalize(vec3(0.3 * Math.sin(PITCH), 1, 0));
    const back = vec3(-1, 0.2, 0);
    const b = normalize(sub(back, mul(o, dot(back, o))));
    const norm = Math.hypot(1, TIGHTEN);
    const e1 = [-TIGHTEN / norm, 1 / norm], e2 = [-1 / norm, -TIGHTEN / norm];
    const scale = length / ((norm / TIGHTEN) * (1 - Math.exp(-TIGHTEN * curl)));
    const pts = Array.from({ length: N }, (_, i) => {
      const th = (curl * i) / (N - 1), r = Math.exp(-TIGHTEN * th);
      const d = [r * Math.cos(th) - 1, r * Math.sin(th)];
      const alongOut = d[0] * e1[0] + d[1] * e1[1], toward = d[0] * e2[0] + d[1] * e2[1];
      return i === 0 ? mul(o, -hg * 0.6) : add(mul(o, alongOut * scale), mul(b, toward * scale));
    });
    const profile = keys([[0, hg], [0.45, hg * 0.62], [1, hg * 0.08]]);
    return place(strand({
      name, spine: (m) => through(m, pts), stations: 12, girth: (m) => profile(m).x, tips: ["open", { point: 0.2 }], up: cross(o, b),
      paint: (m) => mix(vec3(...C.bone), mul(vec3(...C.bone), 0.62), smoothstep(0.2, 1.0, m)), detail: { along: 24, around: 12 },
    }), on(head, [0.14, v, 1]));
  }

  function eyeAt(name: string, v: number) {
    const r = 0.13 * k * 1.25, c = vec3(0, r * 0.25, 0);
    const up: In<"vec3"> = [0, 0, -Math.sign(Math.cos(TAU * v))];
    return place(strand({
      name, spine: (m) => through(m, [sub(c, mul(lift<"vec3">(Y), r)), add(c, mul(lift<"vec3">(Y), r))]), stations: 4,
      girth: r, tips: [{ round: 0.5 }, { round: 0.5 }], up,
      paint: (m, vv) => {
        const iris = mix(mul(vec3(...C.iris), 0.7), vec3(...C.iris), smoothstep(0.55, 0.8, m));
        const slit = mul(smoothstep(0.8, 0.86, m), sub(1, smoothstep(0.25, 0.4, abs(cos(mul(vv, TAU))))));
        return mix(iris, vec3(0.04, 0.02, 0.06), slit);
      },
      detail: { along: 16, around: 16 },
    }), on(head, [0.47, v, 1]));
  }

  const SPLAY = 0.7;
  const horns = [-1, 1].map((side) => hornAt(n(side < 0 ? "HornL" : "HornR"), 0.25 + (side * SPLAY) / TAU));
  const eyes = [-1, 1].map((side) => eyeAt(n(side < 0 ? "EyeL" : "EyeR"), 0.25 + side * (0.25 - 0.8 / TAU)));

  // ---- teeth and spikes -------------------------------------------------------------------------------------------
  const cone = (name: string, length: number, cg: number, lean: number, paint: Rgb) => strand({
    name, spine: (m) => through(m, [[0, -0.15 * length, 0], [lean * 0.4 * length, 0.5 * length, 0], [lean * length, length, 0]]),
    stations: 5, girth: cg, tips: ["open", { point: 0.85 }], up: [1, 0, 0], paint, detail: { along: 8, around: 8 },
  });
  const TEETH = 6, tl = 0.2 * k;
  const tooth = cone(n("Tooth"), tl, tl * 0.24, 0.1, C.bone);
  const row = (i: F, count: number) => ({ j: mod(i, count), side: select(lt(i, count), -1, 1) });
  const teethUp = draw.points(n("TeethUp"), place(points(2 * TEETH, (i) => {
    const { j, side } = row(i, TEETH);
    return { at: vec3(add(0.45, mul(add(j, 0.5), 0.42 / TEETH)), add(0.75, mul(side, 0.1)), 0.92), scale: add(0.8, mul(j, 0.45 / TEETH)) };
  }), head), tooth);
  const teethDown = draw.points(n("TeethDown"), place(points(2 * TEETH, (i) => {
    const { j, side } = row(i, TEETH);
    return { at: vec3(add(0.34, mul(add(j, 0.5), 0.5 / TEETH)), add(0.25, mul(side, 0.12)), 0.92), scale: add(0.7, mul(j, 0.3 / TEETH)) };
  }), jaw), tooth);

  // ---- the crest: a membrane down the back that ripples with a wave running tailward --------------------------------
  const profile = keys([[0, 0], [0.06, 1], [0.35, 0.85], [0.75, 0.55], [1, 0]]);
  const dorsal = sheetOn({
    on: body, from: s.crest.from, to: s.crest.to, name: n("Crest"),
    height: (x: In<"f32">) => mul(profile(x).x, s.crest.height),
    paint: C.membrane, rays: 22, sag: 0.4, rake: 0.6,
    flutter: (m) => mul(sin(mul(sub(mul(m, 4), mul(time, 0.8)), TAU)), 0.25),
    rows: 220,
  });
  const tailFins = [-1, 1].map((side) => sheetOn({
    on: body, from: 0.86, to: 0.995, name: n(side < 0 ? "TailL" : "TailR"), v: 0.25 + side * 0.09,
    height: keys([[0, 0], [0.45, 0.7 * s.girth], [0.85, 2.2 * s.girth], [1, 0]]),
    paint: C.membrane, rays: 7, sag: 0.25, rake: 0.9, rows: 48,
  }));

  return { body, head, jaw, eyes, things: [body, head, jaw, ...horns, ...eyes, teethUp, teethDown, dorsal, ...tailFins] };
}
