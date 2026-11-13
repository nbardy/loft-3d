// Motion layer: how a shape moves over time (gaits, looks, breathing, beats, animation principles).
// Time-varying poses and curves, not the shapes themselves.
export { gait, course, type Course, type Gait, type GaitSpec, type Pace } from "./geom/gait.ts";
export { lookAt, breathe, beat, strike, type LookSpec, type BreathSpec, type BeatSpec, type StrikeSpec } from "./geom/motion.ts";
export { looping, alive, anticipated, arc, beats, dragged, echo, exaggerated, impact, overshot, slowIn, slowInOut, slowOut, squash, stretchOf, swing, uneven, type Beat, type Beats } from "./geom/lively.ts";
// ---- one user so far: general or not is unproven until a second subject uses it ----
export { carriage, footing, headingIn, replants, towardIn, type Carriage, type Footing, type FootingSpec, type Replant, type ReplantSpec, type Stamp, type Stance, type StepTiming, type Toward } from "./geom/stance.ts";
export { pose, poseFrame, placedBy, blendFrames, turnedAbout, hosted, STAND_IN, type Pose, type Placer, type StandIn, type Hosted } from "./geom/placing.ts";
export { bent, bentTip, BendError, type Bend, type Bent, type BentSpec } from "./geom/bend.ts";
export { pendulum, sway, jolt, PendulumError, type Drive, type Pendulum, type PendulumSpec } from "./geom/pendulum.ts";
export { dart, chosen, tremor, RestlessError, type Dart, type DartSpec } from "./geom/restless.ts";
export { cast, score, show, only, added, during, ExpressionError, type Cast, type Expression, type Layer, type Posed, type Score } from "./geom/expression.ts";
export { struck, holdsStill, StruckError, type Struck, type StruckSpec } from "./geom/struck.ts";
export { carriedFrame } from "./geom/stance.ts";
