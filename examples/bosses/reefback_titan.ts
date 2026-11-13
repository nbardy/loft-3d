// The Reefback Titan (game design notes 2026-11-01, section 6.2): a hermit crab the size of an island, wearing a dead
// atoll for its shell with a ruined fort on the crown. Woodblock print (docs/art_direction/DIRECTION.md): a brick-red
// crab, a moss-green atoll with stone cliffs, a cream ruin; indigo sea, cream foam; one small blue-sailed sloop for
// scale.
//
// This file is the crab's design (docs/variants.md): its slots and their options, its named variants, its cameras, and
// how a choice is assembled into a scene with its checks. The parts are under titan/:
// - numbers.ts: every number an art director changes (`S`);
// - rig.ts: the walk in place, Claw Crush (a space-time `attack` on a disc ahead-right), the Grab (a `grip` attack whose
//   effect is a `hold`: docs/attacks_that_hold.md), the body and shell frames, the ship, the warnings, the crash;
// - slots.ts: what an option of each slot receives and returns;
// - carapace/, legs/, claws/, face/, back/: one file per option. `base` is the crab as first drawn.
//
// - boats/: who places the two boats when the crab does not hold them: `base`, Loft's stand-ins (the scene plays on its
//   own), or `host` (a game passes each boat's pose; `--variant boats=host`).
//
// What a game sets and reads (docs/throw_and_shove.md, "The contract"). Sets: the host inputs `grab.arm`, `crush.arm`,
// `crush.centre`, `boat1.at`, `boat1.heading`, `boat1.beam`, `throw.land`, `boat2.at`, `boat2.heading` (and with
// `boats=host` each boat's `pose`). Reads: `strikes` (Claw Crush on the crusher's palm), `holds.grab` (`held()`,
// `thing()`, `squeezed()`, and of its throw `flight()` and `toss()`), `waves.crush` (`arrives(place)`, `pushed(place)`,
// `wave()`) and `handoff` (the socket while held, the release, the wave as a field), exported below for the base
// variant and returned by every variant's build.

import { BASE_ASK, design as makeDesign } from "../../src/design.ts";
import type { Camera } from "../../src/artefact.ts";
import { fliesClear, foam, frontFirst, gripReaches, landsInside, letsGoClean, lift, limbsReach, marksAs, movable, placedBy, print, releasesAt, scene, sea, shoves, throwLands, tolerance, warned, woodblock, LOOKS, type Check, type Sea, type Target, type WoodblockLook, type WoodblockSpec, type Sky } from "../../src/index.ts";
import { impactPaint } from "./lib/impact.ts";
import { base as boatsBase } from "./titan/boats/base.ts";
import { host as boatsHost } from "./titan/boats/host.ts";
import { SCALE_SHIP_LENGTH } from "./lib/scale_ship.ts";
import { base as backBase } from "./titan/back/base.ts";
import { headland } from "./titan/back/headland.ts";
import { keep } from "./titan/back/keep.ts";
import { lighthouse } from "./titan/back/lighthouse.ts";
import { shrine } from "./titan/back/shrine.ts";
import { terraces } from "./titan/back/terraces.ts";
import { spiral } from "./titan/back/spiral.ts";
import { base as carapaceBase } from "./titan/carapace/base.ts";
import { kabuto } from "./titan/carapace/kabuto.ts";
import { pebble } from "./titan/carapace/pebble.ts";
import { thorny } from "./titan/carapace/thorny.ts";
import { base as clawsBase } from "./titan/claws/base.ts";
import { fiddler, fiddlerAside } from "./titan/claws/fiddler.ts";
import { gauntlet } from "./titan/claws/gauntlet.ts";
import { tongs } from "./titan/claws/tongs.ts";
import { base as faceBase } from "./titan/face/base.ts";
import { brow, browStalk } from "./titan/face/brow.ts";
import { dandy } from "./titan/face/dandy.ts";
import { jitter } from "./titan/face/jitter.ts";
import { mask } from "./titan/face/mask.ts";
import { mourner } from "./titan/face/mourner.ts";
import { patient } from "./titan/face/patient.ts";
import { periscope } from "./titan/face/periscope.ts";
import { base as legsBase } from "./titan/legs/base.ts";
import { armoured } from "./titan/legs/armoured.ts";
import { hermit } from "./titan/legs/hermit.ts";
import { slim } from "./titan/legs/slim.ts";
import { stilt } from "./titan/legs/stilt.ts";
import { S, type Numbers } from "./titan/numbers.ts";
import { AT_HOME, stage, type Staging } from "./titan/rig.ts";
import type { BackOption, BoatsOption, CarapaceOption, ClawsOption, FaceOption, LegsOption, WaterOption } from "./titan/slots.ts";

