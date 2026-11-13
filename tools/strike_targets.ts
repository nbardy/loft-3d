// The bite's arming frame for several ship positions, side by side: only the `ship.at` input changes, and the hit
// shape, the posed body and the telegraph all follow it. `bun tools/strike_targets.ts out/strike/targets.webp`.
import { compile } from "../src/index.ts";
import { headlessDevice } from "../src/host/headless.ts";
import { createHost } from "../src/host/index.ts";
import { contactSheet, writeWebp } from "../src/cli/image.ts";
import strike from "../examples/strike.ts";

const out = process.argv[2] ?? "out/strike/targets.webp";
const ships = [[14.5, 1.5], [13.2, -2.6], [15.6, 4.2]] as const;
const artefact = compile(strike);
const loaded = await createHost(await headlessDevice()).load(artefact);
const frames = [];
// Just before arming (2.4 s is the one-frame flash, which hides the marker under its own fill).
for (const camera of [artefact.cameras.bite, artefact.cameras.top]) {
  for (const at of ships) {
    frames.push({ width: 960, height: 600, rgba: await loaded.frame({ camera: camera!, width: 960, height: 600, time: 2.39, inputs: { "ship.at": at } }) });
  }
}
loaded.destroy();
writeWebp(out, contactSheet(frames));
console.log(`wrote ${out}: ship.at = ${ships.map((s) => `[${s.join(", ")}]`).join(", ")} (rows: bite camera, top)`);
