// mistake: a scene with no things field at all
import { scene } from "../../../src/index.ts";
import { cameras, style, water } from "./_parts.ts";

export default scene({ ground: water, style, sun: [0.3, 0.8, 0.4], cameras } as never);
