import { expect, test } from "bun:test";
import { evaluate, sub, variable, vec2 } from "../src/expr.ts";
import { coverage, repeatAngle, sdBox, sdCapsule, sdCircle, sdRing, sdSegment, sdTriangleIsosceles, stroke } from "../src/lib/index.ts";
import { compare, coord, rng } from "./lib.harness.ts";

const p = variable("p", "vec2"), d = variable("d", "f32");
const val = (e: Parameters<typeof evaluate>[0], vars: Record<string, number | number[]>) => evaluate(e, { vars });

/** Angles of the sector boundaries of `repeatAngle(_, count)`, where the fold's `mod` wraps (and atan2's cut sits). */
function offBoundary(count: number, angle: number): boolean {
  const sector = (2 * Math.PI) / count;
  const t = (((angle + sector / 2) % sector) + sector) % sector; // position in the sector, 0 at a boundary
  return Math.min(t, sector - t) > 2e-3;
}

test("sdf2: CPU and GPU agree", async () => {
  const r = rng(21);
  const COUNT = 7;
  const samples: { p: number[]; d: number }[] = [];
  while (samples.length < 200) {
    const big = samples.length % 2 === 0 ? 300 : 2;
    const q = [coord(r, big), coord(r, big)];
    // repeatAngle's mod wraps at the sector boundaries, and atan2 has its cut on the negative x axis (a boundary for an
    // odd count): f32 and f64 land on opposite sides of them for points that close, so such samples are moved off by
    // skipping them. The other functions are continuous and could use them, but one set keeps the harness simple.
    if (Math.hypot(q[0], q[1]) < 0.05 || !offBoundary(COUNT, Math.atan2(q[1], q[0]))) continue;
    samples.push({ p: q, d: coord(r, 3) });
  }
  const exprs = [
    sdCircle(p, 1.5), sdBox(p, [1, 0.5]), sdSegment(p, [-1, 0.5], [2, 1]), sdCapsule(p, [-1, 0.5], [2, 1], 0.3),
    sdRing(p, 2, 0.25), sdTriangleIsosceles(p, 0.7, 1.3), repeatAngle(p, COUNT), stroke(d, 0.2), coverage(d, 0.5),
  ];
  // Large coordinates make the shapes' distances large; inputs a few units away exercise the interesting regions.
  const c = await compare(exprs, samples, "sdf2");
  console.log("lib.sdf2 worst relative error per function [circle, box, segment, capsule, ring, triangle, repeatAngle, stroke, coverage]:", c.worstBy);
  expect(c.worst).toBeLessThan(1e-4);
});

test("sdCapsule is -r on its axis and 0 on its surface", () => {
  const a = [-1, 0.5], b = [2, 1.5];
  for (let t = 0; t <= 1; t += 0.125) {
    const axis = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    expect(val(sdCapsule(p, a, b, 0.3), { p: axis })).toBeCloseTo(-0.3, 12);
  }
  // 0.3 beyond the end cap along the axis direction, and 0.3 sideways from the middle.
  const dir = [b[0] - a[0], b[1] - a[1]], len = Math.hypot(dir[0], dir[1]);
  const u = [dir[0] / len, dir[1] / len];
  expect(val(sdCapsule(p, a, b, 0.3), { p: [b[0] + 0.3 * u[0], b[1] + 0.3 * u[1]] })).toBeCloseTo(0, 12);
  expect(val(sdCapsule(p, a, b, 0.3), { p: [0.5 - 0.3 * u[1], 1 + 0.3 * u[0]] })).toBeCloseTo(0, 12);
});

test("circle, box, segment and ring have the right signs and known values", () => {
  expect(val(sdCircle(p, 2), { p: [0, 0] })).toBe(-2);
  expect(val(sdCircle(p, 2), { p: [3, 4] })).toBe(3);
  expect(val(sdBox(p, [1, 2]), { p: [0, 0] })).toBe(-1);
  expect(val(sdBox(p, [1, 2]), { p: [4, 0] })).toBe(3);
  expect(val(sdBox(p, [1, 1]), { p: [2, 2] })).toBeCloseTo(Math.SQRT2, 12);
  expect(val(sdBox(p, [1, 1]), { p: [-1, 0.3] })).toBeCloseTo(0, 12);
  expect(val(sdSegment(p, [0, 0], [4, 0]), { p: [-3, 4] })).toBe(5);
  expect(val(sdSegment(p, [0, 0], [4, 0]), { p: [2, -3] })).toBe(3);
  expect(val(sdRing(p, 2, 0.25), { p: [2, 0] })).toBe(-0.25);
  expect(val(sdRing(p, 2, 0.25), { p: [0, 0] })).toBe(1.75);
  expect(val(sdRing(p, 2, 0.25), { p: [0, -2.25] })).toBeCloseTo(0, 12);
});

