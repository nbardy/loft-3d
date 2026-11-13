// Sketch: graphite on paper. No flat colour: a body is the paper, its form drawn by hatching round it (the lighting
// recipe's `hatch`), its outline a thin hull with a line inside it that wanders in weight as a pencil does (`weighted`,
// `wandering`), and only a paint near black filled in solid (a pupil, a painted stripe). The water is paper with the
// swell's lines drawn across it, white water outlined, a cast shadow hatched; the sky is the bare sheet.
//
// Composed of: litBodies, light.hatch, weighted, swellLines, contactFoam, marksFoam, printLayers, paperGrain.

import { abs, add, fract, mix, mul, param, smoothstep, sub, vec4 } from "../expr.ts";
import { luminance } from "../lib/index.ts";
import { fwidth } from "../lib/wgsl.ts";
import type { Rgb, Style } from "../style.ts";
import { contactFoam, foam, marksAs, marksFoam, printLayers, type FoamInk } from "./foam.ts";
import { light, litBodies } from "./light.ts";
import { paint, weighted } from "./paint.ts";
import { paperGrain } from "./post.ts";
import { swellLines } from "./sea.ts";
import { edgeOf, rgb } from "./shared.ts";

const PAPER: Rgb = [0.95, 0.93, 0.88];
const GRAPHITE: Rgb = [0.17, 0.17, 0.2];
/** White water is left as paper and outlined; ridge foam's softer edge is graphite too. */
const FOAM: Record<FoamInk, Rgb> = { fill: PAPER, line: GRAPHITE, edge: GRAPHITE };

/**
 * The graphite-on-paper style: no flat colour, a body is bare paper with its form drawn by hatching, a thin outline
 * with a wandering inner line, and near-black paint filled in solid. The water is paper with the swell's lines drawn
 * across it. Composed of `litBodies`, `light.hatch`, `paint.wandering`, `swellLines` and `paperGrain`.
 */
export function sketch(): Style {
  // Tone is hatching alone: closer and more ragged than the woodblock's engraving, nearly solid in the deepest shadow.
  const recipe = light.recipe({ hatch: light.hatch({ spacing: 0.12, least: 4, cap: 0.85, ragged: 0.3 }) });
  const line = paint.wandering({ least: 0.004, most: 0.05 });
  const bodies = litBodies(
    recipe,
    { ink: GRAPHITE, amount: 0.9, value: 0.95 },
    (ctx) => mix(rgb(GRAPHITE), rgb(PAPER), edgeOf(luminance(ctx.base), 0.12, 1e-5)),
    (c, ctx) => weighted(line, c, GRAPHITE, ctx),
  );
  return {
    name: "sketch",
    ...bodies,
    outline: param("sketch.outline", 0.012, { min: 0, max: 0.1 }),
    ink: () => rgb(GRAPHITE),
    clear: PAPER,
    post: [paperGrain({ fibre: 0.05, tooth: 0.09 })],
    sky: () => rgb(PAPER),
    // A plane is the bare sheet; a cast shadow is a graphite tone on it.
    ground: (ctx) => mix(rgb(PAPER), rgb(GRAPHITE), mul(ctx.shadow, 0.35)),
    water: (ctx) => {
      const lines = swellLines(ctx, { perWave: 3, width: [0.005, 0.015] });
      let c = mix(rgb(PAPER), rgb(GRAPHITE), mul(lines.cover, 0.4));
      c = printLayers(c, contactFoam(foam.roll(), ctx, lines), FOAM);
      c = printLayers(c, marksFoam(marksAs.heads(), ctx), FOAM);
      // Far off the drawing stops and the paper is left bare.
      return vec4(mix(c, rgb(PAPER), smoothstep(40, 160, ctx.distance)), 1);
    },
    // A shadow on the water is hatched across, diagonal strokes 0.15 apart, as a pencil lays one.
    shadow: (ctx) => {
      const p = mul(add(ctx.world.x, ctx.world.z), 1 / 0.15);
      const fw = fwidth(p);
      const stroke = sub(1, smoothstep(sub(0.16, fw), add(0.16, fw), abs(sub(fract(p), 0.5))));
      return vec4(rgb(GRAPHITE), mul(mul(edgeOf(ctx.amount, 0.3, 0.01), stroke), 0.7));
    },
  };
}
