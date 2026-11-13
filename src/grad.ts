// Loft: symbolic differentiation of expressions.
//
// Forward mode on the hash-consed DAG. A derivative is taken along *seeds*: each seeded leaf (a variable, input or
// parameter) carries a direction of its own type, every other leaf is constant. Each node's tangent is computed once
// per call (memoised by node id) from its children's tangents by the node's rule, so shared subexpressions stay shared
// and the result is itself a DAG of ordinary expressions that both backends compile. Tangents are built through
// simplifying constructors (x * 0, x * 1, x + 0, constant folding), so the parts of an expression that do not depend on
// the seeds contribute nothing.
//
// Used for: normals of surfaces and distance fields (`gradient`, `normalOf`), the stretch of a fold or coordinate map
// (`stretchOf`), the Jacobian of a chart (`jacobian`), and pixel footprints that do not spike at fold seams
// (`footprint`). See docs/folding_and_tracing.md section 4.
//
// Piecewise operators are differentiated as the derivative of the piece in effect at the point (the one-sided rule at
// a tie, which is where the derivative does not exist). `floor`, `step`, `sign` and the comparisons are piecewise
// constant and contribute zero; `fract` and `mod` contribute the derivative of their argument, because the function is
// smooth between its jumps. That last rule is what makes footprints seam-free.
import {
  abs, add, and, CURVE_N, cos, cross, div, dot, f, floor, ge, gt, le, length, lib, lift, log, lt, max, min, mul, neg,
  iterate, mix, normalize, pow, row, saturate, select, sign, sin, sqrt, sub, substitute, TAU, topo, variable, vec2, vec3, vec4,
  type Expr, type Fn, type In, type LibFn, type Loop, type NumTy, type Row, type Ty, type VecTy,
} from "./expr.ts";
import { hash2, hash22, hash3, hash33, noise2, noise3 } from "./lib/noise.ts";

// ---- errors -------------------------------------------------------------------------------------------------------

/** Why an expression could not be differentiated. */
export type DerivativeFailure =
  /** A library function with no registered derivative (see `defineDerivative`). */
  | { readonly kind: "no-derivative"; readonly fn: string }
  /** A bool expression: comparisons are piecewise constant and enter derivatives only through `select`. */
  | { readonly kind: "not-numeric"; readonly what: string }
  /** The thing to differentiate with respect to is not a variable, input or parameter leaf, or has the wrong type. */
  | { readonly kind: "bad-variable"; readonly detail: string }
  /** A node kind this module does not know: expr.ts gained a kind and grad.ts was not taught it. */
  | { readonly kind: "unknown-node"; readonly op: string }
  /** A rule produced a tangent of the wrong type: a bug in this module. */
  | { readonly kind: "internal"; readonly detail: string };

const describeFailure = (r: DerivativeFailure): string => {
  switch (r.kind) {
    case "no-derivative": return `library function "${r.fn}" has no registered derivative (register one with defineDerivative)`;
    case "not-numeric": return `cannot differentiate a bool expression (${r.what})`;
    case "bad-variable": return `cannot differentiate with respect to this: ${r.detail}`;
    case "unknown-node": return `grad.ts has no derivative rule for node kind "${r.op}"`;
    case "internal": return `derivative rule bug: ${r.detail}`;
  }
};

export class DerivativeError extends Error {
  constructor(readonly reason: DerivativeFailure) {
    super(describeFailure(reason));
    this.name = "DerivativeError";
  }
}

// ---- simplifying constructors -------------------------------------------------------------------------------------

type E = Expr<NumTy>;
type Op2 = (a: E, b: E) => E;
type Op1 = (a: E) => E;
// expr.ts's operators are overloaded for authoring; internally every value is "some numeric expression".
const ADD = add as unknown as Op2, SUB = sub as unknown as Op2, MUL = mul as unknown as Op2, DIV = div as unknown as Op2;
const MIN = min as unknown as Op2, MAX = max as unknown as Op2, POW = pow as unknown as Op2;
const NEG = neg as unknown as Op1, ABS = abs as unknown as Op1, SIGN = sign as unknown as Op1, FLOOR = floor as unknown as Op1;
const SQRT = sqrt as unknown as Op1, NORMALIZE = normalize as unknown as Op1;
const SAT = saturate as unknown as Op1, LOG = log as unknown as Op1, SIN = sin as unknown as Op1, COS = cos as unknown as Op1;
const SELECT = select as unknown as (c: Expr<"bool">, y: E, n: E) => E;

const SIZE: Record<NumTy, number> = { f32: 1, vec2: 2, vec3: 3, vec4: 4 };
const TY_OF_SIZE: readonly NumTy[] = ["f32", "f32", "vec2", "vec3", "vec4"];
const VEC: Record<VecTy, (...p: E[]) => E> = { vec2, vec3, vec4 };
const COMP: readonly ((e: E) => E)[] = [(e) => e.x, (e) => e.y, (e) => e.z, (e) => e.w];
/** The swizzles expr.ts exposes as getters; others are rebuilt from components. */
const SWIZZLE: Readonly<Record<string, (e: E) => E>> = { xy: (e) => e.xy, xz: (e) => e.xz, xyz: (e) => e.xyz };

/** The value of a constant node; null for anything else (absence is the meaning: "not known at build time"). */
const known = (e: Expr): readonly number[] | null => (e.node.op === "const" ? e.node.v : null);
const allEqual = (e: Expr, v: number): boolean => { const k = known(e); return k !== null && k.every((x) => x === v); };
const isZero = (e: Expr): boolean => allEqual(e, 0);
const isOne = (e: Expr): boolean => allEqual(e, 1);

