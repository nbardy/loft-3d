// The creature parts library (src/geom/limb, gait, fan, spiral, symmetry): the geometric promises each part makes,
// checked on the CPU backend over sweeps of inputs.
import { expect, test } from "bun:test";
import {
  compileJs, course, fan, gait, chain, mirror, scene, sea, coil, sin, strand, through, time, toon, variable, vec3, mul, add,
  catenary, f, mapNormal, type Expr, type V,
} from "../src/index.ts";
import { compileScene } from "../src/compile/index.ts";
import { stateAt } from "./compile.harness.ts";
import { v3, type V3 } from "../src/map/transport.ts";

const run = (roots: readonly Expr[]) => { const fn = compileJs(roots); return (vars: Record<string, V> = {}, t = 0) => fn({ vars, inputs: { time: t }, params: {} }) as V3[]; };
const dist = (a: V3, b: V3) => v3.len(v3.sub(a, b));
const T = variable("target", "vec3");

// Catches: a law-of-cosines slip (a sign, a swapped length, the clamp on the wrong side) that leaves the foot short of
// a reachable target or stretches a bone; an out-of-reach target that bends the chain instead of pointing it; the
// bend hint ignored (knees flipping). Two and three segments, over a grid of targets in and out of reach.
test("a limb reaches its target exactly in range, points straight at it out of range, and keeps its lengths", () => {
  const root: V3 = [0.3, 1, -0.2], bend: V3 = [0, 1, 0.3];
  const two = chain({ root, target: T, lengths: [2, 1.3], bend });
  const three = chain({ root, target: T, lengths: [2, 1.3, 0.6], bend, foot: [0, -1, 0] });
  const ev2 = run(two.joints), ev3 = run(three.joints);
  let reached = 0, straight = 0;
  for (let x = -4; x <= 4; x += 0.7) for (let y = -4; y <= 3; y += 0.9) for (let z = -3; z <= 3; z += 1.1) {
    const target: V3 = [x, y, z];
    const [r, k, tip] = ev2({ target });
    expect(Math.abs(dist(r, k) - 2)).toBeLessThan(1e-4);
    expect(Math.abs(dist(k, tip) - 1.3)).toBeLessThan(1e-4);
    const d = dist(root, target);
    if (d > 0.7 + 1e-3 && d < 3.3 - 1e-3) {
      expect(dist(tip, target)).toBeLessThan(1e-4 * Math.max(1, d));
      // On the bend side of the line from root to target.
      const e = v3.unit(v3.sub(target, root)), off = v3.sub(v3.sub(k, root), v3.scale(e, v3.dot(v3.sub(k, root), e)));
      expect(v3.dot(off, v3.sub(bend, v3.scale(e, v3.dot(bend, e))))).toBeGreaterThan(0);
      reached++;
    } else if (d > 3.3) {
      const e = v3.unit(v3.sub(target, root));
      expect(dist(k, v3.axpy(2, e, root))).toBeLessThan(1e-4);
      expect(dist(tip, v3.axpy(3.3, e, root))).toBeLessThan(1e-4);
      straight++;
    }
    const j3 = ev3({ target });
    [2, 1.3, 0.6].forEach((l, i) => expect(Math.abs(dist(j3[i], j3[i + 1]) - l)).toBeLessThan(1e-4));
    const ankle = v3.add(target, [0, 0.6, 0]), da = dist(root, ankle);
    if (da > 0.7 + 1e-3 && da < 3.3 - 1e-3) {
      expect(dist(j3[3], target)).toBeLessThan(1e-4 * Math.max(1, d));
      expect(dist(j3[2], ankle)).toBeLessThan(1e-4 * Math.max(1, d));
    }
  }
  expect(reached).toBeGreaterThan(50);
  expect(straight).toBeGreaterThan(50);
});

