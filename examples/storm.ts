// A thunderhead over the sea: a boiling tower of Gaussian puffs under a wide anvil, lightning inside it and a bolt to
// the water, a rain shaft beneath it ringing the sea, haze over the water and a fog bank toward the horizon, and the
// serpent (examples/serpent.ts) rising out of the sea under it for scale. Every soft thing is evaluated per pixel:
// the cloud and the fog are closed-form integrals along each view ray, the bolt and the flares are falloffs of
// distance, the rain is instanced from a hash.

import serpent from "./serpent.ts";
import {
  bank, bolt, boltFlash, draw, flare, glows, layer, medium, rain, scene, sea, sheetFlash, skyFlash, splashes,
  toon, unionBox, afterglow, blob, lt, max, mul, select, type Drawable,
} from "../src/index.ts";
import { thunderhead } from "./recipes/thunderhead.ts";

const S = {
  base: 10.5, height: 30, width: 46, blobs: 96,
  cloudAt: [-6, 0, -16] as const,
  boltFrom: [-1, 16, -11] as const, boltTo: [9, -0.3, -4] as const,
  rainAt: [-8, -15] as const, rainRadius: 8,
  sunLight: [2.1, 1.95, 1.75] as const, flashColour: [0.75, 0.82, 1.0] as const,
};

// ---- lightning: a bolt to the sea every 7 s, and sheet lightning inside the cloud in between ---------------------

const strike = bolt({
  name: "bolt", from: S.boltFrom, to: S.boltTo, wander: 2.5, roughness: 0.09, levels: 7, branches: 5,
  schedule: { first: 1.0, every: 7, jitter: 0.3, seed: 3 }, segments: 96,
});
const cloudBox = { min: [S.cloudAt[0] - 14, S.base + 3, S.cloudAt[2] - 10], max: [S.cloudAt[0] + 14, S.base + 18, S.cloudAt[2] + 8] } as const;
const sheet = sheetFlash({ first: 0.3, every: 2.3, jitter: 0.6, seed: 11 }, cloudBox, { power: 4, colour: S.flashColour, reach: 12 });

// ---- the medium: the thunderhead, the rain shaft's haze, haze on the water and a fog bank -----------------------

const head = thunderhead({ at: [S.cloudAt[0], S.base, S.cloudAt[2]], height: S.height, width: S.width, blobs: S.blobs, seed: 7, drift: [0.15, 0, 0.05], seconds: 60 });
// The shaft: tall, thin, grey veils hanging under the base, densest near the cloud.
const shaft = [0, 1, 2, 3].map((k) => blob({
  centre: [S.rainAt[0] + [0, 4, -3, 2][k], S.base * 0.45, S.rainAt[1] + [0, 2, 3, -4][k]],
  radii: [3.2, S.base * 0.55, 3.2], density: 0.035, colour: [0.42, 0.46, 0.54],
}));
const storm = medium("storm", {
  puffs: [...head.puffs, ...shaft, layer({ height: 0, thickness: 1.6, density: 0.01, colour: [0.36, 0.4, 0.47] })],
    // A fog bank rolling in from the west: fog beyond x = -45, a soft wall a few units thick.
  banks: [bank({ height: 0, thickness: 5, density: 0.05, colour: [0.3, 0.33, 0.4], edge: { through: [-45, 0], clear: [1, 0.25], softness: 4 } })],
  flashes: [boltFlash(strike, { power: 6, colour: S.flashColour, reach: 14, lift: 3 }), sheet.flash],
});
const cloud = draw.density("thunderhead", storm, {
  bounds: unionBox([head.bounds, { min: [-260, -1, -260], max: [260, 9, 260] }]),
  sun: S.sunLight, sky: 0.9, forward: 0.3, shadowing: 0.8, detail: { kind: "noise", amount: 2, scale: 1.5 }, haze: 0.004,
});

// ---- the bolt: a white-hot core in a blue halo while it flickers, a violet afterglow, a flare where it meets the sea

