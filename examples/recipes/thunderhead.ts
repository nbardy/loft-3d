// RECIPE: a storm cloud, a broad dark-based tower under a wide anvil, boiling slowly. Copy it and edit the numbers.
//
// What it makes: `cloud` with a profile that narrows from the base into a tower and spreads into an anvil near the top,
// slow boiling, white puffs (the style and the light give them their dark base).
//
// Parameters: where its base sits, its height, the anvil's width (its depth is 0.8 of that), the puff count, a seed, a
// drift and how many seconds the drift must stay inside the bounds.
//
// What it cannot do: anything `cloud` cannot (one vertical axis, no growth or tearing); the anvil is round.
//
// What to change first when copying it: `profile` (half-width against height; a function of height and bearing gives
// an anvil sheared downwind), then `turbulence` and `billow` for how it boils.

import { cloud, type Cloud } from "../../src/index.ts";

export type ThunderheadSpec = {
  /** Centre of the base. */
  readonly at: readonly [number, number, number];
  /** From base to the top of the anvil. */
  readonly height: number;
  /** Width of the anvil. */
  readonly width: number;
  readonly blobs: number;
  readonly seed: number;
  readonly drift: readonly [number, number, number];
  readonly seconds: number;
};

/** A storm cloud: `cloud` with a tower-and-anvil profile, boiling slowly. */
export function thunderhead(t: ThunderheadSpec): Cloud {
  return cloud({
    at: t.at, size: [t.width, t.height, t.width * 0.8],
    profile: [[0, 0.5], [0.12, 0.6], [0.45, 0.44], [0.7, 0.42], [0.84, 0.72], [0.93, 1.0], [1, 0.8]],
    blobs: t.blobs, turbulence: 0.35, billow: 0.12, drift: t.drift, density: 0.9, colour: [1, 1, 1], seed: t.seed, seconds: t.seconds,
  });
}
