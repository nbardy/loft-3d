// Two spar buoys dance a duet of sixteen counts: a bob in unison, a lean in canon, a spin, a drift together, a lean in
// mirror, a bell solo each, and a rise struck and held. Each solo is an emote: three clangs, the buoy rocking onto
// each. Shows: `routine` (one score of key poses on counts), `emote` (an action with no hit), and `inSync`, the
// instrument that measures the members' drawn readouts against each other. Ground: a calm sea (here it is the subject's
// own water, so nothing to change when floors arrive).
//
// Theory, before running. A buoy has a level (it bobs), a lean (it rolls), a facing (its spiral stripe shows a spin)
// and a place: four of the routine's channels, so the score should fit. Predicted fights: (1) the routine's mirror is
// about a centre *member*, which takes nothing; in a duet one buoy would be that centre and stand still through every
// mirror. (2) `inSync` reads a great claw's wrist and its fingers' clicks of every member: a buoy has neither.
// `emote` should fit: accents and a side that alternates are not about claws.
//
// Scored. `emote` fit as it is. `routine` fought on both counts predicted, and the first was worse than predicted: with
// `centre: 0` the check passed, because a mirror leaves its centre out of the measurement, so the instrument passed a
// duet in which one buoy stood still through every mirror. Opened: a centre may be halfway between two members (0.5),
// and `Readouts.claw` and `.click` are optional. Not opened: the score's channels are still the crab's body (lean,
// level, face, place, two claws' aims, clicks); a buoy's bell or a crane's jib cannot be a key. The honest cut is keys
// over named channels the routine is given, with lean/level/face as the default set; that is a rewrite of `Routine`,
// left described rather than half done.
import {
  add, cos, emote, every, mix, mul, routine, scene, sea, sin, smoothstep, strand, sub, time, toon, vec3, type F, type Frame, type P3,
} from "../../src/index.ts";
import { rotate } from "../../src/map/chart.ts";
import { rotateAbout } from "../../src/map/transport.ts";

const BEAT = 0.5, LOOP = 16 * BEAT;
const duet = routine({
  beat: BEAT, length: 16,
  // The fight, (1): written first as `centre: 0`; buoy 0 was then the mirror's centre and its lean did not move.
  centre: 0.5,
  places: { apart: [[-1.7, 0], [1.7, 0]], close: [[-1.0, 0.4], [1.0, 0.4]] },
  manner: { arrive: 0.16, snap: 3 },
  size: { bounce: 0.06, lean: 0.12, roll: 0.24, level: 0.35 },
  score: [
    { at: 0, go: "apart", over: 2 },
    { at: 1, level: 1 }, { at: 2, level: -1 }, { at: 3, level: 0 },                             // bob, in unison
    { at: 4, who: { canon: 0.5 }, lean: 1 }, { at: 5, who: { canon: 0.5 }, lean: -1 }, { at: 6, who: { canon: 0.5 }, lean: 0 },
    { at: 7, face: 1.6, over: 1 },                                                              // a spin
    { at: 8, go: "close", over: 2 }, { at: 9, face: 0, over: 1 },                               // drift together, unwind
    { at: 10, who: "mirror", lean: 1 }, { at: 11, who: "mirror", lean: -1 }, { at: 12, who: "mirror", lean: 0 },
    { solo: 0, on: [13] }, { solo: 1, on: [14] },                                               // a bell each
    { at: 15, hit: 0.75, level: 1 },                                                            // struck and held
  ],
});

// ---- one buoy: the dance, plus its bell solo (an emote armed on its own count each loop) ---------------------------------
type Buoy = { readonly things: readonly ReturnType<typeof strand>[]; readonly lift: F; readonly roll: F; readonly spin: F };
function buoy(m: 0 | 1): Buoy {
  const d = duet.member(m), soloAt = d.solo[0]!;
  const bell = emote({ name: `bell${m}`, arm: every(LOOP, soloAt - 0.25), accents: [0.25, 0.5, 0.75], lead: 0.1, hold: 0, fall: 0.14, snap: 3, offbeat: 0.06, shuffle: 0.08, settle: 0.2 });
  const b = bell.beats(time), solo = d.soloing();
  const lift = add(d.rise(), mul(mul(b.wave, solo), 0.1)), roll = add(mul(d.lean(), 0.24), mul(mul(b.step, solo), 0.3)), spin = d.face();
  const home = d.home, at = d.place();
  const o = vec3(add(home[0], at.x), lift, add(home[1], at.y));
  // Spin about up, then roll about the buoy's own forward (toward the camera, +z): a lean reads as a tilt on screen.
  const x = rotateAbout([1, 0, 0], [0, 1, 0], spin), z = rotateAbout([0, 0, 1], [0, 1, 0], spin);
  const f: Frame = { o, x: rotateAbout(x, z, roll), y: rotateAbout([0, 1, 0], z, roll), z };
  const p = (q: P3): P3 => add(f.o, rotate(f, q));
  const red = m === 0 ? vec3(0.85, 0.15, 0.1) : vec3(0.1, 0.45, 0.25);
  const spar = strand({
    name: `spar${m}`, spine: (s) => p(vec3(0, mix(-0.9, 2.2, s), 0)), stations: 12, up: f.x,
    girth: (s) => mix(0.12, 0.42, smoothstep(0.35, 0.2, sub(s, 0.05))), tips: ["round", "open"],
    paint: (s, v) => mix(red, vec3(0.95, 0.93, 0.88), smoothstep(0.45, 0.55, sin(mul(add(mul(s, 7), v), Math.PI * 2)))), detail: { along: 40, around: 18 },
  });
  const hammer = mul(sin(mul(b.turn, Math.PI)), mul(solo, 0.6));
  const bellBody = strand({ name: `bell${m}`, spine: (s) => p(vec3(0, mix(2.2, 2.6, s), 0)), stations: 4, girth: (s) => mix(0.16, 0.06, s), tips: ["open", "round"], paint: [0.85, 0.7, 0.3], detail: { along: 8, around: 14 } });
  const clapper = strand({ name: `clapper${m}`, spine: (s) => p(vec3(mul(sin(hammer), mul(s, 0.3)), sub(2.55, mul(cos(hammer), mul(s, 0.3))), 0)), stations: 4, girth: 0.03, paint: [0.2, 0.2, 0.2], detail: { along: 4, around: 6 } });
  return { things: [spar, bellBody, clapper], lift, roll, spin };
}
const pair = [buoy(0), buoy(1)];

export default scene({
  ground: sea({ swell: [] }), things: pair.flatMap((b) => b.things),
  style: toon({ bands: 3, outline: 0.03 }), sun: [-0.4, 0.75, 0.55], period: LOOP,
  cameras: { game: { kind: "perspective", eye: [0, 4.5, 9.5], target: [0, 1.0, 0], fovY: 0.6 } },
});

// The fight, (2): `inSync` read `claw` and `click` of every member, so a buoy said `claw: lift(0), click: lift(0)`.
// Both are now optional (and refused by name if the score sets them).
export const checks = [
  duet.inSync((m) => ({ lift: pair[m]!.lift, lean: pair[m]!.roll, face: pair[m]!.spin }), { arrival: 0.02, size: 0.05 }),
];
