# Stance: how the crab stands on its legs

Written before the code (2026-11-12) and committed; scored at the end. The owner: "their legs seem to always be
stepping up and down in a static loop. Can we make that a little bit more like an idle animation, and when dancing
they lean and bend the knees and feet are planted, or during attacks legs anchor and wind up with the body."

## What was there

`gait({ stride: 0 })`: every foot lifts and plants on a 3.2 s cycle (4.2 s on the stilts, 2 s in the lineup) with a
duty of 0.66, forever, through the idle, both attacks and the taunt. At any instant two or three of eight feet are in
the air. The body's bob, roll, yaw and sway are sines of the same walk clock, with the attacks' lean and thud and the
taunt's moves added on top. It reads as a wind-up toy: the feet carry no weight.

## How a heavy animal on eight legs stands (the idea, mine)

A heavy animal standing does not move its feet; it moves its body over them. The feet are fixed points in the world,
the body is a frame that rises, sinks, shifts and tilts over them, and the legs are whatever joins the two: the knees
take up every change in distance. So a stance is two things:

1. **a carriage**: the body's offset from its rest over the feet: surge (forward), rise, sway (to its right), roll,
   pitch, yaw, in the ground frame under it;
2. **a footing**: where each foot is, and whether it bears weight. Feet move only by discrete, deliberate steps; a
   foot that steps is first unloaded (the body moves off it), then lifted, placed, and loaded again.

What the creature is doing chooses the carriage; the footing changes only at named events. Knees "read" for free: a
leg is inverse kinematics from a root on the body to a planted foot, so when the body sinks or shifts toward a side,
the knees on that side fold up and out. The work is keeping every leg inside its reach while the body moves.

Inherited: the three-segment `limb` solve, the gait (kept for travel), the attacks' and the taunt's beats, `alive`
and `looping`. Mine: the stance as a sum type over a fixed footing, the re-plant schedule placed in the fight's own
idle time and gated by it, stamps on the taunt's accents, and the reach check.

## The stances (a sum type, one dispatcher, one handler each)

`src/geom/stance.ts`. Each handler returns a carriage; the dispatcher sums them. Every term is a closed form of the
clock; nothing is stored.

