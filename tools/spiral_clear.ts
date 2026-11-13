// How near the crab's own limbs come to the spiral shell over one cycle (docs/art_direction/DIRECTION.md, Round 5):
// the legs through the walk, both claws through the Grab, its throw and the slam, the eyes on their stalks, and with
// --taunt the lineup's dance (the great claw raised and waved). Measured on the CPU from the scene's own expressions:
// every limb's drawn surface is sampled (not its skeleton, whose radii take a flat hand for a round one), carried
// into the shell frame (`rig.shell`), and its distance to the shell's outside taken (negative: inside it). A point
// inside is told apart by where it is (`shellTwin`'s `where`): in the mouth (only the last whorl, near the lip: a limb
// there has gone in through the opening) or in the wall (anywhere else: through the shell). The carapace is measured
// the same way over the cycle: its rear belongs in the mouth, never in the wall, and where it is outside, its least
// gap to the shell is the throat under the lip.
//
//   bun tools/spiral_clear.ts [--variant islander] [--taunt | --routine] [--except t0-t1] [--rate 10] [--set '{"tilt":0.6}']
//
// --routine: the variant as its member of the lineup's group dance (examples/bosses/crab_lineup.ts, `DANCE`), with the
// lineup's numbers (its 32 s loop, the group's manner) and its solo. --except skips a stretch of the loop (seconds),
// such as the slam's wind-up, so that the rest of the loop's nearest approach is reported.
//
// The limbs do not depend on the back, so this measures any shell numbers against the variant as built.

import { compileScene } from "../src/compile/index.ts";
import { Probe } from "../src/check.ts";
import { scene, sea, variable, type Expr } from "../src/index.ts";
import { design, styleFor, SUN, WATER } from "../examples/bosses/reefback_titan.ts";
import { shellTwin, vmath } from "../examples/bosses/titan/back/spiral_shell.ts";
import { AT_HOME, type Staging } from "../examples/bosses/titan/rig.ts";
import type { Numbers } from "../examples/bosses/titan/numbers.ts";
import { LINE, lineupStaging, onTheBeat } from "../examples/bosses/crab_lineup.ts";

type V = readonly [number, number, number];
const { dot } = vmath;
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const merge = (a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(a).map(([k, v]) => [k, k in b ? (typeof v === "object" && !Array.isArray(v) ? merge(v as Record<string, unknown>, b[k] as Record<string, unknown>) : b[k]) : v]));

const variant = flag("--variant") ?? "islander", rate = Number(flag("--rate") ?? 10), set = flag("--set");
const inRoutine = args.includes("--routine"), member = LINE.indexOf(variant as (typeof LINE)[number]);
if (inRoutine && member < 0) throw new Error(`spiral_clear: --routine needs a variant in the lineup (${LINE.join(", ")})`);
const resolved = design.resolve({ variant, picks: [] }, inRoutine ? onTheBeat(member) : undefined);
const except = (flag("--except") ?? "").split("-").filter((x) => x !== "").map(Number);
const n0 = resolved.numbers as Numbers;
const n = { ...n0, spiral: set === undefined ? n0.spiral : merge(n0.spiral, JSON.parse(set)) } as Numbers;
// The lineup's taunt for its first crab (examples/bosses/crab_lineup.ts), on this crab's own 22 s cycle: armed at 14.5 s.
const how: Staging = inRoutine ? lineupStaging(member, variant) : args.includes("--taunt") ? { ...AT_HOME, taunt: { kind: "dance", first: 14.5, accents: [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.0] } } : AT_HOME;
const staged = design.stage(resolved, how), water = sea({ ...staged.sea, deform: staged.deforms }), m = staged.finish(water);
const built = scene({ ground: water, things: m.things, style: styleFor(n0, WATER.ridge), sun: SUN, cameras: { game: { kind: "perspective", eye: [23, 27, 21], target: [3, 0.5, 2.5], fovY: 0.6 } } });
const probe = new Probe(compileScene(built), {});

