// Surface nets (Gibson 1998): a closed triangle mesh of a field's zero set, extracted once from a distance brick's
// samples (src/map/brick.ts) when the scene is compiled. One vertex per fine cell whose corners change sign, at the
// mean of its edges' crossings, then moved onto the surface by one Newton step of the field itself; one quad per fine
// edge that changes sign, joining the vertices of the four cells round it, split along its shorter diagonal. Every
// crossing edge has exactly four cells round it with vertices, so the mesh is closed wherever the surface is a manifold
// at the grid's scale (a feature thinner than a cell can pinch it).
//
// Why the brick's samples are enough: a cell containing a surface point lies in a coarse cell with a point within the
// band, so it has a brick, and its corners (within a cell of the surface) are exact samples; signs elsewhere are right
// by construction. Normals are the field's gradient by central differences on a tetrahedron (four evaluations): the
// symbolic gradient of a folded field costs ~27 field evaluations on the CPU (src/grad.ts differentiates through the
// loop), and a difference at an eighth of a cell is within f32 noise of it on smooth surfaces.

import type { Brick } from "./brick.ts";

type V3 = readonly [number, number, number];

export type TriangleMesh = {
  /** xyz per vertex. */
  readonly positions: Float32Array;
  /** Unit outward normal per vertex (xyz). */
  readonly normals: Float32Array;
  /** Three vertex indices per triangle, counter-clockwise seen from outside. */
  readonly indices: Uint32Array;
};

/** A CPU field: distance at a point (already 1-Lipschitz, at full detail). */
export type CpuField = (x: number, y: number, z: number) => number;

/** Most Newton steps per vertex. */
const NEWTON = 3;

