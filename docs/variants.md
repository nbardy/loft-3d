# Design variants

Written before the code (2026-11-11), then scored against it (last section). The code is `src/design.ts` (the
notion), `src/cli/variant.ts` and `src/cli/variants.ts` (choosing one, and the comparison sheet), and the crab:
`examples/bosses/reefback_titan.ts` (its design) over `examples/bosses/titan/` (its rig and slots).

## What a variant is

A Loft monster is a set of closed-form functions of the clock. Some of those functions are what the game reads and
what the checks measure: where the body is, when an attack arms, where a strike lands, what a grip holds and where.
The rest are what an art director argues about: the shape of a leg, the face, what grows on the back. A variant
changes the second set and must leave the first set *valid*, not unchanged.

So a **design** (one subject, here the crab) has four parts:

- **numbers**: one record of every number an art director may change (inks, sizes, timings);
- a **rig**: everything the game reads and the checks measure: the walk, the body and shell frames, each attack's
  clock and target, the held ship, the warnings, the crash, and the *mounts* where slots attach (leg roots, claw
  shoulders, the shell frame);
- **slots**: legs, claws, face, back, carapace, and boats (who places the two boats when the crab does not hold them:
  Loft's stand-ins, or the host; `docs/throw_and_shove.md`, "The contract"). Each slot has named **options**; an option is a function from the
  rig (and the numbers) to drawables, plus whatever parts the checks need from it;
- **checks**: the contract. They are built from the rig's attacks and from parts the slots return (the crusher's palm
  that strikes, the cutter's two fingers that grip).

A **variant** is one option per slot plus number overrides. It is valid when it builds and passes the subject's checks.
That is the whole definition: there is no list of things a variant may not touch. A stilt-legged crab that raises the
body is valid if the Claw Crush still lands inside its warning and the cutter still closes on the ship's beam; if it
does not, the check says by how much, which is a geometric fact about that crab, not a policy.

What stays fixed across the variants of one subject: the slot names, the rig's *code* (its attacks, their names, what
the game reads), the camera set and the checks. What may change: any option in any slot, any number. Numbers include
proportions, so a variant may change proportions; the checks are re-measured on each variant, never inherited.

## Slots that ask things of the rig

The rig cannot know every option. Two directions of dependency appear in the crab, and they get two mechanisms.

1. **An option needs different numbers** (stilt legs need a higher body; a fiddler wants one claw three times the
   other). The option carries `numbers`, overrides on the subject's record. They apply to the whole build, so the rig
   reads them like any number. Two chosen options that set one number to different values are a typed error naming
   both; a variant's own `numbers` are applied last, over the options' (the art director's word wins, and the checks
   still judge it).
2. **The rig's attack geometry depends on the option's shape.** The Grab places the ship where the cutter can reach it
   closed on the beam: that distance is wrist reach plus *how deep the grip's middle sits beyond the wrist when the
   fingers close on a thing of width w*, which depends on the fingers' length, curl and hinge spacing. Claw Crush lands
   the wrist half a palm short of the disc's centre. So the claws slot **offers** the rig a small typed interface
   computed from the numbers alone (plain JavaScript, before the rig exists): `crushLead` and a `Gripper`
   (`closedDepth(width)`, `restGap`). The rig solves its geometry against the interface; the option draws against the
   rig. The order is acyclic: numbers, then offers, then rig, then drawings, then checks.

   A fortress crab whose claws fold over the face needs nothing new: the rest pose is the claws option's own, and the
   crush's lunge law starts from whatever rest the option gives it. A fiddler is mechanism 1 (`crusher: 3`) plus
   mechanism 2 (a bigger palm offers a longer lead).

This is the seam test: a new option that forces an edit to the rig or to another slot means the interface is missing a
field. Add the field to the slot's contract, not a case to the rig.

## Naming, combining, showing

- Options are named per slot (`legs: base | stilt`). Every design has a variant named `base` that picks an option in
  every slot; every other named variant is a partial pick over `base` plus numbers.
- A choice is written `name` or `name,slot=option,...` or `slot=option,...` (over `base`): `--variant stilt`,
  `--variant legs=stilt,face=mask`, `--variant stilt,face=mask`. It is parsed once, at the CLI's boundary, into
  `{ variant, picks }`, and resolved once against the design; an unknown variant, slot or option is a `DesignError`
  that lists the valid ones. Nothing downstream looks at text.
