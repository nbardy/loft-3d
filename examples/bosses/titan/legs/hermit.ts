// A hermit's legs (docs/art_direction/DIRECTION.md, Round 5, "The hermit"): the base legs, worn as a hermit wears them.
// A hermit's abdomen and its last walking legs live in the shell; what shows are the legs that leave through the
// shell's mouth. So the front three pairs are drawn, their roots moved forward along the flank to clear the lip's
// sides and their feet fanned forward and out; the rearmost pair stays in the rig's footing (its feet still stand and
// re-plant, unseen) and is not drawn: it is inside the shell.

import type { LegsOption } from "../slots.ts";
import { banded } from "./base.ts";

export const hermit: LegsOption = {
  about: "the base legs worn by a hermit: three pairs fanned forward from under its shell's lip, the rearmost pair inside the shell",
  numbers: {
    // Roots 0.4 to 1.2 forward of the base's (3.2, 2.0, 0.8): the third pair's thigh stays ahead of the lip's flank. The
    // fourth root and foot are the base's, not drawn.
    legRoots: [3.6, 2.8, 2.0, -0.4],
    // Feet at 46, 64 and 80 degrees from ahead (the base's 50, 67, 85 and 106): the fan swings forward with the roots.
    legFeet: [[7.2, 7.4], [4.6, 9.4], [1.8, 10.0], [-2.6, 9.0]],
  },
  draw: (rig) => banded(rig, 3),
};
