// The pose pass on the GPU (docs/gpu_native.md, phase 1), on real scenes: every table the pose stages fill equals the
// CPU reading of the same program, and no table is left on the CPU unless it is listed here with its reason.
import { beforeAll, expect, test } from "bun:test";
import type { Artefact, View } from "../src/artefact.ts";
import { compile } from "../src/compile/index.ts";
import { resolveCamera } from "../src/cli/cameras.ts";
import { createHost, viewState, type GpuHost } from "../src/host/host.ts";
import { headlessDevice } from "../src/host/headless.ts";
import serpent from "../examples/serpent.ts";
import crab from "../examples/bosses/reefback_titan.ts";

/**
 * Tables these scenes may fill on the CPU, by name, with why. Empty: every table of the serpent and the crab is a map or
 * a scan. A table that falls back to `cpu` (a new hand-written fill, or a map that a `cpu` table reads) fails here.
 */
const ALLOWED_CPU: Readonly<Record<string, string>> = {};

/**
 * Relative tolerance: f32 on the GPU against f64 rounded to f32 on the CPU, relative to max(|cpu|, 1) (every table holds
 * world positions, unit vectors, radii and fractions, whose scale is about 1 or more). It caught the last station's m
 * coming out under 1 on the GPU, which a round tip turned into a radius of 1.5e-4 against an exact 0 (src/map/sweep.ts,
 * `stationM`).
 */
const TOLERANCE = 1e-4;

let host: GpuHost;
beforeAll(async () => { host = createHost(await headlessDevice()); });

const scenes: readonly { readonly name: string; readonly a: () => Artefact; readonly view: string }[] = [
  { name: "serpent", a: () => compile(serpent), view: "three" },
  { name: "crab", a: () => compile(crab), view: "game" },
];

for (const s of scenes) {
  // Catches: any disagreement between the WGSL a program compiles to and its JavaScript twin (operator semantics, a
  // scan's state carried wrongly, a run written at the wrong offset, a level scheduled before a table it reads, a
  // `writeBuffer` landing after the dispatch that reads it). Two times, so a table that ignores time is not a pass.
  test(`${s.name}: every GPU-filled table equals its CPU reading`, async () => {
    const a = s.a();
    const loaded = await host.load(a);
    for (const time of [1, 2.37]) {
      const view: View = { camera: resolveCamera(a, s.view), width: 64, height: 40, time };
      const gpu = await loaded.readTables(view);
      const cpu = a.pose(viewState(a, view));
      const bad: string[] = [];
      for (const t of a.tables) {
        if (t.fill.kind === "cpu") continue;
        const g = gpu[t.buffer]!, c = cpu[t.buffer]!;
        let worst = 0, at = -1;
        for (let i = t.offset * 4; i < (t.offset + t.vec4s) * 4; i++) {
          const err = Math.abs(g[i]! - c[i]!) / Math.max(Math.abs(c[i]!), 1);
          if (!(err <= worst)) { worst = err; at = i; }
        }
        if (!(worst <= TOLERANCE)) bad.push(`${t.name} (${t.fill.kind}) at float ${at - t.offset * 4}: gpu ${g[at]} cpu ${c[at]} (relative ${worst.toExponential(2)})`);
      }
      expect(bad).toEqual([]);
    }
    loaded.destroy();
  });

  // Catches: a table quietly falling back to a CPU fill every frame (the cost this phase removes) without anyone
  // deciding it should.
  test(`${s.name}: no table is filled on the CPU unless listed with its reason`, () => {
    const a = s.a();
    const unlisted = a.tables.filter((t) => t.fill.kind === "cpu" && !(t.name in ALLOWED_CPU)).map((t) => `${t.name}: ${t.fill.kind === "cpu" ? t.fill.why : ""}`);
    expect(unlisted).toEqual([]);
  });
}
