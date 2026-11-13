// Five crabs in one scene, dancing as one group, as one loop (docs/lineup.md, "A drilled group"). Each is a variant of
// the Reefback Titan's design (examples/bosses/reefback_titan.ts) built in its own namespace, on one sea that carries
// every ring wave. One clock in counts: 120 a minute, 4/4, sixteen bars, 32 s. One score (`DANCE`) for the group: key
// poses on counts, in the group's manner, unison unless a key says canon or mirror; the slam and the throw are the
// group's point moves, in unison, in a line; each crab's own manner (`temper`) is kept for its solo.
//
// Staged for a video: shots in examples/bosses/lineup_shots.ts, which the deliverables read (`bun tools/lineup_deliver.ts`).
// The scene's cameras are those shots' first frames.

import type { Camera } from "../../src/artefact.ts";
import { atan2, div, lineup, movable, parseVariantAsk, routine, scene, sub, WOODBLOCK_PALETTE } from "../../src/index.ts";
import type { Key } from "../../src/spacetime/routine.ts";
import { design, LOOK, styleFor, SUN, WATER } from "./reefback_titan.ts";
import { AUDIENCE, BAR, BEAT, beat, formats, PERIOD, PLACES, shotAt } from "./lineup_shots.ts";
import { S, type Numbers } from "./titan/numbers.ts";
import type { Staging } from "./titan/rig.ts";

export { BAR, BARS, BEAT, BPM, PERIOD } from "./lineup_shots.ts";

// ---- the group, left to right as the camera sees it; the islander (the hermit, its spiral shell) is the centre ----
export const LINE = ["fiddler", "mask", "islander", "bruiser", "stilt"] as const;

// ---- the score ----
/** The attacks' counts, stated once (the song reads exactly these): the slam lands, the grips close, every boat is let go, the boats come down behind the group. */
export const ATTACK_COUNTS = { slam: 12, grip: 22, release: 24, lands: 30 } as const;
/** Where a claw's wrist goes from its shoulder (forward, up, out from its own side), in arm spans: straight up, out to the side, low and out (beside the face, not across it). */
const UP = [0.2, 0.76, 0.12] as const, OUT = [0.2, 0.28, 0.76] as const, LOW = [0.45, 0.05, 0.6] as const;
/** The islander's solo: the claw high and out to its side, clear of its face and shell. */
const HIGH_OUT = [0.1, 0.55, 0.85] as const;
/** The centre's great claw in the button: up and a little out, clear of its face and of the samurai's. */
const CROWN = [0.15, 0.72, 0.3] as const;
/** The chorus's quarter turn (docs/lineup.md, "Deeper"): radians to the crab's right. */
const TURN = 0.4;

/** The chorus motif, two counts: punch up and rise on `a`; drop low with the claw low and out, a lean to `side`, and a double click on `a + 1`. */
const motif = (a: number, side: 1 | -1): Key[] => [
  { at: a, claw: UP, level: 1, lean: 0 },
  { at: a + 1, claw: LOW, level: -0.5, lean: side, click: 2 },
];

/**
 * The dance, in counts (a count is a beat; 64 in the loop). Each key lands on its count and holds until the next key
 * of the same channel; everyone together unless `who` says otherwise. The slam (claws down on 12) and the throw
 * (grips close on 22, every boat let go on 24, down behind the group on 30) are the attacks' own, on the same counts for
 * every member (`ATTACK_COUNTS`, `onTheBeat`). Clicks are the crabs' own percussion: off-beats in the verse, a run into
 * the slam, doubles in the chorus motif, each soloist's figure, a run into the button.
 */
