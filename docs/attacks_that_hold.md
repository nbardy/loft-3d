# Attacks that hold

Written before the code (2026-11-11), then scored against it (last section). The code is `src/spacetime/attack.ts`
(the schedule, the effect, the grip motion), `src/geom/grab.ts` (the formulas) and `src/check.ts` (`gripReaches`,
`warned`).

## What an attack is, as a function of the clock

An attack is one arming instant T per cycle (`once`, or `every` period) and a set of intervals placed round it. All of
them are numbers on the attack; nothing else states them.

```
warning    [T - warn, T)                   the telegraph sharpens; the game may show danger
wind-up    [T - strike - windup, T - strike)  the body coils into the attack's posture (p rises 0 -> 1)
strike     [T - strike, T)                 the part travels; at T it lands (a lunge) or closes (a grip)
effect     [T, T + D]                      the attack acts on its target. D = 0: an instant. D > 0: a hold
release    (T + D, T + D + R]              the part lets go of what it held and goes home (R = 0 for a hit)
settle     after T + D + R                 the posture lets go (p falls), loose parts catch up
```

What the game needs to read is the warning (its start and T: the telegraph already reads them), whether the attack is
acting now, and, while it holds something, where that thing is and what size it is. The game owns gameplay, so all of
this must be closed forms of the clock and of host inputs, which is what the library already makes.

## Instant and hold: one idea, two variants

The general thing is an **effect over an interval** [T, T + D]. An instant hit is the D -> 0 limit: it acts at T and
owns nothing afterwards. A hold acts for D seconds and **owns the place and size of its target** during them: before T
the target is where the game put it; from T the attack says where it is; after T + D it is where the attack let it go
and the game owns it again. A grab (lifted and carried), a swallow (carried into a mouth), a beam that pins (carried
nowhere), a whirlpool that drags (carried round a spiral) are all holds; they differ only in the carry.

They stay two variants of a sum type rather than one record with D = 0, because they differ in what they own (a hold
has a thing with a place and a size; an instant has none) and in what can be checked about them:

```ts
type Effect = { kind: "instant" } | Hold
type Hold = { kind: "hold"; seconds: D; at; radius; carry: Carry; squeeze; pulses }
type Carry = { kind: "arc"; to; lift; up } | { kind: "path"; offset(u) }   // u in [0, 1] over the hold
```

`at` is where the thing is taken (its middle) and `radius` its half width across the grip. A hold's readouts, for any
motion, are on the attack and take the clock (`time` by default):

- `held(t)`: 1 on [T, T + D), else 0. The game's "this ship is held".
- `thing(t)`: `at` before T, carried during the hold, the carry's end after.
- `crush(t)` and `squeezed(base, across, t)`: the squeeze, volume kept (1 / sqrt(k) the other two ways).

Body attacks (lunge, sweep, rear) keep the instant effect: their posture formulas stop at the target and do not follow
a carry. A remote attack may hold (a whirlpool's drag is a remote hold with a path carry). The new motion, `grip`,
requires a hold: a gripper is a motion that reaches for a thing, follows it while it holds it, and lets it go. It is not
a grab special case on the attack: the attack knows only that its effect holds something; the grip motion is one way of
posing a body part that follows a held thing, as the lunge is one way of posing a part that stops at a hit.

The grip motion maps the attack's own timing onto the grab's four beats, so the seconds have one source:

| grab beat | from the attack |
|---|---|
| (wind-up: claw raised into posture) | `timing.windup`: the posture p rises, as for every body attack |
| reach | `timing.strike - motion.close` |
| close | `motion.close` |
| hold | the effect's `seconds` |
| release | `motion.release` |

`attack.grip(rest)` gives the gripper (`palm`, `gap`) as `grab` does; like `BodyAttack.pose(rest)` it takes its rest
place when posed, so a scene can define the attack before the body whose frame the rest rides on.

## Beats from the attack

`attack.beats(t, settle)` returns the beats on the attack's own clock: `anticipate` over the wind-up, `act` over the
strike, `hold` over the effect, `release` over the motion's let-go, `settle` over `settle` seconds after it, and
`after`, seconds since the release ended (since T for a hit: what `impact` and `swing` read). (Since 2026-11-11 there
is also `flight`, over a thrown thing's time in the air, and for a hold that ends thrown `settle` and `after` begin
when the thing has landed if that is later than the end of the release: the action is not over while its prize is in
the air. `docs/throw_and_shove.md`.) A scene states the seconds
once, in the attack.

## Checks

- `gripReaches(attack, [fingerA, fingerB], { middle, gap })`: at the closing instant, and at every sampled instant of
  the hold, the point of each drawn finger's surface nearest the thing's middle is found; the grip's middle (between
  the two) must be within `middle` of the thing's middle, and their distance apart within `gap` of the thing's width
  (times its crush, while squeezed). It binds to the drawn fingers, so it measures the claw the audience sees, not the
  abstract grip (which matches by construction).
- `warned(attack)`: the warning starts no later than the motion's first movement (`warn >= span.before`), and, for a
  hold, the thing's footprint where it is taken (a disc of `radius` at `at`) lies inside the warned hit shape.
