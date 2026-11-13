// The body the sweep-against-reference test poses: everything the old strand's chart depended on (a moving spine reading
// time, a param and a wave; a twist; both tip kinds; a keyed aspect; a boxy section; few stations, so interpolation
// matters), and a part attached to it. The reference values in fixtures/sweep_reference.json were recorded from the
// strand implementation this sweep replaced (commit 1d97739, src/geom/strand.ts + src/compile/charts.ts), before it
// was deleted.
import { add, keys, mul, param, through, time, vec3, wave, type F } from "../src/index.ts";

const probeGirth = keys([[0, 0.4], [0.5, 0.9], [1, 0.3]]);
const probeAspect = keys([[0, 1.4], [1, 0.6]]);
export const probe = {
  spine: (m: F) => add(through(m, [[-4, 0.5, 0], vec3(-1, add(1.2, mul(time, 0.3)), 0.8), vec3(1.5, param("probe.lift", 0.7), -0.6), [4, 2.5, 0.2]]),
    wave(m, { axis: [0, 0, 1], waves: 1.3, rate: 0.6, amplitude: 0.5 })),
  stations: 12,
  girth: (m: F) => mul(probeGirth(m).x, param("probe.girth", 1.1)),
  section: { aspect: (m: F) => probeAspect(m).x, squareness: 3 },
  twist: (m: F) => mul(m, 1.3),
  tips: [{ round: 0.1 }, { point: 0.2 }] as const,
  level: 0.8,
};
/** A bent horn standing on the probe's skin. */
export const stub = {
  spec: { spine: (m: F) => through(m, [[0, -0.05, 0], [0.1, 0.4, 0.05], [0.4, 0.8, 0]]), stations: 6, girth: 0.08, tips: ["open", { point: 0.3 }] as const, up: [1, 0, 0] as const },
  at: { m: 0.37, v: 0.31, rho: 1 },
};
export const TIMES = [0.4, 1.37];
export const SAMPLES: [number, number, number][] = [];
for (const m of [0, 0.003, 0.05, 0.21, 0.5, 0.77, 0.94, 0.999, 1]) for (const v of [0.25, 0.4, 0.61, 0.9, 1.13]) for (const rho of [0, 0.6, 1]) SAMPLES.push([m, v, rho]);
