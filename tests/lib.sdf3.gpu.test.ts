import { expect, test } from "bun:test";
import { variable } from "../src/expr.ts";
import {
  compose, elongate, extrude, fieldOf, fold3, intersect, nearest, revolve, round, sdBox, sdBox3, sdCapsule3, sdCircle, sdCylinder, sdEllipsoid, sdPlane,
  sdRoundBox, sdRoundCone, sdSphere, sdTorus, shell, smoothIntersect, smoothSubtract, smoothUnion, subtract, union,
} from "../src/lib/index.ts";
import { compare, coord, rng } from "./lib.harness.ts";

const p = variable("p", "vec3");

function samples(n: number, seed: number) {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const big = i % 2 === 0 ? 300 : 3; // large and small coordinates, both signs
    return { p: [coord(r, big), coord(r, big), coord(r, big)] };
  });
}

test("sdf3 primitives and operators: CPU and GPU agree", async () => {
  const names: string[] = [];
  const exprs = [] as ReturnType<typeof sdSphere>[];
  const add = (name: string, e: ReturnType<typeof sdSphere>) => { names.push(name); exprs.push(e); };
  const a = sdSphere(p, 1.2), b = sdBox3(p, [1, 0.5, 0.8]);
  add("sphere", a); add("box", b); add("roundBox", sdRoundBox(p, [1, 0.5, 0.8], 0.2));
  add("capsule", sdCapsule3(p, [-1, 0.5, 0], [2, 1, 1.5], 0.3));
  add("roundCone", sdRoundCone(p, [0, 0, 0], [0.5, 0.2, 2], 0.8, 0.3));
  add("roundCone reversed", sdRoundCone(p, [0, 0, 0], [0.5, 0.2, 2], 0.2, 0.9));
  add("torus", sdTorus(p, 1.5, 0.4)); add("cylinder", sdCylinder(p, 0.7, 1.1)); add("plane", sdPlane(p, [1, 2, -2], 0.3));
  add("ellipsoid", sdEllipsoid(p, [1, 0.6, 1.8]));
  add("union", union(a, b)); add("subtract", subtract(a, b)); add("intersect", intersect(a, b));
  add("smoothUnion", smoothUnion(a, b, 0.5)); add("smoothSubtract", smoothSubtract(a, b, 0.5)); add("smoothIntersect", smoothIntersect(a, b, 0.5));
  add("round", round(b, 0.1)); add("shell", shell(a, 0.2));
  add("elongate", elongate((q) => sdSphere(q, 0.5), [1, 0.3, 0.6])(p));
  add("elongate box", elongate((q) => sdBox3(q, [0.4, 0.5, 0.3]), [1, 0.3, 0.6])(p));
  add("revolve", revolve((q) => sdBox(q, [0.3, 0.5]), 1.4)(p));
  add("extrude", extrude((q) => sdCircle(q, 0.9), 0.7)(p));
  const kf = fold3.scaleFold({ iterations: 4, fold: compose(fold3.mirror(0), fold3.mirror(1)), scale: 1.8, offset: [1, 0.5, 0.3] });
  add("fieldOf scaleFold", fieldOf(kf, (q) => sdBox3(q, [0.3, 0.3, 0.3]))(p));
  add("fieldOf inversion", fieldOf(fold3.inversion(1.5), (q) => sdSphere(q.sub([2, 0, 0]), 0.5))(p));
  add("fieldOf twist", fieldOf(fold3.twist(0.8, 3), (q) => sdBox3(q, [2, 0.5, 2]))(p));
  add("fieldOf repeatScale", fieldOf(fold3.repeatScale(2, 0.75), (q) => shell(sdSphere(q, 1), 0))(p));
  const sc = fold3.screw(2, 8);
  add("nearest screw", nearest([sc, compose(sc, fold3.helix(Math.PI / 4, 0.25, 2)), compose(sc, fold3.helix(-Math.PI / 4, -0.25, 2))], (q) => sdCapsule3(q, [0.8, -0.3, 0], [0.8, 0.3, 0], 0.15))(p));

  // Samples are multiples of 1/1024 shifted by 0.0007, so none sits exactly on a coordinate plane (the mirror folds' and
  // the primitives' kinks) or on the lattice of walls where f32 and f64 would legitimately land on opposite sides of a seam.
  const all = samples(240, 41).map((s) => ({ p: s.p.map((v) => v + 0.0007) }));
  const c = await compare(exprs, all, "sdf3");
  console.log("lib.sdf3 worst relative CPU/GPU error per function:", Object.fromEntries(names.map((n, i) => [n, c.worstBy[i]])));
  expect(c.worst).toBeLessThan(1e-4);
});