test("sdTriangleIsosceles equals the brute-force distance to the polygon, signed by containment", () => {
  const w = 0.7, h = 1.3;
  const poly = [[-w, 0], [w, 0], [0, h]];
  const boundary: number[][] = [];
  for (let e = 0; e < 3; e++) {
    const [a, b] = [poly[e], poly[(e + 1) % 3]];
    for (let i = 0; i <= 4000; i++) boundary.push([a[0] + ((b[0] - a[0]) * i) / 4000, a[1] + ((b[1] - a[1]) * i) / 4000]);
  }
  const inside = (q: number[]): boolean => q[1] >= 0 && 1.3 * Math.abs(q[0]) + 0.7 * q[1] <= 0.7 * 1.3;
  const r = rng(22);
  const e = sdTriangleIsosceles(p, w, h);
  let negatives = 0;
  for (let i = 0; i < 400; i++) {
    const q = [coord(r, 2), coord(r, 2)];
    const want = Math.min(...boundary.map((b) => Math.hypot(b[0] - q[0], b[1] - q[1]))) * (inside(q) ? -1 : 1);
    if (want < 0) negatives++;
    expect(val(e, { p: q }) as number).toBeCloseTo(want, 3); // boundary sampled every ~2e-4
  }
  expect(negatives).toBeGreaterThan(20);
  expect(val(e, { p: [0, h] })).toBeCloseTo(0, 12); // apex
  expect(val(e, { p: [-w, 0] })).toBeCloseTo(0, 12); // base corner
});

test("repeatAngle maps a point rotated by one sector to the same place, and lands in the first sector", () => {
  for (const count of [3, 7, 12]) {
    const sector = (2 * Math.PI) / count;
    const e = repeatAngle(p, count);
    const r = rng(23 + count);
    let checked = 0;
    while (checked < 200) {
      const rad = 0.2 + r() * 5, ang = (r() * 2 - 1) * Math.PI;
      if (!offBoundary(count, ang)) continue; // a point on a sector boundary lands on either side of it
      checked++;
      const q = [rad * Math.cos(ang), rad * Math.sin(ang)];
      const rotated = [rad * Math.cos(ang + sector), rad * Math.sin(ang + sector)];
      const a = val(e, { p: q }) as number[], b = val(e, { p: rotated }) as number[];
      expect(b[0]).toBeCloseTo(a[0], 9);
      expect(b[1]).toBeCloseTo(a[1], 9);
      expect(Math.hypot(a[0], a[1])).toBeCloseTo(rad, 9);
      expect(Math.abs(Math.atan2(a[1], a[0]))).toBeLessThanOrEqual(sector / 2 + 1e-9);
    }
  }
});

test("a ring of teeth: repeatAngle + triangle puts a tooth at every sector and none between", () => {
  // Teeth point outward from a ring of radius 1; the tooth's local frame is (tangent, radial offset from the ring).
  const COUNT = 8;
  const q = repeatAngle(p, COUNT);
  const tooth = sdTriangleIsosceles(vec2(q.y, sub(q.x, 1)), 0.2, 0.3);
  const at = (rad: number, ang: number) => val(tooth, { p: [rad * Math.cos(ang), rad * Math.sin(ang)] }) as number;
  for (let k = 0; k < COUNT; k++) {
    const a = (k * 2 * Math.PI) / COUNT;
    expect(at(1.15, a)).toBeLessThan(0); // inside the tooth
    expect(at(1.15, a + Math.PI / COUNT)).toBeGreaterThan(0.1); // between teeth
  }
});

test("stroke and coverage", () => {
  expect(val(stroke(d, 0.2), { d: 0.5 })).toBeCloseTo(0.3, 12);
  expect(val(stroke(d, 0.2), { d: -0.5 })).toBeCloseTo(0.3, 12);
  expect(val(stroke(d, 0.2), { d: 0.1 })).toBeCloseTo(-0.1, 12);
  expect(val(coverage(d, 0.5), { d: 0 })).toBe(0.5);
  expect(val(coverage(d, 0.5), { d: -0.25 })).toBe(1);
  expect(val(coverage(d, 0.5), { d: -5 })).toBe(1);
  expect(val(coverage(d, 0.5), { d: 0.25 })).toBe(0);
  expect(val(coverage(d, 0.5), { d: 0.125 })).toBeCloseTo(0.25, 12);
});
