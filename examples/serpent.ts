// A sea serpent as data: named numbers, curves, and closed-form motion. The head is placed on the neck's chart, the
// jaw, horns and eyes on the head's, and teeth and dorsal spikes are points placed on head, jaw and body in body
// coordinates, so every part moves with the body exactly; foam and shadows are derived by the compiler. Head toward
// +x. Ported from keel's preview_probe `serpent.rs`.

import {
  add, sheetOn, draw, lift, cross, dot, floor, keys, lt, mod, mul, normalize, on, palette, param, place, points, retarded,
  rotateAbout as rotate, scene, sea, select, sin, smoothstep, strand, sub, TAU, through, time, toon, vec3, wave, abs, cos, mix,
  type Drawable, type Expr, type In, type Strand, type StrandSpec,
} from "../src/index.ts";

export const S = {
  // body
  length: 15, girth: 0.64, neckGirth: 0.66, tailGirth: 0.4, depth: 1.12, squareness: 2.3,
  // posture
  ride: -0.85, neckRise: 3.7, neckReach: 1.7, neckArch: 0.95, humps: 2.5, humpHeight: 1.65, tailLift: 1.2,
  // swimming
  coils: 1.6, coilWidth: 1.5, swimRate: 0.42, headSteady: 0.12, humpRate: 0.3, followSpeed: 1.5, headScan: 0.7,
  // head
  headLength: 2.2, headWidth: 1.3, headHeight: 0.95, snout: 0.45, headPitch: 0.24, jawLength: 1.5, jawGape: 0.22, teeth: 6, toothLength: 0.2,
  eyeSize: 0.13, hornLength: 1.7, hornCurl: 1.9, hornSplay: 0.7, hornGirth: 0.17,
  // crest
  crestHeight: 1.25, crestSpan: [0.05, 0.6] as const, crestRake: 0.55, crestRays: 13, crestSag: 0.36,
  // colour: saturated, so the creature reads against the water
  back: [0.34, 0.17, 0.62], belly: [1.0, 0.88, 0.6], band: [0.6, 0.48, 1.0], membrane: [1.0, 0.33, 0.4],
  bone: [1.0, 0.95, 0.82], iris: [1.0, 0.78, 0.12], mouth: [0.86, 0.2, 0.36],
} as const;