- A module that exports a design also exports `default` (the base variant's scene), `checks`, `strikes` and `holds`
  of the base variant, so everything that reads a plain scene module still works unchanged.
- `loft variants <scene>` renders every named variant (rows) through the design's comparison cameras (columns), writes
  each picture, and writes one labelled sheet. `loft check <scene>` with no `--variant` checks every named variant.

## Inherited and new

Inherited: options as a choice per slot is the obvious shape of any configurator. New here: the checks are the
definition of validity (no whitelist of allowed changes), the rig is defined by what the game reads and the checks
measure rather than by a skeleton, and options talk to the rig through *offers*: small measured interfaces computed
before the rig, so the attack geometry is solved for the chosen shape rather than tuned for one.

## Predictions (written before the code)

Files (lines approximate):

| file | lines | what |
|---|---|---|
| `examples/bosses/reefback_titan.ts` | ~90 | the design: the slot table, the named variants, the cameras, the assembly into a scene and its checks |
| `titan/numbers.ts` | ~100 | `S` moved verbatim, and its type |
| `titan/ink.ts` | ~20 | the shared inks and the two pattern helpers (`cut`, `mottle`) |
| `titan/slots.ts` | ~80 | each slot's contract: what an option receives and returns, and the claws' offer |
| `titan/rig.ts` | ~220 | walk, Claw Crush, sea, Grab, the ship, frames, mounts, warnings, crash |
| `titan/carapace/base.ts` | ~25 | |
| `titan/legs/base.ts` | ~35 | |
| `titan/claws/base.ts` | ~130 | |
| `titan/face/base.ts` | ~215 | |
| `titan/back/base.ts` | ~165 | atoll, reef, tower |

A new leg design: one file of 25 to 40 lines plus two lines in the design (import, entry). A face or back: one file,
from 20 lines (reusing the base's parts) to the base's 200; plus two lines.

Pictures: the base variant renders bit-identical frames to main for `game`, `three`, `close` at t = 1.0, 3.6, 11.3:
the same expressions, built in the same order, drawn in the same order. Checks: base passes the same 4.

## Adding an option

An option is one file in the slot's folder under `examples/bosses/titan/`, plus two lines in
`examples/bosses/reefback_titan.ts` (the import, and the entry in that slot's table). Copy the nearest option and
change it; `legs/stilt.ts` (21 lines) is the short example. A whole direction (all five slots and a named variant) is
`mask` (the heikegani; see "The mask direction" below).

What a slot receives and must return (`titan/slots.ts` is the contract; the type checker holds you to it):

| slot | `draw` receives | returns |
|---|---|---|
| carapace | the rig | `{ hull, things }`: `hull` is the strand the face's beard rides, m from tail (0) to front (1), v round the section with `sin(2 pi v)` its height (1 on top at v = 0.25, -1 underneath; v = 0 is a flank) |
| legs | the rig | drawables; leg k goes from a root on the body to `rig.walk.foot(k)` (k = 0..3 left, 4..7 right) |
| claws | the rig and its own offer | `{ things, crush, cutterFingers }`: the crusher bound to `rig.crush` by `animate` (part "crusherPalm"), the cutter's two fingers |
| face | the rig, the carapace and the claws as drawn | `{ things, checks }`: the drawables, and what this face asks of itself (none, or as `face/dandy.ts`: its eyes' size from the game camera, its expressions told apart; `face/brow.ts` also asks that the claws keep off it, `staysInView`) |
| back | the rig | drawables riding `rig.shell` (the shell frame: the body's, read late, pitching on after the slam). A back that builds beyond the atoll's cylinder also gives `keepClear(rig)`: what a thrown ship must fly clear of besides that cylinder (`back/headland.ts`: its capes and its light); the design adds them to `fliesClear` |

The rig (`titan/rig.ts`, type `Rig`) gives every option: `n` (the numbers of this build: read inks and sizes from it,
never import `S`), `body` and `shell` frames, `local(p)` (crab coordinates to world), `shoulder(side)`, the walk, both
attacks (`crush`, `grab`) with their clocks (`crushAfter`, `grabOn`, `grabEnv`, `grabBeat`), `keel`, `gripRest`, and
`shipNow` (where the held ship is).

Rules an option keeps:

- **Build nothing at import.** Every expression is made inside `draw`, from the build's numbers. A module-level
  expression would be shared by every variant and built from the wrong numbers.
- **Names are the scene's.** Every drawable needs a name unique in the scene (`scene` refuses two things with one name).
  Replacing a part, reuse its name (`titan`, `leg<L|R><i>`); adding one, pick a new name.
- **Needing other numbers** (a higher body, a bigger claw): put them in the option's `numbers`. They apply to the whole
  crab. Two chosen options that set one number differently are an error naming both; a named variant's `numbers` win.
- **A claw that changes the grip's shape** must say so in its `offer` (`closedDepth(width)`, `restGap`, `crushLead`):
  the rig places the ship and lands Claw Crush by them. `claws/base.ts` derives them for the base pincer;
  `clawsOf(look)` makes an option that keeps that mechanism and changes its paint and numbers (`claws/fiddler.ts`).
- **Faces** can compose the base face's parts: `faceKit(rig)` gives the clocks (`rouse`, `brace`, `blink`), `eyeParts`,
  `plate`, `brow`, `gullet`, `beard`.

A named variant is one entry in the design's `variants`: `{ about, pick: { slot: "option" }, numbers? }`.

**Cameras** are the design's (`CAMERAS` in `reefback_titan.ts`). `far`, `face`, `legs` and `back` are the comparison
columns (`compare`); add a camera there and name it in `--views`, or add it to `compare` to make it a default column.

**Commands:**

```sh
bun src/cli/main.ts variants examples/bosses/reefback_titan.ts                 # every named variant: out/variants/reefback_titan/sheet.webp and <variant>/<camera>.webp
bun src/cli/main.ts variants examples/bosses/reefback_titan.ts --only base,stilt --views far,legs --time 3.6
bun src/cli/main.ts render examples/bosses/reefback_titan.ts --variant legs=stilt,face=mask --views game,close --out out/variants/try.webp
bun src/cli/main.ts check examples/bosses/reefback_titan.ts                    # every named variant
bun src/cli/main.ts check examples/bosses/reefback_titan.ts --variant stilt,face=mask
bun src/cli/main.ts check examples/bosses/reefback_titan.ts --combinations     # every combination of options
bun src/cli/main.ts dev examples/bosses/reefback_titan.ts --variant mask
bun test tests/variants.check.test.ts                                           # every named variant passes
```

A slot may be a **look**: its options change only how the subject is painted (the crab's `foam`: which white water the
print uses), never what it is, so no check can tell them apart. The design lists such slots under `looks`
(`src/design.ts`); they are picked like any other (`--variant islander,foam=apron`) and `--combinations` leaves each at
its base option instead of multiplying by it.

`--variant` works on `render`, `clip`, `frames`, `check`, `profile`, `build` and `dev`.

**What the checks require** (four for this crab, and whatever the chosen face adds):

1. Claw Crush: the crusher's palm lands inside the hit disc (at most 2% of its footprint outside). The palm lands centred
   on the disc, so a bigger crusher needs a bigger `crushRadius`: the base disc fits a crusher of about 1.43.
2. Claw Crush's warning starts before the claw first moves.
3. The Grab's warning starts before the cutter first moves, and covers the ship.
4. The cutter's two fingers close on the ship's beam and keep it through the hold: the grip's middle within a tenth of
   the beam of the ship's middle, the gap within a tenth of the beam.

## Limits today (what an option cannot change)

- **The base face is drawn in crab coordinates for the base carapace's front** (the brow's V at x = 4.93, eyes at 4.05).
  A carapace option that moves the front (another `carapace.to`) leaves it where it was. A face may instead place itself
  from the carapace numbers (`n.carapace`), as `face/mask.ts` does; the carapace option then sets them (`kabuto`).
- **The beard rides the carapace's surface coordinates**, so a carapace option keeps the strand's (m, v) convention.
- **Checks are the design's**, except a face's: a face returns `checks` beside its `things` and they join the design's
  for any variant that picks it (2026-11-11, the islander), and a face is given the claws, so it can ask that they keep
  off it (the bruiser). The other slots still cannot add one (a fortress crab cannot ask that its claws cover the face):
  each would need the same field on its return.
- **The attacks are the rig's**: an option cannot add an attack or change its timing except through numbers. Claw Crush's
  timing (wind-up 1.15 s, strike 0.3 s, ...) is written in `rig.ts`, not in the numbers.
- **One claw mechanism**: the Grab's pose math (both fingers at one angle, symmetric about the palm) is the base claw's.
  A different mechanism (one fixed finger) writes its own `draw` and `offer`; the rig needs only the offer.
- **The draw order is the design's**: carapace, back, face, legs, claws, then the world.
- **Cameras are fixed in the world**: a variant that raises or grows the crab can leave a close camera's frame (the
  stilt crab's face sits 1.25 higher in `face`).
- **Params**: the crab declares none. Loft's parameter registry is global (`src/expr.ts`, `param`): two variants built in
  one process (the sheet, `check`) that declared one param with different defaults would fail with "declared twice".
  The fix, in `src/expr.ts`: intern a param by its whole spec (`p:${name}:${def}:${min}:${max}`, not `p:${name}`), drop
  the process-wide `params` map, and do the "declared twice with different defaults" check in `leaves()`, where `ps`
  is filled per compiled scene. Then a clash is an error within one scene, not across a process.

## Scored against the build (2026-11-11)

Files, predicted and actual lines:

| file | predicted | actual |
|---|---|---|
| `reefback_titan.ts` (the design) | ~90 | 104 (four named variants, nine cameras) |
| `titan/numbers.ts` | ~100 | 70 |
| `titan/ink.ts` | ~20 | 26 |
| `titan/slots.ts` | ~80 | 40 |
| `titan/rig.ts` | ~220 | 176 |
| `titan/carapace/base.ts` | ~25 | 24 |
| `titan/legs/base.ts` | ~35 | 35 |
| `titan/claws/base.ts` | ~130 | 156 (the pincer derivation and `clawsOf`) |
| `titan/face/base.ts` | ~215 | 227 (the parts split into `faceKit`) |
| `titan/back/base.ts` | ~165 | 172 |

A second option, plus two lines in the design each: legs `stilt` 21 lines, carapace `plated` 25, claws `fiddler` 19,
face `mask` 27, back `spires` 27. None of them needed an edit to the rig or to another slot.

Pictures: as predicted. The base variant's `game`, `three` and `close` frames at t = 1.0, 3.6 and 11.3 have the same
SHA-256 of their RGBA as c0959b4's (9 of 9). Expression ids are only names: shifting every id by building seven
unrelated expressions first also left the pixels identical. Checks: base passes the same 4.

Not predicted, found by the checks:

- **The base crush disc only just fits the base crusher.** The palm lands centred, so a crusher above about 1.43 puts
  its palm partly outside a 3.4 disc. A fiddler needs a bigger hit disc (6.2 for a 2.4 crusher, 1.5% outside). The
  fiddler option asks for it; this is a gameplay change and the variant says so.
- **A cutter below about 0.8 loses the ship in the lift** (0.7 closes, then drifts 0.199 off at t = 11.3). My first
  explanation (the arm's reach at the close) was wrong: moving the wrist nearer made it worse.
- **Two valid options can fail together.** Of the 32 combinations of the five proof options, 24 pass. The 8 that fail
  are exactly those with stilt legs *and* fiddler claws (grip middle 0.19 off): the stilt body raises the shoulder to
  2.5 above the water and the fiddler's 0.8 cutter spans 4.46, short of a wrist 4.2 out and 2.25 down (4.76). With the
  wrist 3.6 out (4.25) the pair grips as well as the fiddler alone (0.058 off, measured). The named variant
  `stiltFiddler` settles it with that number. This is the case the variant's own `numbers` exist for.
- Combinations that differ only in carapace, face or back always score the same as each other: those slots do not
  reach the checks. The checks see only the numbers and the claws.

## The mask direction (2026-11-11)

`--variant mask`: carapace `kabuto` (a ribbed lacquer helmet strand, two lamellar sode panels, two cord tassels),
face `mask` (one closed-form surface: a sphere patch on the carapace front, square mapped to disc, pushed out by a
height field of brows, sockets, nose, cheeks, lips and rim; flat inks in the same coordinates), legs `armoured`
(sawtooth girth = overlapping lames whose phase follows the knee's bend), claws `gauntlet` (`clawsOf` with arm paint,
arm profile, finger paint and a rest pose), back `keep` (mound, three-tier keep, two pines).

Seams it needed: one ink (`lacquer`); `ClawLook` gained optional `arm`, `armProfile`, `finger` and `rest`, each absent
field building the base claw's exact expression (base frames byte-identical). Lessons:

- `cut` (src/style/shared.ts `edgeOf`) is a screen-derivative edge: it exists only in paint. In geometry (girth, a
  surface's point) the CPU twin fails with "loft_fwidth is GPU-only"; use `smoothstep` there.
- A copies `cone` has round caps, so a flat disc cannot be one: pine pads are flattened strands.
