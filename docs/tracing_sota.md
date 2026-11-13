# Marching, tracing and the alternatives: state of the art, and what follows for Loft (2026-11-11)

Status: research and derivation. Of section 5, only 5.3 (unfold) is built. Counts in section 3 come from a CPU model of one small
picture (`tools/explain_marching_3d.ts`); they are operation counts, not GPU time. Published numbers are marked by how
they were checked:

- **read**: I read the number in the paper, the authors' slides or the author's own page on 2026-11-11.
- **abstract**: I read it in the abstract only.
- **reported**: a research pass found it; I did not open the source. Treat as unverified.

Pictures: [`docs/marching/index.html`](marching/index.html).

## 1. The question

Marching a distance field costs too much: the coral takes 11 to 14 ms a frame, and one object has to cost under 1 ms
if many are to be drawn. Is there a cheaper way, for instance by caching distances per region and sharing them?

Short answer:

1. Per-region caching works and is the current state of the art for marching. It comes in three forms (section 4.1).
   The best published result marches a 43-part blended character in about 4 ms for a full 1080p frame on a laptop RTX
   4060 (read).
2. On our model, sharing a coarse march between the pixels of a tile cut the work 3 times. Leaving marching cut it 45
   times (section 3).
3. Loft has two things the published methods lack: it owns the expression that defines the shape, and every body has
   its own coordinate system in which the shape does not move. Section 5 derives four drawing schedules from those two
   facts. Two of them stop marching altogether.

## 2. The cost of each way of drawing

| Way | Cost per object | What makes it expensive |
|---|---|---|
| March a distance field | pixels reached × steps per ray × cost of one evaluation | Rays that miss still step; rays near a surface take many steps; one evaluation visits every part |
| Intersect exactly | pixels covered × shapes tested per pixel × cost of one solve | Needs a closed formula per shape; no blends |
| Rasterise triangles | vertices × vertex cost + pixels covered × overdraw × fragment cost | Draw calls and CPU work per object; triangle count when detail is not matched to screen size |

Every speed-up for marching attacks one of its three factors. That is the frame for section 4.1.

## 3. Counts on a model

One tree: a capsule folded 6 times, so one evaluation of its distance function visits 7 capsules and stands for 5,461
branches. Picture 360×300; the tree covers 19.6% of it.

| Way of drawing | Operations | Per pixel | Times fewer | Pixels that differ |
|---|---:|---:|---:|---:|
| A. March every pixel | 8,212,834 | 76 | 1 | 0 |
| B. One coarse march per 8×8 tile, shared, then march | 2,701,405 | 25 | 3.0 | 17 |
| C. List the 5,461 branches, intersect each exactly | 183,842 | 1.7 | 44.7 | 172 |

- 75.5% of A is spent on rays that miss (10.2 steps each). A hit takes 13.5 steps.
- B proved 1,279 of 1,710 tiles empty. Its whole gain is that. Inside the tree it saved nothing: a ray threading
  between twigs is never far from one, so a coarse cone stops at the canopy's edge.
- Inside the outline alone, C is about 11 times cheaper than A (2,009,448 against 183,842 over the 21,206 pixels
  that hit).
- An operation in A and B is one capsule distance; in C it is one ray-against-capsule solve, which I estimate at two
  to three times the arithmetic. That estimate is not measured.
- C differs from A in 172 of 108,000 pixels: a folded copy is cut off where it crosses a mirror plane, a listed copy
  is not.

A second model, in 2D: a body made of 9 smoothly blended circles on a spine. Finding its surface along rays from the
spine by Newton's method, each started from its neighbour's answer, took 128 evaluations for 46 vertices: 2.8 per
vertex, at most 2 steps, to a quarter of a pixel.

## 4. State of the art

### 4.1 Marching distance fields

**Cheaper evaluations: keep only the parts that matter in each region.**