/** The surface's mesh from the brick's samples; `field` is the analytic field the brick was baked from. */
export function surfaceNets(brick: Brick, field: CpuField): TriangleMesh {
  const h = brick.cell, [nx, ny, nz] = brick.dims;
  const B = 8;
  const NI = nx * B, NJ = ny * B, NK = nz * B; // cells per axis
  const cellKey = (i: number, j: number, k: number) => i + NI * (j + NJ * k);
  const vertexOf = new Map<number, number>();
  const pos: number[] = [], nrm: number[] = [];
  const e = h / 8;
  const gradAt = (x: number, y: number, z: number): V3 => {
    // Tetrahedral differences: sum_k s_k f(p + e s_k) over the corners (1,-1,-1), (-1,-1,1), (-1,1,-1), (1,1,1).
    const a = field(x + e, y - e, z - e), b = field(x - e, y - e, z + e), c = field(x - e, y + e, z - e), d = field(x + e, y + e, z + e);
    // The sum is 4 e times the gradient (sum_k s_k s_k^T = 4 I).
    const k = 1 / (4 * e);
    return [(a - b - c + d) * k, (-a - b + c + d) * k, (-a + b - c + d) * k];
  };
  const S = (i: number, j: number, k: number) => brick.sample(i, j, k);

  // Vertices: every fine cell of every brick whose corners change sign.
  const SIDE = B + 1;
  const v = new Float64Array(8);
  for (const { at: [ci, cj, ck], slot } of brick.cells) {
    const own = brick.samples(slot);
    for (let z = 0; z < B; z++) for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) {
      let inside = 0;
      for (let n = 0; n < 8; n++) {
        const s = own[(x + (n & 1)) + SIDE * ((y + ((n >> 1) & 1)) + SIDE * (z + (n >> 2)))]!;
        v[n] = s;
        if (s < 0) inside++;
      }
      if (inside === 0 || inside === 8) continue;
      const i = ci * B + x, j = cj * B + y, k = ck * B + z;
      // A cell on a brick's face is also its neighbour's; it gets one vertex.
      if (vertexOf.has(cellKey(i, j, k))) continue;
      // Mean of the crossings on the cell's 12 edges (corner n and n + bit, for each bit not set in n).
      let sx = 0, sy = 0, sz = 0, c = 0;
      for (let n = 0; n < 8; n++) for (let bit = 1; bit < 8; bit <<= 1) {
        if (n & bit) continue;
        const a = v[n]!, b = v[n | bit]!;
        if ((a < 0) === (b < 0)) continue;
        const t = a / (a - b);
        sx += (n & 1) + (bit === 1 ? t : 0); sy += ((n >> 1) & 1) + (bit === 2 ? t : 0); sz += (n >> 2) + (bit === 4 ? t : 0); c++;
      }
      let px = brick.origin[0] + (i + sx / c) * h, py = brick.origin[1] + (j + sy / c) * h, pz = brick.origin[2] + (k + sz / c) * h;
      // Newton steps onto the surface along the gradient (one lands exactly for a true distance where it is smooth; near
      // an edge of a solid the differences straddle a crease and it takes a second or third), each kept within a cell
      // so a thin feature's far side cannot pull the vertex across it.
      let g: V3 = [0, 1, 0];
      for (let it = 0; it < NEWTON; it++) {
        const f0 = field(px, py, pz);
        if (it > 0 && Math.abs(f0) < 1e-3 * h) break;
        const gg = gradAt(px, py, pz);
        const gl = Math.hypot(gg[0], gg[1], gg[2]);
        if (!(gl > 0)) break;
        g = [gg[0] / gl, gg[1] / gl, gg[2] / gl];
        const step = Math.max(-h, Math.min(h, f0 / gl));
        px -= g[0] * step; py -= g[1] * step; pz -= g[2] * step;
      }
      const [nx_, ny_, nz_] = g;
      vertexOf.set(cellKey(i, j, k), pos.length / 3);
      pos.push(px, py, pz);
      nrm.push(nx_, ny_, nz_);
    }
  }

  // Faces: each fine edge from grid point (i, j, k) along axis a that changes sign is the min-corner edge of cell
  // (i, j, k) along a; the four cells round it are that cell and its neighbours at -1 along the other two axes.
  const idx: number[] = [];
  const AX: readonly V3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const d2 = (a: number, b: number) => (pos[a * 3]! - pos[b * 3]!) ** 2 + (pos[a * 3 + 1]! - pos[b * 3 + 1]!) ** 2 + (pos[a * 3 + 2]! - pos[b * 3 + 2]!) ** 2;
  for (const key of vertexOf.keys()) {
    const i = key % NI, j = Math.floor(key / NI) % NJ, k = Math.floor(key / (NI * NJ));
    for (let a = 0; a < 3; a++) {
      const b = (a + 1) % 3, c = (a + 2) % 3;
      const s0 = S(i, j, k), s1 = S(i + AX[a]![0], j + AX[a]![1], k + AX[a]![2]);
      if ((s0 < 0) === (s1 < 0)) continue;
      const cell = (db: number, dc: number): number => {
        const q = [i, j, k];
        q[b] -= db; q[c] -= dc;
        if (q[0]! < 0 || q[1]! < 0 || q[2]! < 0 || q[0]! >= NI || q[1]! >= NJ || q[2]! >= NK) throw new Error(`surfaceNets: brick "${brick.name}": the surface reaches the edge of the sampled box (the solid must lie inside its bound)`);
        const vtx = vertexOf.get(cellKey(q[0]!, q[1]!, q[2]!));
        if (vtx === undefined) throw new Error(`internal: surfaceNets: brick "${brick.name}": a crossing edge at (${i}, ${j}, ${k}) axis ${a} has a cell without a vertex`);
        return vtx;
      };
      // Round the edge counter-clockwise seen from +a: (0,0), (-b), (-b-c), (-c). That faces +a; the outside is +a
      // when the edge goes from inside (s0 < 0) to outside.
      const q0 = cell(0, 0), q1 = cell(1, 0), q2 = cell(1, 1), q3 = cell(0, 1);
      const quad = s0 < 0 ? [q0, q1, q2, q3] : [q0, q3, q2, q1];
      if (d2(quad[0]!, quad[2]!) <= d2(quad[1]!, quad[3]!)) idx.push(quad[0]!, quad[1]!, quad[2]!, quad[0]!, quad[2]!, quad[3]!);
      else idx.push(quad[0]!, quad[1]!, quad[3]!, quad[1]!, quad[2]!, quad[3]!);
    }
  }
  return { positions: Float32Array.from(pos), normals: Float32Array.from(nrm), indices: Uint32Array.from(idx) };
}
