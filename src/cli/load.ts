// The only place the CLI touches the other agents' modules. They are imported dynamically, by URL, so this file
// compiles before they exist and fails with a message naming the missing export if the contract drifts.
import { UsageError } from "./args.ts";
import type { Artefact } from "../artefact.ts";
import type { GpuHost } from "../host/host.ts";
import type { LightChoice, SceneSource, StyleChoice } from "./args.ts";

async function importFrom<T>(rel: string): Promise<T> {
  return (await import(new URL(rel, import.meta.url).href)) as T;
}

function need<T>(mod: Record<string, unknown>, name: string, from: string): T {
  const v = mod[name];
  if (v === undefined) throw new Error(`${from} does not export "${name}" (the CLI expects it)`);
  return v as T;
}

export async function loadArtefact(source: SceneSource): Promise<Artefact> {
  switch (source.kind) {
    case "fixture": {
      const mod = await importFrom<Record<string, unknown>>("../host/fixture.ts");
      return need<Artefact>(mod, "fixture", "src/host/fixture.ts");
    }
    case "file": {
      // A design draws the chosen variant (its base when none is given); a plain scene draws its default export.
      const { chosenAt } = await import("./variant.ts");
      const { scene } = await chosenAt(source.path, source.variant);
      const index = await importFrom<Record<string, unknown>>("../index.ts");
      return need<(s: unknown) => Artefact>(index, "compile", "src/index.ts")(await styled(scene, source.style, source.light));
    }
  }
}

/**
 * The scene in the chosen style (`--style`: its own, or the named one swapped in without touching the scene), lit as
 * chosen (`--light`: as that style is, or one of its named lightings).
 */
export async function styled(scene: unknown, style: StyleChoice, light: LightChoice): Promise<unknown> {
  return relit(await restyle(scene, style), light);
}

async function restyle(scene: unknown, style: StyleChoice): Promise<unknown> {
  switch (style.kind) {
    case "scene": return scene;
    case "named": {
      const styles = await importFrom<Record<string, unknown>>("../style/index.ts");
      const names = need<readonly string[]>(styles, "STYLE_NAMES", "src/style/index.ts");
      if (!names.includes(style.name)) throw new UsageError(`--style "${style.name}": no such style (styles: ${names.join(", ")})`);
      const named = need<(n: string) => unknown>(styles, "styleNamed", "src/style/index.ts")(style.name);
      return need<(s: unknown, st: unknown) => unknown>(styles, "withStyle", "src/style/index.ts")(scene, named);
    }
  }
}

async function relit(scene: unknown, light: LightChoice): Promise<unknown> {
  switch (light.kind) {
    case "scene": return scene;
    case "named": {
      const styles = await importFrom<Record<string, unknown>>("../style/index.ts");
      return need<(s: unknown, n: string) => unknown>(styles, "withLight", "src/style/index.ts")(scene, light.name);
    }
  }
}

/** A host drawing into an offscreen texture on bun's headless WebGPU. */
export async function headlessHost(): Promise<GpuHost> {
  const headless = await importFrom<Record<string, unknown>>("../host/headless.ts");
  const device = await need<() => Promise<GPUDevice>>(headless, "headlessDevice", "src/host/headless.ts")();
  const index = await importFrom<Record<string, unknown>>("../host/index.ts");
  return need<(d: GPUDevice) => GpuHost>(index, "createHost", "src/host/index.ts")(device);
}