export const DANCE = routine({
  beat: BEAT, length: 64, centre: 2, places: PLACES,
  manner: { arrive: 0.15, snap: 4 },
  // Pushed 1.6 to 1.8 times from the first strip's (0.22, 0.4, 0.08, 0.55), which did not read from the group's distance
  // (a lean of 0.4 was 8 px); the legs keep inside their reach (planted feet drawn in: the worst stretch was 0.80).
  size: { bounce: 0.35, lean: 0.8, roll: 0.14, level: 1.0 },
  score: [
    // 1 to 8: out of the button, a lean each way, sidestep into the line; a click on every off-beat.
    { at: 1, level: 0, claw: "rest", small: "rest" },
    { at: 2, lean: 1 }, { at: 3, lean: -1 }, { at: 4, lean: 0 },
    { at: 8, go: "line", over: 4 },
    ...[1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5].map((at) => ({ at, click: 1 })),
    // 8 to 13: crouch to load the slam (9 to 12 is the slam's own wind-up and strike: a run of clicks into it); up again.
    { at: 8, level: -0.6 }, { at: 10, click: 4 }, { at: 13, level: 0 },
    // 16 to 19: the chorus motif stated and repeated to the other side, in the line (the slam's claw is its own until
    // about 15.6: a motif from 14 measured the claws 23% apart).
    ...motif(16, 1), ...motif(18, -1),
    // 19.6 to 25: the throw (the attack has the body until about 24.9). 26 to 29: the motif again as the boats fly; 30,
    // as they land behind the group, varied: its halves at once on two levels (the outer pair and the centre up, the
    // other two low). 31: everyone drops; 32 up.
    ...motif(26, 1), ...motif(28, -1),
    { at: 30, who: { only: [0, 2, 4] }, claw: UP, level: 1, lean: 0 },
    { at: 30, who: { only: [1, 3] }, claw: LOW, level: -1, lean: 0, click: 2 },
    { at: 31, level: -1, claw: "rest" }, { at: 32, level: 0 },
    // 34 to 38: sidestep into the diagonal (the fiddler in front: the centre changes). 38 to 41: the motif, then turned.
    { at: 38, go: "diagonal", over: 4 },
    ...motif(38, 1),
    { at: 40, face: TURN, over: 1 }, ...motif(40, -1),
    // 42, 43: turn back and slide left together, both claws out; slide back and drop: a travel in step.
    { at: 42, face: 0, over: 1, go: "diagonalLeft" }, { at: 42, claw: OUT, small: OUT, level: 0, lean: 0, click: 2 },
    { at: 43, go: "diagonal", over: 1 }, { at: 43, level: -1, claw: "rest", small: "rest" },
    // 44 to 46: a canon down the line, half a count apart: up and rise. 47: a mirror: lean out, both claws out.
    { at: 44, who: { canon: 0.5 }, claw: UP, level: 1 },
    { at: 47, who: "mirror", lean: -1, claw: OUT, small: OUT, level: 0 },
    // 48 to 58: the solos, two counts each: each soloist steps out to the front for its part (and back as the next one
    // steps out), while the rest hold a low frame and keep the groove. Each plays its own click figure.
    { at: 48, lean: 0, level: -0.3, claw: LOW, small: "rest" },
    { at: 48, go: "solo0", over: 1 }, { at: 50, go: "solo1", over: 1 }, { at: 52, go: "solo2", over: 1 }, { at: 54, go: "solo3", over: 1 }, { at: 56, go: "solo4", over: 1 },
    { solo: 0, on: [48, 49] }, { at: 48.5, who: { only: [0] }, click: 3 },
    { solo: 1, on: [50, 51] }, { at: 50, who: { only: [1] }, click: 1 }, { at: 51, who: { only: [1] }, click: 1 },
    // The islander's solo is scored, not its own manner (its show-off swing put the claw's arm across its face in the low
    // front single): the claw high and out to its side, turned a little to its right so the claw's arm goes back past
    // its face rather than across it (turned left, the arm still crossed the lower face), a roll of clicks.
    { at: 52, who: { only: [2] }, face: 0.4, over: 1 }, { at: 52, who: { only: [2] }, claw: HIGH_OUT, level: 0.6, lean: -0.6, click: 3 },
    { at: 54, who: { only: [2] }, face: 0, over: 1, lean: 0 },
    { solo: 3, on: [54, 55] }, { at: 54, who: { only: [3] }, click: 2 }, { at: 55.5, who: { only: [3] }, click: 1 },
    { solo: 4, on: [56, 57] }, { at: 56, who: { only: [4] }, click: 4 },
    // 58 to 62: sidestep back into the V, clicks on the off-beats and a run into the button on 62, struck and held dead
    // still across the loop's seam (no click while it holds).
    { at: 58, claw: "rest", level: 0 },
    { at: 58.5, click: 1 }, { at: 59.5, click: 1 }, { at: 60, click: 4 },
    { at: 62, go: "V", over: 4 },
    // The button (the thumbnail): the centre's great claw held high and out to its side, the others straight up, so the
    // claws make a crown over the V and the centre's face is not behind its own hand (with every claw up, it was).
    { at: 62, hit: 2.5, small: OUT, level: 1 },
    { at: 62, who: { only: [0, 1, 3, 4] }, hit: 2.5, claw: UP }, { at: 62, who: { only: [2] }, hit: 2.5, claw: CROWN },
  ],
});

/** The group's manner: every member's `temper` in the lineup, so the attacks' rear and the shell's lag are in unison too. A crab's own is kept for its solo. */
const GROUP: Numbers["temper"] = { snap: 4, arrive: 0.15, hold: 0, leave: 0.25, jitter: 0, lag: 0.2, rise: 0.5, reach: 1, together: 0, lift: 1 };