| Work | Idea | Result |
|---|---|---|
| Keeter, *Massively Parallel Rendering of Complex Closed-Form Implicit Surfaces*, SIGGRAPH 2020 | Interval arithmetic over screen tiles marks them empty, full or undecided and shortens the expression for each undecided tile | Expression size falls "by two orders of magnitude" in one benchmark (reported) |
| Zanni, *Synchronized-tracing of implicit surfaces*, arXiv 2304.09673, 2023 | A list of the parts that matter per 8×8 screen tile, for smoothly blended parts | 142 parts: 57.8 ms to 7.3 ms at 1720×1376 on an RTX 2080; 658 ms to 22.1 ms at 1024² on a Quadro P1000. The baseline keeps the lists per pixel (read) |
| Barbier, Sanchez, Paris, Michel, Lambert, Boubekeur, Paulin, Thonat, *Lipschitz Pruning*, Eurographics 2025 | A grid hierarchy over space, to 256³. In a cell of radius R, a part is dropped from a union when its distance at the centre exceeds the other's by 2R, or 2R + k for a blend of radius k. Far cells replace the whole tree by a constant | About 1.0 to 1.2 parts left per cell on average. Laptop RTX 4060, 1080p, one primary and one shadow ray: character (43 parts) 1.02 ms to prune, 2.79 ms to trace, 8 times faster than unpruned; car (117) 1.17 and 2.38 ms, 23 times; crowd (1,989) 5.53 and 8.35 ms, 227 times; trees (369) 2.73 and 13.01 ms, 20 times (read, authors' slides, table 1) |
| Keeter, *Gradients are the new intervals*, 2025 | For a field whose slope is bounded by 1, one sample at a region's centre plus the region's radius bounds the field over the region. No interval arithmetic | About the same speed as intervals (12 ms against 18 ms at 512², intervals slightly ahead; hardware not stated). The gain is that bounds do not loosen through stacked transforms (read) |

**Fewer steps.**

| Work | Idea | Result |
|---|---|---|
| Keinert and others, *Enhanced Sphere Tracing*, 2014 | Step further than the distance, fall back when two steps fail to overlap | No number checked |
| Bán and Valasek, *Automatic Step Size Relaxation in Sphere Tracing*, Eurographics 2023 short | The over-step factor adapts from earlier steps | "Outperforms or performs up to par"; no factor (reported) |
| Galin, Guérin, Paris, Peytavie, *Segment Tracing Using Local Lipschitz Bounds*, 2020 | Bound the field's slope along the next piece of the ray, not globally, and step by distance over that bound | "Significantly reduces the number of field function queries"; no number (reported) |
| Seyb, Jacobson, Nowrouzezahrai, Jarosz, *Non-linear sphere tracing*, 2019 | March a curved ray through an undeformed field, so bends and twists need no inverse | No timing checked |

**Fewer pixels, and shared starts.**

| Work | Idea | Result |
|---|---|---|
| Cone marching (demoscene, around 2012) | March one thick ray per tile at low resolution; pixels start where it stopped | Forum reports of 10 to 12 times fewer evaluations on one fractal (reported). 3.0 times on our model, all from empty tiles |
| Polychronakis, Koulieris, Mania, *An Inverted Pyramid Acceleration Structure...*, EGSR 2023 | The same, as a pyramid of resolutions, with foveation in a headset | "Up to 20.4×" (reported; the paper would not open) |

**No evaluation at all: store the distances.** Grids of distance bricks, traced with a few texture reads per step.
Used by Unreal's Lumen (a global distance field) and by Claybook (from memory, not rechecked). Hansson-Söderlund,
Evans and Akenine-Möller, *Ray Tracing of Signed Distance Function Grids*, JCGT 2022, compares ways to trace them.
A grid in world space has to be rebuilt when things move.

**Rasterise a hull, march only inside it.** Common practice: draw a bounding shape as triangles and start the march
at its front face. Relief and parallax mapping are the same idea in a thin shell. Loft's `draw.field` and
`draw.relief` already do this.

### 4.2 Exact intersection and hardware ray tracing

- Closed formulas for a ray against a sphere, ellipsoid, capsule, rounded cone, box and torus are standard (Quilez's
  intersectors; molecular viewers have drawn spheres and cylinders this way in fragment shaders since 2006). Exact
  edges, one solve per shape per pixel, no ray-tracing hardware.
- Thin curved things: Reshetov and Luebke's phantom ray-hair intersector (2018); roving capsules (NVIDIA, 2024, "more
  than 2×" over phantom, reported); linear swept spheres in RTX 50 hardware (2025; NVIDIA states about 2× faster and
  5× less memory than its previous strand primitive, reported). A bent tube of varying radius has no single closed
  form; all of these chain straight pieces.
