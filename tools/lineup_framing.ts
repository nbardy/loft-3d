// The lineup's framing on paper (docs/lineup.md, "A drilled group", "Framing from above", "Deeper"): each crab as boxes
// in its own axes (everything from feet to the tops of its buildings, its body from shell top to waterline, its face
// with the eyes on their stalks, its buildings, and its great claw: at its rest, or where the score aims it, its hand
// as a box from the wrist), placed, turned and raised where the score has it, projected through the shot in force on
// the CPU. A second to run: `bun tools/lineup_framing.ts`. At each unison key and at each group shot's first frame: the
// group's box (leftmost to rightmost leg, feet to the tops of the buildings) as a share of the frame's width and height,
// the front member's body as a share of the height, each face's window (the share of its box no nearer member's body,
// claw or buildings covers), each face's own window (the share its own great claw, nearer the camera, leaves clear),
// and where the horizon is (a share of the height from the top). At each click: how far each claw's fingertip travels
// on screen (px) as it snaps.
//
//   bun tools/lineup_framing.ts [--turn radians] [--search square]
//
// --turn: the quarter turn's angle, in place of the score's (the score's face channel scaled to it).
// --search square: the square's group cameras searched over eye height, distance, pitch and lens.
import { compileJs, variable } from "../src/expr.ts";
import { DANCE, LINE, members } from "../examples/bosses/crab_lineup.ts";
import { BEAT, formats, GROUP, raised, shotAt, type Lens } from "../examples/bosses/lineup_shots.ts";
type V3 = readonly [number, number, number];
type Box = { x: readonly [number, number]; y: readonly [number, number]; z: readonly [number, number] };
/** A great claw's hand, from the wrist: a fiddler's banner stands up from it; a pincer's palm and fingers run on along the arm. */
type Hand = { readonly kind: "banner"; readonly len: number; readonly fat: number } | { readonly kind: "pincer"; readonly len: number; readonly fat: number };
/** `tip`: how far a fingertip travels as the fingers go from wide open to shut (units: the moving finger's chord times the gape's change, plus the fixed finger's). */
type Crab = { all: Box; body: Box; face: Box; claw: Box; up: Box; built: Box; hand: Hand; tip: number };
// Crab axes (x forward, y up, z its right). Feet drawn in to 0.85 of the spread (the routine's stance). The claw at rest:
// the fiddler's banner beside the face, the samurai's gauntlet low in front, the tongs in front of the stilts; raised:
// the wrist about 0.76 of the arm span over the shoulder and the hand above it.
const BANNER: Box = { x: [1, 8], y: [0.5, 9.5], z: [2.5, 8.5] }, BANNER_UP: Box = { x: [2, 7], y: [4, 13], z: [0.5, 5] };
// The fiddler's hand: 3.6 x 2.4 long, 0.95 x 2.4 thick; its dactyl 4.32 long (chord about 3.67), gape 0 to 1.1: 2 x 3.67 x sin(0.55).
const FIDDLER: Hand = { kind: "banner", len: 8.6, fat: 2.3 }, FIDDLER_TIP = 2 * 3.67 * Math.sin(0.55);
export const CRABS: Record<string, Crab> = {
  islander: { all: { x: [-3, 7], y: [-0.3, 11], z: [-8.5, 9] }, body: { x: [-1.6, 5], y: [-0.3, 4.5], z: [-4.1, 4.1] }, face: { x: [4, 6], y: [2, 7], z: [-2.5, 2.5] }, claw: BANNER, up: BANNER_UP, built: { x: [-3, 1.5], y: [1.5, 9.5], z: [-2.5, 2.5] }, hand: FIDDLER, tip: FIDDLER_TIP },
  fiddler: { all: { x: [-3, 7], y: [-0.3, 12.5], z: [-8.5, 9] }, body: { x: [-1.6, 5], y: [-0.3, 3.4], z: [-4.1, 4.1] }, face: { x: [4, 6], y: [2, 7.5], z: [-2.5, 2.5] }, claw: BANNER, up: BANNER_UP, built: { x: [-1.5, 1.5], y: [3, 12.5], z: [-1.5, 1.5] }, hand: FIDDLER, tip: FIDDLER_TIP },
  bruiser: { all: { x: [-3, 7], y: [-0.3, 10], z: [-8.5, 10] }, body: { x: [-1.6, 5], y: [-0.3, 4.5], z: [-4.1, 4.1] }, face: { x: [4, 6.5], y: [1.5, 5], z: [-2.5, 2.5] }, claw: { x: [0, 7], y: [0.5, 9.5], z: [3.6, 9.6] }, up: BANNER_UP, built: { x: [-3, 2], y: [3, 7.5], z: [-3, 3] }, hand: FIDDLER, tip: FIDDLER_TIP },
  // The gauntlet: palm 2.9 x 1.4, fingers 0.95 of it (chord 0.84 of that); the dactyl's gape 0.28 to 1.13 and the fixed finger's a third of it.
  mask: { all: { x: [-3, 10], y: [-0.3, 10.5], z: [-8.5, 8.5] }, body: { x: [-1.6, 5], y: [-0.3, 4.4], z: [-4.1, 4.1] }, face: { x: [4.5, 5.5], y: [0.6, 3.6], z: [-3.5, 3.5] }, claw: { x: [4, 10], y: [-0.5, 2.5], z: [1.5, 5] }, up: { x: [3, 7], y: [3, 9], z: [1, 5] }, built: { x: [-2, 2], y: [3, 10.5], z: [-2, 2] }, hand: { kind: "pincer", len: 7.9, fat: 1.5 }, tip: 0.84 * 3.86 * 0.85 * 1.35 },
  // The tongs: palm 3.0 x 1.15, the same mechanism.
  stilt: { all: { x: [-8, 6], y: [-0.3, 15.5], z: [-9.5, 9.5] }, body: { x: [-2.5, 3], y: [3.5, 9], z: [-3.5, 3.5] }, face: { x: [2, 3.5], y: [5.6, 8.2], z: [-2.2, 2.2] }, claw: { x: [2, 8], y: [0, 6], z: [-4, 4] }, up: { x: [2, 7], y: [8, 16], z: [0.5, 5] }, built: { x: [-1.5, 1.5], y: [9, 15.5], z: [-1.5, 1.5] }, hand: { kind: "pincer", len: 6.7, fat: 0.6 }, tip: 0.84 * 3.28 * 0.85 * 1.35 },
};
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };

