# A render fails only when the scene is wrong

Two things a reward built on Loft needs: a render that does not fail for no reason, and a failure message that tells
the writer of the scene what to change. This file is the theory, written before the runs, and then the score.

## 1. The intermittent build failure

### What was seen

- `AGENTS.md`: "a shader module has also failed to build intermittently" under a loaded machine.
- `docs/gpu_native.md`: a load of reefback failed in Dawn with *The stage (Fragment) of the entry point "fs" isn't the
  expected one (Vertex)* for `surface.cutterDactyl`; the same load passed four times after.
- `docs/lineup.md`: the same message, load average 30, second load built.

The message says Dawn was handed `"fs"` as the **vertex** entry point. Loft's lowered manifest names `vs` for the vertex
stage (`src/host/lower.ts`); nothing in Loft can produce `"fs"` there. So the string changed between Loft and Dawn.

### Reading bun-webgpu 0.1.7 (`node_modules/bun-webgpu/index.js`)

`defineStruct` packs every string and every nested struct or array into a fresh `Uint8Array`/`ArrayBuffer`, takes its
address with `ptr(...)`, writes the address into the parent struct, and **drops the JS reference** (lines ~1482, 1493,
1522, 1575, 1592, 1610, 1621). Nothing keeps those buffers alive until the FFI call that reads them. Any allocation
later in the same pack (the next string, the next nested struct) can run the collector, free the buffer, and hand its
memory to the next allocation of the same size class. `"vs"` and `"fs"` are both two bytes: the vertex stage's name is
freed, the fragment stage's name lands on the same address, and Dawn reads `"fs"` for both stages.

### Hypotheses and what each predicts

| | Hypothesis | Predicts |
|---|---|---|
| H1 | **Use after free in bun-webgpu's struct packing** (above) | Failures are wrong strings: entry-point stage mismatches, WGSL parse errors in text Loft never wrote, unknown entry points; rate rises with *GC activity*, not with GPU load. With the JSC collector forced to run continuously (`BUN_JSC_collectContinuously=1`) the crab (125 render pipelines, ~100 modules, megabytes of WGSL) fails in **more than half** its loads and the shell (4 pipelines) in **at least one in ten**; with the packer keeping its buffers alive until the call returns, **0** of the same loop, with or without the forced collector. |
| H2 | A race between overlapping async pipeline creations or error scopes | The host awaits each creation in turn (`scoped`, host.ts), so at most one is in flight: predicts no failure attributable to it. If seen: an error naming one pipeline whose cause is another's descriptor, independent of GC. |
| H3 | Device lost or out of memory under a loaded machine | Messages naming a lost device or OOM; correlated with memory pressure, not with the collector. |
| H4 | A timeout | Loft sets none; Dawn's async callbacks have none. Predicts hangs, not errors. |
| H5 | Bun 1.3.10's own crash (`AGENTS.md` / wave_sim notes: exit 133 with Bun's panic banner) | A process killed by a signal with Bun's banner, at any stage, independent of the scene. Not fixable in Loft: can only be named. |

Baseline prediction, the machine at load ~25 with other workers: the crab fails in 0 to 3 of 48 loads, the shell in 0
of 48 (few allocations between pack and call). A baseline of 0 does not refute H1; the forced-collector run decides it.

### The plan

1. Baseline: `bun tools/render_loop.ts base-crab examples/bosses/reefback_titan.ts:game --procs 4 --runs 12`, and the
   shell the same way.
2. H1's amplifier: the same loops with `--env BUN_JSC_collectContinuously=1`.
3. The fix, if H1 holds: a `pnpm patch` of bun-webgpu that keeps every packed buffer alive until the current
   synchronous job ends (Dawn copies descriptors during the call, so that is long enough), then the same four loops.
4. Whatever remains (H5) is classified as the environment's: retried a bounded number of times, then a distinct exit
   code and "not your scene".
### The score (2026-11-13, after merging main; M-series Mac, load average 4 to 9 before the loops)

`bun tools/render_loop.ts <tag> <scene:view> --procs P --runs R [--env BUN_JSC_collectContinuously=1]`. "Attempts" counts
the load attempts the CLI retried on a fresh device (src/cli/main.ts), which a run's exit code hides.

| Loop | bun-webgpu | Runs failed (exit 6) | Load attempts failed |
|---|---|---|---|
| crab, 6 x 8 | as published | 0 of 48 | 0 |
| crab, 6 x 8 | patched | 0 of 48 | 0 |
| crab, 4 x 3, collector forced | as published | **12 of 12** | **36 of 36** |
| crab, 4 x 3, collector forced | patched | 0 of 12 | 0 |
| shell, 4 x 12, collector forced | as published | **10 of 48** | **72 of 110** |
| shell, 4 x 12, collector forced | patched | 0 of 48 | 0 |

The failing text, as published: `surface.shell (shell): pipeline creation failed: The stage (Fragment) of the entry
point "fs" isn't the expected one (Vertex).` (stage: pipeline), and `shader "surface.sea" ... failed to compile:` with
WGSL Loft never wrote (stage: shader module), and on the crab every kind of build (pose stages, surfaces, outlines).
H1 holds as predicted, both ways: the forced collector breaks the published binding at the predicted rates (crab more
than half, shell at least one in ten) and the patched binding not once. The unforced baseline is 0 of 48 both ways
on a quiet machine, as predicted (a baseline of 0 does not refute H1). H2 to H5 were not seen.