const constOf = (vals: readonly number[]): E => lift<NumTy>(vals.length === 1 ? vals[0] : vals) as E;
const zero = (ty: NumTy): E => constOf(Array(SIZE[ty]).fill(0));
/** The unit vector along axis i of a leaf of type ty (1 for a scalar). */
const axis = (ty: NumTy, i: number): E => constOf(Array.from({ length: SIZE[ty] }, (_, j) => (i === j ? 1 : 0)));

function widerTy(a: NumTy, b: NumTy): NumTy {
  if (a === "f32") return b;
  if (b === "f32" || a === b) return a;
  throw new DerivativeError({ kind: "internal", detail: `mixed vector types ${a} and ${b}` });
}

/** A scalar broadcast to a vector type (exactly how expr.ts treats an f32 operand of a vector operation). */
function widen(a: E, ty: NumTy): E {
  if (a.ty === ty) return a;
  if (a.ty !== "f32") throw new DerivativeError({ kind: "internal", detail: `cannot widen a ${a.ty} to ${ty}` });
  const k = known(a);
  return k !== null ? constOf(Array(SIZE[ty]).fill(k[0])) : VEC[ty as VecTy](a);
}

/** Fold a binary operation of two constants, broadcasting a scalar against a vector. */
function fold2(a: readonly number[], b: readonly number[], op: (x: number, y: number) => number): E {
  const n = Math.max(a.length, b.length);
  return constOf(Array.from({ length: n }, (_, i) => op(a[a.length === 1 ? 0 : i], b[b.length === 1 ? 0 : i])));
}

function sAdd(a: E, b: E): E {
  const ty = widerTy(a.ty, b.ty), ka = known(a), kb = known(b);
  if (ka && kb) return fold2(ka, kb, (x, y) => x + y);
  if (isZero(a)) return widen(b, ty);
  if (isZero(b)) return widen(a, ty);
  return ADD(a, b);
}
function sNeg(a: E): E {
  const k = known(a);
  if (k) return constOf(k.map((x) => -x));
  const n = a.node;
  if (n.op === "call" && n.fn === "neg") return n.args[0] as E;
  return NEG(a);
}
function sSub(a: E, b: E): E {
  const ty = widerTy(a.ty, b.ty), ka = known(a), kb = known(b);
  if (ka && kb) return fold2(ka, kb, (x, y) => x - y);
  if (a === b) return zero(ty);
  if (isZero(b)) return widen(a, ty);
  if (isZero(a)) return widen(sNeg(b), ty);
  return SUB(a, b);
}
function sMul(a: E, b: E): E {
  const ty = widerTy(a.ty, b.ty), ka = known(a), kb = known(b);
  if (isZero(a) || isZero(b)) return zero(ty);
  if (ka && kb) return fold2(ka, kb, (x, y) => x * y);
  if (isOne(a)) return widen(b, ty);
  if (isOne(b)) return widen(a, ty);
  return MUL(a, b);
}
function sDiv(a: E, b: E): E {
  const ty = widerTy(a.ty, b.ty);
  if (isZero(a)) return zero(ty);
  if (isOne(b)) return widen(a, ty);
  return DIV(a, b);
}
/** dot for any pair of numeric operands (a product for two scalars, which WGSL's dot does not accept). */
function sDot(a: E, b: E): E {
  const ty = widerTy(a.ty, b.ty);
  if (isZero(a) || isZero(b)) return f(0);
  if (ty === "f32") return sMul(a, b);
  return dot(widen(a, ty), widen(b, ty)) as E;
}
function sCross(a: E, b: E): E {
  if (isZero(a) || isZero(b)) return zero("vec3");
  return cross(a as Expr<"vec3">, b as Expr<"vec3">) as E;
}
function sAbs(a: E): E { return isZero(a) ? a : ABS(a); }

/** Component i of x; a scalar is its own every component (broadcast). */
function comp(x: E, i: number): Expr<"f32"> {
  if (x.ty === "f32") return x as Expr<"f32">;
  const k = known(x);
  return (k !== null ? f(k[i]) : COMP[i](x)) as Expr<"f32">;
}

/**
 * Per component: `yes` where `cond(i)` holds, else `no`. A scalar `select` for f32, a vector built from per-component
 * selects otherwise (expr.ts's select takes one bool, and its WGSL form needs both sides to have the result's type).
 */
function pickEach(ty: NumTy, cond: (i: number) => Expr<"bool">, yes: E, no: E): E {
  if (isZero(yes) && isZero(no)) return zero(ty);
  if (yes === no) return widen(yes, ty);
  if (ty === "f32") return SELECT(cond(0), yes, no);
  return VEC[ty as VecTy](...Array.from({ length: SIZE[ty] }, (_, i) => SELECT(cond(i), comp(yes, i), comp(no, i))));
}

function swizzle(a: E, sel: string): E {
  if (sel.length === 1) return comp(a, "xyzw".indexOf(sel));
  const getter = SWIZZLE[sel];
  if (getter) return getter(a);
  return VEC[TY_OF_SIZE[sel.length] as VecTy](...[...sel].map((ch) => comp(a, "xyzw".indexOf(ch))));
}

/**
 * The floor under the denominators of |v|' = (v . v') / |v| and friends. At v = 0 the derivative of |v| does not
 * exist; with the floor it is 0 whenever v' = 0 too (the minimum-norm subgradient). That case is common, not
 * exotic: inside `sdBox`, `length(max(q, 0))` is identically 0 with a zero tangent, and without the floor its 0/0
 * would make the whole gradient NaN. 1e-30 is a normal f32, so the GPU does not flush it to zero.
 */
const TINY = 1e-30;