// Catches: a plant computed from the current time instead of the stance's middle (the foot would skate with the
// body), a phase applied to one term and not the other, an off-by-one cycle at the swing (a foot jumping a stride).
// Over two cycles on a curved course, every planted foot must stay fixed while the body moves under it, and every
// foot must move continuously.
test("a planted foot stays fixed in the world while the body walks over it", () => {
  const phase = [0, 0.5, 0.25, 0.75];
  const feet: V3[] = [[2, -1, 1.5], [2, -1, -1.5], [-2, -1, 1.5], [-2, -1, -1.5]];
  const g = gait({ feet, phase, course: course.arc([1, 0, 2], 0.4, 9, Math.PI / 2), stride: 1.6, pace: { kind: "time", period: 1.7 }, duty: 0.6, lift: 0.5 });
  const ev = run([...feet.map((_, i) => g.foot(i)), ...feet.map((_, i) => vec3(g.planted(i), 0, 0)), g.body.o]);
  const dt = 1 / 240;
  for (let i = 0; i < feet.length; i++) {
    let plant: V3 | undefined, bodyAtPlant: V3 = [0, 0, 0], prev: V3 | undefined, maxStep = 0, maxBodyMove = 0, stances = 0;
    for (let t = 0; t < 3.4; t += dt) {
      const out = ev({}, t);
      const foot = out[i], planted = (out[feet.length + i] as unknown as number[])[0], body = out[2 * feet.length];
      if (prev) maxStep = Math.max(maxStep, dist(prev, foot));
      prev = foot;
      if (planted > 0.5) {
        if (!plant) { plant = foot; bodyAtPlant = body; stances++; }
        expect(dist(foot, plant)).toBeLessThan(1e-6);
        maxBodyMove = Math.max(maxBodyMove, dist(body, bodyAtPlant));
      } else plant = undefined;
    }
    expect(stances).toBeGreaterThanOrEqual(2);
    // The body really moved under the planted foot (about stride * duty), so the check above is not vacuous.
    expect(maxBodyMove).toBeGreaterThan(0.8);
    // Continuous: no frame moves a foot more than a swing's top speed allows.
    expect(maxStep).toBeLessThan(0.1);
  }
});

// Catches: the membrane leaving its rays (a cell picking the wrong pair, the belly or cut not vanishing on a ray),
// the free edge cut outward instead of toward the root, a zigzag or sine where the catenary should be, and the belly
// on the wrong side. Four straight rays fanned in the xz plane from the origin: the front is d/du x d/dv.
test("a fan passes through its rays, its edge hangs toward the root as a catenary, and it bellies to the front", () => {
  const tips: V3[] = [[1, 0, 3], [2.2, 0, 2.2], [3, 0, 0.9], [3.2, 0, -0.6]];
  const rays = tips.map((p) => (m: Expr<"f32"> | number) => mul(vec3(...p), m));
  const sag = 0.2, scallop = 0.25, slack = 2;
  const s = fan({ rays, sag, scallop, slack });
  const U = variable("u", "f32"), Vv = variable("v", "f32");
  const ev = run([s.point(U, Vv), s.normal(U, Vv)]);
  for (let k = 0; k < tips.length; k++) for (const v of [0, 0.2, 0.5, 0.8, 1]) {
    expect(dist(ev({ u: k / 3, v })[0], v3.scale(tips[k], v))).toBeLessThan(1e-4);
  }
  const normal = ev({ u: 0.5, v: 0.5 })[1];
  for (let cell = 0; cell < 3; cell++) {
    const a = tips[cell], b = tips[cell + 1], chord = dist(a, b);
    // In the plane of the rays (y = 0), the edge is the chord pulled toward the root by scallop * chord * catenary(f).
    const inward = v3.scale(v3.unit(v3.add(a, b)), -1);
    for (const fr of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const p = ev({ u: (cell + fr) / 3, v: 1 })[0];
      const onChord = v3.add(v3.scale(a, 1 - fr), v3.scale(b, fr));
      const flat: V3 = [p[0] - onChord[0], 0, p[2] - onChord[2]];
      const want = scallop * chord * (evalF(catenary(f(fr), slack)));
      expect(Math.abs(v3.len(flat) - want)).toBeLessThan(1e-4);
      expect(v3.dot(flat, inward)).toBeGreaterThan(0);
    }
    // The belly at the middle of the cell, half way out, is along the front normal by sag * gap.
    const mid = ev({ u: (cell + 0.5) / 3, v: 0.5 })[0];
    const gap = dist(v3.scale(a, 0.5), v3.scale(b, 0.5));
    expect(mid[1] * Math.sign(normal[1])).toBeGreaterThan(0.9 * sag * gap);
  }
  // The catenary is not a parabola or a sine: at f = 0.25 it is above both for this slack.
  expect(evalF(catenary(f(0.25), 4))).toBeGreaterThan(0.75 + 1e-3);
});
const evalF = (e: Expr<"f32">) => (compileJs([e])({ vars: {}, inputs: {}, params: {} })[0] as number);

