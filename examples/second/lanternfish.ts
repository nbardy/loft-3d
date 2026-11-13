// A lantern fish as a design: one body, a `heads` slot (one, two or three heads, each with its own lure) and a `tails`
// slot (one fin or a fork), two named variants, and a check that is re-measured on every variant: no two lures touch.
// `loft variants examples/second/lanternfish.ts` draws every variant. The fish hovers over a calm sea standing in for
// the deep (`water` below: one line to change).
// Shows: `design`, slots and options, named variants (`docs/variants.md`), and a staged build so it can be lined up.
//
// Theory, before running. A design is numbers, slots of named options, variants, and a build: nothing in that list is
// a crab. Predicted fit: slots and variants. Predicted fight: `Built`, what a build returns, must carry `strikes`,
// `holds` and `waves` (an attack's readouts); a fish with no attacks writes three empty records. The lures: three heads
// splayed 0.55 rad apart on necks of 0.9 put the lure roots about 0.5 apart; each lure bows 0.35 rad toward its own
// side, so they part as they rise. Predicted least gap between bulbs: about 0.6.
//
// Scored. Slots, options with their own numbers (`triple` widens the body), variants, the variant sheet and checks
// re-measured per variant fit. `Built` fought as predicted: opened (it is now the scene and its checks). The lures'
// least gap was 0.584 (hydra), predicted ~0.6. Weak: `Option` carries only numbers, so what an option draws (`splay`,
// `fork`) is typed by the subject with a cast per option (`as Heads`); nothing checks an option is complete.
import {
  add, bent, design, lift, mix, mul, scene, sea, sin, smoothstep, strand, sub, time, toon, vec3, type F, type Option, type P3,
} from "../../src/index.ts";
import { budget, staysClear } from "../../src/check.ts";

const water = { swell: [] }; // stand-in for the deep
const NUMBERS = { length: 3.2, girth: 0.55, ride: 1.6, lure: 1.1, beat: 1.4, ink: [0.16, 0.12, 0.3] as readonly number[], glow: [0.6, 1.0, 0.85] as readonly number[] };
type N = typeof NUMBERS;
type Heads = Option<N> & { readonly splay: readonly number[] };
type Tails = Option<N> & { readonly fork: readonly number[] };
const slots = {
  heads: { base: { about: "one head", splay: [0] } as Heads, twin: { about: "two heads", splay: [-0.4, 0.4] } as Heads, triple: { about: "three heads", splay: [-0.55, 0, 0.55], numbers: { girth: 0.7 } } as Heads },
  tails: { base: { about: "one fin", fork: [0] } as Tails, forked: { about: "two fins", fork: [-0.45, 0.45] } as Tails },
};

/** The fish, in its own place: everything it draws and the checks on it. */
function fish(heads: Heads, tails: Tails, n: N, at: readonly [number, number]) {
  const rgb = (c: readonly number[]) => [c[0]!, c[1]!, c[2]!] as const;
  // The body swims in place: a wave running tailward, growing toward the tail.
  const spine = (m: F): P3 => vec3(add(at[0], mul(sub(0.5, m), n.length)), n.ride, add(at[1], mul(mul(m, m), mul(sin(sub(mul(m, 5), mul(time, (2 * Math.PI) / n.beat))), 0.35))));
  const body = strand({ name: "body", spine, stations: 24, girth: (m) => mul(sin(mul(add(m, 0.08), Math.PI * 0.86)), n.girth), section: { aspect: 1.2 }, tips: ["round", { point: 0.3 }],
    paint: (m, v) => mix(vec3(...rgb(n.ink)), vec3(0.75, 0.7, 0.85), mul(smoothstep(0.2, -0.6, sin(mul(v, Math.PI * 2))), 0.7)), detail: { along: 48, around: 20 } });
  const nose = spine(lift<"f32">(0)), tail = spine(lift<"f32">(1));
  const out = (a: number, r: number, y: number): P3 => vec3(r * Math.cos(a), y, r * Math.sin(a));
  const heads_ = heads.splay.flatMap((a, k) => {
    const neck = (m: F) => add(nose, mul(out(a, 0.9, 0.15), m)), head = neck(lift<"f32">(1));
    const lure = bent({ root: add(head, vec3(0, 0.25, 0)), along: [0, 1, 0], a: [Math.cos(a), 0, Math.sin(a)], b: [-Math.sin(a), 0, Math.cos(a)], length: n.lure,
      bow: [0.6, mul(sin(add(mul(time, 1.7), k)), 0.15)], crook: [0.9, 0], sharp: 3 });
    return [
      strand({ name: `neck${k}`, spine: neck, stations: 4, girth: 0.22, paint: rgb(n.ink), detail: { along: 8, around: 12 } }),
      strand({ name: `head${k}`, spine: (m) => add(head, mul(out(a, 0.55, -0.05), sub(m, 0.3))), stations: 4, girth: 0.32, tips: [{ round: 0.5 }, { round: 0.5 }], paint: rgb(n.ink), detail: { along: 12, around: 16 } }),
      strand({ name: `lure${k}`, spine: lure.spine, stations: 12, girth: 0.03, paint: rgb(n.ink), detail: { along: 20, around: 6 } }),
      strand({ name: `bulb${k}`, spine: (m) => add(lure.tip, mul(lure.tipHeading, mul(m, 0.2))), stations: 4, girth: 0.12, tips: [{ round: 0.5 }, { round: 0.5 }], paint: rgb(n.glow), detail: { along: 8, around: 12 } }),
    ];
  });
  const fins = tails.fork.map((a, k) => strand({ name: `fin${k}`, spine: (m) => add(tail, mul(out(Math.PI + a, 0.9, 0.1), m)), stations: 4, girth: (m) => mul(m, 0.45), section: { aspect: 0.12 }, tips: ["open", "round"], paint: rgb(n.ink), detail: { along: 8, around: 10 } }));
  const bulbs = heads_.filter((s) => s.name.includes("bulb"));
  const checks = [budget({ triangles: 60_000 }), ...bulbs.flatMap((b, i) => bulbs.slice(i + 1).map((c) => staysClear(b, { kind: "body", body: c }, { until: n.beat * 10, label: `${b.name} and ${c.name} never touch` })))];
  return { things: [body, ...heads_, ...fins], checks };
}

export const lanternfish = design({
  name: "lanternfish", numbers: NUMBERS, slots, compare: ["game"],
  variants: { hydra: { about: "three heads, forked tail, longer lures", pick: { heads: "triple", tails: "forked" }, numbers: { lure: 1.4 } }, pair: { about: "two heads", pick: { heads: "twin" } } },
  build: (p, n) => {
    const f = fish(p.heads, p.tails, n, [0, 0]);
    // The fight: `Built` asked for an attack's readouts, and a fish has none. It was written first with
    //   strikes: {}, holds: {}, waves: {},   and now `Built` is the scene and its checks (src/design.ts).
    return { scene: scene({ ground: sea(water), things: f.things, style: toon({ bands: 3, outline: 0.03 }), sun: [-0.3, 0.8, 0.5], cameras: { game: { kind: "perspective", eye: [5.5, 7, 3.5], target: [0.4, 1.6, 0], fovY: 0.6 } } }), checks: f.checks };
  },
  stage: (p, n, how: { readonly at: readonly [number, number] }) => ({ deforms: [], sea: water, finish: () => fish(p.heads, p.tails, n, how.at) }),
});
export { lanternfish as design };
