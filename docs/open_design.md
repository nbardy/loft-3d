# Staying open: materials, lights, meshes, and the rules that keep Loft small

Written 2026-11-13. A design exploration, not a record of what is built: each section says what exists, the options,
and a recommendation. Nothing here is implemented unless it says so.

## Who this is for

The author of a Loft scene is, more and more, a model. It can write open-ended code and mathematics a library author
did not think of. So the library's job is not to offer a menu of looks and shapes. It is to give that author a
surface on which anything it can write as a function is drawn, measured and reported on, and never to stand between
it and the mathematics.

## What goes wrong in other APIs, for this author

| API | What it gets right | Where it boxes the author in |
|---|---|---|
| three.js (and Babylon, PlayCanvas) | reach, assets, a complete engine | A class for every kind of thing: `MeshStandardMaterial`, `PointLight`, `TubeGeometry`. The classes are a menu, and a menu is a basin: what is not on it needs a different language (a shader string or a node graph). A mutable scene graph with hidden state (`needsUpdate`, order of calls). Four separate systems for shape, shading, motion and scene, so one idea is written in four places. Nothing can be evaluated without drawing. Errors arrive at draw time, in a GPU console. |
| three.js TSL | shading as composable functions; compiles to two targets | Scoped to a material's slots. Geometry and motion stay outside it. |
| Shadertoy-style fragment code | no menu at all: pure mathematics | No structure either: one function for the whole picture, no objects, no parts to name, nothing to measure, everything paid per pixel. |
| Houdini VEX, Blender geometry nodes | attributes plus expressions over geometry: the closest in spirit | Heavy hosts; a graph editor or a proprietary runtime; state everywhere. |
| Processing, p5 | immediate and easy to start | Stateful drawing calls; shape and motion are whatever the loop happened to do. |
| react-three-fiber | declarative | The same menu of classes, as tags. |

The pattern: an API boxes its author in when **the unit of extension is a named kind** (a class, an enum, a node type)
and not a function, and when **going past the menu means changing language**.

## The rules

1. **The unit of extension is a function.** Wherever the library accepts a number, it accepts a function of the
   natural coordinate where that means anything. Wherever it accepts one of several named kinds, one of the kinds is
   "your own function".
2. **No cliffs.** Every level is a few lines over the level below, and that level is exported: a component over a
   mechanism, a mechanism over expressions, expressions over raw WGSL (`wgslFn`), a scene over drawables you can write
   (`Drawable`, `CompileContext`), drawing over files any host can load. Going past something is one step, never a
   rewrite and never a different language until the very bottom.
3. **Mechanisms, not looks.** The library owns what has one right answer (frames along a curve, inverse kinematics,
   a gaze that holds at the rim, a ballistic arc, sync). Proportions, palettes and materials have many, and belong to
   the author.
4. **Sum types for mechanisms only.** A closed list of variants is right for "how a thing is placed" and wrong for
   "what a thing looks like".
5. **A built-in uses nothing a user cannot import.** Checked for styles (`tools/style_imports.ts`) and recipes
   (`tools/check_recipes.ts`).
6. **Every default can be replaced without leaving the level.** A default that cannot is a box; one that can is a
   starting point.
7. **Say the limits.** Each component's comment states its law, what it cannot do, and relatives worth trying. A
   limit that is not written is read as the whole space.
8. **The budget is the context.** `loft context` is about 2,200 words. A feature that cannot be said there in a line
   is a recipe, not a library function. Count exports per layer at every release; a number that only grows is a
   warning.
9. **A second, unrelated user before anything is called settled.**

## Materials

**Today.** A thing has a *paint*: a colour as a function of its own coordinates. The *style* decides how any colour
answers light. So a thing cannot say "I am metal" or "I glow": only the style speaks about light.

| Option | What a user writes | Open? | Cost |
|---|---|---|---|
| Classes of material | `material: metal({ roughness: 0.2 })` | No: a menu. | Every style must know every class. |
| Parameters only | paint returns `{ colour, gloss, emission }` | Half: a fixed list of channels. | Each new idea needs a library change. |
| Function only | a thing carries its own `shade(ctx)` | Fully. | The thing ignores the scene's style, so restyling a scene stops working for it. |
| Shader only | `wgslFn` in the paint | Fully, at the bottom level. | Exists today. No CPU twin. |
| **Channels and a wrap** | paint returns a colour and any **named expressions** the author likes (`{ colour, gloss: 0.8, wet: …, emits: … }`); a style reads a channel by name with a default, and ignores names it does not know; a thing may also **wrap** the style: `shade: (ctx, styled) => …`, receiving the style's answer and returning its own | Fully: the vocabulary of channels is the author's, a style honours what it understands, and a wrap composes with the style instead of replacing it. | A small change to what paint returns and what a style receives. |