// The cameras, from the build's numbers. The game's cameras (game, three, close, top, grab) are fixed in the world. The
// comparison columns follow the crab where a variant moves it (docs/variants.md, "Limits"): `face` follows the head
// mount (the carapace's front, and the ride height) all the way; `legs`, `back` and `far` rise by a share of the ride,
// so a tall crab stays in frame. For the base every shift is exactly 0 and the cameras are the numbers they always were.
const camerasFor = (n: Numbers): Readonly<Record<string, Camera>> => {
  const rise = n.ride - S.ride, front = n.carapace.to - S.carapace.to;
  const at = (c: { eye: readonly [number, number, number]; target: readonly [number, number, number]; fovY: number }, dx: number, dy: number): Camera =>
    ({ kind: "perspective", eye: [c.eye[0] + dx, c.eye[1] + dy, c.eye[2]], target: [c.target[0] + dx, c.target[1] + dy, c.target[2]], fovY: c.fovY });
  return {
    game: { kind: "perspective", eye: [23, 27, 21], target: [3, 0.5, 2.5], fovY: 0.6 },
    three: { kind: "perspective", eye: [27, 12, 9], target: [1.5, 2, 5.5], fovY: 0.6 },
    // The face, from the front and above (the claws, folded at rest, cover the mouth from lower down), the fort behind.
    close: { kind: "perspective", eye: [15.5, 9, 3], target: [4.2, 1.4, 0.2], fovY: 0.55 },
    top: { kind: "orthographic", eye: [1, 50, 0.001], target: [1, 0, 1], height: 34 },
    // The Grab from low and to the side: the claw closing across the beam, the lift and the squeeze.
    grab: { kind: "perspective", eye: [21, 5.5, -3], target: [8.5, 2.2, -6.5], fovY: 0.6 },
    // For comparing variants (`loft variants`): a far step back (the whole silhouette, the ship and the crush disc), the
    // face head on, the legs from the right side at water level, the back from above and behind.
    far: at({ eye: [33, 21, 21], target: [3, 1.5, -1], fovY: 0.6 }, 0, rise * 0.35),
    // `close`'s eye with a longer lens: from lower or nearer, the resting claws cover the mouth.
    face: at({ eye: [15.5, 9, 3], target: [4.5, 2.8, 0], fovY: 0.46 }, front, rise + n.faceRise),
    legs: at({ eye: [2, 0.9, 26], target: [1.5, 1.4, 0], fovY: 0.6 }, 0, rise * 0.85),
    back: at({ eye: [-15, 19, 9], target: [-1.5, 2.5, 0], fovY: 0.6 }, 0, rise * 0.5),
    // The throw in profile, from ahead of the crab looking back at it: the claw cocks on the left of
    // the frame and the ship flies the whole arc to the right, against open water. Fixed in the world, as the game's.
    throw: { kind: "perspective", eye: [58, 12, -16], target: [4, 3, -16], fovY: 0.6 },
    // The whole arena: the game camera's direction, pulled back and aimed between the crab and where the thrown ship
    // lands, so one frame holds the crab, both boats, the slam and its ring, and the landing. The game camera itself
    // cannot: its frame ends 23.5 from the crab's middle, and the ship comes down 37 away.
    arena: { kind: "perspective", eye: [39.8, 49.7, 21.4], target: [2, 0, -11], fovY: 0.6 },
    // The camera of the spiral shell's picked picture (crab_round5/back_spiral_pick.webp): from behind, above and to the
    // right, looking at the shell's face (DIRECTION.md, Round 5). Fixed in the world, as the game's.
    pick: { kind: "perspective", eye: [-12, 17, 19], target: [-1.5, 2, 0], fovY: 0.6 },
    // The lineup's single (examples/bosses/lineup_shots.ts): straight in front, the eye 3 above the water, 30 away; and
    // the same from straight behind and from the left side. For judging a back from the dance video's camera and round it.
    lowFront: { kind: "perspective", eye: [30, 3, 0], target: [0, 3.4, 0], fovY: 0.4 },
    lowRear: { kind: "perspective", eye: [-30, 5, 0], target: [0, 3.4, 0], fovY: 0.4 },
    lowLeft: { kind: "perspective", eye: [1, 5, -30], target: [1, 3.4, 0], fovY: 0.4 },
    // `lowLeft`'s mirror: the islander's shell turns its coil to the left flank and its base to the right.
    lowRight: { kind: "perspective", eye: [1, 5, 30], target: [1, 3.4, 0], fovY: 0.4 },
  };
};

