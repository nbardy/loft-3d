// The serpent's body with scales painted by folding its body coordinates: (m, v) stretched to cells about as long as
// they are wide on this body, alternate rows offset by half a cell, and one scale drawn in one cell. The pattern
// follows every bend of the body because it is written in the body's own coordinates.
import { abs, add, floor, length, max, mix, mod, mul, palette, scene, sea, smoothstep, strand, sub, toon, vec2, vec3, type Expr } from "../src/index.ts";
import { fold2 } from "../src/lib/fold.ts";
import { coverage, fwidth, sdCircle } from "../src/lib/index.ts";
import serpent, { bodySpec } from "./serpent.ts";

/** Scale rows along the body and scales round it: cells about 0.25 units square on a 15-unit body of girth ~0.6. */
const ALONG = 72, ROUND = 18;

/** Brick fold: odd rows shifted half a cell round, then a unit repeat. */
const brick = (p: Expr<"vec2">) => {
  const row = floor(add(p.x, 0.5));
  return fold2.repeat([1, 1])(vec2(p.x, add(p.y, mul(mod(row, 2), 0.5))));
};

function scales(m: Expr<"f32">, v: Expr<"f32">): Expr<"vec3"> {
  const g = vec2(mul(m, ALONG), mul(v, ROUND));
  const cell = brick(g);
  // Each scale is a disc whose back is overlapped by the row in front (toward the tail, larger m): its visible part is
  // a crescent toward the head with a dark rim.
  const q = cell.x;
  const d = sdCircle(sub(q, vec2(0.18, 0)), 0.62);
  // Width from the unfolded coordinates: the folded ones jump at every cell wall and would draw a line there.
  const px = max(max(fwidth(g.x), fwidth(g.y)), 1e-4).mul(1.2);
  const rim = coverage(abs(d).add(-0.04), px);
  const under = palette.bands(m, v, palette.countershade(v, { back: [0.34, 0.17, 0.62], belly: [1.0, 0.88, 0.6] }), { colour: [0.6, 0.48, 1.0], count: 9, width: 0.5, from: 0.14, to: 0.97 });
  // Lighter toward each scale's free edge (toward the head): reads as overlap.
  const shade = mix(0.68, 1.12, smoothstep(0.5, -0.4, q.x));
  const glint = mul(sub(1, smoothstep(0.0, 0.35, length(sub(q, vec2(-0.25, 0.15))))), 0.12);
  // Scales fade out toward the belly (v = 0.75), which is plated smooth: `belly` is 0 there and 0.5 on the back.
  const belly = abs(sub(mod(add(v, 0.75), 1), 0.5));
  const scaled = mix(mul(under, shade).add(glint), mul(under, 0.3), rim);
  return mix(under, scaled, smoothstep(0.1, 0.18, belly));
}

export default scene({
  ground: serpent.ground,
  things: [strand({ ...bodySpec, name: "scaled", paint: scales, detail: { along: 200, around: 32 } })],
  style: toon({ bands: 3, outline: 0.04 }),
  sun: [-0.45, 0.75, 0.5],
  cameras: {
    ...serpent.cameras,
    close: { kind: "perspective", eye: [-1, 4, 7.5], target: [-1.5, 0.6, 0], fovY: 0.5 },
  },
});
