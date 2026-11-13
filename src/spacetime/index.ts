// Space-time (DESIGN.md 8): attacks defined once from the simulation's hit shape, and what is derived from them by
// evaluating bodies at other times: telegraph, smear, wake. The checks are in src/check.ts.
export { hit, hitSdf, hitPatch, hitContour, hitInradius, type Hit, type Capsule, type Disc, type Arc, type Contour } from "./hit.ts";
export { attack, animate, part, once, every, hold, ring, INSTANT, STILL, Attack, BodyAttack, type Aftermath, type Ring, type Still, type AttackSpec, type BodyAttackSpec, type RemoteAttackSpec, type RemoteSpec,
  type GripAttackSpec, type GripSpec, type Effect, type Instant, type Hold, type Carry, type CarrySpec, type AttackBeat, type BodyMotion, type Arming, type LungeSpec, type SweepSpec, type Motion, type Timing, type Target, type Part, type Strike, type Creature, type Animated, type Envelope, type Spine } from "./attack.ts";
export { telegraph, DANGER, type TelegraphStyle } from "./telegraph.ts";
export { smear, type SmearSpec } from "./smear.ts";
export { wake, type WakeSpec } from "./wake.ts";
export { type RearSpec } from "./rear.ts";
export { emote, Emote, type EmoteSpec, type EmoteBeat } from "./emote.ts";
export { routine, Routine, RoutineError, type Aim, type Dancer, type Key, type Readouts, type RoutineSpec, type Solo, type SyncRow, type Who } from "./routine.ts";
