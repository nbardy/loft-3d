// Stormfront (toon, storm palette). The stormwing (examples/stormwing.ts) rides the leading edge of its own
// thunderhead, the cloud piled up behind it and its rain shaft trailing under it, while a brig runs before the wind
// ahead of them both. Lightning strikes the sea between hunter and prey every few seconds; sheet lightning flickers
// in the cloud between strikes. Seen from the game's high camera the cloud sits behind the creature (away from the
// eye), so the dark kite of the wings reads against the lit sea and the ship against the foam of the strike.
import {
  afterglow, bolt, boltFlash, draw, flare, glows, lt, max, medium, mul, rain, scene, sea, select, sheetFlash, skyFlash,
  splashes, cloud as cloudMass, toon, unionBox, blob, add, time, vec2, type Drawable,
} from "../../src/index.ts";
import { ship } from "../recipes/ship.ts";
import stormwing from "../stormwing.ts";
import { brig, PLAYER } from "./lib/fleet.ts";

// ---- named numbers ------------------------------------------------------------------------------------------------
const CLOUD = { at: [-12, 10, -10] as const, height: 14, width: 50, blobs: 210, seed: 4 };
const BOLT = { from: [-2, 15, -4] as const, to: [9, -0.3, 0] as const, every: 4, first: 1.2 };
const RAIN = { at: [-9, -7] as const, radius: 11, count: 7000 };
const SHIP_AT: [number, number] = [12, 5];
const SHIP_SPEED = 0.4;           // world units per second: running before the wind, along +x
const WIND: readonly [number, number] = [1, 0.15];
const FLASH: readonly [number, number, number] = [0.75, 0.85, 1.0];

const water = sea({
  swell: [
    { direction: [1, 0.15], length: 16, height: 0.55, speed: 1.6 },
    { direction: [0.3, 1], length: 6.5, height: 0.18, speed: 1.0, phase: 1.3 },
  ],
  foam: 0.4,
});

// ---- lightning ------------------------------------------------------------------------------------------------------
const strike = bolt({
  name: "fork", from: BOLT.from, to: BOLT.to, wander: 2.2, roughness: 0.1, levels: 7, branches: 5,
  schedule: { first: BOLT.first, every: BOLT.every, jitter: 0.25, seed: 9 }, segments: 96,
});
const cloudBox = {
  min: [CLOUD.at[0] - 12, CLOUD.at[1] + 2, CLOUD.at[2] - 9], max: [CLOUD.at[0] + 12, CLOUD.at[1] + 12, CLOUD.at[2] + 8],
} as const;
const sheet = sheetFlash({ first: 0.4, every: 1.7, jitter: 0.6, seed: 13 }, cloudBox, { power: 4, colour: FLASH, reach: 12 });

