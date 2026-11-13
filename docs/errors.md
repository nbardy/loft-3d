# When a scene fails

<!-- `loft context` prints this file down to "## Every refusal" (src/cli/context.ts). Keep that part short. -->

`render`, `frames`, `clip` and `check` end with one line on stderr, `loft: <kind>: <message>`, and one exit code:

| Exit | Last line starts | Meaning | Change the scene? |
|---|---|---|---|
| 0 | (none) | drew, or every check passed | no |
| 1 | `loft: internal` | an untyped error inside Loft: a bug, or a mistake no constructor catches yet (stack printed above) | maybe; report it |
| 2 | `loft: usage:` | the command line asked for something absent: a flag, camera, variant, option, input, style | no, the command |
| 3 | `loft: load:` | the module did not load as a scene: syntax, an unknown import, a throw at top level, wrong exports | yes |
| 4 | `loft: scene:` | a constructor refused the scene; the message says given, expected and the fix, and ends `(at file:line)` | yes |
| 5 | `loft: check:` | the scene drew, and the checks named on the line failed | yes |
| 6 | `loft: environment (not the scene's fault):` | the GPU, the WebGPU binding, or a missing `cwebp`/`ffmpeg`; a shader or pipeline that failed to build was already tried on 3 fresh devices | no |

Does it type-check: `pnpm exec tsc --noEmit`. Does it render, and what to change:

```sh
loft render examples/shell.ts --out out/shell.webp --views three
loft check examples/strike.ts
```

The most likely refusals, each `given ...; expected ... Fix: ...`:

| Message (start) | Cause | Fix |
|---|---|---|
| `scene(): given sea: ... (the old key) and no ground` | `sea:` is now `ground:` | `ground: sea({ swell: [...] })`, `ground: plane` or `ground: nothing` |
| `load: ... Export named 'x' not found` | an import Loft does not export | the nearest name it suggests, or `loft api` |
| `add: given a vec3 and a vec2` | arithmetic on vectors of two sizes | make both one size: `vec3(v.xy, 0)`, or `.xy` |
| `vec3: given 2 components` | too few or many numbers | exactly 3, or one for all |
| `draw.surface "x": given a surface whose point is an f32` | the surface function returns a number | return `vec3(x, y, z)` |
| `draw.surface "x": given paint that returns an f32` | paint returns a number | return `vec3(r, g, b)` |
| `scene(): given a Surface ... at things[k]` | a shape put in `things` undrawn | `draw.surface("name", shape, { paint, grid, sides, outline })` |
| `draw.surface "x": given undefined for the surface` | the shape is not defined yet on that line | define it before drawing it |
| `draw.surface "x": given sides "both"` (or `outline`) | an option misspelt | `sides: "one" \| "two"`, `outline: "hull" \| "border" \| "none"` |
| `scene(): camera "c": given fovY 60` | degrees for radians | `fovY: 60 * Math.PI / 180` |
| `scene(): given two things named "x"` | names key shaders | rename one |
| `draw.field "x": the field can overshoot` | the field is not a distance | fix the field, or the `safety` it suggests |
| `X needs a sea; this scene's ground is a plane` | a wake or foam on dry ground | `ground: sea(...)`, or drop the thing |
| `usage: --style "x": no such style` / `input "x": ... no such input` | the command names what is absent | a name from the list printed |

## Every refusal

Each row is a fixture in `tests/fixtures/mistakes/`; `bun tests/fixtures/mistakes/run.ts` prints each one's exit code
and last line.

| # | Message (after `loft: <kind>:`) | Cause | Fix |
|---|---|---|---|
| 01 | `draw.surface "sheet": given a surface whose point is an f32` | the surface returns one number | return `vec3(x, y, z)` |
| 02 | `scene(): given two things named "ball"` | two drawables share a name | rename one |
| 03 | `scene(): camera "three": given eye and target both at [...]` | the camera looks at its own eye | move the eye back |
| 04 | `draw.surface "ball": given paint that returns an f32` | paint returns a grey as one number | `vec3(g, g, g)` |
| 05 | `draw.surface "ball": given grid.u with 0 cells` | an empty grid | `spacing.even(32)` |
| 06 | `draw.surface "body": given undefined for the surface` | the shape is used before it is defined | define it first |
| 07 | `input "aim": given a default of 2 numbers for a vec3` | the default has the wrong size | `input("aim", "vec3", [0, 1, 0])` |
| 08 | `usage: input "wind": the scene declares no such input` | `--input` names an undeclared input | drop it, or declare `input("wind", ...)` |
| 09 | `usage: --style "inky": no such style (styles: ...)` | an unknown style | one of the styles listed |
| 10 | `draw.field "blob": the field can overshoot` | the field changes faster than distance | fix the field, or `safety:` as printed |
| 11 | `tabulate "lift": given 10000000 samples` | a table larger than one GPU binding | a few thousand samples |
| 12 | `a number in an expression: given Infinity` | a division by zero in a constant | the line named at the end |
| 13 | `scene(): given things: undefined` | no `things` | `things: [draw.surface(...)]` |
| 14 | `usage: slot "colour" of design "d" has no option "purple"` | `--variant` names an absent option | one of the options listed |
| 15 | `scene(): given sun [0, 0, 0], which points nowhere` | a zero sun | `sun: [0.3, 0.8, 0.4]` |
| 16 | `add: given a vec3 and a vec2` | vectors of two sizes | `vec3(v.xy, 0)` or `.xy` |
| 17 | `vec3: given 2 components` | a short vector | `vec3(x, y, 0)` |
| 18 | `scene(): given a Surface (a shape, not yet drawn) at things[0]` | a shape in `things` | `draw.surface("name", shape, {...})` |
| 19 | `scene(): camera "three": given fovY 60` | degrees for radians | `60 * Math.PI / 180` |
| 20 | `draw.surface "ball": given sides "both"` | a misspelt option | `sides: "one"` |
| 21 | `load: ...: the default export is a design` | a design exported as default | `export const design = design({...})` |
| 22 | `scene(): given sea: ... (the old key) and no ground` | the key before 2026-11 | `ground: sea({...})` |
| 23 | `load: ... Export named 'spiralTub' not found` | a misspelt import | `spiralTube` (suggested) |
