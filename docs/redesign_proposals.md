# Four redesign proposals (2026-11-11)

Status: proposals. Nothing here is built. Figures marked PREDICTED are worked out from counts, not measured; the
measured ones are from `loft profile` on one loaded M-series laptop and swing about 2x between runs.

## What is wrong today

| Per frame, five monsters on a sea | Today |
|---|---|
| Pose, in JavaScript on the CPU | 7 to 10 ms (sum of separate measurements) |
| Draw calls | about 300 (the crab scene alone is 109) |
| Monsters' own GPU time | about 4 to 5 ms |
| Sea and fixed costs | 2 to 5 ms |
| Shaders compiled at load | one per drawable, dozens per scene; time not measured |
| Runs in the game's Rust client | no: an artefact contains a JavaScript function |

How it works now: TypeScript builds an expression graph in memory. The compiler turns the graph into WGSL shaders, a
draw list and tables, in tens of milliseconds, at load. That part is already compiled to the GPU. What is not: each
frame a generated JavaScript function evaluates every moving body's skeleton into tables and uploads them.

All motion in Loft is a closed formula in time and a few inputs, with no state carried between frames. Every proposal
below leans on that.

## Proposal 1: GPU-native Loft

Keep the language and the drawables. Move everything that runs per frame onto the GPU and make the artefact pure data.

- **Classify every table by what it depends on**, from the leaves of its expression: nothing, time within a period,
  one input, or anything. The compiler already does this for traced fields.
- **Periodic tables are computed once**, over one period, and stored as a small 2D table (time by station). The vertex
  stage reads two rows and blends. Per-frame cost: none.