/**
 * Where crab k's thrown boat lands, in its axes: behind it, over its head and back, beyond the group (a throw must carry
 * 25 from where the boat was taken: `throwLands`). A host parks the landed boat out of every frame from the cut on 33 to
 * the cut on 16 (`hostInputs`, lineup_shots.ts).
 */
export const FAN = [[-16, 3], [-16, 1.5], [-16, 0], [-20, -1.5], [-16, -3]] as const;
/**
 * How high each back stands above the water while its boat flies over it (what a throw over the head must clear:
 * `throw.over`): the tallest building of tools/lineup_framing.ts's boxes at rest, plus 0.5 for the boxes' own error. The
 * body is lower than at rest then (the score's level is -0.5 from count 19, and the groove only goes down).
 */
const TOPS: Readonly<Record<string, number>> = { fiddler: 13.0, mask: 11.0, islander: 11.5, bruiser: 10.5, stilt: 16.0 };
const topOf = (variant: string): number => { const t = TOPS[variant.split("+")[0]!]; if (t === undefined) throw new Error(`crab lineup: no back height for "${variant}" (${Object.keys(TOPS).join(", ")})`); return t; };
const c = ATTACK_COUNTS;
/** What the scene changes of a crab's numbers: its attacks' seconds on counts, its props in its lane, the group's manner. The crab alone keeps its own. */
export const onTheBeat = (k: number, variant: string = LINE[k]!) => ({
  crushPeriod: PERIOD, period: BAR, temper: GROUP,
  // Three counts from the claw's first movement to its landing on the slam; warned four counts ahead, so its cycle turns on 8.
  crushSeconds: { windup: 3 * BEAT - 0.3, strike: 0.3 }, crushWarn: 4 * BEAT, crushFirst: beat(c.slam),
  // The disc in the crab's lane: in front, a little to its right (the camera's left).
  crushCentre: [10, 1.5] as const,
  // The owner: "make the boat grab a little faster ... toss it over the head, and don't hang on to it so long". The claw
  // rises into posture 0.35 s and reaches 0.65 + 0.22 (two counts and a half from its first movement, at 19.6, to the
  // grip); held two counts with one squeeze; let go on the release count. Warned from the cut on 16 (the boat home).
  grabClose: beat(c.grip), grabWarn: beat(c.grip - 16),
  grabSeconds: { windup: 0.35, reach: 0.65, close: 0.22, hold: beat(c.release - c.grip), release: 1.0 }, grabPulses: 1,
  // The boat taken nearly straight ahead of the left shoulder, in the crab's lane.
  grabBearing: -0.26,
  // Thrown up and back over its own head and back, landing behind the group: the stroke takes half a count, the flight
  // from the release to the landing count. In three seconds a boat clears a back 12 to 17 high only under a lofted
  // gravity (docs/lineup.md, "Deeper"): 20 for the flight alone (the ring wave keeps the world's 5).
  throw: { ...S.throw, back: 1.5, side: 0, up: variant.startsWith("stilt") ? 3.0 : S.throw.up, stroke: 0.3, follow: 0.25, flight: beat(c.lands - c.release), land: FAN[k]!, turns: 1, gravity: 20, over: topOf(variant) },
  boatTwo: { ...S.boatTwo, keep: PERIOD },
});

/** A crab's own manner (its variant's `temper`), for its solo. */
const ownManner = (variant: string): Numbers["temper"] => design.resolve(parseVariantAsk(variant)).numbers.temper;
/** How member k (its variant) stands in the lineup: at its place in the score, dancing its part. */
export const lineupStaging = (k: number, variant: string): Staging => ({
  at: DANCE.member(k).home, heading: 0, walkAhead: 0,
  // Every boat goes home on a cut (16, the seam): no sinking, no sailing in.
  show: { kind: "cut" },
  taunt: { kind: "routine", dancer: DANCE.member(k), size: DANCE.spec.size, beat: BEAT, own: ownManner(variant) },
  audience: { kind: "at", eye: AUDIENCE },
});

/**
 * The sunset (docs/lineup.md, "The sky"): washes from orange-gold at the horizon through vermilion and violet to
 * indigo, a red sun half set behind the group, three cream cloud bands, and the far sea's strip at the horizon printed
 * orange-gold (the sky's `below`). Heights are the view direction's y.
 */
