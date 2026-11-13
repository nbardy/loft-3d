// Best-case milliseconds per frame for examples/strike.ts at 1280x800, with and without the smear and the wake.
// Best case because the machine is shared: only the minimum over many frames says what the work costs.
// `bun tools/strike_bench.ts [frames]`.
import { compile, scene } from "../src/index.ts";
import { headlessDevice } from "../src/host/headless.ts";
import { createHost } from "../src/host/index.ts";
import strike from "../examples/strike.ts";

const N = Number(process.argv[2] ?? 40);
const derived = (name: string) => ["sky", "sea", "shadows"].includes(name);
const variants = {
  "full": strike.things.filter((t) => !derived(t.name)),
  "smear only": strike.things.filter((t) => !derived(t.name) && !/^wake_/.test(t.name)),
  "wake only": strike.things.filter((t) => !derived(t.name) && !/^smear_/.test(t.name)),
  "no smear, no wake": strike.things.filter((t) => !derived(t.name) && !/^(smear|wake)_/.test(t.name)),
};
const host = createHost(await headlessDevice());
for (const [label, things] of Object.entries(variants)) {
  const artefact = compile(scene({ ground: strike.ground, things, style: strike.style, sun: strike.sun, cameras: strike.cameras }));
  const loaded = await host.load(artefact);
  const best = { pose: Infinity, encode: Infinity, readback: Infinity, total: Infinity };
  for (let i = 0; i < N; i++) {
    // Times across the bite, where the smear is showing and the wake is long.
    const time = 2.15 + (i % 10) * 0.02;
    const t0 = performance.now();
    const { ms } = await loaded.frameTimed({ camera: artefact.cameras.three!, width: 1280, height: 800, time });
    const total = performance.now() - t0;
    best.pose = Math.min(best.pose, ms.pose); best.encode = Math.min(best.encode, ms.encode); best.readback = Math.min(best.readback, ms.readback); best.total = Math.min(best.total, total);
  }
  loaded.destroy();
  console.log(`${label.padEnd(18)} best of ${N}: total ${best.total.toFixed(2)} ms (pose ${best.pose.toFixed(2)}, encode ${best.encode.toFixed(2)}, gpu+readback ${best.readback.toFixed(2)})  ${artefact.stats.maxTriangles} triangles, ${artefact.stats.draws} draws, ${artefact.stats.stations} stations`);
}
