// Slots: where each leaf of the expression graph lives at run time. Assigned lazily, in order of first use, as the
// compiler emits code (so there is one pass, and the order is deterministic). CPU-only expressions register too, so
// a param used only by the pose pass still gets a slot the host can set. A per-frame table an expression fetches is
// handed to the compiler's table registry the first time it is seen, exactly like a curve row gets a slot.

import type { InputSlot, ParamSlot } from "../artefact.ts";
import {
  CURVE_N, emitWgsl, leaves, type Bind, type Env, type Expr, type InputSpec, type LibFn, type NumTy, type ParamSpec, type Row,
  type TableSource,
} from "../expr.ts";
import type { Shader, TableRef } from "./context.ts";
import type { Program } from "./rates.ts";

const FLOATS: Record<NumTy, number> = { f32: 1, vec2: 2, vec3: 3, vec4: 4 };

export class Slots {
  private readonly inputMap = new Map<string, InputSlot>();
  private readonly paramMap = new Map<string, ParamSlot>();
  private readonly rowMap = new Map<number, { readonly row: Row; readonly slot: number }>();
  private readonly libList: LibFn[] = [];
  private inputFloats = 0;
  private sealed = false;

  /**
   * `table`: the compiler's registry, which declares (and prepares) a table the first time it is seen. `lower`: the
   * registry's lowering of a function's roots (src/compile/rates.ts), given the rate of each argument.
   */
  constructor(private readonly table: (t: TableSource) => TableRef, readonly lower: (p: Program) => readonly Expr[]) {}

  /** After this, a leaf that has no slot yet is an error (it would not be in the artefact). */
  seal(): void { this.sealed = true; }
  private fresh(what: string): void {
    if (this.sealed) throw new Error(`compile: ${what} was first used after the artefact was laid out`);
  }

  /** Library functions emitted code calls, each after its dependencies; their definitions go in `sceneWgsl`. */
  lib(fns: readonly LibFn[]): void {
    for (const fn of fns) if (!this.libList.includes(fn)) this.libList.push(fn);
  }
  libs(): readonly LibFn[] { return this.libList; }

  input(spec: InputSpec): InputSlot {
    const seen = this.inputMap.get(spec.name);
    if (seen) {
      // One scene, one declaration per name (the process-wide check that was in `input`, src/expr.ts).
      if (seen.ty !== spec.ty || seen.def.join() !== spec.def.join()) throw new Error(`input "${spec.name}" declared twice in one scene with different types or defaults (${seen.ty} [${seen.def.join(", ")}], ${spec.ty} [${spec.def.join(", ")}])`);
      return seen;
    }
    this.fresh(`input "${spec.name}"`);
    const made: InputSlot = { name: spec.name, ty: spec.ty, slot: this.inputFloats, def: spec.def };
    this.inputFloats += FLOATS[spec.ty];
    this.inputMap.set(spec.name, made);
    return made;
  }

  param(spec: ParamSpec): ParamSlot {
    const seen = this.paramMap.get(spec.name);
    if (seen) return seen;
    this.fresh(`param "${spec.name}"`);
    const made: ParamSlot = { name: spec.name, slot: this.paramMap.size, def: spec.def, min: spec.min, max: spec.max };
    this.paramMap.set(spec.name, made);
    return made;
  }

  row(r: Row): number {
    const seen = this.rowMap.get(r.id);
    if (seen) return seen.slot;
    this.fresh(`curve row "${r.label}"`);
    const slot = this.rowMap.size;
    this.rowMap.set(r.id, { row: r, slot });
    return slot;
  }

  /** Give every leaf of these (CPU-evaluated) expressions a slot. */
  register(roots: readonly Expr[]): void {
    const l = leaves(roots);
    for (const s of l.inputs) this.input(s);
    for (const p of l.params) this.param(p);
    for (const r of l.rows) this.row(r);
    for (const t of l.tables) this.table(t);
  }

