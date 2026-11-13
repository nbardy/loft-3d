# The throw and the shove

Written before the code (2026-11-11) and committed; scored against the built scene in the last section. It extends
`docs/attacks_that_hold.md`: a hold may end in a throw, and an attack may leave a wave on the water that shoves what
floats. The scene is the Reefback Titan (`examples/bosses/reefback_titan.ts`).

## One rule: velocity is continuous at every hand-off

A thing changes owner four times in a throw: the grip takes it, the stroke accelerates it, the air has it, the water
takes it back. The rule is that its velocity is the same on both sides of each hand-off. Everything else follows.

1. **Carry to stroke.** The carry (the lift and the squeeze, as today) ends at rest at the wind-back place W.
2. **Stroke.** Uniform acceleration from rest for sigma seconds along the release velocity v0:
   `p(tau) = W + v0 tau^2 / (2 sigma)`. It ends at the release point `P = W + v0 sigma / 2` moving at v0. Inherited:
   constant acceleration is the least peak force for a given stroke length and release speed (and the fastest stroke
   under a force limit), so it is what a grip that must not lose its prize would do.
3. **Flight.** Ballistic: `p(s) = P + v0 s - g s^2 / 2` (inherited). The scene states where the thing is drawn back to
   (W: it is where the carry ends, so `carry.to` keeps its meaning), where it lands (L) and for how long it flies (T).
   Then, since `P` depends on v0, solving `L = W + v0 (T + sigma / 2) - g T^2 / 2` gives the closed form

   ```
   v0 = ((L - W) / T + up g T / 2) / (1 + sigma / (2 T))        P = W + v0 sigma / 2
   ```

   Nobody states the release point or the release speed: they follow from the wind-back, the landing and the flight
   time. The wind-up is the carry's end, behind the release point along the throw, for free.
4. **Touchdown.** The water is a drag and a spring, and it too receives the thing at the thing's velocity. Horizontally
   a linear drag with time constant tau_d: `x = L + vh tau_d (1 - exp(-s / tau_d))`, so it skids `|vh| tau_d` and stops.
   Vertically a damped heave of frequency f and damping zeta about the floating height, started with the touchdown's
   downward speed vd: `y = L.y - (vd / wd) exp(-zeta w s) sin(wd s)`. The depth of the plunge and the length of the
   skid are therefore not art numbers: they follow from how it lands. (Mine: I have not seen the landing treated as
   one more velocity-continuous hand-off; the usual form is a squash keyed at contact.)
5. **The gripper** follows through from P along v0, decelerating uniformly to rest over rho seconds (it travels
   `v0 rho / 2` more), opening as it goes, then goes home.

The tumble is a rigid turn about one axis at a constant rate, a whole number of turns over the flight, so the thing
lands upright. Its rate starts at the release (a flick of the fingers): this is the one place the rule is not kept,
because the claw's palm does not turn.

Gravity is one number for the world: **g = 5 units/s^2**. If a unit is a metre that is half of Earth's; if the sloop
(3.8 units) is a real 19 m ship it is 2.5 times Earth's. It is slow enough that the flight hangs for 2.6 s and the crab
reads as large, and fast enough that the stroke (0.5 s) still reads as a whip.

## The wave uses the same gravity

A ring wave from the slam. The sea here is shallow: the crab stands on the bottom, 1.7 below the surface
(`S.floor`), and the pulse is longer than that, so it is a shallow-water wave: it does not disperse, and its speed is

```
c = sqrt(g depth) = sqrt(5 x 1.7) = 2.92 units/s
```

