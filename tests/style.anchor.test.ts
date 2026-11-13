// Body-anchored patterns (DESIGN.md 2.6): a style's pattern written over a surface's anchor must be the same at the
// same body coordinates whatever the body is doing. Before the anchor existed, the patterns were functions of the world
// point, so on a swimming serpent they slid through the body (woodblock's line weight, papercraft's facets).
import { expect, test } from "bun:test";
import serpent from "../examples/serpent.ts";
import { compileScene } from "../src/compile/index.ts";
import { f, lift, vec2, vec3, type Expr } from "../src/index.ts";
import type { Body } from "../src/map/sweep.ts";
import { withStyle, woodblock } from "../src/style/index.ts";
import { stateAt } from "./compile.harness.ts";

test("woodblock's line weight is the same at the same body coordinates while the serpent swims", () => {
  const scene = withStyle(serpent, woodblock());
  const body = scene.things.find((t) => t.name === "serpent") as unknown as Body;
  const c = compileScene(scene);
  const style = scene.style;
  const sites: [number, number][] = [[0.2, 0.25], [0.45, 0.1], [0.6, 0.75], [0.85, 0.4]];
  const roots: Expr[] = sites.flatMap(([m, v]) => {
    const anchor = body.anchor(f(m), f(v)), world = body.point(f(m), f(v));
    const ctx = { base: vec3(0.5, 0.4, 0.6), normal: vec3(0, 1, 0), sun: lift<"vec3">([0, 1, 0]), view: vec3(0, 1, 0), world, depth: f(0), uv: vec2(m, v), anchor, id: f(0.3) };
    return [style.mark(ctx), anchor, world];
  });
  const run = c.cpu(roots);
  const at = (t: number) => run(c.frame(stateAt(c.artefact, t))) as (number | number[])[];
  const [a, b] = [at(0.3), at(1.9)];
  for (let i = 0; i < sites.length; i++) {
    const [markA, anchorA, worldA] = a.slice(3 * i, 3 * i + 3) as [number, number[], number[]];
    const [markB, anchorB, worldB] = b.slice(3 * i, 3 * i + 3) as [number, number[], number[]];
    // The body really moved there (otherwise the test proves nothing)...
    expect(Math.hypot(worldA[0]! - worldB[0]!, worldA[1]! - worldB[1]!, worldA[2]! - worldB[2]!)).toBeGreaterThan(0.1);
    // ...and the anchor and the pattern did not.
    for (let k = 0; k < 3; k++) expect(Math.abs(anchorA[k]! - anchorB[k]!)).toBeLessThan(1e-4 * (1 + Math.abs(anchorA[k]!)));
    expect(Math.abs(markA - markB)).toBeLessThan(1e-4);
  }
});