const SUNSET = {
  horizon: [0.97, 0.74, 0.36],
  washes: [{ ink: [0.95, 0.52, 0.22], from: 0, to: 0.03 }, { ink: [0.82, 0.28, 0.2], from: 0.03, to: 0.07 }, { ink: [0.42, 0.24, 0.42], from: 0.07, to: 0.12 }, { ink: [0.13, 0.15, 0.33], from: 0.12, to: 0.2 }],
  sun: { kind: "disc", toward: [-1, 0.012, 0], radius: 0.075, ink: [0.84, 0.2, 0.13] },
  clouds: { kind: "bands", ink: [0.93, 0.87, 0.74], key: WOODBLOCK_PALETTE.black, line: 0.0012, bands: [
    // Thin and short: the first strip's (0.018 to 0.03 thick, 0.26 to 0.37 long) were slabs across the frame.
    { at: 0.112, thick: 0.013, from: 2.88, to: 3.1, lumps: 4 }, { at: 0.145, thick: 0.011, from: 3.2, to: 3.38, lumps: 3 }, { at: 0.085, thick: 0.009, from: 3.3, to: 3.45, lumps: 3 },
  ] },
  below: [0.93, 0.6, 0.3],
} as const;

/** The looks the deliverables ask for by name; an unknown one is refused (not drawn as the default). */
export const LOOKS = ["default", "hatched", "cel", "engraving", "engravingSunset"] as const;
export type Look = (typeof LOOKS)[number];
function lookOf(name: string): Look {
  const l = LOOKS.find((x) => x === name);
  if (l === undefined) throw new Error(`crab lineup: no look "${name}"; the looks are [${LOOKS.join(", ")}]`);
  return l;
}
function styleOf(look: Look) {
  switch (look) {
    case "default": return styleFor(S, WATER.base, SUNSET);
    case "hatched": return styleFor(S, WATER.base, SUNSET, LOOK.hatched);
    case "cel": return styleFor(S, WATER.base, SUNSET, LOOK.cel);
    case "engraving": return styleFor(S, WATER.base, SUNSET, LOOK.engraving);
    case "engravingSunset": return styleFor(S, WATER.base, SUNSET, LOOK.engravingSunset);
  }
}
/** The sun of a look: the sunset recipe is lit from low behind the group (docs/lighting.md); the others by the crab's own sun. */
function sunOf(look: Look) {
  switch (look) {
    case "default": case "hatched": case "cel": case "engraving": return SUN;
    case "engravingSunset": return movable([-0.95, 0.3, 0.05]);
  }
}

/** The scene's cameras: each shot's first frame, by format and shot (`wide_open`, `square_solo2`, ...); `lineup` is the opening framing. */
const camerasOf = (line: readonly string[]): Readonly<Record<string, Camera>> => {
  const F = formats(line);
  return Object.fromEntries([["lineup", shotAt(F.wide, 0).camera], ...Object.values(F).flatMap((f) => f.cuts.map((c) => [`${f.name}_${c.shot.name}`, shotAt(f, c.at).camera] as const))]);
};

/** The group, left to right (as many variants as `DANCE` has members), in a look. */
export function lineupScene(o: { readonly line: readonly string[]; readonly look: string }) {
  if (o.line.length !== DANCE.members) throw new Error(`crab lineup: the dance has ${DANCE.members} members, left to right; got ${o.line.length} variants`);
  const line = lineup({
    members: o.line.map((variant, k) => ({ name: `crab${k}`, design, variant, numbers: onTheBeat(k, variant), how: lineupStaging(k, variant) })),
    // The swells' periods are 16 s and 8 s: whole turns in the loop.
    water: { swell: [{ direction: [1, 0.3], length: 13, height: 0.2, speed: 13 / 16 }, { direction: [-0.3, 1], length: 6, height: 0.07, speed: 6 / 8, phase: 1.3 }], foam: 0.85 },
    loop: { kind: "every", seconds: PERIOD },
  });
  // The instrument (docs/lineup.md, "The instrument"): from each member's own rig, when each key arrives and how far it
  // goes, member against member: arrivals within a frame at 60 a second, sizes within 5% of the channel's largest.
  const sync = DANCE.inSync((k) => {
    const { rig: r, great } = line.members[k]!.made, shoulder = r.local(r.shoulder(1));
    return { lift: sub(r.body.o.y, r.n.ride), lean: r.body.z.y, face: atan2(r.body.x.z, r.body.x.x), claw: div(sub(great.wrist.y, shoulder.y), great.span), click: great.open };
  }, { arrival: 1 / 60, size: 0.05 });
  const cameras = camerasOf(o.line);
  return { scene: scene({ ground: line.sea, things: line.things, style: styleOf(lookOf(o.look)), sun: sunOf(lookOf(o.look)), cameras, period: PERIOD }), checks: [...line.checks, sync], sync, members: line.members };
}

const built = lineupScene({ line: LINE, look: "default" });
export default built.scene;
export const checks = built.checks;
/** Each crab's product, in line order: what a game reads of it (`holds`, `waves`, `handoff`, `rig.dance`). */
export const members = built.members;
/** The sync instrument (also the last of `checks`): `sync.table(probe)` gives every key's arrivals and sizes. */
export const sync = built.sync;
