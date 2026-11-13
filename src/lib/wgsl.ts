// The raw-shader escape hatch: a WGSL function with no CPU twin.
import { lib, type Expr, type In, type LibFn, type Ty } from "../expr.ts";

export type WgslFnSpec<T extends Ty> = {
  /** The WGSL function's name; the definition in `wgsl` must declare exactly this function. */
  readonly name: string;
  readonly ret: T;
  /** The full function definition (and nothing else that other definitions could collide with). */
  readonly wgsl: string;
  /** Other library functions the body calls; their definitions are placed before this one. */
  readonly deps?: readonly LibFn[];
};

/**
 * Wraps a hand-written WGSL function as a callable that builds a call to it inside an expression. Evaluating the
 * resulting expression on the CPU throws (`compileJs` raises its "GPU-only" error), so use it only in shader-stage
 * expressions. For authors who need raw WGSL beyond the expression functions; most scenes do not.
 */
export function wgslFn<T extends Ty>(spec: WgslFnSpec<T>): (...args: In[]) => Expr<T> {
  if (!new RegExp(`\\bfn\\s+${spec.name}\\s*\\(`).test(spec.wgsl)) {
    throw new Error(`wgslFn "${spec.name}": the wgsl text does not define a function with that name`);
  }
  const fn: LibFn = { name: spec.name, ret: spec.ret, wgsl: spec.wgsl, js: "gpu-only", deps: spec.deps ?? [] };
  return (...args) => lib<T>(fn, ...args);
}

/**
 * How much `x` changes from one pixel to the next (WGSL `fwidth`): the width to antialias an edge of `x` with.
 * Fragment stage only, and only in uniform control flow (WGSL's derivative rule); GPU-only.
 */
export const fwidth = wgslFn<"f32">({ name: "loft_fwidth", ret: "f32", wgsl: "fn loft_fwidth(x: f32) -> f32 { return fwidth(x); }" });

// Camera and pixel facts the prelude knows (`frame`, `view_dir`, and `pixel_world` in sceneWgsl). Shader stages only.

/** Unit direction from the eye toward a world point (the camera's forward direction when orthographic). GPU-only. */
export const viewDir = wgslFn<"vec3">({ name: "loft_view_dir", ret: "vec3", wgsl: "fn loft_view_dir(p: vec3<f32>) -> vec3<f32> { return view_dir(p); }" });
/** The eye position in world space. GPU-only. */
export const eyePosition = wgslFn<"vec3">({ name: "loft_eye", ret: "vec3", wgsl: "fn loft_eye() -> vec3<f32> { return frame.eye.xyz; }" });
/** World size of one pixel at a world point. GPU-only. */
export const pixelWorld = wgslFn<"f32">({ name: "loft_pixel_world", ret: "f32", wgsl: "fn loft_pixel_world(p: vec3<f32>) -> f32 { return pixel_world(p); }" });
