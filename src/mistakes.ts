// The checks a constructor runs on what it was given, so a mistake is refused where it was made, by the user's own
// name for the thing, with what was given, what was expected and the smallest fix (`SceneError`). Each check is one
// function called from one constructor; the fixtures in tests/fixtures/mistakes/ are the mistakes they catch.
import { Expr, lift, type Ty } from "./expr.ts";
import { SceneError, shown } from "./errors.ts";
import type { Camera } from "./artefact.ts";

/** The type an expression-like value lifts to (an Expr's own, f32 for a number, vecN for an array), or "none". */
function tyOf(x: unknown): Ty | "none" {
  if (x instanceof Expr) return x.ty;
  if (typeof x === "number") return "f32";
  if (Array.isArray(x) && x.length >= 2 && x.length <= 4 && x.every((n) => typeof n === "number")) return lift(x as never).ty;
  return "none";
}

const isSurface = (s: unknown): boolean =>
  typeof s === "object" && s !== null && typeof (s as { point?: unknown }).point === "function" && typeof (s as { topology?: unknown }).topology === "object";

/** draw.surface (and its lit, flat and glazed forms): the surface, the grid, the look's choices, and what point and paint return. */
export function refuseSurface(name: string, surface: unknown, grid: unknown, look: { readonly kind: string; readonly sides?: unknown; readonly outline?: unknown }, point: () => unknown, paint: (() => unknown) | undefined): void {
  const at = `draw.surface "${name}"`;
  if (!isSurface(surface)) {
    throw new SceneError(at, `${shown(surface)} for the surface`, "a Surface (from surface(), lathe(), loft(), sweep(), ...)",
      `define the surface before this line and pass it: draw.surface("${name}", mySurface, { ... })`);
  }
  const g = grid as { u?: { count?: unknown }; v?: { count?: unknown } } | undefined;
  for (const axis of ["u", "v"] as const) {
    const count = g?.[axis]?.count;
    if (!(Number.isInteger(count) && (count as number) >= 1)) {
      throw new SceneError(at, `grid.${axis} with ${shown(count)} cells`, "a positive whole number of cells", `grid: { u: spacing.even(32), v: spacing.even(24) }`);
    }
  }
  if (look.kind === "lit") {
    if (look.sides !== "one" && look.sides !== "two") {
      throw new SceneError(at, `sides ${shown(look.sides)}`, `"one" (a closed solid) or "two" (a sheet seen from both sides)`, `sides: "one"`);
    }
    if (look.outline !== "hull" && look.outline !== "border" && look.outline !== "none") {
      throw new SceneError(at, `outline ${shown(look.outline)}`, `"hull", "border" (a sheet's edge) or "none"`, `outline: "${look.sides === "two" ? "border" : "hull"}"`);
    }
  }
  const p = tyOf(point());
  if (p !== "vec3") {
    throw new SceneError(at, `a surface whose point is ${article(p)}`, "a vec3 (x, y, z) from the surface's function of (u, v)",
      p === "f32" ? "return vec3(x, y, z) from the surface's function, not one number" : "return vec3(x, y, z) from the surface's function");
  }
  if (paint !== undefined) {
    const c = tyOf(paint());
    if (c !== "vec3") {
      throw new SceneError(at, `paint that returns ${article(c)}`, "a vec3 colour (r, g, b in 0..1)",
        c === "f32" ? "return vec3(g, g, g) for a grey, or vec3(r, g, b)" : c === "vec4" ? "return its .xyz (a lit surface is opaque; draw.glazed takes alpha)" : "return vec3(r, g, b)");
    }
  }
}

const article = (t: Ty | "none"): string => (t === "none" ? "not an expression" : t === "f32" ? "an f32 (one number)" : `a ${t}`);

const isDrawable = (t: unknown): boolean =>
  typeof t === "object" && t !== null && typeof (t as { draws?: unknown }).draws === "function" && typeof (t as { name?: unknown }).name === "string";