**Recommendation: channels and a wrap.** No material types. `gloss`, `emits` and whatever comes next are words, not
classes; the handful a built-in style reads are listed in its comment. This keeps restyling working (rule 6) and lets
an author invent a channel and a style part that reads it without touching the library (rule 1).

## Lights

**Today.** One directional sun reaches every style. Fog and cloud take point flashes. A `glow` draws light along a
curve but lights nothing.

| Option | What a user writes | Open? |
|---|---|---|
| Classes of light | `lights: [point(…), spot(…)]` | No: a menu. An area light, a light with a pattern, a light that is a curve, each needs a new class. |
| Parameters only | more suns, each a direction and a colour | No. |
| **A light is a function** | `(p) => ({ toward, colour })`: for a point in the world, the direction the light comes from and how much arrives | Fully. A point, a spot, a tube, a window, a patterned lamp, a light that moves or flickers are all this, and falloff and shadowing by an analytic occluder are just more mathematics inside it. |

**Recommendation: a light is a function, and things that glow provide one.** A scene's lights are a short list of
such functions; the sun is the first; each style receives them already evaluated at the fragment and decides how to
print them. `glow` gains the function that goes with what it draws, so "the flame lights the floor" needs no new
concept. `pointLight`, `spotLight` are three-line helpers that return a function, with comments in the four parts.
Limits to state plainly: no cast shadows from these lights unless the function computes its own occlusion; a cap of a
few lights, because each adds a term to every body's shader. A cloud's `Flash` becomes the same thing.

## Meshes

**Today.** Geometry is functions; triangles are made by Loft from them and can be written out as glTF. No mesh comes
in. Inside, a triangle mesh already exists as a type (surface nets of a distance field).

Importing a modelled asset is a different library's job: the mesh has no body coordinates, no parameters and no
closed form, so it loses checks, paint in its own coordinates and variants.

But there is a real box here, and it is not about assets. An author who invents an algorithm that **produces
triangles** (a convex hull, a Voronoi shatter, a subdivision scheme, a growth process that is easier as a mesh than
as a function) cannot draw its result.

| Option | Open? |
|---|---|
| No meshes at all (today) | A box for algorithmic geometry. |
| Import of files | Opens the wrong door: assets, not algorithms. |
| **A drawable for a mesh made by code** | `draw.mesh(name, { points, triangles }, { paint })`, where the data comes from the author's own function at build time. Paint is a function of the hit point and normal, as it already is for surface nets. |

**Recommendation: a drawable for a mesh made by code; no file import.** State its limits: no body coordinates unless
the author supplies them per vertex; fixed at build unless given a table that changes per frame.

## The largest box: no state

Every motion is a closed form of time. That is why frames draw alone, loops close and renders are deterministic. It
also rules out what is naturally written as a step: reaction and diffusion, cloth, flocking, growth by accretion.

Options, least disruptive first: (1) keep it, and say so; (2) **bake a recurrence at build**: the author writes a step
function, Loft runs it from zero for the scene's period and stores the result as a table over time, so playback is
still a closed form and any frame still draws alone (cost: memory and build time, bounded by the period); (3) real
state on the GPU, which gives up drawing any frame alone.

**Recommendation: (2), when a scene first needs it.** It keeps every property the rest of the library relies on.

## Smaller doors worth opening

- **A gloss from the sky.** The sky is already a function of direction, so a body reflecting the sky and the sun is a
  style part of a few lines. No reflection of one object in another without rays against the scene.
- **Opaque names.** `retarded`, `kifs`, `whorl`, `crown` say nothing to a stranger (rule 7).
- **The fixed order of drawing stages** is the one thing a user cannot change today. Leave it until someone needs it.

## Order of work, if this is taken up

1. Lights as functions, with `glow` providing one.
2. Paint channels and the wrap.
3. `draw.mesh` for meshes made by code.
4. The gloss part.
5. A baked recurrence, on first need.

Each changes what an author writes, so each changes what a model trained on Loft has learned: batch them into one
release, and regenerate `loft context` with it.
