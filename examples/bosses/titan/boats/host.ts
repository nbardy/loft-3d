// The boats placed by the host: a game passes each boat's transform every frame and Loft draws it there, except while
// the crab holds the first one (then it is in the claw's socket). Inputs, per boat (`boat1`, `boat2`):
//   <boat>.pose.at       world (x, y, z) of the boat's origin, its waterline amidships
//   <boat>.pose.heading  radians from +x toward +z
//   <boat>.pose.pitch    radians, bow up
//   <boat>.pose.heel     radians, to starboard
// Their defaults are where the show starts each boat, level on still water.

import { hosted, input, pose } from "../../../../src/index.ts";
import type { BoatsOption } from "../slots.ts";

export const host: BoatsOption = {
  about: "the host places the boats: a pose input per boat, drawn where the game says",
  placer: (boat, start) => hosted(pose({
    at: input(`${boat}.pose.at`, "vec3", [start.at[0], 0, start.at[1]]),
    heading: input(`${boat}.pose.heading`, "f32", [start.heading]),
    pitch: input(`${boat}.pose.pitch`, "f32", [0]),
    heel: input(`${boat}.pose.heel`, "f32", [0]),
  })),
};