- Hardware ray tracing in 2025 and 2026 moved on build cost and on sample reuse: cluster acceleration structures
  (NVIDIA Mega Geometry; Microsoft's DirectX preview quotes a build falling from 788 ms to 3.11 ms, reported), and
  ReSTIR path tracing (37.1 ms to 12.6 ms in one paper example, reported).
- None of it is in the WebGPU standard. wgpu has an experimental ray query on native targets (reported).

### 4.3 Rasterising

- Very many triangles: Nanite (2021) draws clusters at the detail the screen needs, into a buffer of triangle
  identities, and rasterises tiny triangles in compute. Skinned meshes arrived in Unreal 5.5 as experimental
  (reported). Bevy 0.15 (2024): the first raster pass fell from 3.44 ms to 0.42 ms on an RTX 3080 at 2240×1260 by
  rasterising small clusters in software, and the author names culling, at 1.27 ms, as the bottleneck (read).
  meshoptimizer shipped cluster level-of-detail building in 2025 (reported).
- Schütz, Lipp, Kristmann, Wimmer, *CuRast*, 2026: a CUDA software rasteriser, "up to 2-5x (unique) or up to 12x
  (instanced) faster than Vulkan" for hundreds of millions of triangles, and, in the same abstract, "Vulkan remains
  an order of magnitude faster for low-poly meshes" and "scenes with thousands of low-poly meshes are not implemented
  efficiently" (abstract).
- That last line is our case. For many small objects the state of the art is ordinary instanced rasterising, and the
  cost is draw calls and CPU work per object, not triangles. WebGPU has no mesh shaders and no multi-draw indirect in
  the standard (reported, and matches what I know to mid-2026), so the lever is one instanced draw per kind of part
  with poses in a storage buffer.

### 4.4 Splats and volumes

- 3D Gaussian Splatting (Kerbl and others, 2023) is fast because it bins splats into 16×16 screen tiles and sorts per
  tile. Speed papers since then claim 3 to 7 times (FlashGS, Speedy-Splat, Faster-GS; all reported). Browser viewers
  moved the sort to WebGPU compute (WebSplatter, 2026, "1.2× to 4.5×" over other web viewers, reported; PlayCanvas
  vendor figures, reported).
- Splats that move are skinned like meshes: one transform per splat (SplattingAvatar and similar, reported). Nothing
  learned is needed for that part.
- Clouds in shipped games are marched at low resolution and accumulated over frames. Guerrilla's Nubis: "under two
  milliseconds on the PlayStation 4" (reported from Guerrilla's own page).

### 4.5 Learned accelerators

| Kind | Examples | What they speed up | Open source |
|---|---|---|---|
| A network that answers a ray in one query | PRIF (ECCV 2022); RayDF (NeurIPS 2023); probabilistic directed distance fields (CVPR 2022); DDF for Gaussian splats (2026) | Marching a *neural* distance field. RayDF's "1000×" is against neural baselines (reported) | RayDF: CC BY-NC-SA, non-commercial. DDF-GS: MIT. (both reported) |
| A network in place of the lowest level of a ray-tracing hierarchy | Neural Intersection Function (AMD, 2023); N-BVH (SIGGRAPH 2024); LSNIF (2025) | Memory. LSNIF's abstract claims "up to 106.2x" less memory than a compressed hierarchy and no speed gain (abstract) | None found |
| Fast neural distance fields | NGLOD (2021), Instant-NGP (2022), PermutoSDF, Neuralangelo (2023) | Fitting and storing a scanned shape | Kaolin Wisp (NVIDIA research licence), sdfstudio (Apache-2.0) (reported) |
| Neural parts of shipped renderers | Radiance caching, texture compression, ray-reconstruction denoisers | Lighting, memory, noise. Not finding geometry | Vendor kits |

No comparison was found in which a learned method beats an analytic field with bounds for small animated procedural
objects. Every one is trained on one static scene, or re-trained per view. Our shapes are known in closed form and
move every frame, so there is nothing to learn that a table cannot store. Loft's `tabulate` is that table.

## 5. What follows for Loft

Labels: DERIVATION means I derived it here and it is not tested. COUNTED means section 3 counted it on a model.

### 5.1 Two more readings of the same expression

Loft evaluates an expression three ways today: as a value on the CPU, as a value on the GPU, and as a symbolic
derivative. Two more readings give everything section 4.1 uses, for any field an author writes.

**The slope reading.** For a region with centre c and radius R, and a bound L on the field's slope there,
`f(c) - L R <= f(p) <= f(c) + L R` for every p in the region. It needs one ordinary evaluation, so it runs on the
existing backends. It gives:

- an empty test: `f(c) > L R` proves the region has no surface;
- the pruning rule: in `min(a, b)` drop `a` over the region when `a(c) - b(c) >= 2 L R`, plus k for a blend of
  radius k (Barbier and others; Keeter 2025).

**The interval reading.** Each operator maps intervals to an interval that contains every possible result: sums and
products by their end points, `min`, `max`, `abs`, `sqrt` by monotone pieces, `sin` and `cos` by their range over the
interval, `mod`, `fract` and `floor` by the whole range when the interval spans a jump, `select` by the hull of both
branches when the condition is undecided, `fetch` by the minimum and maximum of the table over the index range,
`iterate` by running the loop on intervals. A library function without an interval form is a typed error, not a
guess. It gives:

- a bound on L where it is not 1. Loft already has the symbolic gradient; reading `|grad f|^2` in intervals over a
  box bounds the slope *in that box*. A twist is steep only far from its axis, a noise warp only where its amplitude
  is high. Today a fold carries one hand-written `stretch` for all of space. This is segment tracing (Galin and
  others) for any expression, with no per-operator work by the author. DERIVATION.
- hulls without hand-written bounds: the boxes that fail the empty test are the hull.
- `check`'s distance-bound test as a proof over boxes in place of sampled pairs.

Use the slope reading where L is known and tight (rigid folds, unions, blends), and intervals where it is not (warps).

### 5.2 Cache in the body's coordinates, not in the world

A body's field at time t is `F(x, t) = G(phi_t^-1(x))`: a shape G written in the body's coordinates, and a map
`phi_t` that places those coordinates in the world. For most parts the animation is all in `phi_t` and G does not
change. So anything cached about G is built once: pruned part lists per cell, distance bricks, the surface table of
5.4. The published methods have no such coordinates and rebuild in world space every frame (1.0 ms a frame for a
43-part character in Lipschitz Pruning).

The price is that a straight ray in the world is a curve in body coordinates.

- Where `phi_t` is rigid (a ship, a shell, the coral, one segment of a limb) the ray stays straight. Transform it and
  march the cache.
- Where the body bends, march in the world and evaluate G through `phi_t^-1`. A step of size d in body coordinates is
  at least `sigma_min * d` in the world, where `sigma_min` is the smallest stretch of `phi_t`. For a swept body with
  a rotation-minimising frame and a unit-speed spine, the map `(m, a, b) -> c(m) + a N1 + b N2` has derivative
  `(1 - kappa1 a - kappa2 b) T` along the spine and is orthonormal across it, so `sigma_min = 1 - kappa r` on the
  inside of a bend of curvature kappa at distance r from the spine. The safe step is `(1 - kappa r_max) G`. It costs
  nothing until `kappa r` nears 1, which is where the body folds through itself anyway. Twist adds a shear term; in
  general take the bound from `stretchOf`, which exists. DERIVATION.

### 5.3 Unfold: a fold has two readings

A fold built from mirrors, rotations into a sector, finite repeats and scale-and-shift steps is a finite set of
transforms. Asking a folded field at a point and listing the transformed copies describe the same set of points. So a
`Fold` carries both:

```ts
apply: (p) => { x, id, stretch }          // ask: compose in front of a field
orbit: () => Points<{ transform, id }>    // list: one instance per copy
```

`id` is the same in both, so paint that varies per copy does not change with the schedule.

- Cost when asked: covered pixels × steps × (fold depth × part cost), plus the rays that miss. Cost when listed: for
  each copy, its screen area × one solve. On the tree: 13.5 steps × 7 against 8.7 copies per covered pixel, and
  misses cost nothing. COUNTED: 45 times fewer operations in all, 11 times inside the outline.
- The two differ only where a copy crosses a mirror plane (172 of 108,000 pixels on the tree). The list is the shape
  the author meant; the fold clips it.
- Level of detail is dropping copies smaller than a pixel. On the tree's camera none were; further away most are.
- An endless fold (unbounded repeat, a spiral that zooms forever) has no finite list. List the copies in view and
  above a pixel, or march.
- A plain list loses smooth blends between copies. 5.5 keeps them.

This is the existing rule "a fold composes for things you ask and becomes instancing for things you list", made
automatic: the compiler can count both costs and choose.

**Built and measured (2026-11-11).** `src/lib/similar.ts` derives both readings from one chain of generators and
`draw.copies` draws the list (DESIGN.md 7.8). On the coral, GPU time of the draw alone at 1280x800 fell from 4.9 to
6.8 ms (marched through its brick; 12.6 to 16.4 ms before the brick) to 1.3 to 1.5 ms, and the close-up from 25.9 ms
to 3.1 ms. The compiler does not yet choose between the readings; `examples/coral_list.ts` writes the list.

### 5.4 Solve onto the body: one root per vertex

Take a field G in a body's coordinates, written with the usual blends, carves and warps. For each vertex `(m, v)` of
the body's grid take the ray `x(rho) = c(m) + rho e(m, v)` from the spine and solve `G(x(rho)) = 0` by Newton's
method, `rho <- rho - G / (grad G . e)`, starting from the neighbouring vertex's answer. The gradient is symbolic.

- The result is a `Surface` given by `rho(m, v)`, drawn as triangles like any strand. The normal is `grad G`
  normalised, exact at each vertex and each pixel, so shading shows no facets.
- By 5.2, `rho(m, v)` is stored once with `tabulate` unless G's own parameters animate. Then each frame re-solves
  from the last frame's answer, one or two steps per vertex.
- COUNTED in 2D: 2.8 evaluations per vertex. For scale, with assumed sizes and no measurement: a body of 2,000
  vertices and 10 parts needs about 60,000 part evaluations once; marching it over 20,000 pixels needs about
  2,600,000 every frame.
- It needs one root per ray: G must increase along each ray from the spine (`grad G . e > 0`). That is a check, by
  sampling or by intervals. A horn that curls back or a hole fails it and needs its own spine, or 5.5.

This is what distance-function modelling becomes in Loft. The field is the modelling language. The body's
coordinates are the drawing schedule. The cost is that of a mesh.

### 5.5 March inside each part's own hull

For blended unions that fail 5.4's check.

**The blend has to be exactly local first.** The usual smooth minimum, nested pair by pair, is not: a far part can
shift the running value, and that shift passes down a chain of nearer parts. It shrinks at every link and never
reaches zero, and the result depends on the order of the parts. I found this while checking the proof below; it is
why Zanni builds on compact operators and why Lipschitz Pruning prunes per tree node and not per part. In a six-part
example, a part 3.05 k beyond the nearest changed the nested result by 0.00011 k, and reversing the order of the
parts changed it by 0.0028 k. So define the blend of parts `f_j` with radius k symmetrically:

```
m(x) = min_j f_j(x)
F(x) = m(x) - sum over j other than the nearest of  phi(f_j(x) - m(x)),   phi(g) = (max(k - g, 0) / k)^2 * k / 4
```

For two parts this is the usual polynomial smooth minimum. For any number, a part further than k beyond the nearest
contributes exactly zero, and the order does not matter.

**The schedule.**

1. Draw each part's hull as triangles: the set `f_i <= delta`, where `delta = (n - 1) k / 4` and n is the largest
   number of parts within k of the nearest at any point. On the surface `F = 0`, so `m = sum of phi <= delta`.
2. In hull i's fragment shader, march from the hull's front face to its back face through the local field `F_i`: the
   same blend over part i and its neighbours `N(i)`, the parts whose set `f_j <= delta + k` meets hull i.
3. Let the depth test keep the nearest result.

**Why the result is the true surface.** DERIVATION.

- Inside hull i the local field equals the full field. At a point x there, `m(x) <= f_i(x) <= delta`. A part that
  contributes at x has `f_j(x) < m(x) + k <= delta + k`, so x lies in its grown set, which therefore meets hull i,
  so j is in `N(i)`. Parts in `N(i)` that do not contribute at x add zero. Hence `F_i(x) = F(x)`.
- So every hull's march reports only points where the full field is zero or negative.
- The true first hit `x*` on a ray has `m(x*) <= delta`, so it lies in the hull of its nearest part, and that hull's
  march reports it.
- Any other report lies on the same ray inside the solid, which is behind `x*`. The depth test keeps `x*`.

Monotonicity is not needed, so a carve can be handled the same way as long as it is as local as the blend.

The slope of this blend is at most 1 while the weights `h_j = max(k - (f_j - m), 0) / k` of the other parts sum to
at most 2, and at most `sum h_j - 1` beyond that. A crowded junction therefore needs shorter steps; 5.1's interval
reading bounds this per hull.

It is per-region pruning with the rasteriser as the region structure. Each march is short, because a hull is about as
thick as its part, and visits a few parts. By 5.2 the neighbour lists are fixed in body coordinates, so nothing is
rebuilt when the body moves. Cost per covered pixel: overdraw × a short march × (1 + neighbours).

### 5.6 Shared starts

- **Per tile.** The cone bound used in section 3: a cone of radius `k t` around a tile's centre ray may advance by
  `(d - k t) / (1 + k)` when the distance on its axis is d, because the ball of radius d then contains the cone up to
  there. COUNTED: 3.0 times, all from empty tiles.
- **From the last frame.** Start each ray at the smallest depth the last frame had in a neighbourhood of the pixel,
  less `v_max dt`. The neighbourhood's radius in pixels is `v_max dt` over the pixel's size at that depth, plus the
  camera's shift. In Loft `v_max` is not a guess: motion is an expression of `time`, so its derivative is symbolic
  and can be bounded. DERIVATION.
- Both only remove the empty stretch before a surface. A tight hull already does that, so these are worth little
  once hulls are tight.

### 5.7 Soft things

The storm costs pixels × blobs. Bin the blobs per screen tile so each pixel visits only the blobs over it, evaluate
at half or quarter resolution, and upsample with the scene's depth. This is the splat renderers' binning and the
cloud renderers' low resolution. It is not new; Loft lacks it.

### 5.8 Choosing

The schedule is a property of the draw, chosen at compile time, with an author override:

| Schedule | Precondition | Cost grows with |
|---|---|---|
| Solve onto the body (5.4) | The field has a body, and one root per ray | Vertices |
| Unfold (5.3) | A finite fold of parts that have a closed ray formula or a mesh | Copies on screen |
| Hull march (5.5) | Parts joined by the exactly local blend | Covered pixels × a short march |
| Brick march (5.2 with 5.6) | Any field with a slope bound | Covered pixels × steps |

When no precondition holds the compiler reports which ones failed. It does not fall back silently.

## 6. Blends, warps and displacement on triangles

The question: marching is the natural home of smooth blends, twists and noise-displaced surfaces, and triangles are
what the hardware draws. Can a body have both? Labels as in section 5; MEASURED-2D means `tools/explain_blend.ts`.

### 6.1 What exists

| Need | Published way | What it leaves open for us |
|---|---|---|
| Twist, bend, taper | Move the vertices forward through the warp. The normal is the cofactor of the warp's Jacobian applied to the old normal, `det(J) J^-T n` (Barr, *Global and local deformations of solid primitives*, SIGGRAPH 1984; reported, the sentence itself not read). Lattice warps: Sederberg and Parry 1986 (reported) | Nothing. Loft's `place` composes a map behind a surface and has the symbolic Jacobian |
| Displacement by a function | Displace the surface along its normal and take the normal from the function's derivatives (Blinn 1978 for the normal; Lee, Moreton, Hoppe, *Displaced subdivision surfaces*, 2000; Niessner and Loop, *Analytic displacement mapping using hardware tessellation*, 2013; all reported). Detail below the sampling rate is dropped or moved into shading (Norton, Rockwood, Skolmoski 1982; Olano and Baker, *LEAN mapping*, 2010; reported) | No published rule was found for where to split a procedural displacement between vertices and shading, or for how fine a grid must be after a warp |
| A blend on one mesh | *Implicit Skinning* (Vaillant and others, SIGGRAPH 2013; follow-up 2014). One skinned mesh. Each frame every vertex is moved to its own iso-value of a field composed from one implicit surface per bone: `v += s (f(v) - iso) grad f / |grad f|^2` with s = 0.35, stopping where the gradient turns sharply (a contact), with a tangential relaxation toward the neighbours between steps (read in a walk-through of the paper; the paper itself would not open) | It works on one skinned mesh and needs each vertex's neighbours, and it moves vertices along the field's gradient, so they drift and have to be relaxed |
| A blend's look without its geometry | Screen-space blending across the seam of two meshes after the scene is drawn (the MeshBlend plug-in for Unreal, 2024 to 2025; from its author's forum posts, reported). It mirrors the picture across the seam, costs about 0.45 ms at 2560x1400 on unstated hardware, and fades when something is in front | The silhouette is unchanged |
| A blend by displacing meshes where they intersect | A Blender Geometry Nodes asset, Smart Mesh Blend 2, blends normals and materials by distance to the intersection and can displace geometry there; its documentation asks for the meshes to be subdivided or remeshed first (reported, not opened) | An authoring tool, not a per-frame rule with a stated surface |
| A blend by per-pixel roots | Draw a hull and solve the blended field per pixel (Loop and Blinn 2006; Kanamori, Szego, Nishita 2008; reported). Section 5.5 is of this kind | It is marching's cost, bounded |

