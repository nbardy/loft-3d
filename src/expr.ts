// Loft L0: symbolic maths.
//
// An `Expr` is a node in a hash-consed DAG. Authoring code never computes numbers; it builds expressions, and two
// backends turn the same DAG into code: JavaScript (CPU: checks, baking, the CPU reading of per-frame tables) and WGSL
// (GPU: vertex and fragment stages, and the pose stages that fill per-frame tables). Everything above this layer (curves, charts, shapes, styles) is written in terms of `Expr`, which
// is what lets one description be evaluated wherever the schedule says.
//
// Rules: expressions are pure. A leaf is a constant, a free variable (bound by the consumer: u, v, a world point), a
// host input (time, game state), a tunable parameter (a named number that can change without recompiling), a lookup
// into a table-backed curve, or an entry of a per-frame table (`fetch`). `iterate` is the one non-leaf form with a
// body: a loop over a small tuple of state, emitted as a real loop by both backends.

export type Ty = "f32" | "vec2" | "vec3" | "vec4" | "bool";
export type NumTy = Exclude<Ty, "bool">;
export type VecTy = Exclude<NumTy, "f32">;

const SIZE: Record<NumTy, number> = { f32: 1, vec2: 2, vec3: 3, vec4: 4 };
const TY_OF_SIZE: readonly NumTy[] = ["f32", "f32", "vec2", "vec3", "vec4"];

// Defined beside the host contract, which the file loader imports without this module (docs/artefact_format.md).
import { CURVE_N } from "./artefact.ts";
import { SceneError } from "./errors.ts";
export { CURVE_N };

/** A table-backed curve: CURVE_N vec4 samples over x in [0, 1], linearly interpolated, clamped at the ends. */
export class Row {
  private static next = 0;
  readonly id: number;
  constructor(readonly samples: Float32Array, readonly label: string) {
    if (samples.length !== CURVE_N * 4) {
      throw new Error(`Row "${label}": expected ${CURVE_N * 4} floats, got ${samples.length}`);
    }
    this.id = Row.next++;
  }
}

export type ParamSpec = { readonly name: string; readonly def: number; readonly min: number; readonly max: number };
export type InputSpec = { readonly name: string; readonly ty: NumTy; readonly def: readonly number[] };

export type Fn =
  | "add" | "sub" | "mul" | "div" | "neg" | "min" | "max" | "pow" | "mod" | "atan2" | "step"
  | "abs" | "sign" | "floor" | "fract" | "sqrt" | "exp" | "log" | "sin" | "cos" | "tan" | "saturate" | "normalize"
  | "mix" | "clamp" | "smoothstep" | "length" | "distance" | "dot" | "cross"
  | "lt" | "gt" | "le" | "ge" | "eq" | "ne" | "and" | "or" | "not" | "select";

/**
 * A named function written once in each backend's language: the way to add vocabulary (noise, a custom falloff) that
 * the built-in operators cannot express compactly. `wgsl` is the full function definition, named `name`. `js` is the
 * CPU twin, or "gpu-only" for functions that may only be used in shader stages (evaluating one on the CPU throws).
 * `deps` are other library functions the WGSL body calls.
 */
export type LibFn = {
  readonly name: string;
  readonly ret: Ty;
  readonly wgsl: string;
  readonly js: ((...args: any[]) => number | number[] | boolean) | "gpu-only";
  readonly deps?: readonly LibFn[];
};

// ---- per-frame tables -----------------------------------------------------------------------------------------------

/**
 * A table of vec4s, filled once per frame (or once at build) and bound for every shader: `entries` entries of `lanes`
 * vec4s each. `fetch(table, index, lane)` reads one. A compiler discovers the tables an expression uses by walking it
 * (as it discovers params and curve rows).
 *
 * How a table is filled is its `program` (docs/gpu_native.md, phase 1): a `map` or a `scan` written in expressions,
 * from which the compiler derives both the GPU compute stage that fills it each frame and the CPU fill tools use; or
 * `cpu`, a hand-written fill, which is the named, counted state of a table not yet ported. A table written before
 * programs existed (`prepare` alone, as in examples/bosses/tithe/kit.ts) is read as `cpu` at the compiler's boundary.
 */
export type TableSource = ProgramTable | FilledTable;
type TableShape = {
  /** An identifier, unique in a compiled scene. */
  readonly name: string;
  readonly lanes: number;
  readonly entries: number;
  /**
   * "stations": a body's transported frames (counted in `Artefact.stats.stations`); "data": anything else filled per
   * frame; "static": filled once, when the artefact is compiled (its fill must not read the frame: it is called with
   * none), and uploaded once by the host (`Artefact.statics`): a keyed curve, a sculpt layer, a distance brick.
   */
  readonly role: "stations" | "data" | "static";
};
export type ProgramTable = TableShape & { readonly program: TableProgram };
/** A hand-written fill. `prepare` is called once per compilation; `p.compile` gives CPU functions over a frame. */
export type FilledTable = TableShape & { prepare(p: TablePrep): TableFill };

/**
 * Entries `count` long, each a closed form in its index `i` within the run (0 .. count - 1, an f32 holding a whole
 * number): `lanes(i)` gives the entry's `lanes` vec4s. A table's runs are laid end to end.
 */
export type MapRun = { readonly count: number; readonly lanes: (i: Expr<"f32">) => readonly Expr<"vec4">[] };
/** What one step of a scan gives: the state after it, and the entry it writes. */
export type ScanStep = { readonly next: readonly Expr<NumTy>[]; readonly lanes: readonly Expr<"vec4">[] };

/**
 * How a per-frame table is filled.
 *
 * map   entry by entry, each independent of the others: a function of its index, the frame and OTHER tables. Its runs
 *       let a table be a closed form over some entries and a list of unrelated expressions over others (each rope's
 *       ends, each listed pose: a run of one). On the GPU one invocation per entry runs only its own run's code.
 * scan  entries `first .. first + steps - 1` in order, carrying a small state from one to the next (frames transported
 *       along a spine, an arc length). `step(state, i)` is called once, with fresh variables, as `iterate`'s is. On the
 *       GPU one invocation loops. Entries outside the range are never written (they stay zero).
 * cpu   a hand-written fill, with the reason it is not (yet) a map or a scan. Filled on the CPU and uploaded.
 */
export type TableProgram =
  | { readonly kind: "map"; readonly runs: readonly MapRun[] }
  | {
    readonly kind: "scan";
    readonly first: number;
    readonly steps: number;
    readonly init: readonly Expr<NumTy>[];
    readonly step: (state: readonly Expr<NumTy>[], i: Expr<"f32">) => ScanStep;
  }
  | { readonly kind: "cpu"; readonly why: string; prepare(p: TablePrep): TableFill };

/** A map whose every entry is the same closed form in the entry index. */
export const mapOf = (entries: number, lanes: MapRun["lanes"]): TableProgram => ({ kind: "map", runs: [{ count: entries, lanes }] });
/** A map whose entries share no closed form: entry k is `entries[k]` (one run each). */
export const listOf = (entries: readonly (readonly Expr<"vec4">[])[]): TableProgram => ({ kind: "map", runs: entries.map((e) => ({ count: 1, lanes: () => e })) });
/** Fill `out` (`entries * lanes * 4` floats, zeroed) for this frame. Pure: the same frame, the same numbers. */
export type TableFill = (frame: TableFrame, out: Float32Array) => void;
/** What a fill sees: this frame's environment, and other tables (filled on first read; a cycle is an error). */
export interface TableFrame {
  readonly env: Env;
  table(t: TableSource): Float32Array;
}
/** What a table may ask of the compiler while it is prepared. */
export interface TablePrep {
  /**
   * Compile expressions for the CPU, reading curves, inputs, params and tables from a frame; free variables are bound
   * per call. Compiled once, here; called every frame.
   */
  compile(roots: readonly Expr[]): (frame: TableFrame, vars?: Env["vars"]) => (V | boolean)[];
}

const tableIds = new WeakMap<TableSource, number>();
let nextTable = 0;
/** A number per table object, for interning keys (two tables may share nothing but their name). */
const tableId = (t: TableSource): number => {
  let id = tableIds.get(t);
  if (id === undefined) tableIds.set(t, (id = nextTable++));
  return id;
};

// ---- loops ------------------------------------------------------------------------------------------------------

/**
 * One `iterate` form. The step was called once with fresh free variables (`state`, `index`) to give `next`. `inner`
 * are the nodes of the body that depend on those variables (in dependency order): they are what runs each time round.
 * Everything else the body reads is `outer` and is computed once, before the loop.
 */
export type Loop = {
  readonly id: number;
  readonly count: Expr<"f32">;
  readonly init: readonly Expr[];
  readonly state: readonly Expr[];
  readonly index: Expr<"f32">;
  readonly next: readonly Expr[];
  readonly inner: readonly Expr[];
  readonly outer: readonly Expr[];
  /** The step as authored, kept so `substitute` can rebuild the body with fresh variables. */
  readonly step: (state: readonly Expr[], i: Expr<"f32">) => readonly Expr[];
  /** The final state, one expression per component (the loop's results). */
  readonly results: readonly Expr[];
};

