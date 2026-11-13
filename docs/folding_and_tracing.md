# Folding space, and the tracers that draw folded things (design note, 2026-11-10)

Status: design note of 2026-11-10. Since built: 3.1 and 3.2 (`draw.field`, `impostors`) and 3.3 (`draw.relief`);
DESIGN.md 7.7 and section 8 say what was built and what it costs, and override this note where they differ. Statements
about techniques are from the author's knowledge, not re-read today. Corrections from building 3.1 are marked below.

## 1. What a fold is

A fold is a map `F` from space to space that sends many points to one: a reflection (`abs`), a repeat (`mod`), a
rotation into one sector, a scaling into one shell. Draw a motif at `F(p)` and it appears at every point that folds
onto it. One motif, any number of copies, the same cost per query.

That only works for things you **ask**. It does nothing for things you **list**.

| The thing is | Folding means | Cost of copies |
|---|---|---|
| asked at a point: a distance field, a density, a height function, a texture, noise, a paint function | compose the map in front: `f(F(p))` | none |
| listed as elements: triangles, instances, splats, particles | enumerate the copies: an instance index mapped to a transform | per copy |

So "which 3D geometry works with folding" has a short answer: every representation that is evaluated by query, and
none that is enumerated. For enumerated geometry the same symmetry is still useful, but it becomes *instancing with a
generator*: `transform(i)` walks the group (lattice index to translation, sector index to rotation, spiral index `i`
to `rotate(i * phi) * scale(s^i)`). Branching recursion of depth N costs `b^N` instances.

In Loft's terms this is already the capability split: a `Field` folds by composition; a `Surface` folds its paint and
its displacement by composing in its parameter domain; copies of a `Surface` in space are `draw.points` with a
generator.

## 2. The folds

Each returns the folded point, a cell identity (for per-copy variation), and a **stretch factor**: how much the map
scales lengths locally. A distance evaluated after the map must be multiplied by that factor to be a distance in
world space again.

| Fold | Map | Stretch | Gives |
|---|---|---|---|
| mirror | `abs(x)`; across a plane: `p - 2 min(0, p.n) n` | 1 | bilateral symmetry; several planes iterated give kaleidoscopes and polyhedral symmetry |
| repeat | `mod(p + c/2, c) - c/2`; limited: `p - c clamp(round(p/c), -l, l)` | 1 | lattices; finite rows of teeth, ribs, oars |
| polar repeat | angle `mod 2 pi / n` | 1 | n-fold rings: petals, legs, a ring of teeth |
| screw | `(theta, z - pitch * theta)` then repeat | about 1 | helices, ropes, springs |
| scale and iterate | fold, scale by `s`, shift; repeat N times | `s^-N` | self-similar trees, coral, sponges (kaleidoscopic iterated function systems) |
| log-polar (2D), log-spherical (3D) | `(log r, direction)` then repeat in `log r` | `r` | recursion toward a point: nested shells, infinite zoom |
| spiral | log-polar sheared by the angle | `r` | logarithmic spirals: nautilus, horns, whirlpools |
| inversion | `p R^2 / |p|^2` | `|p|^2 / R^2` | Apollonian packings, bubbles within bubbles |
| twist, bend, noise warp | not length-preserving, not conformal | a bound only | organic irregularity; shortens tracer steps |

Three rules that decide whether a fold is safe:

- **Isometries are exact inside a cell, not across cells.** After a repeat, the nearest copy may be the neighbour's.
  Mirrors are always exact. Repeats are exact if the motif stays inside its cell; otherwise evaluate the neighbouring
  cells too (2 per axis is enough when the motif fits in a cell).
- **Conformal maps need one scalar.** Log-polar, inversion and uniform scale stretch equally in all directions, so
  multiplying by the stretch restores a true distance bound.
- **Everything else needs a safety factor.** Twist, bend and noise warps stretch differently in different directions;
  the tracer must shorten its steps by the largest stretch, or it will step through surfaces and leave holes.

Time folds the same way: `mod(time, period)` loops a motion, and a space-time object can be repeated along time.

## 3. The tracers

A tracer is a per-pixel evaluator for something you can ask. Four are worth having. In every case the triangles Loft
already draws provide the *bound* (where to start and stop), and the tracer supplies the detail. "Rasterise the
coordinate system, trace what is inside it."

### 3.1 Sphere tracing a distance field

For free-standing solids: recursive shells, fractal coral, a rock field.

- March along the view ray, stepping by the distance the field returns; stop when the distance is below the pixel's
  footprint at that range (`eps * t`), which is also automatic level of detail: far away, small folds fall below the
  footprint and the march ends early. Iteration depth can be cut the same way (stop folding when the feature is
  smaller than a pixel).
- Start and end the march at a proxy: a box, a sphere, or a strand's own hull drawn as ordinary triangles.
- Write colour and `frag_depth`, so traced solids intersect triangle bodies and the sea correctly.
- Normals from the field's gradient. Finite differences cost four more evaluations; a symbolic gradient costs about
  one (section 4). *Correction (2026-11-11):* not through a fold's loop. Differentiating `iterate` carries the
  derivatives through every level; on the coral it cost 27 field evaluations on the CPU and, on the GPU, about as much
  as the whole march (its registers slowed the rest of the shader), so the tracer uses the four differences.