No source was found that combines all three on triangles, and none for the construction of 6.2: two research passes
and my own searches looked for it by description.

### 6.2 Push to blend: each part keeps its triangles

Let parts have distance fields `f_i`, exact outside each part, and let F be their smooth union of radius K (5.5).
Every part keeps its own mesh, coordinates and draw. In its vertex stage:

```
p      the vertex on the part's own surface, n its outward normal
t      the first root of F(p + t n) = 0 in [0, K / 2], by Newton from 0; K / 2 if there is none
p1     p + t n
```

Nothing is stitched and nothing is re-meshed. The parts still overlap inside. The depth test takes their union, and
the union's outside is the blended surface.

Why. DERIVATION, for two parts that are convex within K / 2 of their surfaces.

- Along its own outward normal a vertex is exactly t from its part, so `F(p + t n) = smin(t, f_j(p + t n))`.
- Every point y of the blended surface is reached. Let i be the part nearest y and p the foot of y on it; then
  `y = p + f_i(y) n`, and `f_i(y) <= K / 4` because the blend lowers the nearer distance by at most K / 4. Between p
  and y the blend is never positive: moving a distance s from y toward p lowers `f_i` by s and raises the gap to the
  other part by between 0 and 2 s, and the blend term falls by at most half the rise of the gap, so by at most s. So
  the ray from p is inside the solid until y, where it leaves.