/** The node kinds. Exported so other modules (differentiation, analysis) can walk the graph; build nodes only through the constructors below. */
export type Node =
  | { readonly op: "lib"; readonly ty: Ty; readonly fn: LibFn; readonly args: readonly Expr[] }
  | { readonly op: "const"; readonly ty: Ty; readonly v: readonly number[] }
  | { readonly op: "var"; readonly ty: Ty; readonly name: string }
  | { readonly op: "input"; readonly ty: NumTy; readonly spec: InputSpec }
  | { readonly op: "param"; readonly ty: "f32"; readonly spec: ParamSpec }
  | { readonly op: "row"; readonly ty: "vec4"; readonly row: Row; readonly x: Expr<"f32"> }
  | { readonly op: "call"; readonly ty: Ty; readonly fn: Fn; readonly args: readonly Expr[] }
  | { readonly op: "vec"; readonly ty: VecTy; readonly args: readonly Expr[] }
  | { readonly op: "get"; readonly ty: NumTy; readonly a: Expr; readonly sel: string }
  /** Entry `index` (truncated to an integer), vec4 number `lane`, of a per-frame table. */
  | { readonly op: "fetch"; readonly ty: "vec4"; readonly table: TableSource; readonly lane: number; readonly index: Expr<"f32"> }
  /** Component `k` of a loop's final state. */
  | { readonly op: "iterate"; readonly ty: NumTy; readonly loop: Loop; readonly k: number };

type Wider<A extends NumTy, B extends NumTy> = A extends "f32" ? B : A;
/** A vector written as a plain array. TypeScript cannot see its length, so its result type is "some vector". */
export type Lit = readonly number[];
/** Anything accepted where an expression of type T is wanted: plain numbers lift to constants. */
export type In<T extends Ty = Ty> = Expr<T> | (T extends "f32" ? number : T extends "bool" ? boolean : readonly number[]);
export type Num = Expr<NumTy> | number | readonly number[];

const interned = new Map<string, Expr>();
const params = new Map<string, ParamSpec>();

/**
 * A node in a typed expression graph: a number, a vec2, vec3, vec4 or a bool (the type parameter), built by the
 * functions of this file (`add`, `mix`, `vec3`, ...) from constants and named inputs. It is a description, not a
 * value: the GPU evaluates it per vertex or per pixel, and `evaluate` computes it once on the CPU. Equal expressions
 * are one shared node. The fluent forms `.add(b)`, `.sub(b)`, `.mul(b)`, `.div(b)` equal the functions of the same
 * name, and `.x`, `.y`, `.z`, `.w`, `.xy`, `.xz`, `.xyz` select components of a vector.
 */
export class Expr<T extends Ty = Ty> {
  private constructor(readonly id: number, readonly node: Node) {}
  get ty(): T { return this.node.ty as T; }

  static make<T extends Ty>(node: Node, key: string): Expr<T> {
    const hit = interned.get(key);
    if (hit) return hit as Expr<T>;
    const made = new Expr<T>(interned.size, node);
    interned.set(key, made);
    return made;
  }

  // Fluent forms of the common operators. `a.add(b)` is `add(a, b)`.
  add(b: number): Expr<T>;
  add<B extends NumTy>(b: Expr<B>): Expr<Wider<T & NumTy, B>>;
  add(b: Lit): Expr<T extends "f32" ? VecTy : T>;
  add<B extends NumTy = "f32">(b: Expr<B> | number | Lit): Expr<Wider<T & NumTy, B>>;
  add(b: In<NumTy>): Expr { return add(this as never, b as never); }
  sub(b: number): Expr<T>;
  sub<B extends NumTy>(b: Expr<B>): Expr<Wider<T & NumTy, B>>;
  sub(b: Lit): Expr<T extends "f32" ? VecTy : T>;
  sub<B extends NumTy = "f32">(b: Expr<B> | number | Lit): Expr<Wider<T & NumTy, B>>;
  sub(b: In<NumTy>): Expr { return sub(this as never, b as never); }
  mul(b: number): Expr<T>;
  mul<B extends NumTy>(b: Expr<B>): Expr<Wider<T & NumTy, B>>;
  mul(b: Lit): Expr<T extends "f32" ? VecTy : T>;
  mul<B extends NumTy = "f32">(b: Expr<B> | number | Lit): Expr<Wider<T & NumTy, B>>;
  mul(b: In<NumTy>): Expr { return mul(this as never, b as never); }
  div(b: number): Expr<T>;
  div<B extends NumTy>(b: Expr<B>): Expr<Wider<T & NumTy, B>>;
  div(b: Lit): Expr<T extends "f32" ? VecTy : T>;
  div<B extends NumTy = "f32">(b: Expr<B> | number | Lit): Expr<Wider<T & NumTy, B>>;
  div(b: In<NumTy>): Expr { return div(this as never, b as never); }
  get x(): Expr<"f32"> { return get(this, "x"); }
  get y(): Expr<"f32"> { return get(this, "y"); }
  get z(): Expr<"f32"> { return get(this, "z"); }
  get w(): Expr<"f32"> { return get(this, "w"); }
  get xy(): Expr<"vec2"> { return get(this, "xy"); }
  get xz(): Expr<"vec2"> { return get(this, "xz"); }
  get xyz(): Expr<"vec3"> { return get(this, "xyz"); }
}

// ---- leaves -------------------------------------------------------------------------------------------------------

function constant(ty: Ty, v: readonly number[]): Expr {
  for (const n of v) if (!Number.isFinite(n)) throw new SceneError("a number in an expression", String(n), "a finite number", "look for a division by zero, or a value read before it was set, on the line named at the end");
  return Expr.make({ op: "const", ty, v }, `c:${ty}:${v.join(",")}`);
}

/** Lift a plain value to an expression. Numbers become f32, arrays become vectors, booleans become bool. */
export function lift<T extends Ty>(x: In<T>): Expr<T> {
  if (x instanceof Expr) return x;
  if (typeof x === "number") return constant("f32", [x]) as Expr<T>;
  if (typeof x === "boolean") return constant("bool", [x ? 1 : 0]) as Expr<T>;
  const arr = x as readonly number[];
  if (arr.length < 2 || arr.length > 4) throw new Error(`cannot lift an array of length ${arr.length}`);
  return constant(TY_OF_SIZE[arr.length], arr) as Expr<T>;
}

/** `f(x)`: the constant expression for the number x (an f32); the same as passing x where an expression is expected. */
export const f = (x: number): Expr<"f32"> => lift<"f32">(x);

/** A free variable, bound by whoever consumes the expression (u, v, rho, a world point). */
export function variable<T extends Ty>(name: string, ty: T): Expr<T> {
  return Expr.make({ op: "var", ty, name }, `v:${ty}:${name}`);
}

// ---- namespaces ---------------------------------------------------------------------------------------------------
//
// Several instances of one thing in one scene (four crabs: src/lineup.ts) are built by the same code, which gives its
// drawables, tables and inputs the same names. A namespace is a dynamic scope: while `build` runs inside
// `namespaced(id, build)`, every name made at the constructors where names enter (a surface's, a body's, a tabulated
// table's, an input's) is prefixed with the instance's id, so no builder has to know it is one of several. Outside any
// namespace nothing is prefixed: one instance alone is named, and built, exactly as before.

let namespace = "";
/** Run `build` with every name it makes prefixed by `id` (an identifier). Namespaces do not nest. */
export function namespaced<T>(id: string, build: () => T): T {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(id)) throw new Error(`namespaced "${id}": the id must be letters and digits, starting with a letter (it prefixes identifiers and input names)`);
  if (namespace !== "") throw new Error(`namespaced "${id}": already inside the namespace "${namespace}" (namespaces do not nest)`);
  namespace = id;
  try { return build(); } finally { namespace = ""; }
}
/** The namespace now ("" outside any). */
export const currentNamespace = (): string => namespace;
/**
 * A number that differs from one namespace to the next and is 0 outside any: what makes instances built by the same
 * code differ where their code asks for a seed (each crab of a line its own idle, not four copies of one puppet).
 */
export function namespaceSeed(): number {
  let h = 0;
  for (const c of namespace) h = (h * 31 + c.charCodeAt(0)) % 9973;
  return namespace === "" ? 0 : 1 + (h % 97);
}
/** An identifier (a thing's or a table's name) in the namespace now: `id__name`. A name already in it is left alone, so a name may pass through two constructors. */
export function scopedName(name: string): string {
  return namespace === "" || name.startsWith(`${namespace}__`) ? name : `${namespace}__${name}`;
}
/** An input's name in the namespace now: `id.name`. */
function scopedInput(name: string): string {
  return namespace === "" || name.startsWith(`${namespace}.`) ? name : `${namespace}.${name}`;
}

/** A value the host supplies every frame (time, game state, a target position). In a namespace its name is the instance's: `id.name`. */
export function input<T extends NumTy>(given: string, ty: T, def: readonly number[]): Expr<T> {
  const name = scopedInput(given);
  if (def.length !== SIZE[ty]) throw new SceneError(`input "${name}"`, `a default of ${def.length} number${def.length === 1 ? "" : "s"} for a ${ty}`, `${SIZE[ty]} numbers`, `input("${given}", "${ty}", [${[...Array(SIZE[ty])].map((_, k) => def[k] ?? 0).join(", ")}])`);
  const spec: InputSpec = { name, ty, def };
  // An input's declaration belongs to the scene that reads it, not to the process: the variants of one design are
  // several scenes built in one process, and each may give an input its own default (where its ship floats). So the
  // node is interned by name, type and default, and "declared twice, differently" is refused where one scene's inputs
  // are bound (src/compile/bind.ts). Until 2026-11-11 it was refused here, process-wide, with the node interned by name
  // alone, so a second variant could not have declared a different default (and would have silently got the first's).
  return Expr.make({ op: "input", ty, spec }, `i:${name}:${ty}:${def.join()}`);
}

/** Seconds since the scene started. */
export const time: Expr<"f32"> = input("time", "f32", [0]);