const NECK = 6, BODY = 16, POINTS = NECK + BODY - 1;
/** Shift so the body sits around the origin. */
const CENTRE = S.length * 0.42;
const neckEnd = NECK / POINTS;
const ramp01 = (x: number, a: number, b: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const rise = param("serpent.neckRise", S.neckRise, { min: 0.5, max: 7 });
const humpHeight = param("serpent.humpHeight", S.humpHeight, { min: 0, max: 3 });

/** The posture at time t: an S-neck rising from the sea, then a body whose coils and humps travel to the tail. */
function controlPoint(i: number): Expr<"vec3"> {
  // Head motion (scan side to side, nod) runs down the neck on a retarded clock: the head leads, the neck follows.
  const along = i / POINTS;
  const neck = 1 - ramp01(along, 0.02, 0.34);
  const clock = retarded(time, along, S.followSpeed);
  const scan = mul(add(sin(mul(clock, 0.55)), mul(sin(add(mul(clock, 1.27), 1.3)), 0.45)), S.headScan * neck);
  const nod = mul(sin(mul(clock, 0.8)), mul(rise, 0.04 * neck));
  if (i < NECK) {
    const q = 1 - i / NECK;
    const sway0 = wave(0, { axis: [0, 0, 1], waves: S.coils, rate: S.swimRate, amplitude: S.coilWidth * S.headSteady * (1 - q) * (1 - q) });
    const y = add(add(S.ride, mul(rise, Math.sin((q * Math.PI) / 2))), nod);
    return add(add(vec3(S.neckReach * q - S.neckArch * Math.sin(Math.PI * q) + CENTRE, y, 0), sway0), vec3(0, 0, scan));
  }
  const p = (i - NECK) / (BODY - 1);
  const hump = sin(mul(sub(S.humps * p, mul(time, S.humpRate)), Math.PI));
  const lift = mul(mul(hump, hump), mul(humpHeight, ramp01(p, 0, 0.14) * (1 - 0.3 * p)));
  const y = add(S.ride + S.tailLift * ramp01(p, 0.78, 1), lift);
  const sway = wave(p, { axis: [0, 0, 1], waves: S.coils, rate: S.swimRate, amplitude: S.coilWidth, grow: S.headSteady + (1 - S.headSteady) * p ** 1.3 });
  return add(add(vec3(-S.length * p + CENTRE, y, 0), sway), vec3(0, 0, scan));
}
const spinePoints = Array.from({ length: NECK + BODY }, (_, i) => controlPoint(i));
/** The swimming posture: the spine without any attack. */
export const restSpine = (m: Expr<"f32">): Expr<"vec3"> => through(m, spinePoints);

const g = S.girth;
const girth = keys([[0, S.neckGirth * 0.9], [neckEnd * 0.75, S.neckGirth], [neckEnd + 0.07, 1], [0.55, 0.9], [0.86, S.tailGirth], [1, S.tailGirth * 0.45]]);
const girthScale = param("serpent.girth", g, { min: 0.2, max: 1.6 });

/** The body's spec, exported so other scenes can draw this body with another paint (examples/serpent_scales.ts). */
export const bodySpec = {
  name: "serpent",
  spine: restSpine,
  stations: 48,
  girth: (m: Expr<"f32">) => mul(girth(m).x, girthScale),
  section: { aspect: S.depth, squareness: S.squareness },
  tips: [{ round: 0.012 }, { point: 0.045 }] as const,
  level: 1.2,
  paint: (m: Expr<"f32">, v: Expr<"f32">) => palette.bands(m, v, palette.countershade(v, { back: S.back, belly: S.belly }), { colour: S.band, count: 9, width: 0.5, from: neckEnd * 0.5, to: 0.97 }),
  detail: { along: 160, around: 28 },
} satisfies StrandSpec;

/** The serpent's parts, all riding one body. */
export type Serpent = { readonly body: Strand; readonly head: Strand; readonly jaw: Strand; readonly eyes: readonly Strand[]; readonly things: readonly Drawable[] };

/**
 * The serpent built on a spine (the swimming posture `restSpine`, or one an attack poses: examples/strike.ts) with a
 * jaw opening of `gape` radians. Everything else rides the body, so it follows whatever the spine does.
 */
export function serpent(o: { readonly spine: (m: Expr<"f32">) => Expr<"vec3">; readonly gape: In<"f32"> }): Serpent {
  const body = strand({ ...bodySpec, spine: o.spine });

  // ---- head: a skull riding the neck's first frame, a hinged jaw, horns, eyes -------------------------------------
  //
  // Each part is authored in its host's local frame at the point it is placed on: x along the host's spine (toward increasing
  // m), y out of its skin at v, z = x cross y.

  /** Directions in the frame of the top of the neck (m = 0, on the spine): x runs down the neck, y is the back. */
  const X: In<"vec3"> = [1, 0, 0], Y: In<"vec3"> = [0, 1, 0], Z: In<"vec3"> = [0, 0, 1];
  const forward = rotate(mul(lift<"vec3">(X), -1), Z, S.headPitch);
  const crown = rotate(Y, Z, S.headPitch);
  const hw = S.headWidth / 2, hh = S.headHeight / 2, hl = S.headLength;
  const backOfHead = mul(lift<"vec3">(X), 0.12 * hl);
  const skullPoints = [0, 0.35, 0.7, 1].map((u) => add(backOfHead, sub(mul(forward, hl * u), mul(crown, 0.06 * hl * u * u))));

  /** Width keys and height keys at the same positions become a girth curve and an aspect curve. */
  function section(at: readonly number[], width: readonly number[], height: readonly number[]) {
    return { girth: keys(at.map((x, i) => [x, width[i]] as const)), aspect: keys(at.map((x, i) => [x, height[i] / width[i]] as const)) };
  }
  const skull = section([0, 0.3, 0.62, 1], [hw * 0.8, hw, hw * 0.78, hw * S.snout], [hh * 0.85, hh, hh * 0.72, hh * S.snout * 0.8]);
  const head = place(strand({
    name: "head",
    spine: (m) => through(m, skullPoints),
    stations: 12,
    girth: (m) => skull.girth(m).x,
    section: { aspect: (m) => skull.aspect(m).x, squareness: 2.8 },
    tips: [{ round: 0.22 }, { round: 0.1 }],
    up: crown,
    // The palate (underside, forward of the throat) is mouth-coloured: it shows when the jaw opens.
    paint: (m, v) => mix(
      palette.countershade(v, { back: mix(vec3(...S.back), vec3(...S.band), smoothstep(0.55, 1.0, m)), belly: S.belly }),
      vec3(...S.mouth), mul(smoothstep(0.8, 0.9, mul(sin(mul(v, TAU)), -1)), smoothstep(0.3, 0.4, m))),
    detail: { along: 48, around: 28 },
  }), on(body, [0, 0.25, 0]));

  // The jaw hangs from the head's spine at m = 0.25 in the frame facing the belly (v = 0.75): x forward along the head,
  // y down. Opening turns it about z, toward y.
  const gape = lift<"f32">(o.gape);
  const jawDir = vec3(cos(gape), sin(gape), 0);
  const hinge = vec3(0, hh * 0.9, 0);
  const chin = section([0, 0.45, 1], [hw * 0.7, hw * 0.72, hw * S.snout * 0.95], [hh * 0.3, hh * 0.26, hh * 0.16]);
  const jaw = place(strand({
    name: "jaw",
    spine: (m) => through(m, [sub(hinge, mul(jawDir, 0.15 * S.jawLength)), add(hinge, mul(jawDir, 0.5 * S.jawLength)), add(hinge, mul(jawDir, S.jawLength))]),
    stations: 8,
    girth: (m) => chin.girth(m).x,
    section: { aspect: (m) => chin.aspect(m).x, squareness: 2.6 },
    tips: [{ round: 0.15 }, { round: 0.12 }],
    // The jaw's back faces the head's belly side: up is -y, turned with the jaw.
    up: vec3(sin(gape), mul(cos(gape), -1), 0),
    // The top of the jaw is the floor of the mouth.
    paint: (_m, v) => mix(palette.countershade(v, { back: S.back, belly: S.belly }), vec3(...S.mouth), smoothstep(0.75, 0.85, sin(mul(v, TAU)))),
    detail: { along: 32, around: 24 },
  }), on(head, [0.25, 0.75, 0]));

  /**
   * A horn on the head's skin at round-position v: a strand on a logarithmic-spiral spine leaving the skin along y
   * (tilted forward a little) and curling back along -x (the head's x runs toward the snout).
   */
  function horn(name: string, v: number) {
    const TIGHTEN = 0.45, N = 7, curl = S.hornCurl;
    const o = normalize(vec3(0.3 * Math.sin(S.headPitch), 1, 0));
    const back = vec3(-1, 0.2, 0);
    const b = normalize(sub(back, mul(o, dot(back, o))));
    const norm = Math.hypot(1, TIGHTEN);
    const e1 = [-TIGHTEN / norm, 1 / norm], e2 = [-1 / norm, -TIGHTEN / norm];
    const scale = S.hornLength / ((norm / TIGHTEN) * (1 - Math.exp(-TIGHTEN * curl)));
    const pts = Array.from({ length: N }, (_, i) => {
      const th = (curl * i) / (N - 1), r = Math.exp(-TIGHTEN * th);
      const d = [r * Math.cos(th) - 1, r * Math.sin(th)];
      const alongOut = d[0] * e1[0] + d[1] * e1[1], toward = d[0] * e2[0] + d[1] * e2[1];
      return i === 0 ? mul(o, -S.hornGirth * 0.6) : add(mul(o, alongOut * scale), mul(b, toward * scale));
    });
    const profile = keys([[0, S.hornGirth], [0.45, S.hornGirth * 0.62], [1, S.hornGirth * 0.08]]);
    return place(strand({
      name, spine: (m) => through(m, pts), stations: 12, girth: (m) => profile(m).x, tips: ["open", { point: 0.2 }],
      up: cross(o, b),
      paint: (m) => mix(vec3(...S.bone), mul(vec3(...S.bone), 0.62), smoothstep(0.2, 1.0, m)),
      detail: { along: 24, around: 12 },
    }), on(head, [0.14, v, 1]));
  }

  /** An eye: a two-point strand with round tips is a ball, set into the skin along y. Amber, with a slit pupil facing out. */
  function eye(name: string, v: number) {
    const r = S.eyeSize, c = vec3(0, r * 0.25, 0);
    // The slit stands upright: its frame starts from the head's crown, which in this frame lies along -z or +z.
    const up: In<"vec3"> = [0, 0, -Math.sign(Math.cos(TAU * v))];
    return place(strand({
      name, spine: (m) => through(m, [sub(c, mul(lift<"vec3">(Y), r)), add(c, mul(lift<"vec3">(Y), r))]), stations: 4,
      girth: r, tips: [{ round: 0.5 }, { round: 0.5 }], up,
      paint: (m, vv) => {
        const iris = mix(mul(vec3(...S.iris), 0.7), vec3(...S.iris), smoothstep(0.55, 0.8, m));
        const slit = mul(smoothstep(0.8, 0.86, m), sub(1, smoothstep(0.25, 0.4, abs(cos(mul(vv, TAU))))));
        return mix(iris, vec3(0.04, 0.02, 0.06), slit);
      },
      detail: { along: 16, around: 16 },
    }), on(head, [0.47, v, 1]));
  }

  const parts = [-1, 1].flatMap((side) => {
    const tag = side < 0 ? "L" : "R";
    return [horn(`horn${tag}`, 0.25 + (side * S.hornSplay) / TAU), eye(`eye${tag}`, 0.25 + side * (0.25 - 0.8 / TAU))];
  });

  // ---- teeth and spikes: small strands drawn at points placed in body coordinates ------------------------------------

  /** A cone standing on the local y axis, root slightly sunk into the skin. */
  const cone = (name: string, length: number, girth: number, lean: number, paint: readonly [number, number, number]) => strand({
    name, spine: (m) => through(m, [[0, -0.15 * length, 0], [lean * 0.4 * length, 0.5 * length, 0], [lean * length, length, 0]]),
    stations: 5, girth, tips: ["open", { point: 0.85 }], up: [1, 0, 0], paint, detail: { along: 8, around: 8 },
  });
  const tooth = cone("tooth", S.toothLength, S.toothLength * 0.24, 0.1, S.bone);

  /** Instance i of `n` per side: which side (-1, 1) and its index along the row. */
  const row = (i: Expr<"f32">, n: number) => ({ j: mod(i, n), side: select(lt(i, n), -1, 1) });
  const teethUp = draw.points("teethUp", place(points(2 * S.teeth, (i) => {
    const { j, side } = row(i, S.teeth);
    return { at: vec3(add(0.45, mul(add(j, 0.5), 0.42 / S.teeth)), add(0.75, mul(side, 0.1)), 0.92), scale: add(0.8, mul(j, 0.45 / S.teeth)) };
  }), head), tooth);
  const teethDown = draw.points("teethDown", place(points(2 * S.teeth, (i) => {
    const { j, side } = row(i, S.teeth);
    return { at: vec3(add(0.34, mul(add(j, 0.5), 0.5 / S.teeth)), add(0.25, mul(side, 0.12)), 0.92), scale: add(0.7, mul(j, 0.3 / S.teeth)) };
  }), jaw), tooth);

  const SPIKES = 7;
  const spike = cone("spike", 0.55, 0.13, 0.7, [0.86, 0.26, 0.34]);
  // Smaller toward the tail.
  const spikes = draw.points("spikes", place(points(SPIKES, (i) => ({ at: vec3(add(0.63, mul(i, 0.19 / (SPIKES - 1))), 0.25, 0.9), scale: sub(1.1, mul(floor(i), 0.45 / (SPIKES - 1))) })), body), spike);

  // ---- fins ---------------------------------------------------------------------------------------------------------

  const crestHeight = param("serpent.crestHeight", S.crestHeight, { min: 0, max: 3 });
  const crestProfile = keys([[0, 0], [0.07, 1], [0.35, 0.85], [0.75, 0.6], [1, 0]]);
  const dorsal = sheetOn({
    on: body, from: S.crestSpan[0], to: S.crestSpan[1], name: "dorsal",
    height: (x: In<"f32">) => mul(crestProfile(x), crestHeight),
    paint: S.membrane, rays: S.crestRays, sag: S.crestSag, rake: S.crestRake,
    // The crest sways on a wave running down the body, twice the swimming rate.
    flutter: (m) => mul(sin(mul(sub(mul(m, 2.5), mul(time, S.swimRate * 2)), TAU)), 0.3),
    rows: 120,
  });
  // The tail fin is two lobes splayed either side of the dorsal line: a single membrane went edge-on (a thin spike)
  // whenever the tail swung its plane through the camera, which the rising tail does in the three-quarter view.
  const TAIL_SPLAY = 0.09;
  const tailFins = [-1, 1].map((side) => sheetOn({
    on: body, from: 0.84, to: 0.995, name: `tailfin${side < 0 ? "L" : "R"}`, v: 0.25 + side * TAIL_SPLAY,
    height: keys([[0, 0], [0.45, 0.7], [0.85, 1.5], [1, 0]]),
    paint: S.membrane, rays: 6, sag: 0.25, rake: 0.9, rows: 48,
  }));

  return { body, head, jaw, eyes: parts.filter((_, i) => i % 2 === 1), things: [body, head, jaw, ...parts, teethUp, teethDown, spikes, dorsal, ...tailFins] };
}

/** The swimming serpent's jaw: a slow chew. */
export const restGape = mul(add(1, mul(sin(mul(time, 0.9)), 0.4)), S.jawGape);

const swimming = serpent({ spine: restSpine, gape: restGape });

export default scene({
  ground: sea({
    swell: [
      { direction: [1, 0.3], length: 14, height: 0.35, speed: 1.1 },
      { direction: [-0.3, 1], length: 6.5, height: 0.12, speed: 0.8, phase: 1.3 },
    ],
  }),
  things: swimming.things,
  style: toon({ bands: 3, outline: 0.04 }),
  sun: [-0.45, 0.75, 0.5],
  cameras: {
    front: { kind: "perspective", eye: [21, 5, 5], target: [3, 1.6, 0], fovY: 0.6 },
    side: { kind: "perspective", eye: [-0.5, 4, 28], target: [-0.5, 1.2, 0], fovY: 0.6 },
    top: { kind: "orthographic", eye: [-0.5, 40, 0.001], target: [-0.5, 0, 0], height: 19 },
    three: { kind: "perspective", eye: [14, 8.5, 16], target: [0, 1, 0], fovY: 0.6 },
  },
});