/** scene(): things, the sun and the cameras (the names are checked where the scene adds its own things). */
export function refuseScene(spec: { readonly ground?: unknown; readonly things?: unknown; readonly sun?: unknown; readonly cameras?: unknown }): void {
  const ground = spec.ground as { readonly kind?: unknown } | undefined;
  if (!(typeof ground === "object" && ground !== null && (ground.kind === "sea" || ground.kind === "plane" || ground.kind === "nothing"))) {
    // `sea:` was the key before 2026-11 (scenes and docs written then use it): name it when it is what was given.
    const oldKey = "sea" in (spec as object);
    throw new SceneError("scene()", oldKey ? "sea: ... (the old key) and no ground" : `ground: ${shown(spec.ground)}`, "ground: a sea({ swell }), plane or nothing",
      oldKey ? "rename the key: ground: sea({ swell: [...] })" : "ground: plane (flat, y = 0), ground: nothing, or ground: sea({ swell: [...] })");
  }
  if (!Array.isArray(spec.things)) {
    throw new SceneError("scene()", `things: ${shown(spec.things)}`, "things: an array of drawables", `things: [draw.surface("name", shape, { paint, grid, sides: "one", outline: "hull" })]`);
  }
  spec.things.forEach((t, k) => {
    if (isDrawable(t)) return;
    const what = isSurface(t) ? "a Surface (a shape, not yet drawn)" : typeof t === "function" ? "a function (a field or a paint?)" : shown(t);
    const fix = isSurface(t) ? `draw it: draw.surface("name", shape, { paint, grid, sides: "one", outline: "hull" })`
      : typeof t === "function" ? `draw a field with draw.field("name", field, { bounds, paint, steps, outline, schedule })`
      : "put only drawables (draw.surface(...), draw.field(...), strand(...), ...) in things";
    throw new SceneError("scene()", `${what} at things[${k}]`, "a drawable", fix);
  });
  const sun = (typeof spec.sun === "object" && spec.sun !== null && "dir" in spec.sun ? (spec.sun as { dir: unknown }).dir : spec.sun) as unknown;
  if (!(Array.isArray(sun) && sun.length === 3 && sun.every((n) => Number.isFinite(n)))) {
    throw new SceneError("scene()", `sun ${shown(sun)}`, "a direction toward the sun: three finite numbers", "sun: [0.3, 0.8, 0.4]");
  }
  if (Math.hypot(...(sun as number[])) === 0) {
    throw new SceneError("scene()", "sun [0, 0, 0], which points nowhere", "a direction toward the sun with y > 0", "sun: [0.3, 0.8, 0.4]");
  }
  for (const [name, c] of Object.entries((spec.cameras ?? {}) as Record<string, Camera>)) refuseCamera(name, c);
}

function refuseCamera(name: string, c: Camera): void {
  const at = `scene(): camera "${name}"`;
  const v3 = (x: unknown) => Array.isArray(x) && x.length === 3 && x.every((n) => Number.isFinite(n));
  if (!v3(c.eye) || !v3(c.target)) throw new SceneError(at, `eye ${shown(c.eye)} and target ${shown(c.target)}`, "two points of three finite numbers", `eye: [5, 4, 6], target: [0, 1, 0]`);
  if (c.eye.every((x, i) => x === c.target[i])) {
    throw new SceneError(at, `eye and target both at ${shown(c.eye)}`, "an eye apart from the point it looks at", `move the eye back, e.g. eye: [${c.target[0] + 5}, ${c.target[1] + 3}, ${c.target[2] + 6}]`);
  }
  switch (c.kind) {
    case "perspective":
      if (!(c.fovY > 0 && c.fovY < Math.PI)) {
        const deg = c.fovY > 1 && c.fovY < 180;
        throw new SceneError(at, `fovY ${shown(c.fovY)}`, "a vertical field of view in radians, between 0 and pi (0.6 is about 34 degrees)",
          deg ? `fovY: ${c.fovY} * Math.PI / 180 (it is in radians)` : "fovY: 0.6");
      }
      return;
    case "orthographic":
      if (!(c.height > 0 && Number.isFinite(c.height))) throw new SceneError(at, `height ${shown(c.height)}`, "the height of the view in world units, positive", "height: 10");
      return;
    default:
      throw new SceneError(at, `kind ${shown((c as { kind: unknown }).kind)}`, `"perspective" or "orthographic"`, `kind: "perspective"`);
  }
}