/**
 * The ways white water is printed in a crab's scene; `base` is every crab's own. Exported for a scene that stages
 * several crabs (it prints them all one way).
 */
export const WATER = {
  base: { about: "roll: a rolling mass with curled heads, for the collar, the crest and the bursts", collar: foam.roll(), marks: marksAs.heads(), burst: impactPaint.roll() },
  curls: { about: "round lobes lying over each other, some with a curl cut in", collar: foam.curls(), marks: marksAs.flat(), burst: impactPaint.ridge },
  apron: { about: "one flat scalloped shape with a key line", collar: foam.apron(), marks: marksAs.flat(), burst: impactPaint.ridge },
  rings: { about: "thin broken ripple arcs moving outward, no fill", collar: foam.rings(), marks: marksAs.flat(), burst: impactPaint.ridge },
  stipple: { about: "printed dots, dense at the body", collar: foam.stipple(), marks: marksAs.flat(), burst: impactPaint.ridge },
  breakers: { about: "a low collar and blades along the swell's printed lines", collar: foam.breakers(), marks: marksAs.flat(), burst: impactPaint.ridge },
  ridge: { about: "filaments along the zero lines of a noise (the first foam)", collar: foam.ridge(), marks: marksAs.flat(), burst: impactPaint.ridge },
} satisfies Record<string, WaterOption>;

/** The print every crab is drawn in, from its inks; and the sun. Exported for a scene that stages several crabs. */
export const styleFor = (n: Numbers, water: Pick<WaterOption, "collar" | "marks">, sky?: Partial<Sky>, look: WoodblockLook = LOOK.base) =>
  woodblock(look.on({ print: print.overprint({ ink: n.ink.indigo, amount: n.shadowIndigo, value: n.shadowValue, black: 0.1 }), foam: water.collar, marks: water.marks, sky }));

/**
 * How the print is lit and inked (docs/lighting.md): `base` is the print as it is; the others are the woodblock style's
 * named looks (`LOOKS`). A look, not a part (`looks` below): `--variant bruiser,light=engraving`. On any scene in the
 * woodblock style, `--light engraving` chooses the same look without a slot.
 */
export const LOOK = { base: { about: "the print as it is: the overprinted shadow side at N.L = 0", on: (s: WoodblockSpec) => s }, ...LOOKS } satisfies Record<string, WoodblockLook & { readonly about: string }>;
/** The sun: the host input `sun`, this direction unless a game or a clip moves it (`--input sun=x,y,z`, `--sweep sun=a..b`). */
export const SUN = movable([0.15, 0.8, 0.6]);

type Slots = { readonly carapace: CarapaceOption; readonly legs: LegsOption; readonly claws: ClawsOption; readonly face: FaceOption; readonly back: BackOption; readonly boats: BoatsOption; readonly foam: WaterOption; readonly light: WoodblockLook };

