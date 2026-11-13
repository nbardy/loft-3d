// Cast shadows derived from the skeleton (src/draw/shadows.ts), checked on a body whose shadow is known.
import { expect, test } from "bun:test";
import { bound, draw, length, mul, points, scene, sea, strand, sub, through, toon, vec3 } from "../src/index.ts";
import { compileScene } from "../src/compile/index.ts";
import { stateAt } from "./compile.harness.ts";

/** The valid capsules of a shadow table, in order: 12 floats each (lane 2's z is the valid flag). */
const capsules = (t: Float32Array): number[][] =>
  Array.from({ length: t.length / 12 }, (_, i) => Array.from(t.subarray(i * 12, i * 12 + 12))).filter((c) => c[10] === 1);

// Catches: shadows cast along the wrong direction (toward the sun, or ignoring height), and broken chain links (the
// flags that let a capsule's patch yield its joint to its neighbour, so a joint is not darkened twice). A bar at height
// 2 under a sun tilted toward +x by 0.5 per unit up throws its shadow 1 unit toward -x.
test("a raised bar casts one linked chain of capsules along the sun onto the water", () => {
  const bar = strand({ name: "bar", spine: (m) => through(m, [[-3, 2, 0.5], [3, 2, 0.5]]), stations: 16, girth: 0.5, tips: "open", paint: [1, 1, 1] });
  const c = compileScene(scene({ ground: sea({ swell: [] }), things: [bar], style: toon(), sun: [0.5, 1, 0] }));
  const t = c.frame(stateAt(c.artefact, 0)).table(c.table("shadows"));
  const s = capsules(t);
  expect(s.length).toBe(15);
  s.forEach(([ax, az, bx, bz, ra, rb, strength, , prev, next], i) => {
    expect(az).toBeCloseTo(0.5, 4);
    expect(bz).toBeCloseTo(0.5, 4);
    expect(ax).toBeGreaterThanOrEqual(-3 - 1 - 1e-4);
    expect(bx).toBeLessThanOrEqual(3 - 1 + 1e-4);
    expect(ra).toBeCloseTo(0.5, 4);
    expect(rb).toBeCloseTo(0.5, 4);
    expect(strength).toBeGreaterThan(0);
    expect([prev, next]).toEqual([i > 0 ? 1 : 0, i < 14 ? 1 : 0]);
  });
  expect(s[0][0]).toBeCloseTo(-4, 4);
  expect(s[14][2]).toBeCloseTo(2, 4);
});

// Catches: copies drawn with draw.points casting nothing (they did, until 2026-11-11: a fleet or a ring of posts left no
// shadow), or casting from the prototype's place instead of each copy's. Three posts lifted to height 2 at x = -4, 0, 4,
// each a short bar along z; under the same sun each shadow lands 1 unit toward -x of its own copy.
test("copies made with draw.points each cast their own chain, carried by their placement", () => {
  const post = strand({ name: "post", spine: (m) => through(m, [[0, 0, -1], [0, 0, 1]]), stations: 6, girth: 0.3, tips: "open", paint: [1, 1, 1] });
  const posts = draw.points("posts", points(3, (i) => ({ at: vec3(mul(sub(i, 1), 4), 2, 0), scale: 1 })), post);
  const c = compileScene(scene({ ground: sea({ swell: [] }), things: [posts], style: toon(), sun: [0.5, 1, 0] }));
  const t = c.frame(stateAt(c.artefact, 0)).table(c.table("shadows"));
  const s = capsules(t);
  expect(s.length).toBe(3 * 5);
  const xs = [...new Set(s.map(([ax]) => Math.round(ax * 1e3) / 1e3))].sort((a, b) => a - b);
  expect(xs).toEqual([-5, -1, 3]);
});

// Catches: a traced solid casting nothing (draw.field had no skeleton). A sphere of radius 1 standing 2 above the
// water casts a blob centred under it, shifted 2 * 0.5 = 1 toward -x by the sun.
test("a traced solid casts a soft blob fitted to its inside", () => {
  const ball = draw.field("ball", (p) => sub(length(sub(p, vec3(3, 2, -1))), 1), {
    bounds: bound.sphere([3, 2, -1], 1.2), paint: () => vec3(1, 1, 1), steps: 32, outline: "none", schedule: "trace",
  });
  const c = compileScene(scene({ ground: sea({ swell: [] }), things: [ball], style: toon(), sun: [0.5, 1, 0] }));
  const t = c.frame(stateAt(c.artefact, 0)).table(c.table("shadows"));
  const s = capsules(t);
  expect(s.length).toBeGreaterThan(0);
  const cx = s.reduce((n, [ax, , bx]) => n + (ax + bx) / 2, 0) / s.length, cz = s.reduce((n, [, az, , bz]) => n + (az + bz) / 2, 0) / s.length;
  expect(Math.abs(cx - 2)).toBeLessThan(0.15);
  expect(Math.abs(cz + 1)).toBeLessThan(0.15);
  for (const [, , , , ra] of s) expect(Math.abs(ra - 0.6)).toBeLessThan(0.35);
});