// Catches: whorls that do not scale by the stated growth (an exponent per radian taken as per turn, ridges whose
// count is not whole per whorl), and a section orientation that turns the front inward (a one-sided draw would cull
// the outside of the shell). Both coils, with ridges folded in.
test("a shell's successive whorls scale by the growth factor, and its front faces out", () => {
  for (const h of ["right", "left"] as const) {
    const turns = 3.5, growth = 2.3;
    const s = coil({ turns, growth, aperture: 1.2, umbilicus: 0.2, spire: 0.8, section: { aspect: 1.3, ridges: { perTurn: 9, height: 0.06 } }, hand: h });
    const U = variable("u", "f32"), Vv = variable("v", "f32");
    const ev = run([s.point(U, Vv), s.point(add(U, 1 / turns), Vv), s.normal(U, Vv)]);
    for (let u = 0.02; u < 1 - 1 / turns; u += 0.037) for (let v = 0; v < 1; v += 0.13) {
      const [p, q] = ev({ u, v });
      expect(dist(q, v3.scale(p, growth))).toBeLessThan(1e-4 * v3.len(q));
    }
    // v = 0 is the outer side of the section: the front must point away from the axis there.
    for (const u of [0.4, 0.7, 0.95]) {
      const [p, , n] = ev({ u, v: 0 });
      expect(n[0] * p[0] + n[2] * p[2]).toBeGreaterThan(0);
    }
  }
});

// Catches: a mirror that reflects the spine but not the frame seed or the twist (the skin rolls the wrong way), paint
// read at the wrong v, or a drawn surface whose front turns inward. The strand is deliberately asymmetric (a moving
// spine off the plane, a twist, levelling, a boxy section) and evaluated through the real pose pass.
test("a mirrored part is the mirror image of the part", () => {
  const s = strand({
    name: "limbL", spine: (m) => add(through(m, [[0, 1, 0.5], [1.5, 2, 2], [3, 1.2, 2.6], [4, 0.4, 1.5]]), vec3(0, mul(sin(time), 0.3), mul(m, 0.4))),
    stations: 10, girth: 0.3, section: { aspect: 0.6, squareness: 3 }, twist: (m) => mul(m, 1.1), level: 1, tips: ["round", "point"], paint: [1, 1, 1],
  });
  const r = mirror(s, "limbR");
  const c = compileScene(scene({ ground: sea({ swell: [] }), things: [s, r], style: toon(), sun: [0, 1, 0] }));
  const ms = [0.05, 0.3, 0.55, 0.8, 0.97], vs = [0, 0.1, 0.25, 0.4, 0.6, 0.75, 0.9];
  const roots: Expr[] = [];
  for (const m of ms) for (const v of vs) roots.push(s.point(f(m), f(0.5 - v)), r.point(f(m), f(v)), s.normal(f(m), f(0.5 - v)), r.normal(f(m), f(v)));
  const ev = c.cpu(roots);
  for (const t of [0, 0.7, 2.1]) {
    const out = ev(c.frame(stateAt(c.artefact, t))) as V3[];
    for (let i = 0; i < out.length; i += 4) {
      const refl = (p: V3): V3 => [p[0], p[1], -p[2]];
      expect(dist(refl(out[i]), out[i + 1])).toBeLessThan(1e-5);
      expect(dist(refl(out[i + 2]), out[i + 3])).toBeLessThan(1e-4);
    }
  }
  const surf = fan({ rays: [(m) => vec3(m, 0, 1), (m) => vec3(m, mul(m, 0.3), 2.5), (m) => vec3(m, 0, 3)], sag: 0.2, scallop: 0.2 });
  const back = mirror.surface(surf);
  const U = variable("u", "f32"), Vv = variable("v", "f32");
  const flipped = add(mul(U, -1), 1);
  const ev2 = run([surf.point(U, Vv), back.point(flipped, Vv), surf.normal(U, Vv), mapNormal(back.point)(flipped, Vv)]);
  for (const u of [0, 0.2, 0.5, 0.77, 1]) for (const v of [0, 0.4, 1]) {
    const [p, q, n, nq] = ev2({ u, v });
    expect(dist([p[0], p[1], -p[2]], q)).toBeLessThan(1e-5);
    // The reflection's own d/du x d/dv faces the reflection of the front: one-sided draws keep their outside.
    expect(dist([n[0], n[1], -n[2]], nq)).toBeLessThan(1e-3);
  }
});