// ---- the shell's outside as a cloud in crab coordinates, in a grid of cells for nearest-point queries ----
const twin = shellTwin(n), P = twin.plan, TAU = 2 * Math.PI, CELL = 0.6;
type Sample = { readonly p: V; readonly back: number; readonly phi: number };
const cells = new Map<string, Sample[]>();
const key = (x: number, y: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`;
for (let i = 0; i <= 420; i++) for (let j = 0; j < 96; j++) {
  const back = (i / 420) * P.whorls, phi = (j / 96) * TAU, p = twin.at(back, phi), k = key(p[0], p[1], p[2]);
  (cells.get(k) ?? cells.set(k, []).get(k)!).push({ p, back, phi });
}
const REACH = 4;
/** Distance from a crab-coordinate point to the shell's outside, negative inside it; `REACH` cells away or more reads as far. */
const gapTo = (q: V): number => {
  let best = Infinity;
  const [cx, cy, cz] = [Math.floor(q[0] / CELL), Math.floor(q[1] / CELL), Math.floor(q[2] / CELL)];
  for (let dx = -REACH; dx <= REACH; dx++) for (let dy = -REACH; dy <= REACH; dy++) for (let dz = -REACH; dz <= REACH; dz++) {
    for (const s of cells.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) { const d = Math.hypot(q[0] - s.p[0], q[1] - s.p[1], q[2] - s.p[2]); if (d < best) best = d; }
  }
  if (best === Infinity) return twin.inside(q) ? -REACH * CELL : REACH * CELL;
  return twin.inside(q) ? -best : best;
};

// ---- the limbs: every drawn surface of the crab but its back and its carapace ----
const UU = variable("clear_u", "f32"), VV = variable("clear_v", "f32");
type Surf = { readonly name: string; readonly point: (u: Expr<"f32">, v: Expr<"f32">) => Expr<"vec3"> };
const isSurf = (t: unknown): t is Surf => typeof t === "object" && t !== null && "name" in t && "point" in t && typeof (t as Surf).point === "function";
const LIMB = /^(leg|crusher|cutter|stalk|eye|lid|cheek)/;
const surfaces = (m.things as readonly unknown[]).filter(isSurf);
const limbs = surfaces.filter((t) => LIMB.test(t.name)).map((t) => ({ name: t.name, roots: [t.point(UU, VV)] }));
const hull = surfaces.find((t) => t.name === "titan");
const shellRoots = [m.rig.shell.o, m.rig.shell.x, m.rig.shell.y, m.rig.shell.z];
console.log(`${variant}${how.taunt.kind === "dance" ? " with the taunt" : how.taunt.kind === "routine" ? ` in the routine${except.length === 2 ? ` (except ${except[0]} to ${except[1]} s)` : ""}` : ""}: ${limbs.length} limb surfaces (${limbs.map((l) => l.name).join(", ")}); ${n.crushPeriod} s at ${rate} a second`);

type Least = { gap: number; when: number; at: V; kind: "clear" | "mouth" | "wall" };
const least = new Map<string, Least>();
const lipFront = Math.max(...Array.from({ length: 72 }, (_, j) => twin.at(0, (j / 72) * TAU)[0]));
const eyesAt = new Map<number, number>(), EYE_TIMES = [1.0, 3.6, 11.3, 12.4, 17.5];
const body = { wall: { gap: Infinity, when: 0, at: [0, 0, 0] as V }, throat: { gap: Infinity, when: 0, at: [0, 0, 0] as V } };
const hullRoots = hull === undefined ? [] : [hull.point(UU, VV)];
const group = (name: string) => name.replace(/^leg([LR])(\d)$/, "leg$1$2").replace(/^(crusher|cutter).*/, "$1 claw").replace(/^(stalk|eye|lid|cheek)([LR])$/, "eye$2");
for (let t = 0; t < n.crushPeriod; t += 1 / rate) {
  if (except.length === 2 && t >= except[0]! && t < except[1]!) continue;
  const [o, x, y, z] = probe.eval(shellRoots, t) as unknown as V[];
  const inShell = (p: V): V => { const d = sub(p, o!); return [dot(d, x!), dot(d, y!), dot(d, z!)]; };
  for (const L of limbs) {
    const g = group(L.name);
    for (let i = 0; i <= 14; i++) for (let j = 0; j < 8; j++) {
      const p = inShell(probe.eval(L.roots, t, { clear_u: i / 14, clear_v: j / 8 })[0] as unknown as V);
      const d = gapTo(p), was = least.get(g), w = twin.where(p);
      if (was === undefined || d < was.gap) least.set(g, { gap: d, when: t, at: p, kind: w.kind === "outside" ? "clear" : w.kind });
      if (g.startsWith("eye")) for (const T of EYE_TIMES) if (Math.abs(t - T) < 0.5 / rate) eyesAt.set(T, Math.min(eyesAt.get(T) ?? Infinity, p[0]));
    }
  }
  // The carapace: in the wall anywhere (its rear belongs in the mouth), and its least gap to the shell outside it.
  for (let i = 0; i <= 24; i++) for (let j = 0; j < 16 && hullRoots.length > 0; j++) {
    const p = inShell(probe.eval(hullRoots, t, { clear_u: i / 24, clear_v: j / 16 })[0] as unknown as V), w = twin.where(p);
    if (w.kind === "wall") { const d = gapTo(p); if (d < body.wall.gap) body.wall = { gap: d, when: t, at: p }; }
    if (w.kind === "outside") { const d = gapTo(p); if (d < body.throat.gap) body.throat = { gap: d, when: t, at: p }; }
  }
}
console.log("least distance to the shell's outside (crab units; below 0 is inside the shell), when, and where on the limb (crab coordinates):");
const fmt = (p: V) => `(${p.map((c) => c.toFixed(1)).join(", ")})`;
for (const [name, v] of [...least].sort((a, b) => a[1].gap - b[1].gap)) console.log(`  ${name.padEnd(13)} ${v.gap >= REACH * CELL ? `over ${(REACH * CELL).toFixed(1)}` : v.gap.toFixed(2).padStart(6)}  ${v.kind.padEnd(5)}  at t = ${v.when.toFixed(1)}  ${fmt(v.at)}`);
const through = [...least].filter(([, v]) => v.kind === "wall").map(([k]) => k);
console.log(`through the wall: ${through.length === 0 ? "nothing" : through.join(", ")}`);
console.log(`carapace: ${body.wall.gap === Infinity ? "never in the wall" : `IN THE WALL ${body.wall.gap.toFixed(2)} at t = ${body.wall.when.toFixed(1)} ${fmt(body.wall.at)}`}; least gap to the shell outside it (the throat) ${body.throat.gap.toFixed(2)} at t = ${body.throat.when.toFixed(1)} ${fmt(body.throat.at)}`);
console.log(`eyes' least x against the lip's front (x = ${lipFront.toFixed(2)}): ${EYE_TIMES.filter((T) => eyesAt.has(T)).map((T) => `t ${T}: ${eyesAt.get(T)!.toFixed(2)}`).join(", ")}`);