/** Numbers, then what the claws offer the rig, then the rig's first stage; on the sea given, the rig and each slot drawn on it. */
function assemble(o: Slots, n: Numbers, how: Staging) {
  const offer = o.claws.offer(n);
  const staged = stage(n, offer, o.boats, how, o.foam.burst);
  return {
    deforms: staged.deforms, sea: staged.sea,
    finish: (water: Sea) => {
      const r = staged.finish(water);
      const carapace = o.carapace.draw(r);
      const legs = o.legs.draw(r);
      const claws = o.claws.draw(r, offer);
      const face = o.face.draw(r, carapace, claws);
      const back = o.back.draw(r);
      return {
        things: [...carapace.things, ...back, ...face.things, ...legs.things, ...claws.things, ...r.world.warnings, r.world.crash, ...r.world.splash, ...r.world.boat],
        strikes: { crush: claws.crush },
        holds: { grab: r.grab },
        waves: { crush: r.crush },
        handoff: r.handoff,
        inputs: r.inputs,
        rig: r,
        // The great claw's wrist and arm span: what a routine's aims are measured in (crab_lineup.ts, the sync instrument).
        great: claws.great,
      checks: [
        landsInside(claws.crush), warned(r.crush), warned(r.grab),
        // Every leg inside its reach over the whole loop, with the body's full range of motion: never a straight snapped
        // line (2% of the span short of it), never folded (10% of the span off it), the knee outboard (docs/stance.md).
        limbsReach(legs.limbs, { period: n.crushPeriod, slack: tolerance.share(0.02), fold: tolerance.share(0.1) }),
        // The fingers are curled horns a fifth of the beam thick near their tips: a tenth of the beam either way is a close grip.
        // The hold ends in the whip, so this also says the drawn claw keeps the ship through the stroke (its arm reaches).
        gripReaches(r.grab, claws.cutterFingers, { middle: tolerance.share(0.1), gap: tolerance.share(0.1) }),
        // The hand-off, whoever places the ship afterwards: let go at the stated instant, point and velocity (2% of the
        // release speed, 2% of the stroke).
        releasesAt(r.grab, { speed: tolerance.share(0.02), place: tolerance.share(0.02) }),
        // The slam's ring is a field a game samples: neither a boat at the second boat's place nor the water under it
        // moves before the front arrives there.
        frontFirst(r.crush, [r.boatTwoAt]),
        // What only a stand-in can be held to: its flight and its drift.
        ...placedBy<readonly Check[]>(r.placer.boat1, {
          standIn: () => [
            // The flight starts as released (2% of the release speed), comes down where and when the attack says (1% of
            // the distance flown), and far: at least 25 from where the ship was taken, six and a half of its lengths.
            throwLands(r.grab, { least: 25, speed: tolerance.share(0.02), place: tolerance.share(0.01) }),
            // In the air the ship (a ball of half its length) passes through neither the carapace nor the atoll (a
            // cylinder of its larger radius: the ship may not fly over the island at any height).
            // A throw over the head (the numbers' `throw.over`) may pass above the back: each cylinder then stands to the stated top.
            fliesClear(r.grab, [
              { kind: "body", body: carapace.hull },
              ...overBack(n.throw.over, [
                { kind: "disc", centre: r.place2(n.atoll.centre), radius: lift<"f32">(Math.max(n.atoll.rx, n.atoll.rz)) },
                // And whatever the chosen back builds beyond that cylinder (slots.ts, `BackOption.keepClear`).
                ...(o.back.keepClear?.(r) ?? []),
              ]),
            ], { size: SCALE_SHIP_LENGTH / 2, margin: 0.5 }),
            // The claw's own fingers let it go: the hand has turned toward the throw, so the hull leaves between them, no
            // more than a tenth of its beam deeper into either than the grip itself, and clear of both in 0.45 s (a crab
            // alone, throwing ahead, is clear in 0.12 to 0.18 s; thrown back over the shoulder in the lineup, 0.32 to 0.37).
            letsGoClean(r.grab, claws.cutterFingers, r.shipTarget, { seconds: 0.45, depth: tolerance.share(0.1) }),
          ],
          host: () => [],
        }),
        ...placedBy<readonly Check[]>(r.placer.boat2, {
          // The second boat's stand-in is the ring's own ride: carried at the wave's speed (2% of it), on the front's
          // face (2% of the ride), dropped where the front stops holding, and forced at least four of its lengths.
          standIn: () => [shoves(r.crush, r.boatTwoAt, { least: 4 * SCALE_SHIP_LENGTH, speed: tolerance.share(0.02), place: tolerance.share(0.02) })],
          host: () => [],
        }),
      ],
        // What the chosen face asks of itself (slots.ts, `Face`): none for a face that asks nothing. Kept apart: they are
        // measured from the crab's own cameras, which a scene that stages several crabs does not have.
        sceneChecks: face.checks,
      };
    },
  };
}

/** The back's cylinders as a throw must clear them: standing to `top` above the water (`Numbers["throw"]["over"]`); to an infinite top, as they are. */
function overBack(top: number, targets: readonly Target[]): Target[] {
  if (top === Infinity) return [...targets];
  return targets.map((t) => (t.kind === "disc" ? { kind: "column", centre: t.centre, radius: t.radius, top: lift<"f32">(top) } : t));
}

/** The islander's temperament (and the bruiser's, the same crab with another face): broad, confident, posed for the camera. */
const SHOW_OFF = { snap: 3, arrive: 0.25, hold: 0.12, leave: 0.25, jitter: 0, lag: 0.25, rise: 0.7, reach: 1.3, together: 0, lift: 1 };