/** A named tunable number. Changing it at run time is a buffer write, never a recompile. */
export function param(name: string, def: number, range?: { min?: number; max?: number }): Expr<"f32"> {
  const span = Math.max(Math.abs(def), 1e-3);
  const spec: ParamSpec = { name, def, min: range?.min ?? def - 2 * span, max: range?.max ?? def + 2 * span };
  const seen = params.get(name);
  if (seen && seen.def !== def) throw new Error(`param "${name}" declared twice with different defaults (${seen.def}, ${def})`);
  params.set(name, seen ?? spec);
  return Expr.make({ op: "param", ty: "f32", spec: seen ?? spec }, `p:${name}`);
}

/** Look up a table-backed curve at x in [0, 1]. Always a vec4; take components with `.x`, `.xyz`. */
export function row(r: Row, x: In<"f32">): Expr<"vec4"> {
  const xe = lift<"f32">(x);
  return Expr.make({ op: "row", ty: "vec4", row: r, x: xe }, `r:${r.id}:${xe.id}`);
}

/**
 * Entry `index` of a per-frame table, vec4 number `lane` of that entry. `index` must lie in [0, entries) (it is
 * truncated to an integer; out of range is undefined on the GPU and throws nowhere, so callers clamp).
 */
export function fetch(table: TableSource, index: In<"f32">, lane: number): Expr<"vec4"> {
  if (!(Number.isInteger(lane) && lane >= 0 && lane < table.lanes)) throw new Error(`fetch: table "${table.name}" has ${table.lanes} lanes, asked for lane ${lane}`);
  const ie = lift<"f32">(index);
  return Expr.make({ op: "fetch", ty: "vec4", table, lane, index: ie }, `F:${tableId(table)}:${lane}:${ie.id}`);
}

let nextLoop = 0;
/**
 * Repeat `step` `count` times from `init`: a real loop in both backends (the body is emitted once, whatever the count).
 * The state is a small tuple of numeric expressions; `step(state, i)` returns the next state (same types), with `i`
 * the iteration number 0, 1, ... as an f32. `count` may be an expression (it is truncated to an integer), so the depth
 * of a fold can depend on distance. Pure: the step is a function of the state and the index.
 */
export function iterate<const S extends readonly Expr<NumTy>[]>(count: In<"f32">, init: S, step: (state: S, i: Expr<"f32">) => S): S {
  const id = nextLoop++;
  // A bool state would type-check through `as` casts; the loop's locals are numbers.
  const state = init.map((e, j) => {
    if ((e.ty as Ty) === "bool") throw new Error("iterate: state components must be numbers");
    return variable(`_L${id}s${j}`, e.ty);
  });
  const index = variable(`_L${id}i`, "f32");
  const next = step(state as unknown as S, index);
  if (next.length !== init.length) throw new Error(`iterate: step returned ${next.length} components, the state has ${init.length}`);
  next.forEach((e, j) => { if (e.ty !== init[j].ty) throw new Error(`iterate: state component ${j} is ${init[j].ty} but the step returned ${e.ty}`); });
  // Inner: depends (transitively) on this loop's variables. Outer: read by the body but computed before the loop.
  const own = new Set<number>([index.id, ...state.map((v) => v.id)]);
  const dependent = new Set<number>();
  const inner: Expr[] = [];
  const outer = new Map<number, Expr>();
  for (const e of topo(next)) {
    if (own.has(e.id)) continue;
    if (children(e).some((c) => own.has(c.id) || dependent.has(c.id))) { dependent.add(e.id); inner.push(e); }
  }
  for (const e of inner) for (const c of children(e)) if (!own.has(c.id) && !dependent.has(c.id)) outer.set(c.id, c);
  for (const e of next) if (!own.has(e.id) && !dependent.has(e.id)) outer.set(e.id, e);
  const results: Expr[] = [];
  const loop: Loop = {
    id, count: lift<"f32">(count), init, state, index, next, inner, outer: [...outer.values()],
    step: step as unknown as Loop["step"], results,
  };
  init.forEach((e, k) => results.push(Expr.make({ op: "iterate", ty: e.ty as NumTy, loop, k }, `I:${id}:${k}`)));
  return results as unknown as S;
}

const libs = new Map<string, LibFn>();
/** Call a library function. Two different functions may not share a name. */
export function lib<T extends Ty>(fn: LibFn, ...args: In[]): Expr<T> {
  const seen = libs.get(fn.name);
  if (seen && seen !== fn) throw new Error(`library function "${fn.name}" is defined twice`);
  libs.set(fn.name, fn);
  const xs = args.map((a) => lift(a));
  return Expr.make({ op: "lib", ty: fn.ret, fn, args: xs }, `l:${fn.name}:${xs.map((a) => a.id).join(",")}`);
}

// ---- constructors and access --------------------------------------------------------------------------------------

function vecOf(ty: VecTy, parts: readonly Num[]): Expr {
  const args = parts.map((p) => lift(p as In));
  const total = args.reduce((n, a) => n + SIZE[a.ty as NumTy], 0);
  if (total !== SIZE[ty] && !(args.length === 1 && args[0].ty === "f32")) {
    throw new SceneError(ty, `${total} components`, `${SIZE[ty]} (or one number for all of them)`, `${ty}(${[...Array(SIZE[ty]).keys()].map((k) => (k < total ? "xyzw"[k] : "0")).join(", ")}): give exactly ${SIZE[ty]}`);
  }
  return Expr.make({ op: "vec", ty, args }, `V:${ty}:${args.map((a) => a.id).join(",")}`);
}
/** `vec2(...parts)`: a vec2 from numbers or expressions (`vec2(x, y)`), or one scalar repeated into both components. */
export const vec2 = (...p: Num[]): Expr<"vec2"> => vecOf("vec2", p) as Expr<"vec2">;
/** `vec3(...parts)`: a vec3 from numbers, expressions or smaller vectors (`vec3(p.xy, 0)`), or one scalar repeated. */
export const vec3 = (...p: Num[]): Expr<"vec3"> => vecOf("vec3", p) as Expr<"vec3">;
/** `vec4(...parts)`: a vec4 from numbers, expressions or smaller vectors (`vec4(rgb, 1)`), or one scalar repeated. */
export const vec4 = (...p: Num[]): Expr<"vec4"> => vecOf("vec4", p) as Expr<"vec4">;

function get<T extends NumTy>(a: Expr, sel: string): Expr<T> {
  if (a.ty === "bool" || a.ty === "f32") throw new Error(`cannot take .${sel} of ${a.ty}`);
  const size = SIZE[a.ty as NumTy];
  for (const ch of sel) if ("xyzw".indexOf(ch) < 0 || "xyzw".indexOf(ch) >= size) throw new Error(`.${sel} is out of range for ${a.ty}`);
  return Expr.make({ op: "get", ty: TY_OF_SIZE[sel.length], a, sel }, `g:${a.id}:${sel}`);
}

// ---- operators ----------------------------------------------------------------------------------------------------

function wider(op: string, ...tys: Ty[]): NumTy {
  let out: NumTy = "f32";
  for (const t of tys) {
    if (t === "bool") throw new SceneError(op, "a bool", "numbers", `choose between numbers with select(cond, a, b)`);
    if (t === "f32") continue;
    if (out !== "f32" && out !== t) {
      const [big, small] = SIZE[out] > SIZE[t] ? [out, t] : [t, out];
      throw new SceneError(op, `a ${out} and a ${t}`, "operands of one size (or a plain number, which goes with any)", `make both ${big}s (e.g. ${big}(v.${"xyzw".slice(0, SIZE[small])}, ${Array(SIZE[big] - SIZE[small]).fill("0").join(", ")})) or take .${"xyzw".slice(0, SIZE[small])} of the ${big}`);
    }
    out = t;
  }
  return out;
}

function call(fn: Fn, ty: Ty, xs: readonly In[]): Expr {
  const args = xs.map((x) => lift(x));
  return Expr.make({ op: "call", ty, fn, args }, `f:${fn}:${args.map((a) => a.id).join(",")}`);
}

// Overloads, not one generic signature: a type parameter cannot be inferred from a plain `number` argument, and with
// a single signature `mul(x, 2)` came out as "some numeric type" instead of the type of `x` (found by the first code
// written against this file).
interface Binary {
  (a: number, b: number): Expr<"f32">;
  <A extends NumTy>(a: Expr<A>, b: number): Expr<A>;
  <B extends NumTy>(a: number, b: Expr<B>): Expr<B>;
  <A extends NumTy, B extends NumTy>(a: Expr<A>, b: Expr<B>): Expr<Wider<A, B>>;
  <A extends NumTy>(a: Expr<A>, b: Lit): Expr<A extends "f32" ? VecTy : A>;
  <B extends NumTy>(a: Lit, b: Expr<B>): Expr<B extends "f32" ? VecTy : B>;
  (a: Lit, b: Lit | number): Expr<VecTy>;
  (a: number, b: Lit): Expr<VecTy>;
  // Last: arguments typed as "an expression or a plain value" (a function parameter of type `In<"f32">`). The type
  // parameter is inferred from the expression half of the union; where the argument is only a number there is nothing
  // to infer from, so it defaults to "f32" (what a number lifts to) instead of the whole constraint.
  <A extends NumTy = "f32", B extends NumTy = "f32">(a: Expr<A> | number | Lit, b: Expr<B> | number | Lit): Expr<Wider<A, B>>;
}
interface Unary {
  (a: number): Expr<"f32">;
  <A extends NumTy>(a: Expr<A>): Expr<A>;
  (a: Lit): Expr<VecTy>;
  <A extends NumTy = "f32">(a: Expr<A> | number | Lit): Expr<A>;
}
const binary = (fn: Fn): Binary => ((a: In<NumTy>, b: In<NumTy>) => call(fn, wider(fn, lift(a).ty, lift(b).ty), [a, b])) as Binary;
const unary = (fn: Fn): Unary => ((a: In<NumTy>) => call(fn, lift(a).ty, [a])) as Unary;

