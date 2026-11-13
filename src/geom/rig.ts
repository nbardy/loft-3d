// A closed-form frame as a rigid chart: a creature's root (hovering, walking a course) is a Frame of expressions, and
// its parts are authored in that frame's coordinates and placed with `rigid(frame)`, so mirroring them across the
// creature's own z = 0 plane (`mirror`, before placing) is a mirror across its sagittal plane wherever it is.

import { add, substitute, time, type Expr } from "../expr.ts";
import { rotate } from "../map/chart.ts";
import type { Chart, F, Frame } from "../map/types.ts";

/**
 * A chart that carries local coordinates rigidly with one frame: everything built in it moves and turns together,
 * keeping its shape. The frame's parts may be expressions of time, inputs or params, so the whole thing can move.
 *
 * The shape and its law: the local point l lands at g.o + l.x g.x + l.y g.y + l.z g.z, the same frame (g.x, g.y, g.z)
 * at every point; `at(t)` substitutes t for time in the frame.
 *
 * Parameters: the one frame `g`, any expressions. Its axes are taken as given, not checked.
 *
 * What it cannot do, because one frame holds everywhere:
 * - bend, twist or stretch what it carries: every point gets the same axes (give axes that are not unit and
 *   perpendicular and it scales and shears instead, silently).
 * - follow a surface: a part reaching off the frame's origin does not touch the ground or the water there.
 *
 * Going past it: `on(host, c)` is the same placement at a point of another chart, and `compose(outer, inner)` carries
 * one chart through another. Relatives, by letting the frame depend on where the point is:
 * - a frame that turns along one coordinate: `bent`, a stalk whose heading turns away from its root's.
 * - local coordinates scaled per axis before placing: `sized` (squash and stretch as one).
 * - a frame read off a surface under the thing: `afloat` tilts it by the water's heights at four points.
 */
export function rigid(g: Frame): Chart {
  return {
    frame: (l) => ({ o: add(g.o, rotate(g, l)), x: g.x, y: g.y, z: g.z }),
    at: (t: F) => {
      const [o, x, y, z] = substitute([g.o, g.x, g.y, g.z], time, t) as Expr<"vec3">[];
      return rigid({ o, x, y, z });
    },
    atNear(t: F) { return this.at(t); },
  };
}
