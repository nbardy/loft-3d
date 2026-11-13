# Loft: API design (v0)

Loft is a way of describing animated 3D things as code, and a compiler that turns the description into shader source
plus tables of numbers that any WebGPU host can draw. The reasoning behind it is in
`room-runners-arena-lib`, `notes/design/2026-11-10_creature_pipeline_options.md`, sections 10 to 12. This file is the
contract for building it.

## 1. What is being built

```
 authoring code (TypeScript)          the compiler (TypeScript)             a host
 builds a scene description   --->    scene -> Artefact              --->   draws an Artefact
 src/map, src/draw, src/geom, ...     src/compile                           src/host (WebGPU: browser, bun headless)
                                      Artefact = WGSL + tables + draw list  later: Rust/wgpu inside the game
```

Nobody compiles TypeScript to anything. TypeScript runs normally and *builds a graph of expressions*; the compiler
turns that graph into WGSL (for the GPU, including the once-per-frame pose stages) and JavaScript (the CPU reading of
the same programs, for checks, baking and tests). The game would load
an Artefact; it never runs authoring code.

Five ideas, in the order the code depends on them:

1. **Expressions** (`src/expr.ts`, done). Authoring code builds `Expr` values. One DAG, two backends (JS, WGSL), tested
   to agree, with `fetch` (an entry of a per-frame table) and `iterate` (a real loop) as well as arithmetic.
2. **Curves are the atoms.** A curve is any function of one variable, `(x: Expr<f32>) => Expr<T>`. Curves built from
   keys are stored as rows of a table, so editing one is a buffer write, not a recompile. Named numbers are `param`s
   with the same property.
3. **A body is a coordinate system.** A strand (a spine plus a thickness) defines coordinates `(m, v, rho)`: `m` in
   [0, 1] along the spine, `v` in [0, 1] around it, `rho` the distance out as a fraction of the thickness. The skin is
   `rho = 1`. Paint, attachments, outlines and foam are all expressed in those coordinates. A coordinate system is a
   `Chart`; charts compose, which is the scene graph.
