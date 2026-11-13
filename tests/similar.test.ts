// A similarity fold's two readings (src/lib/similar.ts): asked at a point, and listed as copies. They are derived from
// one chain of generators and must describe the same solid. The distance of the list is computed here by an
// independent rounded-cone distance in plain JS, so a wrong inverse of any generator (a turn undone the wrong way, the
// chain undone in the wrong order, a mirror's side swapped, a scale dropped) shows as a disagreement.
import { expect, test } from "bun:test";
import { compileJs, variable } from "../src/index.ts";
import { gen, tree, WORLD, type Branch, type Gen, type V3 } from "../src/lib/similar.ts";

/** The exact distance to a rounded cone (Quilez), transcribed independently of src/lib/sdf3.ts. */
function coneDistance(p: V3, c: Branch): number {
  const ba = [c.b[0] - c.a[0], c.b[1] - c.a[1], c.b[2] - c.a[2]], pa = [p[0] - c.a[0], p[1] - c.a[1], p[2] - c.a[2]];
  const l2 = ba[0]! ** 2 + ba[1]! ** 2 + ba[2]! ** 2, rr = c.ra - c.rb, a2 = l2 - rr * rr, il2 = 1 / l2;
  const y = pa[0]! * ba[0]! + pa[1]! * ba[1]! + pa[2]! * ba[2]!, z = y - l2;
  const v = [pa[0]! * l2 - ba[0]! * y, pa[1]! * l2 - ba[1]! * y, pa[2]! * l2 - ba[2]! * y];
  const x2 = v[0]! ** 2 + v[1]! ** 2 + v[2]! ** 2, y2 = y * y * l2, z2 = z * z * l2, k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - c.rb;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - c.ra;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - c.ra;
}

/** A deterministic stream of points in a box. */
function points(n: number, lo: V3, hi: V3): V3[] {
  let s = 12345;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  return Array.from({ length: n }, () => [0, 1, 2].map((k) => lo[k]! + rnd() * (hi[k]! - lo[k]!)) as unknown as V3);
}

/** Compare the two readings of a tree over `levels` levels at `n` points; returns how many points decided ids. */
function compare(step: readonly Gen[], levels: number, n: number): { worst: number; ids: number } {
  const t = tree({ part: { kind: "cone", a: [0, 0, 0], b: [0, 1, 0], ra: 0.08, rb: 0.06 }, step });
  const P = variable("p", "vec3");
  const asked = t.at(P, levels);
  const run = compileJs([asked.d, asked.level, asked.id]);
  const listed = t.branches(levels, WORLD);
  let worst = 0, ids = 0;
  for (const p of points(n, [-1.6, -0.3, -1.6], [1.6, 2.4, 1.6])) {
    const [d, level, id] = run({ vars: { p: [...p] }, inputs: {}, params: {} }) as [number, number, number[]];
    const ds = listed.map((b) => coneDistance(p, b));
    const best = ds.reduce((i, x, k) => (x < ds[i]! ? k : i), 0);
    worst = Math.max(worst, Math.abs(d - ds[best]!));
    // Which branch is nearest is only decided where the runner-up is clearly further.
    const runnerUp = Math.min(...ds.filter((_, k) => k !== best));
    if (runnerUp - ds[best]! > 1e-3) {
      expect([level, ...id]).toEqual([listed[best]!.level, ...listed[best]!.id]);
      ids++;
    }
  }
  return { worst, ids };
}

// A planar tree whose copies stay on their own side of every mirror (children tilt 0.9 rad from their parent and are
// half its size: the crown of one side never reaches back across the trunk's plane), so the two readings are the same
// solid everywhere. Five levels: 31 branches.
test("a tree asked and the same tree listed are the same solid, branch for branch", () => {
  const { worst, ids } = compare([gen.shift([0, 1, 0]), gen.mirror("x"), gen.turn("xy", 0.9), gen.shrink(0.5)], 5, 3000);
  expect(worst).toBeLessThan(1e-4);
  expect(ids).toBeGreaterThan(2500);
});

// The coral's chain turns about the trunk between levels, so deeper copies can cross an earlier mirror (cut when asked,
// whole when listed: the documented difference). Two levels cannot: a child leaves its own mirror plane at once. This
// covers the turn in the second plane and its place in the order of undoing.
test("with a turn about the trunk before the mirror, two levels agree", () => {
  const { worst, ids } = compare([gen.shift([0, 1, 0]), gen.turn("xz", 2.4), gen.mirror("x"), gen.turn("xy", 0.5), gen.shrink(0.76)], 2, 3000);
  expect(worst).toBeLessThan(1e-4);
  expect(ids).toBeGreaterThan(2500);
});

// Two mirrors on one axis would need two id lanes for it; the chain is refused, not mislabelled.
test("a chain that mirrors one axis twice is refused", () => {
  expect(() => tree({ part: { kind: "sphere", centre: [0, 0, 0], radius: 1 }, step: [gen.mirror("x"), gen.shift([1, 0, 0]), gen.mirror("x")] })).toThrow(/mirror each axis once/);
});
