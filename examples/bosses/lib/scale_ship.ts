// RECIPE: the one small ship every boss picture carries for scale. Copy it and edit it.
// Uses: ../../scenes/lib/fleet.ts (sloop): the game-scale sloop; ../../recipes/ship.ts (ship); besides those, only the
// library's public entry.
//
// What it makes (docs/art_direction/DIRECTION.md: "each monster dwarfs a ship; every picture has one small ship with
// blue sails for scale"): the game's sloop (the recipe's `ship`) at 3.8 units, a warm brown hull, cream trim and team stripe, and
// sails in the print's blue. Each scene places it (`scaleShip.afloat`, or `afloatChart` when an attack targets it);
// what it is is decided here only.
//
// The blue has to print blue in every rule a boss prints by (the woodblock style's `Print`):
//  - `keys` (the Maelstrom Wyrm): the scene lists `SAIL` among its keys, so the cloth prints in SAIL's two inks;
//  - `overprint` (the Reefback Titan): the cloth prints as painted, its shadow side overprinted;
//  - `bands` (the Lamp, Thundermaw, the Tithe Fleet): the scene names SAIL to the rule (`print.bands({ named: { sail: SAIL } })`),
//    so the cloth prints in SAIL's inks and every other paint by value.
//
// Parameters: the length, the colours, the sail's inks. What it cannot do: be any ship but the sloop (see fleet.ts).
// Copying it: change the length first, so it reads as small beside your subject from your game's camera; then the cloth.

import { type Rgb } from "../../../src/index.ts";
import { ship, type ShipColours } from "../../recipes/ship.ts";
import { sloop } from "../../scenes/lib/fleet.ts";

/** Hull length, world units: small beside every monster, and still a ship from the strategy camera. */
export const SCALE_SHIP_LENGTH = 3.8;

/** The sailcloth: the paint, and the two inks it prints in (shadow side, lit side). */
export const SAIL = { key: [0.2, 0.4, 0.9], shadow: [0.14, 0.26, 0.6], lit: [0.26, 0.46, 0.86] } as const satisfies { key: Rgb; shadow: Rgb; lit: Rgb };

/** Wood, cream and black: no warm accent on the ship (the Lamp's yellow and the bosses' vermilion stay theirs). */
export const SCALE_SHIP_COLOURS: ShipColours = {
  hull: [0.45, 0.28, 0.14], bottom: [0.45, 0.28, 0.14], wale: [0.05, 0.05, 0.06], trim: [0.92, 0.87, 0.74],
  deck: [0.45, 0.28, 0.14], spar: [0.45, 0.28, 0.14], cloth: SAIL.key, rope: [0.05, 0.05, 0.06], team: [0.92, 0.87, 0.74],
};

export const scaleShip = ship(sloop("scaleShip", SCALE_SHIP_LENGTH, SCALE_SHIP_COLOURS));

/** A second ship of the same build under other cloth, for a scene that needs two (a function: most scenes need none). */
export const scaleShipNamed = (name: string, cloth: Rgb) => ship(sloop(name, SCALE_SHIP_LENGTH, { ...SCALE_SHIP_COLOURS, cloth }));
