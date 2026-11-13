// An attack that holds (docs/attacks_that_hold.md): `gripReaches` is the check scenes rely on to say a drawn gripper
// really takes the thing its hold owns.
import { expect, test } from "bun:test";
import {
  add, attack, compileJs, emote, variable, gripReaches, hit, hold, hosted, input, lift, mul, pose, Probe, releasesAt, scene, sea, STAND_IN, strand, throwLands,
  thrown, tolerance, toon, vec2, vec3, type F, type Placer,
} from "../src/index.ts";
import { compileScene } from "../src/compile/index.ts";

const R = 0.12; // the fingers' radius

/** Two straight vertical fingers either side of the attack's grip, their axes `gap / 2 + reach` from its middle, shifted `shift` across. */
function claw(reach: number, shift: number) {
  const grab = attack({
    name: "grab", arm: 1, warn: 1.2, target: { kind: "disc", centre: vec2(0, 0), radius: lift<"f32">(0.5) },
    motion: { kind: "grip", hit: hit.disc({ centre: [0, 0], radius: 1.5 }), close: 0.2, release: 0.5 },
    effect: hold({ seconds: 1, at: [0, 0.5, 0], radius: 0.5, carry: { kind: "arc", to: [1, 0.5, 0], lift: 1 }, squeeze: 0.3, pulses: 1 }),
    timing: { windup: 0.5, strike: 0.8 },
  });
  const g = grab.grip([0, 3, 0]);
  const finger = (side: number) => strand({
    name: side < 0 ? "fingerA" : "fingerB", stations: 4, girth: R, paint: [0.8, 0.2, 0.1],
    spine: (m: F) => add(g.palm, vec3(add(mul(add(mul(g.gap, 0.5), reach), side), shift), add(mul(m, -2), 1), 0)),
  });
  const fingers = [finger(-1), finger(1)] as const;
  const s = scene({ ground: sea({ swell: [] }), things: [...fingers], style: toon({}), sun: [0.3, 0.8, 0.5], cameras: { c: { kind: "perspective", eye: [0, 2, 9], target: [0, 1, 0], fovY: 0.6 } } });
  return gripReaches(grab, fingers, { middle: tolerance.share(0.1), gap: tolerance.share(0.1) }).run(new Probe(compileScene(s), {}));
}

// Catches: a check that measures the fingers' axes (or tips) instead of their surfaces. The crab's old scene check did,
// and passed a claw whose fingers sank 0.085 into the hull on each side. Axes a width apart must fail; surfaces a width
// apart (axes a radius further out each side) must pass, through the squeeze; a grip off the thing's middle must fail.
test("gripReaches passes surfaces a width apart and fails axes a width apart or a grip off the middle", () => {
  const good = claw(R, 0), axes = claw(0, 0), off = claw(R, 0.3);
  expect(good.pass).toBe(true);
  expect(good.value).toBeLessThan(0.1);
  expect(axes.pass).toBe(false);
  expect(axes.measured).toContain("0.76 apart"); // the 1.0 width less two radii, at closing
  expect(off.pass).toBe(false);
});

/** A remote hold that ends in a throw, its thing placed after the release by `placer`; the two throw checks' verdicts. */
function throwOf(placer: Placer) {
  const toss = attack({
    name: "toss", arm: 1, warn: 1, target: { kind: "disc", centre: vec2(0, 0), radius: lift<"f32">(0.5) },
    motion: { kind: "remote", hit: hit.disc({ centre: [0, 0], radius: 1.5 }) },
    effect: hold({
      seconds: 1.5, at: [0, 0.5, 0], radius: 0.5, carry: { kind: "arc", to: [-1, 2, 0.5], lift: 1 },
      end: thrown({ land: [9, 0.5, -3], flight: 2, gravity: 5, stroke: 0.4, follow: 0.2, drag: 0.3, heave: { hz: 1, damping: 0.4 }, placer }),
    }),
  });
  const mark = strand({ name: "mark", stations: 4, girth: 0.2, paint: [0.8, 0.2, 0.1], spine: (m: F) => add(toss.thing(), vec3(0, m, 0)) });
  const s = scene({ ground: sea({ swell: [] }), things: [mark], style: toon({}), sun: [0.3, 0.8, 0.5], cameras: { c: { kind: "perspective", eye: [0, 2, 9], target: [0, 1, 0], fovY: 0.6 } } });
  const probe = new Probe(compileScene(s), {});
  const tol = { speed: tolerance.share(0.02), place: tolerance.share(0.02) };
  return { hand: releasesAt(toss, tol).run(probe), flown: throwLands(toss, { least: 8, ...tol }).run(probe) };
}

