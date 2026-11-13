// The Reefback Titan's numbers: every number an art director changes, in one record. A variant or a slot option
// overrides any of them (src/design.ts, `Overrides`); the rig and every slot read them from the build's record, never
// from this module, so an override reaches everything that reads that number.

import type { Widen } from "../../../src/design.ts";

type V3 = readonly [number, number, number];

export const S = {
  // ---- inks (woodblock): few, flat; shadow is the same ink overprinted with indigo ----
  ink: {
    black: [0.075, 0.07, 0.09], indigo: [0.13, 0.2, 0.37], cream: [0.93, 0.88, 0.75],
    brick: [0.66, 0.22, 0.13], brickDark: [0.42, 0.12, 0.09], moss: [0.47, 0.56, 0.24], mossDeep: [0.2, 0.32, 0.17],
    stone: [0.7, 0.63, 0.5], bark: [0.3, 0.2, 0.14], coral: [0.86, 0.56, 0.46],
    // The one accent a variant may give a single part when it repaints the body (DIRECTION.md: one accent per monster):
    // the fiddler's great claw. No base option reads it; it is the base brick, so that claw on the base crab stays brick.
    accent: [0.66, 0.22, 0.13],
    // The mask direction's dark lacquer (armour, helmet): lighter than the line black so ink lines still read on it.
    // The base reads none of it.
    lacquer: [0.14, 0.1, 0.12],
    // The stilt direction's inks (read only by its options; the base never paints with them): bone-and-straw legs, a
    // dark olive thorny body, and shrine vermilion as its one accent.
    straw: [0.86, 0.79, 0.58], strawDark: [0.52, 0.43, 0.27], thorn: [0.34, 0.31, 0.2], thornDark: [0.15, 0.13, 0.09],
    shrine: [0.8, 0.16, 0.1], shrineDark: [0.42, 0.07, 0.06], paper: [0.97, 0.86, 0.6],
    // Sea growth (examples/bosses/lib/growth.ts; read only by a back that grows it): a mussel's blue-black, kelp's olive,
    // a fan coral's deeper red beside the branching coral's pink (`coral`).
    mussel: [0.15, 0.19, 0.31], kelp: [0.43, 0.46, 0.17], coralDeep: [0.8, 0.33, 0.27],
    // The brow face's mouth (face/brow.ts; no other option reads them): the dark maroon behind the mandibles, its tongue.
    maw: [0.25, 0.06, 0.08], tongue: [0.7, 0.3, 0.3],
  } satisfies Record<string, V3>,
  /** How much indigo the shadow side of every ink takes (0 none, 1 indigo). */
  shadowIndigo: 0.42,
  /** Shadow side brightness after the indigo. */
  shadowValue: 0.78,

  // ---- size and stance ----
  ride: 1.35, floor: -1.7,
  /** The carapace: its tail and nose (crab x), half-width, half-height, and how far its tail rises above its line (read
   * by carapace/base.ts: a hermit's body climbs into its shell; 0, level, for a crab). */
  carapace: { from: -1.6, to: 5.0, width: 4.1, height: 1.25, rise: 0 },
  legRoots: [3.2, 2.0, 0.8, -0.4], legFeet: [[6.8, 8.2], [4.0, 9.6], [0.8, 9.9], [-2.6, 9.0]] as const, legLengths: [4.0, 3.8, 1.6] as const,
  // ---- the walk (a game that moves the crab sets `legs.walking`; docs/stance.md) and the breath: a cycle's seconds (the
  // idle breathes at this rate, made whole breaths of the loop), share of it a foot stands, a step's height (a re-plant's
  // too); the body's bob, sway, roll and turn on the walk's step ----
  period: 3.2, duty: 0.66, lift: 1.5, sway: 0.25, bob: 0.08, roll: 0.03, yaw: 0.035,
  // ---- the stance (docs/stance.md): how the body carries its weight over planted feet. Distances in units, angles in
  // radians. ----
  stance: {
    /** Standing: the weight shifts side to side and fore and aft (`alive`, at about `hz`), the loaded side sinking `roll` a
     * unit of shift and the nose `pitch` a unit forward; a small turn. */
    idle: { side: 0.35, fore: 0.2, hz: 0.1, roll: 0.06, pitch: 0.05, turn: 0.025 },
    /** Re-plants: about one per `every` seconds of idle a step can start in; the body leaves the foot `lead` s before it
     * lifts (by `unload`), the foot is up `seconds` (at `lift`), placed `reach` away, the body back `settle` s after and
     * dipping `dip` as it plants. Idle is the attacks' postures and the taunt below `idleBelow`. */
    replant: { every: 1.8, lead: 0.45, seconds: 0.75, settle: 0.6, reach: 0.5, unload: 0.3, dip: 0.06, idleBelow: 0.02 },
    /** Claw Crush: the wind-up sinks and coils back from the disc, the strike drives toward it (the legs straightening
     * `lift` at its middle) and lands `settle` low for the thud; `roll` leans it toward the disc a unit of the lean. */
    slam: { sink: 0.35, coil: 0.45, reach: 0.6, settle: 0.25, lift: 0.3, roll: 0.14 },
    /** The Grab: the wind-up sinks and draws back from the ship, the reach leans toward it (sinking `settle`); over the
     * first `early` s of the hold it sits back (`sitBack` of the reach behind its rest) and down (`sit`), more at each squeeze. */
    grab: { sink: 0.2, coil: 0.25, reach: 0.5, settle: 0.15, sitBack: 0.4, sit: 0.3, squeeze: 0.12, early: 0.6, pitch: 0.06, roll: 0.08 },
    /** The throw: over the carry it coils away from where the ship is thrown, through the whip it drives toward it, rising
     * as the far legs push, and comes home over the release. */
    throw: { sink: 0.1, coil: 0.3, reach: 0.7, lift: 0.2, pitch: 0.05, roll: 0.08 },
    /** The taunt on planted feet: the sway onto each side stepped to (0.9 of the old sidestep overstretched the far legs:
     * docs/stance.md), its roll, the crouch while in the taunt, a stamp's height as a share of `lift`. */
    dance: { sway: 0.5, roll: 0.07, crouch: 0.15, stamp: 0.6 },
    /** The walk's stride (distance per cycle) when a game walks the crab. */
    walk: { stride: 3.0 },
  },

  // ---- the atoll ----
  atoll: { centre: [-2.0, 0] as const, rx: 4.3, rz: 4.5, top: 2.9, base: -1.75, hills: 0.35, lumps: 0.08 },
  coralHeads: 18, trees: 6,
  fort: { at: [-2.6, -1.1] as const, height: 2.4, girth: 0.85, lean: 0.12 },

  // ---- the headland (back/headland.ts): the island as a dome on a shell tier, a light on a point; read only by it ----
  // Bearings are radians round the island's centre from the bow (+x), positive toward the right flank (+z).
  headland: {
    /** How much higher than its rim the cap's crown stands (the cap is a low dome). */
    dome: 0.45,
    /** The point: its bearing, how far its tip reaches beyond the shell's rim, its half-width, its top's height (crab y). */
    point: { bearing: -2.094, reach: 2.3, half: 1.3, top: 0.9 },
    /** The cove's two horns, each [bearing, reach beyond the rim, half-width, its top's height], and how far the beach
     * between them runs out. The bow-side horn is a reef flat just above the water, so the game camera sees the beach over it. */
    horns: [[1.92, 1.2, 0.7, -0.95], [2.58, 1.4, 0.85, 0.5]] as const, beach: 1.7,
    /** The light on the point: the tower's height, its girth at foot and top, its lean (the tangent of its angle, out along
     * the point), how far inside the tip its foot stands, its size against the fiddler's (gallery, lantern, gulls), its gulls. */
    light: { height: 3.0, girth: [0.5, 0.34] as const, lean: 0.28, inset: 0.8, size: 0.5, gulls: 3 },
  },

  // ---- the terraces (back/terraces.ts): a turf cap on cream cliffs with broad shell plates laid up them; read only by it ----
  // Bearings are degrees round the island's centre from the bow (+x), positive toward the right flank (+z). Heights are
  // above the still water unless said; lengths are crab units.
  terraces: {
    /** How far the crown stands over the atoll's `top`; how high over the water the rim is round the tail (beside the
     * carapace it is the carapace's rim line). */
    crown: 0.7, rim: 0.5,
    /** The cap (G: 0 the crown, 1 the rim): out to G = `at` it is turf, nearly level (it falls `drop` of the island's
     * height to its edge), reaching `radius` of the rim's radius; its edge wanders by `wander` in G. Below it the cliff
     * falls as `1 - t^cliff` (t: 0 at the cap's edge, 1 at the rim): a rounded shoulder, steepest at the water. */
    cap: { at: 0.42, radius: 0.55, drop: 0.2, wander: 0.05 }, cliff: 1.0,
    /** The island's outline as shares of the atoll's radii: at the bow and at the tail (an egg), and its lumps. */
    outline: { bow: 0.9, tail: 1.1, lumps: 0.025 },
    /** The shell plates laid over the cliff, each [its root's bearing at the rim, how far its bearing turns back as it
     * climbs to its tip (degrees), its half-width (degrees) at its widest, its tip's G, how far it stands out of the
     * hull]. Three broad plates, then three narrow blades; all lean the same way (the paint-overs' lower left to
     * upper right). Broad plates at three corners of the island (one arching over the beach), blades between, every
     * gap unequal; the game camera sees the first broad plate and the two blades beside it. */
    plates: [[34, 30, 36, 0.43, 0.48], [158, 34, 38, 0.42, 0.5], [272, 30, 33, 0.44, 0.46], [96, 18, 15, 0.56, 0.32], [212, 20, 12, 0.6, 0.28], [330, 24, 17, 0.54, 0.34]] as const,
    /** Turf ledges cut into the cliff, each [G of its tread's inner edge, the tread's width in G, its middle bearing,
     * its half-span (degrees)]: arcs, not rings; the plates cross them. */
    ledges: [[0.6, 0.07, 140, 28], [0.66, 0.06, 296, 22]] as const,
    /** The plates' ribs: lines across a broad plate (sparse); how far past its tip a plate's ribs run on as stone
     * flutes (in G), and how far the turf hangs down over its tip (in G). */
    ribs: 7, flute: 0.12, tongue: 0.07,
    /** The point: its bearing, how far its tip is from the island's centre, its half-width, its rock's height at the
     * light and at the tip. */
    point: { bearing: 192, tip: 8.4, half: 1.15, top: 0.8, low: 0.3 },
    /** The beach under the plates' arch: its middle bearing, half its span, how far the sand runs beyond the rim, how
     * high the rim lifts over it. */
    beach: { bearing: 164, span: 15, sand: 1.4, arch: 0.7, cove: 0.11 },
    /** The reef shelf and its three stacks: the shelf's bearing, how far it runs beyond the rim and its half-width; each
     * stack [distance from the island's centre, bearing, height, girth]. */
    shelf: { bearing: 122, reach: 2.3, half: 1.1 }, stacks: [[6.1, 126, 2.3, 0.72], [7.0, 121, 1.5, 0.5], [7.7, 117, 0.9, 0.36]] as const,
    /** Two groves, each [G, bearing, trees]: one left of the crown, one forward-right, open turf and the crown between.
     * Neither stands on the sight lines from the light to the game and far cameras, which cross the cap's right half
     * toward the tail (2.1 and 1.25 from the centre), and both are behind x = -0.5 (the head and its antennae). */
    groves: [[0.26, -60, 5], [0.3, 40, 4]] as const,
    /**
     * The light on the point (back/beacon.ts): how far from the island's centre its foot stands, the tower's height, its
     * girth at foot and top, the share of the tower that is crust, the lantern room's size, its gulls. Then its structure,
     * for an attack to move later: `lean` (the tangent of its angle out along the point; 0 upright), `rise` (how far the
     * tower stands up out of the mound on its segmented neck; 0 down, and the neck is not drawn), `shutters` (0 shut,
     * 1 flung open).
     */
    light: { at: 7.0, height: 3.6, girth: [0.64, 0.46] as const, crust: 0.3, size: 1.0, gulls: 2, lean: 0.24, rise: 0, shutters: 0 },
  },
  // ---- the spiral shell (back/spiral.ts): a hermit's shell, one tube coiled by Raup's law; read only by it ----
  // (docs/art_direction/DIRECTION.md, Round 5.) The coil turns counterclockwise going back from the mouth, seen from its
  // face: the picked picture's hand (crab_round5/back_spiral_pick.webp). Its mouth is at the front, facing down over
  // the carapace's back half, the tube coming down into it.
  spiral: {
    /** Raup's numbers. `whorls`: turns of the tube from its tip to the mouth. `growth` (W): how much every length grows
     * in one turn; the printed spiral's rings stand `growth` apart, and the last turn is 1 - 1/growth of the width. */
    whorls: 3.0, growth: 3.0,
    /** Which way the tube turns about the axis going back from the mouth (back/spiral_shell.ts, `handOf`). */
    hand: "sinistral" as "dextral" | "sinistral",
    /** The mouth's section: half-extents across the coil (toward and away from the axis) and along the axis. The tube
     * touches the axis (Raup's D = 0): a shell with no navel. 3.15 across by 2.3 along (2.2 by 3.2 before 2026-11-12's
     * finish): the face about the body's area from `game`; thin along the axis, so the wheel clears the legs, but fat
     * enough to read as a tube from the side. */
    // 3.0 by 2.2 and seated 1.0 further back (in -0.5) by the integrator, 2026-11-12: at 3.15 with in 0.5 the eyes went
    // 0.71 and 0.39 inside the shell's front rim as the slam lands (t = 12.4); now they clear by 0.55 and 0.71. The great
    // claw still passes about 1.0 inside for half a second in the slam's wind-up (t = 11.5), at any size that reads.
    mouth: { radial: 2.7, axial: 4.6 },
    /** Raup's T as a slope: how far each turn's crown steps down from the tip's plane per unit of its distance from the
     * axis. 0 is a flat spiral face; 0.1 nearly so, a wheel whose curl stands a little proud (1.0 was a turban, read from
     * above as tiers). */
    spire: 0.7,
    /** The axis (it points out of the spiral's face, toward the tip): raised by `tilt` above level, toward the crab's
     * right flank, and swung back by `rake` (radians). `rake` -2.4 swings it past forward (-pi/2) toward the crab's left,
     * half a right angle: the face looks forward, up and left, at the dance video's low front camera and (obliquely) at
     * `game`. -1.9 faced `game` better, but the great claw's slam wind-up passed 1.1 inside the wheel's right side; -2.4
     * is the least that clears it. `tilt` 0.95. Chosen with tools/spiral_views.ts (DIRECTION.md, Round 5). */
    tilt: 0.08, rake: 3.22,
    /** Where round the axis the mouth sits, radians from forward toward up in the coil's own plane. The mouth's plane
     * holds the axis, so with the face forward the mouth opens down only at the wheel's side: 1.7 puts it at the crab's
     * left of the wheel, opening down and forward over the carapace's back. */
    mouthAt: 0.75,
    /** Where the mouth sits over the body: its plane passes `up` above the body's origin at `in` ahead of the
     * carapace's tail end, `side` to the right; that point is `lip` short of the outer lip (so the axis, the curl's
     * centre, is 2 radial - lip behind it). */
    seat: { in: 2.9, up: 2.1, side: 0.3, lip: 0.8 },
    /** The rim's bands, lines of constant phi that run the tube's length round the whorl's outer side and far face:
     * `count` round the section, cream for `cream` of each period (0.3: at 0.25 the two key lines ate the band from far
     * off), the first one's middle `at` periods round from the tube's outer side; `proud` is how far a cream band stands
     * out of the tube, as a share of its section. Where the spiral's face shows, the coil is printed instead. */
    band: { count: 6, cream: 0.3, at: 0.0, proud: 0.0 },
    /** The face's coil (`coilAt`): cream for `cream` of each turn's strip on the face, on its suture's side, so the face
     * is one cream coil about as wide as the brick between; and a cream boss over the last `boss` turns at the curl. */
    coil: { cream: 0.45, boss: 0.45 },
    /** The lip: how far the mouth flares (a share of the section), the lip's thickness (the same), and how far back
     * the dark throat runs inside (turns). */
    lip: { flare: 0.12, thick: 0.15, throat: 0.22 },
    /** The light: on the highest point of the outer whorl (found from the form), on a cream collar of radius `collar`
     * ringed with barnacles, leaning a little outward; its height and girth, its size against the fiddler's, its gulls.
     * `pose` is what it could later be animated by, with the defaults it is drawn in: `lean` (the tangent of its angle,
     * outward), `rise` (how far a segmented neck lifts it, units; 0: no neck), `shutters` (0 shut, 1 open). */
    light: { collar: 1.1, height: 1.6, girth: [0.55, 0.42] as const, size: 0.4, gulls: 0, pose: { lean: 0.12, rise: 0, shutters: 0 } },
    /** Two groves on turf, either side of the light along the outer whorl: each [turns from the light (minus: toward the
     * mouth), trees, the turf's radius], on the whorl's shoulder there (where it faces most nearly up and shows). */
    groves: [[0.1, 4, 1.2], [0.19, 3, 0.9]] as const,
  },

  // ---- claws: the right (crusher) 1.4 times the left ----
  crusher: 1.4, cutter: 1.0, clawPalm: 2.9, clawFat: 1.1, armLengths: [2.5, 2.4] as const,

  // ---- eyes ----
  stalk: 2.4, eye: 0.3,
  /** How much higher than the head mount's own the `face` camera stands and aims (reefback_titan.ts, `camerasFor`): a
   * face on very tall stalks asks for more, one whose eyes hang below the body for less. The base asks for none. */
  faceRise: 0,

  // ---- Claw Crush: the hit disc on the water (world xz), its warning, its loop ----
  // The show loops every 22 s: the Grab closes at 3.0 and throws its ship (down at 9.3), Claw Crush arms at 12.0 and
  // its ring shoves the second boat, which coasts for the rest of the loop, so one idea reads at a time. Both boats are
  // back at their places at the loop's seam.
  crushCentre: [9.6, 5.6] as const, crushRadius: 3.4, crushWarn: 1.5, crushFirst: 12.0, crushPeriod: 22,
  // Pushed 1.2x and 1.5x from 6.5 and 2.0 (exaggeration): the claw climbs higher and pulls further back the wrong way.
  // At 8.5 (1.3x) the raised claw left the top of the game camera's frame.
  crushRise: 7.8, crushCoil: 3.0,
  /** Claw Crush's own seconds: the claw rises and coils (windup), then drives down (strike) and lands. */
  crushSeconds: { windup: 1.15, strike: 0.3 },
  /** Seconds the body takes to settle after Claw Crush lands: its wind-up and strike are the attack's own. */
  crushSettle: 1.8,
  /** The foam crash after the slam: how far the ring runs out (times the disc's radius), and for how long. */
  crashReach: 1.6, crashSeconds: 1.4,

  // ---- the Grab: the cutter takes the scale ship (lib/scale_ship.ts), lifts it, squeezes it twice, throws it ----
  /** Seconds into the loop the grip closes (the grab's arming), and the warning before it. They are equal, so the grab's
   * cycle (and with it the thrown ship's return to its place) turns over exactly at the loop's seam. */
  grabClose: 3.0, grabWarn: 3.0,
  /**
   * The grab's seconds, each stated once: the claw rises into posture (windup), reaches and closes (the attack's strike
   * is reach + close), holds, lets go. `drawBack` is how far the reach first leaves the wrong way (grab's `windup`).
   */
  grabSeconds: { windup: 0.9, reach: 1.3, close: 0.22, hold: 3.1, release: 1.3 }, grabDrawBack: 1.7,
  /** The ship's keel bearing, radians from +x toward +z: ahead-left of the crab, on the cutter's side, and from the game
   * camera clear of the resting crusher (at -0.44 the crusher covered it). */
  grabBearing: -0.75,
  /** Horizontal distance from the cutter's shoulder to its wrist when the grip closes: the arm spans 4.9, so the elbow stays bent. */
  grabWristReach: 4.2,
  // The carry's arch over the straight way from where the ship is taken to the wind-back place (2.15 up): with 2.0 the
  // ship tops out 3.5 above the water two thirds of the way, as the old lift did, then sinks back as the claw cocks.
  grabLift: 2.0, grabSqueeze: 0.5,
  /** How many times the grip squeezes while it holds. */
  grabPulses: 2,

  // ---- temperament: the manner one rig moves in (docs/lineup.md). The beats are the attacks' and the taunt's; this is
  // how this crab arrives on them. A variant overrides it; these are the crab as first drawn. ----
  temper: {
    /** How sharply it moves into a pose: the power of its ease (2 gentle, 8 snapped). */
    snap: 2,
    /** Seconds a taunt's move takes to arrive on its accent (a slow mover starts early so that it lands on the beat), seconds it
     * is held there (a pose struck and frozen), and seconds to leave it. */
    arrive: 0.25, hold: 0, leave: 0.25,
    /** How much it twitches: 0 not at all; 1 doubles its idle and shakes it on the half-beats of a taunt. */
    jitter: 0,
    /** Seconds its loose parts follow late: the shell after the body, the small claw after the great one. */
    lag: 0.25,
    /** What its body does with a taunt's move: rises on its legs by this much (units), or, below 0, drops into a bow. */
    rise: 0.55,
    /** The size of its taunt's moves, times the rig's. */
    reach: 1,
    /** How its claws share a taunt's move: 0 the small claw answers the great one late; 1 both go up together. */
    together: 0,
    /** How high its claws go in a taunt, times the move's own height (`reach` sizes the whole move). */
    lift: 1,
  },

  // ---- the throw and the wave (docs/throw_and_shove.md) ----
  /** The world's gravity, units/s^2: the thrown ship's flight and (with the sea's depth) the ring wave's speed. */
  gravity: 5,
  /** The sea's depth here: the base crab stands on the bottom (`-floor`). The world's, not a variant's: the stilt crab's
   * feet plant higher (floor -1.0), and a wave taken from that ran at 2.24, slower than the shove it was asked to give. */
  seaDepth: 1.7,
  /**
   * The throw that ends the Grab. The carry draws the ship back to the wind-back place, given in the ship's own axes
   * from where it is taken (`back` along the keel toward the crab, `side` to starboard, `up`), so every variant's claw
   * cocks relative to its own ship. `stroke` seconds accelerate it, it flies `flight` seconds to `land` (world x, z:
   * the default of the `throw.land` input; the farthest open water the game camera shows whole, its far right corner:
   * at (5.7, -21.0) the bowsprit and the sail's peak were cut by the frame), skids on under `drag` and heaves; the claw
   * follows through for `follow`. `turns` whole turns in the air, about the level axis across the throw.
   * Since the owner's second note the landing is far (29 flown, 37 from the crab's middle): the game camera loses the
   * ship through its top right corner and the `arena` and `throw` cameras show it land. The landing the game camera
   * can show whole is (4.3, -19.6), with flight 2.6, stroke 0.5, follow 0.3 and one turn: 13.3 flown.
   * `gravity` is the flight's: the world's (5) for a crab alone; a scene may loft it (a high arc in a short flight)
   * without changing the ring wave's speed, which the world's gravity also sets. `over`: how high above the water the
   * back's columns stand as a throw must clear them: Infinity for a crab alone (a back may not be flown over at any
   * height); a scene that throws over the head states its back's top.
   */
  throw: { back: 2.7, side: 0.9, up: 2.15, stroke: 0.4, follow: 0.25, flight: 3.2, land: [-1.0, -35.0] as const, drag: 0.2, heave: { hz: 0.9, damping: 0.45 }, turns: 2, gravity: 5, over: Infinity },
  /** The splash where the thrown ship lands: how far its foam runs, for how long, and the squash of the hull at touchdown. */
  splash: { reach: 3.6, seconds: 1.5, squash: 0.3 },
  /** Claw Crush's ring wave (docs/throw_and_shove.md, "The ride"): crest height at the disc's edge (the depth is 1.7; a
   * crest breaks near 1.3), pulse length, where it is gone, the holding height (the front carries what floats while its
   * crest is at least this tall: to 16 from the centre for a disc of 3.4, since the crest falls as 1 / sqrt(r)), and the
   * stand-in's coasting drag once dropped. Earlier versions gave the boat a nudge (1 boat length), then an impulse and a
   * 3 s drag (1.8 lengths, a drift); the owner asked for the boat forced back. */
  wave: { height: 1.0, length: 6, reach: 22, hold: 0.46, drag: 1.6 },
  /** The second boat's default place: `beyond` the crush disc's edge (whatever the disc's radius) along `bearing` from
   * its centre, with its bow toward the slam (`heading` 2.0 is 20 degrees off bow-on to the front and 19 off side-on
   * to the game camera: at 1.19 it pointed at the camera and read as a spar): the front throws the bow up and drives it
   * back stern first. On bearing -1.54 the game frame holds the whole ride and coast (22 from the disc's centre) with
   * the slewed boat whole; at -1.5 its sail met the frame's right edge, and at -1.35 it left the frame after 13. `kick` is the bow's first pitch when the face takes it (radians,
   * ringing down) and `slew` how far it turns as it coasts to a stop. Its stand-in keeps where it ended for `keep` s
   * after the slam, then the boat is back at its place: 10 is the loop's seam (crushPeriod - crushFirst). */
  boatTwo: { bearing: -1.54, beyond: 2.0, heading: 2.0, kick: 0.5, slew: 0.9, keep: 10.0, sail: [0.86, 0.79, 0.58] as const },
} as const;

/** The numbers as a build reads them: the same shape with every literal widened, so overrides may change them. */
export type Numbers = Widen<typeof S>;
