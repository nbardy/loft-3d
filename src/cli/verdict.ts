// How a command ends: every failure classified once, here, into one of a closed list of verdicts, and each verdict
// mapped to one exit code and one last line on stderr that a script can match (`loft: <kind>: ...`). README.md
// "Exit codes" is the table.
import { relative } from "node:path";
import { EnvironmentError, LoadError, SceneError } from "../errors.ts";
import { DesignError } from "../design.ts";
import { UsageError, USAGE } from "./args.ts";

export type Verdict =
  /** The command line asked for something wrong or absent (a flag, a camera, a variant, an input, a style). */
  | { readonly kind: "usage"; readonly message: string }
  /** The scene module did not load as a scene: a syntax or import error, a throw at its top level, the wrong exports. */
  | { readonly kind: "load"; readonly message: string }
  /** The scene was refused by a constructor or the compiler with a typed error: the scene must change. */
  | { readonly kind: "scene"; readonly message: string; readonly site: string | undefined }
  /** The scene drew or built, and one of its checks failed. */
  | { readonly kind: "check"; readonly message: string }
  /** Not the scene: the GPU, the WebGPU binding, a missing tool. Already retried where retrying can help. */
  | { readonly kind: "environment"; readonly message: string }
  /** An untyped error inside Loft: a bug in Loft, or a scene mistake no constructor catches yet. */
  | { readonly kind: "internal"; readonly message: string; readonly stack: string };

/** `loft check` found failing checks (and every variant built). */
export class ChecksFailed extends Error {
  override readonly name = "ChecksFailed";
}

const SRC = new URL("..", import.meta.url).pathname;

/** The first stack frame outside Loft's own source: the line of the user's file a constructor was called from. */
export function siteOf(stack: string | undefined): string | undefined {
  for (const line of (stack ?? "").split("\n").slice(1)) {
    const m = line.match(/\(?((?:\/|[A-Za-z]:)[^()]*?):(\d+):(\d+)\)?\s*$/);
    if (m && !m[1]!.startsWith(SRC) && !m[1]!.includes("/node_modules/")) return `${relative(process.cwd(), m[1]!)}:${m[2]}`;
  }
  return undefined;
}

/** The library's typed errors that are the scene's fault, loaded only when an error needs classifying. */
async function isLibraryRefusal(e: Error): Promise<boolean> {
  const [lib, host, field] = await Promise.all([import("../index.ts"), import("../host/host.ts"), import("../draw/field.ts")]);
  // DerivativeError is left out on purpose: a missing derivative rule is Loft's gap, not the scene's (internal).
  const kinds = [lib.FieldSafetyError, field.FieldScheduleError, lib.GroundError, lib.TableBudgetError, lib.BendError, lib.PendulumError, lib.RestlessError, lib.ExpressionError, lib.StruckError, lib.RoutineError, host.NotDataError];
  return kinds.some((k) => e instanceof k);
}

/** A refusal the library raised on purpose, with a message meant for the scene's writer. */
export async function isTypedRefusal(e: unknown): Promise<boolean> {
  return e instanceof SceneError || e instanceof DesignError || e instanceof LoadError || (e instanceof Error && await isLibraryRefusal(e));
}

/** The boundary: whatever was thrown, as a verdict. */
export async function verdictOf(e: unknown): Promise<Verdict> {
  if (!(e instanceof Error)) return { kind: "internal", message: String(e), stack: "" };
  if (e instanceof UsageError) return { kind: "usage", message: e.message };
  if (e instanceof DesignError) {
    // Asking for a variant, slot or option the design lacks is the command's mistake; a design that contradicts
    // itself is the scene's.
    switch (e.kind) {
      case "syntax": case "unknown-variant": case "unknown-slot": case "unknown-option": return { kind: "usage", message: e.message };
      case "unknown-number": case "conflict": return { kind: "scene", message: e.message, site: siteOf(e.stack) };
    }
  }
  if (e instanceof LoadError) return { kind: "load", message: e.message };
  if (e instanceof SceneError) return { kind: "scene", message: e.message, site: siteOf(e.stack) };
  if (e instanceof EnvironmentError) return { kind: "environment", message: e.message };
  if (e instanceof ChecksFailed) return { kind: "check", message: e.message };
  if (await isLibraryRefusal(e)) return { kind: "scene", message: e.message, site: siteOf(e.stack) };
  return { kind: "internal", message: `${e.name === "Error" ? "" : `${e.name}: `}${e.message}`, stack: e.stack ?? "" };
}

const CODE: Readonly<Record<Verdict["kind"], number>> = { internal: 1, usage: 2, load: 3, scene: 4, check: 5, environment: 6 };
const LINE: Readonly<Record<Verdict["kind"], string>> = {
  internal: "internal (a bug in Loft, or a scene mistake no constructor catches yet)",
  usage: "usage",
  load: "load",
  scene: "scene",
  check: "check",
  environment: "environment (not the scene's fault)",
};

/**
 * A message as its last line and the rest. A first line ending in ":" only introduces its reason (the GPU's
 * "pipeline creation failed:" then Dawn's text), so the reason is pulled up onto it: the last line must say why.
 */
export function headed(message: string): [string, ...string[]] {
  const [first, ...rest] = message.split("\n");
  const k = rest.findIndex((l) => l.trim() !== "");
  if (!first!.trimEnd().endsWith(":") || k < 0) return [first!, ...rest];
  return [`${first!.trimEnd()} ${rest[k]!.trim()}`, ...rest.slice(k + 1)];
}

/** Prints the verdict (the detail, then one last line) and exits with its code. */
export function exitWith(v: Verdict): never {
  const [head, ...rest] = headed(v.message);
  switch (v.kind) {
    case "usage": console.error(USAGE); break;
    case "internal": console.error(v.stack); break;
    case "scene": if (v.site !== undefined) rest.push(`  at ${v.site}`); break;
    case "load": case "check": case "environment": break;
  }
  if (rest.length > 0) console.error(`${head}\n${rest.join("\n")}`);
  console.error(`loft: ${LINE[v.kind]}: ${head}${v.kind === "scene" && v.site !== undefined ? ` (at ${v.site})` : ""}`);
  process.exit(CODE[v.kind]);
}