/** `add(a, b)`: a + b, componentwise; a scalar operand is applied to every component of a vector one. */
export const add = binary("add");
/** `sub(a, b)`: a - b, componentwise; a scalar operand is applied to every component of a vector one. */
export const sub = binary("sub");
/** `mul(a, b)`: a * b, componentwise (not a matrix or dot product); a scalar operand scales every component. */
export const mul = binary("mul");
/** `div(a, b)`: a / b, componentwise; a scalar operand is applied to every component of a vector one. */
export const div = binary("div");
/** `min(a, b)`: the smaller of a and b, componentwise; a scalar operand is applied to every component. */
export const min = binary("min");
/** `max(a, b)`: the larger of a and b, componentwise; a scalar operand is applied to every component. */
export const max = binary("max");
/** `pow(a, b)`: a raised to the power b, componentwise; as in WGSL, a negative base gives an undefined result. */
export const pow = binary("pow");
/** Floored modulo (the result has the sign of the divisor), unlike WGSL's `%`. */
export const mod = binary("mod");
/** atan2(y, x). */
export const atan2 = binary("atan2");
/** step(edge, x): 0 below the edge, 1 at or above it. */
export const step = binary("step");
/** `neg(a)`: -a, componentwise. */
export const neg = unary("neg");
/** `abs(a)`: the absolute value, componentwise. */
export const abs = unary("abs");
/** `sign(a)`: -1, 0 or 1 by the sign of a, componentwise. */
export const sign = unary("sign");
/** `floor(a)`: the largest whole number not above a, componentwise. */
export const floor = unary("floor");
/** `fract(a)`: a - floor(a), the part after the point, componentwise (always in [0, 1)). */
export const fract = unary("fract");
/** `sqrt(a)`: the square root, componentwise; undefined for a negative a. */
export const sqrt = unary("sqrt");
/** `exp(a)`: e raised to a, componentwise. */
export const exp = unary("exp");
/** `log(a)`: the natural logarithm, componentwise; undefined for a not above 0. */
export const log = unary("log");
/** `sin(a)`: the sine of an angle in radians, componentwise. */
export const sin = unary("sin");
/** `cos(a)`: the cosine of an angle in radians, componentwise. */
export const cos = unary("cos");
/** `tan(a)`: the tangent of an angle in radians, componentwise. */
export const tan = unary("tan");
/** Clamp to [0, 1]. */
export const saturate = unary("saturate");
/** `normalize(v)`: v scaled to length 1 (WGSL `normalize`); v must be a vec2, vec3 or vec4 that is not zero. */
export const normalize = unary("normalize");

/**
 * `mix(a, b, t)`: a + (b - a) t, the linear blend from a (t = 0) to b (t = 1), componentwise; t may be a scalar or the
 * same vector type, and it is not clamped.
 */
export function mix(a: number, b: number, t: In<NumTy>): Expr<"f32">;
export function mix<A extends NumTy, B extends NumTy>(a: Expr<A>, b: Expr<B>, t: In<NumTy>): Expr<Wider<A, B>>;
export function mix<A extends NumTy>(a: Expr<A>, b: number, t: In<NumTy>): Expr<A>;
export function mix<B extends NumTy>(a: number, b: Expr<B>, t: In<NumTy>): Expr<B>;
export function mix<A extends NumTy>(a: Expr<A>, b: Lit, t: In<NumTy>): Expr<A extends "f32" ? VecTy : A>;
export function mix<B extends NumTy>(a: Lit, b: Expr<B>, t: In<NumTy>): Expr<B extends "f32" ? VecTy : B>;
export function mix(a: Lit, b: Lit, t: In<NumTy>): Expr<VecTy>;
export function mix<A extends NumTy = "f32", B extends NumTy = "f32">(a: Expr<A> | number | Lit, b: Expr<B> | number | Lit, t: In<NumTy>): Expr<Wider<A, B>>;
export function mix(a: In<NumTy>, b: In<NumTy>, t: In<NumTy>): Expr {
  // The blend factor may be the only vector: the result is then a vector too.
  return call("mix", wider("mix", lift(a).ty, lift(b).ty, lift(t).ty), [a, b, t]);
}
/** `clamp(x, lo, hi)`: x limited to the range from lo to hi, componentwise; lo and hi may be scalars. */
export function clamp(x: number, lo: number, hi: number): Expr<"f32">;
export function clamp<A extends NumTy>(x: Expr<A>, lo: In<NumTy>, hi: In<NumTy>): Expr<A>;
export function clamp(x: Lit, lo: In<NumTy>, hi: In<NumTy>): Expr<VecTy>;
export function clamp<A extends NumTy = "f32">(x: Expr<A> | number | Lit, lo: In<NumTy>, hi: In<NumTy>): Expr<A>;
export function clamp(x: In<NumTy>, lo: In<NumTy>, hi: In<NumTy>): Expr {
  return call("clamp", lift(x).ty, [x, lo, hi]);
}
/**
 * `smoothstep(lo, hi, x)`: 0 below lo, 1 above hi, and the smooth cubic 3t^2 - 2t^3 of t = (x - lo) / (hi - lo) between;
 * componentwise in x, with scalar edges. lo must be below hi.
 */
export function smoothstep(lo: number, hi: number, x: number): Expr<"f32">;
export function smoothstep<A extends NumTy>(lo: In<NumTy>, hi: In<NumTy>, x: Expr<A>): Expr<A>;
export function smoothstep<A extends NumTy = "f32">(lo: In<NumTy>, hi: In<NumTy>, x: Expr<A> | number | Lit): Expr<A>;
export function smoothstep(lo: In<NumTy>, hi: In<NumTy>, x: In<NumTy>): Expr {
  return call("smoothstep", wider("smoothstep", lift(lo).ty, lift(hi).ty, lift(x).ty), [lo, hi, x]);
}
/** `length(v)`: the Euclidean length of a vector (the absolute value of a scalar), as an f32. */
export const length = (a: In<NumTy>): Expr<"f32"> => call("length", "f32", [a]) as Expr<"f32">;
/** `distance(a, b)`: the Euclidean distance between two points of the same vector type, as an f32. */
export const distance = (a: In<NumTy>, b: In<NumTy>): Expr<"f32"> => call("distance", "f32", [a, b]) as Expr<"f32">;
/** `dot(a, b)`: the dot product of two vectors of the same type, as an f32. */
export const dot = (a: In<NumTy>, b: In<NumTy>): Expr<"f32"> => call("dot", "f32", [a, b]) as Expr<"f32">;
/** `cross(a, b)`: the cross product of two vec3, a vec3 perpendicular to both. */
export const cross = (a: In<"vec3">, b: In<"vec3">): Expr<"vec3"> => call("cross", "vec3", [a, b]) as Expr<"vec3">;

const compare = (fn: Fn) => (a: In<"f32">, b: In<"f32">): Expr<"bool"> => call(fn, "bool", [a, b]) as Expr<"bool">;
/** `lt(a, b)`: whether a < b, for two f32 values; a bool. */
export const lt = compare("lt");
/** `gt(a, b)`: whether a > b, for two f32 values; a bool. */
export const gt = compare("gt");
/** `le(a, b)`: whether a <= b, for two f32 values; a bool. */
export const le = compare("le");
/** `ge(a, b)`: whether a >= b, for two f32 values; a bool. */
export const ge = compare("ge");
/**
 * Exact equality and inequality of two f32 values. Both backends compare the values they computed, so they agree
 * whenever the operands are exact in f32 on both (whole numbers below 2^24: copy indices, cycle numbers, hashed cell
 * ids); a value the CPU computes in f64 and the GPU in f32 (0.1 + 0.2) may compare differently. Compare indices, not
 * measurements.
 */
export const eq = compare("eq"), ne = compare("ne");
/** `and(a, b)`: whether both bools hold (WGSL `&&`; both sides are always evaluated). */
export const and = (a: In<"bool">, b: In<"bool">): Expr<"bool"> => call("and", "bool", [a, b]) as Expr<"bool">;
/** `or(a, b)`: whether either bool holds (WGSL `||`; both sides are always evaluated). */
export const or = (a: In<"bool">, b: In<"bool">): Expr<"bool"> => call("or", "bool", [a, b]) as Expr<"bool">;
/** `not(a)`: the opposite of a bool. */
export const not = (a: In<"bool">): Expr<"bool"> => call("not", "bool", [a]) as Expr<"bool">;
/** `yes` where the condition holds, otherwise `no`. Both sides are always evaluated. */
export function select(cond: In<"bool">, yes: number, no: number): Expr<"f32">;
export function select<A extends NumTy, B extends NumTy>(cond: In<"bool">, yes: Expr<A>, no: Expr<B>): Expr<Wider<A, B>>;
export function select<A extends NumTy>(cond: In<"bool">, yes: Expr<A>, no: number): Expr<A>;
export function select<B extends NumTy>(cond: In<"bool">, yes: number, no: Expr<B>): Expr<B>;
export function select<A extends NumTy>(cond: In<"bool">, yes: Expr<A>, no: Lit): Expr<A extends "f32" ? VecTy : A>;
export function select<B extends NumTy>(cond: In<"bool">, yes: Lit, no: Expr<B>): Expr<B extends "f32" ? VecTy : B>;
export function select<A extends NumTy = "f32", B extends NumTy = "f32">(cond: In<"bool">, yes: Expr<A> | number | Lit, no: Expr<B> | number | Lit): Expr<Wider<A, B>>;
export function select(cond: In<"bool">, yes: In<NumTy>, no: In<NumTy>): Expr {
  return call("select", wider("select", lift(yes).ty, lift(no).ty), [cond, yes, no]);
}

