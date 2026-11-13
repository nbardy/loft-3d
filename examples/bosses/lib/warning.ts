// RECIPE: the warning marker in the woodblock print's palette, for every boss's `telegraph`. Copy it and edit it; it
// imports only the library's public entry.
//
// What it makes: a `TelegraphStyle` (the library's `telegraph` draws it). The telegraph's fill is translucent (its alpha
// throbs and grows toward arming). A red or brick fill at partial alpha over the indigo sea printed as a muddy maroon,
// which is not an ink of this print (seen in the Wyrm, the Reefback, Thundermaw and the Tithe Fleet, 2026-11-11).
// Filled with the print's pale blue instead, any alpha over the indigo is still a blue of the print; the cream teeth
// and the key-black line round them are opaque.
//
// Parameters: the inks (`WOODBLOCK_PALETTE`) and the fill's alpha range.
// What it cannot do: anything but colours; the marker's shape, timing and throb are the telegraph's.
// Copying it: for another style, take that style's palette and choose the fill so that every alpha over your ground
// is still a colour of the style (over a pale ground, a dark fill; over a dark one, a pale one).

import { WOODBLOCK_PALETTE, type TelegraphStyle } from "../../../src/index.ts";

export const PRINT_WARNING: Partial<TelegraphStyle> = {
  fill: WOODBLOCK_PALETTE.pale, fillFrom: 0.35, fillTo: 0.9,
  bone: WOODBLOCK_PALETTE.cream, ink: WOODBLOCK_PALETTE.black, flash: WOODBLOCK_PALETTE.cream,
};
