---
name: lively-motion
description: Make a Loft creature, ship or attack move with life (Disney's twelve principles of animation as formulas). Use when motion is correct but looks stiff, mechanical or dead, when authoring or reviewing an attack, idle or reaction, or when asked for exaggerated, lively or characterful movement.
---

# Lively motion

Read `docs/animation_principles.md` first. It lists the twelve principles, the helper for each, and an eight-step
order of work for a monster.

The helpers are in `src/geom/lively.ts`: `beats`, `anticipated`, `overshot`, `slowInOut`, `slowIn`, `slowOut`,
`squash`, `stretchOf`, `impact`, `arc`, `swing`, `dragged`, `echo`, `alive`, `exaggerated`, `uneven`. Existing ones
they build on: `response`, `retarded`, `pulse`, `ease` (`src/curve.ts`) and `breathe`, `strike`, `lookAt`
(`src/geom/motion.ts`).

Rules of thumb:

- Every action has three beats, and the wind-up is several times longer than the action.
- Nothing holds perfectly still, and no two parts move in step.
- Loose parts arrive late and keep going after the body stops.
- Volume is kept when a form stretches or squashes.
- After it works, push every departure from rest by 1.3 to 2 and look at it.

Render a frames sheet across the action and look at it before and after. Staging and appeal are not formulas: use the
checklist at the end of the reference.

## Grabs

For a monster that takes hold of something (a claw on a ship, a coil round a hull), use `grab`, `fingerAngle` and
`wrap` from `src/geom/grab.ts`; `examples/grab.ts` is the worked scene and `docs/animation_principles.md` has the
section. Drive every gripper from the grab's `gap`, and draw the held thing at `thing` with `squeezed(base)`.
