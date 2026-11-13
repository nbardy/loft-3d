// The same lantern standing on nothing: no ground, no cast shadow, the style's sky all round (its horizon colour below
// the horizon). Everything else is the first scene's (examples/first/lantern.ts).
import { nothing, scene, toon } from "../../src/index.ts";
import { cameras, lantern, SUN } from "./lantern.ts";

export default scene({
  ground: nothing,
  things: [lantern],
  style: toon(),
  sun: SUN,
  cameras,
});
