// Checks layer: the measured verdicts on a built subject (reach, clearance, readability, budgets).
// Probes and checks run against what the other layers built.
export { landsInside, staysClear, stopsAt, gripReaches, releasesAt, throwLands, fliesClear, letsGoClean, shoves, frontFirst, warned, tolerance, minScreenSize, budget, runChecks, formatChecks, Probe, type Check, type CheckTime, type Tolerance, type Verdict, type Measured } from "./check.ts";
export { expressionsRead, spansOnScreen, staysInView, limbsReach, type Mark, type Reaching } from "./check.ts";
