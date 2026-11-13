// The views tools/triangles.ts measures and tests/detail.gpu.test.ts compares: each scene's game camera (or one
// like it) and a close-up.
import type { Camera } from "../src/artefact.ts";

export const VIEWS: Readonly<Record<string, Readonly<Record<string, Camera>>>> = {
  "examples/serpent.ts": {
    game: { kind: "perspective", eye: [16, 34, 22], target: [0, 1, 0], fovY: 0.6 },
    close: { kind: "perspective", eye: [7, 3.2, 6.5], target: [3, 1.6, 0], fovY: 0.55 },
  },
  "examples/brig.ts": {
    game: { kind: "perspective", eye: [-14, 32, 22], target: [0, 2, 0], fovY: 0.6 },
    close: { kind: "perspective", eye: [7, 9, 8], target: [-1, 8, 0], fovY: 0.6 },
  },
  "examples/islandback.ts": {
    game: { kind: "perspective", eye: [16, 34, 22], target: [0, 1, 1], fovY: 0.6 },
    close: { kind: "perspective", eye: [13, 7.5, 4.5], target: [2.5, 2.8, 0.6], fovY: 0.55 },
  },
  "examples/scenes/maelstrom.ts": {
    game: { kind: "perspective", eye: [-32, 34, 2], target: [3, 1, 5], fovY: 0.66 },
    close: { kind: "perspective", eye: [11, 16, 30], target: [5, 4, 9], fovY: 0.55 },
  },
};

