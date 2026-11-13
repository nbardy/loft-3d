// Rates (docs/gpu_native.md, "Rates"). Every node of the graph changes at some slowest clock: at build (a constant),
// once per frame (time, inputs, params, curve rows, table entries at a fixed index), or once per invocation of the
// program that reads it (a table entry, a vertex, a pixel; per copy where a program says so). A program runs at the rate
// of its invocations; a node slower than its program is recomputed for nothing in every invocation, and in every
// program that reads it.
//
// Lowering a program: fold its build constants (in f32, `fold` in src/expr.ts), then lift its per-frame frontier into a
// frame-values table, computed once per frame by a one-invocation pose stage, and read back with one fetch. A per-frame
// node is lifted when it is at the frontier (read by a node that stays) and
//   - the program runs faster than once per frame (a map run of more than one entry, a vertex or fragment function), or
//   - two or more programs of one group read it (the runs of one table: phase 1's `<name>_common`, now a case of this),
// and its sub-graph costs more than the fetch that replaces it (`LIFT_MIN`).
//
// Rates are classified in one place, `rateOf`. The plan (`plan`) is pure: it says which nodes to lift; the table
// registry (src/compile/tables.ts) owns the frame-values tables and rewrites programs with the plan.

import { children, type Expr, type NumTy } from "../expr.ts";

/** The clocks, slowest first. "copy": once per copy of a thing drawn several times; "item": per entry, vertex or pixel. */
export type Rate = "build" | "frame" | "copy" | "item";
const RANK: Readonly<Record<Rate, number>> = { build: 0, frame: 1, copy: 2, item: 3 };
export const faster = (a: Rate, b: Rate): Rate => (RANK[a] >= RANK[b] ? a : b);

/** A program to lower: its roots, the rate of each free variable it binds, and how often it is invoked. */
export type Program = {
  readonly name: string;
  readonly roots: readonly Expr[];
  readonly vars: ReadonlyMap<string, Rate>;
  /** "frame": invoked once per frame (a scan, a run of one entry, a frame-values stage); "item": more often. */
  readonly runs: "frame" | "item";
};

/**
 * Rates of every node reachable from `roots` (loop bodies are not entered: a loop's result has the rate of what it reads
 * from outside). The one classifier: each node kind's rate is decided here and nowhere else.
 */
export function rates(roots: readonly Expr[], vars: ReadonlyMap<string, Rate>, memo: Map<number, Rate> = new Map()): Map<number, Rate> {
  const visit = (e: Expr): Rate => {
    const known = memo.get(e.id);
    if (known !== undefined) return known;
    const kids = (xs: readonly Expr[], floor: Rate): Rate => xs.reduce<Rate>((r, x) => faster(r, visit(x)), floor);
    const n = e.node;
    let r: Rate;
    switch (n.op) {
      case "const": r = "build"; break;
      case "var": {
        const v = vars.get(n.name);
        if (v === undefined) throw new Error(`rates: free variable "${n.name}" has no stated rate (stated: ${[...vars.keys()].join(", ") || "none"})`);
        r = v;
        break;
      }
      // Set by the host each frame.
      case "input": case "param": r = "frame"; break;
      // Curve rows can be edited at run time (`setCurves`); a static table is filled at build but its values are not
      // known to the folder, so a fetch is never "build".
      case "row": r = kids([n.x], "frame"); break;
      case "fetch": r = kids([n.index], "frame"); break;
      // A GPU-only library function has no CPU twin, so it can be neither folded nor computed in frame values (whose CPU
      // reading tools use), and it may read what only a draw binds (the camera, scene depth): it stays in its program.
      case "lib": r = kids(n.args, n.fn.js === "gpu-only" ? "item" : "build"); break;
      case "call": case "vec": r = kids(n.args, "build"); break;
      case "get": r = kids([n.a], "build"); break;
      // Loops are not folded; a loop is as fast as its count, start and what its body reads from outside.
      case "iterate": r = kids(children(e), "frame"); break;
    }
    memo.set(e.id, r);
    return r;
  };
  for (const e of roots) visit(e);
  return memo;
}