4. **Time is an argument, not a system.** Every expression may read `time` and host inputs. A body at a chosen time
   is a *slice*; the pose pass can evaluate the same body at several times (now, an attack's arming time, recent past)
   to derive telegraphs, smears and wakes.
5. **Description and schedule are separate.** The scene says what things are. The compiler decides where each part is
   evaluated: per frame on the CPU (spine stations), per vertex (surfaces), per pixel (fields on the sea, volumes).

Open types: a shape is a function whose signature says how it can be drawn (section 7); an object may be several
(a body is a Surface, a Chart and a Skeleton). The one rule: everything is pure.

## 2. Authoring API

Everything is built on the map algebra of section 7: shapes are functions over `Expr`, drawn by one generic drawable
per signature. The names below are the library on top of it.

```ts
import { crest, draw, keys, on, palette, param, place, points, scene, sea, strand, through, toon, vec3, wave } from "loft";

const girth = keys([[0, 0.3], [0.06, 0.9], [0.45, 1.0], [0.85, 0.4], [1, 0.02]]);   // a table-backed curve
const body = strand({                                  // a sweep (a Surface, a Chart, a Skeleton) that draws itself
  name: "serpent",
  spine: (m) => through(m, [[-9, 0.4, 0], [-4, 0.9, 1.5], [0, 0.6, -1.2], [4, 1.8, 0.4], [7, 3.2, 0]])
                  .add(wave(m, { axis: [0, 0, 1], waves: 1.6, rate: 0.5 })),
  stations: 40,
  girth: (m) => girth(m).x.mul(param("serpent.girth", 1.1)),
  section: { aspect: 0.9, squareness: 2.3 },
  paint: (m, v) => palette.countershade(v, { back: [0.16, 0.13, 0.33], belly: [0.86, 0.82, 0.62] }),
});
const head = place(strand(headSpec), on(body, [0, 0.25, 0]));     // headSpec's spine is in the neck's frame there
const spikes = draw.points("spikes", place(points(7, (i) => ({ at: vec3(i.mul(0.03).add(0.6), 0.25, 0.9), scale: 1 })), body), spike);
                                                                      // spike: another strand, drawn once per point
const fin = crest({ on: body, name: "fin", from: 0.12, to: 0.8, height: keys([[0, 0], [0.3, 1.2], [1, 0]]), paint: [0.75, 0.2, 0.28] });

export default scene({
  ground: sea({ swell: [{ direction: [1, 0.3], length: 14, height: 0.25, speed: 1.1 }] }),
  things: [body, head, spikes, fin],
  style: toon({ bands: 3, outline: 0.045 }),
  sun: [-0.6, 0.5, -0.6],
  cameras: { three: { kind: "perspective", eye: [-14, 9, -13], target: [0, 1, 0], fovY: 0.6 } },
});
```

`compile(scene) -> Artefact`; `compileScene(scene) -> { artefact, frame(state), cpu(roots), table(name) }` for checks,
tests and the baker. A scene module's default export is a `Scene`. Working examples: `examples/serpent.ts`,
`examples/shell.ts` (a surface written as a map, painted through a fold), `examples/serpent_scales.ts`.

### 2.1 Curves (`src/curve.ts`)

- `type Curve<T> = (x: In<"f32">) => Expr<T>`; the map signature `Curve` is `Curve<"vec3">`.
- `keys(points, { interp?: "smooth" | "linear" })`: keyed curve sampled into a curve row (`CURVE_N` vec4s), so an edit
  is a buffer write. `ramp(colours)`. `through(m, points)`: closed-form Catmull-Rom through points that may move.
- Motion, all closed form in time: `wave`, `retarded(t, m, speed)`, `response(t, { f, zeta, r })`, `pulse`.
- `keys` makes a new row per call: build a curve once, outside the functions that use it (the compiler refuses a row
  first seen after layout, which is how that mistake shows).

### 2.2 The library (`src/geom/`)

- `strand(spec) -> Strand`: `sweep` with defaults and a look. Spec: `name`, `spine(m)`, `stations`, `girth(m)`,
  `section` (`aspect(m)`, `squareness`), `twist(m)`, `tips` (`"round" | "point" | "open"` or with lengths), `up`,
  `level`, `paint(m, v)`, `detail` (rings along, segments around). A `Strand` is a `Body` and a `Drawable`; placing it
  (`place(s, chart)`) or slicing it (`s.at(t)`) keeps its look; `draw.points(name, pts, s)` instances it.
  Body coordinates: m in [0, 1] along the spine, v in [0, 1] round it (0.25 the dorsal line, 0.75 the belly), rho out
  as a fraction of the thickness (skin at 1). Frames are rotation-minimising (Wang et al. 2008) with optional levelling;
  radii scale by 1 / sqrt(stretch) (volume preservation), growing by at most `bulge` (default about 4.47, a stretch
  floor of 0.05). Stretch is per unit of m, so a pose whose stations bunch (a curve laid out by angle, a Bezier with a
  short arm) swells there; a body posed by such laws states `bulge: 1.3` or so (see 9, "Not done").
- `crest(spec) -> SurfaceDrawable`: a `sheet` standing on the line of constant v of a body, rising along its section's
  outward direction, raked and fluttering; drawn two-sided with ink on its free edge.
- `sea(spec) -> Sea`: the root chart (x, z, height above the water), and the water as a glazed surface in that chart:
  a projected grid of cells a constant size on screen (section 12), the style's `water`, foam where any opaque body
  meets it (from scene depth).

### 2.3 Style (`src/style.ts`)

A style is a program in the same language: `{ shade(ctx), ink(ctx), outline, water(ctx), shadow(ctx), sky(ctx), post,
clear }`. `shade` lights a base colour and tints it under water; its context carries the surface's coordinates, anchor
and identity for patterns that must ride the body (2.6). v0: `toon`.

### 2.4 Planned (unchanged in intent; to be written on section 7)

- Space-time: `telegraph(obj, { arm })`, `smear`, `wake` from `body.at(t)` slices.
- Soft things: `decal` (a glazed surface laid on the sea), `cloud` (`draw.density`), `glow` (`draw.curve`).
- Checks evaluated on the CPU through `compileScene(...).cpu`: `clearance`, `minScreenSize`, `budget`.
- Local form and sculpt layers: stamps and displacement tables over (m, v) (`tabulate` of a function of (m, v)), the
  mesh round trip (`bake` out with body coordinates as UVs; fit back as a radius function plus a sculpt layer).

### 2.5 Creature parts (`src/geom/`, as built)

Short functions over maps; every argument is a number, a curve or an expression an art director would name. All are
closed form (no solver state), so any of them can be read at another time. Tests: `tests/geom.parts.test.ts`
(geometry, CPU) and `tests/creatures.gpu.test.ts` (the two examples build every pipeline).

| Part | File | What it is |
|---|---|---|
| `limb({ root, target, lengths, bend, foot? }) -> { joints, knots, spine(m) }` | `limb.ts` | two or three segments by the law of cosines. In reach the tip is on the target and the middle joint on the `bend` side; out of reach the chain lies straight along the line to the target; lengths always kept. Three segments hold the last one along `foot` (default down) and reach the ankle; if the ankle is out of reach the last segment points from where it got to toward the target. `spine` is the polyline by arc fraction, for a strand (pinch its girth at `knots`). `polyline(m, points, knots)`, `unit(v)` |
| `gait({ feet, phase, course, stride, period, duty, lift }) -> { body, travelled, foot(i), planted(i) }` | `gait.ts` | feet homes in the body's course frame; foot i is planted where the course put its home at the middle of this cycle's stance (cycle `floor(t / period + phase[i])`) and swings on an arc to the next plant. `course.line`, `course.arc` (with `facing`, so a crab walks sideways). A planted foot is fixed in the world while the body moves |
| `fan({ rays, sag, scallop, slack? }) -> Surface` | `fan.ts` | a membrane between rays (curves, root 0 to tip 1; `rayOf(body)` makes a flexing body a ray). u across (ray k at k / (n - 1)), v along. Between rays: the ruled surface, bellied by `sag` toward d/du x d/dv, its free edge cut toward the root by `scallop` x chord; both profiles are the normalised catenary `catenary(f, slack)`. Passes through every ray exactly |
| `shell({ turns, growth, aperture, umbilicus, spire, aspect?, coil?, ridges? }) -> Surface` | `spiral.ts` | Raup's coiling (W = `growth` per whorl, D = `umbilicus`, T = `spire`), apex at the origin, spire up; ridges a whole number per whorl, folded into the section. p(u + 1/turns) = growth x p(u) exactly; the front faces out for either coil. `whorl(u, turns)`, `ridgePhase(u, turns, perTurn)` for paint in its own coordinates |
| `horn({ name, length, curl, taper, girth, out, toward, twist?, paint }) -> Strand` | `spiral.ts` | the same law in a plane: a tube on an equiangular spiral whose radius grows with the spiral (e^(k theta) = 1 + m (taper - 1), so arc length is linear in m). Horns, claws, pincer fingers, teeth, tusks (curl 0 is a cone). Sliders may drive length, curl, taper, girth |
| `mirror(part, name)`, `mirror.surface(s)` | `symmetry.ts` | reflection across z = 0 of the part's own coordinates. A strand: spine and frame seed reflected, twist negated, paint at v -> 0.5 - v. A surface: reflected and read at u -> 1 - u so its front still faces out. Mirror before placing; a part placed at v on a host pairs with its mirror placed at 0.5 - v |
| `array(part, count, placement)` | `symmetry.ts` | named copies `<name>_<i>` of a strand (or drawn surface) in rigid charts; each its own drawable (and shadow). For identical copies use `draw.points` |
| `rigid(frame) -> Chart` | `rig.ts` | a closed-form frame (a hovering root, a gait's body) as a chart, so parts are authored in the creature's frame and placed on it |
| `lookAt({ from, target, yaw, pitch })`, `breathe`, `beat(r, { rate, amplitude, lag, down })`, `strike(s, { anticipation, follow, timing })` | `motion.ts` | yaw/pitch held within limits; a skewed breath; a wing beat on a clock delayed by `lag * r` along the wing (the tip trails the root), with a phase warp for a quicker downstroke; a strike envelope over a 0..1 input: wind-up to -anticipation, hit at 1, follow-through to 1 + follow, back to 0 |

Examples: `examples/stormwing.ts` (fans between polyline finger bones, a fluke on the tail's own frame, mirrored horns
and eyes, a wing-clap on the `strike` input with a lightning stroke) and `examples/islandback.ts` (eight three-segment
legs on a gait, a Raup shell, unequal claws whose pincer fingers are horns, stalked eyes by `lookAt`, a claw slam on
the `slam` input). Learned on the way: a vertical bolt is a dot from a top-down camera (throw it along the sea); a
pincer that opens vertically hides behind its palm from above (open it in the palm's flat plane); and a shell's
aperture faces wherever the coil ends (u = 1 at `turns` whorls), so turn the shell to put it away from the camera.
### 2.6 Styles as built (`src/style.ts`, `src/style/`)

A look is a program; a scene names one, and any other can be swapped in without touching the scene:
`withStyle(scene, styleNamed("woodblock"))`, `--style name` on `render`, `frames`, `clip` and `dev`, and a selector in
the viewer (which recompiles: a style is shader code, so a new style is a new artefact). Styles by name live in
`STYLES` (`src/style/index.ts`): constructors, because a style declares params and params are global by name.

**The interface** (`Style`, `src/style.ts`). The compiler emits each function once into `sceneWgsl`:

| Member | Called from | Context |
|---|---|---|
| `shade(ctx)`, `ink(ctx)` | every lit surface's fragment stage (`ink` for the hull and border outlines) | `ShadeCtx`: base colour (the paint), normal, sun, view, world point, depth below the sea, and the body: `uv` (the surface's coordinates), `anchor` (`Surface.anchor` there), `id` (a hash of the drawable's name in [0, 1), varied per copy) |
| `mark(ctx)` | the same fragments; written to the picture's alpha | a number the style's post passes read back (`post_color(uv).a`) where a body was drawn; 1 for none |
| `outline` | the hull's offset (never under 1.5 px), or the screen ink pass's width (section 12.3) | a world width, usually a param |
| `water(ctx)` | the sea's fragment stage | `WaterCtx`: normal, sun, view, world, crest (-1..1), distance, `foam`, `contact`, `phase` |
| `shadow(ctx)` | cast shadows laid on the water | `LayerCtx`: world, view, distance, coverage |
| `sky(ctx)` | the background | view direction, sun |
| `post` | full-screen passes after the scene, in order | raw WGSL: the picture so far, the opaque scene's depth and position, `sceneWgsl` |
| `clear` | the clear colour | |

What grew, additively, for these styles (both in `WaterCtx`, built by `src/geom/sea.ts`):

- `contact`: how close a body is, continuously (1 at the body, 0 at the sea's foam width, negative beyond). The sea's
  contact search was split into this band and toon's shaping of it (`foam`), with the same arithmetic, so toon's frame
  is byte-identical to the one before (`tests/styles.gpu.test.ts`). `foam` is near-binary (two smoothed thresholds),
  so a style that wants its own foam shape (clawed, scalloped) needs the band. The band is grainy (its ring of taps
  turns by a hash at every pixel) and sits on two plateaus (the ring has two radii): enough for a soft edge or specks.
  A style that cuts flat shapes reads `contact.level` instead (2026-11-11): the same closeness from 21 taps, the four
  pixels of a quad turning the ring by four fixed quarter steps and sharing the least gap through two fine derivatives,
  four more taps along the nearest hit's direction, the gap measured across the water (height counted double beyond a
  quarter of the width), and the quad's value tilted toward the hit so it varies per pixel. Either is emitted only if
  the style reads it. `level`'s own lines are still rough by a pixel or two: use it to size shapes drawn in the world.
  With `level` comes `toward`, the unit direction across the water to the nearest body point (the way the level
  rises, by 1 / `width` a unit), and `width`, the sea's foam width: a shape drawn in the world is sized by the level
  at its own centre (level + offset . toward / width), so it stays one whole circle or hook. `WaterCtx.swell` is the
  direction the largest swell travels; `WaterCtx.marksLean` the direction a deformation says its foam leans
  (`SeaDeform.look` may return `lean`; the ring wave's is outward).
- `phase`: the phase of the largest swell, in cycles. Contours of the height field of two crossed swells close into
  rings (a topographic map); lines of constant phase run along the crests, which is what a printed or cut sea follows.

Nothing else was needed: every pattern is a function of what the contexts already carry, emissive light is simply
bright output (in a dark picture the bloom pass's threshold finds it), and paper grain is a post pass, so neither the
sky nor the sea needed pixel coordinates.

**Shared parts** (`src/style/shared.ts`): `edgeOf` (an edge antialiased by about a pixel, with a floor and a cap on its
width) and `POST_COMMON` (WGSL for post passes, prefixed `sty_`: pixel hash and value noise, view depth, a normal
reconstructed from neighbouring depths using the nearer of each pair, "is this pixel the sea", "is it submerged").

**The styles** (since 2026-11-12 each is composed from parts in `src/style/`, and `sketch` and `neon` join them: docs/styles.md is the current account; the descriptions below are of the pictures, which are unchanged).

- `toon` (`src/style/toon.ts`): banded sun, rim, gloss, an ink hull, a translucent stylised sea.
- `woodblock(spec?)`: bodies print in five inks (`WOODBLOCK_PALETTE`: black, indigo, a pale blue, cream, one vermilion), chosen
  by the paint's luminance times a two-tone light in value bands; a paint whose red stands above its green and blue
  prints vermilion. Every edge is antialiased by a pixel and no more. Post: a key line (silhouettes on their near side,
  measured against the plane through the pixel; creases from reconstructed normals; half-width 1.5 to 4.7 px wandering
  with world-space noise) over a colour block read 1.4 px out of register; then paper fibre and tooth. Sea: opaque, two
  flat blues, five printed lines per wavelength along `phase`, foam with fingers along the zero lines of a noise field
  and spray specks, both from `contact`; the foam the sea's deformations give (`WaterCtx.marks`, a whirlpool's arms) is
  printed cream over the water. Options (2026-11-11, from the five boss scenes, each of which wrapped the style):
  `inks` (the key block's black, indigo, pale, cream), `print` (which paints print in which inks: `print.bands({ accent })`,
  the rule above with an accent of hue `red` or `yellow` and its inks by luminance; `print.keys({ slate: { key, shadow,
  lit }, ... })`, each paint in its nearest key's two inks; `print.overprint({ ink, amount, value, black })`, every paint
  already an ink, its shadow side overprinted), `sky` (`haze` and `band` ranges of the view's height, the colour
  `below` the horizon), `water.eye` (the key black where a deformation darkens the water below a crest value) and `foam`
  (the pattern of the contact foam, a sum type `ContactFoam` built by `foam.ridge()`, the fingers along a noise's zero
  lines above and the default; `foam.curls()`, round lobes with curled heads and a ripple arc; `foam.apron()`, one flat
  scalloped shape; `foam.rings()`, ripple arcs; `foam.stipple()`, dots; `foam.breakers()`, blades along the printed swell
  lines: docs/art_direction/DIRECTION.md, "Contact foam"). Every pattern but `ridge` reads `Contact.near.level`, the
  sea's closeness without the band's grain (`loft_contact_level`, src/geom/sea.ts), which is computed only then.
  White water (2026-11-12, DIRECTION.md "White water"): `foam.roll()` is the collar as a rolling cream mass with a few
  large hooked heads, droplets and a ripple arc, and `marks: marksAs.heads()` prints a deformation's foam (a ring
  wave's crest) as a line of the same heads leaning the way the deformation says; both call one painter,
  `src/style/whitewater.ts` (`rollingFoam`, `curledHeads`, `crown`: given a mass 0..1, its slope, a lean and a head
  size, they return how much of a pixel is cream and how much key line), which a burst's own patch calls too
  (`examples/bosses/lib/impact.ts`, `impactPaint.roll()`). The five boss scenes use it; `woodblock()` stated nothing
  is still `ridge` and the flat marks.
  `woodblock()` is unchanged pixel for pixel.
- `biolume`: night sky and water; skin near black; a paint's light is `glowOf(base)`: as strong as it is bright and
  vivid, magenta for purples and reds, cyan for the rest, brightest facing the eye; cyan fresnel rim and hull; the water
  is translucent (submerged light shows), with faint ripple lines, twinkling plankton, and a cyan halo and foam from
  `contact`. Post: a reflection (light from bodies above a water pixel gathered down a wavering column), then a 40-tap
  spiral bloom with a soft shoulder.
- `papercraft`: facets from shading alone. The surface is cut by a 3D Voronoi lattice; each cell is lit by the surface's
  normal carried to its site through the normal's screen-space derivatives (a plane touching the surface there), and
  each cell is a fan of triangles, one per neighbour, sloping toward its edge (a low pyramid, raised or sunk). Fold
  lines along cell walls and spokes; a studio key that leans toward the camera; paint turned to card. Sea: opaque
  cut-paper sheets along `phase` with edges scalloped by cellular domes, a shadow under each edge and a lit cut edge;
  foam a scalloped white collar. Post: ambient occlusion from depth (16 taps) and paper fibre.

**The style sheet**: `bun src/style/sheet.ts [--out out/style_sheet.webp] [--size 640x400]`: rows toon, woodblock,
biolume, papercraft; columns serpent, shell, serpent_scales; one camera (`SHEET_CAMERA`).

**Patterns that ride the body** (as built 2026-11-11). Every `Surface` has an `anchor(u, v)`: a point that depends only
on (u, v), at about world scale. A body's is its skin straightened at rest: (arc length along the rest spine, the rest
section's ring), with the rest arc lengths in the station table's spare lane (`r.w`) and the section read at time 0, so
every slice of a body has the same anchor. A copy's (`framed`, `draw.points`) is its own surface's, scaled; a carried
or displaced surface keeps its base's; a closed-form surface's is its point at time 0 (one that reads a host's table,
such as a crest on a body, keeps that table's motion: a slice is not a substitution). A traced solid's is its world
point. Papercraft's Voronoi lattice is laid in the anchor (directions found there are carried to the world through the
screen: the same screen offset applied to the world point's derivatives), and woodblock's line weight is its `mark`
(noise over the anchor), which the key-line pass reads from alpha. A drawable evaluates the anchor only for a style
that reads it (`readsBody`), so toon's frames and cost are unchanged (its reference frame is byte-identical).
Test: `tests/style.anchor.test.ts` (the line weight at fixed body coordinates is the same at two times while the body
moves there). Pictures: `out/polish/serpent_close_{papercraft,woodblock}_{before,after}.webp`.

**Limits, as built.** Screen-space paper grain is fixed to the frame (the paper), so it does not swim with the camera but the picture moves
under it. Bloom is one pass with no downsampled mips (40 taps out to 30 px at 800 px high).

## 3. The Artefact (`src/artefact.ts`, done)

Read that file; it is the host contract. In short: a fixed prelude (bind group 0: frame, inputs, params, curves), an
artefact-declared bind group 1 of per-frame tables, complete shader modules, a list of buffer-less draws, optional
post passes, and the pose pass (since 2026-11-11, docs/gpu_native.md phase 1): `stages`, compute modules that fill the
per-frame tables on the GPU, one per level, run in order before the draws (each declares group 1 itself with the
dynamic buffers `read_write`; entry `pose_main`, `POSE_WORKGROUP` invocations per workgroup); `tables`, where each
table lives and how it is filled (`map` or `scan` at a level, or `cpu` with why); `cpuPose(state)`, the `cpu` tables
the host uploads before the stages (empty when every table is a program: then a host runs no JavaScript per frame);
and `pose(state)`, the CPU reading of every table, derived from the same programs, for tools and tests only.
`FrameState.curves` is the curve table the host holds now, so a `setCurves` edit moves the CPU fills exactly as it
moves the GPU.

Per-frame tables are `TableSource`s (`src/expr.ts`): `entries` entries of `lanes` vec4s, a `role`, and a `program`:
a `map` (runs of entries, each a closed form in its index; `mapOf`, `listOf`), a `scan` (entries in order carrying a
state; `step` called once with fresh variables, as `iterate`'s), or `cpu` (`prepare` and why). A table with `prepare`
and no program is read as `cpu`; static tables keep `prepare`. The compiler finds tables by walking the expressions it
emits (`fetch`), or a raw-WGSL drawable declares one with `ctx.table`. They are packed, in declaration order, into as
few storage buffers as hold them (`loft_tables_0`, ...), because a shader stage may bind 8 storage buffers and group 0
uses 3; `fetch(t, i, lane)` reads `t_<name>(u32(i) * lanes + lane)`. More than 5 buffers' worth fails at compile time
with `TableBudgetError`. A program may read other tables; it is scheduled a level after the deepest it reads (a cycle
throws). A `cpu` table pulls the maps and scans it reads onto the CPU too, listed as `cpu` "read by ...". Work that two
runs of a map share is hoisted into a one-invocation table `<name>_common`; each table, and each run of a table of
several, starts a SIMD group of its own (docs/gpu_native.md says why). A table whose `role` is `"static"` (a static `tabulate`, a sculpt layer, a field's distance brick or mesh) is
filled once when the artefact is compiled and packed into buffers of its own, `Artefact.statics` (bindings after the
per-frame ones, the same budget of 5), which the host uploads once at load; the pose function never returns them, so a
brick of megabytes costs nothing per frame (added 2026-11-11, optional in the contract: absent means none). The tables
the library declares:

| Table | Declared by | Per entry | Contents |
|---|---|---|---|
| `body_<name>` (`_<k>` per extra time slice) | every sweep that is drawn or read | 3 vec4 | scan: `p` (position, arc fraction), `q` (frame quaternion), `r` (half-width, half-height, stretch, rest arc length) |
| `body_<name>_spine` | the same | 3 vec4 | map: the spine placed (and twist), local (and half-width), at rest (and aspect), per posted station |
| `shadows` (with `shadows_at`, `shadows_joints`) | `src/draw/shadows.ts`, from every drawable's skeletons (a `draw.points` copy casts its surface's chain carried by its placement; a traced field a fitted blob) | 3 vec4 | maps: one capsule per segment projected along the sun onto the sea: ends, radii, strength, softness, chain links, valid (a segment under the water keeps its slot, all zero) |
| any name | `tabulate(name, f, n, "frame" \| "static")` | 1 vec4 | samples of f (frame: a map; static: uploaded once) |
| `<field>_brick` | `draw.field` with schedule `brick` or `auto` (static) | coarse cells, then bricks | `src/map/brick.ts`: per coarse cell (slot or -1, lower bound, union mask), then 9^3 samples per brick |
| `<field>_mesh`, `<field>_tris` | `draw.field` with schedule `mesh` or `auto` | 2 vec4 / 1 vec4 | vertices (position, normal); triangle corners, 4 indices per vec4 |

`stats.stations` counts the entries of tables whose role is `"stations"`. `stats.maxTriangles` is what the draw list
declares, the most a frame can draw; what a frame actually drew (after level of detail) is the host's `FrameStats`
(`Loaded.draw`, `GpuLoaded.frameTimed`).

Level of detail (section 12) added to the contract: `Draw.detail` (`fixed`, `grid`, `projected`), a uniform array
`loft_detail` at group 0 binding 4 (`DETAIL_SLOTS` vec4) that the host fills each frame and shaders read at their
`LOFT_DETAIL_SLOT` override (set by the compiler among the draw's constants), `View.cellPixels` (default
`CELL_PIXELS` = 7), `HYSTERESIS`, and `FrameStats`. The host keeps one piece of memory between frames: each grid's last
level, for hysteresis.

Foam where the water meets a body is not a table: the sea reads the opaque scene's depth and foams where an opaque
surface lies within the foam width in 3D. It needs no per-kind code and follows the drawn surface exactly.

## 4. Drawables (`src/compile/context.ts`)

```ts
interface Drawable {
  readonly name: string;
  draws(ctx: CompileContext): Emitted;          // { shaders: { key: { code, libs } }, draws: DrawSpec[] }
  readonly skeletons: readonly Skeleton[];      // what it casts shadows with (empty for none)
  readonly surfaces: readonly Bakeable[];       // what it draws that the baker can evaluate (empty for none): a surface
                                                // on its grid, or a triangle mesh (a field drawn as one)
}
interface CompileContext {
  readonly slots: Slots;                        // emit expressions: emitShaderFn(ctx.slots, { name, args, out, roots, ret })
  readonly style: Style; readonly ground: Ground; readonly sun: V3; readonly things: readonly Drawable[];  // Ground: section 13
  table(t: TableSource): TableRef;              // only for raw WGSL; fetched tables are found by themselves
  post(pass: { label; wgsl }): void;
}
type Phase = "background" | "opaque" | "water" | "on-water" | "transparent";
```

- Every library drawable is a `SurfaceDrawable` (`draw.surface`, `draw.glazed`, `draw.curve`, `draw.points`) except the
  sky and the shadows, which are raw WGSL. Nothing in `src/compile` knows a kind of thing.
- A shader module lists the library functions it calls; the compiler puts each either in `sceneWgsl` (when the shared
  functions use it too) or in that module. This is what lets a function that reads scene depth (the sea's contact foam)
  be an ordinary GPU-only library function.
- Order is stated, not wired: a draw names its phase; within a phase, the order drawables emit.
- The CPU backend (`compileJs`) is scalarised and folds constants as it emits; a fetch at a constant index is a direct
  array read, so the pose pass is plain arithmetic on what varies.

A new kind of thing is one module: build a map and hand it to a generic drawable, or write a `Drawable` with raw WGSL
that declares its table with `ctx.table` (see `src/draw/shadows.ts`, which reads every skeleton's joints through the
same expressions the vertex stage uses, and fills its table on the CPU).

## 5. Milestones and ownership

**M1, vertical slice.** One scene (the example in section 2: strand, crest, sea, toon style with an ink outline)
compiles, renders headless to a four-view sheet and a clip, and runs live in a browser with sliders.

| Part | Directory | Owner |
|---|---|---|
| Expressions, artefact contract | `src/expr.ts`, `src/artefact.ts` | done |
| Curves, strand, crest, sea, pose pass, toon style, `compile` | `src/curve.ts`, `src/geom/`, `src/scene.ts`, `src/style.ts`, `src/compile/` | compiler agent |
| WebGPU host, camera maths, capture | `src/host/` | host agent |
| CLI (render, clip, check), contact sheets, video, dev server and browser viewer | `src/cli/`, `viewer/` | tooling agent |

**M2, breadth** (after M1 works end to end): fan, shell, scatter, level of detail; whirlpool, placement, attachment;
telegraph, smear, wake and checks; clouds and glow; more styles.

**M3, pictures.** Scenes that are worth looking at.

## 6. Rules for code in this repository

- Pure functions; no hidden state; deterministic output. No clocks, no randomness except hashes of indices.
- Sum types and exhaustive `switch`; no silent fallbacks: an unknown case throws with a message that names it.
- Tests earn their place by catching a real bug: numerical agreement (CPU against GPU), round trips, invariants.
  No tests that restate a type.
- Comments say why. A non-obvious fix gets a comment at the site.
- f32 tolerances are 1e-4 relative or looser.
- bun runs everything; pnpm installs. `bun test`, `pnpm exec tsc --noEmit`.
- Known Dawn/bun-webgpu facts: `getCompilationInfo` is not implemented (validate with `pushErrorScope("validation")`
  and pipeline creation); `queue.writeBuffer` calls are ordered with the queue, not with encoder commands, so a
  buffer rewritten between passes of one submit holds only its last value.

## 7. The rethink: everything is a map (v0.2)

Loft used to describe kinds of thing (strand, crest, sea, decal, cloud), each with its own hand-written shader
template. Extending it to folding, to arbitrary analytic surfaces, to points and to traced solids kind by kind would
multiply those templates. This section replaces the kinds with one small algebra (built: 7.5; corrections: 7.6).
Section 2 is the library of *names* built on it.

### 7.1 A shape is a function, and its signature says how it can be drawn

| Signature | Name | Drawn by | Examples |
|---|---|---|---|
| index -> frame | `Points` | instancing another drawable, or splats | teeth, spikes, rain, a fleet |
| (u) -> point | `Curve` | a stroke: a ribbon or tube with a width function | ropes, lightning, ink lines, trails |
| (u, v) -> point | `Surface` | a grid evaluated in the vertex stage | bodies, sails, fins, shells, the sea |
| (u, v, w) -> point | `Chart` | its boundary as a surface; things placed inside it | the space around a body; the sea; a whirlpool |
| point -> distance | `Field` | a tracer inside a bound (`docs/folding_and_tracing.md`) | folded and recursive solids |
| point -> density | `Density` | integration along the view ray | cloud, fog |
| coordinates -> colour | `Paint` | the fragment stage | bands, scales, markers on the water |

All of them are TypeScript closures over `Expr`, so they are pure, may read `time` and inputs, and compile to both
backends. An object may be several at once (a body is a `Surface`, a `Chart` and a `Skeleton`).

### 7.2 Three operators

- **Compose in front (a domain map, a `Warp`).** `warp(shape, F)` evaluates the shape at `F(x)`. On a `Field` or a
  `Paint` this is folding: mirror, repeat, polar repeat, spiral, kaleidoscope. On a `Surface` or `Curve` it
  reparametrises (for example concentrating samples toward a tip). On `Points` it maps the index (a generator for
  instances). A `Warp` returns `{ x, id, stretch }`: the mapped coordinate, the cell it came from, and the local
  change of length, so distances stay distances.
- **Compose behind (a range map, a `Chart`).** `place(shape, chart)` puts a shape in a coordinate system: on the sea,
  in a whirlpool, on a body, through a bend or twist. Placement acts on skeletons by default (the lesson of the
  scene-graph proof: mapping every skin vertex through a growing twist shears bodies into slivers).
- **Multiply (a product of domains).** `sweep(curve, section)` is a surface (and a chart); `sheet(curveA, curveB)`,
  `loft(curves)`, `lathe(profile)`, `extrude`, `thicken(surface, height)` likewise; `points x shape` is instancing;
  `shape x time-interval` is a trail or a smear.

A strand is therefore not a primitive. It is `sweep(spine, section)` with frames transported along the spine.

### 7.3 A table is a function too

`tabulate(f, n)` samples a function and returns a function that interpolates the samples. The two are
interchangeable, and where the table is filled decides the schedule:

| Filled | Is today called |
|---|---|
| once, when the scene is built | a keyed curve, a baked mesh, a texture, a sculpt layer, a distance-field brick |
| once per frame by the pose stages (a map or a scan) | the stations of a body (frames cannot be computed locally: they are transported along the spine, a scan) |
| never (the function is evaluated where it is used) | everything analytic |

So "bake or analytic" is one line of code per function, and a hand-edited table (a sculpt layer, a painted map) is the
same object as a computed one. The three-variable table is a field's distance brick (`src/map/brick.ts`, 7.7): a
function of a point sampled once into a static table, whose lookup is a guaranteed lower bound of the function rather
than an interpolation (a tracer steps by it). In the expression layer this needs one new leaf, `fetch(table, index, lane)`, for
per-frame tables; interpolation is ordinary expressions on top. With it a body's chart is an expression like any
other: no hand-written chart shader, and differentiation, folding and CPU evaluation all pass through it.

### 7.4 Drawing

One generic drawable per signature, each assembled from expressions:

```ts
draw.surface(name, surface, { paint, grid, sides, outline })  // grid in the vertex stage; normals from the map itself
draw.curve(name, curve, { width, paint, segments })          // stroke
draw.points(name, points, thing)                             // instances of any instanceable drawable
draw.posed(name, poses, thing)                               // instances turned and scaled along each axis (below)
draw.field(name, field, { bounds, paint, steps, lipschitz })  // sphere-traced (specified, not built)
draw.relief(name, surface, { height, hMax, fold, paint, steps }) // shell-traced on a surface (specified)
draw.density(name, density, { bounds, colour, steps })       // integrated (specified)
```

`strand`, `crest`, `fan`, `shell`, `sea`, `scatter`, `attach`, `decal`, `cloud`, `glow` become short library functions
that build maps and hand them to these. A baked mesh is `tabulate` of a `Surface` on a grid, so baking any surface is
generic.

**Posed copies** (2026-11-11). `posed(count, (i) => ({ at, turn, size }))` is `points` with a turn (`turn.none`,
`turn.about(axis, angle)`, `turn.axes(x, y)`) and a size (`size.even(k)`, `size.axes([a, b, c])`); every field is an
expression of the index and may read time, evaluated where the copy is drawn. `posedList(name, specs)` lists poses that
share nothing (a fleet's spars) and fills them once per frame on the CPU into one table. `Points` are poses with an even
size, drawn exactly as before (`framedPose` dispatches on the size: even is `framed`). Under a per-axis size the normal
turns by the cofactor of the scale (what d/du x d/dv turns by), so a stretched copy is lit as its shape
(`tests/map.posed.test.ts`); its shadow joints scale per axis with the largest axis as radius, its level of detail
by the largest axis. Paint takes a third argument, `PaintAt { world, normal, copy }`: the world point and normal (after
the copy's turn and scale) and the copy's index (0 for a surface drawn once), so copies can differ and face the light.

**Lathe** faces out whichever way the profile runs: one running bottom to top turns clockwise round y instead (decided
by the sign of the integral of r dh at rest; u keeps its meaning, a pattern in v is mirrored); a profile enclosing no
area with the axis is refused by name. Before, a rising profile was drawn inside out.

### 7.5 What changed in the code (as built)

| Layer | Now |
|---|---|
| `src/expr.ts` | `fetch(table, index, lane)` (a leaf over a `TableSource`), `iterate(count, init, step)` (a real loop in both backends; `count` may be an expression); `leaves` reports tables; `substitute` rebuilds loops; `eq`, `ne` (exact; both backends agree on whole numbers, `tests/expr.eq.gpu.test.ts`) and `pick(i, values)` (2026-11-11) |
| `src/map/` | the signatures (`types.ts`), `warp` and `tile`, `place`/`on`/`compose`/`points`, the products (`sweep`, `sheet`, `lathe`, `loft`, `extrude`, `thicken`, `surface`), `tabulate`, frame transport |
| `src/draw/` | `draw.surface`, `draw.glazed`, `draw.curve`, `draw.points` (implemented); `draw.field`, `draw.relief`, `draw.density` (specified: options types, throw `NotImplementedError`); the sky and shadows |
| `src/geom/` | `strand`, `crest`, `sea` as library functions; `scatter`, `attach`, the chart WGSL and its CPU twin, the station reader in WGSL and its JS mirror, and every per-kind shader template are gone |
| `src/compile/` | slots, the table registry and packing, shared WGSL, the pose function; no kind of thing appears in it |
| `src/bake/` | bakes every `Drawable.surfaces` entry by sampling its expressions; colours converted to linear |
| contract, host, CLI, viewer | unchanged |

### 7.6 Where the first version of this section was wrong or awkward

- **One `warp` cannot dispatch.** Paint and fields are plain functions, so `warp(shape, F)` cannot tell them apart at
  run time. It is a namespace, one function per signature: `warp.paint`, `warp.field`, `warp.surface`, `warp.curve`,
  `warp.points`. A motif that needs the cell's identity uses `tile(F, motif)`, which hands it the whole fold result.
  The fold values are `src/lib/fold.ts`'s, whose result also carries `toWorld(d)` (inversion needs more than a stretch),
  so `warp.field` goes through that, not through `stretch`.
- **A slice is not a substitution.** Substituting `time` cannot move a per-frame table to another time, so a chart has
  `at(t)`, and a body taken at another time (`body.at(t)`) posts its own table, placed on its host's slice at t.
- **Placement acts on the local spine, and stretch is measured there.** The rest pose is the spine at time 0; a placed
  spine reads its host's table, which holds only the current frame, so stretch (and volume preservation) is measured on
  the unplaced spine. Exact for rigid placement (`on`); a bending chart would need its own rest table.
- **`paint` is three looks.** A lit surface takes `paint(u, v)` and the style; the sea needs its own colour and alpha,
  scene depth and the camera (`draw.glazed`, whose colour sees a `Fragment`: world point, pixel, (u, v), style, sun); a
  stroke is unlit (`draw.curve`). And "outline" is two things: an inverted hull for closed one-sided surfaces, ink along
  the v = 1 edge for two-sided sheets (which have no back faces to draw a hull with).
- **A surface needs more than a point.** It carries its `normal` (finite differences of the map by default; a sweep's is
  analytic, which is better near closing tips than any difference), its `topology` (periodic edges, poles, caps: what
  the baker needs to close a solid) and its `skeleton` (an empty chain for none).
- **A table needs a compile-time hook.** Fills evaluate CPU expressions (a body's spine, a host's chart), and only the
  compiler knows the slots, so a table is prepared once (`prepare(p)`, with `p.compile(roots)`). Each table compiles its
  own CPU function; the pose pass lost the sharing of subexpressions across bodies it had as one program (best-case pose
  0.31 -> 0.42 ms for the serpent).
- **Library functions that read scene depth cannot be shared.** `sceneWgsl` goes into every module, and scene depth is
  bound only for some draws, so each shader module carries its own library functions unless `sceneWgsl` already has them.
- **A sheet is ruled.** `sheet(root, edge)` interpolates linearly from root to edge, so the crest's sideways flutter is
  now a straight lean of the membrane, where it used to curve as f^2. Not visible in the pictures.
- **"Baking any surface" means any surface the CPU can evaluate.** The sea follows the camera and a stroke faces it;
  they bake to nothing and are reported as skipped. Static `tabulate` is evaluated at compile time with every input and
  param at its default.
- **Drawables are named.** A drawn shape needs a name (it keys its shader and its tables), so every `draw.*` takes one
  first; a sweep's name also names its table.
- **Params are global by name.** Two scenes declaring one param with different defaults cannot be loaded in one process
  (the shell demo and the serpent did, through `toon.outline`). Unchanged here; worth a scene-scoped registry.

### 7.7 Tracers: `draw.field` and `impostors` (as built)

Two per-pixel tracers (docs/folding_and_tracing.md 3.1 and 3.2), each one module in `src/draw/` sharing `trace.ts`.
Examples: `examples/coral.ts`, `examples/nest.ts` (fields), `examples/pearls.ts` (impostors).

```ts
draw.field(name, field, { bounds, paint, steps, outline, schedule, safety? })   // field: (p) => distance
// schedule: "trace" | "brick" | "mesh" | "auto"
impostors(name, { cell, shape, bounds, paint, cells, outline })      // shape: (cell) => sphere | capsule | cone
bound.box(min, max) | bound.sphere(c, r) | bound.capsule(a, b, r)    // TraceBound, a field's bound
fieldPixel                                                           // world size of a pixel: a field's level of detail
grow({ count, motif, step }), kifs({ count, fold, scale, offset })   // src/lib/grow.ts: folds as real loops
```

- **Proxy and ray.** The bound's oriented box is drawn as 36 vertices with front faces culled (a back face is visible
  whenever any of the bound is, the camera inside it included). The fragment stage builds the pixel's ray (one formula
  for perspective and orthographic: the proxy point moved back along `view_dir` to the plane through the eye) and its
  span in the bound's own shape, in closed form per kind.
- **Field march.** Steps by the distance (times `safety`, default 1); a hit is a distance under 0.3 pixels at that
  range, the pixel size being affine along the ray. Out of steps inside the bound counts as a hit. Two secant steps
  refine a hit (2e-4 of the analytic intersection in the tests; plain steps left 7e-3 at oblique hits). Normal: the
  field's gradient by differences on a tetrahedron a quarter of a pixel across (four evaluations; it was the symbolic
  gradient, which differentiates through a fold's loop: on the coral it cost about as much as the march, and its
  registers slowed the rest of the shader). A ray that covers nothing skips the normal and the paint (most of a
  bound's pixels). `paint({ p, normal })`; per-copy identity comes from evaluating the fold again at `p` (pure
  functions, so this is the same expression).
- **Schedules** (2026-11-11, `schedule`). `trace`: the formula at every step. `brick`: the field (at full detail,
  scaled by its step scale) is sampled once into a distance brick, and the march steps by the brick, evaluating the
  formula only within the band where hits, near misses and coverage are decided (`march_band`: the ink or hit width
  plus a pixel, times 1.2); the formula also gives the refinement and the normal, so the surface is as crisp as
  traced. `mesh`: a closed triangle mesh extracted from the brick's samples (surface nets, `src/map/nets.ts`), normals
  from the field's gradient, paint per pixel at the interpolated point, ink as an inverted hull of the traced ink
  width; bakeable to glTF (`Bakeable` is a surface or a mesh). `auto`: a field whose leaves read time, an input, a
  param, a curve row or a per-frame table (`varianceOf`), or a GPU-only function, is traced; a static one whose
  formula is cheap (`evaluationCost` below `BRICK_WORTH` = 1000 nodes: the nest is 215, the coral 2612) is traced
  too, because a brick lookup (scattered loads) costs more than its formula; a static expensive one that reads
  `fieldPixel` is bricked (its shape follows the pixel at every distance, which no one mesh shows); any other is
  bricked and meshed, the mesh drawn instead whenever a brick cell is under 1.5 pixels at the bound's nearest point
  (each draw's vertex stage hides it otherwise). `brick` or `mesh` asked of a changing field is `FieldScheduleError`,
  naming what it reads.
- **The brick** (`src/map/brick.ts`). The bound's box in coarse cells of 8^3 fine cells, the fine cell the bound's
  diagonal / 256. A coarse cell with no point within one fine cell (the band) of the surface stores one lower bound
  (proved from a sample at its centre); every other one owns a brick of 9^3 samples. The lookup is the best of the
  eight corner cones of p's fine cell, max_c (d_c - |p - c|): a lower bound of a 1-Lipschitz field outside the solid
  (trilinear interpolation is not: across a thin branch it exceeds the distance by up to half a cell diagonal), within
  a cell diagonal of it where |d| is below the band. Baking refines a cube only where the sample at its centre cannot
  prove it far from the surface, so exact samples are those of fine cells near the surface (coral: 339k evaluations,
  1.0 to 1.5 s, 4.0 MB; nest 1.19M, 2.1 to 2.7 s, 10.3 MB). The march's free-space steps are one call (a run of
  over-relaxed brick steps with fall-back), so a SIMD group does not evaluate the field once per brick step for the one
  ray that needs it. Each coarse cell also stores which members of a union at the field's root (`min(a, b, ...)`) can
  be nearest anywhere in it at any level of detail (Lipschitz again, at full detail against the coarsest; this assumes,
  as the level of detail does, that a coarser level only removes parts); the others are not evaluated (coral: three
  trees, mostly one per cell). A drawable bakes once per process (memoised on the drawable).
- **Level of detail.** `fieldPixel` is the pixel size at the point evaluated, per step, so an `iterate` count built
  from it falls with distance (coral: stop when a branch is under half a pixel). Per step, not per ray: per ray it
  was the pixel size at the bound entry, which is zero with the camera inside the bound.
- **Impostor walk.** A 3D DDA over the lattice cells (cells centred on multiples of `cell`, those with centres in
  `bounds`), each cell's shape intersected in closed form (Quilez's sphere, capsule and rounded-cone intersectors);
  the walk stops once the best hit is nearer than the current cell's exit. A cell's shape is an expression of
  `{ id, centre, hash }` and must stay inside its cell; radius 0 is an absent copy. `paint({ p, normal, local, cell })`.
- **In the scene.** Both write `frag_depth` (clip z / w of the hit), so they cut triangle bodies exactly and the sea's
  contact foam appears where they meet the water with no code of their own (seen in coral, nest and pearls). Lit by
  the style's `shade` with the underwater depth like any body. Opaque phase, not bakeable. A field casts a soft blob
  (2026-11-11, `src/draw/field_shadow.ts`): its field sampled once on a 22^3 grid in its bound at time 0, the inside
  points above the still water fitted with a short capsule chain (principal horizontal axis, extent, spread, mean
  height); a field the CPU cannot evaluate casts from its bound. It does not follow a field that moves. Impostors cast
  nothing yet.
- **Edges.** A traced edge is inside its proxy, so MSAA does not see it. Coverage is written as
  `@builtin(sample_mask)` (round(4c) of 4 samples, bits turned per pixel), from how close a missed ray came in pixels,
  estimated between two samples as where their spheres of free space meet (the sampled distances alone gave grain).
  `outline: "silhouette"`: a ray passing within the ink width while receding is ink, including inner silhouettes.
  Ink width is the style's, at least 1.5 and at most 4 px (uncapped, a branch at the lens wore a 50 px band).
- **Safety check.** When the scene compiles, an unchecked field (`safety` absent) is sampled with `lipschitz` (20000
  pairs, in its bound plus 2%, at full and coarsest detail); above 1.01 it throws `FieldSafetyError` naming the field,
  the measured value and a suggested `safety`. A GPU-only function in the field is a `FieldSafetyError` too (cannot be
  checked; pass `safety`). It caught two real defects while building the examples: a polar repeat of coral trees whose
  crowns cross sector walls (98), and nested shells seen through windows with only one neighbour shell evaluated (12.9).

Corrections to the specification:

- **Derivatives after a march.** The style's shading calls `fwidth` after a loop whose exit differs per pixel, which
  WGSL's uniformity analysis rejects; the fragment entry points carry `@diagnostic(off, derivative_uniformity)`. Every
  invocation still runs there (a miss is discarded at the end, which demotes it to a helper), so the values are defined.
- **A fold that must see its neighbours costs them.** Repeats and polar repeats are exact only when the motif stays in
  its cell. A reef of three trees is three tree evaluations, not one polar fold, and the nest evaluates five shells per
  query. The check is what tells you.
- **Params are global by name** (7.6) bites examples: all three tracer examples use the default `toon.outline` so they
  load in one test process.

Cost, before the schedules (2026-11-10), best case at 1280x800 on this (heavily loaded) machine, tracer only (frame
minus the same frame without the traced draw): coral about 11 to 14 ms at its overview cameras, 36 ms in the close-up
that fills the screen, about 4 ms at twice the camera distance and 23 ms at 0.6 times; nest about 1 to 7 ms (noisy);
pearls about 3 to 6 ms. The step cap (32 to 192 for coral, 16 to 96 cells for pearls) changes almost nothing: rays end
by hitting, by the pixel threshold or by leaving the bound well before the cap. Cost follows screen coverage times the
field's cost per evaluation (coral is 3 trees x up to 10 levels per step).

Cost after (2026-11-11), `bun tools/tracer_bench.ts <tag> 40 <scene> base,trace,brick,mesh,own <old checkout>`: the GPU's
own time (timestamp queries) for a pass holding only the traced draws, best of 40, every row and camera interleaved
in the same rounds (wall-clock differences moved by milliseconds with the load). `base` is the starting commit; `own`
is the example's `auto`.

| coral, ms | three | front | side | top | close | far (2x) |
|---|---|---|---|---|---|---|
| before | 12.6 | 16.0 | 16.4 | 14.5 | 38.8 | 3.7 |
| trace | 8.3 | 10.6 | 10.8 | 10.3 | 35.0 | 2.6 |
| brick (= auto) | 4.5 to 4.9 | 5.7 | 6.1 to 6.2 | 6.7 | 22.6 to 25.2 | 1.8 to 1.9 |
| mesh (not chosen: blobs) | 1.4 | 1.4 | 1.4 | 1.3 | 1.7 | 1.0 |

Nest (auto: traced) 1.4 / 1.6 / 1.2 / 1.6 / 3.3 / 0.4, unchanged; bricked it is twice as slow (3.0 / 6.2 / 0.8) and
meshed 1.6 to 1.8 (532k triangles). Pearls unchanged (1.0 to 1.7). What gave what on the coral overview (12.6 -> 4.5):
the normal by differences and no shading for misses about 4 ms (the trace row), the brick's free-space skipping about
2 ms, union culling about 1.3 ms. Not reached: 2 ms. What remains is evaluations of the formula the band needs (per
SIMD group of 32 pixels at most 2.6 of them, against 9.4 traced, counted on the GPU) at about 0.8 ms each over the
bound's pixels, plus the paint (all three trees, the author's) and the refinement and normal on hits; a brick lookup
costs about a tenth of an evaluation, and finer bricks (384, 512 cells) did not help. A mesh fine enough to keep the
coral's twigs (they are a few pixels wide at every distance) would need far more than 512 cells per diagonal (at 512:
406k triangles, 3 ms, tips still knobs). Pictures before and after differ in under 1.1% of pixels by more than 8 of 255
(2.2% from straight above), only along edges (the normal and the derivatives at silhouettes); pearls byte-identical.
`out/tracer/final/` (not in git) holds them.
### 7.8 Unfold: a fold listed (`src/lib/similar.ts`, `draw.copies`; as built, 2026-11-11)

A fold made of shifts, turns, mirrors and uniform scales has two readings, derived from one chain of generators
(`gen.shift`, `gen.turn`, `gen.mirror`, `gen.shrink`):

```ts
ask(chain)(p)        // a point to its folded point, id and stretch: compose in front of a field
list(chain, frame)   // a frame to the frames of its copies, with the ids `ask` reports in them
tree({ part, step }) // branching recursion: .at(p, count) asked, .branches(levels, root) listed
```

`draw.copies(name, { kind, copies, paint, outline, minPixels, keepLevels, inkBack })` draws a list: one instance per
copy, its oriented box with front faces culled, and one exact ray intersection per covered pixel (the closed forms of
`impostors`). Depth is written per copy, so the nearest hit over the copies is the hit of their union. `paint` is given
the copy's level and id, so it does not evaluate the field again. A copy under `minPixels` across is not drawn. The
copies cast one blob shadow, fitted as a traced field's is (`fitBlob`), in the `carry` frame's coordinates and carried by
it every frame.

The two readings are the same solid where every copy stays on its own side of its mirrors
(`tests/similar.test.ts`: to 1e-4, branch for branch). A copy that crosses a mirror is cut when asked and whole when
listed.

Ink differs from the march's. A march inks an inner silhouette only when a sample happens to fall just before the
closest approach, so its crowns carry little ink inside. A list knows every near miss. It writes a thin band at the
near miss and the rest of the width `inkBack` ink widths further back, so the full outline shows against the far
background and gives way to a neighbour close behind.

Measured on the coral (three trees, 3,069 branches), GPU time of the draw alone at 1280x800, best of 40, same rounds
(`bun tools/tracer_bench.ts <tag> 40 coral,coral_list own`):

| ms | three | front | side | top | close | far |
|---|---:|---:|---:|---:|---:|---:|
| `examples/coral.ts`, marched through its brick | 4.92 | 5.96 | 6.09 | 6.82 | 25.89 | 1.90 |
| `examples/coral_list.ts`, listed | 1.38 | 1.51 | 1.51 | 1.31 | 3.08 | 0.72 |

Compile is 31 ms against 7.2 s (there is no bake), and static tables are 0.14 MB against 4.04 MB. The pictures differ
in 1.5% to 9.5% of pixels by more than 8/255, depending on the camera: the ink described above, the shadow blob's fit,
and branches the fold cuts.

Not done: `draw.field` does not choose this schedule by itself; an author writes the list. A level-dependent step, a
part that is not a sphere, capsule or rounded cone, and blends between copies (docs/tracing_sota.md 5.5) are not
covered.

## 8. Relief: form finer than the curves (as built, 2026-11-11)

Curves give gesture and mass; relief is the layer above, written in a surface's own coordinates (u, v) so it rides
the body through any animation. Code: `src/relief/` (heights, sculpt layers, displacement, the tracer) and
`src/draw/relief.ts` (the drawable). Examples: `examples/serpent_relief.ts`, `examples/shell_relief.ts`.

### 8.1 API

```ts
type Height = (u: F, v: F) => F;                      // world units above the surface
type Patch = { size: [lu, lv]; wrap: "none" | "u" | "v" | "uv" };   // world size of the (u, v) square, closed directions
bump(patch, { at, radius, height, profile })          // profile: smooth | dome | cone | spike | crater | plateau
ridge(patch, path, { width, height, profile }); crease(patch, path, { width, depth, sharpness })   // path: (u, v) polyline
flatten(patch, h, region, level); inflate(patch, h, region, amount)   // region: { kind: "disc" | "band", ..., falloff }
sum(...hs); smoothMax(k, ...hs); clampHeight(h, lo, hi); scaled(h, by); level(c)
sculptLayer(name, samples, [nu, nv], { wrap })        // a Height backed by a static table; sampleGrid(fn, [nu, nv], { wrap })
displace(surface, height): Surface                    // vertex-stage displacement; normal of the displaced map
draw.relief(name, surface, { height: (site) => F, hMax, fold, paint: (point) => rgb, steps, grid, outline: "ink" | "none" })
// site = { u, v, cell: fold(vec2(u, v)) }; point = site + { h }
```

- Stamps measure distances in the patch, so they are round in world units where the patch's size is right (a body's
  girth varies, so a stamp is stretched where the girth differs from `size[1]`). Differences in a closed direction go
  to the nearest copy, so stamps straddle the seam of a body.
- `sculptLayer`: samples at k / n in a closed direction (wrapping), k / (n - 1) in an open one (clamped). Lookup is
  bicubic Hermite with Catmull-Rom slopes stored per sample (one vec4: value, d/di, d/dj, d2/didj), so it interpolates
  the samples, is C1 (no facets in relief normals) and costs four fetches. This is the table a sculpting tool's
  displacement bake fills.
- `displace` differentiates `point + height normal` symbolically (`jacobian` from src/grad.ts), which needs the
  derivative of the base normal: exact for a sweep's analytic normal.
- `draw.relief` takes the fold as an option so height and paint see the same cell: paint by cell identity is
  `site.cell.id`. Its bakeable is `displace(surface, height)` with the paint at the relief's height.

### 8.2 How the tracer works

The vertex stage draws the surface at the top of a shell (`1.02 hMax` plus the ink width) and passes the shell frame
(point S, tangents Su, Sv, normal N and its derivatives Nu, Nv, all from `shellFrame`, by symbolic differentiation of
the surface's own expressions) to the fragment stage as varyings. In the fragment stage the view ray is expressed in
(u, v, height) by a second-order local model (src/relief/trace.ts header): J = [Su Sv N] inverted, height corrected by
the second fundamental form, (u, v) by the shape operator times the height. Along the ray the height is a quadratic in
t, so the span inside the shell (to just below the base, or back out of the top: a silhouette) is closed form. The
march samples f(t) = h(t) - H(u(t), v(t)) evenly over that span, brackets the first sign change and refines it with 5
steps of safeguarded regula falsi. The normal is (Su + Hu N + H Nu) x (Sv + Hv N + H Nv) with the height's gradient
taken symbolically. Fragment depth is written at the hit, so relief meets the sea (foam) and other bodies correctly.

- **Misses are discarded**; a miss that came within the ink width of the relief is drawn as ink at its closest
  approach. The strand's inverted hull would outline the shell, not the relief.
- **Level of detail**: hpix = hMax / (pixel size at the fragment). Samples = clamp(ceil(0.6 hpix / max(|cos|, 0.15)),
  6, steps). Below one pixel (hpix < 1) there is no march: the ray meets the surface lifted to the height at the pixel
  (one height evaluation, so the waterline stays right), shaded with the surface's normal. The relief's normal is
  blended in over hpix 1 to 4. The march and the plain path are written as expressions, so the CPU tests run the code
  the shaders run.
- **Two guards on the model**, both found in pictures: the shell is never thicker than 0.35 of the local radius of
  curvature (|dN| / |dS|) (stray slivers at the spiral shell's thin apex), and a march slides at most 0.75 of the
  radius of curvature in the ray's direction.

### 8.3 Measured accuracy (tests/relief.trace.test.ts, CPU f64)

- Displaced sphere, point and normal against the closed form: below 1e-4 (in practice ~1e-12).
- Flat patch, ramp: every ray within 1e-5 at 0, 45 and 75 degrees from the normal (16 samples).
- Flat patch, hemisphere bump (radius 0.1, unbounded slope at the rim): perpendicular rays within 1e-5 and normals
  within 1 - cos < 1e-6; at 75 degrees with 32 samples, 99.5% of rays within 1e-4, the rest only where the true hit is
  within 6 degrees of tangent (a linear search can step over a sliver that thin).
- **Curvature limit.** On a sphere of radius R against the exactly displaced sphere the error is C hMax (hMax / R)^2:
  second order, halving twice per doubling of R. C is 0.7-1.3 at 60 degrees from the normal and 4-5.3 at 75;
  perpendicular rays are exact. Hit or miss agree with the displaced sphere for R >= 10 hMax at 60 degrees and
  R >= 40 hMax at 75. In practice: keep R >= 10 hMax; below about 5 hMax (with the ink pad counted in the shell)
  grazing silhouettes crack. The serpent's flank, where its superellipse section (squareness 2.3) turns under, has a
  local radius of about 0.3: at hMax 0.1 it cracked visibly, at 0.06 a thin crack remains at the most grazing views.

### 8.4 Cost (best case of 40-60 frames, 1280 x 800, M-series GPU under load average ~14)

| Scene, camera | plain | relief |
|---|---|---|
| serpent, `three` (about 23 units) | 4.7 ms | 8.2 ms |
| serpent, 0.4 x that distance | 4.0 ms | 8.8 ms |
| serpent at about 80 units (relief switches off: hpix < 1 for hMax 0.06 at fovY 0.6) | 5.1 ms | 6.2 ms |
| serpent at about 160 units | 4.1 ms | 4.4 ms |
| shell, `three` | 3.8 ms | 5.3 ms |

What remains at the switch-off distance is the heavier vertex stage (the symbolic shell frame on a 200 x 40 grid,
against 160 x 28 for the strand) and the loss of early depth rejection that writing fragment depth costs.

### 8.5 Not done or not known

- Traced silhouettes and ink are not multisampled (one fragment per pixel decides), so they stair-step at one pixel.
- The march has no early exit (`iterate` runs its count); a distance-guided march where a motif's distance is known
  is not built.
- No CPU-against-GPU agreement test for the march itself (the expressions it is made of are covered by expr tests).
- Relief is one-sided (back faces culled): an open surface needs its inside drawn separately (the shell does).
## 9. Space-time: attacks, telegraph, smear, wake, checks (as built)

The game's simulation owns gameplay: per attack it supplies a hit shape on the water, an arming time and a warning
duration. Loft takes those as host inputs, defines the attack once, and derives the pose, the marker, the smear, the
wake and the checks from it by evaluating bodies at other times (`body.at(t)`); nothing is stored between frames.
Code: `src/spacetime/` (`hit.ts`, `attack.ts`, `telegraph.ts`, `smear.ts`, `wake.ts`), `src/check.ts`,
`src/cli/check.ts`; example `examples/strike.ts`; tools `tools/strike_targets.ts`, `tools/strike_bench.ts`.

```ts
const bite = attack({
  name: "bite", arm: input("bite.arm", "f32", [2.4]), warn: input("bite.warn", "f32", [1.6]),
  target: { kind: "body", body: ship.hull }, part: "head",
  motion: { kind: "lunge", hit: hit.capsule({ a, b, radius }), reach: 0.3, lead: 1.95, height: 0.8, coil: 1.6, rise: 1.1, approach: 0.3, neck: 1.6 },
});
const lash = attack({ ..., part: "tail", motion: { kind: "sweep", hit: hit.arc({ centre, inner, outer, from, to }), root: 0.72, height: 0.25, inset: 0.45 } });
const serpent = animate(restSpine, [bite, lash], (spine) => ({ things, parts: { head: part("head", head, { tip: 1 }), tail: part("tail", body, { from: 0.8, to: 1, tip: 1 }) } }));
things: [...serpent.things, telegraph(bite), smear(serpent.strikes.bite, { over: 0.12, samples: 4 }), wake(body, { over: 1.6 })]
export const checks = [landsInside(serpent.strikes.bite), stopsAt(serpent.strikes.bite, target), staysClear(part, target, { until: bite.arm }), minScreenSize(eye, "three", 4), budget({ triangles })];
```

- **Remote attacks and arming** (2026-11-11). `Motion` has a fourth kind, `{ kind: "remote", hit }`: a hit shape and
  timing with no body part (a broadside, a bolt, a beam); `attack()` returns an `Attack` for it and a `BodyAttack`
  (with `part`, `pose`, `landing`) for a lunge, sweep or rear, and `animate` takes only those. `arm` is a time or an
  `Arming`: `once(t)` or `every(period, first)`. `attack.armAt(t)` is the arming time of the cycle clock t is in (a
  cycle runs from its warning or wind-up, whichever is earlier, to the next one's), `attack.arm` is that now,
  `attack.cycle(t)` its number (a bolt's seed), `attack.first` the first arming. A repeating attack must fit its period
  (lead plus recovery; a remote one has no motion span). Checks measure at the first arming: `landsInside` and `stopsAt`
  read `first`, and `staysClear({ until })`, `minScreenSize({ at })` take an `Arming` as a time (`CheckTime`). Before,
  `floor(time / LOOP) * LOOP + at` evaluated at time 0 was a cycle that had passed or not begun.
- **Hit shapes** (`Hit = Capsule | Disc | Arc`, every field an expression). One handler per kind for each question:
  `hitSdf` (signed distance in the xz plane: the one expression the telegraph draws and the checks evaluate),
  `hitPatch` (the patch it is drawn on: an oriented rectangle, a square, a polar sector), `hitContour` (distance, position
  along the nearest edge in whole teeth per edge piece, tooth pitch). An arc is an annular sector at most a half turn.
- **Motion** (`Attack.pose(rest)`): `spine(m) = mix(rest(m), pose(m, q), w(m) p)` at a retarded clock per m. `p` is the
  posture envelope (coils in over `windup` before the strike, lets go after `hold` by a critically damped `response`);
  `q` is an underdamped `response` divided by its own first peak, so it is exactly 1 at the arming time and never above
  1: the striking end lands where the hit shape says and never passes it (recoil after landing comes free). The lunge
  places spine m = 0 on the lane (capsule: the tip half a radius short of `b`; disc: the centre, approached from where
  the end rests now), `lead` behind the striking tip, the neck a Bezier back to `rest(reach)`; the wind-up pulls back
  and up from the rest pose. Its motion runs down the body after the head (clock `t - m / travel`). The sweep swings the
  spine from `root` to m = 1 round the arc's centre, from `from` to `to`, each point `inset` inside the edges; its
  motion runs toward the tip like a whip (clock `t + (1 - m) / travel`). Exactness at T holds only at the striking end;
  the rest of the body is at its own clock.
- **Parts and strikes**: `animate(rest, attacks, build)` composes the attacks' spines (each moves its own stretch) and
  binds each attack to the part it names (`Part`: a strand and an m range with a tip); a missing part throws.
- **Telegraph** (`telegraph(attack, { style })`): a glazed patch of the sea surface over the shape (28 x 10 cells, phase
  `on-water`), coloured per pixel from the distance: orange-red fill, a bone edge with inward teeth, an ink line round
  the bone, antialiased by `fwidth` of the distance. Over the warning the teeth grow (in multiples of their spacing, at
  most 0.8 of the inradius), the fill strengthens and throbs faster; from the arming time it flashes the whole shape for
  `<attack>.flashSeconds` (an input, default 1/30: one frame at the host's rate, which only the host knows), then fades.
- **Smear** (`smear(strike, { over, samples, speed, opacity })`): copies of the part's stretch of its body at
  `time - k dt`, each a glazed surface lit by the scene's style with the part's own paint, back faces dropped, opacity
  falling with age and following the tip's speed between the copy and the next younger one (shown only while fast).
- **Wake** (`wake(body, { over, samples, spread })`): a raw-WGSL drawable in the manner of the shadows. The pose pass
  evaluates the skeleton of each past slice and the sea's height at that slice's time; a joint's waterline is a disc of
  radius `sqrt(r^2 - h^2)`, consecutive joints a tapered capsule widened with age, each drawn as its own small sea patch.
  A capsule draws only where no younger slice's capsule covers the pixel and where it is the deepest of its chain
  neighbours, so each pixel is foamed once, by the youngest slice that left it. Row 0 (now) is read but never drawn.
- **Checks** (`src/check.ts`): values with a name and a `run(probe)`. `Probe` holds a `compileScene` result and input
  overrides and evaluates expressions on the CPU at any time (each time is a pose of the tables it reads). Skeleton
  capsules are what is measured (radius = the larger half-axis, so distances are conservative). `landsInside` samples
  the part's footprint (its capsules from above) at the arming time and reports the share where `hitSdf > 0`;
  `staysClear` is the least capsule-to-target distance at 60 Hz over a range (target: a vertical disc or a body's
  skeleton); `stopsAt` asks for contact at arming and no penetration over the attack's span; `minScreenSize` projects the
  feature's joint spheres through a named camera and takes the narrower side of their bounds; `budget` reads
  `stats.maxTriangles` (the declared maximum, so it holds for every view). `loft check <scene.ts>` runs the module's exported `checks` and exits 1 on any failure.

Where the plan met the code:

- **A coiled pose needs a control arm with a floor.** When the wound-up head stood right over the neck's root, the
  Bezier's control point collapsed onto the head, the stations bunched there, and the strike's first frame pulled the
  end back past its neighbours: the transported tangent flipped and the head swung round in one frame (head tip at
  218 units/s against 38 for the spine end). `neck` keeps the arm at least that long; found by differencing the
  pose at 60 Hz, not from the pictures.
- **`response` with `r < 0` starts with a velocity step** (its derivative at 0 is `r zeta w0`), which reads as a pop
  at the start of a strike. The default anticipation is 0; the coil supplies it.
- **The head's pitch is the neck's business.** A head hung forward of the neck at a pitch dove into the water when the
  neck met it horizontally; `approach` makes the neck climb into the head so it levels out, and `lead` (spine end to
  tip) is a number of the creature measured once, then verified by `landsInside` and `stopsAt`.
- **Past slices pose only what they are read for** (polish pass, 2026-11-11). A slice's cost is evaluating the posed
  spine at each station (about 2300 expression nodes per station in the example; frame transport is a quarter of it), so:
  a part placed on a body at a constant m (`on(body, c)`) takes its host's slice with `Body.atNear`, which posts only
  the stations up to that m (a head copy reads 5 of the body's 48); a smear copy is `Body.partAt(t, from)`, the stations
  from the part's start, its first frame seeded from the live body's (positions and radii exact, frames within the roll
  made since: 2.65 degrees at 0.35 s, older than any copy in the example); a wake sample is
  `Body.skeletonAt(t, stations)`, positions and radii at every third station and no frames (stretch measured between
  kept stations: radii within 15% at the neck, 3% elsewhere).
  Before: each copy and sample posed the whole body (1054 stations against 142). CPU pose, best of 3000 interleaved
  in one process: 0.47 -> 0.22 ms with smear and wake (0.11 without); `tools/strike_bench.ts` on the loaded machine:
  2.1-4.0 -> 1.5-2.2 ms (0.5-0.7 without). Tests: `tests/spacetime.slices.test.ts`.
- **A ship is its hull** (polish pass, 2026-11-11). `Target` has a third kind, `{ kind: "skin", skin, frame }`
  (`Ship.target(chart)`, with `Ship.afloatChart` the chart `afloat` uses): checks move the chain into the ship's frame
  and measure the hull's signed distance (`src/geom/skin_distance.ts`, a `skin` target: the skin sampled 64 x 65, closed across the rail
  and at both ends, nearest strips first with box pruning, inside by the parity of an upward ray; within 1e-3 of the
  closed-form skin, `tests/skin.distance.test.ts`), at points along each capsule half its smaller radius apart, skipping
  any whose distance to the hull's box cannot beat the best. `examples/strike.ts` now strikes two cutters built by
  `ship` (the fleet's sloop, smaller): contact at arming reads 0.044 (bite) and 0.093 (lash) with `contact: 0.1`, where
  the stand-in read 0.46 against a 0.6 allowance. A sample point inside a raked bow was called outside by the first
  sign test (point in the section nearest along the length); the parity ray replaced it.
- **Not done: volume preservation depends on how a pose spaces its stations** (2026-11-11). Where: `stationRadii`
  (`src/map/transport.ts`, the skeleton's radii) and `Body.ring` (`src/map/sweep.ts`, the skin) both scale radii by
  1 / sqrt(max(stretch, leastStretch)) with stretch = |d local / dm| / |d rest / dm| at each station (lane r.z,
  interpolated linearly). m is treated as the material coordinate, so a posed spine whose stations bunch (an ellipse
  laid out by angle, a Bezier whose control arm is short, a mix of two spines with different speeds) reads as
  compressed there and swells, up to 4.47 times: the Maelstrom Wyrm's reared coil became a ball three times its girth
  until `rear.ts` laid the loop out by arc length. Now bounded by name (`bulge` on a strand). The fix that removes the
  dependence: measure stretch over a window of rest arc length about a girth wide (the mean of |d local| / |d rest|
  over the stations within it), so bunching finer than the body's own thickness cannot swell it, while a real
  lengthening of the body (a neck drawn out by a lunge) still thins it. Not done here because it changes the radii of
  every posed body, including those of the reference pictures, and wants its own before/after.

## 10. Ships, afloat, and the whirlpool (as built)

Library functions on the map algebra; examples `examples/brig.ts`, `examples/fleet.ts`, `examples/maelstrom.ts`.

### 8.1 A hull from its lines (now the recipe `examples/recipes/hull.ts`)

`hull({ length, beam, depth, freeboard, sheer: [aft, fore], castle: [aft, fore], entry, run, widest, fullness, deadrise,
tumblehome, transom, rake, stations, bulwark })` returns a `Hull`: `skin`, `deck`, `bulwarks` (inner faces), `transom`
(Surfaces), `stations` (the section curves), the closed-form lines (`x(u)`, `half(u)`, `keel(u)`, `sheerAt(u)`,
`section(u, v)`), `skeleton()` and `paint(look)`. Ship coordinates: x toward the bow, y up, z to starboard, waterline
y = 0. The skin's u runs stern (0) to bow (1); v runs port deck edge (0), keel (1/2), starboard deck edge (1), so
d/du x d/dv points out. Each station is a section curve (a superellipse quarter of exponent `fullness` up to the turn of
the bilge, floor lifted by `deadrise`, then topsides drawn in by `tumblehome`, meeting at a common vertical tangent).
The skin is a uniform Catmull-Rom loft through the stations, so it passes through every station exactly. Fullness eases
toward both ends; the lower stern sections pinch to the post (a wineglass stern) by a *bounded* factor: as a power of the
breadth, neighbouring stations differed by orders of magnitude at the keel and the loft's overshoot folded the skin
there. Strakes, wale, gun ports, trim band and boot-top are paint in the skin's (u, v), from the same closed-form lines.

### 8.2 A ship (now the recipe `examples/recipes/ship.ts`; `src/geom/lines.ts`)

`ship(spec)` takes the hull's numbers plus `name, masts (1..3), mastHeight, mastRake, tiers (square sails per mast; 0 a
fore-and-aft rig), yard, spanker, jibs, bowsprit, billow, flutter, heel, ports, colours { hull, bottom, wale, trim, deck,
spar, cloth, rope, team }`. `ship.afloat(waters, { at, heading, wind })` returns its drawables; `ship.placed(chart, wind)`
puts it in any rigid chart. Masts, yards, bowsprit, boom and gaff are strands placed through the chart; hull surfaces,
sails and the pennant are surfaces framed by the chart's frame at the origin. The wind is given on the sea plane and read
in the ship's frame: yards brace to it (clamped, `abs` of the fore-aft component so a head wind does not flip them),
booms swing to leeward, and every sail bellies along `dot(wind, sail normal)` (negative is aback), with a flutter of two
crossing travelling waves that grows as the sail luffs. Team colour is the cloth's stripes and the pennant. All ropes of a
ship are one stroke (`lines(name, ropes, spec)`): end points filled per frame on the CPU into a table, three zero-width
vertices round each rope so the cells joining ropes have no area. `sloop`, `brig`, `galleon` in the examples differ only
in their specs.

### 8.3 Afloat (`src/geom/afloat.ts`)

`afloat(waters, { at, heading, length, beam, lift, wind: { direction, heel } })` is a rigid chart (`rigid(frame)`;
`at(t)` substitutes time in the frame). `Waters` is `{ carry(at) -> { xz, turn }, height(xz) }`: the sea (identity), or
a whirlpool's chart. The water is sampled at bow, stern, port and starboard; the origin sits at their mean, the bow axis
rises by (bow - stern) / length, the starboard axis by (starboard - port) / beam (made perpendicular to the bow), then
the hull heels to leeward by `heel` times the wind's component across it, breathing with a slow gust.

### 8.4 Sea deformations and the whirlpool (`src/geom/sea.ts`, `src/geom/whirlpool.ts`)

`sea({ swell, deform: [d, ...] })` takes `SeaDeform`s: `toLocal(xz, t)` (sea plane to the deformation's coordinates),
`dip(xz)`, `calm(xz)` (how much swell survives) and `look(xz, t, fp)` (foam, shade). Height is
`swell(toLocal(xz)) * calm - dip`; the gradient is now symbolic (`src/grad.ts`) through the maps; the water's crest,
foam and shading are evaluated in the deformation's coordinates.

`whirlpool({ at, radius, spin, depth, drift, throat, arms })`. With s = r / R and the radial clock
L = tan(pi (s - 1/2)), the flow is dL/dt = -c (c = pi drift / R) and d(angle)/dt = spin sigmoid(-L): inward at a constant
rate in L (ds/dt vanishes to second order at the rim, so the field is C1 across it), turning at `spin` at the centre and
not at all at the rim. Its characteristic coordinates xi = L + c t and eta = angle - (spin / c) softplus(-L) are the
whirlpool's coordinates (presented as a plane: radius R (1/2 + atan(xi) / pi), angle eta). Forward (`flow`) and inverse
(`toLocal`) are closed form; outside the radius both are exactly the identity (`select`), and inside the map reaches the
identity at the rim with every derivative. The map is the same steady spiral at all times moved inward by c t, so a
straight line given in whirlpool coordinates is a spiral at every time, and paint periodic in xi never winds tighter.
Drift must be positive (no characteristic coordinates otherwise). The funnel is depth (1 - s^2)^3 / (1 + (s/throat)^2);
the swell calms toward the throat (where, wound in, it aliased into a moire); foam arms are `fold2.spiral` of the point
exp(0.55 xi)(cos eta, sin eta), dashed by a hash of the fold cell, antialiased by the analytic rate of the band lane per
world unit, faded at rim and throat.

`pool.in(sea)` is a `PoolChart` (Chart and Waters): coordinates (x, y, z) with (x, z) whirlpool coordinates and y the
height above the water (so a body authored in world coordinates over a calm sea is placed by its own numbers); frame y
the water's normal, x the whirlpool's x turned with the water. `velocity(c)` is `derivative(frame(c).o, time)` (the
time derivative of the map, vertical motion included); `drift(xz)` the water's horizontal velocity at a sea-plane point
(the same derivative at `toLocal(xz)`), for a game's simulation.

### 8.5 Carrying a whole creature (`src/map/sweep.ts`, `src/draw/surface.ts`)

`Body.placedAs(chart, tableName)` is `placed` with its own table, so the unplaced body can still be read as the host of
its parts. `SurfaceDrawable.through(chart)` carries a drawable: copies' frames are carried (skeleton placement); a
single surface's points are mapped and its normals turned with the chart's frame, which is right for thin things riding a
placed body (fins) and wrong for solids. `examples/maelstrom.ts` coils the serpent this way: its body rebuilt from
`bodySpec` with more stations, its other strands `placedAs`, its crests, teeth and spikes `through`. Laid along a radius,
the whirlpool wound it to 2.8-3 times its length (6 times locally) and it read as a thin ribbon; it is now laid 30
degrees off the flow (a circle in whirlpool coordinates keeps its radius, so the tilt sets how tight the coil is), 1.4
times its length (2026-11-11). Its girth stays as authored: its crests, spikes and head ride the authored body's skin.

### 8.6 Corrections made on the way

- **Stretch is measured on the local spine.** 7.6 said so, but `StationTable` measured the *placed* spine against the
  local rest, so a body placed in a bending chart was thinned by 1 / sqrt(stretch) (a coiled serpent to 0.45 of its
  girth). `StrandSamples` now carries `local`; identical for unplaced and rigidly placed bodies.
- **Params are global by name** (7.6) bites here too: every ship example uses `toon({ outline: 0.04 })` so they load
  with the serpent.

Best-case frame times at 1280x800 on a heavily loaded machine (headless, including readback): brig 7.7 ms, fleet
12.9 ms, maelstrom 11.3 ms.
## 11. Soft things (`src/soft/`, as built)

Soft things are integrals and distances evaluated per pixel, not stacks of polygons. All of them are exported from
`loft` (`src/soft/index.ts`); `examples/storm.ts` uses every one.

### 8.1 Closed forms (`gauss.ts`)

A Gaussian density `d0 exp(-|K (p - c)|^2)` (K the inverse radii; 0 on an axis is unbounded) has, along a ray, a
quadratic exponent, so its optical depth over a segment is `exp(-qmin) / s * G(a, b)` with `G` an erf difference.
erfc is Numerical Recipes' `erfcc` (fractional error < 1.2e-7, so tails keep relative accuracy); when `s L < 0.05` the
closed form cancels and Simpson's rule on the exponent is used instead (this also covers a ray parallel to a layer).
WGSL and a JavaScript twin; both are tested against numerical integration to 1e-4 (`tests/soft.gauss.test.ts`).

### 8.2 Media and `draw.density` (`medium.ts`, `density.ts`, `cloud.ts`)

```ts
const m = medium("storm", { puffs: [...thunderhead({...}).puffs, layer({...})], banks: [bank({...})], flashes: [...] });
draw.density("cloud", m, { bounds, sun: [2.1, 1.95, 1.75], sky: 0.9, forward: 0.3, shadowing: 0.8, detail: { kind: "noise", amount: 1, scale: 2.5 }, haze: 0.004 })
```

- Kinds: `blob` (bounded Gaussian), `layer` (Gaussian in height: haze, ground fog), `bank` (a layer ending at a soft
  vertical wall: on each side of the plane the exponent is still one quadratic, written in 4D), `flash` (a point light
  whose power is an expression of time). Every number may follow time. `Medium.density(p)` is the same sum as an
  expression (the 7.1 `Density` signature).
- Per frame on the CPU (the one library table still `cpu` after phase 1 of docs/gpu_native.md): blobs are evaluated, sorted on a Morton curve and grouped 8 to a bounding
  sphere (`<name>_clusters`); the light pass computes each blob's optical depth through the *other* blobs toward the sun
  and the zenith, one radius behind and in front of its centre, and the flash light reaching it through the medium.
  O(N^2), culled by cluster spheres and closest approach.
- Per pixel: the bound's back faces are drawn at depth 0 (so the camera may be inside), the ray is clipped to the box,
  to `scene_position` (bodies inside a cloud are veiled by exactly what is in front of them and the cloud has a soft
  edge on them) and to the swell. Pass 1 (no erfc) finds the blobs' depth range and an opacity cut; pass 2 integrates
  each blob, lights it at the median first-scattering depth, and deposits it into 24 depth bins over that range; layers
  and banks go in 8 pieces into those bins or 8 fixed bins over the whole ray; bins are merged by depth and composited
  front to back. Nothing is sorted; nothing is dropped; alpha is exact.
- Light: octaves of extinction (single plus softer multiple-scattering lobes), a Henyey-Greenstein forward lobe, sky
  light = the style's `sky` at the zenith, flashes per blob. `shadowing` scales depths toward lights (stylised: < 1
  keeps sunlit faces white); a blob's own shadow counts a third (at full strength every lump drew as its own sphere).
- `cloud({ at, size, profile, blobs, turbulence, billow, drift, density, colour, seed, seconds })`: three tiers of puffs
  (few large core, medium lobes, many small dense surface puffs: a Gaussian's edge is crisper the denser it is), a
  level base, boiling from noise, drift; returns puffs and the bounds that hold them for `seconds`. The tiers are
  calibrated for 260 puffs; with fewer, each is larger by the cube root of the ratio (the same volume filled) and its
  density lower by as much (the same depth through its middle). `examples/storm.ts` uses 96, with the detail carried by
  noise (`detail` multiplies a piece's depth by exp(amount x noise), one octave: a factor e^x moves a Gaussian's edge
  by about x / 2q radii, so the silhouette becomes lumps; the earlier 1 + amount x noise, clamped, punched holes). `thunderhead({ at,
  height, width, blobs, seed, drift, seconds })` is a profile preset.

Corrections found by looking: lighting a puff at its centroid drew dark discs with bright rims (now: where seen); a
capped list of 16 strongest pieces per pixel drew hard-edged discs where its membership changed (now: bins); a piece
count growing with length drew streaks along view rays (now: fixed); one bin in front of the blobs drew the outline of
the rain shaft into the fog (now: fixed fog bins).

### 8.3 Glows, lightning, rain (`glow.ts`, `lightning.ts`, `rain.ts`)

- `glow(name, curve, { segments, width, halo, colour, core, intensity, veil })`, `glows(name, strokes, ...)` for a
  family, `flare(name, at, { size, halo, rays, ... })`. Strokes are sampled per frame into a table (any CPU-evaluable
  curve). Each segment is a view-plane quad; a pixel is lit by the nearest segment of a window of 6 either side only, so
  a curve's picture does not depend on how it is cut (tested). Core never thinner than a pixel (dims instead); additive;
  hidden behind opaque bodies; `veil: { kind: "medium", medium }` attenuates by the medium's closed-form depth up to the
  curve, so a bolt inside a cloud shows through it. The veil is evaluated once per segment, at its middle, in the vertex
  stage: per pixel it was a full pass over the medium for every pixel of a halo, more than the cloud itself cost.
- `bolt({ from, to, wander, roughness, levels, branches, schedule, segments })` (`from`, `to` expressions, read where the
  strokes are filled: a moving jaw, a mark an input sets): midpoint displacement in closed form
  (a sum over levels of hat functions times hashed offsets), deterministic in (seed, strike index); branches leave the
  channel at hashed points. `strikeAt(schedule)` is a pure function of time; `flicker(since)` (four return strokes),
  `afterglow(since, s)`, `boltFlash` (a medium flash at the bolt's top), `sheetFlash` (in-cloud lightning at hashed
  points), `skyFlash` (an additive wash).
- `rain(name, spec)`: one camera-facing quad per streak, place and fall hashed from (index, cycle), slanted by wind,
  faded at both ends and below a pixel's width, cut at the swell; `splashes(name, rain, spec)`: the ring each streak
  made at its last landing, laid on the sea (`on-water`).

### 8.4 Costs (best of 25, 1280x800, draw to texture without readback, heavily loaded machine; numbers vary ~2x run to run)

Polish pass (2026-11-11), `bun tools/storm_bench.ts 30`, best of 30, drawn into a texture and waited for, the start of
the pass and the end measured back to back, twice:

| storm view | before (260 puffs) | after (96 puffs) |
|---|---|---|
| three (the wide view) | 21.1, 21.5 ms (pose 4.8-5.6) | 11.1, 15.4 ms (pose 2.1-2.2) |
| front | 29.4-32.0 | 18.0-18.4 |
| side | 24.6-24.7 | 16.9-17.7 |
| low | 32.1-33.0 | 17.1-20.3 |
| edge | 58.1-60.7 | 28.7-32.4 |

What moved it: 96 larger puffs with noise detail (per-pixel blob work and the O(N^2) light pass, 6.8 -> 0.8 ms of CPU);
the glow veil per segment instead of per pixel; one detail octave instead of two (about 1.5 ms); rays that meet no
puff skip pass 2 and the depth bins (most of a hazy screen); a layer's depth toward the sun is its vertical depth over
sun.y (one erfc per fog piece fewer). The light pass is still every pair (a grid was not needed at 96). Other views
than the wide one stay above 16 ms: the fog layer and bank are integrated in 3 x 8 pieces over the whole lower screen
(about 3.5 ms) and the edge view puts the camera inside the cloud. Pictures: `out/polish/storm_before.webp`,
`out/polish/storm_after.webp`; test: `tests/soft.storm.test.ts` (coverage, brightness, contrast and blurred difference
against the 260-puff cloud).

Before the polish pass:

| Scene | ms per frame (of which CPU pose) |
|---|---|
| storm, views three / side / front / low / edge | 44-58 / 56-60 / 53-68 / 63-81 / 76-91 (pose 11-19) |
| serpent alone (same machine) | 2-9 |
| thunderhead only, 65 / 130 / 260 / 520 blobs, ~15% of the screen | 4.5 / 8 / 15 / 34 |
| same, ~50% / filling the screen, 260 blobs | 31-36 / 45-59 (pose 5-9) |

Cost is linear in blob count and in covered pixels; the CPU light pass is O(N^2) (0.9 ms at 65 blobs, ~20 ms at 520)
and each active flash adds another pass. Not real time for a 260-blob storm on this machine; the levers not yet pulled
are half-resolution integration (needs host support) and a light pass that reuses the previous frame (would break
purity); fewer blobs with detail noise is done (above).

### 8.5 Known limits

- Close up (inside a cloud's edge) the Gaussians read as soft blur; the detail noise thins edges but does not add
  sharp structure. Clouds do not shadow layers, banks, the sea or bodies; the flash does not light bodies except
  through `skyFlash`. Order inside one depth bin is lost (a bin is ~1/24 of the blobs' depth range).

## 12. Level of detail, the sea's grid, outlines and profiling (as built, 2026-11-11)

Before this, every frame drew the authored grids at every distance: 117k to 158k triangles in the serpent, the brig
and the islandback, of which the sea (a fixed 73,728-triangle grid) was half or more and the inflated ink outlines a
sixth to a quarter. Now the host draws about as many as the screen can show. Tools: `tools/triangles.ts` (declared and
drawn triangles per view, best-case ms, lossless shots), `tools/picdiff.ts` (picture differences, side-by-side sheets),
`tools/dolly.ts` (a camera dolly at a fixed time: popping, swimming), `loft profile` (12.4).

### 12.1 Grids sized by the screen (`Detail` kind `grid`; `src/draw/grid_detail.ts`, `src/host/detail.ts`)

- Every lit `draw.surface` (bodies, fins, hull planks, sails; copies through `draw.points` too) states levels: the
  authored counts halved per level, each axis floored at 8 cells round a closed direction (an octagon) and 2 along an
  open one. Glazed surfaces and flat strokes stay fixed (a ship's ropes are one grid joined by zero-width cells, which
  halving would break). `draw.relief` and the tracers are unchanged.
- The compiler measures each surface once at rest (time 0, inputs and params at their defaults, as a static
  `tabulate`): 5 x 5 grid points give the longest grid line per axis (a level's `cell` is those over its counts) and
  the surface's reach from its anchor (the grid's centre; a copy's origin). Per frame the pose posts only where each
  copy is (table `bound_<name>`: anchor point and scale, one vec4 per copy), a map the pose stages fill; the host reads
  the bounds back after the pose submit (`frame` waits for them; `draw` plans with the last ones read).
  Measuring every frame (16 points per drawable) took the fleet's pose from 0.45 to 3.9 ms. Given up: a surface that
  grows far beyond its rest shape on an input is sized by its rest shape.
- The host takes the coarsest level whose cells are at most `cellPixels` across at the sphere's nearest point, keeps
  last frame's level while its cells stay within `HYSTERESIS` (1.25) beyond the bounds that would choose it afresh, and
  skips a copy under a pixel across or wholly behind the eye. Copies are drawn in runs of one level (`firstInstance`
  keeps `instance_index` the copy's index), so a row of teeth may become two or three draw calls. A surface and its
  hull outline share one choice.
- Tests: `tests/detail.test.ts` (the serpent over a 30x dolly: cells within 1/2.2 to 1 times the target except at the
  finest and coarsest levels; no switch while the camera breathes 3%, where choosing afresh would switch; a dolly out
  only ever coarsens, sometimes by two levels at once where one axis is at its floor and the other no longer sets the
  cell size) and `tests/detail.gpu.test.ts` (default against `cellPixels: 0` at 1280 x 800).
- Measured against full density: worst mean difference 0.082 of 255 and 0.24% of pixels by more than 16, islandback
  from the game camera (the legs' knees shade slightly differently on a coarser grid). The close-ups are byte-identical:
  bodies there are at their authored density. Measuring at the sphere's nearest point is conservative: the brig from
  the game camera keeps its finest hull (cells 4 px; the next level would be 8.1 against a target of 7).

### 12.2 The sea: a projected grid (`Detail` kind `projected`; `src/geom/sea.ts`)

The grid is laid over the image of the still water. The host finds the NDC rows whose rays meet y = 0 within `reach`
(bisection on one depth per row, true for a camera without roll), widens the screen by how far a crest lifted by the
swell's amplitude moves at the bottom edge, and chooses nx x ny cells of `SEA_CELL` (2.25) x `cellPixels` pixels.
Each vertex is the point of still water its pixel sees, lifted to the exact height function there. About 9,500
triangles at 1280 x 800 with water to every edge. `tests/sea.grid.gpu.test.ts` runs the sea's own vertex stage in a
compute pass for three cameras: every edge belongs to one or two triangles, the one-triangle edges are exactly the
grid's rim (no cracks), and every vertex is within 2e-6 of the CPU's height at its own (x, z). `SeaSpec.grid` is gone.

The vertices slide over the water as the camera moves. Colour, crest, slope and foam are per pixel, so what moves is
the straight edges' cut through the crests, at most A (pi c / L)^2 / 2 for cells c; the dolly sheets
(`out/triangles/dolly_*.webp`) show no swimming. The far sea lost the old grid's light seams (its far cells were 25
units across and their edges showed in the brig's close-up). Where the whirlpool's funnel is steep, the woodblock
sea's printed lines and the foam round floating debris sit a few pixels from where the old grid (0.06-unit cells at
the view centre) put them: same look, not the same pixels (maelstrom, 1.8 to 2.4% of pixels by more than 16).
The sea's cost is its fragment stage, not its triangles (12.4).

### 12.3 Outlines: hull or screen (`Scene.outline`; `src/draw/ink.ts`)

`outline: "screen"` drops the second draw and inks silhouettes in one full-screen pass: a pixel is ink where an
outlined surface within the hull's width (8 directions x 6 radii, up to 8 px) is nearer than its own surface by more
than a step. Which surfaces are outlined travels in the picture's alpha (0.49 mark outlined, 0.51 + 0.49 mark not); the
pass restores the plain mark for the style's own passes. The default stays `"hull"`: after level of detail the hull
draws of the islandback cost 0.09 to 0.13 ms (profiled, game camera and close-up) against 1.2 to 1.9 ms for the pass,
and the pass cannot do two things the hull does: fill the inside of an open one-sided surface seen through its opening
(the islandback's shell aperture, which the hull shows as ink) and ink silhouettes under the water (the water's blend
raises the alpha over the flag).

### 12.4 Profiling (`GpuLoaded.profile`, `src/host/profile.ts`, `loft profile`)

With the `timestamp-query` feature (which `headlessDevice` now requests when the adapter has it), the host can draw a
profiling frame: every draw, the depth resolve, the multisample resolve, each post pass and the readback copy in a
pass of its own. A stage's cost is its completion delta (passes overlap on Apple GPUs), and every timed pass issues an
off-screen triangle (an empty pass is coalesced and its timestamps repeat the previous ones). Dawn quantises
timestamps to 65.5 us and bun-webgpu cannot turn that off, so a draw's figure is a mean over a block of frames, the
best of six blocks: good to about 10 us, and still noisy on a loaded machine (a second run can differ by 2x for a
small draw). `loft profile <scene> [--view] [--frames] [--outline hull|screen]` prints draws by cost, totals per thing
(the label up to its first `_` or space: a ship's parts group, the serpent's separately placed parts do not), the
fixed stages, the pose stages (all in one pass, then each level alone; their own durations, since a compute pass
overlaps the render passes after it), the count of map, scan and cpu tables, and every `cpu` table with its CPU cost
and why (`Compiled.poseProfile`). `bun tools/pose_time.ts` times the pose stages alone, 40 repetitions in one timed
pass after a warm-up (an idle GPU runs a short burst at a low clock).

### 12.5 A ship is about 40 draws (measured, not changed)

`examples/fleet.ts` is 119 draws for three ships and `examples/scenes/the_strike.ts` 80 for one ship and the serpent:
a brig is 45 draws (hull, deck, two bulwarks, transom, two rails, rudder, masts, yards, booms, gaffs, bowsprit: one
draw each plus one hull-outline draw each; sails, jibs, pennant: one each; the rigging: one). Profiled (12.4) a brig
costs 0.7 to 1.4 ms of GPU from the three-quarter camera, a sloop 0.2 to 0.45 ms and a galleon 0.2 to 0.5 ms, while
their triangles are a few thousand each after level of detail: the cost is per draw (about 15 to 30 us each in the
profiling frame, which also pays a pass per draw), not per triangle. Level of detail does not change the draw count.

To bring a ship to three draws (designed, not built): (1) one draw of every rigid opaque part (hull planks, deck,
bulwarks, transom, rails, rudder, and the spars, which are all sweeps): a drawable that takes several surfaces and
selects one per instance by `instance_index` with a `switch` in the vertex stage (uniform per instance, so one pipeline
and no divergence within a copy), each part's grid size read from `loft_detail` per instance as now; the spars could
instead be one instanced sweep reading a stacked station table. (2) One draw of the cloth (sails, jibs, pennant):
one sheet family whose per-sail corners, billow and team colour come from a per-frame table indexed by instance.
(3) The rigging, already one draw. Outlines then need either the screen pass (12.3) or one more draw of (1) inflated.
Two things the host would need: per-instance vertex counts within one call (`drawIndirect` per run, or a fixed
vertex count per call with surplus vertices collapsed), and the compiler's shader key being the family, not the part.

## 13. The ground: a sea, a plane, or nothing (2026-11-12, designed before building)

Until now every scene stood on a sea (`scene({ sea, ... })`), so a first scene that is not a sea picture (a lantern on
a table, a logo in space) could not be written (`docs/inventory.md` 9, 10).

### 13.1 What a user writes (written before the library, read cold)

```ts
scene({ ground: sea({ swell: [{ direction: [1, 0], length: 20, height: 0.6, speed: 2 }] }), things, style: toon(), sun });
scene({ ground: plane, things: [lantern], style: toon(), sun: [-0.5, 0.8, 0.4], cameras });   // flat ground at y = 0
scene({ ground: nothing, things: [lantern], style: toon(), sun: [-0.5, 0.8, 0.4], cameras }); // the style's sky all round
```

Questions a stranger asks, and the answer that removed each:

- *Sea or ground?* One key. Every scene is changed from `sea:` to `ground:` in the commit that adds the ground (about
  40 examples and 25 tests, one line each), instead of keeping `sea:` beside `ground:`: two keys for one idea is the
  question itself.
- *Where is the plane, and what colour?* `y = 0`, to the horizon, in the style's ground colour (`Style.ground`; toon
  takes `toon({ ground: rgb })` as it takes its water and sky). A plane has no parameters: a height would be moving
  every thing by the same amount, which the things already say; a coloured or bounded ground (a table top, a rug) is a
  thing the user draws, standing on the plane.
- *What is under the horizon with nothing?* The style's horizon colour (its sky with the ray levelled), not its water.
- *Does anything cast a shadow on nothing?* No: there is nothing to cast on. Bodies still darken each other in a style
  that prints a shadow block (woodblock).
- *Can a ring wave, a whirlpool or a wake stand on a plane?* A ring wave and a whirlpool are deformations given to
  `sea(...)`, so the types already refuse them elsewhere. A wake asks the scene's ground for a sea and throws
  `GroundError` naming itself on any other; a telegraph (a marker laid on the ground) takes a sea or a plane and
  refuses nothing.

### 13.2 The type, and the idea

```ts
type Ground = Sea | Plane | Nothing;   // each a Drawable, told apart by kind: "sea" | "plane" | "nothing"
```

Inherited: the sea as the scene's root surface. Every shader already calls `sea_height(xz)` for depth below the water
(the submerged tint), shadows are lifted along the sun onto it, the shadow block and rain discard below it, a fog bank
ends on it. Mine: that surface is **the ground**, and a sea is the one kind of ground that moves and is see-through.
The plane is a sea with no swell drawn opaque in the style's ground colour; nothing is no surface at all, which every
existing consumer already handles if its height is far below anything drawn (`BOTTOMLESS`, -1e9: depth is negative
everywhere, so nothing is tinted as submerged, discarded as under water, or splashed on). The WGSL name
`sea_height` is kept (it is read by style post passes owned elsewhere); it now means the ground's height.

### 13.3 Where each kind is handled (each one exhaustive `switch` on `ground.kind`)

| Where | sea | plane | nothing |
|---|---|---|---|
| `levelOf` (`src/draw/ground.ts`): the height shaders call `sea_height`, and a smear's depth | its swell | 0 | `BOTTOMLESS` |
| `styleWgsl` (`src/compile/scene_wgsl.ts`) | `sea_shadow` from `style.shadow`, as now | `ground_colour` from `style.ground` | neither |
| the sky (`src/draw/sky.ts`) | `sky(dir)`, as now | `sky` with the ray levelled below the horizon | the same |
| the ground's own draw | the sea, as now | one full-screen triangle (below) | none |
| cast shadows (`src/draw/shadows.ts`) | patches blended `sea_shadow`, as now | the same patches at y = 0, opaque, `ground_colour` at the shadow's coverage | none |
| `seaOf` / `surfaceOf` (`src/draw/ground.ts`), for wakes and telegraphs | the sea | `GroundError` / the plane | `GroundError` |

The plane is drawn like the sky, as one full-screen triangle, in the water's phase (no depth write, so the style's
post passes and the screen ink see it as they see the sea: not a body). Each pixel meets `y = 0` in closed form and
writes that point's depth for the depth test, so a body in front hides it and anything below it is covered; a ray that
misses discards. Exact to the horizon: no grid, no reach, no seam.

### 13.4 What each style draws on each ground

One required member is added to `Style`: `ground(ctx: GroundCtx): Expr<"vec3">`, with
`GroundCtx = { world, view, distance, sun, shadow }`. The cast shadow's coverage is an input, not a second layer: a
shadow patch draws the ground's own colour at its coverage, opaque, so the edge of a shadow meets the ground exactly
and no blend constant has to match it. Each style: toon a warm stone, shadows toward its shadow tint, fogged to its
horizon as its water is; woodblock its cream paper with a thin wash, shadows in its block ink, hazed toward the sky's
horizon as its far sea is; biolume a dark floor with the night's horizon; papercraft a card sheet, shadows as its
sheets shade each other, hazed toward its backdrop. On nothing, each style shows its sky above and its horizon below.

### 13.5 The artefact, and the cost

The format does not change: the plane is one more draw with raw WGSL, nothing is no draw. The Rust loader is
untouched.

Predictions, to be scored after building:

1. Every existing scene draws byte-identically (the crab's three `game` hashes; serpent, storm, coral, brig, night hunt;
   the brig in woodblock, biolume and papercraft). Stronger: `build` of brig and coral, in toon and woodblock, writes
   the same files byte for byte, because a sea scene's WGSL is emitted by the same expressions in the same order.
2. A sea scene's frame time is unchanged (the same artefact); the crab at `game` within noise.
3. The plane costs one draw: about 1.0 M fragments at 1280 x 800 below the horizon, each a ray-plane intersection and
   the style's ground (toon: about 20 ALU operations and one `exp`), no early depth rejection because it writes its
   depth. Predicted under the GPU clock's 0.065 ms step. Shadows on it cost what they cost on the sea.
4. Nothing costs nothing: no ground draw, the shadows drawable emits no draw.
5. `tools/files_proof.ts` and `tools/check_loader_closure.ts` pass unchanged.

Cut before building: a plane height or extent; a ground colour on the ground value; a separate shadow-on-ground style
function; a backdrop function for nothing (the levelled sky is the style's own colour); renaming `sea_height`.

### 13.6 As built: the predictions scored (2026-11-12, GPU shared with other workers, load average 17 to 26)

1. **Held.** All nine baseline hashes unchanged: the crab's `game` frames `0c1b1e4368820ff8`, `0db3c25b4d11121b`,
   `2315edeb83c975e9`; serpent `4ac451e2523b7e50`, storm `19aa1964b27034f1`, coral `49532c9dc621895d`, brig
   `eb04fbef44946f76`, night hunt `d26dae4e0368cc86` (640 x 400, t = 2); the brig in woodblock `7035b5d1102924f3`,
   biolume `d4787cc436169a5a`, papercraft `5a3dc2b08c70cef3`. `build` writes byte-identical files for brig and coral
   (toon and woodblock), the crab and night hunt. One correction on the way: toon's ground colour was first made
   eagerly with the others, which took an expression id and renumbered every later `let` in a sea scene's WGSL (the
   same program in different bytes); it is now made inside `ground`, and the comment there says why.
2. **Held by construction**: the crab's artefact is the same bytes, so the host does the same work. One reading for
   the record, slow clock state under load: 5.31 ms normal frame at `game`, 1280 x 800.
3. **Missed.** Predicted the plane under one 0.065 ms tick; measured 0.33 ms in the profiling frame, exactly the
   sky's 0.33 ms in the same frame (`examples/first/lantern.ts`, `three`, 1280 x 800, under load; the sea in the
   crab's frame read 1.27 ms in the same state). The arithmetic was not the cost: a full-screen pass here costs its
   fill (a multisampled target), as the sky shows, and the frame-time skill already lists the sky at 0.13 ms in the
   fast state. Corrected statement: **a plane costs one sky, about a quarter of a sea.** Not done: on a plane the sky
   could skip the half of the screen the plane covers (it is overdrawn there), saving up to half a sky; a camera
   below the plane would then see the clear colour.
4. **Held.** On nothing a lantern is 3 draw calls (sky, body, outline); on the plane 5 (plus ground and shadows).
5. **Held** in the part this change touches: `tools/check_loader_closure.ts` passes; `tools/files_proof.ts` draws
   every proof identically from files and from the scene (files == scene for all six). Its comparison with the
   phase-1 host's stored hashes (`tools/files_cases.ts`, last changed when the files format landed) reports all six
   different; the artefacts of this change are byte-identical to the base's, so that is older drift of the stored
   hashes, not this change.
