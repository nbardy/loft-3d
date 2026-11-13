# Lively motion: the twelve principles, as Loft formulas

The principles are from Ollie Johnston and Frank Thomas, *The Illusion of Life: Disney Animation* (1981). The
summaries below follow the Wikipedia article "Twelve basic principles of animation", read on 2026-11-11. The helpers
are in `src/geom/lively.ts` (new) and `src/curve.ts`, `src/geom/motion.ts` (existing). All are pure functions of a
clock: they keep no state between frames, so they run wherever pose runs.

Use this when a monster moves correctly and still looks dead.

## The twelve

| # | Principle | What it says | In Loft |
|---|---|---|---|
| 1 | Squash and stretch | Weight and flexibility come from a form deforming as it moves. Volume stays the same: a stretch along is matched by thinning across | `squash(along)` gives a size that keeps volume. `stretchOf(speed)` is the length to wear in flight; `impact(after)` is the squash and spring-back at a stop |
| 2 | Anticipation | A move the other way first tells the audience what is coming | `anticipated(u)` dips before it drives. `beats(since, { anticipate, act, settle })` gives the wind-up its own beat. `response(t, { r: < 0 })` starts the wrong way |
| 3 | Staging | Present one idea so it is "completely and unmistakably clear": placement, light, camera, no needless detail | Not a formula. Check it: `minScreenSize`, the `game` camera's silhouette, one action at a time. See the checklist below |
| 4 | Straight ahead and pose to pose | Animate frame by frame for fluid action, or set key poses and fill between them for control | Formulas of time are straight ahead. `keys` and `through` are pose to pose. Use poses for the readable extremes and formulas for what flows between them |
| 5 | Follow through and overlapping action | Loose parts keep moving after the body stops. Parts move at different rates; trailing parts take time to catch up (drag). A still character keeps a little motion (the moving hold) | `swing(after, amount)` for what keeps going. `dragged(t, along, lag)` for the clock a trailing part reads. `alive(t, amount, seed)` and `breathe` for the moving hold (give `alive` a `period` where the motion must loop). `response` for a part that settles |
| 6 | Slow in and slow out | Things take time to speed up and to stop: more of the time is spent near the extremes | `slowInOut(u, power)`, `slowIn`, `slowOut` |
| 7 | Arc | Natural movement follows arcs; straight lines read as mechanical | `arc(a, b, u, lift)`. Prefer turning a part about a joint to sliding it |
| 8 | Secondary action | A smaller action supports the main one and must not distract from it | `echo(f, t, delay, gain)`: a later, smaller copy of the main motion |
| 9 | Timing | The time an action takes sets its weight and its mood: light things react fast, heavy things slowly | `beats`. Fewer seconds in `act` reads light and sharp; more reads heavy |
| 10 | Exaggeration | Stay true to the action and push it further than life | `exaggerated(x, rest, by)` |
| 11 | Solid drawing | Forms have volume, weight and balance. Avoid "twins": left and right sides that mirror each other look lifeless | `uneven(part)` gives each side its own factor. Offset the clocks of a pair with `alive(..., seed)` |
| 12 | Appeal | The character is interesting to look at, villains and monsters included. Hard-to-read faces lack it | Not a formula. See the checklist below |

## How to use them on a monster

Work through this in order. Each step is one or two lines in a scene.

1. **Give every action three beats.** For an attack, `const b = attack.beats(time, 1.2)`: the wind-up and the action are
   the attack's own `windup` and `strike` (and a hold's seconds), so they are stated once; only the settle is the
   body's. For anything else, `beats(since, { anticipate: 0.6, act: 0.15, settle: 1.2 })`. The wind-up should be several
   times longer than the action.
2. **Wind up the other way.** Drive the pose by `anticipated(b.anticipate)` so the claw rises before it falls and the
   neck pulls back before it strikes.
3. **Land with weight.** Stretch along the motion during `act` (`squash(stretchOf(speed))`), then `impact(b.after)` at
   contact.
4. **Let loose parts arrive late and keep going.** Read tails, whiskers, fins and weed on `dragged(time, m, lag)`, and
   add `swing(b.after, amount)`.