/**
 * `values[i]` for a whole-number index expression `i` in [0, values.length): one `select` on `i == k` per value after
 * the first. Outside that range the index is an error the GPU cannot report: it reads the first value (as `fetch`
 * leaves an out-of-range index undefined, callers keep it in range). For a per-copy constant (an arch's height, a
 * bell's length) chosen by the copy's index.
 */
export function pick<T extends NumTy>(i: In<"f32">, values: readonly Expr<T>[]): Expr<T>;
export function pick(i: In<"f32">, values: readonly number[]): Expr<"f32">;
export function pick(i: In<"f32">, values: readonly (Expr<NumTy> | number)[]): Expr {
  if (values.length === 0) throw new Error("pick: no values to pick from");
  const xs = values.map((v) => lift(v as In<NumTy>));
  return xs.slice(1).reduce<Expr>((acc, v, k) => select(eq(i, k + 1), v as Expr<NumTy>, acc as Expr<NumTy>), xs[0]!);
}

/** Round to the nearest integer, halves upward. Defined as floor(x + 0.5) so both backends agree at ties (WGSL's own `round` goes to even). */
export function round<A extends NumTy = "f32">(x: Expr<A> | number | Lit): Expr<A> { return floor(add(x as Expr<A>, 0.5)) as Expr<A>; }
/** Any component selection, for example `swizzle(p, "zyx")`. The getters (`.x`, `.xy`, `.xyz`, ...) cover the common ones. */
export function swizzle<T extends NumTy>(a: Expr<VecTy>, sel: string): Expr<T> { return get<T>(a, sel); }

/** 2 pi, the angle of a full turn in radians, as a plain number. */
export const TAU = Math.PI * 2;

// ---- walking the graph --------------------------------------------------------------------------------------------

/** The nodes a node reads (a loop's results read its count, its start and what its body reads from outside). */
export function children(e: Expr): readonly Expr[] {
  const n = e.node;
  switch (n.op) {
    case "const": case "var": case "input": case "param": return [];
    case "row": return [n.x];
    case "call": case "vec": case "lib": return n.args;
    case "get": return [n.a];
    case "fetch": return [n.index];
    // The loop's results depend on what it reads from outside; its body is reached through `everything`.
    case "iterate": return [n.loop.count, ...n.loop.init, ...n.loop.outer];
  }
}

/** Every node reachable from the roots, including the bodies of loops (but not the loops' own variables). */
export function everything(roots: readonly Expr[]): Expr[] {
  const out: Expr[] = [];
  const seen = new Set<number>();
  const walk = (list: readonly Expr[]): void => {
    for (const e of list) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      out.push(e);
      if (e.node.op === "iterate") walk(e.node.loop.inner);
    }
  };
  walk(topo(roots));
  return out;
}

/** Every node reachable from the roots, dependencies first. */
export function topo(roots: readonly Expr[]): Expr[] {
  const seen = new Set<number>();
  const out: Expr[] = [];
  const visit = (e: Expr): void => {
    if (seen.has(e.id)) return;
    seen.add(e.id);
    for (const c of children(e)) visit(c);
    out.push(e);
  };
  for (const r of roots) visit(r);
  return out;
}

/**
 * Split the nodes reachable from `roots` by whether they depend on any of `vars` (free variables): `inner` do, in
 * dependency order; `outer` are the nodes that do not but are read by an inner node or are roots themselves (what a
 * loop computes once, before it starts).
 */
export function splitOn(roots: readonly Expr[], vars: readonly Expr[]): { inner: Expr[]; outer: Expr[] } {
  const own = new Set(vars.map((v) => v.id));
  const dependent = new Set<number>();
  const inner: Expr[] = [];
  for (const e of topo(roots)) {
    if (own.has(e.id)) continue;
    if (children(e).some((c) => own.has(c.id) || dependent.has(c.id))) { dependent.add(e.id); inner.push(e); }
  }
  const outer = new Map<number, Expr>();
  for (const e of inner) for (const c of children(e)) if (!own.has(c.id) && !dependent.has(c.id)) outer.set(c.id, c);
  for (const e of roots) if (!own.has(e.id) && !dependent.has(e.id)) outer.set(e.id, e);
  return { inner, outer: [...outer.values()] };
}

/** The leaves a set of expressions depends on: what a compiler must bind before emitting them. */
export function leaves(roots: readonly Expr[]): { vars: Map<string, Ty>; inputs: InputSpec[]; params: ParamSpec[]; rows: Row[]; tables: TableSource[]; libs: LibFn[] } {
  const vars = new Map<string, Ty>();
  const ins = new Map<string, InputSpec>(), ps = new Map<string, ParamSpec>(), rs = new Map<number, Row>();
  const ts = new Set<TableSource>();
  // Loop variables never reach here: `everything` walks a body's nodes, not the loop's own variables.
  for (const e of everything(roots)) {
    const n = e.node;
    if (n.op === "var") vars.set(n.name, n.ty);
    else if (n.op === "input") ins.set(n.spec.name, n.spec);
    else if (n.op === "param") ps.set(n.spec.name, n.spec);
    else if (n.op === "row") rs.set(n.row.id, n.row);
    else if (n.op === "fetch") ts.add(n.table);
  }
  return { vars, inputs: [...ins.values()], params: [...ps.values()], rows: [...rs.values()], tables: [...ts], libs: libsOf(roots) };
}

/** The library functions a set of expressions uses, each after the functions it depends on. */
export function libsOf(roots: readonly Expr[]): LibFn[] {
  const out: LibFn[] = [];
  const seen = new Set<LibFn>();
  const byName = new Map<string, LibFn>();
  const add = (fn: LibFn): void => {
    if (seen.has(fn)) return;
    // Two different definitions under one name would both be placed in the module and fail to compile there with an
    // error that does not say why. A function reached only through `deps` never passes through `lib()`, so check here.
    const other = byName.get(fn.name);
    if (other && other !== fn) throw new Error(`library function "${fn.name}" is defined by two different objects`);
    byName.set(fn.name, fn);
    seen.add(fn);
    for (const d of fn.deps ?? []) add(d);
    out.push(fn);
  };
  for (const e of everything(roots)) if (e.node.op === "lib") add(e.node.fn);
  return out;
}

// ---- emitting code ------------------------------------------------------------------------------------------------

/** How a backend spells the leaves. Each returns source text in the target language. */
export type Bind = {
  variable(name: string, ty: Ty): string;
  input(spec: InputSpec): string;
  param(spec: ParamSpec): string;
  /** A vec4 lookup of `row` at the already-emitted scalar source `x`. */
  row(row: Row, x: string): string;
  /** vec4 `lane` of entry `index` (already-emitted f32 source, an integer value) of a per-frame table. */
  table(table: TableSource, index: string, lane: number): string;
};

/**
 * A WGSL f32 literal: the shortest decimal that WGSL reads as the same f32 as `n` (a folded constant is an f32, whose
 * full f64 spelling has up to 17 digits; every literal is converted to f32 where it is used, so the shorter spelling
 * is the same value).
 */
const lit = (n: number): string => {
  if (Number.isInteger(n)) return n.toFixed(1);
  const f = Math.fround(n);
  for (let p = 1; p < 17; p++) { const s = n.toPrecision(p); if (Math.fround(Number(s)) === f) return String(Number(s)); }
  return String(n);
};
export const WGSL_TY: Readonly<Record<Ty, string>> = { f32: "f32", vec2: "vec2<f32>", vec3: "vec3<f32>", vec4: "vec4<f32>", bool: "bool" };

/** Fns whose WGSL form needs every argument to have the result's type (a scalar is splatted to a vector). */
// `mix` and `select` are here because one branch may be a scalar and the other a vector: WGSL wants both the result's
// type, and without the splat the emitted call does not compile (found by the differentiation module).
const SPLAT: ReadonlySet<Fn> = new Set<Fn>(["min", "max", "pow", "atan2", "step", "clamp", "smoothstep", "mix", "select"]);
const INFIX: Partial<Record<Fn, string>> = { add: "+", sub: "-", mul: "*", div: "/", lt: "<", gt: ">", le: "<=", ge: ">=", eq: "==", ne: "!=", and: "&&", or: "||" };

function wgslNode(e: Expr, ref: (x: Expr) => string, bind: Bind): string {
  const n = e.node;
  switch (n.op) {
    case "const":
      if (n.ty === "bool") return n.v[0] ? "true" : "false";
      return n.ty === "f32" ? lit(n.v[0]) : `${WGSL_TY[n.ty]}(${n.v.map(lit).join(", ")})`;
    case "var": return bind.variable(n.name, n.ty);
    case "input": return bind.input(n.spec);
    case "param": return bind.param(n.spec);
    case "row": return bind.row(n.row, ref(n.x));
    case "vec": return `${WGSL_TY[n.ty]}(${n.args.map(ref).join(", ")})`;
    case "get": return `${ref(n.a)}.${n.sel}`;
    case "lib": return `${n.fn.name}(${n.args.map(ref).join(", ")})`;
    case "fetch": return bind.table(n.table, ref(n.index), n.lane);
    case "iterate": throw new Error("internal: a loop is emitted as statements, not as an expression");
    case "call": {
      const splat = (a: Expr): string => (SPLAT.has(n.fn) && n.ty !== "f32" && a.ty === "f32" ? `${WGSL_TY[n.ty]}(${ref(a)})` : ref(a));
      const a = n.args.map(splat);
      const infix = INFIX[n.fn];
      if (infix) return `(${a[0]} ${infix} ${a[1]})`;
      switch (n.fn) {
        case "neg": return `(-${a[0]})`;
        case "not": return `(!${a[0]})`;
        case "mod": return `(${a[0]} - ${a[1]} * floor(${a[0]} / ${a[1]}))`;
        case "select": return `select(${a[2]}, ${a[1]}, ${a[0]})`; // WGSL order is (false, true, condition)
        default: return `${n.fn}(${a.join(", ")})`;
      }
    }
  }
}