/** A member at an instant: where it stands, which way it faces, how high its body rides, and its great claw (aimed by the score, or at its own rest). */
export type Pose = { readonly at: readonly [number, number]; readonly heading: number; readonly rise: number; readonly claw: { readonly kind: "rest"; readonly raised: boolean } | { readonly kind: "aimed"; readonly wrist: V3 } };
type R = { x0: number; x1: number; y0: number; y1: number; d: number };
export type Framing = { readonly groupW: number; readonly groupH: number; readonly front: number; readonly frontBody: number; readonly windows: readonly number[]; readonly own: readonly number[]; readonly faces: readonly number[]; readonly horizon: number; readonly worstWindow: number; readonly pxPerUnitAtClaw: readonly number[] };

/** The hand's box (crab axes) from its wrist. */
function handBox(h: Hand, w: V3, shoulder: V3): Box {
  switch (h.kind) {
    // Raised by a routine the banner turns out to the side as it would on its own wave (claws/fiddler.ts: its rest
    // `along` [-0.3, 0.92, 0.15] plus [0.1, 0.35, 0.75]): its hand runs from the wrist up and out at about 35 degrees.
    case "banner": {
      const d = unit([-0.2, 1.27, 0.9]), e: V3 = [w[0] + d[0] * h.len, w[1] + d[1] * h.len, w[2] + d[2] * h.len], r = h.fat / 2;
      return { x: [Math.min(w[0], e[0]) - r, Math.max(w[0], e[0]) + r], y: [w[1] - r, e[1] + r], z: [Math.min(w[2], e[2]) - r, Math.max(w[2], e[2]) + r] };
    }
    case "pincer": {
      const d = unit(sub(w, shoulder)), e: V3 = [w[0] + d[0] * h.len, w[1] + d[1] * h.len, w[2] + d[2] * h.len];
      return { x: [Math.min(w[0], e[0]) - h.fat, Math.max(w[0], e[0]) + h.fat], y: [Math.min(w[1], e[1]) - h.fat, Math.max(w[1], e[1]) + h.fat], z: [Math.min(w[2], e[2]) - h.fat, Math.max(w[2], e[2]) + h.fat] };
    }
  }
}