// Catches: a throw check that compares the attack's stated numbers with each other instead of measuring where the thing
// is. The stand-in's flight must pass both checks. A thing its host leaves lying at one pose after the release is still
// handed off correctly (the grip brought it to the release point at the release velocity), and must fail `throwLands`:
// it does not fly. It also catches a stroke that no longer ends at the release velocity (both verdicts fail).
test("a throw's hand-off holds whoever places the thing; only a flight that starts as released passes throwLands", () => {
  const ours = throwOf(STAND_IN), theirs = throwOf(hosted(pose({ at: input("hold.test.pose", "vec3", [3, 0.5, 3]), heading: 0, pitch: 0, heel: 0 })));
  expect(ours.hand.pass).toBe(true);
  expect(ours.flown.pass).toBe(true);
  expect(ours.flown.value).toBeGreaterThan(9); // (9, -3) from (0, 0): 9.49 along the water
  expect(theirs.hand.pass).toBe(true);
  expect(theirs.flown.pass).toBe(false);
});

// Catches: an input interned by its name alone. A design's variants are several scenes built in one process, and each
// may give `boat1.at` its own default; by name alone the second variant silently read the first's default.
test("one input name may carry a different default in a different scene", () => {
  const a = input("hold.test.at", "f32", [1]), b = input("hold.test.at", "f32", [2]);
  expect(compileJs([a])({ vars: {}, inputs: {}, params: {} })[0]).toBe(1);
  expect(compileJs([b])({ vars: {}, inputs: {}, params: {} })[0]).toBe(2);
  expect(compileJs([b])({ vars: {}, inputs: { "hold.test.at": 5 }, params: {} })[0]).toBe(5);
});

// Catches: a manner that moves an accent off its beat. An emote's move must be at its top exactly on each accent however
// early it starts, however long it is held and however sharply it eases (the crab lineup's four temperaments play one
// taunt on one set of beats), and the emote must be over (`on` 0) before it arms and after its last move has left.
test("an emote's move is at its top on every accent, in any manner", () => {
  const t = variable("emote_test_t", "f32"), accents = [1, 2, 2.5, 4];
  for (const manner of [{ lead: 0.25, hold: 0, fall: 0.25, snap: 2 }, { lead: 0.7, hold: 0.15, fall: 0.7, snap: 1.5 }, { lead: 0.18, hold: 0.6, fall: 0.3, snap: 8 }]) {
    const b = emote({ name: "taunt", arm: 10, accents, ...manner, offbeat: 0.25, shuffle: 0.22, settle: 0.4 }).beats(t);
    const run = compileJs([b.wave, b.on]);
    const at = (x: number) => run({ vars: { emote_test_t: x }, inputs: {}, params: {} }) as number[];
    for (const a of accents) expect(at(10 + a)[0]).toBeCloseTo(1, 5);
    expect(at(9)[1]).toBe(0);
    expect(at(10 + 4 + manner.hold + manner.fall + 0.41)[1]).toBeCloseTo(0, 5);
    expect(at(10 + 1 - manner.lead - 0.01)[0]).toBeCloseTo(0, 2);
  }
});