/**
 * WGSL statements for a set of expressions: one `let` per shared node, in dependency order, and a `for` loop per
 * `iterate`. Returns the statements, for each root the name (or inline source) that holds its value, and the library
 * functions the statements call.
 */
export function emitWgsl(roots: readonly Expr[], bind: Bind, prefix = "e", pre: ReadonlyMap<number, string> = new Map()): { lines: string[]; out: string[]; libs: LibFn[]; names: ReadonlyMap<number, string> } {
  // `pre`: nodes already computed by earlier statements (a scan hoists its loop-invariant work), by name.
  const names = new Map<number, string>(pre);
  const ref = (x: Expr): string => names.get(x.id)!;
  const emit = (list: readonly Expr[], lines: string[]): void => {
    for (const e of list) {
      if (names.has(e.id)) continue;
      const n = e.node;
      if (n.op === "iterate") { loop(n.loop, lines); continue; }
      const src = wgslNode(e, ref, bind);
      if (n.op === "const" || n.op === "var") names.set(e.id, src);
      else {
        const name = `${prefix}${e.id}`;
        lines.push(`let ${name}: ${WGSL_TY[e.ty]} = ${src};`);
        names.set(e.id, name);
      }
    }
  };
  const loop = (l: Loop, lines: string[]): void => {
    const L = `${prefix}L${l.id}`;
    l.init.forEach((e, j) => lines.push(`var ${L}s${j}: ${WGSL_TY[e.ty]} = ${ref(e)};`));
    lines.push(`for (var ${L}i = 0u; ${L}i < u32(${ref(l.count)}); ${L}i++) {`);
    l.state.forEach((v, j) => names.set(v.id, `${L}s${j}`));
    names.set(l.index.id, `f32(${L}i)`);
    const body: string[] = [];
    emit(l.inner, body);
    // Read every next value before assigning any: a step may return one state variable as another (a swap).
    l.next.forEach((e, j) => body.push(`let ${L}n${j}: ${WGSL_TY[e.ty]} = ${ref(e)};`));
    l.next.forEach((_, j) => body.push(`${L}s${j} = ${L}n${j};`));
    lines.push(...body.map((b) => `  ${b}`), "}");
    // The body's names are scoped to the loop.
    for (const e of [...l.inner, ...l.state, l.index]) names.delete(e.id);
    l.results.forEach((r, j) => names.set(r.id, `${L}s${j}`));
  };
  const lines: string[] = [];
  emit(topo(roots), lines);
  // `libs`: definitions the caller must place at module scope (once per module) for the statements to compile.
  return { lines, out: roots.map(ref), libs: libsOf(roots), names };
}

// ---- rewriting ----------------------------------------------------------------------------------------------------

/** A node with new children, interned under the same key scheme its constructor uses. */
function rebuild(e: Expr, kids: readonly Expr[]): Expr {
  const n = e.node;
  const ids = kids.map((k) => k.id).join(",");
  switch (n.op) {
    case "const": case "var": case "input": case "param": return e;
    case "row": return Expr.make({ ...n, x: kids[0] as Expr<"f32"> }, `r:${n.row.id}:${kids[0].id}`);
    case "lib": return Expr.make({ ...n, args: kids }, `l:${n.fn.name}:${ids}`);
    case "call": return Expr.make({ ...n, args: kids }, `f:${n.fn}:${ids}`);
    case "vec": return Expr.make({ ...n, args: kids }, `V:${n.ty}:${ids}`);
    case "get": return Expr.make({ ...n, a: kids[0] }, `g:${kids[0].id}:${n.sel}`);
    case "fetch": return Expr.make({ ...n, index: kids[0] as Expr<"f32"> }, `F:${tableId(n.table)}:${n.lane}:${kids[0].id}`);
    case "iterate": throw new Error("internal: loops are rebuilt by `substitute`, not `rebuild`");
  }
}

/**
 * The same expressions with every occurrence of `from` replaced by `to`. This is how a body is taken at another time:
 * substitute `time` with `time + offset` (or with an input) in everything it is built from.
 */
export function substitute(roots: readonly Expr[], from: Expr, to: Expr): Expr[] {
  if (from.ty !== to.ty) throw new Error(`substitute: cannot replace a ${from.ty} with a ${to.ty}`);
  return replace(roots, new Map([[from.id, to]]));
}

/** The same expressions with each node whose id is a key of `by` replaced by its value (of the same type). */
export function replace(roots: readonly Expr[], by: ReadonlyMap<number, Expr>): Expr[] {
  const done = new Map<number, Expr>();
  const loops = new Map<number, readonly Expr[]>();
  for (const e of topo(roots)) {
    const to = by.get(e.id);
    if (to !== undefined) {
      if (to.ty !== e.ty) throw new Error(`replace: cannot replace a ${e.ty} with a ${to.ty}`);
      done.set(e.id, to);
      continue;
    }
    const n = e.node;
    if (n.op === "iterate") {
      // A loop whose outside changed is a new loop: the step runs again with fresh variables (sharing the old body's
      // variables would let two loops' bodies share hash-consed nodes, which are scoped to one loop each).
      const kids = children(e);
      if (kids.every((k) => done.get(k.id) === k)) { done.set(e.id, e); continue; }
      let made = loops.get(n.loop.id);
      if (!made) {
        const l = n.loop;
        made = iterate(done.get(l.count.id) as Expr<"f32">, l.init.map((x) => done.get(x.id)! as Expr<NumTy>), (s, i) => replace(l.step(s, i), by) as Expr<NumTy>[]);
        loops.set(n.loop.id, made);
      }
      done.set(e.id, made[n.k]);
      continue;
    }
    const kids = children(e), mapped = kids.map((k) => done.get(k.id)!);
    done.set(e.id, mapped.every((k, i) => k === kids[i]) ? e : rebuild(e, mapped));
  }
  return roots.map((r) => done.get(r.id)!);
}

// ---- the JavaScript backend ---------------------------------------------------------------------------------------
//
// Scalarised: every vector node becomes one JS local per component, so evaluation allocates nothing but the returned
// roots (and the arguments of library calls, whose CPU twins take arrays). Constant subgraphs are folded while code is
// emitted: an operation whose operands are all known is computed once, at compile time, by the same function the
// emitted code would have called, so folding cannot change a result. The pose pass is full of these (a tip law at a
// station's fixed m, a spline's kernel weights at a fixed parameter). Curve-row lookups are never folded: their tables
// can be edited at run time. Exact identities (x * 0, x * 1, x + 0) are applied too, which is why a spline evaluated
// at a constant m costs only its four nonzero terms; for a non-finite x they give 0 where the GPU would give NaN.

/** A CPU value: a number, or the components of a vector. */
export type V = number | number[];
type Scalar = number | boolean;
/** One component during emission: source text, or a value known at compile time. */
type C = string | Scalar;

const jsLit = (x: Scalar): string => (typeof x === "boolean" ? String(x) : x < 0 || Object.is(x, -0) ? `(${x})` : String(x));
const src = (c: C): string => (typeof c === "string" ? c : jsLit(c));
const allKnown = (cs: readonly C[]): cs is Scalar[] => cs.every((c) => typeof c !== "string");

const smooth = (lo: number, hi: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};
/** Helpers the emitted code calls (functions too long to inline). */
const HELPERS = { ss: smooth };

/** A scalar operation: its source form, and its value as the same function (used to fold). */
type Op = { readonly js: (...a: string[]) => string; readonly f: (...a: never[]) => Scalar };
const op = <A extends Scalar[]>(js: (...a: string[]) => string, f: (...a: A) => Scalar): Op => ({ js, f: f as unknown as Op["f"] });
const math1 = (name: string, f: (x: number) => number) => op((a) => `Math.${name}(${a})`, f);

/** Operations applied component by component (scalars broadcast). Semantics match WGSL for every op it emits. */
const EACH: Partial<Record<Fn, Op>> = {
  add: op((a, b) => `(${a} + ${b})`, (a: number, b: number) => a + b),
  sub: op((a, b) => `(${a} - ${b})`, (a: number, b: number) => a - b),
  mul: op((a, b) => `(${a} * ${b})`, (a: number, b: number) => a * b),
  div: op((a, b) => `(${a} / ${b})`, (a: number, b: number) => a / b),
  min: op((a, b) => `Math.min(${a}, ${b})`, Math.min), max: op((a, b) => `Math.max(${a}, ${b})`, Math.max),
  pow: op((a, b) => `Math.pow(${a}, ${b})`, Math.pow), atan2: op((a, b) => `Math.atan2(${a}, ${b})`, Math.atan2),
  mod: op((a, b) => `(${a} - ${b} * Math.floor(${a} / ${b}))`, (a: number, b: number) => a - b * Math.floor(a / b)),
  step: op((e, x) => `(${x} >= ${e} ? 1 : 0)`, (e: number, x: number) => (x >= e ? 1 : 0)),
  neg: op((a) => `(-${a})`, (a: number) => -a),
  abs: math1("abs", Math.abs), sign: math1("sign", Math.sign), floor: math1("floor", Math.floor), sqrt: math1("sqrt", Math.sqrt),
  exp: math1("exp", Math.exp), log: math1("log", Math.log), sin: math1("sin", Math.sin), cos: math1("cos", Math.cos), tan: math1("tan", Math.tan),
  fract: op((a) => `(${a} - Math.floor(${a}))`, (a: number) => a - Math.floor(a)),
  saturate: op((a) => `Math.min(1, Math.max(0, ${a}))`, (a: number) => Math.min(1, Math.max(0, a))),
  mix: op((a, b, t) => `(${a} + (${b} - ${a}) * ${t})`, (a: number, b: number, t: number) => a + (b - a) * t),
  clamp: op((x, lo, hi) => `Math.min(${hi}, Math.max(${lo}, ${x}))`, (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))),
  smoothstep: op((lo, hi, x) => `H.ss(${lo}, ${hi}, ${x})`, smooth),
  lt: op((a, b) => `(${a} < ${b})`, (a: number, b: number) => a < b), gt: op((a, b) => `(${a} > ${b})`, (a: number, b: number) => a > b),
  le: op((a, b) => `(${a} <= ${b})`, (a: number, b: number) => a <= b), ge: op((a, b) => `(${a} >= ${b})`, (a: number, b: number) => a >= b),
  eq: op((a, b) => `(${a} === ${b})`, (a: number, b: number) => a === b), ne: op((a, b) => `(${a} !== ${b})`, (a: number, b: number) => a !== b),
  and: op((a, b) => `(${a} && ${b})`, (a: boolean, b: boolean) => a && b), or: op((a, b) => `(${a} || ${b})`, (a: boolean, b: boolean) => a || b),
  not: op((a) => `(!${a})`, (a: boolean) => !a),
};
const SELECT = op((c, y, n) => `(${c} ? ${y} : ${n})`, (c: boolean, y: number, n: number) => (c ? y : n));

