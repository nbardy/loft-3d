// A glTF 2.0 binary (.glb), written by hand. Layout: 12-byte header, a JSON chunk (padded with spaces), a BIN chunk
// (padded with zeros); every chunk and every buffer view starts on a 4-byte boundary. All data is float32 or uint32,
// so tightly packed attribute views are aligned by construction. glTF is y-up, right-handed, counter-clockwise front
// faces: the same as Loft's world, so positions go through unchanged.

import { triangleCount, vertexCount, type Baked, type BodyMesh } from "./mesh.ts";

const MAGIC = 0x46546c67, VERSION = 2, JSON_CHUNK = 0x4e4f534a, BIN_CHUNK = 0x004e4942;
const ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963, FLOAT = 5126, UNSIGNED_INT = 5125;

type Accessor = Record<string, unknown>;

function bounds(a: Float32Array, width: number): { min: number[]; max: number[] } {
  const min = new Array<number>(width).fill(Infinity), max = new Array<number>(width).fill(-Infinity);
  for (let i = 0; i < a.length; i++) {
    const c = i % width;
    if (a[i] < min[c]) min[c] = a[i];
    if (a[i] > max[c]) max[c] = a[i];
  }
  return { min, max };
}

const pad4 = (n: number): number => (n + 3) & ~3;

/** Writes the bodies, one node and one mesh each, named after the body. */
export function writeGlb(baked: Baked): Uint8Array {
  if (baked.bodies.length === 0) throw new Error("writeGlb: nothing to write (the scene has no bakeable body)");
  const chunks: Uint8Array[] = [];
  const bufferViews: Record<string, unknown>[] = [];
  const accessors: Accessor[] = [];
  let offset = 0;

  const view = (bytes: Uint8Array, target: number): number => {
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, target });
    const padded = new Uint8Array(pad4(bytes.byteLength));
    padded.set(bytes);
    chunks.push(padded);
    offset += padded.byteLength;
    return bufferViews.length - 1;
  };
  const attribute = (data: Float32Array, type: "VEC2" | "VEC3", width: number, withBounds: boolean): number => {
    const bufferView = view(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), ARRAY_BUFFER);
    accessors.push({ bufferView, componentType: FLOAT, count: data.length / width, type, ...(withBounds ? bounds(data, width) : {}) });
    return accessors.length - 1;
  };
  const indices = (b: BodyMesh): number => {
    const bufferView = view(new Uint8Array(b.indices.buffer, b.indices.byteOffset, b.indices.byteLength), ELEMENT_ARRAY_BUFFER);
    let lo = Infinity, hi = -Infinity;
    for (const i of b.indices) { if (i < lo) lo = i; if (i > hi) hi = i; }
    accessors.push({ bufferView, componentType: UNSIGNED_INT, count: b.indices.length, type: "SCALAR", min: [lo], max: [hi] });
    return accessors.length - 1;
  };

  const meshes: unknown[] = [], materials: unknown[] = [], nodes: unknown[] = [];
  baked.bodies.forEach((b, k) => {
    materials.push({
      name: b.name,
      pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 },
      doubleSided: b.doubleSided,
    });
    meshes.push({
      name: b.name,
      primitives: [{
        attributes: {
          POSITION: attribute(b.positions, "VEC3", 3, true),
          NORMAL: attribute(b.normals, "VEC3", 3, false),
          TEXCOORD_0: attribute(b.uvs, "VEC2", 2, false),
          COLOR_0: attribute(b.colors, "VEC3", 3, false),
        },
        indices: indices(b),
        material: k,
        mode: 4,
      }],
    });
    nodes.push({ name: b.name, mesh: k });
  });

  const json = {
    asset: { version: "2.0", generator: "loft bake" },
    scene: 0,
    scenes: [{ name: "loft", nodes: nodes.map((_, i) => i) }],
    nodes, meshes, materials, accessors, bufferViews,
    buffers: [{ byteLength: offset }],
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = pad4(jsonBytes.byteLength);
  const total = 12 + 8 + jsonLen + 8 + offset;
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true); dv.setUint32(4, VERSION, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true); dv.setUint32(16, JSON_CHUNK, true);
  out.fill(0x20, 20, 20 + jsonLen);
  out.set(jsonBytes, 20);
  const binAt = 20 + jsonLen;
  dv.setUint32(binAt, offset, true); dv.setUint32(binAt + 4, BIN_CHUNK, true);
  let at = binAt + 8;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

/** One line per body: the counts the CLI prints. */
export function summary(baked: Baked): string[] {
  return baked.bodies.map((b) => `${b.name.padEnd(14)} ${(b.closed ? "solid" : "sheet").padEnd(7)} ${String(vertexCount(b)).padStart(7)} vertices ${String(triangleCount(b)).padStart(7)} triangles`);
}
