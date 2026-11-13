// "No visible change", measured: the default level of detail against every grid at its authored density
// (`cellPixels: 0`), on the three scenes whose triangle counts prompted it, from a high game camera and close up.
import { beforeAll, expect, test } from "bun:test";
import { createHost, type GpuHost } from "../src/host/index.ts";
import { headlessDevice } from "../src/host/headless.ts";
import { compile, type Scene } from "../src/index.ts";
import { VIEWS } from "../tools/triangle_views.ts";
import { difference } from "../tools/picdiff.ts";

let host: GpuHost;
beforeAll(async () => { host = createHost(await headlessDevice()); });

// Catches: a level rule or a bound that lets bodies go visibly coarse (faceted silhouettes, smeared paint, moved
// waterlines and foam) while the triangle counts look good. Measured 2026-11-11 at the default 7 px: worst mean
// absolute difference 0.082 (of 255) and 0.24% of pixels differing by more than 16, both islandback from the game
// camera (the legs' knees shade a little differently on a coarser grid). Bounds: 3x those.
test.each(["examples/serpent.ts", "examples/brig.ts", "examples/islandback.ts"])("%s at the default target differs from full density by less than the bound", async (file) => {
  const scene = (await import(`../${file}`)).default as Scene;
  const loaded = await host.load(compile(scene));
  for (const [name, camera] of Object.entries(VIEWS[file]!)) {
    const view = { camera, width: 1280, height: 800, time: 1 };
    const full = await loaded.frameTimed({ ...view, cellPixels: 0 });
    const lod = await loaded.frameTimed(view);
    const d = difference({ ...view, rgba: full.pixels }, { ...view, rgba: lod.pixels });
    expect([name, d.mean < 0.25, d.over16 < 0.0075]).toEqual([name, true, true]);
    expect(lod.drawn.triangles).toBeLessThanOrEqual(full.drawn.triangles);
  }
  loaded.destroy();
}, 300000);
