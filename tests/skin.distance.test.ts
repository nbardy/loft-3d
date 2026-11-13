// A closed skin as an attack's target (src/geom/skin_distance.ts), measured on a lofted hull: its signed distance must
// agree with the skin's own surface.
// Before it, a ship was measured as its skeleton (capsules as wide as its beam), so contact read as a gap of half a
// unit. Off the sampling grid, so this measures the mesh against the closed-form skin, not the mesh against itself.
import { expect, test } from "bun:test";
import { brigSpec } from "../examples/brig.ts";
import { compileJs, f } from "../src/index.ts";
import { ship } from "../examples/recipes/ship.ts";
import { skinDistance, type V3 } from "../src/geom/skin_distance.ts";

const hull = ship({ ...brigSpec, name: "measured" }).hull;
const h = skinDistance(hull.skin), sdf = (q: V3) => h.distance(q);
const at = (u: number, v: number): { p: V3; n: V3 } => {
  const [p, n] = compileJs([hull.skin.point(f(u), f(v)), hull.skin.normal(f(u), f(v))])({ vars: {}, inputs: {}, params: {} }) as unknown as [V3, V3];
  return { p, n };
};

test("the hull's signed distance is zero on its skin and the offset along the normal just off it, either side", () => {
  let worst = 0;
  const off: string[] = [];
  for (const u of [0.13, 0.31, 0.47, 0.62, 0.78, 0.89]) for (const v of [0.07, 0.23, 0.41, 0.5, 0.66, 0.83, 0.95]) {
    const { p, n } = at(u, v);
    worst = Math.max(worst, Math.abs(sdf(p)));
    for (const d of [-0.04, 0.04, 0.3]) {
      const q: V3 = [p[0] + n[0] * d, p[1] + n[1] * d, p[2] + n[2] * d];
      // The normal's offset is the distance while nothing else of the hull is nearer (true this close, and outside).
      const e = sdf(q) - d;
      if (!(Math.abs(e) < 5e-3)) off.push(`u ${u} v ${v} offset ${d}: off by ${e.toFixed(4)}`);
    }
  }
  expect(off).toEqual([]);
  expect(worst).toBeLessThan(3e-3);
});

test("far from the hull the distance is the distance to its nearest point, and inside it is negative", () => {
  const L = hull.lines;
  // Straight below the keel amidships, and level with the turn of the bilge abeam.
  const keel = at(0.5, 0.5).p;
  expect(Math.abs(sdf([keel[0], keel[1] - 2, keel[2]]) - 2)).toBeLessThan(5e-3);
  expect(sdf([0, 0.5 * L.freeboard, 0])).toBeLessThan(-0.5);
  expect(sdf([0, 0, L.beam])).toBeGreaterThan(0.4 * L.beam);
});