| Stance | Driven by | Carriage |
|---|---|---|
| `idle` | the clock, a seed per crab, the re-plants | breathing (rise at the crab's breath rate), a slow weight shift side to side and fore and aft (`alive`, its own seed), rolling and pitching toward the loaded side; and before each re-plant the body leaves that foot and comes back after it |
| `brace` | one attack's beats and envelope | `load` drops the body and coils it back from the target; `drive` throws it toward the target with the legs straightening; `absorb` drops it as the knees take the impact; a lean (pitch, roll, yaw) per unit of drive. One brace per push: the slam, the Grab's reach and hold, the Grab's throw |
| `dance` | the taunt (`rig.dance`: `on`, `wave`, `swing`, `step`) | hips, not feet: rise or bow with each move (the crab's `temper.rise`), a crouch while in the taunt, a sway onto the side stepped to, a roll into it, a turn with the swing |
| `walk` | `legs.walking` (0..1) and `legs.travelled` (units): host inputs, default standing | the old gait, phased by distance instead of time, with its bob and sway on that clock |

**The blend.** `idle` fills what the others leave: its weight is `1 - max(on of the others)`, where `on` is the
attacks' posture envelope `p`, the taunt's `on`, and `legs.walking`. The brace and dance carriages are already zero
outside their actions (they are made of their own beats), so they are added at full weight: nothing to keep in step
by hand. The slam's existing lean and thud become the slam's brace (`load`, `drive`, `absorb`); the Grab's existing
turn toward the left claw becomes the Grab's yaw. No second motion is added on top.

**The footing.** Feet stand at their homes. They leave them only by:

- **re-plants** (idle): one foot at a time, `n.stance.replant.seconds` (0.75 s) in the air, `n.lift` high, placed
  `n.stance.replant.reach` (0.5) away, the body shifting `n.stance.unload` (0.3) off that foot over 0.45 s before it
  lifts and back over 0.6 s after it plants, with a small dip at the plant (the knees take it). Each foot that goes
  away comes back later in the loop (a pair), so the loop closes.
- **stamps** (dance): on each of the taunt's accents, one foot on the side the body is about to move onto (the
  unloaded side) lifts during the move's rise (`temper.arrive` seconds) and comes down on the accent, in place.
- **the walk**: the gait's feet, blended in by `legs.walking`.

**How often, and the loop.** The schedule is computed when the crab is built: the library samples the fight's own
`busy` clock (the larger of the attacks' posture envelopes, the taunt's `on`, the walk's weight; at the inputs'
defaults) over one loop, finds the idle time (busy below 0.02 from the step's anticipation to its settle), and spreads
an even number of steps through it, one per `n.stance.replant.every` (2.6 s) of idle, with a seeded jitter and a seeded
choice of feet (the namespace's seed, so four crabs in a line differ). Steps are paired out and back; the pairs are
interleaved (A out, B out, A back, B back) so no foot steps twice in a row and two feet of opposite sides alternate.
Every pair runs on its own clock `mod(t - out, loop)`, so the loop is `crushPeriod` (22 s alone, 24 s in the lineup)
and t = loop is t = 0 exactly. **Gated**: at run time each pair happens only if the busy clock at that occurrence's
times (out's anticipation, out's settle, back's anticipation, back's settle) is idle; a game that arms an attack
elsewhere suppresses the pair whole, so a foot never lifts in a brace and never steps out without stepping back.

Readouts the options use: `walk.foot(k)`, `walk.planted(k)` (1 bearing weight, 0 in the air), and a new
`walk.since(k)`: seconds since foot k last planted and since it lifted (negative while planted). `footPhase` is
removed: it was the gait's phase, which no longer says when a foot steps. Its readers (the stilt's foam pads and the
shrine's lanterns) read `walk.since(k)` instead: a foam ring and a lantern kick now mean a real step, which is rare.

## Reach (the knees)

A leg's root-to-ankle distance d must stay between the folded and the straight: `|a - b| + fold <= d <= a + b - slack`.
Out of reach `limb` lays the chain straight (a snapped line); folded, it lies on itself. A new check
`limbsReach(limbs, { period, slack, fold })` (src/check.ts) scans every leg of the crab over its whole loop at 20 Hz
on the CPU, with slack 2% and fold 10% of the span (`tolerance.share`), and also asks that each knee stay outboard of
its root (a knee that crosses the root's line inward has folded under the body). It joins every variant's checks.

Predicted by hand for the base legs (roots 3.485 out at 1.25 up, ankle targets 1.6 above the feet, a + b = 7.8):
the mid legs are the longest reach, d = 6.56 (0.84 of the span), knee 114 degrees. The old taunt sway of 0.9 with
planted feet puts the far mid leg at d = 7.66 with the move's rise and roll: 0.98, a straight line. So the dance's
sway over planted feet is cut to 0.5 (0.935 at the worst instant): **the one place the motion is limited**. Sinking
never folds a base leg (the reach is mostly sideways). The stilt legs (a + b = 12.45, d = 8.56 at rest, 0.69) have
room either way; the spider crab's bow of 1.6 brings d to 8.14 and its knee up 3.3 over its root, still above its
body's top.

## The crab's choreography (rig.ts)

**Slam (Claw Crush; wind-up 1.15 s, strike 0.3).** Wind-up: the body sinks 0.35 and coils 0.45 away from the disc,
nose up (the old rear). Strike: the legs drive: it is thrown 0.6 toward the disc (1.05 from the coil), rising 0.3 at
the middle of the strike as the legs straighten, then lands at the old -0.25 and takes the old thud (-0.45 at
contact, springing at 2 Hz). Recovery: back to idle over the old settle (1.8 s).

**Grab (wind-up 0.9, reach 1.3, close 0.22, hold 3.1 of which the whip is the last 0.4, release 1.3).** Wind-up: it
sinks 0.2 and draws 0.25 away from the ship. Reach: it leans 0.5 toward the ship, sinking 0.15. Hold: it sits back
under the weight (0.2 behind its rest, 0.3 down) over the first 0.6 s, sinking 0.12 more at each squeeze. Throw: over
the carry it coils 0.3 away from the throw's direction; through the whip it drives 0.7 toward it, rising 0.2 (the
far-side legs push); it follows through and comes home over the release. The turn toward the left claw stays (yaw
0.14 by the posture).

**Taunt (lineup).** Feet planted, one stamp per accent; the body rises (`temper.rise` times the move) or bows (the
spider crab, -1.6), crouches 0.15 while in the taunt (deeper and held for the samurai: `n.stance.dance.crouch`, the
armoured legs' 0.45), sways 0.5 onto each side stepped to and rolls into it. Temperament is the taunt's own: the
fiddler's quick snap and twitch reach the body and its stamps (lead 0.15 s); the samurai snaps and holds dead still
for its 0.6 s hold, knees low; the spider crab's stamps are slow (0.7 s) and high (its 2.6 lift).

**Walk.** A game that moves the boss sets `legs.walking` to 1 while it moves (ramping over about one step) and
`legs.travelled` to the distance walked along the boss's own z (crabs walk sideways), moving `boss.at` by the same
distance along that axis. The feet then plant in the world and the body sways on the step. With the defaults the
crab stands.

## Predictions (to be scored)

| | Predicted |
|---|---|
| any foot off the water, single crab's idle stretch (14 to 22 s) | 3 of the loop's 4 re-plants fall in it: 2.25 s of 8, **28%** (whole loop: 3.0 s of 22, 14%; today 100%) |
| body over its feet in idle, `game` 1280x800 (about 27 px a unit at the body) | weight shift 0.35 side, 0.2 fore and aft, 0.3 more off a stepping foot: the body's origin wanders over a box about **20 x 12 px** |
| slam wind-up | sinks 0.35 (**9 px**), coils 0.45 back (**10 px**) |
| slam strike | thrown 1.05 toward the disc from the coil (**23 px**), drops 0.75 from the drive's top to the contact (**19 px**) |
| knee on the loaded leg (front right) | 111 degrees coiled to 88 at the contact: **23 degrees** |
| limbsReach, every variant, whole loop | passes; worst stretch 0.94 of the span (the lineup's dance) and about 0.86 alone |
| named checks | base, stilt, fiddler, fiddlerBaseDisc, mask 10 + 1; islander 13 + 1; bruiser 15 + 1; lineup 40 + 4 |
| seam | body and feet at t = 0 and t = loop identical on the CPU; the single crab's picture at 0 and 22 still differs where it always did (the sea's swells, 14.4 s and 8.6 s, are not periodic in 22) |
| frame time | unchanged within noise: the pose gains a few dozen per-frame scalars and loses the gait's |

Wrong if: a foot lifts in a brace or a dance outside an accent; a leg snaps straight; the slam's palm or the grip
check moves outside its tolerance (then the brace is too large, not the tolerance too small).

## Scored (2026-11-12)

Built as designed, on main 5ca6cfc (the spiral shell, the new faces and the curled white water merged in). Measured on
the CPU from the scene's own expressions (the islander unless named; `out/legs/tools/measure.ts`), pictures from the
`legs` and `game` cameras.

| | Predicted | Measured |
|---|---|---|
| any foot off the water, idle stretch 14 to 22 s | 28% (3 re-plants) | **36.7%**: 4 re-plants, at 15.73, 17.53, 19.33, 21.13 (feet L0, R3, L0, R3) |
| the same over the whole 22 s loop | 14% | **13.3%** (today 100%: two or three feet always up) |
| body over its feet in idle, `game` | about 20 x 12 px | **31 x 12 px** |
| slam wind-up | sinks 0.35 (9 px), coils 0.45 back (10 px) | sinks 0.44, coils 0.26 toward the disc's opposite: 12.9 px from rest |
| slam strike | 1.05 toward the disc from the coil (23 px), drops 0.75 from the drive's top (19 px) | **1.05** (0.26 back to 0.79 on), drops **0.68** (-0.11 at the strike's middle to -0.79 at contact); 37 px from rest at contact |
| knee of the loaded leg (front right) | 111 to 88 degrees: 23 | **110.8 to 92.5: 18.3 degrees** |
| limbsReach, every variant | passes; worst about 0.94 | passes; worst **0.960** (fiddler, its doubled idle at t = 21.3), mask 0.957 (the throw), stilt 0.762; knees at least 2.37 outboard |
| named checks | 10/13/15 + 1 | all pass: base 11, stilt 16, fiddler 15, fiddlerBaseDisc 15, mask 11, islander 14, bruiser 16 (main's new faces added checks; each includes `limbsReach`) |
| rear legs to the spiral shell (`tools/spiral_clear.ts`) | (not predicted) | R3 **0.32**, L3 0.47 (main's walk: 0.29, 0.47) |
| seam, body and feet at 0 and 22 | identical | **0 difference** (CPU) |
| frame time, base `game` 1280x800, alternated with main | unchanged | fast state 2.03 both (mine 1.97 to 2.10), slow 5.31 to 5.37 both; machine load average 9.5 (other workers) |

Where I was wrong:

1. **Re-plants are packed, not spread.** A step may start only where the crab is idle from its anticipation to its
   settle (1.8 s), which shrinks every idle window by that much: the loop's 10.8 s of idle hold 7.2 s of starts, 0.4 s
   of them in the short window between the throw and the slam. Four steps then sit at the minimum spacing (1.8 s) in
   the long window; I predicted three. The rate (`every` 1.8) is the number to change if it looks fidgety.
2. **The coil reads half its size** measured from the idle pose: the idle's own shift (0.35 to the side) is faded out
   by the posture over the same wind-up, so part of the coil cancels part of where the body was. The drive's 1.05 is
   exact because both ends are in the brace.
3. **The knee changes 18 degrees, not 23**: the slam's sink at contact is 0.79 (the old lean's -0.25 and the thud's
   -0.45 plus the idle's remainder), and the drive is along the disc's bearing from the ground origin, not along the
   front-right leg.

The lineup, loaded once: **44 of 44** checks (its 40 and a reach check per crab), and the frames at t = 0 and t = 24
the same picture (`e23ad2a3bea62948` both). Its loop leaves no idle time long enough for a re-plant, so in the lineup
the feet leave the water only on the taunt's stamps. The single crab at t = 0 and t = 22: body and feet identical,
picture not (`04ac520c5ad3d611`, `374a23ba357cc3f4`), because its sea's swells (14.4 s, 8.6 s) and the parts that call
`alive` without a period were never periodic in 22 s; that is not the stance's to change.

New base `game` hashes at 1280x800 (main 5ca6cfc, before: `00623051d0eb03ef 9ca615e4fe5b5b4c 322b7f7a5d7aa8c0`):
t = 1.0, 3.6, 11.3 are **`0c1b1e4368820ff8 0db3c25b4d11121b 2315edeb83c975e9`**.

What is weak or unfinished:

- The four idle re-plants sit at the minimum spacing in the second half of the idle stretch; a slower `every` gives two.
- Stamps and the hips' sway in the dance are hard to see from the lineup camera (each crab is a sixth of the frame);
  the bow and the crouch read, the stamps were not judged from a picture.
- The walk is built and paced by `legs.travelled` but no scene walks the crab, so it is unseen; a game that blends
  `legs.walking` in while a foot is mid-swing slides that foot.
- The brace never steps a foot wider at its start (the brief allowed either); the feet stay planted.
