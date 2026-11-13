// Host inputs from the command line: `--input name=value` (fixed for every frame) and `--sweep name=a..b` (moved
// evenly from a to b across the frames of a `frames` sheet or a `clip`). A value is a scalar or comma-separated
// components for a vector input. Parsing is here (args.ts calls it); `viewInputs` is what each frame hands the host.
//
// Names are checked against the artefact before anything is drawn (`checkInputs`), so a typo fails by name with the
// list of what the scene declares, instead of rendering defaults.

import type { Artefact } from "../artefact.ts";
import { UsageError } from "./args.ts";

export type InputValues = Readonly<Record<string, readonly number[]>>;
/** One input moved linearly across the frames; `from` and `to` have the input's component count. */
export type Sweep = { readonly kind: "none" } | { readonly kind: "linear"; readonly name: string; readonly from: readonly number[]; readonly to: readonly number[] };

function components(flag: string, name: string, text: string): number[] {
  return text.split(",").map((s) => {
    const n = Number(s);
    if (s.trim() === "" || !Number.isFinite(n)) throw new UsageError(`${flag} ${name}: "${text}" is not a number or comma-separated numbers`);
    return n;
  });
}

function nameValue(flag: string, text: string): [string, string] {
  const i = text.indexOf("=");
  if (i <= 0 || i === text.length - 1) throw new UsageError(`${flag}: "${text}" is not name=value`);
  return [text.slice(0, i), text.slice(i + 1)];
}

/** `--input` values, each `name=v` or `name=x,y,z`. Repeating a name is an error (one of them would be lost). */
export function parseInputs(texts: readonly string[]): InputValues {
  const out: Record<string, readonly number[]> = {};
  for (const text of texts) {
    const [name, value] = nameValue("--input", text);
    if (name in out) throw new UsageError(`--input ${name}: given twice`);
    out[name] = components("--input", name, value);
  }
  return out;
}

/** `--sweep name=a..b` (a and b scalars, or comma-separated vectors of one length). */
export function parseSweep(text: string | undefined): Sweep {
  if (text === undefined) return { kind: "none" };
  const [name, range] = nameValue("--sweep", text);
  const parts = range.split("..");
  if (parts.length !== 2) throw new UsageError(`--sweep ${name}: "${range}" is not from..to, e.g. 0..1`);
  const from = components("--sweep", name, parts[0]!), to = components("--sweep", name, parts[1]!);
  if (from.length !== to.length) throw new UsageError(`--sweep ${name}: from has ${from.length} components, to has ${to.length}`);
  return { kind: "linear", name, from, to };
}

/** The inputs of frame k of n: the fixed ones plus the sweep at k / (n - 1) (its start when there is one frame). */
export function viewInputs(fixed: InputValues, sweep: Sweep, k: number, n: number): InputValues {
  switch (sweep.kind) {
    case "none": return fixed;
    case "linear": {
      const f = n > 1 ? k / (n - 1) : 0;
      return { ...fixed, [sweep.name]: sweep.from.map((a, i) => a + (sweep.to[i]! - a) * f) };
    }
  }
}

/** Every named input exists in the artefact, with its number of components; `time` is the `--time` flags' business. */
export function checkInputs(a: Pick<Artefact, "inputs">, fixed: InputValues, sweep: Sweep): void {
  const given: [string, number][] = Object.entries(fixed).map(([n, v]) => [n, v.length]);
  if (sweep.kind === "linear") {
    if (sweep.name in fixed) throw new UsageError(`--sweep ${sweep.name}: also given as --input`);
    given.push([sweep.name, sweep.from.length]);
  }
  const declared = a.inputs.filter((s) => s.name !== "time");
  for (const [name, count] of given) {
    if (name === "time") throw new UsageError(`input "time": use --time / --times (or the clip's clock) instead`);
    const s = declared.find((d) => d.name === name);
    if (!s) throw new UsageError(`input "${name}": the scene declares no such input (it has: ${declared.map((d) => `${d.name} (${d.def.length})`).join(", ") || "none"}). Fix: drop --input ${name}, or declare it in the scene: input("${name}", "f32", 0)`);
    if (s.def.length !== count) throw new UsageError(`input "${name}": takes ${s.def.length} number(s), got ${count}`);
  }
}
