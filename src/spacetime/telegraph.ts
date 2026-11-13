// The telegraph: the simulation's own hit shape drawn on the water as a danger marker (DESIGN.md 8). It is the hit
// shape, not the future body's footprint: a body is not hit-shaped, and the game resolves the hit against the shape.
//
// Drawn as one glazed patch of the sea surface covering the shape (and nothing else), coloured per pixel from the
// shape's signed distance: a dark-red fill, a bone edge with teeth pointing inward, an ink line round the bone so it
// reads on bright and dark water alike. As the arming time approaches the teeth lengthen, the fill strengthens and
// throbs faster; at arming the whole shape flashes for one frame; then it fades. Antialiased by the distance's own
// screen derivative, so it is crisp at any zoom.

import {
  add, cos, div, fract, input, lift, max, min, mix, mul, pow, saturate, step, sub, TAU, time, vec2, vec3, vec4, type Expr,
} from "../expr.ts";
import { scopedName } from "../expr.ts";
import type { CompileContext, Drawable, Emitted } from "../compile/context.ts";
import { drawGlazed, spacing, type Fragment } from "../draw/surface.ts";
import { surfaceOf } from "../draw/ground.ts";
import { coverage, sdTriangleIsosceles, stroke } from "../lib/sdf2.ts";
import { fwidth } from "../lib/wgsl.ts";
import { NO_SKELETON, type Surface } from "../map/types.ts";
import type { Attack } from "./attack.ts";
import { hitContour, hitInradius, hitPatch } from "./hit.ts";

type F = Expr<"f32">;
type Rgb = readonly [number, number, number];

export type TelegraphStyle = {
  readonly bone: Rgb;
  readonly fill: Rgb;
  readonly ink: Rgb;
  readonly flash: Rgb;
  /** World distance between teeth. */
  readonly spacing: number;
  /** Width of the bone edge, world units (never under 1.5 pixels). */
  readonly edge: number;
  /** Width of the ink line, world units (never under a pixel). */
  readonly line: number;
  /** Fill opacity at the start of the warning and at arming. */
  readonly fillFrom: number;
  readonly fillTo: number;
  /** Tooth length as a multiple of the tooth spacing, at the start of the warning and at arming (at most 0.8 of the inradius). */
  readonly teethFrom: number;
  readonly teethTo: number;
  /** Seconds the marker takes to fade after the flash. */
  readonly fade: number;
};

/**
 * The default look of a telegraph: a dark-red fill that strengthens toward the arming time, a bone edge with teeth
 * pointing inward, an ink line round it so it reads on bright and dark ground alike, a pale flash at arming. Override
 * any field with `telegraph(attack, { style: { ... } })`.
 */
export const DANGER: TelegraphStyle = {
  bone: [0.98, 0.93, 0.8], fill: [1.0, 0.26, 0.08], ink: [0.12, 0.02, 0.03], flash: [1.0, 0.97, 0.88],
  spacing: 0.85, edge: 0.13, line: 0.06, fillFrom: 0.25, fillTo: 0.78, teethFrom: 0.35, teethTo: 1.1, fade: 0.3,
};

/** Grid cells of the patch: enough to follow the swell under a shape some units across. */
const GRID = { u: 28, v: 10 } as const;
/** How far the patch reaches past the shape: the ink line and the antialiasing. */
const PAD = 0.25;

/** Straight-alpha `over`: (colour, alpha) of `top` laid over `bottom`. */
function over(top: readonly [Expr<"vec3">, F], bottom: readonly [Expr<"vec3">, F]): [Expr<"vec3">, F] {
  const a = add(top[1], mul(bottom[1], sub(1, top[1])));
  const c = div(add(mul(top[0], top[1]), mul(bottom[0], mul(bottom[1], sub(1, top[1])))), max(a, 1e-5));
  return [c, a];
}

class Telegraph implements Drawable {
  readonly skeletons = [];
  readonly surfaces = [];
  /** Seconds the flash lasts: one frame at the host's rate (an input, since only the host knows its rate). */
  readonly flash: F;

  constructor(readonly name: string, readonly attack: Attack, readonly style: TelegraphStyle) {
    this.flash = input(`${attack.name}.flashSeconds`, "f32", [1 / 30]);
  }