5. **Never hold still.** Add `alive(time, small, seed)` to every resting angle, with a different seed per part.
6. **Break the mirror.** Multiply one side's size, rate or angle by `uneven(side)`.
7. **Move on arcs.** Swing parts about joints; where a thing travels, use `arc`.
8. **Push it.** After it works, multiply the departures from rest by 1.3 to 2 with `exaggerated`, then look.

## Checklist for the two that are not formulas

**Staging**
- From the `game` camera, is there exactly one thing the eye goes to?
- Does the action read in silhouette, with paint switched off?
- Is the warning visible before the action starts, and nothing else moving at that moment?

**Appeal**
- Can the face be read at the size it will be seen?
- Does it have one temperament that every feature serves?
- Is anything on it symmetrical that need not be?

## Expressions

`src/geom/expression.ts`; the worked face is `examples/bosses/titan/face/dandy.ts` (the Reefback Titan's `islander`
variant). Use it when a face has more than two states. Mixing each lid and stalk from envelopes inline works for
"roused" and "braced"; with six moods it stops being readable, and nothing can check it.

1. **Name the channels**: what the face is drawn from, as a string union. A channel is whatever one number can
   drive: how far a lid is down, a stalk's height, a pupil's size, how far the look has gone from one target to
   another. The library gives them no meaning; the face that draws them does.
2. **Write the cast**: `cast(rest, { glare: { upper: 0.9, slant: 0.7 }, ... })`. The rest expression gives every
   channel a number; each named expression lists only what departs from rest. Expressions are plain numbers, so they
   can be printed, compared and predicted from before anything is drawn.
3. **Write the score**: `score(cast, (t) => [show("glare", w1), show("wince", w2), only("wince", ["upper", "lower"],
   blink), added({ jaw: chatter }, w3)])`. Layers apply in order, later over earlier. `show` takes the whole face
   toward an expression, `only` some channels (a blink), `added` adds on top (a tremble). The weights are yours:
   closed forms of the clock `t`, from an attack's beats and envelope or from `during(clock, { from, to, rise, fall })`.
4. **Draw from it**: `score.at(time)` is one closed form per channel. A part that should arrive late reads
   `score.at(sub(time, lag))`: one eye 0.14 s behind the other is one argument. Tabulate each channel once a frame
   (`perFrame`) if paint reads it.