/** The group through a lens. */
export function frameGroup(line: readonly string[], poses: readonly Pose[], l: Lens, W: number, H: number): Framing {
  const fw = unit(sub(l.target, l.eye)), r = unit(cross(fw, [0, 1, 0])), u = cross(r, fw), kk = H / 2 / Math.tan(l.fovY / 2);
  const px = (p: V3) => { const d = sub(p, l.eye), z = dot(d, fw); return [W / 2 + (kk * dot(d, r)) / z, H / 2 - (kk * dot(d, u)) / z, z] as const; };
  const world = (k: number, x: number, y: number, z: number): V3 => { const p = poses[k]!, c = Math.cos(p.heading), n = Math.sin(p.heading); return [p.at[0] + x * c - z * n, y + p.rise, p.at[1] + x * n + z * c]; };
  const rect = (k: number, b: Box): R => {
    const ps: (readonly [number, number, number])[] = [];
    for (const x of b.x) for (const y of b.y) for (const z of b.z) ps.push(px(world(k, x, y, z)));
    return { x0: Math.min(...ps.map((q) => q[0])), x1: Math.max(...ps.map((q) => q[0])), y0: Math.min(...ps.map((q) => q[1])), y1: Math.max(...ps.map((q) => q[1])), d: Math.min(...ps.map((q) => q[2])) };
  };
  const per = line.map((v, k) => {
    const C = CRABS[v.split("+")[0]!]!, cl = poses[k]!.claw;
    const claw = cl.kind === "rest" ? (cl.raised ? C.up : C.claw) : handBox(C.hand, cl.wrist, SHOULDERS[k]!);
    const wrist: V3 = cl.kind === "aimed" ? cl.wrist : [(claw.x[0] + claw.x[1]) / 2, (claw.y[0] + claw.y[1]) / 2, (claw.z[0] + claw.z[1]) / 2];
    return { all: rect(k, C.all), body: rect(k, C.body), face: rect(k, C.face), claw: rect(k, claw), built: rect(k, C.built), wristZ: dot(sub(world(k, ...wrist), l.eye), fw) };
  });
  const N = 12;
  const windowOf = (f: R, occ: readonly R[]): number => {
    let hid = 0, inside = 0;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const x = f.x0 + ((i + 0.5) / N) * (f.x1 - f.x0), y = f.y0 + ((j + 0.5) / N) * (f.y1 - f.y0);
      if (x < 0 || x > W || y < 0 || y > H) continue;
      inside++; if (occ.some((o) => x > o.x0 && x < o.x1 && y > o.y0 && y < o.y1)) hid++;
    }
    return inside < (N * N) / 2 ? 0 : 1 - hid / (N * N);
  };
  const windows = per.map((m, k) => windowOf(m.face, per.flatMap((p, j) => (j === k ? [] : [p.body, p.claw, p.built].filter((o) => o.d < m.face.d)))));
  const own = per.map((m) => windowOf(m.face, m.claw.d < m.face.d ? [m.claw] : []));
  const gx0 = Math.min(...per.map((p) => p.all.x0)), gx1 = Math.max(...per.map((p) => p.all.x1)), gy0 = Math.min(...per.map((p) => p.all.y0)), gy1 = Math.max(...per.map((p) => p.all.y1));
  const front = per.reduce((b, p, k) => (p.body.d < per[b]!.body.d ? k : b), 0);
  const far = px([l.eye[0] + fw[0] * 1e5, l.eye[1], l.eye[2] + fw[2] * 1e5]);
  return {
    groupW: (Math.min(gx1, W) - Math.max(gx0, 0)) / W, groupH: (Math.min(gy1, H) - Math.max(gy0, 0)) / H,
    front, frontBody: (per[front]!.body.y1 - per[front]!.body.y0) / H, windows, own, faces: per.map((p) => p.face.y1 - p.face.y0), horizon: far[1] / H,
    worstWindow: Math.min(...windows, ...own), pxPerUnitAtClaw: per.map((p) => kk / p.wristZ),
  };
}