- A static field is a table (2026-11-11): sampled once into a distance brick whose lookup is a lower bound, the march
  steps by it in free space and asks the formula only near the surface; or extracted once into a triangle mesh. Both
  are `draw.field` schedules (DESIGN.md 7.7), chosen by `auto` from the field's leaves and the formula's cost.
- Known costs: writing depth from the fragment stage disables early depth rejection, so proxies should be tight and
  drawn front to back; multisampling does not antialias a traced silhouette inside its proxy, so the edge must be
  faded from the footprint.

### 3.2 Analytic ray casting, with a grid walk

For many copies of a simple shape: rain, bubbles, pearls, studs, rigging lines.

- Ray against sphere, ellipsoid, capsule, rounded cone and box has a closed form: exact hit, exact normal, no steps.
- For a repeated lattice, fold the *ray* instead of the point: walk the cells the ray crosses (a 3D DDA), and in each
  cell intersect the cell's motif analytically. Cost is the number of cells crossed, not the number of copies.
- A mirrored domain is the same thing seen the other way: a ray reflecting off the fold planes is a straight ray
  through the tiled copies.
- This is also a second schedule for thin strands: a chain of rounded cones intersected per pixel does not alias the
  way a thin triangle tube does.

### 3.3 Shell tracing in a body's own coordinates

For relief that belongs to a creature: scales, spikes, barnacles, suckers, feathers.

- Draw the body's surface as now, but at `rho = 1 + h_max`: the top of a thin shell around it.
- In the fragment stage, express the view ray in body coordinates `(m, v, height)` using the surface's Jacobian at
  that pixel, and march down through the shell until `height <= H(F(m, v))`, where `H` is a height function and `F`
  a fold in `(m, v)`.
- The relief bends with the body because it is written in the body's coordinates, costs a bounded number of steps
  per pixel, and adds no triangles. Fragments that never hit are discarded, so spikes have real silhouettes.
- Error: the ray is treated as straight in body coordinates over the shell's thickness. That is second-order in
  curvature and acceptable for stylised work; it degrades where the body bends tightly, the same limit as folding of
  body coordinates.

### 3.4 Volumes through a fold

For repeated soft things: a field of clouds, endless rain streaks, foam cells.

- A closed-form integral (a Gaussian blob along a ray) does not survive a fold directly: the ray crosses many cells.
  Walk the cells as in 3.2 and add each cell's closed-form contribution, or march with a small fixed step count.
- Gradient and cellular noise are already this: a lattice fold with a per-cell hash.

## 4. What the expression layer needs

| Addition | Why |
|---|---|
| Symbolic differentiation on the DAG (`grad`, `jacobian`) | One mechanism, four uses: normals of traced fields, stretch factors of folds, the Jacobian of a chart (computed by finite differences on the CPU in the scene-graph proof, where it dominated the cost), and pixel footprints. The DAG is pure and hash-consed, so derivative rules per operator are enough and shared subexpressions stay shared. |
| A loop form (`iterate(n, state, step)`; built in `src/expr.ts`, a real loop in both backends) | Fold iteration was unrolled, which grows the shader with depth and fixes the count at compile time. A real loop keeps code small and lets depth depend on distance. |
| Screen-space derivative operators (fragment stage only) | Edge widths in pixels. Important trap: the derivative of a *folded* coordinate jumps at every seam and draws a line there. The footprint must come from the unfolded coordinate times the fold's stretch, which is what `grad` provides. |
| `Fold` as a value: `{ p, id, stretch }`, composable | So folds chain, and the stretch is carried instead of remembered. |
| 3D distance primitives and operators | sphere, box, capsule, rounded cone, torus; union, subtract, intersect and their smooth forms; round; shell; revolve and extrude of the existing 2D distance functions. |

## 5. New kinds of thing

```ts
solid({ sdf: (p) => Expr<"f32">, bounds, paint, steps })                // 3.1: sphere-traced inside a proxy
impostors({ cell, shape, bounds })                                         // 3.2: analytic per-cell ray cast
relief({ on: strand, height: (m, v) => Expr<"f32">, hMax, fold, steps })  // 3.3: shell-traced on a body
```

Each is a `Drawable`: it emits its proxy triangles and a fragment shader assembled from expressions. The host needs
nothing new; it already supports fragment-stage depth and arbitrary shaders.

## 6. A check that must exist before any of this renders

A fold that breaks the distance bound produces holes that look like a rendering bug. Catch it as arithmetic: sample
pairs of points on the CPU backend and assert `|d(a) - d(b)| <= |a - b|` (times the declared safety factor). The CPU
and GPU backends agree by test, so a field that passes on the CPU is safe to march on the GPU.

## 7. Not known

Where the marching cost goes, the published ways to cut it, and four schedules derived for Loft are in
[`tracing_sota.md`](tracing_sota.md) (2026-11-11), with pictures in [`marching/index.html`](marching/index.html).

- Step budgets and frame cost in a browser. (On this machine's GPU: DESIGN.md 7.7. Scattered loads from a storage
  buffer cost about a tenth of a coral evaluation each, so a brick only pays for an expensive formula.)
- How far shell tracing can be pushed before curvature error shows.
- Whether fragment-stage depth costs more than the triangles it saves at RTS camera distance, where most relief is
  below a pixel and should be dropped by level of detail anyway.
