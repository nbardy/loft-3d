// RECIPE: ships at a game's scale. Copy this file and edit it.
// Uses: ../../recipes/ship.ts (the ship recipe), ../../brig.ts (brigSpec), ../../fleet.ts (sloopSpec, galleonSpec): the
// ship numbers. Copy those specs with it, or pass your own `ShipSpec` to `scaled`.
//
// What it makes: a `ShipSpec` (the recipe's `ship` draws it) scaled to a length. Those examples draw their ships at 7
// to 17 units; a game's ship is about 5. `scaled` multiplies every length of a spec (hull lines, masts, bowsprit,
// flutter) and keeps the dimensionless ones (exponents, fractions, angles), so the same ship comes out smaller. `brig`,
// `sloop` and `galleon` are those three at game lengths; `PLAYER` the player's colours.
//
// Parameters: a spec, a length in world units, a name, colours to override.
// What it cannot do: change a ship's proportions (it is a uniform scale of the lengths); change what `ship` can draw
// (its numbers: masts, tiers, jibs: one kind of ship).
// Copying it: add your own spec first; a scale per axis (a longer, lower hull) is a change to `scaled` alone.

import type { ShipColours, ShipSpec } from "../../recipes/ship.ts";
import { brigSpec } from "../../brig.ts";
import { galleonSpec, sloopSpec } from "../../fleet.ts";

export function scaled(spec: ShipSpec, length: number, name: string, colours?: Partial<ShipColours>): ShipSpec {
  const k = length / spec.length;
  const pair = (p: readonly [number, number] | undefined) => (p === undefined ? undefined : ([p[0] * k, p[1] * k] as const));
  return {
    ...spec, name, length, beam: spec.beam * k, depth: spec.depth * k, freeboard: spec.freeboard * k,
    sheer: pair(spec.sheer), castle: pair(spec.castle), mastHeight: spec.mastHeight * k,
    bowsprit: spec.bowsprit === undefined ? undefined : spec.bowsprit * k,
    flutter: spec.flutter === undefined ? undefined : spec.flutter * k,
    colours: { ...spec.colours, ...colours },
  };
}

/** The player's colours in the owner's concept sheet: a warm brown hull under blue sails. */
export const PLAYER: Partial<ShipColours> = {
  hull: [0.36, 0.2, 0.1], cloth: [0.18, 0.4, 0.86], team: [0.95, 0.85, 0.3], trim: [0.95, 0.78, 0.3],
};

export const brig = (name: string, length = 6, colours?: Partial<ShipColours>) => scaled(brigSpec, length, name, colours);
export const sloop = (name: string, length = 4.5, colours?: Partial<ShipColours>) => scaled(sloopSpec, length, name, colours);
export const galleon = (name: string, length = 8, colours?: Partial<ShipColours>) => scaled(galleonSpec, length, name, colours);