// ---- the rules ----------------------------------------------------------------------------------------------------

/** A rule for a built-in operator: `e` is the node itself (its value, for reuse), `a` its arguments, `d(i)` the tangent of argument i (computed on demand, so a select's condition is never differentiated). */
type CallRule = (e: E, a: readonly E[], d: (i: number) => E) => E;

const constant: CallRule = (e) => zero(e.ty);
const boolean: CallRule = (e) => { throw new DerivativeError({ kind: "not-numeric", what: `the ${e.ty} result of a comparison or logic operator` }); };

/** pow(a, b - 1) for the power rule, without pow for the common small exponents. */
function powBelow(a: E, b: E): E {
  const k = known(b);
  if (k !== null && k.length === 1 && k[0] === 1) return f(1);
  if (k !== null && k.length === 1 && k[0] === 2) return a;
  if (k !== null) return POW(a, constOf(k.map((x) => x - 1)));
  return POW(a, SUB(b, f(1)));
}

const CALL: Record<Fn, CallRule> = {
  add: (_e, _a, d) => sAdd(d(0), d(1)),
  sub: (_e, _a, d) => sSub(d(0), d(1)),
  neg: (_e, _a, d) => sNeg(d(0)),
  mul: (_e, a, d) => sAdd(sMul(d(0), a[1]), sMul(a[0], d(1))),
  // (a / b)' = (a' - (a / b) b') / b: reuses the quotient node instead of building a / b^2.
  div: (e, a, d) => sDiv(sSub(d(0), sMul(e, d(1))), a[1]),
  // The derivative of the selected operand; at a tie, the first operand's.
  min: (e, a, d) => pickEach(e.ty, (i) => le(comp(a[0], i), comp(a[1], i)), d(0), d(1)),
  max: (e, a, d) => pickEach(e.ty, (i) => ge(comp(a[0], i), comp(a[1], i)), d(0), d(1)),
  // A constant exponent (one whose tangent is zero: a number, a param, anything independent of the seeds) takes the
  // power rule, which never forms log(a): pow of a negative base with an integer exponent stays as defined as the
  // original. A varying exponent needs a^b (b' log a + b a' / a), defined only for a > 0, which is also pow's domain.
  pow: (e, a, d) => {
    const db = d(1);
    if (isZero(db)) return sMul(sMul(a[1], powBelow(a[0], a[1])), d(0));
    return sMul(e, sAdd(sMul(db, LOG(a[0])), sDiv(sMul(a[1], d(0)), a[0])));
  },
  // mod(a, b) = a - b floor(a / b); floor's derivative is zero between jumps.
  mod: (_e, a, d) => { const db = d(1); return isZero(db) ? d(0) : sSub(d(0), sMul(db, FLOOR(DIV(a[0], a[1])))); },
  // atan2(y, x)' = (x y' - y x') / (x^2 + y^2).
  atan2: (_e, a, d) => sDiv(sSub(sMul(a[1], d(0)), sMul(a[0], d(1))), ADD(MUL(a[1], a[1]), MUL(a[0], a[0]))),
  step: constant, sign: constant, floor: constant,
  fract: (_e, _a, d) => d(0),
  abs: (_e, a, d) => sMul(SIGN(a[0]), d(0)),
  sqrt: (e, _a, d) => sDiv(d(0), MUL(f(2), MAX(e, f(TINY)))),
  exp: (e, _a, d) => sMul(e, d(0)),
  log: (_e, a, d) => sDiv(d(0), a[0]),
  sin: (_e, a, d) => sMul(COS(a[0]), d(0)),
  cos: (_e, a, d) => sNeg(sMul(SIN(a[0]), d(0))),
  tan: (e, _a, d) => sMul(ADD(f(1), MUL(e, e)), d(0)),
  saturate: (e, a, d) => pickEach(e.ty, (i) => and(ge(comp(a[0], i), 0), le(comp(a[0], i), 1)), d(0), zero(e.ty)),
  // n = v / |v|: n' = (v' - n (n . v')) / |v|. A scalar "normalize" is sign(v) (the CPU backend's meaning): constant.
  normalize: (e, a, d) => {
    if (e.ty === "f32") return zero("f32");
    return sDiv(sSub(d(0), sMul(e, sDot(e, d(0)))), MAX(length(a[0]), f(TINY)));
  },
  // mix(a, b, t) = a + (b - a) t.
  mix: (_e, a, d) => {
    const dt = d(2);
    const along = sAdd(d(0), sMul(sSub(d(1), d(0)), a[2]));
    return isZero(dt) ? along : sAdd(along, sMul(SUB(a[1], a[0]), dt));
  },
  // clamp(x, lo, hi): lo's derivative below lo, hi's above hi, x's between (assumes lo <= hi, as clamp itself does).
  clamp: (e, a, d) => {
    const inner = pickEach(e.ty, (i) => gt(comp(a[0], i), comp(a[2], i)), d(2), d(0));
    return pickEach(e.ty, (i) => lt(comp(a[0], i), comp(a[1], i)), d(1), inner);
  },
  // smoothstep = s(t), t = saturate(r), r = (x - lo) / (hi - lo), s(t) = t^2 (3 - 2t). s'(t) = 6 t (1 - t) is zero at
  // t = 0 and t = 1, so the saturate needs no mask: outside the ramp the factor already vanishes.
  smoothstep: (e, a, d) => {
    const [lo, hi, x] = a;
    const w = SUB(hi, lo), r = DIV(SUB(x, lo), w);
    const dr = sDiv(sSub(sSub(d(2), d(0)), sMul(r, sSub(d(1), d(0)))), w);
    if (isZero(dr)) return zero(e.ty);
    const t = SAT(r);
    return widen(sMul(MUL(MUL(t, SUB(f(1), t)), f(6)), dr), e.ty);
  },
  length: (e, a, d) => sDiv(sDot(a[0], d(0)), MAX(e, f(TINY))),
  distance: (e, a, d) => {
    const dd = sSub(d(0), d(1));
    return isZero(dd) ? f(0) : sDiv(sDot(SUB(a[0], a[1]), dd), MAX(e, f(TINY)));
  },
  dot: (_e, a, d) => sAdd(sDot(d(0), a[1]), sDot(a[0], d(1))),
  cross: (_e, a, d) => sAdd(sCross(d(0), a[1]), sCross(a[0], d(1))),
  // The derivative of the selected branch; the condition is piecewise constant.
  select: (e, a, d) => {
    const yes = d(1), no = d(2);
    if (isZero(yes) && isZero(no)) return zero(e.ty);
    return SELECT(a[0] as unknown as Expr<"bool">, widen(yes, e.ty), widen(no, e.ty));
  },
  lt: boolean, gt: boolean, le: boolean, ge: boolean, eq: boolean, ne: boolean, and: boolean, or: boolean, not: boolean,
};