// ---- the storm: a thunderhead behind the creature, a rain shaft under it, haze on the water -------------------------
// A shelf of storm cloud rather than a lone tower: wide along the front, deep, low and dark-based, so from the high
// camera it fills the far side of the picture instead of standing up as a white puff.
const head = cloudMass({
  at: [...CLOUD.at], size: [CLOUD.width, CLOUD.height, CLOUD.width * 0.45],
  profile: [[0, 0.62], [0.2, 0.78], [0.55, 0.7], [0.8, 0.5], [1, 0.25]],
  blobs: CLOUD.blobs, turbulence: 0.35, billow: 0.12, drift: [0.25, 0, 0.05], density: 1.0, colour: [0.8, 0.83, 0.9],
  seed: CLOUD.seed, seconds: 30,
});
const shaft = [0, 1, 2].map((k) => blob({
  centre: [RAIN.at[0] + [0, 5, -4][k], CLOUD.at[1] * 0.45, RAIN.at[1] + [0, 3, 4][k]],
  radii: [4, CLOUD.at[1] * 0.55, 4], density: 0.03, colour: [0.4, 0.45, 0.52],
}));
const storm = medium("front", {
  puffs: [...head.puffs, ...shaft],
  banks: [],
  flashes: [boltFlash(strike, { power: 6, colour: FLASH, reach: 14, lift: 3 }), sheet.flash],
});
const cloud = draw.density("front", storm, {
  bounds: unionBox([head.bounds, { min: [-120, -1, -120], max: [120, 8, 120] }]),
  sun: [1.9, 1.85, 1.8], sky: 0.8, forward: 0.3, shadowing: 0.8, detail: { kind: "noise", amount: 1.4, scale: 2.2 }, haze: 0.001,
});
const veil = { kind: "medium", medium: storm } as const;
const channel = glows("forkCore", strike.strokes, {
  width: 0.06, halo: 16, colour: [0.45, 0.6, 1.0], core: [1, 1, 1],
  brightness: (i) => mul(strike.flash, select(lt(i, 0.5), 1, 0.5)), veil,
});
const embers = glows("forkAfter", strike.strokes, {
  width: 0.035, halo: 6, colour: [0.55, 0.3, 0.9], core: [0.85, 0.7, 1.0], brightness: () => mul(afterglow(strike.since, 0.35), 0.5), veil,
});
const contact = flare("forkFlare", strike.ground, { size: 0.35, halo: 12, colour: [0.5, 0.65, 1.0], core: [1, 1, 1], intensity: mul(strike.flash, 1.2), rays: 6, veil });
const inside = flare("cloudGlow", sheet.at, { size: 1.2, halo: 5, colour: [0.6, 0.7, 1.0], core: [0.9, 0.95, 1.0], intensity: mul(sheet.brightness, 0.8), rays: 0, veil });

const shower = {
  centre: RAIN.at, radius: RAIN.radius, top: CLOUD.at[1] + 1, count: RAIN.count, speed: 14, wind: [3.0, 0.6] as const,
  length: 0.9, width: 0.014, colour: [0.75, 0.8, 0.88] as const, opacity: 0.45, flash: max(strike.flash, sheet.brightness), seed: 5,
};
const drops = rain("downpour", shower);
const rings = splashes("ringlets", shower, { count: 2500, radius: 0.35, life: 0.6, colour: [0.85, 0.9, 0.95], opacity: 0.45 });

// ---- the hunter and the prey --------------------------------------------------------------------------------------
const derived = new Set(["sky", "sea", "shadows"]);
const creature: Drawable[] = stormwing.things.filter((t) => !derived.has(t.name));
const prey = ship(brig("runner", 6, PLAYER)).afloat(water, { at: vec2(add(SHIP_AT[0], mul(time, SHIP_SPEED)), SHIP_AT[1]), heading: 0.12, wind: WIND });

// ---- the scene ----------------------------------------------------------------------------------------------------
export default scene({
  ground: water,
  things: [...creature, ...prey, cloud, channel, embers, contact, inside, drops, rings,
    skyFlash("stormFlash", mul(max(strike.flash, mul(sheet.brightness, 0.4)), 0.16), FLASH)],
  style: toon({
    bands: 3, outline: 0.04,
    sky: { zenith: [0.16, 0.2, 0.3], horizon: [0.6, 0.64, 0.68] },
    water: { shallow: [0.24, 0.5, 0.54], deep: [0.08, 0.22, 0.3], foam: [0.92, 0.95, 0.98], shade: [0.03, 0.08, 0.14] },
    shadow: [0.4, 0.42, 0.62],
  }),
  sun: [0.3, 0.7, 0.65],
  cameras: {
    game: { kind: "perspective", eye: [18, 30, 25], target: [2.5, 3, 0], fovY: 0.7 },
    hero: { kind: "perspective", eye: [17, 2.5, -14], target: [2, 6, 0], fovY: 0.95 },
    close: { kind: "perspective", eye: [13, 8.5, 6], target: [4.4, 5.4, 0], fovY: 0.5 },
  },
});
