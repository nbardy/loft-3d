// The crab's slots: what an option of each receives and must return (docs/variants.md, "Adding an option").
//
// Every option is `about` (one line for the sheet), optional `numbers` (overrides it needs on the whole crab: stilt
// legs raise the body), and a `draw` from the rig. The claws also *offer* the rig two measurements before the rig is
// built (the Grab places the ship by them), because the attacks' geometry depends on the claws' shape.

import type { F, P3 } from "../../../src/index.ts";
import type { Check, Reaching, ContactFoam, Drawable, MarksPrint, Measured, Placer, Strand, Strike, Target } from "../../../src/index.ts";
import type { Option } from "../../../src/design.ts";
import type { ImpactPaint } from "../lib/impact.ts";
import type { Numbers } from "./numbers.ts";
import type { Rig } from "./rig.ts";

type Opt = Option<Numbers>;

/** The body shell. `hull` is the strand the face's beard rides in its own (m, v): m from tail (0) to front (1), v round
 * the section with sin(2 pi v) its height (v = 0.25 on top; v = 0 is a flank). */
export type Carapace = { readonly hull: Strand; readonly things: readonly Drawable[] };
export type CarapaceOption = Opt & { readonly draw: (rig: Rig) => Carapace };

/** Eight legs from their roots on the body to the stance's feet (`rig.walk.foot(k)`): what is drawn, and each leg's solve
 * (the reach check scans them over the loop: docs/stance.md). */
export type Legs = { readonly things: readonly Drawable[]; readonly limbs: readonly Reaching[] };
export type LegsOption = Opt & { readonly draw: (rig: Rig) => Legs };

/**
 * A two-fingered gripper as the Grab needs to know it, in plain numbers (DERIVATION in claws/base.ts):
 * - closedDepth(w): how far beyond the wrist, along the palm, the grip's middle sits when the fingers close on a thing w
 *   wide (the ship is placed at wrist reach plus this);
 * - restGap: the gap between the fingers' surfaces at the claw's own rest (below zero when they cross).
 */
export type Gripper = { readonly closedDepth: (width: number) => number; readonly restGap: number };
/** What the claws tell the rig before it exists: how far short of the disc's centre the crusher's wrist lands
 * (half its palm, so the palm covers the centre), and the cutter as a gripper. */
export type ClawsOffer = { readonly crushLead: number; readonly cutter: Gripper };
/** The claws drawn: the crusher bound to Claw Crush (`rig.crush`, part "crusherPalm"), and the cutter's two fingers
 * that the grip check measures. */
/** `great`: the great claw's wrist (world), its arm's span (the two segments): what a routine's aims are measured in (crab_lineup.ts, `inSync`); and how open its fingers are. */
export type Claws = { readonly things: readonly Drawable[]; readonly crush: Strike; readonly cutterFingers: readonly [Measured, Measured]; readonly great: { readonly wrist: P3; readonly span: number; /** Its fingers as drawn: 0 shut .. 1 wide open (the sync instrument's click readout). */ readonly open: F } };
export type ClawsOption = Opt & { readonly offer: (n: Numbers) => ClawsOffer; readonly draw: (rig: Rig, offer: ClawsOffer) => Claws };

/** The face on the front of the carapace (crab coordinates: the base face's brow V at x = 4.93 for the base carapace; a
 * face may place itself from `n.carapace` instead, as face/mask.ts does). `checks` are what this face asks of itself
 * (an eye large enough to read from the game camera, expressions that differ on screen): they join the design's, so a
 * variant with this face passes only if they do. A face that asks nothing returns none. It is given the claws as drawn,
 * so it can ask that they keep off it (`staysInView`; face/brow.ts). */
export type Face = { readonly things: readonly Drawable[]; readonly checks: readonly Check[] };
export type FaceOption = Opt & { readonly draw: (rig: Rig, carapace: Carapace, claws: Claws) => Face };

/** What rides the shell frame (`rig.shell`): the base is the atoll, its reef and the ruined fort. `keepClear` is what a
 * thrown ship must fly clear of besides the atoll's own cylinder, which the design states for every back
 * (reefback_titan.ts, `fliesClear`): a back that builds beyond that cylinder (back/headland.ts: its capes, its light)
 * says where; a back that stays inside it has nothing to add and leaves the field out. */
export type BackOption = Opt & { readonly draw: (rig: Rig) => readonly Drawable[]; readonly keepClear?: (rig: Rig) => readonly Target[] };

/**
 * Who places the two boats when the crab does not hold them (docs/throw_and_shove.md, "The contract"): Loft's stand-ins
 * (base: the scene plays on its own), or the host. `placer` is asked once per boat, with the boat's name (`boat1`,
 * `boat2`: the prefix of its inputs) and where the show starts it.
 */
export type BoatsOption = Opt & { readonly placer: (boat: string, start: { readonly at: readonly [number, number]; readonly heading: number }) => Placer };

/**
 * How white water is printed in the crab's scene (docs/art_direction/DIRECTION.md, "White water"): the collar where
 * anything stands in the sea (a pattern of the woodblock's `foam`), the ring wave's crest (`marksAs`), and the slam's
 * and the landing's burst (`impactPaint`, given the burst's reach). It draws nothing of its own and no check reads it:
 * the design lists the slot under `looks`, so it is picked from the command line (`--variant islander,foam=apron`)
 * without multiplying the combinations.
 */
export type WaterOption = Opt & { readonly collar: ContactFoam; readonly marks: MarksPrint; readonly burst: (reach: number) => ImpactPaint };