/**
 * The slope of a curve row at x: the exact derivative of the piecewise-linear interpolant `row` evaluates. Read from
 * the source row itself, at two points strictly inside x's cell (a quarter and three quarters of the way across),
 * so the difference is exactly that cell's slope whatever the lookup's rounding. Two reasons not to bake a derivative
 * table: a baked table would go stale when the host edits the source row at run time (rows are live, see
 * `compileJs`), and the centred differences such a table would hold are not the derivative of what `row` returns,
 * so a derivative built from them would disagree with the function it claims to differentiate. Outside [0, 1] the
 * lookup is clamped, so the slope is zero there.
 */
function rowSlope(r: Row, x: Expr<"f32">, dx: E): E {
  if (isZero(dx)) return zero("vec4");
  const last = CURVE_N - 1;
  const cell = MIN(FLOOR(MUL(SAT(x), f(last))), f(last - 1));
  const at = (frac: number): E => row(r, DIV(ADD(cell, f(frac)), f(last)) as Expr<"f32">) as E;
  const slope = MUL(SUB(at(0.75), at(0.25)), f(2 * last));
  return sMul(SELECT(and(ge(x, 0), le(x, 1)), slope, zero("vec4")), dx);
}

// ---- library functions --------------------------------------------------------------------------------------------

/**
 * The derivative of a library function call: given its arguments and their tangents (same types), the tangent of the
 * result (the function's return type). Usually the function's own gradient (another library function or an
 * expression) dotted with the argument tangents.
 */
export type DerivativeRule = (args: readonly Expr[], dargs: readonly Expr[]) => Expr;

const RULES = new Map<LibFn, DerivativeRule>();

/**
 * Register the derivative of a library function. A call whose arguments do not depend on the seeds has derivative
 * zero without a rule; any other call of a function with no rule raises a DerivativeError naming the function.
 */
export function defineDerivative(fn: LibFn, rule: DerivativeRule): void {
  const seen = RULES.get(fn);
  if (seen && seen !== rule) throw new Error(`defineDerivative: "${fn.name}" already has a derivative`);
  RULES.set(fn, rule);
}

// ---- the traversal ------------------------------------------------------------------------------------------------

/** Leaf id -> the direction its tangent starts with (same type as the leaf). Unseeded leaves are constant. */
type Seeds = ReadonlyMap<number, E>;

/** One forward pass: the seeds, the memoised tangent, and the tangent loops built so far (by loop id). */
type Pass = { readonly seeds: Seeds; readonly tan: (x: Expr) => E; readonly loops: Map<number, readonly E[]> };

function forward(roots: readonly Expr[], seeds: Seeds): E[] {
  const memo = new Map<number, E>();
  const tan = (e: Expr): E => {
    const hit = memo.get(e.id);
    if (hit) return hit;
    if (e.ty === "bool") throw new DerivativeError({ kind: "not-numeric", what: `node ${e.id} (${e.node.op})` });
    const d = nodeRule(e as E, pass);
    if (d.ty !== e.ty) throw new DerivativeError({ kind: "internal", detail: `the tangent of a ${e.ty} ${e.node.op} node came out ${d.ty}` });
    memo.set(e.id, d);
    return d;
  };
  const pass: Pass = { seeds, tan, loops: new Map() };
  return roots.map(tan);
}

/** Does anything in `roots` read a seeded leaf? (Loop bodies are reached through their `outer` reads.) */
const readsSeeds = (roots: readonly Expr[], seeds: Seeds): boolean => topo(roots).some((e) => seeds.has(e.id));

/**
 * The tangents of a loop's results. Forward mode through a loop is another loop: the state is extended with one
 * tangent per component, and each step maps (s, t) to (step(s, i), d step(s, i)), the second taken along the outer
 * seeds plus "state component j moves along t_j". The body is rebuilt from the loop's authored step with the new
 * loop's variables, so the derivative is a loop too (its size does not grow with the count). The count is truncated
 * to an integer, so it contributes nothing.
 */
function loopTangents(l: Loop, p: Pass): readonly E[] {
  const hit = p.loops.get(l.id);
  if (hit) return hit;
  const init = l.init as readonly E[];
  const dinit = init.map(p.tan);
  const n = init.length;
  const tangents: readonly E[] = dinit.every(isZero) && !readsSeeds(l.next, p.seeds)
    ? init.map((e) => zero(e.ty))
    : (iterate(l.count, [...init, ...dinit] as never, (st: readonly E[], i: Expr<"f32">) => {
      const s = st.slice(0, n), t = st.slice(n);
      const next = l.step(s, i) as readonly E[];
      const inner = new Map(p.seeds);
      s.forEach((v, j) => inner.set(v.id, t[j]));
      return [...next, ...forward(next, inner)] as never;
    }) as readonly E[]).slice(n);
  p.loops.set(l.id, tangents);
  return tangents;
}

