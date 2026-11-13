import type { Artefact, Camera } from "../artefact.ts";

/** Fallbacks frame the origin; a scene's own named camera always wins. */
export const FALLBACK_CAMERAS: Readonly<Record<string, Camera>> = {
  front: { kind: "perspective", eye: [0, 3, 18], target: [0, 1, 0], fovY: 0.6 },
  side: { kind: "perspective", eye: [18, 3, 0], target: [0, 1, 0], fovY: 0.6 },
  top: { kind: "orthographic", eye: [0, 30, 0.001], target: [0, 0, 0], height: 24 },
  three: { kind: "perspective", eye: [-14, 9, -13], target: [0, 1, 0], fovY: 0.6 },
};

export function resolveCamera(artefact: Pick<Artefact, "cameras">, name: string): Camera {
  const own = artefact.cameras[name] ?? FALLBACK_CAMERAS[name];
  if (!own) throw new Error(`no camera "${name}": the scene names [${Object.keys(artefact.cameras).join(", ")}], defaults are [${Object.keys(FALLBACK_CAMERAS).join(", ")}]`);
  return own;
}