(inherited: Lagrange's shallow-water speed; mine: taking g from the throw and the depth from the crab's own floor, so
the wave's speed is not a free number). Its energy spreads round a growing circle, so its height falls as
`sqrt(R / r)` (inherited). The front leaves the disc's edge at the slam, so it reaches distance d at `(d - R) / c`,
and ahead of the front the water is exactly as it was.

```
rise(r, tau) = H sqrt(R / max(r, R)) P((R + c tau - r) / W) fade(r)        P = 0 outside (0, 1)
```

P is one crest and the trough behind it, C1 at the front; `fade` takes it to nothing at `reach`.

**The shove.** What the wave gives a floating thing is an impulse when its front arrives: a change of velocity,
outward, in units per second,

```
impulse(x) = n  J(d)        J(d) = (D0 / tau_w) sqrt(R / max(d, R)) fade(d)        delivered at tau = (d - R) / c
```

for a thing whose place is x (distance d from the centre, outward unit n). The impulse is proportional to the local
height of the wave. Loft's stand-in for a boat takes that impulse under a linear drag of time constant tau_w, the
same law as the thrown ship's skid:

```
pushed(x, tau) = impulse(x)  tau_w  (1 - exp(-s / tau_w))        s = max(tau - (d - R) / c, 0)
```

so it ends `D(d) = J(d) tau_w = D0 sqrt(R / d)` outward, and it is exactly 0 until the front arrives. It is a closed
form of the clock and the thing's own place. The constructor refuses a ring whose impulse at the disc's edge,
`D0 / tau_w`, exceeds c (mine: a thing cannot be pushed faster than the wave that pushes it). The thing's height and
heel are not animated at all: a boat placed with `afloat` at `x + pushed` reads the sea's height there, ring
included.

(As first committed, the shove was an eased displacement over a `ride` time. It was replaced before any picture was
judged, when the owner asked that a game be able to run its own boats: an eased displacement sampled at a boat's own
moving place is not the same motion as one sampled at its starting place, so "the field" and "the stand-in" would
have disagreed. An impulse is delivered at one instant at one place, so a game that adds it to its boat and applies
the same drag gets the stand-in's motion exactly. The final offset is unchanged, D0 sqrt(R / d).)

**Why an aftermath and not a third effect.** The effect says what the attack does to its target and what it owns
(nothing, or a held thing). The wave is what it does to the water, and any effect may have one. As a third `Effect`
variant, "instant with a wave" would have to repeat the instant's handling in every dispatcher and a hold could not
have a wave at all. So it is a second sum type beside the effect: `Aftermath = still | ring`, one dispatcher.

**Cost.** The ring is a `SeaDeform` whose `reaches` is the live annulus (between the front and the tail, after the
slam, inside `reach`): it is false everywhere when no ring is running, so the sea's deformed cases run on no pixel
then, and on the annulus only while it runs.

## The crab, predicted (base variant)

The loop is 18 s (was 16): the Grab closes at 3.0, Claw Crush arms at 11.5. Both boats jump back to their places at
the loop's seam (t = 0), where both attacks are over. Every place below is the default of a host input (see "The
contract"); the numbers are the standalone show's.

**The throw.** The sloop is taken at (10.49, 0.25, -8.40), 13.4 from the crab's middle. The carry draws it back 2.7
along its keel, 0.9 to starboard and 2.15 up, to W = (9.13, 2.40, -5.90), in 2.6 s (two squeezes); the stroke is
0.5 s; it lands at L = (5.70, 0.25, -21.00) after T = 2.6 s. That landing is the farthest open water from the crab
that the `game` camera shows with the mast in frame (its far right corner): radially outward the frame ends 6 units
from where the ship is taken.

| Quantity | Predicted |
|---|---|
| release velocity v0 | (-1.20, 5.18, -5.30), speed 7.50, 43.6 degrees up |
| release point P | (8.83, 3.69, -7.22), 1.88 along the stroke from W (acceleration 15.0) |
| flight | 2.60 s, released at t = 6.10, touchdown at t = 8.70 |
| apex | y = 6.37 (6.12 above its floating height), 1.04 s after the release |
| distance flown (horizontal, P to L) | 14.13 |
| touchdown speed | 7.82 down, 5.43 along |
| plunge (heave 0.9 Hz, damping 0.45) | 0.79 below floating height 0.22 s after touchdown, then 0.16 above |
| skid (drag 0.2 s) | 1.09, to rest at (5.46, -22.06) |
| where it ends | 22.4 from the crab's middle (3.4 carapace lengths of 6.6), 14.6 from where it was taken |
| the claw | follows through 1.13 past P in 0.3 s; the grip's middle stays within 4.3 of its arm's centre (span 4.9) |

**The wave.** R = 3.4, H = 0.8 at the disc's edge, W = 6, reach 16. Boat two floats 7.5 from the disc's centre at
(14.38, -0.18), outside the disc, broadside to the ring.

| Quantity | Predicted |
|---|---|
| wave speed | 2.92 |
| front reaches boat two | 1.41 s after the slam (t = 12.91) |
| crest height at boat two's place | 0.54 |
| impulse at boat two (D0 = 4.6, drag 1.6 s) | 1.94 units/s outward (0.66 c); at the disc's edge 2.88 (0.99 c) |
| boat two's final offset | 3.10 outward; 2.98 of it by the loop's seam (5.1 s after the front) |
| before the front | pushed and rise exactly 0 |

From the `game` camera boat two moves about 117 pixels at 1280 x 800, a little more than its own length on screen.

**Checks.** All five variants pass, with the throw written in the ship's own axes (keel, starboard, up) so each
variant's ship is drawn back relative to where its own claw takes it: `thrown` (velocity continuous at the release,
above its floating height until touchdown, lands where and when stated, travels at least 12), `fliesClear` (the flying
ship keeps clear of the carapace and the atoll), `gripReaches` over the hold including the stroke, `shoves` (boat two
ends at least 2.5 out) and `frontFirst` (nothing at boat two moves before the front). (As built the first is two
checks: `releasesAt`, the hand-off, which holds whoever flies the ship, and `throwLands`, the stand-in's flight.)

**GPU frame time** (`game` camera, 1280 x 800). Priced first by removal: the scene without its ship is 0.26 ms
faster in the slow clock state (4.46 to 4.13 median, 14 paired rounds), so a ship is about 0.3 ms slow, 0.1 ms fast.

| | Predicted change |
|---|---|
| second ship (25 draws) | +0.30 ms slow state, +0.10 ms fast |
| the ring while no ring runs (t = 1): one distance and three compares per sea pixel, one `rise` per sea vertex | +0.00 to +0.07 (one tick) |
| splash foam, new frame tables | under one tick |
| **normal frame at t = 1** | **+0.3 ms slow (4.46 to about 4.8), +0.1 ms fast (1.75 to about 1.85): +7%** |
| while the ring runs (annulus up to a third of the sea's pixels in the deformed case) | a further +0.15 ms slow, +0.05 fast |

Wrong if: any of the closed-form numbers above is off by more than 1%; the frame at t = 1 rises by more than 0.45 ms
(slow) or 0.17 ms (fast); a variant fails a check with these numbers.

## The contract: what a game sets, what it reads, who owns a boat when

The scene plays on its own, and it is also the picture of a game that owns its boats. Both read the same things.

**Who places a boat is a sum type** (`Placer`, src/geom/placing.ts): `standIn` (a closed form of Loft's, so the scene
plays with no game) or `host` (the game passes the boat's pose every frame and Loft draws it there). It is classified
once, by the design's `boats` slot (`base` is the stand-ins; `--variant boats=host`), and `placedBy` is its one
dispatcher. While the Grab holds the first boat it is the crab's in both.

| When | First boat (the Grab's) | Second boat (under the wave) |
|---|---|---|
| before `grab.arm` | its placer's: afloat at `boat1.at`, or the host's pose | its placer's, always: afloat at `boat2.at` plus the stand-in's drift, or the host's pose |
| `grab.arm - 0.22` to `grab.arm` (the grip closes) | blended from its placer's frame into the socket | |
| `grab.arm` to the release (3.1 s) | the crab's: the socket | |
| from the release | its placer's at once: the stand-in's flight, landing and bob; or the host's pose | |

**Inputs** (`--input name=value`; a vector is `x,z` or `x,y,z`). Units: world units, radians, seconds on the scene's
clock. The defaults are the show.

| Input | Meaning | Default (base) |
|---|---|---|
| `grab.arm` | when the Grab's grip closes; it repeats every 22 s from there | 3.0 |
| `crush.arm` | when Claw Crush lands | 12.0 |
| `crush.centre` | the slam's disc on the water (x, z); its radius is the variant's number | 9.6, 5.6 |
| `boat1.at` | where the first boat floats when the Grab arms (x, z). Hold it fixed from the warning to the release | 10.49, -8.40 (each variant's own: where its claw reaches) |
| `boat1.heading` | its heading then, radians from +x toward +z. The claw comes along it | -0.75 |
| `boat1.beam` | its width across the grip: the grip opens and closes by it | 1.19 |
| `throw.land` | where the throw is aimed to land (x, z). The release velocity follows from it | -1.0, -35.0 (far; 4.3, -19.6 is the farthest the `game` camera shows whole) |
| `boat2.at`, `boat2.heading` | (stand-in only) where the second boat floats when Claw Crush arms, and its heading | 10.78, 0.33 (2.0 beyond the disc's edge); -0.5 |
| `boat1.pose.at`, `.heading`, `.pitch`, `.heel` | (`boats=host` only) the first boat's transform, every frame: its origin (waterline amidships; x, y, z), heading, pitch (bow up), heel (to starboard) | its start, level |
| `boat2.pose.at`, `.heading`, `.pitch`, `.heel` | (`boats=host` only) the second boat's | its start, level |

No formula holds a boat's place as a constant: the warning, the reach, the grip, the wind-back, the throw, the splash
and the shove are expressions of these. A game is trusted to arm the Grab only where the claw reaches (the arm spans
4.9 from the shoulder; `gripReaches` measures the default).

**Readouts** (closed forms exported by the scene module as `handoff`, `holds`, `waves`; a host evaluates them on the
CPU each frame, as the checks do).

| Readout | Is | Units |
|---|---|---|
| `handoff.held` | 1 while the crab has the first boat | - |
| `handoff.socket` | the boat's frame while held: origin (its waterline amidships), bow x, mast y, starboard z. Level, at the heading it was taken at, until the throw's stroke; over the stroke the hand turns it toward the release velocity (see "The ride", the grip) | world |
| `handoff.squeeze` | its size along its own x, y, z while held (narrowed across the beam, volume kept) | factors |
| `handoff.release.time`, `.at`, `.velocity` | the instant the grip lets go, and the boat's place and velocity then. A game's physics takes the boat from exactly here | s; world; units/s |
| `handoff.release.spin` | the boat's angular velocity at the release (a vector: radians per second about its direction): the hand's own, which the stand-in's tumble carries on unchanged | rad/s |
| `handoff.landing.time`, `.at`, `.rest` | where and when the stand-in's flight lands and stops: a prediction under g = 5 and a flight of 3.2 s for a host that flies its own | s; world |
| `holds.grab.thing()`, `.flight()`, `.toss()` | the boat's middle wherever it is (the host's pose after the release, with `boats=host`); the stand-in's flight share and seconds since touchdown; the throw's places | world; s |
| `handoff.wave.arrival(place)` | seconds after `crush.arm` that the ring's front reaches a place (x, z); `waves.crush.arrives(place)` is the time itself | s |
| `handoff.wave.lifts(place, t)` | how far the wave lifts the water at a place and time (below 0 in its trough; exactly 0 off the pulse) | world |
| `handoff.wave.speed`, `.lag`, `.holds(place)` | **the ride: the front's speed; seconds from the edge's arrival to the face's; 1 where the crest is tall enough to carry a floating thing.** A boat the face reaches where `holds` is 1 moves outward at `speed` until `holds` is 0 at its own place, then is let go with that velocity | units/s; s; 0 or 1 |
| `waves.crush.pushed(place)` | the stand-in: that rule solved for a boat at rest at `place`, with a coast of drag 1.6 s after it is let go (`wave.ride(place)` gives its parts) | world |

**The stand-ins are consumers of the same contract**, and checks say so: `releasesAt` (at the stated instant the boat
is at the stated point and the grip has it at the stated velocity; it runs in both variants), `throwLands` (the
stand-in's flight starts at the release point with the release velocity, and lands where and when stated), `shoves`
(the stand-in moves at the wave's `speed`, stays on its face, and is let go where `holds` ends), `letsGoClean` (the
fingers come out of the hull they threw) and `frontFirst` (before the edge arrives the field is exactly 0, and nothing
is carried before the face).

**What a host must do** to keep the picture continuous: hold `boat1.at` and `boat1.heading` fixed from the warning;
while `held`, put its boat at `socket`; at `release.time` start its own flight from `release.at` with
`release.velocity`; for the wave, float its boat on `lifts`, and when the face reaches it where `holds` is 1 move it
outward at `speed` until `holds` is 0 there, then let its own drag have it.

## What is inherited and what is mine

Inherited: ballistic flight; constant acceleration as the stroke; 1 / sqrt(r) spreading; the shallow-water speed;
linear drag and a damped spring; anticipation, follow-through and squash from the twelve principles.

Mine: velocity continuity as the single rule across grip, stroke, air and water, the touchdown included, so plunge
and skid are derived; stating the wind-back and deriving the release; one gravity for the throw and the wave; the
shove as a closed form bounded by causality and by the wave's own speed; the aftermath as a second axis beside the
effect; the ring's reach as the live annulus so the sea pays for it only where and when it exists.

## Scored (2026-11-11)

(The defaults scored here were replaced the same day after the owner's second note: see "Further", at the end, for
the far throw and the full shove and their own score. The frame-time, hash and buffer figures below were taken with
these first defaults; "Further" restates the ones that changed.)

Measured on the built scene's own readouts through the CPU twin (the checks, and a script that samples
`holds.grab.thing()` at 240 Hz). First with the inputs the predictions were made for, then as shipped.

| Quantity | Predicted | Measured, same inputs | As shipped (base) |
|---|---|---|---|
| release velocity | (-1.20, 5.18, -5.30), 7.50, 43.6 deg | (-1.20, 5.18, -5.30), 7.50; the grip's own 0.000 off it | (-1.69, 5.18, -4.81), 7.27, 45.4 deg |
| release point | (8.83, 3.69, -7.22) | (8.83, 3.69, -7.22), 0.000 off | (8.70, 3.69, -7.10); stroke 1.82 |
| released, touchdown | t = 6.10, 8.70 | 6.10, 8.70 | same |
| apex | y = 6.37, 1.04 s after release | 6.37, 1.03 s | same (it does not depend on where it lands) |
| distance flown | 14.13 (13.48 from where taken) | 13.49 from where taken | 13.26 (12.80 from where taken) |
| touchdown speed | 7.82 down, 5.43 along | - | 7.82 down, 5.09 along |
| plunge, rebound | 0.79 at 0.22 s; 0.16 | - | 0.79 at 0.22 s; 0.16 at 0.84 s |
| skid | 1.09 | - | 1.02, to rest at (3.96, -20.56) |
| ends | 22.4 from the crab's middle | - | 20.7 (3.1 carapace lengths); 13.8 from where taken |
| wave speed; front at boat two | 2.92; 1.41 s (t = 12.91) | t = 12.91 | 1.23 s (t = 12.73): the boat is 7.0 out, not 7.5 |
| crest height there | 0.54 | - | 0.56 |
| boat two's offset | 3.10 | 3.10 | 3.90 (3.62 by the loop's seam) |
| impulse there | 1.94 units/s | 1.94 | 1.95 |
| on screen (game, 1280 x 800) | about 117 px | about 105 px (from the frames) | 133 px |
| before the front | exactly 0 | exactly 0 | exactly 0 |

Every closed-form number came out as predicted, to the digits printed. That scores the implementation against the
formulas, not the formulas against taste. Where the theory or my judgement was wrong:

1. **The wave's speed is the sea's, not the crab's.** I took the depth from the crab's `floor`. The stilt variant
   overrides `floor` to -1.0 (where its feet plant), so its wave ran at 2.24 and the ring's own guard refused the
   shove ("faster than the wave"). The depth is the world's: `seaDepth: 1.7`, one number for every variant.
2. **The eased shove could not be a contract** (see "The shove"): replaced by an impulse and a drag before any picture
   was judged.
3. **The framing was wrong by a bowsprit.** I allowed the ship half its hull length on screen; the bowsprit and the
   sail's peak reach further, and at (5.7, -21.0) the frame's right edge cut them. The landing moved 1.5 nearer, to
   (4.3, -19.6): 0.9 less flown. The owner's "distance" is therefore 13.3 flown and 20.7 from the crab's middle at
   rest, which is what the `game` camera can show whole; a longer throw is the `throw.land` input, and the `throw`
   camera stages it.
4. **105 pixels of knockback was not plain to see**, and the boat ended at the frame's edge. The shove went from 4.6
   to 5.6 (its drag from 1.6 to 2.0 s, keeping the impulse under the wave's speed; reach 16 to 14 so the wave still
   fits the loop) and the boat moved to bearing -1.1, 7.0 out, lying side-on to the camera (at heading 0.95 it was
   bow-on and read as a sail with no hull).
5. **A check of mine was wrong, and a test found it.** `releasesAt` sampled the thing at the release instant itself,
   where it is already its placer's; with a host-placed boat that reads the host's pose. It passed on the crab only
   because of which side of a float comparison the instant fell. It now samples only before the release.
6. **`settle` ended too early for a throw.** The beats counted the action over when the gripper had let go (1.3 s
   after the release); the thrown ship lands 2.6 s after it. Faces that look away "after the grab" turned from the
   ship in the air. `settle` and `after` now begin at touchdown when that is later, and there is a `flight` beat.

**All named variants pass**, with one set of throw numbers in the ship's own axes, after (1): base, stilt, fiddler,
fiddlerBaseDisc, mask nine checks each, islander twelve (its face's three); `boats=host` six (the stand-ins' three
do not apply).

**GPU frame time** (`game`, 1280 x 800, t = 1; `tools/sea_bench.ts`, built files, 24 rounds, before, after and
no-ship alternated; the slow clock state held for 14 of them, the fast state is the least of each):

| | Predicted | Measured |
|---|---|---|
| second ship | +0.30 slow, +0.10 fast | +0.26 slow (4.39 to 4.13 without the first: the same thing), +0.13 fast |
| the ring while none runs | +0.00 to +0.07 | +0.07 (after 4.78, the same build with `deform: []` 4.65; 16 rounds) |
| splash, tables | under one tick | +0.06, about a tick |
| normal frame | 4.46 to about 4.8 slow (+0.3); 1.75 to 1.85 fast (+0.1) | **4.39 to 4.78 slow (+0.39, +9%); 1.64 to 1.77 fast (+0.13, +8%)** |
| while the ring runs (t = 13.3) | a further +0.15 slow | a further +0.07 slow (4.85) |

The total is 0.09 over the prediction and inside its stated bound (0.45). The parts were each right to a tick; three
"under a tick" items sum to a tick, which the prediction rounded to nothing. The ring's exact reach did what it was
for: its cost with no ring running is one timer tick, and a live ring costs one more. Nearly all of the cost is the
second ship's 25 draws.

**What the pictures say** (`out/throw/`): from the `game` camera the throw reads as a throw: the ship is lifted and
drawn back toward the face, whipped up and out, turns over once in the air, comes down in the far right corner with a
splash, goes under to its rail and bobs. The slam's ring reads as a ring: a lighter band with a broken cream front,
running out under the legs; the second boat rises on it, heels hard as the crest passes, and is left its own length
further out (3.9; 4.4 for the islander, whose disc is larger).

The islander's eyes (`face` camera, `out/throw/face_islander.webp` and `.mp4`) stay on the ship from the warning
through the squeeze, the flight and the touchdown, and leave it between 0.5 and 1.5 s after it lands; before (6) they
had left it by touchdown. Its face file was not edited.

The base crab's proof frames (`tools/files_proof.ts --scene reefback_titan`: `game`, 640 x 400, t = 1, t = 2.5,
t = 2.5 with the outline at 0.12) change, as they must (the Grab now plays first, and there is a second boat): from
`a8c859adcfed3672 39665ec8b623160d 19e2d2d4bfc5b710` on main at 74abcac to
`e68cdae4bcd6115e 55018bdb8fd56949 93e16c40bbaa8efd`.

Built as files, nothing refused. `loft_detail` is a fixed 4096-slot uniform array (65,536 bytes in every build, by
`DETAIL_SLOTS`, not by content): the islander uses about 65 of its slots after this change (the base 70, up from 54).
What this work adds per frame goes to the storage buffer `loft_tables_0` (base 85,072 to 99,616 bytes; islander
95,536) and to the inputs' uniform buffer (16 to 64 bytes).

Still wrong or unfinished:

- The throw leaves 57 degrees off the claw's own axis (the claw's palm does not turn), so by the geometry the hull must
  pass through the port finger for about a tenth of a second after the release. I did not measure it and could not
  see it at the game camera's scale (a few pixels for two or three frames). Turning the claw into the throw would cure it and needs
  the wind-back over the left legs, where there is no room.
- The tumble starts at the release at full rate (the palm gives the ship no spin to start from).
- `fliesClear` measures the carapace and the atoll, not the legs or the claws.
- The faces still aim at the slam through `n.crushCentre`, a number, so a game that moves `crush.centre` moves the
  slam and its warning but not where the eyes look. `rig.inputs.crushCentre` is the expression to read.
- The stand-in's second boat is back at its place 6.5 s after the slam whatever the schedule (`boatTwo.keep`): right
  for the 18 s show, arbitrary for a game that uses the stand-in.
- Both boats jump back to their places at the loop's seam.

## Further (the owner's second note, 2026-11-11): predicted before running

After the first pictures the owner asked for the boat tossed further, clearly out of the crab's neighbourhood, and
the second boat forced back by the slam, not nudged. Both stay inputs; these are the new defaults. The formulas are
unchanged; these are their numbers, written before the scene was run with them.

**The throw is no longer held to the `game` camera's frame.** That frame ends 23.5 from the crab's middle at its far
right corner (a landing whole in frame: 16.7 flown at most; the first version flew 13.3). The default landing is now
(-1.0, -35.0), along the same line (so the ship leaves the game frame through the corner it used to land in, as late
as it can), 3.2 s in the air, two turns. A new camera, `arena` (the game camera's direction, pulled back and aimed
between the crab and the landing), holds the crab, both boats, the slam and the landing; `throw` shows the flight in
profile. The whip is shorter and harder: stroke 0.4 s (was 0.5), follow-through 0.25 s.

| Quantity (base) | Predicted |
|---|---|
| release velocity | (-2.98, 6.90, -8.56), speed 11.39, 37.3 degrees up |
| release point | (8.53, 3.78, -7.60) at t = 6.10; stroke 2.28 (acceleration 28.5), follow-through 1.42 |
| touchdown | t = 9.30, at 9.10 down and 9.07 along |
| apex | y = 8.54 (8.29 above its floating height), 1.38 s after the release |
| distance flown | 29.0 (7.6 ship lengths) |
| plunge, skid | 0.92 below floating height at 0.22 s; skid 1.81 |
| ends | at (-1.60, -36.71): 36.9 from the crab's middle (5.6 carapace lengths), 30.8 from where it was taken |
| from the `game` camera | in frame for 0.5 to 0.9 s after the release, then out through the top right; the landing is not in frame |
| the claw | the grip's middle within 4.5 of its arm's centre through the follow-through (span 4.9); `gripReaches` passes in all six variants |

**The shove is as large as the ring allows.** The impulse at the disc's edge is 2.9 units/s, the wave's own 2.92
being the limit, and the stand-in's drag is 3.0 s (a heavy boat coasts), so a boat at the edge ends 8.7 out. The
crest is 1.0 high at the edge (was 0.8; the depth is 1.7, and a crest breaks near 1.3), and the wave is gone at 12.
The second boat's default place is 2.0 beyond the disc's edge whatever the disc's radius (it was a fixed 7.0 from the
centre), on bearing -1.35: the first boat is long gone from that side by then, and the game frame has 10 units of
open water along it. The loop is 22 s (the slam at 12.0), so the coasting boat has time.

| Quantity | Predicted (base; islander) |
|---|---|
| front reaches boat two | 0.69 s after the slam (t = 12.69) |
| crest height there | 0.79; 0.83 |
| impulse there | 2.30 units/s; 2.40 |
| after 2 s | 3.36; 3.51 |
| final offset | 6.90 (1.8 boat lengths); 7.21 |
| by the loop's seam, 10 s after the slam | 6.59; 6.89 |
| on screen (game, 1280 x 800) | about 210 px, twice the boat's own length on screen |

The boat moves at 2.3 falling to 1.2 over its first two seconds while the front runs at 2.92, so the crest takes
about three seconds to pass under it: it should be seen to ride up, heel, and be left behind. GPU frame time: no
change at t = 1 (the same draws); a live ring as before.

### Scored

| Quantity (base) | Predicted | Measured |
|---|---|---|
| release velocity | (-2.98, 6.90, -8.56), 11.39, 37.3 deg | (-2.98, 6.90, -8.56), 11.39, 37.3 deg |
| release point; stroke | (8.53, 3.78, -7.60); 2.28 | (8.53, 3.78, -7.61); 2.28 |
| touchdown | t = 9.30; 9.10 down, 9.07 along | t = 9.30; 9.11 down, 9.07 along |
| apex | 8.54, 1.38 s after the release | 8.54, 1.38 s |
| distance flown | 29.0 | 29.00 |
| plunge; skid | 0.92 at 0.22 s; 1.81 | 0.92 at 0.22 s (0.19 back above at 0.84 s); 1.81 |
| ends | (-1.60, -36.71): 36.9 from the crab's middle, 30.8 from where taken | (-1.60, -36.71): 36.86, 30.79 |
| in the `game` frame after the release | 0.5 to 0.9 s | 0.92 s (its middle; out through the top right) |
| `gripReaches`, six variants | pass | pass (islander: release at 11.51/s) |
| front at boat two | 0.69 s (t = 12.69) | 0.69 s (t = 12.69) |
| crest there | 0.79; islander 0.83 | 0.79 |
| impulse there | 2.30; 2.40 | 2.30; 2.40 |
| after 2 s; final; by the seam | 3.36; 6.90; 6.59 (islander 7.21 final) | 3.36; 6.90; 6.59 (7.21) |
| on screen (game) | about 210 px | 208 px, (892, 521) to (1080, 431) |

The one miss is the time in the game frame, 0.02 s over the range I gave: I estimated it from the ship's height at
0.7 s, not from where the frame's corner is.

What the pictures say. From `arena` the throw is a throw across the sea: the ship turns over twice, comes down 37
from the crab, a speck with a splash, and floats. From `game` it is whipped up and out of the top right corner in
under a second and does not come back: the landing is not in the game frame, and cannot be at this distance. The
second boat is caught by the ring a little under a second after the slam, rides up on it heeled over while the crest
passes (by the formulas the crest's 3 units take 2.3 s to pass under the moving boat; I said about three), and coasts
to rest almost two of its lengths away, 208 pixels, by the end of the loop.
"Several" boat lengths it is not: the ring's own rule (no faster than the wave, 2.92) and a 22 s loop give 6.9. More
needs a faster wave, which means more gravity or deeper water for the whole scene, or a longer coast.

With these defaults the base crab's proof frames (`tools/files_proof.ts --scene reefback_titan`) are
`a3d75b86817f6746 9b5566eb6ad22c1e c088af216c3ff29e` (main at 74abcac: `a8c859adcfed3672 39665ec8b623160d
19e2d2d4bfc5b710`). All six variants pass (nine checks each, the islander twelve); `boats=host` passes its six.

Added to what is wrong or unfinished: the thrown ship's landing is outside the `game` frame; the follow-through's
reach is not measured by any check (`gripReaches` ends at the release), and with the harder whip the grip's middle
goes to about 4.5 of the arm's 4.9; the second boat's mast now shows in the bottom right corner of the `face` camera.

## The ride (2026-11-11, third pass): predicted before the code

The owner's words again: "the water slam to make another boat get forced back." 1.8 boat lengths of drift is a nudge.
The rule that limited it (a thing cannot be pushed faster than the wave that pushes it) is kept and used: a boat
caught by a steep front is carried with the front, at the wave's speed, for as long as the front is steep enough to
hold it; then it is dropped and coasts.

**The model.** The crest height falls as `a(r) = H sqrt(R / r)` (as before). The front holds a floating thing while
its crest is at least a holding height `a_h`, so the ride ends at

```
r_drop = min( R (H / a_h)^2 ,  0.75 reach )
```

(the second term: the wave begins to die there, and what is dying holds nothing). The front is a bore, not a ripple:
a front of height a on depth d runs at `sqrt(g (d + a))` to first order (inherited), faster the taller it is. The
model keeps one speed, and takes the slowest the front has while it carries anything, the speed at the holding
height:

```
c = sqrt(g (d + a_h))
```

so a carried thing is never moved faster than the real front at any radius of its ride (nearer the slam the true
front is faster, up to sqrt(g (d + H)) at the disc's edge, and the model does not say so: arrival times near the disc
are a little late). The thing is not taken by the front's leading edge, where the water has not yet risen, but by its
face: a fixed lag `face W / c` after the edge arrives (face = 0.06 of the pulse: the boat's middle sits 0.36 behind
the edge, its inward end near the crest). Then:

```
before the face arrives          at rest (it rises as the edge passes under it: the sea's height, not this)
riding                           r(tau) = r0 + c (tau - tau_face)          while r < r_drop
dropped                          r = r_drop + c tau_d (1 - exp(-(tau - tau_drop) / tau_d))
```

A thing beyond `r_drop` is not carried: it is given `c a(r) / a_h` (less than c) and coasts, so the shove is
continuous in the place.

**The contract a game integrates.** It reads `arrival(place)` (the edge), `speed` (c), `lag` (seconds from the edge to
the face), `holds(place)` (the crest there is at least the holding height) and `lifts(place, t)`. Its rule: when the
face reaches its boat and `holds` is true there, the boat is the front's: it moves outward at `speed`; when `holds`
turns false at the boat's own place, it is let go with that velocity and the game's own drag has it. Because a
carried boat moves exactly with the front, sampling the field at the boat's moving place and at its starting place
give the same motion: the stand-in (`pushed`) is that rule solved in closed form with a linear drag. `shoves` checks
the stand-in against the readouts (it moves at `speed`, it stays on the face, it is dropped where `holds` ends) and
`frontFirst` that nothing moves before the edge and nothing is carried before the face.

**Defaults and predictions** (g = 5, depth 1.7; H = 1.0, a_h = 0.46, W = 6, reach 22, coast drag 1.6 s; the boat
2.0 beyond the disc's edge on bearing -1.5, bow toward the slam so that it is driven back stern first):

| Quantity | Base (R = 3.4) | Islander (R = 4.4) |
|---|---|---|
| front speed c | 3.29 | 3.29 |
| boat's start | r0 = 5.4, at (9.98, 0.21) | r0 = 6.4 |
| edge arrives; face takes it | 0.61 s; 0.72 s after the slam (t = 12.72) | 0.61; 0.72 |
| ride ends at | r_drop = 16.07 (3.25 s of ride, t = 15.97) | 16.5, the wave's dying (3.07 s) |
| ride distance | 10.67 | 10.10 |
| coast | 5.26 | 5.26 |
| final offset | 15.93: 4.2 boat lengths (15.8 by the loop's seam) | 15.36: 4.0 |
| in the `game` frame (1280 x 800) | from (872, 503) to about (1207, 277): 404 px, in frame | to about (1215, 272) |
| crest under it | 0.79 at the start of the ride, 0.46 at the drop | 0.83, 0.52 |
| attitude | bow up about 15 degrees on the face from the sea alone, more in the first second (a pitch kick the stand-in adds); it slews about 50 degrees as it coasts | |

**The grip turns into the throw.** The palm did not turn, so the ship left 71 degrees off the claw's axis and the tumble
began at full rate from nothing. Angular velocity is now continuous too: over the stroke the hand turns the ship
about one axis (keel x release velocity) with uniform angular acceleration, to exactly the rate of the tumble, which
then carries on unchanged through the flight (a free body). For N whole turns in a flight of T after a stroke of
sigma the hand's turn is `pi N sigma / T`: with N = 2, sigma = 0.4, T = 3.2 that is 45 degrees of the 71, and the
release spin is 3.93 rad/s. A full 71 needs N = 3.2 or a wrist 6.2 from the shoulder (the arm spans 4.9). Predicted:
the wrist at the release is 4.3 from the shoulder; `gripReaches` passes on the base; the hull still meets the port
finger after the release, by less than before (0.1 to 0.3 deep for under 0.2 s), which a new check measures.

### Scored

| Quantity | Predicted | Measured |
|---|---|---|
| front speed | 3.29 | 3.29 |
| face takes the boat (base) | 0.72 s after the slam, t = 12.72 | t = 12.72 |
| ride (base) | 10.67 at the wave's speed, to r = 16.07, ending t = 15.97 | 10.67 at 3.29/s, 0.000 off the face, let go t = 15.96 where `holds` ends |
| final offset (base) | 15.93, 4.2 boat lengths | 15.93 |
| islander | ride 10.10, final 15.36 (4.0 lengths) | 10.10, let go t = 15.79; 15.36 |
| in the `game` frame | 404 px, in frame | 396 px, (866, 498) to (1185, 264), in frame |
| before the front | exactly 0 | exactly 0; lifted but not moved between the edge and the face |
| hand's turn, spin | 45 degrees; 3.93 rad/s | as built (`handTurn`, `tumbleRate`) |
| `gripReaches` through the stroke | passes on the base | passes in all six variants |
| fingers and hull after the release | 0.1 to 0.3 deep for under 0.2 s | at most 0.056 deeper than the grip's own overlap (base; 0.012 stilt, 0.000 fiddler claws), clear from 0.14 s (0.12 to 0.18) |

Where I was wrong:

1. **The first staging read as a spar.** Bow toward the slam on bearing -1.5 pointed the boat at the game camera. The
   heading is now 2.0: 20 degrees off bow-on to the front and 19 off side-on to the camera. The bearing moved to
   -1.54 so the coasted, slewed boat is whole in the frame.
2. **The fingers were never the problem I thought.** By the capsule measure a curled finger overlaps the hull by 0.41
   all through the hold (its capsules are fatter than its skin and wrap the hull): my first form of `letsGoClean`
   failed on that, not on the release. Measured against the grip's own overlap, the hull leaves 0.056 deeper for
   three hundredths of a second and is clear of both fingers in 0.14 s. The larger fault it exposed was mine from this
   pass: with the hand turning the ship about a tilted axis, a palm left level had the hull rolling in its grip. The
   gripping palm now lies flat on the held ship's own up (`rig.gripUp`).
3. A bow-up of 15 degrees from the sea alone was an overestimate of what reads; the stand-in's pitch kick (0.5 rad,
   ringing down) is what throws the bow up in the pictures.

All six variants pass: ten checks each, the islander thirteen. The base crab's proof frames after this pass are
`625dcf706bbc944c 4b25ec069f162af8 044800b6ce69f7ff`. Not re-measured: the frame time (one more collapsed foam draw,
and a live ring that reaches 22 instead of 12).