/** The dispatcher: one rule per node kind. */
function nodeRule(e: E, p: Pass): E {
  const { tan, seeds } = p;
  const n = e.node;
  switch (n.op) {
    case "const": return zero(e.ty);
    case "var": case "input": case "param": return seeds.get(e.id) ?? zero(e.ty); // unseeded leaves are constant
    case "row": return rowSlope(n.row, n.x, tan(n.x));
    case "call": return CALL[n.fn](e, n.args as readonly E[], (i) => tan(n.args[i]));
    case "vec": {
      const ds = n.args.map(tan);
      return ds.every(isZero) ? zero(n.ty) : VEC[n.ty](...ds);
    }
    case "get": {
      const da = tan(n.a);
      return isZero(da) ? zero(n.ty) : swizzle(da, n.sel);
    }
    case "lib": {
      const ds = n.args.map(tan);
      if (ds.every(isZero)) return zero(e.ty);
      const rule = RULES.get(n.fn);
      if (!rule) throw new DerivativeError({ kind: "no-derivative", fn: n.fn.name });
      return rule(n.args, ds) as E;
    }
    // A per-frame table entry: the index is truncated to an integer, so it is piecewise constant in every continuous
    // variable. (What the table holds may depend on time or inputs through its CPU fill, which this DAG cannot see:
    // a derivative with respect to time does not include it.)
    case "fetch": return zero("vec4");
    case "iterate": return loopTangents(n.loop, p)[n.k];
    // A kind added to expr.ts after this was written lands here, and TypeScript reports the `never` as an error.
    default: {
      const unknown: never = n;
      throw new DerivativeError({ kind: "unknown-node", op: (unknown as { op: string }).op });
    }
  }
}

// ---- the API ------------------------------------------------------------------------------------------------------

type Leaf = Expr<NumTy>;

/** Classify what to differentiate with respect to: a numeric variable, input or parameter, of the expected types. */
function leafOf(x: Expr, tys: readonly Ty[], role: string): Leaf {
  const n = x.node;
  switch (n.op) {
    case "var": case "input": case "param":
      if (!tys.includes(n.ty)) throw new DerivativeError({ kind: "bad-variable", detail: `${role} must be ${tys.join(" or ")}, got ${n.ty}` });
      return x as Leaf;
    default:
      throw new DerivativeError({ kind: "bad-variable", detail: `${role} must be a variable, input or param leaf, got a "${n.op}" node` });
  }
}

/** de/dx for a scalar leaf x (a `variable`, `input` or `param`): an expression of e's type. */
export function derivative<T extends NumTy>(e: Expr<T>, x: Expr<"f32">): Expr<T> {
  const leaf = leafOf(x, ["f32"], "derivative: x");
  return forward([e], new Map([[leaf.id, f(1)]]))[0] as Expr<T>;
}

/**
 * The directional derivative of e at p along `dir` (the Jacobian-vector product): d/ds e(p + s dir) at s = 0.
 * `dir` has p's type and may itself be an expression (a ray direction, a screen-space rate).
 */
export function derivativeAlong<T extends NumTy, P extends NumTy>(e: Expr<T>, p: Expr<P>, dir: In<P>): Expr<T> {
  const leaf = leafOf(p, ["f32", "vec2", "vec3", "vec4"], "derivativeAlong: p");
  const d = lift(dir) as E;
  if (d.ty !== leaf.ty) throw new DerivativeError({ kind: "bad-variable", detail: `direction is ${d.ty} but p is ${leaf.ty}` });
  return forward([e], new Map([[leaf.id, d]]))[0] as Expr<T>;
}

/** The gradient of a scalar e with respect to a vec2 or vec3 leaf p. */
export function gradient(e: Expr<"f32">, p: Expr<"vec2">): Expr<"vec2">;
export function gradient(e: Expr<"f32">, p: Expr<"vec3">): Expr<"vec3">;
export function gradient(e: Expr<"f32">, p: Expr<"vec2" | "vec3">): Expr<"vec2" | "vec3"> {
  if (e.ty !== "f32") throw new DerivativeError({ kind: "bad-variable", detail: `gradient needs a scalar expression, got ${e.ty} (use jacobian)` });
  const leaf = leafOf(p, ["vec2", "vec3"], "gradient: p");
  const parts = Array.from({ length: SIZE[leaf.ty] }, (_, i) => derivativeAlong(e, leaf, axis(leaf.ty, i)));
  return VEC[leaf.ty as VecTy](...parts) as Expr<"vec2" | "vec3">;
}

/** The Jacobian of a vector expression f with respect to a leaf p, as its columns: column j is df/dp_j (f's type). */
export function jacobian<T extends VecTy>(fx: Expr<T>, p: Expr<NumTy>): Expr<T>[] {
  const leaf = leafOf(p, ["f32", "vec2", "vec3", "vec4"], "jacobian: p");
  return Array.from({ length: SIZE[leaf.ty] }, (_, j) => derivativeAlong(fx, leaf, axis(leaf.ty, j)));
}

/**
 * The unit normal of a parametric surface s(u, v): normalize(ds/du x ds/dv). Its orientation follows the
 * parametrisation (swap u and v to flip it); it is undefined where the two partials are parallel (a sphere's poles).
 */
