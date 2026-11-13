# A differentiable Loft: follow-up, deferred

Written 2026-11-13 as a note for later. Nothing here is built.

## The question

Could gradients of a picture, or of any measurement, with respect to a scene's numbers come out of Loft itself?

## Why Loft is closer than most renderers

- **A scene is an expression graph.** Shapes, motion, paint and styles are written in one expression language
  (`src/expr.ts`), and Loft already differentiates that graph symbolically (`src/grad.ts`) to get normals and surface
  frames. A custom shape is an expression, not a hand-written shader, so it would be differentiable without its author
  doing anything.
- **There is no simulation state.** Every frame is a closed form of time. Optimising a motion over a clip needs no
  backpropagation through time: frames are independent.
- **Scenes are small in parameters.** A few dozen to a few hundred named numbers, not millions of vertices.

## Stages, cheapest first

1. **Today, with no new code: finite differences.** A parameter changes without recompiling and a frame takes
   milliseconds, so a central difference over 100 numbers is about a second, and an evolution strategy is practical.
   The cost to measure first: gradient noise from hard edges at the working resolution.
2. **Gradients of measurements (about a week).** Extend `grad` to differentiate with respect to params and inputs,
   and through sampled tables (`tabulate`: store the derivative's samples too), so anything computed on the CPU (a
   check's measure, a clearance, where a throw lands, a projected width or height) has an exact gradient. Then a
   small fitter: state target numbers, minimise. This fits working without reference pictures: the author writes the
   target in numbers and an inner loop reaches it.
3. **Gradients of pixels (weeks).** Three separate problems:
   - *Interior shading*: differentiable as it stands; emit the derivative of the colour as extra outputs, one pass
     per parameter (forward mode). Reverse mode is only worth building if scenes grow to thousands of parameters.
   - *Visibility*: silhouettes and occlusion edges carry most of the signal for shape and none of it reaches a
     rasteriser's interior gradient. Options to weigh: edge terms from the analytic, already antialiased coverage
     (the outline's screen position is a closed form of the parameters); soft rasterisation; for traced fields, the
     implicit-function derivative at the hit plus a boundary term.
   - *Hard-edged looks*: bands, a quantised palette, ink lines, hashed noise, `floor`, `fract`, `select`. These need a
     smooth "optimisation style" to render with while fitting, and the real style for the final picture.
4. **Soft things** (fog, clouds, glows) are Gaussian integrals in closed form and are differentiable already.

## What a user would have to supply

Nothing, for anything written as expressions. A derivative by hand only where the expression language is bypassed:
a raw WGSL function (`wgslFn`) or a custom drawable with its own shader.

## What stays outside gradients

The choice of construction: which shapes, what topology, which parts compose a style. Gradients tune numbers inside a
construction; choosing the construction is search. This is the same split as "change the law, not the number".

## First experiment when this is picked up

Stage 2 on one scene: take `examples/second/heron.ts`, state three target measurements (body height on screen, stride
length, the clearance of a foot), fit six numbers by gradient from a deliberately wrong start, and compare iterations
and wall time against finite differences. Predict both before running.