- No vertex leaves the solid. A pushed vertex is on F = 0. A vertex with no root in reach has F < 0 all the way, so
  it stays inside, hidden by the other part.

The reach has to be more than K / 4. MEASURED-2D, a disc and a capsule, K = 60 px, largest distance from the true
contour (found by scanning the field) to the two pushed outlines:

| Reach | 96 vertices | 192 | 384 | 768 |
|---|---:|---:|---:|---:|
| K / 4 | 2.46 px | 0.85 | 0.39 | 0.30 |
| K / 2 | 0.54 px | 0.14 | 0.03 | 0.01 |
| K | 0.54 px | 0.14 | 0.03 | 0.01 |

With a reach of K / 4 the two outlines meet at the seam and stop, and the edges that cross the seam dip inside: the
error stalls. With K / 2 each outline runs on past the seam along the true surface and the error is the chord's,
falling four times per doubling. With K, long pushes stretch edges outside the solid (0.70 px at 96 vertices against
0.35). Before the push the contour is 15.3 px from the outlines. The cost was 1.9 evaluations of the blend per vertex,
at most 3 Newton steps; a vertex further than K from every neighbour pays one.

Against Implicit Skinning: the push is along the part's own normal, not the field's gradient, so a vertex needs no
neighbours and no relaxation and stays where its coordinates put it; and there is one mesh per part, with the depth
buffer doing the union, where they have one mesh for the body.

