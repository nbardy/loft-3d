<!--
The written part of `loft context` (src/cli/context.ts): the craft, condensed, then the generated API map where the
marker below stands, then failures and where to read more. docs/craft.md is the long form for people; keep this one
short, since it is read in full before every scene. `bun tools/check_snippets.ts` runs its code and checks that every
name in its inline code is exported.
-->
# Loft

TypeScript expressions compiled to WGSL. A scene imports from `../src/index.ts` and default-exports
`scene({ ground, things, style, sun, cameras })`; `ground` is `plane` (y = 0), `nothing` or `sea`. y is up. `time` is
an argument, in seconds, so any frame draws alone; `period` says when every motion repeats. Expressions (`add`, `sin(time)`,
`vec3`) draw on the GPU and evaluate on the CPU. A swept body's m runs 0 (root) to 1 (tip) and v 0 to 1 round it; a
surface's u and v run 0 to 1; paint is a function of them. Give every scene two cameras: the whole with room round
it, and the focus. `strand`, `spiralTube`, `sheetOn`, `ropes` and `impostors` return things: put them in `things`. `coil`, `fan`,
`sheet`, `lathe`, `loft` and `extrude` return a bare surface: draw it first, `draw.surface(name, surface, { paint, grid })`.
One sun lights bodies (no other lights on them); water can mirror what stands on it (`reflection`, a post pass), bodies
mirror nothing; no simulation; meshes come out (`loft bake`), none go in. `loft` is `bun src/cli/main.ts`.

```ts run
// examples/reed.ts
import { add, mul, scene, plane, sin, strand, time, toon, vec3, type F } from "../src/index.ts";

const reed = strand({
  name: "reed",
  spine: (m: F) => vec3(mul(mul(m, m), mul(sin(time), 0.6)), mul(m, 4), 0), // a point for each m; the tip sways
  girth: (m: F) => add(0.25, mul(m, -0.2)),
  tips: ["open", "point"],
  paint: [0.85, 0.55, 0.2],
});

export default scene({
  ground: plane,
  things: [reed],
  style: toon(),
  sun: [-0.4, 0.8, 0.45],
  cameras: {
    whole: { kind: "perspective", eye: [6, 4, 8], target: [0, 2, 0], fovY: 0.6 },
    tip: { kind: "perspective", eye: [2.5, 4.5, 3], target: [0, 3.6, 0], fovY: 0.5 },
  },
});
```

```sh
loft render examples/reed.ts --out out/reed.webp --views whole,tip --size 640x400
loft frames examples/reed.ts --out out/reed_t.webp --times 0,0.8,1.6 --view whole --size 480x300
```

# Craft (long form: docs/craft.md)

**Range in shape: change the construction, not the number.** A viewer recognises a shape's law, not its numbers: ten
spiral tubes with different curls are one shape. Make three to five far-apart candidates before refining any, small on
one sheet; write the weakest thing about each, pick one, push it further than feels safe. Each must change at least one
of: the spine (`through`, `wave`, `spiralLine`, a heading written in m with `tabulate`); the section (`aspect`,
`squareness`, `twist` as functions of m); the topology (tube `strand`, sheet `sheet` or `fan`, turned `lathe`, folded
`draw.field` with `fold3`, copies `impostors`); the construction (`extrude`, `loft`, `grow`, `tree`, relief
`draw.relief`). Otherwise it is a retune. Read a component's limits (`loft api spiralTube`: its law, what it cannot
draw, its relatives), then go one level down and write the rest. Examples and presets pull: take how a part attaches
from them, never a proportion; make first the candidate you would not have made.

**Set the target in words first;** there are no reference pictures, and without a target the first render becomes it.
In the file's top comment: the silhouette in one sentence, the three largest forms and their proportions, what makes
it unlike the nearest example, two or three inks and one accent, the beats of its motion, and predictions a render can
be scored against (a part's pixels from a named camera, what is in front of what, a beat's length).

**Range in style: compose parts, write a part.** Presets (`toon`, `woodblock`, `biolume`, `papercraft`) are four looks,
not range. Paint in body coordinates (`palette.countershade`, `palette.bands`, `palette.spot`, `tile`), choose which
parts carry ink, make sky and ground part of the picture. A `Style` is a plain value: spread one and replace `shade`;
a `post` pass changes the whole frame.

**Shapes that read.** Large forms first, judged in flat paint; silhouette before detail; proportion and carriage are
identity; detail in clusters, not spread evenly; contrast with what is behind decides whether a feature exists.

**Motion that reads.** Three beats, wind-up several times the act (`beats`); the wrong way first and past the mark
after (`anticipated`, `overshot`, `response`); loose parts lag (`dragged`, `swing`); nothing still or in step (`alive`,
`uneven`); a pose struck and held (`struck`); arcs and weight (`arc`, `squash`, `impact`, `footing`, `carriage`,
`gait`); temperament is timing (`dart`, `pendulum`); a warning before an action (`attack`, `telegraph`); then push it
(`exaggerated`).

**Predict, then look.** Expressions run on the CPU (`compileJs`), so predict sizes and positions first and keep them as
exported `checks` (`minScreenSize`, `staysInView`). Look at your render small, from its camera, as a silhouette and
across the motion (frames, above); change the largest thing first.

<!-- the API map is printed here -->

# Wrong without an error

A one-sided surface wound inside out shows its far wall or nothing (try `sides: "two"`); a camera aimed past the
subject shows sky; a subject far too small or large for its camera; a `period` that is not every motion's own jumps at the loop.
`minScreenSize` and `staysInView` catch two. Exit 6 is the environment, not the scene.

# More

`loft api` (everything); `loft api spiralTube` (one entry whole, with its limits and relatives); docs/craft.md;
docs/guide.md.
