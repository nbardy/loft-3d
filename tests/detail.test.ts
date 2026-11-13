// Level of detail on the CPU: what the host would choose for the real serpent, frame by frame, without a GPU.
import { expect, test } from "bun:test";
import serpent from "../examples/serpent.ts";
import { CELL_PIXELS, DETAIL_SLOTS, type Artefact, type Camera, type Detail } from "../src/artefact.ts";
import { compile } from "../src/index.ts";
import { boundsFrom, planFrame, type Memory } from "../src/host/detail.ts";
import { viewState } from "../src/host/host.ts";

const a: Artefact = compile(serpent);
const W = 1280, H = 800, FOV = 0.6;
const target: readonly [number, number, number] = [0, 1, 0];
const dir = (() => { const d = [16, 34, 22]; const l = Math.hypot(...d); return d.map((x) => x / l); })();
const cameraAt = (distance: number): Camera => ({ kind: "perspective", eye: [target[0] + dir[0]! * distance, target[1] + dir[1]! * distance, target[2] + dir[2]! * distance], target, fovY: FOV });

type Grid = Extract<Detail, { kind: "grid" }>;
const grids = new Map<number, { readonly detail: Grid; readonly instances: number; readonly label: string }>();
for (const d of a.draws) if (d.detail.kind === "grid") grids.set(d.detail.slot, { detail: d.detail, instances: d.instances, label: d.label });

/** One frame's choice: per grid slot and instance, the level (-1 skipped), and the bounds the pose gave. */
function choose(distance: number, memory: Memory) {
  const view = { camera: cameraAt(distance), width: W, height: H, time: 1 };
  const tables = a.pose(viewState(a, view));
  const out = new Float32Array(DETAIL_SLOTS * 4);
  const plan = planFrame(a.draws, view, boundsFrom(a.draws, tables), memory, out);
  return { tables, out, plan, levels: new Map([...memory].map(([slot, l]) => [slot, [...l]])) };
}

// Catches: a level rule that is off by a level (cells twice the target, or half), a bound read from the wrong place in
// the tables, or a pixel scale computed with the wrong axis. Measured independently here: the pixel size at the
// sphere's nearest point from the camera's own geometry (distance along the view direction, tan of half the fov).
test("from scratch, each body's cells are between 1/2.2 and 1 times the pixel target across a 30x dolly", () => {
  let checked = 0;
  for (let distance = 12; distance <= 360; distance *= 1.15) {
    const { tables, levels } = choose(distance, new Map());
    const eye = cameraAt(distance).eye;
    const fwd = [-dir[0]!, -dir[1]!, -dir[2]!];
    for (const [slot, g] of grids) {
      const t = tables[g.detail.bound.buffer]!;
      levels.get(slot)!.forEach((level, i) => {
        if (level < 0) return;
        const b = (g.detail.bound.offset + i) * 4;
        const scale = Math.abs(t[b + 3]!);
        const depth = (t[b]! - eye[0]) * fwd[0]! + (t[b + 1]! - eye[1]) * fwd[1]! + (t[b + 2]! - eye[2]) * fwd[2]! - scale * g.detail.radius;
        const pxPerUnit = H / (2 * Math.tan(FOV / 2) * Math.max(depth, 1e-3));
        const cellPx = scale * g.detail.levels[level]!.cell * pxPerUnit;
        const finest = level === 0, coarsest = level === g.detail.levels.length - 1;
        if (!finest) expect([g.label, cellPx <= CELL_PIXELS * 1.0001]).toEqual([g.label, true]);
        if (!coarsest) expect([g.label, cellPx > CELL_PIXELS / 2.2]).toEqual([g.label, true]);
        checked++;
      });
    }
  }
  expect(checked).toBeGreaterThan(200);
});

// Catches: flicker between two levels when a camera hovers near a boundary (the hysteresis lost, or applied the wrong
// way round). A camera breathing 3% in and out near every distance of a sweep must switch no level after its first
// frame, while choosing afresh each frame would switch at least once somewhere in the same sweep (so the sweep does
// cross boundaries).
test("no level switches while the camera breathes 3% around a distance; afresh it would switch", () => {
  let fresh = 0, kept = 0;
  for (let d0 = 15; d0 < 200; d0 *= 1.07) {
    const memory: Memory = new Map();
    let last: Map<number, number[]> | undefined, lastFresh: Map<number, number[]> | undefined;
    for (let k = 0; k < 24; k++) {
      const d = d0 * (1 + 0.03 * Math.sin(k * 0.7));
      const now = choose(d, memory).levels;
      const afresh = choose(d, new Map()).levels;
      const switches = (a?: Map<number, number[]>, b?: Map<number, number[]>) => a === undefined || b === undefined ? 0 : [...b].reduce((n, [s, l]) => n + l.filter((x, i) => x !== a.get(s)![i]).length, 0);
      kept += switches(last, now);
      fresh += switches(lastFresh, afresh);
      last = now; lastFresh = afresh;
    }
  }
  expect(fresh).toBeGreaterThan(0);
  expect(kept).toBe(0);
});

// Catches: a level sequence that goes back and forth on a slow monotone dolly (popping): as the camera only recedes,
// every instance's level only ever gets coarser. (It may skip a level: once one axis sits at its floor, halving the
// other leaves the cell size, set by the floored axis, unchanged, and both levels qualify together.)
test("a slow dolly out only ever coarsens each level", () => {
  const memory: Memory = new Map();
  let last: Map<number, number[]> | undefined;
  let switches = 0;
  for (let k = 0; k <= 300; k++) {
    const now = choose(20 * Math.pow(10, k / 300), memory).levels;
    if (last) for (const [slot, levels] of now) levels.forEach((l, i) => {
      const before = last!.get(slot)![i]!;
      if (l < 0 || before < 0) return; // culled below a pixel: not a level
      expect([grids.get(slot)!.label, i, k, l >= before ? "ok" : `${before}->${l}`]).toEqual([grids.get(slot)!.label, i, k, "ok"]);
      if (l !== before) switches++;
    });
    last = now;
  }
  expect(switches).toBeGreaterThan(0);
});