/**
 * What evaluating a node costs, in arithmetic operations (moves are free: a `vec` or a swizzle; a leaf is a register
 * or one uniform read). A fetch is one storage read; a curve row a clamp, a floor, two reads and a mix; a loop is
 * charged as large (a per-frame loop is always worth lifting).
 */
function ownCost(e: Expr): number {
  const n = e.node;
  switch (n.op) {
    case "const": case "var": case "input": case "param": case "vec": case "get": return 0;
    case "call": case "fetch": return 1;
    case "row": return 5;
    case "lib": return 4;
    case "iterate": return 64;
  }
}

/**
 * The fetch that replaces a lifted value costs one storage read and an accessor's index arithmetic, about two
 * operations; a value whose sub-graph costs less stays where it is.
 */
export const LIFT_MIN = 3;

const numeric = (e: Expr): e is Expr<NumTy> => e.ty !== "bool";

/** Cost of the per-frame sub-graph under `x`, counted until it reaches `cap` (distinct nodes). */
function costUnder(x: Expr, rate: ReadonlyMap<number, Rate>, cap: number): number {
  let total = 0;
  const seen = new Set<number>();
  const stack = [x];
  while (stack.length > 0 && total < cap) {
    const e = stack.pop()!;
    if (seen.has(e.id) || rate.get(e.id) === "build") continue;
    seen.add(e.id);
    total += ownCost(e);
    stack.push(...children(e));
  }
  return total;
}

/** For each program of a group, the per-frame nodes to lift (its frontier), in a stable order. */
export type Plan = { readonly lifted: readonly (readonly Expr<NumTy>[])[]; readonly rate: ReadonlyMap<number, Rate> };

/**
 * The frontier of each program of a group (programs that may share work: the runs of one table, or one shader
 * function). `memo` may be shared across groups: a node's rate does not depend on the program unless it reads a
 * variable, and every variable has one rate.
 */
export function plan(group: readonly Program[], memo: Map<number, Rate> = new Map()): Plan {
  const vars = new Map<string, Rate>();
  for (const p of group) for (const [k, v] of p.vars) vars.set(k, v);
  const rate = memo;
  for (const p of group) rates(p.roots, vars, rate);
  const perFrame = (e: Expr): boolean => rate.get(e.id) === "frame";
  // How many programs of the group reach each per-frame node.
  const readers = new Map<number, number>();
  if (group.length > 1) {
    for (const p of group) {
      const seen = new Set<number>();
      const stack = [...p.roots];
      while (stack.length > 0) {
        const e = stack.pop()!;
        if (seen.has(e.id) || rate.get(e.id) === "build") continue;
        seen.add(e.id);
        if (perFrame(e)) readers.set(e.id, (readers.get(e.id) ?? 0) + 1);
        stack.push(...children(e));
      }
    }
  }
  const cost = new Map<number, number>();
  const worth = (e: Expr): boolean => {
    let c = cost.get(e.id);
    if (c === undefined) cost.set(e.id, (c = costUnder(e, rate, LIFT_MIN)));
    return c >= LIFT_MIN;
  };
  const lifted = group.map((p) => {
    const out: Expr<NumTy>[] = [];
    const seen = new Set<number>();
    const liftable = (e: Expr): e is Expr<NumTy> =>
      perFrame(e) && numeric(e) && (p.runs === "item" || (readers.get(e.id) ?? 0) >= 2) && worth(e);
    const visit = (e: Expr): void => {
      if (seen.has(e.id)) return;
      seen.add(e.id);
      if (rate.get(e.id) === "build") return;
      if (liftable(e)) { out.push(e); return; }
      for (const c of children(e)) visit(c);
    };
    for (const r of p.roots) visit(r);
    return out;
  });
  return { lifted, rate };
}