- **One-input tables** (an attack's progress) are stored the same way over the input.
- **Everything else is filled by a compute pass** generated from the same expressions that the JavaScript is generated
  from today. Sequential steps (arc length, frames carried along a spine) are loops inside one invocation; a table is
  a few dozen entries.
- **Shadows are drawn from the GPU's own tables.** The CPU loop over capsules and sea heights goes away.
- **Level of detail and culling per copy move to a compute pass** that writes indirect draw arguments.
- **The artefact becomes files**: WGSL, binary tables, a draw list, compute passes. `loft build` writes them ahead of
  time; a client only creates pipelines. No JavaScript at run time, so a Rust loader becomes a few hundred lines.
- **Shaders are shared**: one module per kind of drawable with the scene's differences in tables, where today each
  drawable has its own. Pipelines are cached.
- **Draws are batched per object**: all rigid parts in one draw, all cloth in one, with `posed` copies. The fleet
  already shows 4 ships in 22 draws against about 180.
- **Textures become a type**: a 2D or 3D table with mip levels. Noise, lighting ramps and baked paint read it.
- **Particles**: spray and splashes as closed-form motion of instanced points, in the vertex stage.

PREDICTED: pose 7 to 10 ms on the CPU becomes under 0.1 ms on the GPU plus one dispatch; draw calls about 300 become
about 40; load compiles under ten shader modules.

Loses: nothing in the language. Costs: the compiler's back end is rewritten around tables it can place itself; every
CPU reader of a pose (checks, level of detail, shadows) has to move or keep a slow path for tools only.

Shows it was wrong if: a compute pass per frame costs more than 0.3 ms on integrated graphics, or the periodic
tables' memory passes a few megabytes per monster.

## Proposal 2: Loft as an asset compiler

Keep the language as an authoring tool only. Compile each monster to standard assets that the game's own renderer
draws.

- **Bodies become skinned meshes**: a strand's stations are bones; skin weights come from the body's own coordinates.
- **Motion becomes clips**: periodic motion is sampled into animation tracks; attacks become clips with events.
- **Procedural motion that follows the game** (look at a ship, a claw aimed at a marker) becomes a few bones the game
  drives directly.
- **Paint becomes textures**: each body's paint is baked over its own coordinates, with mip levels. Lines are stored as
  distance-to-line in a channel, so they stay crisp at any zoom.
- **Styles become a handful of shaders in the game**, written once: print, toon, papercraft. A palette index per
  vertex or texel selects inks.
- **Attacks export their hit shapes and timings as data** for the game's rules, so the warning and the rule cannot
  disagree.
- **Folded and marched things are baked to meshes** or to instanced parts.
- **The export is glTF**, so Blender and every other tool can open it.
- **Loft's renderer stays as the preview**, not as the product.

PREDICTED: a monster is 1 to 3 draws and about 0.1 to 0.3 ms of GPU time; pose is bone matrices from clips in native
code, far under 0.1 ms; nothing of Loft runs in the client.

Loses: paint that is exact at any resolution; motion that is a free formula of game inputs; anything that cannot be
skinned (the whirlpool, clouds) needs its own path in the game. Costs: a skinning exporter, a clip sampler, three
shaders and a loader in the game.

Shows it was wrong if: baked motion visibly loses what made the monsters look alive, or the game ends up needing
most of Loft's formulas at run time anyway.

## Proposal 3: Loft on three.js

Keep the creature library, attacks and checks. Replace Loft's own compiler back end and host with three.js and its
shading language, which already turns typed graphs written in JavaScript into WebGPU shaders.

- **Expressions map to three's shader nodes**; the CPU reading stays for checks.
- **Drawables become three objects**: instanced meshes, skinned meshes, lines, points.
- **Pose runs in three's compute nodes** or as bone textures.
- **Styles become node materials and post passes**: toon ramps, outlines, paper.
- **Textures, shadows between bodies, mesh import, an inspector and a WebGL fallback** come with it.
- **Loft shrinks** to what is its own: about a third of today's code, PREDICTED.

Loses: control of shader size and of exactly what runs; the tight artefact. The large problem: the game's client
draws with its own Rust renderer, and three.js cannot draw inside it. This only works if monsters are drawn in a
layer of their own in the browser, or if the game's rendering moves to JavaScript.

Shows it was wrong if: the game cannot accept a second renderer, which I expect is the case.

## Proposal 4: fixed pipelines and atlases

Stop generating a shader per drawable. Keep six fixed shaders (body, sheet, copies, sea, soft, post) and describe
every monster as rows in tables.

- **A body is a row**: which spine table, which radius profile, which tile of the paint atlas, which inks.
- **All bodies of all monsters draw in one call per shader**, instanced, with level of detail chosen per instance.
- **Pose is an atlas**: every spine of every monster over time, filled as in proposal 1.
- **Paint is an atlas**, baked from the same expressions at build time, with distance-to-line channels for crisp
  ink.
- **Styles are the six shaders' variants**, not generated code.
- **Nothing compiles at load** beyond the fixed set, and the fixed set ports to Rust once.
- **The language stays for authoring**; it fills tables and atlases, and no longer emits shader code for bodies.

PREDICTED: five monsters and a fleet in 10 to 20 draw calls; load time independent of content; a Rust client needs
only the six shaders and a table reader.

Loses: per-drawable shader freedom (a new kind of surface means a new fixed shader); exact paint beyond the atlas's
resolution. Costs: the largest rewrite of the four; the atlas baker; a decision on how much variety six shaders can
carry.

Shows it was wrong if: the monsters need more than about a dozen distinct shaders to keep their look.

## How they relate

- Proposal 1 is the prerequisite for a Rust client under every option except 2.
- Proposal 4 is proposal 1 taken further: the same GPU pose, with code generation for bodies removed.
- Proposal 2 is the shortest path to monsters in the game and the one that keeps least of Loft at run time.
- Proposal 3 is the least code to own and the worst fit for the game's client.

## Recommendation

Do the first half of proposal 1 now: classify tables, bake the periodic ones, fill the rest in a compute pass, draw
shadows on the GPU. It removes the largest measured cost, changes no scene, and every other proposal needs it or is
unaffected by it. Then decide between a Rust loader for Loft's artefacts (1, growing toward 4) and exporting assets
(2), with one monster taken through each as the test.
