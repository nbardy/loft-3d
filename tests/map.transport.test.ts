// Frames transported along a spine (src/map/transport.ts) and the sweep's reading of them (`stationSample`, the
// expressions both backends evaluate), on spines with known answers.
import { expect, test } from "bun:test";
import { compileJs, f, lift, listOf, variable, vec4, type TableSource } from "../src/expr.ts";
import { readTablesAlone } from "../src/compile/index.ts";
import { stationSample } from "../src/map/sweep.ts";
import { qrot, quatFromColumns, SAMPLE_VEC4S, STATION_VEC4S, stationScan, v3, type V3 } from "../src/map/transport.ts";

/** The interpolated station of a posed table at m, through the same expressions the vertex stage runs. */
function stationAt(table: Float32Array, count: number, m: number): { p: V3; der: V3 } {
  const t: TableSource = { name: "probe", lanes: STATION_VEC4S, entries: count, role: "stations", prepare: () => () => {} };
  const s = stationSample(t, variable("m", "f32"));
  const [p, der] = compileJs([s.p, s.der])({ vars: { m }, inputs: {}, params: {}, tables: () => table }) as V3[];
  return { p, der };
}

type Spec = { readonly local?: readonly V3[]; readonly rest?: readonly V3[]; readonly level?: number };
const N = 64;
/** The station table's program (the scan the pose stages run) read on the CPU, over constant samples. */
function posed(pos: V3[], extra: Spec = {}): Float32Array {
  const local = extra.local ?? pos, rest = extra.rest ?? pos;
  const samples: TableSource = {
    name: "samples", lanes: SAMPLE_VEC4S, entries: pos.length, role: "data",
    program: listOf(pos.map((p, k) => [vec4(...p, 0), vec4(...local[k]!, 0.5), vec4(...rest[k]!, 1)])),
  };
  const up = lift<"vec3">([0, 1, 0]);
  const stations: TableSource = {
    name: "stations", lanes: STATION_VEC4S, entries: pos.length, role: "stations",
    program: stationScan({ samples, first: 0, steps: pos.length, up, level: { up, rate: extra.level ?? 0 }, restStart: f(0), leastStretch: 0.05 }),
  };
  return readTablesAlone([stations])(stations);
}
const frameAt = (t: Float32Array, k: number) => {
  const q = Array.from(t.subarray(k * 12 + 4, k * 12 + 8));
  return { t: qrot(q, [1, 0, 0]), d: qrot(q, [0, 1, 0]), s: qrot(q, [0, 0, 1]) };
};

// Catches: a sign or ordering error in the double reflection, which leaves the frame rolling about the tangent. On a
// helix the Frenet frame rolls at the torsion rate; a rotation-minimising frame does not roll at all, so the roll per
// unit length, d(dorsal)/ds . side, must vanish (to the method's O(h^2)), while the torsion here is 0.24.
test("frames on a helix are rotation-minimising: no roll about the tangent", () => {
  const r = 2, c = 1.2; // torsion c / (r^2 + c^2) = 0.24 per unit length
  const pos = Array.from({ length: N }, (_, k): V3 => { const a = (k / (N - 1)) * 4 * Math.PI; return [r * Math.cos(a), c * a, r * Math.sin(a)]; });
  const t = posed(pos);
  let worst = 0;
  for (let k = 1; k + 1 < N; k++) {
    const a = frameAt(t, k - 1), b = frameAt(t, k + 1);
    const ds = v3.len(v3.sub(pos[k + 1], pos[k - 1]));
    const mid = frameAt(t, k);
    worst = Math.max(worst, Math.abs(v3.dot(v3.sub(b.d, a.d), mid.s)) / ds);
  }
  expect(worst).toBeLessThan(0.24 / 50);
});

// Catches: a frame that flips (pops through 180 degrees) where the spine turns past vertical, the failure the
// rotation-minimising frame exists to prevent; and levelling that over-corrects there.
test("a neck that rises past vertical and leans back keeps a continuous back", () => {
  const pos = Array.from({ length: N }, (_, k): V3 => { const a = (k / (N - 1)) * 0.8 * Math.PI * 2; return [Math.sin(a) * 3, 3 - Math.cos(a) * 3, 0.4 * a]; });
  for (const level of [0, 1.2]) {
    const t = posed(pos, { level });
    for (let k = 1; k < N; k++) expect(v3.dot(frameAt(t, k - 1).d, frameAt(t, k).d)).toBeGreaterThan(0.95);
  }
});

// Catches: the quaternion packing and the WGSL/JS `qrot` disagreeing on convention (columns vs rows, w first or last).
test("a quaternion built from frame columns rotates the axes back onto them", () => {
  const t = v3.unit([0.3, -0.8, 0.52]), d = v3.unit(v3.cross([0.1, 0.2, 1], t)), s = v3.cross(t, d);
  const q = quatFromColumns(t, d, s);
  for (const [axis, want] of [[[1, 0, 0], t], [[0, 1, 0], d], [[0, 0, 1], s]] as [V3, V3][]) {
    const got = qrot(q, axis);
    for (let i = 0; i < 3; i++) expect(Math.abs(got[i] - want[i])).toBeLessThan(1e-12);
  }
});

// Catches: volume preservation scaled the wrong way, or stretch measured against the wrong rest. Squashing a straight
// spine to half its rest length must fatten the section by sqrt(2), keeping section area times length.
test("compressing a strand to half its length keeps its volume", () => {
  const rest = Array.from({ length: N }, (_, k): V3 => [(k / (N - 1)) * 10, 0, 0]);
  const now = rest.map((p): V3 => [p[0] * 0.5, 0, 0]);
  const t = posed(now, { rest });
  for (const k of [0, 20, N - 1]) {
    const o = k * 12;
    expect(t[o + 10]).toBeCloseTo(0.5, 6); // stretch
    const area = t[o + 8] * t[o + 9];
    expect(area * 5).toBeCloseTo(0.25 * 10, 5); // half-width 0.5 at rest, length 10 at rest
  }
});

// Catches: the interpolated spine missing the stations it interpolates, or the derivative scaled per index instead of per m.
test("the station sample passes through the stations and its derivative matches the curve", () => {
  const pos = Array.from({ length: 9 }, (_, k): V3 => [k, Math.sin(k * 0.7) * 2, Math.cos(k * 0.4)]);
  const t = posed(pos);
  for (let k = 0; k < 9; k++) {
    const p = stationAt(t, 9, k / 8).p;
    for (let i = 0; i < 3; i++) expect(Math.abs(p[i] - pos[k][i])).toBeLessThan(1e-6);
  }
  const h = 1e-5, m = 0.43;
  const fd = v3.scale(v3.sub(stationAt(t, 9, m + h).p, stationAt(t, 9, m - h).p), 1 / (2 * h));
  const der = stationAt(t, 9, m).der;
  for (let i = 0; i < 3; i++) expect(Math.abs(fd[i] - der[i])).toBeLessThan(1e-3 * Math.max(1, Math.abs(der[i])));
});
