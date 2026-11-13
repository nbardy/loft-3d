# Loft and three.js

An honest comparison, for someone who knows three.js and wonders whether Loft has a reason to exist. Written
2026-11-13. Facts about three.js were checked against its own documentation on that day; line counts for three.js are
estimates, not measurements, and are marked so.

## The short answer

They are for different jobs. three.js is a general 3D engine: any mesh, any material, many lights, a large community,
every browser. Loft is a small library for one thing: **animated, stylised things that are written entirely as code**,
by a person or a model, where what was made has to be checked or scored. If you have assets from a modelling tool,
or you need physically based rendering, use three.js. If the thing does not exist until the code is written, read on.

## What "the same scene" takes

A reed that sways, toon shaded, with an ink outline and a cast shadow on a floor, rendered to a file.

| | Loft | three.js |
|---|---|---|
| The shape | one `strand` whose spine is a function of position along it and of time | a tube geometry rebuilt on the CPU every frame, or a vertex shader that bends a static one |
| The motion | `sin(time)` inside the spine: time is an argument | an animation loop that mutates the scene each frame |
| The look | `style: toon()`: banded light, outline, shadow, ground and sky are one value | a toon material and its gradient map; a separate outline pass or an inverted hull; shadow maps switched on at the renderer, the light and each mesh; a ground mesh; a background |
| The picture | `loft render scene.ts --out reed.webp` | a renderer, a canvas or a headless context, a camera, a render call, reading pixels back |
| Lines | about 20 | 60 to 100 (estimate) |

Why Loft is shorter, in order of how much each matters:

1. **One representation, not four.** In three.js geometry is buffers, shading is a material or shader, motion is a loop
   or keyframe tracks, and the scene is a mutable graph. In Loft shape, motion and paint are expressions of the same
   kind, so "the tip sways" is written once, where the shape is written.
2. **Time is an argument.** There is no loop to write and no state to keep; any frame is drawn alone.
3. **A style is a whole look.** One value carries the lighting, the outline, the shadow, the ground and the sky. This
   is a design choice with a price: see "What Loft gives up".
4. **The command line renders a module.** No renderer set-up.

Per formula Loft is not shorter. TypeScript has no operator overloading, so `a * b + c` is `add(mul(a, b), c)` or
`a.mul(b).add(c)`. three.js's own shading language reads the same way; plain GLSL or WGSL is terser than both.

## three.js has a shading language too

TSL (Three.js Shading Language) is a node-based shader abstraction written in JavaScript: you compose functions
(`color.mul(0.5)`), assign the result to a slot of a material (`material.colorNode = …`), and three.js compiles the graph
to WGSL for WebGPU or GLSL for WebGL. It is the closest thing in three.js to Loft's expressions, and for shading it is
more mature.

The difference is scope:

| | TSL | Loft's expressions |
|---|---|---|
| Covers | what a material computes (colour, position offset, and compute passes) | shape, motion, paint, style, and the checks |
| Lives in | slots of a material, inside three.js's scene graph | the whole description; there is no other layer |
| Runs on | the GPU | the GPU for every frame (drawing and motion); and, on demand, the CPU to measure: the same graph |
| Geometry | comes from buffers made elsewhere | is a function |

So the thing Loft competes with is not TSL alone but three.js as a whole for this one job. What Loft has that the
combination does not is the last row but one: **the description can be evaluated on the CPU**. "Does the throw land in
the target", "is the face unobstructed from this camera", "do five dancers arrive within five milliseconds" are exact
arithmetic on the scene itself, with no render and no second copy of the maths.

## Running without a browser

three.js is a JavaScript library and needs a JavaScript engine and a graphics context. There is no official headless
path for its WebGPU renderer. The options are headless Chrome (which does not expose WebGPU by default, and three.js
falls back to WebGL 2 without an error when no adapter is found), `headless-gl` (WebGL 1 only), or a young third-party
native add-on built on `wgpu`.

A Loft scene builds to plain files: WGSL, tables and a manifest. The command line draws them headlessly through Dawn,
and a Rust loader in this repository (`rust/loft-loader`) draws the same files with `wgpu` and no JavaScript at run
time. Building the files needs the TypeScript step. The Rust loader has not been re-verified since the ground kinds
and style parts landed.

## What Loft gives up

- **Assets.** No mesh import. Meshes come out (`loft bake` writes glTF), none go in.
- **Physically based rendering.** No reflections of one object in another, no bounced light. Water can mirror what
  stands on it through a post pass.
- **Lights.** One sun lights bodies. Local lights are not there yet (see `docs/open_design.md`).
- **State.** Nothing is simulated: every motion is a closed form of time. Cloth, fluids and flocking, as usually
  written, do not fit.
- **Reach.** WebGPU only. Version 0.0.1, one author, no community. Its largest scene takes minutes to load.
- **Opinion.** A style decides the look of everything in the scene. That is why a scene is short, and it is a box
  unless every part of it can be replaced. It can: a style is a plain value composed from exported parts, a thing can
  carry raw WGSL, and a drawable or a host can be written from scratch. Keeping that true is the subject of
  `docs/open_design.md`.

## What Loft has that three.js does not

- **Checks from the description.** Above.
- **Determinism.** A fresh process gives byte-identical pixels; a loop can be proved to close.
- **Built to be written by a model.** A refusal says what was given, what was expected and the fix; exit codes say
  whose fault a failure was; `loft context` prints what a model needs in about 2,200 words; every component's comment
  states what it cannot do and what to try instead.
- **A complement, not a replacement.** Bake a Loft scene to glTF and use it in three.js.

## Sources

- [Three.js Shading Language (official documentation)](https://threejs.org/docs/TSL.html)
- [Three.js Shading Language (wiki)](https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language)
- [What is the current state of headless rendering with WebGPU? (three.js forum)](https://discourse.threejs.org/t/what-is-the-current-state-of-headless-rendering-with-webgpu/82600)
- [@headless-three/renderer (package statistics)](https://www.pkgstats.com/pkg:@headless-three/renderer)