export function normalOf(surface: Expr<"vec3">, u: Expr<"f32">, v: Expr<"f32">): Expr<"vec3"> {
  return NORMALIZE(sCross(derivative(surface, u), derivative(surface, v))) as Expr<"vec3">;
}

/**
 * An upper bound on how much a map F from space to space scales lengths at p: a bound on the largest singular value
 * of its Jacobian J (with columns c_j = dF/dp_j). Returned exactly:
 *
 *   sqrt( max_i ( |c_i|^2 + sum_{j != i} |c_i . c_j| ) )
 *
 * the Gershgorin bound on the largest eigenvalue of the Gram matrix J^T J, whose square root is the largest singular
 * value. Always >= the true stretch; equal to it whenever the columns are mutually orthogonal, which covers every
 * conformal map (uniform scale, rotation, reflection, log-polar, inversion) and axis-aligned anisotropic scales. For
 * other maps (shear, twist, noise warp) it overestimates by at most sqrt(n) for n = dim p. Divide a distance
 * evaluated after F by it to keep a distance bound. No extra safety factor is applied.
 */
export function stretchOf(map: Expr<"vec2" | "vec3">, p: Expr<"vec2" | "vec3">): Expr<"f32"> {
  const cols = jacobian(map, leafOf(p, ["vec2", "vec3"], "stretchOf: p")) as E[];
  const gram = cols.map((a) => cols.map((b) => sDot(a, b)));
  const rows = gram.map((g, i) => g.reduce((s, x, j) => (i === j ? sAdd(s, x) : sAdd(s, sAbs(x))), f(0)));
  return SQRT(rows.reduce((m, r) => MAX(m, r))) as Expr<"f32">;
}

/** How a quantity the coordinate is built from changes per pixel: `of` is a leaf, `dx` and `dy` have its type. */
export type ScreenRate = { readonly of: Expr<NumTy>; readonly dx: In<NumTy>; readonly dy: In<NumTy> };
/** A coordinate's change per pixel along screen x and y, and `width` = |dx| + |dy| (WGSL's `fwidth`). */
export type Footprint<T extends NumTy> = { readonly dx: Expr<T>; readonly dy: Expr<T>; readonly width: Expr<T> };

/**
 * How much `coord` changes from one pixel to the next, by the chain rule from the screen-space rates of the unfolded
 * quantities it is built from (typically `dpdx`/`dpdy` of a world point or a body coordinate in the fragment stage,
 * which are continuous). Leaves not listed are constant across the pixel.
 *
 * This is the point of the function: the screen derivative of a *folded* coordinate (one that went through `fract`,
 * `mod`, `abs`) jumps at every seam, so `fwidth(coord)` draws a line there. Here the fold is differentiated
 * analytically instead (fract' = 1, mod' = the argument's, abs' = sign, whose magnitude is continuous), so the footprint
 * is the unfolded rate times the fold's local stretch, with no spike at the seam.
 */
export function footprint<T extends NumTy>(coord: Expr<T>, px: readonly ScreenRate[]): Footprint<T> {
  const seeds = (pick: (r: ScreenRate) => In<NumTy>): Seeds => new Map(px.map((r) => {
    const leaf = leafOf(r.of, ["f32", "vec2", "vec3", "vec4"], "footprint: of");
    const d = lift(pick(r)) as E;
    if (d.ty !== leaf.ty) throw new DerivativeError({ kind: "bad-variable", detail: `footprint: a ${leaf.ty} quantity was given a ${d.ty} rate` });
    return [leaf.id, d] as const;
  }));
  const [dx] = forward([coord], seeds((r) => r.dx)), [dy] = forward([coord], seeds((r) => r.dy));
  return { dx: dx as Expr<T>, dy: dy as Expr<T>, width: sAdd(sAbs(dx), sAbs(dy)) as Expr<T> };
}

// ---- derivatives of the noise library -----------------------------------------------------------------------------
//
// noise.ts does not export its LibFn objects, so they are recovered from a probe call. The gradients are library
// functions of their own (one call per octave, like the noise itself) that reuse noise.ts's helper definitions, found
// by name in its dependency tree: the same objects must be shared, since two definitions under one name are an error.
// The CPU twins compute each corner's gradient from the public hashes, which hash the same integer cell: the angle of
// noise2's corner gradient is hash2(cell) * TAU; noise3's is built from hash33(cell).xy as loft_grad3 builds it.

function libOf(e: Expr): LibFn {
  if (e.node.op !== "lib") throw new Error(`grad.ts: expected a library call, got a "${e.node.op}" node`);
  return e.node.fn;
}
function jsOf(fn: LibFn): (p: number[]) => number[] | number {
  if (fn.js === "gpu-only") throw new Error(`grad.ts: "${fn.name}" has no CPU twin`);
  return fn.js as (p: number[]) => number[] | number;
}
/** Every library function `root` depends on, transitively. */
const depsOf = (root: LibFn): LibFn[] => (root.deps ?? []).flatMap((d) => [d, ...depsOf(d)]);
function depNamed(root: LibFn, name: string): LibFn {
  const found = depsOf(root).find((d) => d.name === name);
  if (!found) throw new Error(`grad.ts: "${root.name}" no longer depends on "${name}"; update the noise gradients to match noise.ts`);
  return found;
}

const PROBE2 = variable("grad.probe.vec2", "vec2"), PROBE3 = variable("grad.probe.vec3", "vec3");
const NOISE2 = libOf(noise2(PROBE2)), NOISE3 = libOf(noise3(PROBE3));
const HASH2 = libOf(hash2(PROBE2)), HASH33 = libOf(hash33(PROBE3));
const hash2Js = jsOf(HASH2) as (p: number[]) => number;
const hash33Js = jsOf(HASH33) as (p: number[]) => number[];