export const design = makeDesign({
  name: "reefback_titan",
  numbers: S as Numbers,
  slots: {
    carapace: { base: carapaceBase, pebble, kabuto, thorny } satisfies Record<string, CarapaceOption>,
    legs: { base: legsBase, stilt, slim, armoured, hermit } satisfies Record<string, LegsOption>,
    claws: { base: clawsBase, fiddler, fiddlerAside, gauntlet, tongs } satisfies Record<string, ClawsOption>,
    face: { base: faceBase, mask, periscope, patient, dandy, brow, browStalk, jitter, mourner } satisfies Record<string, FaceOption>,
    back: { base: backBase, lighthouse, keep, shrine, headland, terraces, spiral } satisfies Record<string, BackOption>,
    boats: { base: boatsBase, host: boatsHost } satisfies Record<string, BoatsOption>,
    // How white water is printed (docs/art_direction/DIRECTION.md, "White water"). `base` is the rolling foam with
    // curled heads for the collar, the wave's crest and the bursts; the others are the style's other collars, with the
    // crest and the bursts as they were before. A look, not a part: see `looks` below.
    foam: WATER,
    light: LOOK,
  },
  looks: ["foam", "light"],
  variants: {
    // The spider crab (docs/art_direction/crab_round2/stilt_*.webp): a small thorny body high on bamboo stilts, tongs, a
    // mourner's face on hanging eyes (face/mourner.ts; its first face, `patient`, is still an option), a red shrine on its
    // back. The ship is taken further round to the front (-0.55, not -0.75): at
    // -0.75 it lay 2.8 from the front-left foot's foam.
    stilt: {
      about: "a colossal spider crab: thorny body on bamboo stilts, tongs, a shrine",
      // Patient, melancholy, eerie: everything late and slow, a long follow-through; in a taunt both tongs go up and it bows.
      pick: { carapace: "thorny", legs: "stilt", claws: "tongs", face: "mourner", back: "shrine" },
      numbers: { grabBearing: -0.55, temper: { snap: 1.5, arrive: 0.7, hold: 0.15, leave: 0.7, jitter: 0, lag: 0.6, rise: -2.2, reach: 1.1, together: 1, lift: 3.6 } },
    },
    // A colossal fiddler (docs/art_direction/crab_round2/fiddler_*.webp): one great claw as long as the body, a slender
    // little cutter, a manic face on very tall stalks (face/jitter.ts; its first face, `periscope`, is still an option), a
    // dark pebble shell, a ruined lighthouse. Its inks: the body darkens to oxblood and
    // near-black; the great claw is the one accent, vermilion-brick to cream. Its claws ask for a crush disc of 4.4 (the
    // base's is 3.4): a bigger hand lands on a bigger area (claws/fiddler.ts), a gameplay change the owner decides.
    fiddler: {
      about: "a colossal fiddler: one great claw, bug eyes on very tall stalks, a dark pebble, a ruined lighthouse",
      pick: { carapace: "pebble", legs: "slim", claws: "fiddler", face: "jitter", back: "lighthouse" },
      // Manic, twitchy: fast and small, never still; it lands on the beat and shakes on the half-beats.
      numbers: { ink: { brick: [0.34, 0.14, 0.14], brickDark: [0.16, 0.09, 0.11], accent: [0.78, 0.22, 0.12] }, temper: { snap: 4, arrive: 0.15, hold: 0, leave: 0.12, jitter: 1, lag: 0.12, rise: 0.3, reach: 0.85, together: 0, lift: 1.2 } },
    },
    // The same crab if the crush disc must stay the base's 3.4: the largest great claw that lands inside it. Measured: 1.85
    // is 1.5% outside, 1.9 is at the 2% limit (theory.ts predicted 3.4 holds about g = 1.9 with the contact squash).
    fiddlerBaseDisc: {
      about: "the fiddler with the base crush disc (3.4): its great claw at the largest that fits",
      pick: { carapace: "pebble", legs: "slim", claws: "fiddler", face: "jitter", back: "lighthouse" },
      numbers: { ink: { brick: [0.34, 0.14, 0.14], brickDark: [0.16, 0.09, 0.11], accent: [0.78, 0.22, 0.12] }, crusher: 1.85, crushRadius: 3.4 },
    },
    // The heikegani: the carapace's front a scowling samurai war mask, armour on every limb, a keep and two pines on top.
    // Stern and proud: few moves, large, snapped into and held dead still (a kabuki mie), then let go.
    mask: {
      about: "a samurai crab: war-mask face, lacquer armour, a keep and two pines", pick: { carapace: "kabuto", face: "mask", legs: "armoured", claws: "gauntlet", back: "keep" },
      numbers: { temper: { snap: 8, arrive: 0.18, hold: 0.6, leave: 0.3, jitter: 0, lag: 0.1, rise: 0.12, reach: 1.25, together: 0, lift: 1 } },
    },
    // The island crab with the fiddler's identity (docs/art_direction/DIRECTION.md, Round 3): the base crab, low in the
    // water with the atoll on its back, one great claw, and the dandy's face (face/dandy.ts). The fiddler claws ask for a
    // crush disc of 4.4, as on the fiddler.
    islander: {
      about: "the island crab as a fiddler: low, a spiral hermit's shell on its back, one great claw, a vain face on tall eyestalks",
      // Its back is the spiral shell (DIRECTION.md, Round 5: "the best back design for when it's a stick-eye crab, as
      // that is a hermit crab"); the headland stays an option (`--variant islander,back=headland`).
      // A hermit (DIRECTION.md, Round 5, "The hermit"): its legs leave through the shell's mouth (legs/hermit.ts) and
      // its body's tail climbs into the shell.
      pick: { claws: "fiddler", face: "dandy", back: "spiral", legs: "hermit" },
      // Vain, a show-off, a bully: broad confident moves, a beat of pose for the camera.
      numbers: { temper: SHOW_OFF, carapace: { rise: 2.2 } },
    },
    // The islander with a face that is a head (docs/art_direction/DIRECTION.md, Round 4): the islander's picks, and
    // face/brow.ts in place of the dandy. `--variant bruiser,face=browStalk` is the same with its eyes on short stalks.
    bruiser: {
      about: "the islander with a head: heavy brows over big eyes sunk in it, a mandible mouth that gapes, long antennae",
      // The great claw is the fiddler's, carried out to the side: beside the face, as the islander carries it, it stood
      // over the right eye from the game camera while the crab turned to the Grab (claws/fiddler.ts, `fiddlerAside`).
      // Its back is its own: the terraces (back/terraces.ts; DIRECTION.md, Round 5), not the islander's.
      pick: { claws: "fiddlerAside", face: "brow", back: "terraces" },
      numbers: { temper: SHOW_OFF },
    },
    // stiltFiddler (fiddler claws on the stilt legs) was removed 2026-11-11, when the stilt legs became the spider crab's
    // (body 6.8 up). The fiddler's arms (2.5 + 2.4) cannot reach the water from there (grip 2.6 off, palm 3.7% outside).
    // Arms long enough for its 0.8 cutter (5.15 + 4.95: grip 0.058 off, measured) make its 2.4 crusher span 16.5 to reach
    // 6.8; folded that far its 7-long palm lies along a forearm aimed away from the disc (38.5% outside, measured). One
    // armLengths scales both claws by size; this pair needs an arm length per claw, a field the claws' numbers lack.
  },
  compare: ["far", "face", "legs", "back"],
  // A crab is assembled in two stages (docs/lineup.md): its rig's first (the attacks, and with them its ring wave),
  // then, on the sea it is given, the rig's second and each slot drawn on it. `build` is the crab alone at home on its
  // own sea; `stage` is the crab as one of several in a scene (examples/bosses/crab_lineup.ts).
  stage: (o, n, how: Staging) => assemble(o, n, how),
  build: (o, n) => {
    const a = assemble(o, n, AT_HOME), water = sea({ ...a.sea, deform: a.deforms }), m = a.finish(water);
    return {
      scene: scene({ ground: water, things: m.things, style: styleFor(n, o.foam, undefined, o.light), sun: SUN, cameras: camerasFor(n) }),
      strikes: m.strikes, holds: m.holds, waves: m.waves, handoff: m.handoff, inputs: m.inputs, checks: [...m.checks, ...m.sceneChecks],
    };
  },
});

const base = design.build(design.resolve(BASE_ASK));
export default base.scene;
export const strikes = base.strikes;
/** What the game reads of the Grab: `held()`, `thing()`, `squeezed()`, and of its throw `flight()` and `toss()`; functions of the clock. */
export const holds = base.holds;
/** What the game reads of Claw Crush's ring wave: `arrives(place)`, `pushed(place)`, and the field `wave()`. */
export const waves = base.waves;
/** The hand-off to a game that runs its own boats: the socket while held, the release, the landing predicted, the wave. */
export const handoff = base.handoff;
/** The host inputs a game sets (their expressions; their names are in docs/throw_and_shove.md). */
export const inputs = base.inputs;
export const checks = base.checks;
