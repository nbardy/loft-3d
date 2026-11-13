// Best-case milliseconds per frame for examples/storm.ts at 1280x800, per camera: drawn into a texture and waited for
// on the GPU (what a real-time host pays), and the same with the pixels read back (what `loft render` pays). Best case
// because the machine is shared: only the minimum over many frames says what the work costs. Times are spread over a
// few seconds so the flashes and the bolt are sometimes on. `bun tools/storm_bench.ts [frames] [view,view,...]`.
import { compile } from "../src/index.ts";
import { headlessDevice } from "../src/host/headless.ts";
import { COLOR_FORMAT, createHost } from "../src/host/index.ts";
import storm from "../examples/storm.ts";

const N = Number(process.argv[2] ?? 30);
const views = (process.argv[3] ?? "three,front,side,low,edge").split(",");
const artefact = compile(storm);
const device = await headlessDevice();
const loaded = await createHost(device).load(artefact);
const target = device.createTexture({ size: [1280, 800], format: COLOR_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
for (const v of views) {
  const camera = artefact.cameras[v];
  if (!camera) throw new Error(`storm has no camera "${v}"`);
  const best = { pose: Infinity, readback: Infinity, drawn: Infinity };
  for (let i = 0; i < N; i++) {
    const view = { camera, width: 1280, height: 800, time: 0.5 + (i % 15) * 0.37 };
    let t0 = performance.now();
    const { ms } = await loaded.frameTimed(view);
    best.readback = Math.min(best.readback, performance.now() - t0);
    best.pose = Math.min(best.pose, ms.pose);
    t0 = performance.now();
    await loaded.draw(view, target);
    await device.queue.onSubmittedWorkDone();
    best.drawn = Math.min(best.drawn, performance.now() - t0);
  }
  console.log(`${v.padEnd(6)} best of ${N}: ${best.drawn.toFixed(1)} ms drawn, ${best.readback.toFixed(1)} ms with readback (pose ${best.pose.toFixed(2)} ms)`);
}
target.destroy();
loaded.destroy();
process.exit(0);