/** x * 0, x * 1, x + 0, x - 0, x / 1: the identities that make a sum of mostly-zero weights cost only its terms. */
function identity(fn: Fn, a: C, b: C): C | undefined {
  switch (fn) {
    case "mul": return a === 0 || b === 0 ? 0 : a === 1 ? b : b === 1 ? a : undefined;
    case "add": return a === 0 ? b : b === 0 ? a : undefined;
    case "sub": return b === 0 ? a : undefined;
    case "div": return b === 1 ? a : undefined;
    default: return undefined;
  }
}

/** Where curve rows are read from on the CPU. */
export type RowSource =
  /** Each row's own samples, as authored (one-off evaluation, tests). */
  | { readonly kind: "own" }
  /**
   * A curve table laid out by slot, passed in `Env.curves` on every call: a compiled artefact's pose, so a host's
   * `setCurves` edit reaches the CPU exactly as it reaches the GPU.
   */
  | { readonly kind: "table"; readonly slot: (r: Row) => number };
const OWN_ROWS: RowSource = { kind: "own" };

/** What the CPU evaluator reads leaves from. */
export type Env = {
  readonly vars: Readonly<Record<string, V | boolean>>;
  readonly inputs: Readonly<Record<string, V>>;
  readonly params: Readonly<Record<string, number>>;
  /** The curve table, required by functions compiled with a `table` row source (and ignored by the others). */
  readonly curves?: Float32Array;
  /** This frame's per-frame tables, required by functions that `fetch`. */
  readonly tables?: (t: TableSource) => Float32Array;
};

const COMPS: Record<Ty, number> = { f32: 1, vec2: 2, vec3: 3, vec4: 4, bool: 1 };

/**
 * Compile expressions to one JavaScript function. Call it with an `Env`; it returns one value per root
 * (a number, an array for vectors, a boolean). Missing inputs and params take their declared defaults.
 */