Past the seam the two meshes lie on the same surface. They have to shade alike there: the normal is `grad F` for both,
and colour is mixed by the blend's own weight. Whether that hides the overlap in 3D is not tested.

### 6.3 Displacement and warps go after the push

```
rest surface -> push to blend -> displace along grad F by h -> warp forward by W
```

- **Displace.** `p2 = p1 + h(p1) N`, with h a function in body coordinates and N the blended normal. The normal of
  the displaced surface comes from the symbolic derivatives of h. Split h by wavelength: parts longer than two grid
  cells move vertices; everything down to the pixel changes the normal; anything shorter than a pixel is dropped
  (`footprint` in `src/grad.ts` gives the pixel). Detail that needs a silhouette finer than the grid is `draw.relief`.
- **Warp.** `p3 = W(p2)`, normal `cof(J_W) N`. The vertices are exactly on the warped surface; the error is the
  chord's, about `(d^2 / 8) |D^2 W|` for an edge of length d, so the grid needs `d <= sqrt(8 e / |D^2 W|)` for an
  error of e. DERIVATION (also reached independently by the research pass); no published rule found.
- **Carve.** For A minus B, draw A's pixels where `f_B > 0` and B's, facing inward, where `f_A < 0`. Each test is one
  evaluation of the other part's field per pixel, and the cut is exact.