// Each member's place, facing, rise and great claw at a loop time, from the score itself.
const args = process.argv.slice(2), flag = (n: string) => { const i = args.indexOf(n); return i < 0 ? undefined : args[i + 1]; };
const turnTo = flag("--turn"), SCORED_TURN = 0.4, turnScale = turnTo === undefined ? 1 : Number(turnTo) / SCORED_TURN;
const SHOULDERS: readonly V3[] = members.map((m) => m.made.rig.shoulder(1) as unknown as V3);
const SPANS = members.map((m) => m.made.great.span);
const tv = variable("framing_t", "f32");
const poseOf = Array.from({ length: DANCE.members }, (_, k) => { const d = DANCE.member(k), c = d.claw(1, tv); return compileJs([d.place(tv), d.face(tv), d.rise(tv), c.weight, c.aim]); });
export const posesAt = (t: number): Pose[] => poseOf.map((f, k) => {
  const [p, h, rise, w, aim] = f({ vars: { framing_t: t }, inputs: {}, params: {} }) as [number[], number, number, number, number[]];
  const home = DANCE.member(k).home, s = SHOULDERS[k]!, span = SPANS[k]!;
  return {
    at: [home[0] + p[0]!, home[1] + p[1]!] as const, heading: h * turnScale, rise,
    // A claw given at least half to the score's aim is drawn there; else at its own rest (raised when the button holds).
    claw: w >= 0.5 ? { kind: "aimed", wrist: [s[0] + aim[0]! * span, s[1] + aim[1]! * span, s[2] + aim[2]! * span] as V3 } : { kind: "rest", raised: false },
  };
});
/** The unison keys the targets are judged at (held poses among them: 0 and 62 the button). */
export const KEYS = [0, 2, 12, 16, 17, 26, 27, 30, 38, 39, 40, 41, 42, 43, 62];
/** Every snap of the score's clicks, in counts, with the members that take it. */
const SNAPS = (DANCE.spec.score as readonly { at?: number; click?: number; who?: unknown }[]).flatMap((k) => (k.click === undefined ? [] : Array.from({ length: k.click }, (_, i) => ({ count: k.at! + i / 2, only: k.who !== undefined && typeof k.who === "object" && "only" in (k.who as object) ? (k.who as { only: number[] }).only : undefined }))));

const pc = (x: number) => (100 * x).toFixed(0);
const camOf = (c: ReturnType<typeof shotAt>["camera"]): Lens => { if (c.kind !== "perspective") throw new Error("lineup_framing: perspective cameras only"); return { eye: c.eye as unknown as V3, target: c.target as unknown as V3, fovY: c.fovY }; };