export function compileJs(roots: readonly Expr[], rows: RowSource = OWN_ROWS): (env: Env) => (V | boolean)[] {
  const ownRows: Row[] = [];
  const fns: LibFn[] = [];
  const tableList: TableSource[] = [];
  const head: string[] = [];
  let body: string[] = [];
  const top = body;
  const comps = new Map<number, C[]>();
  let n = 0;
  const local = (code: string): string => { const name = `t${n++}`; body.push(`const ${name} = ${code};`); return name; };
  const apply = (o: Op, xs: readonly C[]): C => (allKnown(xs) ? o.f(...(xs as never[])) : local(o.js(...xs.map(src))));
  const at = (cs: readonly C[], i: number): C => (cs.length === 1 ? cs[0] : cs[i]);
  const each = (fn: Fn, args: readonly C[][]): C[] => {
    const o = EACH[fn]!;
    const width = Math.max(...args.map((a) => a.length));
    return Array.from({ length: width }, (_, i) => {
      const xs = args.map((a) => at(a, i));
      return (xs.length === 2 ? identity(fn, xs[0], xs[1]) : undefined) ?? apply(o, xs);
    });
  };
  const sum = (cs: readonly C[]): C => cs.reduce((s, c) => each("add", [[s], [c]])[0]);
  const dot = (a: readonly C[], b: readonly C[]): C => sum(each("mul", [a as C[], b as C[]]));
  const leaf = (code: string, ty: Ty): C[] => {
    const name = local(code);
    return COMPS[ty] === 1 ? [name] : Array.from({ length: COMPS[ty] }, (_, i) => `${name}[${i}]`);
  };
  const rowAt = (r: Row, x: C): C[] => {
    const [arr, off] = rows.kind === "own" ? [`rows[${ownRows.push(r) - 1}]`, 0] : ["curves", rows.slot(r) * CURVE_N * 4];
    const read = (i: C, c: number): string => (typeof i === "number" ? `${arr}[${off + i * 4 + c}]` : `${arr}[${off + c} + ${i} * 4]`);
    if (typeof x === "number") {
      const s = Math.min(1, Math.max(0, x)) * (CURVE_N - 1);
      const i = Math.min(CURVE_N - 2, Math.floor(s)), t = s - i;
      return [0, 1, 2, 3].map((c) => local(`${read(i, c)} * ${jsLit(1 - t)} + ${read(i + 1, c)} * ${jsLit(t)}`));
    }
    const s = local(`Math.min(1, Math.max(0, ${src(x)})) * ${CURVE_N - 1}`);
    const i = local(`Math.min(${CURVE_N - 2}, Math.floor(${s}))`), t = local(`${s} - ${i}`);
    return [0, 1, 2, 3].map((c) => local(`${read(i, c)} * (1 - ${t}) + ${arr}[${off + c} + (${i} + 1) * 4] * ${t}`));
  };
  /** Each table is looked up once per call, before anything else runs. */
  const tableVar = (t: TableSource): string => {
    let k = tableList.indexOf(t);
    if (k < 0) { k = tableList.push(t) - 1; head.push(`const T${k} = tables(tsrc[${k}]);`); }
    return `T${k}`;
  };
  // The GPU reads entry u32(index): truncation toward zero, which `| 0` matches for the in-range indices allowed.
  const fetchAt = (t: TableSource, i: C, lane: number): C[] => {
    const T = tableVar(t);
    if (typeof i === "number") { const o = (Math.trunc(i) * t.lanes + lane) * 4; return [0, 1, 2, 3].map((c) => `${T}[${o + c}]`); }
    const o = local(`(${src(i)} | 0) * ${t.lanes * 4} + ${lane * 4}`);
    return [0, 1, 2, 3].map((c) => local(`${T}[${o} + ${c}]`));
  };

  const emitList = (list: readonly Expr[]): void => {
    for (const e of list) {
      if (comps.has(e.id)) continue;
      const nd = e.node;
      if (nd.op === "iterate") { loop(nd.loop); continue; }
      comps.set(e.id, node(e));
    }
  };
  /** A loop: its state as mutable locals (one per component), the body emitted once inside a `for`. */
  const loop = (l: Loop): void => {
    const L = `L${l.id}`;
    const stateNames = l.init.map((e, j) => Array.from({ length: COMPS[e.ty] }, (_, c) => `${L}s${j}_${c}`));
    l.init.forEach((e, j) => {
      const c = comps.get(e.id)!;
      body.push(`let ${stateNames[j].map((name, k) => `${name} = ${src(at(c, k))}`).join(", ")};`);
    });
    const count = comps.get(l.count.id)![0];
    body.push(`for (let ${L}i = 0, ${L}n = Math.trunc(${src(count)}); ${L}i < ${L}n; ${L}i++) {`);
    const outer = body;
    body = [];
    l.state.forEach((v, j) => comps.set(v.id, stateNames[j]));
    comps.set(l.index.id, [`${L}i`]);
    emitList(l.inner);
    // Read every next value before assigning any (a step may swap state components).
    const nexts = l.next.map((e) => comps.get(e.id)!.map((c) => (typeof c === "string" ? local(c) : c)));
    l.next.forEach((e, j) => stateNames[j].forEach((name, k) => body.push(`${name} = ${src(at(nexts[j], k))};`)));
    outer.push(...body.map((b) => `  ${b}`), "}");
    body = outer;
    for (const e of [...l.inner, ...l.state, l.index]) comps.delete(e.id);
    l.results.forEach((r, j) => comps.set(r.id, stateNames[j]));
  };
  const node = (e: Expr): C[] => {
    const nd = e.node;
    const kid = (x: Expr): C[] => comps.get(x.id)!;
    switch (nd.op) {
      case "const": return nd.ty === "bool" ? [nd.v[0] !== 0] : [...nd.v];
      case "var": return leaf(`vars[${JSON.stringify(nd.name)}]`, nd.ty);
      case "input": return leaf(`(inputs[${JSON.stringify(nd.spec.name)}] ?? ${nd.spec.def.length === 1 ? nd.spec.def[0] : `[${nd.spec.def.join(",")}]`})`, nd.ty);
      case "param": return leaf(`(params[${JSON.stringify(nd.spec.name)}] ?? ${nd.spec.def})`, "f32");
      case "row": return rowAt(nd.row, kid(nd.x)[0]);
      case "fetch": return fetchAt(nd.table, kid(nd.index)[0], nd.lane);
      case "iterate": throw new Error("internal: a loop is emitted as statements");
      case "vec": {
        const parts = nd.args.flatMap(kid);
        return parts.length === 1 ? Array.from({ length: COMPS[nd.ty] }, () => parts[0]) : parts;
      }
      case "get": { const a = kid(nd.a); return [...nd.sel].map((ch) => a["xyzw".indexOf(ch)]); }
      case "lib": {
        if (nd.fn.js === "gpu-only") throw new Error(`library function "${nd.fn.name}" is GPU-only and cannot be evaluated on the CPU`);
        if (!fns.includes(nd.fn)) fns.push(nd.fn);
        const args = nd.args.map((a) => { const c = kid(a); return c.length === 1 ? src(c[0]) : `[${c.map(src).join(", ")}]`; });
        return leaf(`fns[${fns.indexOf(nd.fn)}](${args.join(", ")})`, nd.ty);
      }
      case "call": {
        const a = nd.args.map(kid);
        switch (nd.fn) {
          case "normalize": {
            if (a[0].length === 1) return each("sign", a);
            const l = apply(EACH.sqrt!, [dot(a[0], a[0])]);
            return each("div", [a[0], [l]]);
          }
          case "length": return [apply(EACH.sqrt!, [dot(a[0], a[0])])];
          case "distance": { const d = each("sub", a); return [apply(EACH.sqrt!, [dot(d, d)])]; }
          case "dot": return [dot(a[0], a[1])];
          case "cross": {
            const [x, y] = a;
            const term = (i: number, j: number): C => each("sub", [each("mul", [[x[i]], [y[j]]]), each("mul", [[x[j]], [y[i]]])])[0];
            return [term(1, 2), term(2, 0), term(0, 1)];
          }
          case "select": {
            const c = a[0][0];
            const width = Math.max(a[1].length, a[2].length);
            return Array.from({ length: width }, (_, i) => (typeof c === "boolean" ? (c ? at(a[1], i) : at(a[2], i)) : apply(SELECT, [c, at(a[1], i), at(a[2], i)])));
          }
          default: return each(nd.fn, a);
        }
      }
    }
  };

  emitList(topo(roots));
  const value = (r: Expr): string => { const c = comps.get(r.id)!; return r.ty === "f32" || r.ty === "bool" ? src(c[0]) : `[${c.map(src).join(", ")}]`; };
  top.push(`return [${roots.map(value).join(", ")}];`);
  const run = new Function("H", "rows", "fns", "vars", "inputs", "params", "curves", "tables", "tsrc", [...head, ...top].join("\n")) as
    (h: typeof HELPERS, rows: Float32Array[], fns: LibFn["js"][], vars: Env["vars"], inputs: Env["inputs"], params: Env["params"], curves: Float32Array | undefined, tables: Env["tables"], tsrc: TableSource[]) => (V | boolean)[];
  const samples = ownRows.map((r) => r.samples);
  const impls = fns.map((fn) => fn.js);
  const needCurves = rows.kind === "table" && /\bcurves\[/.test(top.join("\n"));
  return (env) => {
    if (needCurves && !env.curves) throw new Error("compileJs: this function reads curves from a table; pass Env.curves");
    if (tableList.length > 0 && !env.tables) throw new Error(`compileJs: this function reads the per-frame table "${tableList[0].name}"; pass Env.tables`);
    return run(HELPERS, samples, impls, env.vars, env.inputs, env.params, env.curves, env.tables, tableList);
  };
}

// ---- folding ------------------------------------------------------------------------------------------------------

const F32 = Math.fround;
/** A constant node's components (f32-rounded), or undefined when a node is not a known constant. */
type Known = readonly Scalar[] | undefined;
const f32s = (xs: readonly Scalar[]): Scalar[] => xs.map((x) => (typeof x === "number" ? F32(x) : x));

/**
 * The value of a node whose operands are all known, in f32: every operation rounds its result to f32, as the GPU
 * would (a compound operation such as `mix` or `smoothstep` is computed in f64 and rounded once). Undefined when an
 * operand is unknown, the node is not foldable (a leaf the host sets, a curve row, a fetch, a loop, a GPU-only library
 * function), or the value is not finite. The semantics are those of the JavaScript backend (`EACH`), which match WGSL.
 */
function foldNode(e: Expr, kid: (x: Expr) => Known): Known {
  const n = e.node;
  switch (n.op) {
    case "const": return n.ty === "bool" ? [n.v[0] !== 0] : n.v.map(F32);
    case "var": case "input": case "param": case "row": case "fetch": case "iterate": return undefined;
    case "vec": {
      const parts = n.args.map(kid);
      if (parts.some((p) => p === undefined)) return undefined;
      const flat = parts.flatMap((p) => p!);
      return flat.length === 1 ? Array.from({ length: COMPS[n.ty] }, () => flat[0]!) : flat;
    }
    case "get": { const a = kid(n.a); return a && [...n.sel].map((ch) => a["xyzw".indexOf(ch)]!); }
    case "lib": {
      const js = n.fn.js;
      if (js === "gpu-only") return undefined;
      const args = n.args.map(kid);
      if (args.some((a) => a === undefined)) return undefined;
      const r = js(...args.map((a) => (a!.length === 1 ? a![0] : [...a!])));
      return f32s(typeof r === "object" ? r : [r]);
    }
    case "call": {
      const a = n.args.map(kid);
      if (a.some((x) => x === undefined)) return undefined;
      const xs = a as readonly (readonly Scalar[])[];
      const at = (cs: readonly Scalar[], i: number): Scalar => (cs.length === 1 ? cs[0]! : cs[i]!);
      const num = (cs: readonly Scalar[]): number[] => cs as number[];
      const dot = (p: readonly number[], q: readonly number[]): number => p.reduce((s, x, i) => F32(s + F32(x * q[i]!)), 0);
      switch (n.fn) {
        case "normalize": {
          const v = num(xs[0]!);
          if (v.length === 1) return [Math.sign(v[0]!)];
          const l = F32(Math.sqrt(dot(v, v)));
          return v.map((x) => F32(x / l));
        }
        case "length": { const v = num(xs[0]!); return [F32(Math.sqrt(dot(v, v)))]; }
        case "distance": { const d = num(xs[0]!).map((x, i) => F32(x - num(xs[1]!)[i]!)); return [F32(Math.sqrt(dot(d, d)))]; }
        case "dot": return [dot(num(xs[0]!), num(xs[1]!))];
        case "cross": {
          const [x, y] = [num(xs[0]!), num(xs[1]!)];
          const term = (i: number, j: number): number => F32(F32(x[i]! * y[j]!) - F32(x[j]! * y[i]!));
          return [term(1, 2), term(2, 0), term(0, 1)];
        }
        case "select": {
          const width = Math.max(xs[1]!.length, xs[2]!.length);
          return Array.from({ length: width }, (_, i) => (xs[0]![0] ? at(xs[1]!, i) : at(xs[2]!, i)));
        }
        default: {
          const o = EACH[n.fn]!;
          const width = Math.max(...xs.map((x) => x.length));
          return Array.from({ length: width }, (_, i) => { const r = o.f(...(xs.map((x) => at(x, i)) as never[])); return typeof r === "number" ? F32(r) : r; });
        }
      }
    }
  }
}

/**
 * Folded form of each node seen (by id), and the constant value of those that are constants. Interned nodes never
 * change, so this holds across calls: a sub-graph many programs share (a sea, a ship's frame) is folded once.
 */
const folded = new Map<number, Expr>();
const foldedValue = new Map<number, Known>();
const foldedLoops = new Map<number, readonly Expr[]>();

/**
 * The same expressions with every constant sub-graph replaced by its value, in f32 (`foldNode`): what a GPU would
 * compute for it at every invocation, computed once at build. Loop bodies are folded through the loop's outside (a
 * constant sub-graph a body reads is outside it); a loop whose outside changed is rebuilt once, as `replace` does.
 */
export function fold(roots: readonly Expr[]): Expr[] {
  const visit = (e: Expr): Expr => {
    const hit = folded.get(e.id);
    if (hit !== undefined) return hit;
    const kids = children(e);
    const to = kids.map(visit);
    let v: Known;
    try { v = foldNode(e, (x) => foldedValue.get(x.id)); } catch { v = undefined; }
    let out: Expr;
    if (v !== undefined && v.every((x) => typeof x === "boolean" || Number.isFinite(x))) {
      foldedValue.set(e.id, v);
      out = e.node.op === "const" ? e : constant(e.ty, v.map((x) => (typeof x === "boolean" ? (x ? 1 : 0) : x)));
      foldedValue.set(out.id, v);
    } else if (to.every((k, i) => k === kids[i])) {
      out = e;
    } else if (e.node.op === "iterate") {
      const n = e.node;
      let made = foldedLoops.get(n.loop.id);
      if (!made) {
        const l = n.loop;
        made = iterate(visit(l.count) as Expr<"f32">, l.init.map((x) => visit(x) as Expr<NumTy>), (st, i) => fold(l.step(st, i)) as Expr<NumTy>[]);
        foldedLoops.set(n.loop.id, made);
      }
      out = made[n.k]!;
    } else {
      out = rebuild(e, to);
    }
    folded.set(e.id, out);
    if (out !== e) folded.set(out.id, out);
    return out;
  };
  return roots.map(visit);
}

/** Evaluate once on the CPU. For repeated evaluation, keep the function from `compileJs`. */
export function evaluate(e: Expr, env: Partial<Env> = {}): V | boolean {
  return compileJs([e])({ vars: env.vars ?? {}, inputs: env.inputs ?? {}, params: env.params ?? {} })[0];
}
