# Loft

Loft describes animated 3D things as TypeScript and compiles the description to WGSL shaders plus tables of numbers
that any WebGPU host can draw: a browser, bun headless, or a Rust game through `wgpu`. Shapes are functions, bodies are
coordinate systems (so paint and parts move with them), and time is an argument (so motion is a closed form and any
frame draws alone). The same expressions run on the CPU, where checks measure exactly what the GPU draws.

```ts run
// examples/reed.ts
import { add, mul, scene, plane, sin, strand, time, toon, vec3, type F } from "../src/index.ts";

const reed = strand({
  name: "reed",
  spine: (m: F) => vec3(mul(mul(m, m), mul(sin(time), 0.6)), mul(m, 4), 0), // m runs root (0) to tip (1)
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

## Install

Needs [bun](https://bun.sh) and pnpm; `cwebp` for stills and `ffmpeg` for clips. Pictures render headless; no browser.

```sh
pnpm install
alias loft="bun src/cli/main.ts"
loft render examples/reed.ts --out out/reed.webp --views three
```

## Commands

```sh
loft render   examples/serpent.ts --out out/a.webp --views front,side,top,three   # one picture per camera, one sheet
loft frames   examples/serpent.ts --out out/b.webp --times 0,0.5,1,1.5             # one camera, several times
loft clip     examples/serpent.ts --out out/c.mp4 --seconds 8                      # H.264 through ffmpeg
loft dev      examples/serpent.ts                                                   # live page: orbit, time, sliders
loft check    examples/strike.ts                                                    # the scene's checks, on the CPU
loft variants examples/beacon.ts                                                    # every variant of a design (docs/guide.md)
loft profile  examples/serpent.ts --view three                                      # GPU time per draw
loft build    examples/serpent.ts --out out/files/serpent                           # the scene as files for any host
loft help
loft api spiralTube                                                                 # one export, in full
loft context                                                                        # craft guide and API, to read whole
```

`--style`, `--light`, `--variant`, `--input` and `--sweep` change what is drawn without editing the scene; `loft help`
lists every flag.

## Exit codes

`render`, `frames`, `clip` and `check` end with one last line on stderr, `loft: <kind>: <message>`, that a script can
match. A scene refusal names your own thing, what was given, what was expected and the fix (`docs/errors.md` lists them).

| Exit | Last line starts | Meaning |
|---|---|---|
| 0 | | drew; or every check passed |
| 1 | `loft: internal` | a bug in Loft, or a mistake no constructor catches yet (a stack is printed) |
| 2 | `loft: usage:` | the command line asked for something absent (flag, camera, variant, option, input, style) |
| 3 | `loft: load:` | the module did not load as a scene (syntax, unknown import, a throw at top level, wrong exports) |
| 4 | `loft: scene:` | a constructor refused the scene: `given ...; expected ... Fix: ... (at file:line)` |
| 5 | `loft: check:` | the scene drew and the checks named on the line failed |
| 6 | `loft: environment (not the scene's fault):` | GPU, WebGPU binding, or missing `cwebp`/`ffmpeg`; builds already retried on 3 fresh devices |

## Where to go next

- `docs/guide.md`: the first scene, then one short section per task (a shape, motion, an action with checks, a
  creature with variants, styles, clips, your own drawable or host), each with code that runs.
- `docs/craft.md`: how to make shapes and motion that read, and how to get range in shape and style.
- `docs/api.md`: every export by layer, generated from the source.
- Examples, short to long: `examples/shell.ts`, `examples/brig.ts`, `examples/pearls.ts`, `examples/coral.ts`,
  `examples/storm.ts`, `examples/serpent.ts`, `examples/maelstrom.ts`, `examples/scenes/`.
- `docs/artefact_format.md` and `rust/loft-loader/` for drawing a scene outside this repository. `DESIGN.md` and the
  rest of `docs/` are the record of how it was designed.

Every snippet in these docs is run by `bun tools/check_snippets.ts`. Typecheck: `pnpm exec tsc --noEmit`.