- Tolerances are values: `tolerance.units(x)` or `tolerance.share(f)` (a share of the reference the check names: the
  thing's width for `gripReaches`). No check takes a bare number for a tolerance.

## The crab, predicted

Before: a remote attack carrying only a disc and an arming time; `GB`, `grabEnd`, `grabSince` restating the reach,
close, hold and release seconds; `grabOn` blending a 0.9 s wind-up in by hand; `crushBeat` restating Claw Crush's 1.15
and 0.3; a 16-line scene-local `gripReaches` check.

After, predicted:

- The grab is `attack({ motion: { kind: "grip", ... }, effect: hold(...) })`. `GB`, `grabEnd`, `grabSince` and the
  hand-made `grabOn` blend disappear: `grabOn` is the attack's posture `envelope(time).p`, the eye, the home swing and
  the ship's slip back read `grabAttack.beats(time, ...)` and `span.after`. `crushBeat` becomes `crush.beats(t, 1.8)`.
- The scene-local check is deleted. Checks: `landsInside(crush)` (as before), `warned(crush)`, `warned(grab)`,
  `gripReaches(grab, cutter fingers)`: four, all from the library.
- The game reads `grabAttack.held()`, `grabAttack.thing()`, `grabAttack.squeezed(1, "z")`; the scene draws the ship from
  the same three (it exports `holds = { grab }`).
- `windup` (the grab's draw-back) fits and is used: the reach leaves backward and arrives at speed. `pincerAngle` does
  not fit this claw: its two fingers are separate horns hinged apart on the palm (0.41, measured) and curled, and both
  close symmetrically so the grip's middle stays on the palm's axis. `pincerAngle` is one hinge and one fixed straight
  finger: on this claw it ignores the distance between the hinges (the tips would stand about that much further apart
  than asked) and moves the grip's middle off the axis as the dactyl closes. `fingerAngle` with its `hinge` argument is
  the right formula.
- Look: the same beats and the same places, so the frames at the same times should match except the reach, which now
  dips backward first and arrives faster (`anticipated` instead of `slowInOut`), and the posture's let-go, a critically
  damped return of about the same length instead of a 1.1 s ease.

## Scored

Built as designed, with one change: carries are written as data (`carry: { kind: "arc", to, lift }`), because the
library already exports a `carry` (src/map/chart.ts).

- Lines: as predicted, `GB`, `grabEnd`, `grabSince`, the hand-made `grabOn` blend, `crushBeat`'s restated seconds and
  the scene-local check are gone; the scene's code lines go from 574 to 566, the grip attack's spec and two library
  checks included. No second of the grab is stated twice: `S.grabSeconds` feeds the attack, and everything else reads
  the attack (`envelope(time).p`, `beats(time, 1.5)`, `span.after`).
- Checks: four, all library, all pass: `landsInside(crush)`, `warned(crush)` (warns 1.50 s, moves 1.47 s before),
  `warned(grab)` (warns 3.00 s, moves 2.42 s; the ship's footprint 2.63 inside the disc), `gripReaches(grab)`.
- The prediction missed once, and the miss was in the claw, not in the library. I predicted the drawn fingers would
  close within 10% of the beam because the old check passed. `gripReaches` measured the surfaces 1.02 apart on a 1.19
  beam: the fingers sank 0.085 into the hull on each side. The old check measured the tips' axes (1.09 apart) against a
  0.2 tolerance and could not see it. Two errors in the scene's own geometry, found by measuring the parts: (1) the
  gripping surface is a finger's skin, not its axis, and not at the tip: the hull's middle meets each horn at m = 0.85
  (chord 2.315 at -0.366 rad, radius 0.138), so those axes must stand the gap plus 0.276 apart; (2) the hinges were
  derived as 0.509 apart but are drawn 0.407 apart, because at m = 0.88 the palm's rounded tip narrows its section by
  sqrt(1 - (0.18 / 0.3)^2) = 0.8. With both, the station axes are predicted 1.466 apart and measured 1.469; the
  surfaces close 1.18 apart (beam 1.19), middle 0.07 off (the axes' middle is on the hull's to 0.000), and the
  worst instant over the hold is the closing one.
- The game reads `holds.grab.held()`, `.thing()`, `.squeezed(1, "z")`, closed forms of the clock; the ship is drawn
  from the same three.
- Look (sheets `out/hold/{before,after}_{grab,game,reach}.webp`, same cameras and times): identical at every sampled
  instant outside the reach, the ship 0.06 nearer the crab. In the reach the claw now stays cocked high and back until
  about 10.7 s and drops onto the ship in the last 0.4 s, where it used to sink steadily from 10.1 s: a clearer
  wind-up before a faster action. The posture's critically damped let-go is not distinguishable from the old ease at
  these times.

## What it still cannot express

- A body attack (lunge, sweep, rear) that holds: a bite that keeps its prey, a coil that pins. Their posture formulas
  stop at the hit; following a carry needs a "follow the held thing" term in each, which the grip motion has and they
  do not.
- An effect that lasts without owning its target (a breath weapon that burns for two seconds): a third variant,
  `lasting { seconds }`, would be the honest way; nothing needs it yet.
- A gripper other than two-sided: `gripReaches` measures two fingers; a coil (`wrap`) or a swallowing mouth needs its
  own check.
- After the hold the game owns the thing again; the crab's ship slipping back to where it was taken is scene art.
  (Since 2026-11-11 a hold may end thrown, and the crab's does: `docs/throw_and_shove.md`. `thing(t)` then covers the
  flight and the landing, or the host's own boat from the release; the slip back is gone.)
- The telegraph flashes at the arming time and fades, as for a hit; nothing marks the thing as held on the water.