const channel = glows("boltCore", strike.strokes, {
  width: 0.05, halo: 16, colour: [0.45, 0.6, 1.0], core: [1, 1, 1],
  // The main channel at full strength, branches dimmer.
  brightness: (i) => mul(strike.flash, select(lt(i, 0.5), 1, 0.5)),
  veil: { kind: "medium", medium: storm },
});
const embers = glows("boltAfter", strike.strokes, {
  width: 0.03, halo: 6, colour: [0.55, 0.3, 0.9], core: [0.85, 0.7, 1.0],
  brightness: () => mul(afterglow(strike.since, 0.35), 0.5),
  veil: { kind: "medium", medium: storm },
});
const contact = flare("strikeFlare", strike.ground, { size: 0.3, halo: 12, colour: [0.5, 0.65, 1.0], core: [1, 1, 1], intensity: mul(strike.flash, 1.2), rays: 6, veil: { kind: "medium", medium: storm } });
const inside = flare("sheetGlow", sheet.at, { size: 1.2, halo: 5, colour: [0.6, 0.7, 1.0], core: [0.9, 0.95, 1.0], intensity: mul(sheet.brightness, 0.8), rays: 0, veil: { kind: "medium", medium: storm } });

// ---- rain and the rings it makes ----------------------------------------------------------------------------------

const shower = {
  centre: S.rainAt, radius: S.rainRadius, top: S.base + 1, count: 9000, speed: 14, wind: [2.6, 1.0] as const,
  length: 0.9, width: 0.012, colour: [0.72, 0.78, 0.86] as const, opacity: 0.4, flash: max(strike.flash, sheet.brightness), seed: 5,
};
const drops = rain("rain", shower);
const rings = splashes("rings", shower, { count: 3000, radius: 0.35, life: 0.6, colour: [0.85, 0.9, 0.95], opacity: 0.45 });

// ---- the serpent, as examples/serpent.ts draws it ------------------------------------------------------------------

const derived = new Set(["sky", "sea", "shadows"]);
const creature: Drawable[] = serpent.things.filter((t) => !derived.has(t.name));

export default scene({
  ground: sea({
    swell: [
      { direction: [1, 0.3], length: 14, height: 0.5, speed: 1.3 },
      { direction: [-0.3, 1], length: 6.5, height: 0.18, speed: 0.9, phase: 1.3 },
    ],
  }),
  // Order within the transparent phase is stated: the cloud first (it integrates up to the opaque scene), then what
  // is seen through it (the glows carry their own veil), then the rain over everything, then the sky's flash.
  things: [...creature, cloud, channel, embers, contact, inside, drops, rings, skyFlash("skyFlash", mul(max(strike.flash, mul(sheet.brightness, 0.4)), 0.16), S.flashColour)],
  style: toon({
    bands: 3, outline: 0.04,
    sky: { zenith: [0.12, 0.15, 0.24], horizon: [0.52, 0.56, 0.62] },
    water: { shallow: [0.12, 0.26, 0.3], deep: [0.02, 0.07, 0.12], foam: [0.9, 0.94, 0.97], shade: [0.01, 0.04, 0.08] },
    shadow: [0.36, 0.36, 0.6],
  }),
  sun: [-0.55, 0.5, 0.65],
  cameras: {
    three: { kind: "perspective", eye: [36, 7, 40], target: [-3, 14, -10], fovY: 0.9 },
    front: { kind: "perspective", eye: [48, 5, 2], target: [0, 13, -10], fovY: 0.85 },
    side: { kind: "perspective", eye: [2, 4, 56], target: [-3, 14, -12], fovY: 0.85 },
    top: { kind: "orthographic", eye: [-3, 80, 0.001], target: [-3, 0, 0], height: 80 },
    edge: { kind: "perspective", eye: [10, 21, 0], target: [-6, 24, -16], fovY: 0.9 },
    low: { kind: "perspective", eye: [20, 2.2, 12], target: [0, 9, -8], fovY: 1.0 },
  },
});
