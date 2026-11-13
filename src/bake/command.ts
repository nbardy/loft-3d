// `loft bake`: the command body, kept out of src/cli/main.ts so that file only dispatches.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Command } from "../cli/args.ts";
import type { Scene } from "../scene.ts";
import { summary, writeGlb } from "./gltf.ts";
import { bakeScene } from "./mesh.ts";

export async function bake(cmd: Extract<Command, { kind: "bake" }>): Promise<void> {
  const exported = ((await import(resolve(cmd.path))) as { default?: unknown }).default;
  if (exported === undefined) throw new Error(`${cmd.path} has no default export (it must export a scene)`);
  const t0 = performance.now();
  const baked = bakeScene(exported as Scene, { time: cmd.time, density: cmd.density });
  for (const line of summary(baked)) console.log(line);
  for (const s of baked.skipped) console.log(`skipped ${s.name}: ${s.reason}`);
  const glb = writeGlb(baked);
  mkdirSync(dirname(resolve(cmd.out)), { recursive: true });
  writeFileSync(cmd.out, glb);
  const tris = baked.bodies.reduce((n, b) => n + b.indices.length / 3, 0);
  console.log(`wrote ${cmd.out}  ${glb.byteLength} bytes, ${baked.bodies.length} bodies, ${tris} triangles, t=${cmd.time}  (${(performance.now() - t0).toFixed(0)} ms)`);
}