5. **Check it**: `expressionsRead(score, marks, { camera, period, apart, of })` (src/check.ts). Marks are the drawn
   vectors a viewer compares (an eye's middle to its lid's edge, a stalk's root to its tip), built from the same
   expressions the parts are. The check fails if a named expression never shows in a cycle (a later layer always
   covers it) or if two of them are the same picture from that camera (no mark changes by `apart`, a share of the
   reference mark's length on screen). `minScreenSize` is the other half: the eye is large enough to carry it.

What the crab's face found (docs/art_direction/DIRECTION.md, Round 3):

- From a high camera, where a creature looks is invisible if the eye turns all the way to its target: the pupil goes
  round the far side. Turn the socket part of the way and slide the iris the rest.
- A lid in the body's own ink disappears on the body: a shut eye was a dark ball. Give lids an ink that differs from
  both the white and the body.
- The stalks' pose is the largest thing that changes, so it carries the most from far away; lids next; pupils last.

What its second face found (Round 4: `examples/bosses/titan/face/brow.ts`, a head with brows, sunk eyes and a mouth; its
parts are in `examples/bosses/lib/face_parts.ts` for any creature):

- A lid's angle is not its cover. Seen from in front, a lid `a` radians down from the top of the eye hides
  (1 - cos a) / 2 of it: 0.64 of a quarter turn hides 23%, and "half-lidded" is 1.3 to 1.5 rad.
- A brow that rides the eye must still face the viewer. Lying on the eye's own slope a raised brow shows its edge (11 px
  where the same bar facing front is 19).
- An eye sunk in a head cannot turn. Put the iris truly under the look while the look is in front of the eye and hold
  it at the rim past that (`gazeOf`): it rolls to its corner after a ship thrown behind its ear, and still shows iris.
- A blink is an `only` layer, so the check does not see it: `expressionsRead` takes rest in the middle of its longest
  stretch, and a blink timed there has rest measured with its eyes shut. Time blinks off that instant.
- A face is hidden by what stands in front of it. `staysInView(points, blockers, { camera, period, hidden })` says for
  how long; the islander's banner claw stood over this face's right eye for 2 s of the Grab from the game camera.

What its third and fourth found (Round 4: `face/jitter.ts`, the fiddler's, and `face/mourner.ts`, the spider crab's;
their eye is `examples/bosses/lib/stalk_eyes.ts`):

- The marks must be the expression's pose alone. A stalk that swings or an eye that wanders moves its marks by more
  than an expression does, and the check would then tell two expressions apart by where the swing happened to be. Give
  `stalkEye` the posed stalk, look and lids (`posed`) beside the drawn ones.
- A shut eye's lids must meet at its middle line. Met lower, the lash line is under the ball and a shut eye is a plain
  ball from above (the islander found it; both of these faces repeated it on the eye that flinches).
- A kink fore and aft does not show from in front. A stalk's recoil is sideways: bowed out, the tip curled back in.
- Two eyes on stalks need more room than their roots suggest: from a camera 40 degrees up they overlapped at 1.5
  apart with 0.7 radii. Measure the pair, not each eye.

## Stalks and hanging things

**A stalk that bends by a pose**: `bent({ root, along, a, b, length, lean, bow, crook, sharp })` (`src/geom/bend.ts`).
A stalk posed by where its tip is can only reach, and stretches as it leans. Here the pose is the bending: three turns,
each two angles (toward `a`, toward `b`): `lean` tips the whole stalk at its root, `bow` bends it near the root, `crook`
near the tip (`sharp` gathers the crook toward the tip: 2 by default, 4 a hook). The stalk keeps its length and its
stations stay evenly spaced, so a strand on it neither stretches nor swells; `tip` and `tipHeading` say where it ends
and which way it points there. Bow one way and crook the other for an S; read `crook` a tenth of a second behind `bow`
for a whip. `bentTip` is the same in plain numbers, for a theory. A strand's thickness answers a change of `length` by
itself (its volume is kept against the spine at time 0): a stalk drawn in short is thicker.

**A hanging thing's swing**: `pendulum({ length, gravity, damping })` (`src/geom/pendulum.ts`) gives `period` and
`answer(t, drives)`, the angle from plumb as the sum of its answers to what moves its pivot:

- `sway(amplitude, period)`: the pivot sways for ever (a walk). The answer is the driven oscillator's steady state: near
  the pendulum's own period the swing is wide and a quarter turn late. `gain(period)` gives the numbers in plain form.
- `jolt(after, speed)`: the pivot's velocity changed at an instant (a slam, a snatch). The bob is left behind and
  swings on, dying away by the damping.

Nothing is keyed: how fast it swings follows from its length and the world's gravity, how far from how hard its pivot
was moved. It needs the instants of the jolts and the phase of the sway as closed forms; where a rig gives neither (a
taunt's accents, a walk started ahead of the scene's clock), say so and add the slow tilt by hand.

## Temperament

A temperament is how a creature moves between and into its actions, and most of it is three numbers per part: how late
it reads the score (`score.at(sub(time, lag))`), how long a weight takes to rise (`during(clock, { rise })`), and what
it does when nothing is happening.

- A nervous creature is still, then somewhere else: `dart(t, { every, snap, period, seed })` (`src/geom/restless.ts`)
  says which hold it is in, which it came from and how far the jump has gone (it overshoots), at uneven intervals that
  still loop in `period`. `chosen(hold, seed)` picks what a hold means (one of a list of places to look). Give each part
  its own seed and they move separately. `tremor(t, hz, seed)` is the shake to lay over it; gate it in bursts.
- A slow creature reads the score late (0.2 to 0.5 s), lets a mood come on over a second or more, and lets what hangs
  from it do the moving (`pendulum`).
- Make stiffness a channel. Rage that holds a hanging thing rigid, and grief that lets it swing, are one number.

### Poses struck and held

`src/geom/struck.ts`; the worked face is `examples/bosses/titan/face/mask.ts` (the samurai crab). Use it for a
character whose expressions are few, large and held (kabuki's mie): it snaps into a pose in a few frames, holds it
dead still, then lets it go. Beside characters that flow, the stillness is the character.

- `struck(clock, { from, snap, hold, release })` is one weight for a `show` layer. From the cue (`from`, on any clock:
  an attack's `tau`) it first goes the wrong way (anticipation: below 0, so the face leaves the pose it is about to
  strike, in every channel at once), arrives at speed and stops in one frame; through the hold it is exactly 1; the
  release eases. It also gives `still` (1 through the hold) and `since` (seconds since the pose arrived: the beat
  loose parts swing from).
- **Stillness is an order of layers, not a switch.** A `show` at weight exactly 1 replaces every channel with the
  expression's own number. Lay what flows (a blink, a tremble, a moving hold) first and the struck poses after it: a
  held pose then covers them. A pose struck over another before its release covers the release.
- A struck face reads its score on one clock: a part that reads it late strikes late, and a mie lands on one beat.
- `holdsStill(score, { pose: struck, ... }, { period, within })` checks it: through each hold every channel is the
  cast's own number. It fails if a layer laid after a pose moves under it or if a pose is never held.

## Grabs

`src/geom/grab.ts`, shown in `examples/grab.ts`. A grab is one clock and four beats: reach, close, hold, release. In a
scene with a game, make it an attack instead (`motion: { kind: "grip", ... }`, `effect: hold(...)`; see
`docs/attacks_that_hold.md` and the Reefback Titan): the attack owns the beats, the warning, the held thing's place and
size (`held()`, `thing()`, `squeezed()`), and `attack.grip(rest)` gives the same palm and gap as `grab`.

- `grab(since, { rest, from, to?, radius, squeeze, pulses, ... }, beats)` gives the palm's place, the `gap` between
  the gripping surfaces, the held thing's place, its squeezed size and a `held` flag. The gap follows the thing's
  `radius`: it opens to the thing's width plus a margin by two thirds of the reach, closes to the width, and narrows
  by `squeeze` on each pulse. The thing's place and radius may be host inputs, so one formula takes any ship.
- A squeezed thing keeps its volume: narrowed to k across the grip, it grows by 1 / sqrt(k) the other two ways.
- `windup` makes the gripper draw back from the thing before it reaches.
- A gripper is whatever turns `gap` into a pose. `fingerAngle(gap, length)` is the angle for a claw's two fingers or
  a jaw; `pincerAngle(gap, length)` is the opening of a pincer with one fixed finger (a crab's claw). `wrap({ centre, axis, radius: gap / 2 + body, length, pitch })` is a coil whose number of turns follows from
  the body's length, so it goes round a small ship more times than a large one and gains turns as it tightens.

A whole ship takes the same size: `ship.placed(chart, wind, grab.squeezed(1, "z"))` squeezes hull, sails and rigging
across the beam as one, and `shifted(chart, offset)` lifts it off the water it floats on (`sized` and `shifted` in
`src/map/chart.ts`). Spars keep their thickness.

A grab may end in a throw: `end: thrown({ land, flight, gravity, stroke, follow, drag, heave, placer })` on the hold
(or on `grab`'s spec). The carry then ends at the wind-back place, the thing is whipped to its release velocity, flies,
lands and bobs, all inside `thing`; the gripper follows through. `tumbled(frame, axis, turns, u)` turns it in the air.
See `docs/throw_and_shove.md`.

`gripReaches(attack, [fingerA, fingerB], { middle, gap })` (src/check.ts) checks the drawn fingers: at the closing
instant and through the hold, the points of their surfaces nearest the thing's middle must be centred on it and the
thing's width apart. It measures surfaces, not finger axes or tips: the gap is between surfaces, so a finger's axis at
the contact must stand its radius further out. `warned(attack)` checks the warning starts before the motion does and
covers where the thing is taken.

## What is not here yet

- Checks for these principles (for example, that an action's wind-up is longer than its action).
