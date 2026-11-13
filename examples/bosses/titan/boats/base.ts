// The boats placed by Loft's stand-ins: afloat where their inputs say, the first thrown on a ballistic flight and landed,
// the second drifting from the ring's impulse. The scene plays on its own.

import { STAND_IN } from "../../../../src/index.ts";
import type { BoatsOption } from "../slots.ts";

export const base: BoatsOption = { about: "Loft's stand-ins place the boats: the scene plays on its own", placer: () => STAND_IN };
