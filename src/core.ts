// Core layer: the expression language, curves, the map algebra, drawables, relief, the scene, the sun and the compiler.
// Everything a scene needs whatever it draws.
// The expression language. Its compiler (graph walks, WGSL emission, substitution, folding) is internal:
// a host or drawable author who needs it imports it from src/expr.ts.
export {
  Expr, Row, TAU, abs, add, and, atan2, clamp, compileJs, cos, cross, distance, div, dot, eq, evaluate, exp, f, fetch, floor,
  fract, ge, gt, input, iterate, le, length, lib, lift, log, lt, max, min, mix, mod, mul, namespaceSeed, ne, neg,
  normalize, not, or, param, pick, pow, round, row, saturate, select, sign, sin, smoothstep, sqrt, step, sub,
  swizzle, tan, time, variable, vec2, vec3, vec4, type Ty, type NumTy, type VecTy, type ParamSpec, type InputSpec,
  type Fn, type LibFn, type TableSource, type In, type Num, type Lit, type V, type Env,
} from "./expr.ts";
export { keys, ramp, through, wave, retarded, response, pulse, ease, type Curve as KeyCurve, type Key } from "./curve.ts";
export { NO_SKELETON, type F, type P3, type Frame, type Placed, type Points, type Size, type Poses, type Curve, type End, type Topology, type Skeleton, type Surface, type Chart, type Field, type Density, type PaintAt, type Paint, type Warp, type Placeable } from "./map/types.ts";
export { carry, compose, on, place, points, posed, posedList, shifted, size, sized, sizeLengths, turn, inFrame, world, type PointSpec, type PoseSpec, type Turn } from "./map/index.ts";
export { warp, tile, tabulate, type Schedule, extrude, framed, framedPose, lathe, loft, mapNormal, sheet, surface, thicken } from "./map/index.ts";
export { Body, rotateAbout, sweep, type FrameSample, type Section, type Tip, type Transport } from "./map/index.ts";
export { draw, type Bounds, type CurveOptions, type DensityOptions, type FieldOptions, type Instanceable, type Poseable, type ReliefOptions } from "./draw/index.ts";
export { spacing, SurfaceDrawable, type Fragment, type Grid, type Look, type Outline, type Sampling, type SurfaceOptions } from "./draw/surface.ts";
export { scene, type OutlineMethod, type Scene, type SceneSpec } from "./scene.ts";
export { plane, nothing, GroundError, type Ground, type Plane, type Nothing } from "./draw/ground.ts";
export { compile, type Compiled, type CpuFn } from "./compile/index.ts";
export { drawSpec, type Bakeable, type CompileContext, type Drawable, type DrawSpec, type Emitted, type Phase, type PostSpec, type Shader, type TableRef } from "./compile/context.ts";
export { emitFn, emitShaderFn } from "./compile/bind.ts";
export { TableBudgetError } from "./compile/tables.ts";
export type { Artefact } from "./artefact.ts";
export { bound, type TraceBound, type TraceOutline } from "./draw/trace.ts";
export { type FieldDrawable, fieldPixel, FieldSafetyError, type FieldHit, type FieldSafetyFailure } from "./draw/field.ts";
export { impostors, type Impostors, type Cell, type ImpostorHit, type ImpostorOptions, type ImpostorShape } from "./draw/impostors.ts";
export { type Copies, type CopiesHit, type CopiesOptions } from "./draw/copies.ts";
// Form finer than the curves: height functions and stamps, sculpt layers, displacement. The shell tracer `draw.relief`
// draws with is internal (src/relief/trace.ts).
export * from "./relief/height.ts";
export { sculptLayer, displace } from "./relief/index.ts";
export { type ReliefDrawable, type ReliefPoint, type ReliefSite } from "./draw/relief.ts";
export { movable, type Sun } from "./sun.ts";

// What recipes under examples/ need of the core (examples/README.md).
export { noise2, type Branch } from "./lib/index.ts";
export type { Camera } from "./artefact.ts";