Why this composes. A march puts a warp in front of the field, as an inverse map, and pays for it in shorter steps
and lost distance (5.1). Triangles put it behind, as a forward map on vertices, and pay nothing. In the chain above
the fields are only ever evaluated in rest coordinates, where they are exact distances, and only at vertices.

### 6.4 Limits and unknowns

- Tested in 2D on two convex parts with exact distances. Nothing is built in 3D.
- A part has to be convex, or at least have no concavity tighter than K / 2, where it blends; otherwise a vertex's
  distance to its own part along its normal is not t.
- Three or more parts within K of one point: the reach bound above is for two. Not proven; 5.5 is the fallback.
- A swept body's distance is not closed form. Its neighbours would see it as the rounded cones of its skeleton, so the
  two sides of a seam would solve slightly different fields. The size of that mismatch is not measured.
- The fillet needs vertices: about `sqrt(8 e R)` apart for a fillet of radius R, which is of the order of K.
- Folds that cannot be listed still need the march.

## 7. Order of work

1. Merge `wave3/triangles` and `wave3/tracer` and read `loft profile`. Done. In `examples/scenes/the_strike.ts` at the
   game camera the serpent's draws sum to under about 0.2 ms of GPU (each below the profiler's 0.065 ms tick, so the
   sum is not reliable) and the ship read 0.32 ms in 45 draws (0.2 to 1.4 ms across runs); the sea is 1.5 ms,
   and the CPU pose and upload is 5.4 ms, more than every draw together. The next cost for many objects is the CPU
   pose, not the GPU.
