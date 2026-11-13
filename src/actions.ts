// Actions layer: attacks, hit shapes, telegraphs, smears, wakes, grabs, the lineup and the design (variants and slots).
// What a subject does to the world and how a design is chosen.
export { hit, hitSdf, hitPatch, type Hit, type Capsule, type Disc, type Arc } from "./spacetime/hit.ts";
export { attack, animate, part, once, every, hold, ring, INSTANT, STILL, Attack, BodyAttack, type Aftermath, type Ring, type Still, type AttackSpec, type BodyAttackSpec, type RemoteAttackSpec, type RemoteSpec,
  type GripAttackSpec, type GripSpec, type Effect, type Instant, type Hold, type Carry, type CarrySpec, type AttackBeat, type BodyMotion, type Arming, type LungeSpec, type SweepSpec, type Motion, type Timing, type Target, type Part, type Strike, type Creature, type Animated, type Envelope, type Spine } from "./spacetime/attack.ts";
export { telegraph, DANGER, type TelegraphStyle } from "./spacetime/telegraph.ts";
export { smear, type SmearSpec } from "./spacetime/smear.ts";
export { wake, type WakeSpec } from "./spacetime/wake.ts";
export { type RearSpec } from "./spacetime/rear.ts";
export { thrown, tumbled, handTurn, tumbleRate, SET_DOWN, type Ending, type SetDown, type Thrown, type ThrownSpec, type Throw } from "./geom/grab.ts";
export { grab, gripper, heldThing, fingerAngle, pincerAngle, wrap, type AxesSize, type Grab, type GrabBeats, type GrabSpec, type GripperSpec, type Held, type WrapSpec } from "./geom/grab.ts";
export { type Member, type Staged } from "./design.ts";
export { design, Design, DesignError, parseVariantAsk, type Built, type Choice, type DesignSpec, type Option, type Overrides, type Picked, type Resolved, type SlotTable, type VariantAsk, type VariantSpec, type Widen } from "./design.ts";
// ---- one user so far: general or not is unproven until a second subject uses it ----
export { emote, Emote, type EmoteSpec, type EmoteBeat } from "./spacetime/emote.ts";
export { routine, Routine, RoutineError, type Aim, type Dancer, type Readouts, type RoutineSpec, type Solo, type SyncRow, type Who } from "./spacetime/routine.ts";
export { ringWave, RingWave, type RingSpec, type Ride } from "./geom/ring.ts";
export { lineup, type Lineup, type LineupLoop, type Standing } from "./lineup.ts";
