// The crab (TURN_VARIANT, default the bruiser) with more cameras than its design has: the paint-overs' four round it
// (frontRight, backRight, backLeft, frontLeft: docs/art_direction/crab_round5/), a stern view that holds the whole tail
// coast (the design's `back` crops it), two close-ups (the join of plates, beach and shelf; the light's base) and a
// plan. A scene module for `loft render`; not part of the design. `tools/terraces_review.sh` drives it.
import { design } from "../examples/bosses/reefback_titan.ts";
import { parseVariantAsk } from "../src/design.ts";
import type { Camera } from "../src/artefact.ts";

const built = design.build(design.resolve(parseVariantAsk(process.env.TURN_VARIANT ?? "bruiser")));
const round = (deg: number): Camera => {
  const a = (deg * Math.PI) / 180;
  return { kind: "perspective", eye: [-1 + 30 * Math.cos(a), 17, 30 * Math.sin(a)], target: [-1, 1.8, 0], fovY: 0.6 };
};
export default { ...built.scene, cameras: {
  ...built.scene.cameras,
  frontRight: round(40), backRight: round(140), backLeft: round(220), frontLeft: round(320),
  stern: { kind: "perspective", eye: [-24, 15, 6], target: [-3.5, 1.2, 0.5], fovY: 0.5 },
  join: { kind: "perspective", eye: [-9, 4.5, 12.5], target: [-3.6, 0.8, 2.6], fovY: 0.5 },
  lightBase: { kind: "perspective", eye: [-19, 5.5, 1.5], target: [-8.3, 1.6, -3.0], fovY: 0.5 },
  above: { kind: "orthographic", eye: [-3, 50, 0.001], target: [-3, 0, 0], height: 22 },
} };
