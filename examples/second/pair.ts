// Two unrelated subjects in one scene: the three-headed lantern fish (examples/second/lanternfish.ts, variant `hydra`)
// and a jellyfish, side by side. Each is built inside its own namespace, so both may name a part "body".
// Shows: `lineup` and `namespaced` (src/expr.ts). Ground: a calm sea standing in for the deep (`water`).
//
// Theory, before running. `lineup` builds each member in its namespace, on one sea that carries every member's ring
// waves, optionally looped. Predicted fits: the namespaces (two parts named "body" meet no conflict). Predicted fights:
// a member must be a `Design` with a staged build, so a jellyfish with no slots and no variants still writes numbers,
// slots, variants, a build and a two-stage build; and the members are typed as one design's (`N`, `H` shared), which is
// the crab's case (five variants of one crab), so two different subjects may not type-check side by side.
//
// Scored. `namespaced` fit (both parts named "body" built; the fish's checks came out as `fish__bulb0` ...). `lineup`
// fought on both counts predicted. The type error was the hard one: members were one design's (`N`, `H`), so the
// jellyfish could not stand by the fish; opened (members are any designs; each one's numbers are checked when it
// resolves). Not opened: the ceremony. A subject with no slots or variants still writes a design with a two-stage
// build to be lined up; what a lineup needs of a member is only "build yourself on this sea, in your namespace".
import { add, design, lineup, mix, mul, scene, sea, sin, smoothstep, strand, time, toon, vec3, type F } from "../../src/index.ts";
import { lanternfish } from "./lanternfish.ts";

const water = { swell: [] }; // stand-in for the deep
/** A jellyfish at `at`: a pulsing bell over six trailing tentacles, the tentacles a beat behind the bell. */
function jelly(n: { readonly pulse: number }, at: readonly [number, number]) {
  const beat = (t: F) => sin(mul(t, (2 * Math.PI) / n.pulse)), top = vec3(at[0], 3.3, at[1]);
  const bell = strand({ name: "body", spine: (m) => add(top, vec3(0, mul(m, -0.7), 0)), stations: 8, girth: (m) => mul(mul(sin(mul(add(m, 0.02), Math.PI * 0.62)), 0.85), add(1, mul(beat(time), 0.12))),
    tips: ["round", "open"], paint: (m) => mix(vec3(0.95, 0.55, 0.7), vec3(1, 0.85, 0.9), smoothstep(0.2, 0.9, m)), detail: { along: 20, around: 24 } });
  const arms = [0, 1, 2, 3, 4, 5].map((k) => {
    const a = (k / 6) * Math.PI * 2, root = add(top, vec3(0.55 * Math.cos(a), -0.65, 0.55 * Math.sin(a)));
    // A wave runs down each tentacle from the bell: the tip is the bell's beat, 0.8 s late.
    return strand({ name: `arm${k}`,
      spine: (m) => add(root, vec3(mul(mul(m, beat(add(time, add(mul(m, -0.8), -k * 0.07)))), 0.45), mul(m, -2.0), mul(mul(m, beat(add(time, mul(m, -0.8)))), 0.3 * Math.sin(a)))),
      stations: 16, girth: (m) => mix(0.06, 0.015, m), paint: [0.9, 0.5, 0.65], detail: { along: 24, around: 6 } });
  });
  return { things: [bell, ...arms], checks: [] };
}
// The fight, (1): the smallest design a lineup accepts. Nothing here but the build is about a jellyfish.
const jellyfish = design({
  name: "jellyfish", numbers: { pulse: 1.3 }, slots: {}, variants: {}, compare: ["game"],
  build: (_p, n) => ({ scene: scene({ ground: sea(water), things: jelly(n, [0, 0]).things, style: toon({ bands: 3 }), sun: [0, 1, 0] }), checks: [] }),
  stage: (_p, n, how: { readonly at: readonly [number, number] }) => ({ deforms: [], sea: water, finish: () => jelly(n, how.at) }),
});

const both = lineup({
  members: [
    { name: "fish", design: lanternfish, variant: "hydra", numbers: {}, how: { at: [-2.2, 0.5] } },
    { name: "jelly", design: jellyfish, variant: "base", numbers: {}, how: { at: [2.4, -0.5] } },
  ],
  water, loop: { kind: "open" },
});

export default scene({
  ground: both.sea, things: both.things, style: toon({ bands: 3, outline: 0.03 }), sun: [-0.3, 0.8, 0.5],
  cameras: { game: { kind: "perspective", eye: [2, 7.5, 9], target: [0, 1.6, 0], fovY: 0.62 } },
});
export const checks = both.checks;
