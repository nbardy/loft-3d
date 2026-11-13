---
name: frame-time
description: Measure or reduce what a Loft scene costs per frame on the GPU or CPU. Use before any performance work, when quoting a frame time, when comparing before and after a change, or when a profile's numbers do not add up.
---

# Measuring a frame

Read "Rates" and "The sea" in `docs/gpu_native.md` for what has been measured and which ideas already failed.

## The instrument

- `bun src/cli/main.ts profile <scene> [--variant v] [--view game] [--size 1280x800]` prints per-pass times and a line
  "normal frame: X ms GPU". Quote the normal frame. The per-pass frame carries about 1.8 ms of timer overhead, so its
  total is not the cost of a frame, and per-pass numbers do not add up to the normal frame.
- The timer's tick is 0.0655 ms. A difference of one or two ticks is not a result.
- **The GPU has two clock states about 3x apart** (a crab frame reads about 1.2 ms in one and 4.4 ms in the other).
  Compare before and after only within one state: alternate the two builds for several rounds and compare like with
  like. Never set a fast-state number beside a slow-state one.
- **One profiler at a time.** Other workers rendering on the same GPU corrupt a reading. If a number looks off, repeat
  it; if several workers are active, say the reading was taken under load.
- One scene per process (a global parameter registry conflicts across scenes).

## Before optimising

1. **State the budget.** How many of these on screen, at what resolution, on what device, in how many milliseconds.
   Without it there is no target; say so and ask, do not invent one.
2. **Predict to the number, then run once.** Write the saving you expect and why, commit it, measure, score it. Three
   rounds here missed their predictions (rate lifting gained nothing; GPU pose and the sea came in under); each miss
   was a wrong picture of where the time goes, found cheaply because the prediction was written first.
3. **Measure the parts before choosing one.** A crab frame in the fast state is roughly: sea 0.4, body 0.3, pose 0.2,
   fixed stages 0.25 to 0.5, sky 0.13 ms. If the game draws its own water, the sea is not a game cost.
4. **Ask what scales.** One boss is cheap. Count (84 draws and about 100,000 triangles each, no level of detail yet),
   resolution (the sea, outlines and the print pass are per pixel) and first appearance (shader compile) are where a
   game will hurt.

## Hard limits to watch

- The `loft_detail` uniform block has been reported at exactly 64 KiB, the default limit. Adding per-frame values can
  cross it: build the artefact and check after any change that adds them.
- Shaders are compiled by Tint here and by Naga in the Rust loader (`rust/loft-loader`). A construct only one accepts
  is a bug for the other host.

## Identity

A refactor that must not change pictures is checked by the `rgba` hash `render` prints, at three times, before and
after. A change that should change pictures states the new hashes in its report.