// Same normalisation as noise.ts (its range is brought to [-1, 1]).
const SCALE2 = Math.SQRT2, SCALE3 = 2 / Math.sqrt(3);
const quintic = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const dQuintic = (t: number): number => 30 * t * t * (t - 1) * (t - 1);

/** A value and its gradient, for differentiating the interpolation ladder on the CPU. */
type VG = { readonly v: number; readonly g: readonly number[] };
/** mix(a, b, u(t)) along `axis`: value a + u (b - a), gradient ga + u (gb - ga) + (b - a) u'(t) e_axis. */
const mixVG = (a: VG, b: VG, t: number, ax: number): VG => {
  const u = quintic(t), du = dQuintic(t);
  return { v: a.v + u * (b.v - a.v), g: a.g.map((ga, i) => ga + u * (b.g[i] - ga) + (i === ax ? du * (b.v - a.v) : 0)) };
};

const NOISE2_GRAD: LibFn = {
  name: "loft_noise2_grad", ret: "vec2",
  deps: [depNamed(NOISE2, "loft_h2"), depNamed(NOISE2, "loft_lat"), depNamed(NOISE2, "loft_grad2")],
  wgsl: `fn loft_noise2_grad(p: vec2<f32>) -> vec2<f32> {
  let ix = loft_lat(p.x);
  let iy = loft_lat(p.y);
  let f = p - floor(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let du = 30.0 * f * f * (f - 1.0) * (f - 1.0);
  let ga = loft_grad2(loft_h2(ix, iy));
  let gb = loft_grad2(loft_h2(ix + 1u, iy));
  let gc = loft_grad2(loft_h2(ix, iy + 1u));
  let gd = loft_grad2(loft_h2(ix + 1u, iy + 1u));
  let va = dot(ga, f);
  let vb = dot(gb, f - vec2<f32>(1.0, 0.0));
  let vc = dot(gc, f - vec2<f32>(0.0, 1.0));
  let vd = dot(gd, f - vec2<f32>(1.0, 1.0));
  let k = va - vb - vc + vd;
  let g = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd);
  return (g + du * vec2<f32>(vb - va + u.y * k, vc - va + u.x * k)) * ${SCALE2};
}`,
  js: (p: number[]) => {
    const ix = Math.floor(p[0]), iy = Math.floor(p[1]), fx = p[0] - ix, fy = p[1] - iy;
    const corner = (cx: number, cy: number): VG => {
      const a = hash2Js([ix + cx, iy + cy]) * TAU, g = [Math.cos(a), Math.sin(a)];
      return { v: g[0] * (fx - cx) + g[1] * (fy - cy), g };
    };
    const n = mixVG(mixVG(corner(0, 0), corner(1, 0), fx, 0), mixVG(corner(0, 1), corner(1, 1), fx, 0), fy, 1);
    return n.g.map((x) => x * SCALE2);
  },
};

const NOISE3_GRAD: LibFn = {
  name: "loft_noise3_grad", ret: "vec3",
  deps: [depNamed(NOISE3, "loft_h3"), depNamed(NOISE3, "loft_lat"), depNamed(NOISE3, "loft_grad3")],
  wgsl: `fn loft_noise3_grad(p: vec3<f32>) -> vec3<f32> {
  let ix = loft_lat(p.x);
  let iy = loft_lat(p.y);
  let iz = loft_lat(p.z);
  let f = p - floor(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let du = 30.0 * f * f * (f - 1.0) * (f - 1.0);
  let g000 = loft_grad3(loft_h3(ix, iy, iz));
  let g100 = loft_grad3(loft_h3(ix + 1u, iy, iz));
  let g010 = loft_grad3(loft_h3(ix, iy + 1u, iz));
  let g110 = loft_grad3(loft_h3(ix + 1u, iy + 1u, iz));
  let g001 = loft_grad3(loft_h3(ix, iy, iz + 1u));
  let g101 = loft_grad3(loft_h3(ix + 1u, iy, iz + 1u));
  let g011 = loft_grad3(loft_h3(ix, iy + 1u, iz + 1u));
  let g111 = loft_grad3(loft_h3(ix + 1u, iy + 1u, iz + 1u));
  let v000 = dot(g000, f);
  let v100 = dot(g100, f - vec3<f32>(1.0, 0.0, 0.0));
  let v010 = dot(g010, f - vec3<f32>(0.0, 1.0, 0.0));
  let v110 = dot(g110, f - vec3<f32>(1.0, 1.0, 0.0));
  let v001 = dot(g001, f - vec3<f32>(0.0, 0.0, 1.0));
  let v101 = dot(g101, f - vec3<f32>(1.0, 0.0, 1.0));
  let v011 = dot(g011, f - vec3<f32>(0.0, 1.0, 1.0));
  let v111 = dot(g111, f - vec3<f32>(1.0, 1.0, 1.0));
  // Each mix(a, b, u) adds a + u (b - a) to the value and ga + u (gb - ga) + (b - a) u' e_axis to the gradient.
  let x00 = v000 + u.x * (v100 - v000);
  let x10 = v010 + u.x * (v110 - v010);
  let x01 = v001 + u.x * (v101 - v001);
  let x11 = v011 + u.x * (v111 - v011);
  let gx00 = g000 + u.x * (g100 - g000) + vec3<f32>(du.x * (v100 - v000), 0.0, 0.0);
  let gx10 = g010 + u.x * (g110 - g010) + vec3<f32>(du.x * (v110 - v010), 0.0, 0.0);
  let gx01 = g001 + u.x * (g101 - g001) + vec3<f32>(du.x * (v101 - v001), 0.0, 0.0);
  let gx11 = g011 + u.x * (g111 - g011) + vec3<f32>(du.x * (v111 - v011), 0.0, 0.0);
  let y0 = x00 + u.y * (x10 - x00);
  let y1 = x01 + u.y * (x11 - x01);
  let gy0 = gx00 + u.y * (gx10 - gx00) + vec3<f32>(0.0, du.y * (x10 - x00), 0.0);
  let gy1 = gx01 + u.y * (gx11 - gx01) + vec3<f32>(0.0, du.y * (x11 - x01), 0.0);
  return (gy0 + u.z * (gy1 - gy0) + vec3<f32>(0.0, 0.0, du.z * (y1 - y0))) * ${SCALE3};
}`,
  js: (p: number[]) => {
    const ix = Math.floor(p[0]), iy = Math.floor(p[1]), iz = Math.floor(p[2]);
    const fx = p[0] - ix, fy = p[1] - iy, fz = p[2] - iz;
    const corner = (cx: number, cy: number, cz: number): VG => {
      const h = hash33Js([ix + cx, iy + cy, iz + cz]);
      const z = 1 - 2 * h[0], a = h[1] * TAU, r = Math.sqrt((1 - z) * (1 + z));
      const g = [r * Math.cos(a), r * Math.sin(a), z];
      return { v: g[0] * (fx - cx) + g[1] * (fy - cy) + g[2] * (fz - cz), g };
    };
    const xs = (cy: number, cz: number): VG => mixVG(corner(0, cy, cz), corner(1, cy, cz), fx, 0);
    const n = mixVG(mixVG(xs(0, 0), xs(1, 0), fy, 1), mixVG(xs(0, 1), xs(1, 1), fy, 1), fz, 2);
    return n.g.map((x) => x * SCALE3);
  },
};