if (import.meta.main && flag("--search") === "square") {
  // The square's group cameras, searched with the formations as they are: every face clear (85%) at the unison keys
  // each shot holds, the group whole across the frame; the best has the largest front body.
  const shotsAt: Record<string, readonly number[]> = { V: [0, 2, 62], line: [12, 16, 17], lineClose: [26, 27, 30], diagonal: [38, 39, 41, 43] };
  const fronts: Record<string, { front: number; z: number }> = { V: { front: 0, z: 3 }, line: { front: 0, z: 0 }, lineClose: { front: 0, z: 0 }, diagonal: { front: 0, z: 9 } };
  for (const [name, counts] of Object.entries(shotsAt)) {
    let best: { score: number; say: string } = { score: -1, say: "none" };
    for (const h of [24, 28, 32, 36, 40, 44, 48]) for (const d of [26, 30, 34, 38, 42, 46, 50, 56]) for (const p of [18, 22, 26, 30, 34, 38]) for (const fov of [0.8, 0.9, 1.0]) {
      const l = raised(fronts[name]!.front, fronts[name]!.z, h, d, p, fov);
      const rs = counts.map((c) => frameGroup(LINE, posesAt((c + 0.1) * BEAT), l, 1080, 1080));
      // The line's samurai is half behind the centre's low claw on the motif's second count from any square camera (the
      // formation's, not the lens's): there the bar is no worse than today's square.
      if (rs.some((r) => Math.min(...r.windows) < (name.startsWith("line") ? 0.5 : 0.85) || r.groupW < 0.9 || r.horizon < 0 || r.horizon > 0.08)) continue;
      const score = Math.min(...rs.map((r) => Math.min(r.frontBody, r.groupH / 3)));
      if (score > best.score) best = { score, say: `eye ${h}, distance ${d}, pitch ${p}, fovY ${fov}: front body ${rs.map((r) => pc(r.frontBody)).join("/")}%, group h ${rs.map((r) => pc(r.groupH)).join("/")}%, worst window ${pc(Math.min(...rs.flatMap((r) => r.windows)))}%, horizon ${rs.map((r) => pc(r.horizon)).join("/")}%` };
    }
    const now = GROUP.square[name as keyof typeof GROUP.square], rs = counts.map((c) => frameGroup(LINE, posesAt((c + 0.1) * BEAT), now, 1080, 1080));
    console.log(`square ${name.padEnd(9)} now: front body ${rs.map((r) => pc(r.frontBody)).join("/")}%, group h ${rs.map((r) => pc(r.groupH)).join("/")}%, worst window ${pc(Math.min(...rs.flatMap((r) => r.windows)))}%\n          best: ${best.say}`);
  }
} else if (import.meta.main) {
  console.log(`left to right: ${LINE.join(", ")}${turnTo === undefined ? "" : `; the turn at ${turnTo} rad`}`);
  for (const f of Object.values(formats(LINE))) {
    console.log(`${f.name} ${f.width}x${f.height}  (group box w x h; front member's body; face windows from the others | from its own claw; horizon from the top)`);
    const times = [...new Set([...f.cuts.map((c) => c.at + 0.05 * BEAT), ...KEYS.map((c) => (c + 0.1) * BEAT)])].sort((a, b) => a - b);
    for (const t of times) {
      const s = shotAt(f, t), c = t / BEAT, key = KEYS.some((k) => Math.abs(k + 0.1 - c) < 1e-6);
      const r = frameGroup(s.shot.name.startsWith("solo") || s.shot.name === "face" ? LINE : LINE, posesAt(t), camOf(s.camera), f.width, f.height);
      if (s.shot.name.startsWith("solo") || s.shot.name === "face") { console.log(`  count ${c.toFixed(1).padStart(4)} ${s.shot.name.padEnd(7)} (a single)`); continue; }
      console.log(`  count ${c.toFixed(1).padStart(4)}${key ? "*" : " "}${s.shot.name.padEnd(7)} group ${pc(r.groupW)} x ${pc(r.groupH)}%  front ${LINE[r.front]} body ${pc(r.frontBody)}%  windows ${r.windows.map(pc).join("/")} | own ${r.own.map(pc).join("/")}%  faces ${r.faces.map((x) => x.toFixed(0)).join("/")} px  horizon ${pc(r.horizon)}%`);
    }
    // The clicks: a fingertip's travel on screen from wide open to shut, each member that takes the snap, in the shot in force.
    const rows = SNAPS.map((s) => {
      const t = s.count * BEAT, sh = shotAt(f, t), r = frameGroup(LINE, posesAt(t), camOf(sh.camera), f.width, f.height);
      const px = LINE.map((v, k) => (s.only !== undefined && !s.only.includes(k) ? NaN : CRABS[v.split("+")[0]!]!.tip * r.pxPerUnitAtClaw[k]!));
      return `${String(s.count).padStart(5)} ${sh.shot.name.padEnd(7)} ${px.map((x) => (Number.isNaN(x) ? "  -" : x.toFixed(0).padStart(3))).join(" ")}`;
    });
    console.log(`  clicks (count, shot, fingertip travel px left to right):\n  ${rows.join("\n  ")}`);
  }
}