  /** Colour and alpha at a point of the water at the current time. */
  colour(fr: Fragment): Expr<"vec4"> {
    const s = this.style, a = this.attack;
    const p = vec2(fr.world.x, fr.world.z);
    const c = hitContour(a.hit, p, s.spacing);
    // One pixel in the plane, from the distance's own derivative (the distance has unit gradient).
    const px = max(fwidth(c.d), 1e-5);

    const start = sub(a.arm, a.warn);
    const k = saturate(div(sub(time, start), a.warn));
    // Teeth scale with their own spacing (so they read as teeth on any size of shape), short of meeting in the middle.
    const teeth = min(mul(c.pitch, mix(s.teethFrom, s.teethTo, pow(k, 1.5))), mul(hitInradius(a.hit), 0.8));
    // The throb quickens toward arming: its phase is the integral of a rising rate (1 to 5 Hz).
    const throb = add(0.86, mul(cos(mul(mul(a.warn, add(k, mul(mul(k, k), 2))), TAU)), 0.14));
    const fillAlpha = mul(mix(s.fillFrom, s.fillTo, mul(k, k)), throb);

    const edgeW = max(s.edge, mul(px, 1.5)), lineW = max(s.line, px);
    const inward = mul(c.d, -1);
    const toothX = mul(sub(fract(c.phase), 0.5), c.pitch);
    const tooth = max(sdTriangleIsosceles(vec2(toothX, inward), mul(c.pitch, 0.3), teeth), c.d);
    const bone = min(stroke(add(c.d, mul(edgeW, 0.5)), mul(edgeW, 0.5)), tooth);
    const inside = coverage(c.d, px);

    const fill: [Expr<"vec3">, F] = [vec3(...s.fill), mul(inside, fillAlpha)];
    const ink: [Expr<"vec3">, F] = [vec3(...s.ink), mul(coverage(sub(bone, lineW), px), 0.9)];
    const boneLayer: [Expr<"vec3">, F] = [vec3(...s.bone), coverage(bone, px)];
    const [col, alpha] = over(boneLayer, over(ink, fill));

    // The flash: the whole shape for one frame from the arming time; then the marker fades out.
    const flashing = mul(step(a.arm, time), sub(1, step(add(a.arm, this.flash), time)));
    const colour = mix(col, vec3(...s.flash), flashing);
    const shown = mix(alpha, mul(max(inside, coverage(sub(bone, lineW), px)), 0.92), flashing);
    const after = saturate(div(sub(time, add(a.arm, this.flash)), s.fade));
    const live = mul(step(start, time), sub(1, after));
    return vec4(colour, mul(shown, live));
  }

  draws(ctx: CompileContext): Emitted {
    const h = this.attack.hit, height = surfaceOf(ctx.ground, `telegraph "${this.name}"`);
    const surface: Surface = {
      point: (u, v) => { const xz = hitPatch(h, u, v, lift<"f32">(PAD)); return vec3(xz.x, height(xz), xz.y); },
      normal: () => vec3(0, 1, 0),
      anchor: (u, v) => vec3(u, v, 0), // a glazed marker: its colour reads (u, v) itself
      topology: { u: ["free", "free"], v: "free" },
      skeleton: NO_SKELETON,
    };
    return drawGlazed(this.name, surface, {
      colour: (fr) => this.colour(fr), grid: { u: spacing.even(GRID.u), v: spacing.even(GRID.v) }, phase: "on-water", sceneDepth: false,
    }).draws(ctx);
  }
}

/**
 * The attack's hit shape on the ground (a sea or a plane), as a danger marker that sharpens until the arming time. It is
 * the hit shape itself, not the body's future footprint: the game resolves the hit against the shape, so the player is
 * shown exactly that.
 *
 * The law. With k = (time - (T - warn)) / warn clamped to 0..1 (T the attack's arming time, `attack.arm`), the
 * marker is coloured per pixel from the shape's signed distance d: a fill inside whose opacity rises with k^2 and throbs
 * at a rate rising from 1 to 5 Hz; a bone edge whose inward teeth (spaced `spacing` along the edge, a whole number per
 * edge) lengthen with k^1.5 up to 0.8 of the shape's inradius; an ink line round the bone. At T the whole shape flashes
 * for one frame, then fades over `fade` seconds. Antialiased by d's own screen derivative, so it is crisp at any zoom.
 *
 * Parameters: the shape, the arming time and the warning are the attack's (expressions, so a game moves them); the
 * style's colours and sizes are fixed numbers; the flash's length is a host input, `<attack>.flashSeconds` (default
 * 1/30), since only the host knows its frame rate.
 *
 * What it cannot do, because of the law:
 * - draw anything but the hit shape: not the body, not a path, not a cone of sight.
 * - lie on a ground of nothing, on a wall or on a body: it is a patch of the ground's surface.
 * - warn for longer than `warn`, or stay after its fade: it is drawn only from T - warn to T + flash + fade.
 * - change its motif: teeth on a bone edge round a fill; only the colours and sizes in `TelegraphStyle` are open.
 *
 * Going past it: `hitSdf(attack.hit, p)` is the same distance, and `hitPatch` the same patch, so a marker of your own is
 * a `surface` over the patch whose look reads the distance and k from `attack.arm` and `attack.warn`.
 * Relatives worth trying:
 * - a fill that closes in from the edge: inside where d < (k - 1) times the inradius, so the safe time is the empty
 *   middle.
 * - a sweep shown as a moving line: an arc's angle mixed from `from` to `to` by k, a band along it.
 * - a warning on the body instead: paint on the striking part that brightens with the same k.
 */
export function telegraph(attack: Attack, o: { readonly style?: Partial<TelegraphStyle>; readonly name?: string } = {}): Drawable {
  return new Telegraph(scopedName(o.name ?? `telegraph_${attack.name}`), attack, { ...DANGER, ...o.style });
}