The fix is installed by pnpm: `pnpm-workspace.yaml` names `patches/bun-webgpu@0.1.7.patch` under
`patchedDependencies`, and the lockfile records its hash, so `pnpm install` (checked from an empty `node_modules`)
links the patched copy. A bun-webgpu other than 0.1.7 makes `pnpm install` fail until the patch is redone.

## 2. The twenty mistakes (fixtures: `tests/fixtures/mistakes/`, runner `run.ts` there)

Each fixture is a correct scene (`_ok.ts`, drawn) with one mistake. "Today" is what `loft render` printed before this
work (exit code, first line). "Wanted" is the message planned before any code changed: raised where the mistake is
made, naming the user's thing, saying what was given, what was expected and the smallest fix. Every message that is
the scene's fault ends the run with exit 4 and the last line `loft: scene: ...`; a command-line mistake with exit 2,
`loft: usage: ...`. A SceneError also names the line of the user's file it was raised from.

| # | Mistake | Today | Wanted (raised at) |
|---|---|---|---|
| 01 | surface returns a number, not a point | 1, `vec4(...) got 2 components`, stack in src/compile | `draw.surface "sheet"`: the surface's point is an f32; expected a vec3. Fix: return vec3(x, y, z) |
| 02 | two things named alike | 1, `scene: two things are named "ball"` + stack | `scene`: two things named "ball"; names must be unique (sky, sea, shadows are taken). Fix: rename one |
| 03 | camera eye = target | 1, `camera: eye and target coincide`, raised in src/host at draw time | `scene`: camera "three" eye equals target. Fix: move the eye back from the target |
| 04 | paint returns a number | 1, `shader "surface.ball" failed to compile` (WGSL), src/host: looks like a GPU failure | `draw.surface "ball"`: paint returns an f32; expected a vec3 colour. Fix: vec3(g, g, g) |
| 05 | zero-cell grid | 1, `grid.u.count must be a positive integer, got 0` + stack | same at `draw.surface "ball"`, typed; Fix: spacing.even(32) |
| 06 | shape slot `undefined` | 1, `TypeError: undefined is not an object (evaluating 's.skeleton')` | `draw.surface "body"`: given undefined for the surface; expected a Surface (surface(), lathe(), sweep()...). Fix: define it before drawing |
| 07 | input default wrong size | 1, `input "aim": default has 2 components, vec3 needs 3` + stack | `input "aim"`, typed; Fix: input("aim", "vec3", [0, 1, 0]) |
| 08 | `--input` the scene does not declare | 2, message then the usage text (last line is usage) | exit 2, last line `loft: usage: input "wind": the scene declares no such input (it has: none)` |
| 09 | `--style` that does not exist | 1, `unknown style "inky"` + stack | exit 2, usage: unknown style "inky"; styles: ... |
| 10 | field not a distance | 1, `FieldSafetyError` (good text) + stack in src/compile | the same text, exit 4, no stack (raised at compile: measuring needs the CPU evaluation compile does) |
| 11 | table of ten million entries | killed after 60 s (the compiler samples every entry) | `tabulate "lift"`: 10000000 entries; one binding holds 8388608. Fix: fewer samples |
| 12 | Infinity in a shape | 1, `non-finite constant Infinity`, stack | `a number`: given Infinity; expected finite. Fix: a division by zero? (the user's line named) |
| 13 | no `things` | 1, `TypeError: Spread syntax requires ...iterable` | `scene`: no things; expected things: [draw.surface(...), ...] |
| 14 | option not in a slot | 2, `slot "colour" ... has no option "purple" (options: base, blue)` (good) | the same, last line `loft: usage: ...` |
| 15 | sun [0, 0, 0] | 1, `the sun must be above the horizon (sun.y > 0)`: wrong cause | `scene`: sun is a zero vector; expected a direction toward the sun with y > 0. Fix: sun: [0.3, 0.8, 0.4] |
| 16 | vec3 + vec2 | 1, `mismatched vector types vec3 and vec2`, stack | `add`: a vec3 and a vec2; expected one size or a number. Fix: vec3(v.x, v.y, 0) or .xy |
| 17 | vec3 of two numbers | 1, `vec3(...) got 2 components`, stack | `vec3`: 2 components; expected 3, or 1 for all three. Fix: vec3(a, b, 0) |
| 18 | a Surface put in `things` | 1, `TypeError: ... (evaluating 's.joints')`, stack in src/compile | `scene`: things[0] is a Surface, not a drawable. Fix: draw.surface("name", it, {...}) |
| 19 | `fovY: 60` (degrees) | **0: draws a wrong picture** | `scene`: camera "three" fovY 60; expected radians in (0, pi). Fix: 60 * Math.PI / 180 |
| 20 | `sides: "both"`, `outline: "ink"` | **0: draws, the misspellings silently ignored** | `draw.surface "ball"`: sides "both"; expected "one" or "two" (and outline: "hull", "border", "none") |
| 21 | a design as the default export | 1, `TypeError: ... (evaluating 'scene.style.post')`, stack | load: the default export is a design; Fix: `export const design = ...` |
