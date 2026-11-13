// The two kinds of failure a caller must tell apart, as types. A leaf module: it imports nothing, so any constructor
// can raise these without an import cycle. The CLI maps them to exit codes in src/cli/verdict.ts.

/**
 * A mistake in the scene as written, raised by the constructor where it was made: what was given, what was expected,
 * and the smallest change that fixes it, with the user's own thing named in `where` (`draw.surface "ball"`).
 */
export class SceneError extends Error {
  override readonly name = "SceneError";
  constructor(readonly where: string, readonly given: string, readonly expected: string, readonly fix: string) {
    super(`${where}: given ${given}; expected ${expected}. Fix: ${fix}`);
  }
}

/** The scene module could not be loaded as a scene: it failed to import, or exports the wrong shape. */
export class LoadError extends Error {
  override readonly name = "LoadError";
}

/**
 * Not the scene's fault: the GPU, the WebGPU binding, or a tool the command needs (cwebp, ffmpeg). `transient` says
 * whether trying again on a fresh device can help (a shader or pipeline that failed to build; not a missing tool).
 */
export class EnvironmentError extends Error {
  override readonly name = "EnvironmentError";
  constructor(message: string, readonly transient: boolean) {
    super(message);
  }
}

/** A short, one-line rendering of a value a user passed, for "given ..." (strings quoted, arrays bracketed). */
export function shown(x: unknown): string {
  if (x === undefined) return "undefined";
  if (typeof x === "string") return JSON.stringify(x);
  if (Array.isArray(x)) return `[${x.map(shown).join(", ")}]`;
  if (typeof x === "function") return "a function";
  if (typeof x === "object" && x !== null) return "an object";
  return String(x);
}