  /** A WGSL binding of leaves; free variables map through `vars` (name -> WGSL source), and an unknown one throws. */
  wgsl(vars: Readonly<Record<string, string>>): Bind {
    return {
      variable: (name) => {
        const src = vars[name];
        if (src === undefined) throw new Error(`free variable "${name}" is not bound here (bound: ${Object.keys(vars).join(", ") || "none"})`);
        return src;
      },
      input: (spec) => {
        const s = this.input(spec).slot;
        switch (spec.ty) {
          case "f32": return `inputs[${s}]`;
          case "vec2": return `vec2<f32>(inputs[${s}], inputs[${s + 1}])`;
          case "vec3": return `vec3<f32>(inputs[${s}], inputs[${s + 1}], inputs[${s + 2}])`;
          case "vec4": return `vec4<f32>(inputs[${s}], inputs[${s + 1}], inputs[${s + 2}], inputs[${s + 3}])`;
        }
      },
      param: (spec) => `params[${this.param(spec).slot}]`,
      row: (r, x) => `curve(${this.row(r)}u, ${x})`,
      // An entry at a whole-number literal (a station at a fixed index, a frame value) is read at its offset.
      table: (t, i, lane) => (/^\d+\.0$/.test(i) ? `${this.table(t).wgsl}(${Number(i) * t.lanes + lane}u)` : `${this.table(t).wgsl}(u32(${i}) * ${t.lanes}u + ${lane}u)`),
    };
  }

  /** The leaf tables, final once emission is done. */
  tables(): { inputs: InputSlot[]; inputFloats: number; params: ParamSlot[]; curves: Float32Array; rows: number } {
    const rows = [...this.rowMap.values()];
    const curves = new Float32Array(rows.length * CURVE_N * 4);
    for (const { row, slot } of rows) curves.set(row.samples, slot * CURVE_N * 4);
    return { inputs: [...this.inputMap.values()], inputFloats: this.inputFloats, params: [...this.paramMap.values()], curves, rows: rows.length };
  }

  /** Read a host's slot-laid-out state back into the by-name environment the JavaScript backend evaluates in. */
  envReader(): (inputs: Float32Array, params: Float32Array) => { inputs: Record<string, number | number[]>; params: Record<string, number> } {
    const ins = [...this.inputMap.values()], ps = [...this.paramMap.values()];
    return (inputs, params) => {
      const i: Record<string, number | number[]> = {};
      for (const s of ins) i[s.name] = s.ty === "f32" ? inputs[s.slot] : Array.from(inputs.subarray(s.slot, s.slot + FLOATS[s.ty]));
      const p: Record<string, number> = {};
      for (const s of ps) p[s.name] = params[s.slot];
      return { inputs: i, params: p };
    };
  }
}

export type { Env };

const WGSL_TY: Record<string, string> = { f32: "f32", vec2: "vec2<f32>", vec3: "vec3<f32>", vec4: "vec4<f32>", bool: "bool" };

type FnSpec = {
  readonly name: string;
  /** (name, type) pairs, bound as free variables of the same name. */
  readonly args: readonly (readonly [string, NumTy])[];
  /** The WGSL return type. */
  readonly out: string;
  readonly roots: readonly Expr[];
  /** Combines the root values into the return expression. */
  readonly ret: (values: readonly string[]) => string;
};

function fnSource(slots: Slots, f: FnSpec): { code: string; libs: LibFn[] } {
  const vars: Record<string, string> = {};
  for (const [a] of f.args) vars[a] = a;
  // Every argument varies per vertex or pixel (or per copy, which a function does not state; "item" is the safe
  // reading: nothing that reads an argument is lifted).
  const roots = slots.lower({ name: f.name, roots: f.roots, vars: new Map(f.args.map(([a]) => [a, "item"])), runs: "item" });
  const { lines, out: values, libs } = emitWgsl(roots, slots.wgsl(vars));
  const sig = f.args.map(([a, t]) => `${a}: ${WGSL_TY[t]}`).join(", ");
  return { code: [`fn ${f.name}(${sig}) -> ${f.out} {`, ...lines.map((l) => `  ${l}`), `  return ${f.ret(values)};`, `}`].join("\n"), libs };
}

/**
 * Emits a WGSL function from expressions and returns its source, to be shared by every shader in the scene (its library
 * functions go to the shared scene code). For authors of their own drawable or style; a scene author does not need it.
 */
export function emitFn(slots: Slots, name: string, args: FnSpec["args"], out: string, roots: readonly Expr[], ret: FnSpec["ret"]): string {
  const s = fnSource(slots, { name, args, out, roots, ret });
  slots.lib(s.libs);
  return s.code;
}

/**
 * Emits a WGSL function from expressions for one shader module and returns its code and the library functions it
 * calls (a `Shader`). For authors of their own drawable; a scene author does not need it.
 */
export function emitShaderFn(slots: Slots, f: FnSpec): Shader {
  return fnSource(slots, f);
}
