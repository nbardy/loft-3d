<!--
Written orientation printed at the top of `loft api` (and so of docs/api.md and `loft context`): the layers, the
renderer, what a user can bring, the limits. Everything after it is generated (src/cli/api.ts). Snippets fenced
`ts run`, `ts check` and `sh` are run by `bun tools/check_snippets.ts`.
-->
Loft describes animated 3D things as TypeScript expressions and compiles them to WGSL plus tables of numbers that any
WebGPU host draws. Files in `examples/` import `../src/index.ts`; `src/lib/index.ts` adds plain functions (distance
functions, folds, noise, raw WGSL). `loft` is `bun src/cli/main.ts`.

**The layers** (the sections below, in this order). Each is written in the one below, so leaving a component is a step
down, not a rewrite. Core: expressions (`time`, `input`, `param`), curves, maps (a shape is a function:
`surface((u, v) => point)`, `sweep`, `lathe`), drawables (`draw.*`), the scene and the compiler. Shapes: `strand`,
`spiralTube`, `coil`, `chain`, `fan`, `sheetOn`, `ropes`, soft media. Motion: the animation principles as
formulas, gaits, struck poses. Actions: `attack` and its warning, grabs and throws, `design` with slots and variants,
group routines. Checks: measured on the CPU from the same expressions (`loft check`). Styles: `Style` values and the
named ones. A module marked "unproven" has had one user so far; expect to cut it down when your subject fights it.

**What draws a thing.** A rasteriser with per-pixel tracers inside bounds, not a path tracer: rasterised (u, v)
surfaces with ink outlines (`draw.surface`, everything swept); sphere-traced distance fields (`draw.field`),
shell-traced relief (`draw.relief`), analytic impostors and listed solids (`impostors`, `draw.copies`), each solved per
pixel inside its bounding box; media integrated in closed form (`draw.density`, glows, lightning, rain); and derived
layers (sky, cast shadows on the water, contact foam, post passes). One sun. No reflections, refraction, indirect
light or shadow maps: shadows come from capsule chains along each skeleton (on bodies only in a style that prints a
shadow block); what resembles reflection or occlusion is a post pass reading the picture and its depth.

**What you can bring.** A `Drawable` (`name`, `draws(ctx)` returning WGSL shaders and phased draws, `skeletons`,
`surfaces`; `ctx.table` for a per-frame table, `ctx.post` for a full-screen pass; `src/draw/sky.ts` is 30 lines). A
WGSL function inside expressions (`wgslFn`; GPU only, so checks cannot evaluate it). A `Style` value, fresh or spread
from another. A host: `loft build` writes `manifest.json`, `wgsl/`, `bin/` (`docs/artefact_format.md`), executed by
`createHost` (`src/host/index.ts`) or `rust/loft-loader` on `wgpu`.

**What it cannot do today.**
- No ground but the sea: every scene has `sea({ swell })` (an empty list is flat water).
- No path tracing (above). One sun.
- No simulation: everything is a closed form of time and inputs; nothing carries state from frame to frame.
- No meshes in: shapes are functions (`loft bake` writes glTF out).
- Headless rendering needs bun; the package is not published; a large subject is megabytes of WGSL and seconds to load.
- Several components take only numbers, so their family is fixed (`whirlpool`, `sea`): leave them by
  writing the map yourself one level down.

**Reading the entries below.** Each value has the first sentence of its comment; `cannot:` and `relatives:` lists
where its comment states them. A component with no `cannot:` list has not said where its family ends: assume it ends
sooner than you think, and read its whole comment with `loft api <name>`.