defineDerivative(NOISE2, (args, ds) => sDot(lib<"vec2">(NOISE2_GRAD, args[0]) as E, ds[0] as E));
defineDerivative(NOISE3, (args, ds) => sDot(lib<"vec3">(NOISE3_GRAD, args[0]) as E, ds[0] as E));

// Second and higher derivatives. The noise written as an expression over the public hashes (the same cells, corner
// gradients and quintic interpolation as noise.ts) is differentiated by the ordinary rules; its gradient's
// directional derivative (the Hessian times a direction) is built once over private variables and substituted per
// call. Larger than the gradient functions above, which is why first derivatives (normals, the common case) use those.
const quinticE = (t: E): E => MUL(MUL(MUL(t, t), t), ADD(MUL(t, SUB(MUL(t, f(6)), f(15))), f(10)));
const MIX = mix as unknown as (a: E, b: E, t: E) => E;
const offset = (c: E, o: readonly number[]): E => (o.every((x) => x === 0) ? c : ADD(c, constOf(o)));

function noise2Expr(p: E): E {
  const c = FLOOR(p), fr = SUB(p, c), w = quinticE(fr);
  const corner = (o: readonly number[]): E => {
    const a = MUL(hash2(offset(c, o) as Expr<"vec2">) as E, f(TAU));
    return sDot(vec2(COS(a), SIN(a)), SUB(fr, constOf(o)));
  };
  const x0 = MIX(corner([0, 0]), corner([1, 0]), w.x), x1 = MIX(corner([0, 1]), corner([1, 1]), w.x);
  return MUL(MIX(x0, x1, w.y), f(SCALE2));
}
function noise3Expr(p: E): E {
  const c = FLOOR(p), fr = SUB(p, c), w = quinticE(fr);
  const corner = (o: readonly number[]): E => {
    const h = hash33(offset(c, o) as Expr<"vec3">) as E;
    const z = SUB(f(1), MUL(f(2), h.x)), a = MUL(h.y, f(TAU)), r = SQRT(MUL(SUB(f(1), z), ADD(f(1), z)));
    return sDot(vec3(MUL(r, COS(a)), MUL(r, SIN(a)), z), SUB(fr, constOf(o)));
  };
  const xs = (y: number, z: number): E => MIX(corner([0, y, z]), corner([1, y, z]), w.x);
  return MUL(MIX(MIX(xs(0, 0), xs(1, 0), w.y), MIX(xs(0, 1), xs(1, 1), w.y), w.z), f(SCALE3));
}

/** Register d(grad n)(p)[dp] = H(p) dp for a noise gradient function, from an expression form of the noise. */
function defineHessian(gradFn: LibFn, ty: "vec2" | "vec3", asExpr: (p: E) => E): void {
  const at = variable(`grad.${gradFn.name}.p`, ty), dir = variable(`grad.${gradFn.name}.v`, ty);
  let hv: Expr | undefined; // built on first use: a pure function of the two private variables
  defineDerivative(gradFn, (args, ds) => {
    hv ??= derivativeAlong(gradient(asExpr(at) as Expr<"f32">, at as Expr<"vec2">) as E, at, dir);
    return substitute(substitute([hv], at, args[0]), dir, ds[0])[0];
  });
}
defineHessian(NOISE2_GRAD, "vec2", noise2Expr);
defineHessian(NOISE3_GRAD, "vec3", noise3Expr);
// Hashes are constant inside each integer cell: zero derivative (between the cell walls, where they jump).
for (const h of [HASH2, libOf(hash3(PROBE3)), libOf(hash22(PROBE2)), HASH33]) {
  defineDerivative(h, () => zero(h.ret as NumTy));
}
// Not registered: cellular2 / cellular3 (their gradient needs the nearest feature point, which the functions do not
// return) and fwidth (a screen-space derivative, GPU-only). Differentiating them with a varying argument throws.