2. Unfold, on the coral. Done: 1.3 to 1.5 ms against 4.9 to 6.8 ms (5.3). Still to do: the compiler choosing it.
3. Solve onto the body, on a creature with blended parts.
4. The slope and interval readings: hulls without hand bounds, the check as a proof, pruning.
5. Hull march, for blends that fail the one-root check.
6. Binned, low-resolution soft things.
7. One instanced draw per kind of part. A ship is about 40 draws today, and section 4.3 says that is where the cost
   of many small objects sits.
8. Push to blend (6.2) in 3D, on one limb joining a body, with displacement and a warp after it.

## 8. Not known

- GPU time for any of section 5 on an M-series machine or in a browser.
- Whether about 3 evaluations per vertex holds in 3D on a real creature's field.
- Overdraw of hull marching on real bodies, and how much the symmetric blend's look differs from the nested one
  where three or more parts meet.
- How fast intervals widen through `iterate`. If they widen too fast, folds use the slope reading only.
- The cost of a ray solve relative to a distance evaluation on the GPU.

## Sources

Read on 2026-11-11:

- Barbier and others, Lipschitz Pruning, authors' slides with table 1:
  https://origami.projet.liris.cnrs.fr/topics/gdl/gdl_talk_59/LipschitzPruning.pdf (paper: doi 10.1111/cgf.70057)
- Zanni, Synchronized-tracing of implicit surfaces: https://arxiv.org/abs/2304.09673
- Keeter, Gradients are the new intervals: https://www.mattkeeter.com/blog/2025-05-14-gradients/
- Bevy 0.15 virtual geometry: https://jms55.github.io/posts/2024-11-14-virtual-geometry-bevy-0-15
- CuRast (abstract): https://arxiv.org/abs/2604.21749
- LSNIF (abstract): https://arxiv.org/abs/2504.21627

Reported by the research pass, not opened by me:

- Vaillant and others, Implicit Skinning (ACM TOG 32(4), 2013): https://irit.fr/~Loic.Barthe/implicitskinning.php ;
  follow-up, Robust Iso-Surface Tracking (ACM TOG 33(6), 2014): https://hal.archives-ouvertes.fr/hal-01091820 . The
  projection rule quoted in 6.1 is from a walk-through: https://solaire.cs.csub.edu/aestus/implicit-skinning-part-1/
- Barr 1984: https://history.siggraph.org/?p=107435 ; Sederberg and Parry 1986: https://history.siggraph.org/?p=116034
- Niessner and Loop 2013: https://niessnerlab.org/projects/niessner2013analytic.html ; Lee, Moreton, Hoppe 2000:
  https://hhoppe.com/proj/dss/ ; Olano and Baker 2010: https://userpages.cs.umbc.edu/olano/papers/lean/
- Loop and Blinn 2006: https://www.microsoft.com/en-us/research/wp-content/uploads/2006/01/p664-loop.pdf ;
  Kanamori, Szego, Nishita 2008: https://kanamori.cs.tsukuba.ac.jp/projects/metaball/eg08_metaballs.pdf
- MeshBlend: https://forums.unrealengine.com/t/meshblend-a-plugin-for-blending-meshes-landscapes-etc-in-unreal/1937887

- Keeter, MPR: https://www.mattkeeter.com/research/mpr/
- Polychronakis, Koulieris, Mania, inverted pyramid: https://diglib.eg.org/handle/10.2312/sr20231128
- Bán and Valasek, automatic step size relaxation: doi 10.2312/egs.20231014
- Galin and others, segment tracing: https://perso.liris.cnrs.fr/aparis/public_html/projects/galin2020_Segment.html
- Seyb and others, non-linear sphere tracing: https://cs.dartmouth.edu/~wjarosz/publications/seyb19nonlinear.html
- Hansson-Söderlund, Evans, Akenine-Möller, SDF grids: https://jcgt.org/published/0011/03/06/
- Quilez, intersectors and distance functions: https://iquilezles.org/articles/intersectors/ ,
  https://iquilezles.org/articles/raymarchingdf/
- RayDF: https://github.com/vLAR-group/RayDF ; DDF-GS: https://github.com/smlab-niser/ddf-gs ;
  PRIF: https://arxiv.org/abs/2208.06143 ; N-BVH: https://arxiv.org/abs/2405.16237
- Faster-GS: https://arxiv.org/abs/2602.09999 ; WebSplatter: https://arxiv.org/abs/2602.03207
- Guerrilla, Nubis: https://www.guerrilla-games.com/read/nubis-evolved
- NVIDIA linear swept spheres:
  https://developer.nvidia.com/blog/render-path-traced-hair-in-real-time-with-nvidia-geforce-rtx-50-series-gpus
