# Loft: a guide

Loft describes animated 3D things as TypeScript and compiles the description to WGSL shaders plus tables of numbers
that any WebGPU host can draw. This guide is for someone who knows TypeScript and nothing else about Loft. Each section
is a few lines of code that run, and a pointer to a fuller example. Every snippet here is checked by
`bun tools/check_snippets.ts`.

For the same ground written for a model, with the whole list of exports, run `loft context`.

## Three ideas

1. **You write expressions, not numbers.** `add(a, b)`, `sin(time)`, `vec3(x, y, z)` build a graph. The compiler emits
   it twice: as WGSL for the GPU and as JavaScript for the CPU, so the checks measure exactly what is drawn.
2. **A body is a coordinate system.** A swept body has coordinates (m along it from 0 to 1, v round it). Paint, fins,
   foam and the place a part is attached are functions of those coordinates, so they move with the body for free.
3. **Time is an argument.** `time` is an input like any other. Motion is a closed-form function of it, so any frame
   can be drawn without the frames before it, and a loop closes when the formulas say so.

## Install and the first scene

You need [bun](https://bun.sh) and pnpm; `cwebp` writes stills and `ffmpeg` writes clips. Rendering is headless
WebGPU through bun, so no browser is needed for pictures.

```sh
git clone <this repository> loft && cd loft
pnpm install
alias loft="bun src/cli/main.ts"
```

Put this in `examples/reed.ts` (a scene is a module whose default export is a `scene`):

```ts run
// examples/reed.ts
import { add, mul, scene, plane, sin, strand, time, toon, vec3, type F } from "../src/index.ts";

const reed = strand({
  name: "reed",
  // The centre line, one point for every m from 0 (root) to 1 (tip). The tip sways with time.
  spine: (m: F) => vec3(mul(mul(m, m), mul(sin(time), 0.6)), mul(m, 4), 0),
  girth: (m: F) => add(0.25, mul(m, -0.2)),
  tips: ["open", "point"],
  paint: [0.85, 0.55, 0.2],
});

export default scene({
  ground: plane,
  things: [reed],
  style: toon(),
  sun: [-0.4, 0.8, 0.45],
  cameras: { three: { kind: "perspective", eye: [6, 4, 8], target: [0, 2, 0], fovY: 0.6 } },
});
```

Look at it:

```sh
loft render examples/reed.ts --out out/reed.webp --views three
loft frames examples/reed.ts --out out/reed_frames.webp --times 0,0.8,1.6,2.4 --view three
loft dev examples/reed.ts
```

`render` writes one picture per camera into one sheet. `frames` draws one camera at several times. `dev` serves a live
page on port 5173 with orbit, the scene's cameras, a time bar and a slider for every `param`; it reloads when you save.
Every command prints its timings and an `rgba` hash of each frame, so two versions of a picture can be compared exactly.

Today a scene must have a sea (see "The ground" below).

## Adding a shape

A shape is a function. The library has a few families, each a short composition over the level below, so leaving one
is a step down and not a rewrite. `spiralTube` is a tapered tube on a logarithmic spiral; `spiralLine` is its centre
line and radius in the form `strand` takes, so you can keep the curve and change the rest.

```ts run
import { add, cos, draw, mul, scene, plane, sin, spacing, spiralLine, spiralTube, strand, surface, toon, vec3, TAU, type F } from "../src/index.ts";

// A spiral tube: one law ties the curl to the taper (read its doc comment for what it cannot do).
const frond = spiralTube({ name: "frond", length: 5, curl: 2.4, taper: 0.2, girth: 0.3, out: [0, 1, 0], toward: [1, 0, 0], paint: [0.3, 0.6, 0.35] });

// One step down: the same kind of centre line, another radius law (a club that swells near the tip).
const line = spiralLine({ length: 4, curl: 1.2, taper: 0.5, girth: 0.25, out: [0, 1, 0], toward: [-1, 0, 0] });
const club = strand({
  name: "club",
  spine: (m: F) => add(line.spine(m), vec3(-3, 0, 0)),
  girth: (m: F) => mul(line.girth(m), add(1, mul(sin(mul(m, Math.PI)), 1.5))),
  up: line.up,
  tips: ["open", "round"],
  paint: [0.8, 0.5, 0.3],
});

// Any function of (u, v) is a surface: here a bowl, a profile turned round the y axis.
const bowl = surface((u: F, v: F) => {
  const r = add(0.4, mul(sin(mul(u, 1.4)), 1.2)), a = mul(v, TAU);
  return vec3(add(mul(r, cos(a)), 3), add(mul(u, 1.5), 0.2), mul(r, sin(a)));
}, { u: ["cap", "free"], v: "periodic" });

export default scene({
  ground: plane,
  things: [frond, club, draw.surface("bowl", bowl, { paint: () => vec3(0.9, 0.85, 0.7), grid: { u: spacing.even(24), v: spacing.even(32) }, sides: "two", outline: "border" })],
  style: toon(),
  sun: [-0.4, 0.8, 0.45],
  cameras: { three: { kind: "perspective", eye: [4, 6, 12], target: [0, 1.5, 0], fovY: 0.7 } },
});
```

The families: `strand` (any centre line, girth, section and twist), `spiralTube` and `shell` (spirals), `limb` (a chain
of segments reaching a target), `fan` and `crest` (sheets), `surface`, `lathe`, `extrude`, `sheet`, `loft` (maps of
(u, v)), `draw.field` (a distance function traced per pixel, for folded and recursive solids), `draw.relief` (fine
form on a surface), `impostors` and `drawCopies` (many small solids), and `hull` and `ship`. Examples:
`examples/serpent.ts` (a swept body with parts placed on it), `examples/shell.ts` (a surface written directly),
`examples/coral.ts` and `examples/nest.ts` (traced folds), `examples/shell_relief.ts` (relief), `examples/brig.ts`
(a ship from numbers).

## Adding motion

Motion is a function of `time`. The library's motion helpers are the twelve principles of animation as formulas
(`docs/animation_principles.md`): an action has three beats, a wind-up that goes the wrong way first, an arrival that
overshoots, loose parts that arrive late and swing on, and a hold that never quite holds still.

```ts run
import { add, alive, anticipated, beats, dragged, mod, mul, scene, plane, sin, strand, swing, time, toon, vec3, type F } from "../src/index.ts";

// Every 4 seconds: a 0.8 s wind-up, a 0.2 s bow, then 1.5 s to settle.
const b = beats(mod(time, 4), { anticipate: 0.8, act: 0.2, settle: 1.5 });
// Lean back through the wind-up, snap forward on the act, then swing and settle; never quite still.
const lean = add(add(mul(anticipated(b.anticipate), -0.3), mul(b.act, 1.0)), add(mul(b.settle, -1.0), swing(b.after, 0.4)));
const bend = add(lean, alive(time, 0.05, 1));

const stalk = strand({
  name: "stalk",
  // The tip reads a later clock than the root (drag): its sway arrives late.
  spine: (m: F) => vec3(mul(mul(m, m), add(mul(bend, 3), mul(sin(dragged(time, m, 0.4)), 0.15))), mul(m, 4), 0),
  girth: (m: F) => add(0.3, mul(m, -0.22)),
  tips: ["open", "round"],
  paint: [0.4, 0.55, 0.85],
});

export default scene({
  ground: plane,
  things: [stalk],
  style: toon(),
  sun: [-0.4, 0.8, 0.45],
  period: 4,
  cameras: { side: { kind: "perspective", eye: [0, 3, 12], target: [0, 2, 0], fovY: 0.6 } },
});
```

`period: 4` says the scene loops every 4 seconds; `alive` takes a `period` (or wrap the build in `looping`) when idle
motion must come round exactly. Other tools: `keys` and `through` (poses on a timeline or a path), `response` (a damped
spring's answer to a step), `retarded` (a clock delayed down a body), `struck` (a pose struck and held dead still),
`cast` and `score` (expressions as named poses scored against beats), `gait` and `footing` (feet planted while the
body moves), `pendulum` and `dart` (hanging and nervous parts), `routine` (a group on counts: unison, canon, mirror,
solos). Look at frames across an action before and after: `loft frames <scene> --times 0,0.4,0.8,1.2,1.6,2 --view side`.

## An action a game can read, with its checks

An attack is defined once, from what a game's simulation would give it: when it arms, how long the warning is, the
hit shape, the target. The pose through time, the warning on the water and the checks are derived from that one
definition. Export `checks` beside the scene and `loft check` runs them on the CPU, from the same expressions the GPU
draws, and exits 1 on a failure.

```ts run
import { add, animate, attack, budget, f, hit, landsInside, minScreenSize, mul, part, scene, sea, strand, sub, telegraph, toon, vec2, vec3, warned, type F } from "../src/index.ts";

// The rest pose: a tentacle standing out of the water. An attack moves the spine's m = 0 end, so that is the tip.
const rest = (m: F) => vec3(mul(sub(1, m), 0.5), add(-0.5, mul(sub(1, m), 4)), 0);
const lash = attack({
  name: "lash",
  arm: 3, // seconds: when it lands
  warn: 2, // seconds of warning before that (it must start before the wind-up does)
  target: { kind: "disc", centre: vec2(7, 0), radius: f(1) },
  part: "tip",
  motion: { kind: "lunge", hit: hit.capsule({ a: [1.5, 0], b: [6, 0], radius: 0.8 }), reach: 0.4, lead: 1, height: 0.6, coil: 1.2, rise: 1, approach: 0.3, neck: 1.2 },
});
const creature = animate(rest, [lash], (spine) => {
  const body = strand({ name: "tentacle", spine, girth: (m: F) => add(0.1, mul(m, 0.25)), tips: ["round", "open"], paint: [0.7, 0.3, 0.5] });
  return { things: [body], parts: { tip: part("tip", body, { from: 0, to: 0.15, tip: 0 }) } };
});

export default scene({
  ground: sea({ swell: [{ direction: [1, 0.3], length: 9, height: 0.15, speed: 1 }] }),
  things: [...creature.things, telegraph(lash)],
  style: toon(),
  sun: [-0.4, 0.8, 0.45],
  cameras: { three: { kind: "perspective", eye: [4, 9, 14], target: [3, 0.5, 0], fovY: 0.7 } },
});

export const checks = [landsInside(creature.strikes.lash!), warned(lash), minScreenSize(creature.parts.tip!, "three", 8, { at: 3 }), budget({ triangles: 100_000 })];
```

```sh
loft check examples/strike.ts
```

The checks that exist: `landsInside`, `stopsAt`, `staysClear`, `warned`, `gripReaches`, `releasesAt`, `throwLands`,
`fliesClear`, `letsGoClean`, `shoves`, `frontFirst` (an attack's contract), `minScreenSize`, `spansOnScreen`,
`staysInView`, `expressionsRead` (what reads on screen), `limbsReach`, `holdsStill`, a routine's `inSync`, and
`budget`. `examples/strike.ts` is a serpent that bites one ship and sweeps its tail at another, with a smear and a
wake; `examples/grab.ts` takes hold of a ship and carries it.

## A creature with variants

A design is one subject with a record of numbers, slots with named options, and named variants. A variant is valid
when it builds and passes the subject's checks, whatever proportions it changes. Export it as `design`.

```ts run
// examples/beacon.ts
import { add, mul, scene, plane, strand, toon, vec3, type Drawable, type F, type Option } from "../src/index.ts";
import { design as makeDesign } from "../src/index.ts";

type N = { readonly height: number; readonly colour: readonly [number, number, number] };
type Top = Option<N> & { readonly draw: (n: N) => Drawable };
const tops = {
  base: { about: "a round bulb", draw: (n: N) => strand({ name: "top", spine: (m: F) => vec3(0, add(n.height, mul(m, 0.8)), 0), girth: 0.5, paint: n.colour }) },
  spike: { about: "a long point", numbers: { height: 3 }, draw: (n: N) => strand({ name: "top", spine: (m: F) => vec3(0, add(n.height, mul(m, 2.5)), 0), girth: 0.3, tips: ["round", "point"], paint: n.colour }) },
} satisfies Record<string, Top>;

const stem = (n: N) => strand({ name: "stem", spine: (m: F) => vec3(0, add(-0.3, mul(m, n.height + 0.3)), 0), girth: 0.15, paint: [0.3, 0.3, 0.3] });

export const design = makeDesign({
  name: "beacon",
  numbers: { height: 2, colour: [0.9, 0.6, 0.2] } as N,
  slots: { top: tops },
  variants: { tall: { about: "the spike, in a darker ink", pick: { top: "spike" }, numbers: { colour: [0.5, 0.3, 0.6] } } },
  compare: ["three"],
  build: (picked, n) => ({
    scene: scene({
      ground: plane,
      things: [stem(n), picked.top.draw(n)],
      style: toon(),
      sun: [-0.4, 0.8, 0.45],
      cameras: { three: { kind: "perspective", eye: [5, 4, 8], target: [0, 2, 0], fovY: 0.6 } },
    }),
    checks: [], strikes: {}, holds: {}, waves: {},
  }),
});
```

```sh
loft variants examples/beacon.ts
loft render examples/beacon.ts --variant tall,top=base --views three --out out/beacon_mix.webp
loft check examples/beacon.ts --combinations
```

`loft variants` draws every named variant through the design's `compare` cameras onto one labelled sheet; `--variant`
takes a name, `slot=option` picks, or both (`tall,top=base`). `docs/variants.md` is the full account, and
`examples/bosses/reefback_titan.ts` is a large design with five slots.

## Choosing and lighting a style

A style is a value of type `Style`: a set of functions in the same expression language as the shapes (how a surface
is shaded, its ink, the water, a cast shadow, the sky) plus full-screen post passes. Any scene draws in any style
without being edited.

```sh
loft render examples/serpent.ts --style woodblock --out out/serpent_print.webp
loft render examples/serpent.ts --style woodblock --light hatched --out out/serpent_hatched.webp
loft gallery --scenes "examples/serpent.ts,examples/storm.ts" --styles toon,papercraft
```

The named styles are `toon` (bands, an ink outline), `woodblock` (a print: flat inks, a printed shadow block, named
lightings in `docs/lighting.md`), `biolume` (a night sea) and `papercraft` (folded paper). In code, `withStyle(scene,
style)` and `withLight(scene, name)` do what the flags do, and `toon({ bands, outline, shadow, ink, water, sky, rim })`
takes options. Writing your own style is writing a `Style` value (below); `src/style/biolume.ts` (about 110 lines) is
the shortest complete one to copy.

## The ground

A scene stands on one of three grounds, given as `ground:`

```ts
scene({ ground: sea({ swell: [...] }), things, style, sun })   // water: any number of swells (an empty list is flat water)
scene({ ground: plane,   things, style, sun })                 // a flat floor at y = 0 in the style's ground colour
scene({ ground: nothing, things, style, sun })                 // no floor: the style's sky all round
```

A sea gives contact foam where bodies meet it and takes their cast shadows; `examples/maelstrom.ts` deforms it into a
whirlpool and `src/geom/afloat.ts` floats a body on it. A plane takes cast shadows and nothing else. On nothing there
is nowhere for a shadow to fall. Things that need water say so by name: a wake on a plane, or a telegraph on nothing,
throws a `GroundError`. The three smallest scenes that are not sea pictures are in `examples/first/`.

## Making a clip

```sh
loft clip examples/serpent.ts --out out/serpent.mp4 --seconds 8 --fps 30 --view three
loft frames examples/stormwing.ts --out out/sweep.webp --times 1 --count 6 --sweep strike=0..1
```

`clip` pipes raw frames to ffmpeg (H.264). A scene with `period` loops seamlessly when the clip is a whole number of
periods. `--input name=value` sets a host input (a ship's position, the sun) and `--sweep name=a..b` moves one across
the frames, which is the quickest way to see what a game's state does to a scene.

## What draws a thing, and what you can bring

Loft is a rasteriser with per-pixel tracers inside bounds, not a path tracer. What draws a thing (`src/draw/`,
`src/soft/`):

- **Rasterised surfaces**: any map of (u, v) on a grid, posed in the vertex stage, painted per pixel, with an ink
  outline (`draw.surface`, `strand`, everything swept).
- **Tracers inside a bound**, each drawn as its bounding box and solved per pixel: sphere-traced distance fields
  (`draw.field`), shell-traced relief on a surface (`draw.relief`), analytic impostors (one sphere, capsule or cone per
  lattice cell, `impostors`) and lists of solids (`drawCopies`).
- **Media integrated in closed form**: clouds and mist (`draw.density`), glows, lightning and rain (`src/soft/`).
- **Derived layers**: the sky, cast shadows on the water (from capsules along each body's skeleton), contact foam, and
  the style's post passes.

Lighting is one sun and the style's own shading. There are no reflections or refraction, no indirect light or global
illumination, and no shadow maps: shadows are cast from capsule chains (so their shape follows the skeleton, not the
exact surface), onto the water always and onto bodies only in styles that print a shadow block. Effects that look
like these (biolume's reflection, papercraft's crease shading) are post passes reading the picture and its depth.

Where you can bring your own:

- **A drawable.** Anything with a `name`, `draws(ctx)`, `skeletons` and `surfaces` is a `Drawable`
  (`src/compile/context.ts`). `draws` returns WGSL shaders and draw calls, each with a phase (`background`, `opaque`,
  `on-bodies`, `water`, `on-water`, `transparent`); `ctx.table` declares a per-frame table your raw WGSL reads, and
  `ctx.post` adds a full-screen pass. The compiler owns bindings, tables and order; nothing in it changes for a new
  kind. The sky is the smallest real one (`src/draw/sky.ts`, 30 lines):

```ts check
import { drawSpec, type Drawable } from "../src/index.ts";

// A full-screen gradient behind everything: one triangle, no depth write.
const WGSL = /* wgsl */ `
struct VOut { @builtin(position) clip: vec4<f32>, @location(0) y: f32 };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let xy = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u)) * 2.0 - 1.0;
  return VOut(vec4<f32>(xy, 0.99999, 1.0), xy.y);
}
@fragment fn fs(in: VOut) -> @location(0) vec4<f32> { return vec4<f32>(mix(vec3<f32>(0.9, 0.8, 0.6), vec3<f32>(0.3, 0.4, 0.7), in.y * 0.5 + 0.5), 1.0); }`;

export const backdrop: Drawable = {
  name: "backdrop",
  skeletons: [],
  surfaces: [],
  draws: () => ({ shaders: { backdrop: { code: WGSL, libs: [] } }, draws: [drawSpec({ label: "backdrop", shader: "backdrop", vertices: 3, phase: "background", cull: "none", depthWrite: false })] }),
};
```

- **A WGSL function inside expressions.** `wgslFn` (`src/lib/wgsl.ts`) wraps a function written in WGSL so it can be
  called from any expression (GPU only: the CPU twin, and so the checks, cannot evaluate it).

```ts check
import { mul, vec3, type F } from "../src/index.ts";
import { wgslFn } from "../src/lib/index.ts";

const stripes = wgslFn<"f32">({ name: "my_stripes", ret: "f32", wgsl: "fn my_stripes(x: f32) -> f32 { return step(0.5, fract(x * 8.0)); }" });
export const paint = (u: F) => mul(vec3(0.9, 0.7, 0.3), stripes(u));
```

- **A style, and post passes.** A `Style` is a plain value (`src/style.ts`): write one, or spread an existing one and
  replace a function or append to `post` (a pass is `{ label, wgsl }` defining `fs(in: PostIn)`).
- **A host of your own.** `loft build <scene> --out <dir>` writes the scene as files: `manifest.json` (every WebGPU
  object to create, in WebGPU's own names, and the per-frame recipe), `wgsl/` and `bin/`. A loader executes the
  recipe and decides nothing about the scene (`docs/artefact_format.md`). Below.

## Drawing a scene elsewhere

```sh
loft build examples/serpent.ts --out out/files/serpent
loft render --artefact out/files/serpent --out out/serpent_from_files.webp --views three
```

The second command draws from the files alone, without the compiler or the scene module, and says so. In a browser,
`createHost(device)` from `src/host/index.ts` loads an artefact onto your own `GPUDevice`. In Rust,
`rust/loft-loader` loads the same directory onto a `wgpu` device a game already owns (`Loft::load`, `set_camera`,
`set_time`, `set_input`, `set_param`, `encode_frame`; its README has the calls). A game sets inputs by name each frame
(where a target is, when an attack arms) and reads nothing back; what it needs to know about an attack, it computes
from the same numbers it gave. `loft bake <scene> --out f.glb` exports the bodies at one time as a glTF mesh.

## Commands

```sh
loft render   examples/serpent.ts --out out/a.webp --views front,side,top,three --time 1 --size 1280x800
loft frames   examples/serpent.ts --out out/b.webp --times 0,0.5,1,1.5 --view three
loft clip     examples/serpent.ts --out out/c.mp4 --seconds 8 --fps 30
loft dev      examples/serpent.ts --port 5173
loft check    examples/strike.ts
loft profile  examples/serpent.ts --view three --frames 30
loft variants examples/beacon.ts --views three
loft gallery  --scenes "examples/*.ts" --styles toon,woodblock
loft build    examples/serpent.ts --out out/files/serpent
loft bake     examples/serpent.ts --out out/serpent.glb
```

`loft help` prints every flag; `loft context` prints the whole library for a reader in one go.

## Where to go next

- A spread of examples, short to long: `examples/shell.ts`, `examples/brig.ts`, `examples/pearls.ts`,
  `examples/coral.ts`, `examples/storm.ts`, `examples/serpent.ts`, `examples/maelstrom.ts`, `examples/scenes/`.
  Read them for mechanisms; do not start from their proportions (`loft context range` says why).
- `docs/components.md`: every export, with what its comment says it cannot do.
- `docs/animation_principles.md` (motion), `docs/lighting.md` (the print's lightings), `docs/variants.md` (designs),
  `docs/artefact_format.md` (the files). `DESIGN.md` is the record of decisions, not a tutorial.
