// The .glb is read back by a small independent parser: the file must agree with itself and with the mesh data.
import { expect, test } from "bun:test";
import serpent from "../examples/serpent.ts";
import { bakeScene, writeGlb } from "../src/bake/index.ts";

type Json = {
  asset: { version: string };
  scenes: { nodes: number[] }[]; nodes: { name: string; mesh: number }[];
  meshes: { name: string; primitives: { attributes: Record<string, number>; indices: number; material: number; mode: number }[] }[];
  materials: { name: string; doubleSided: boolean }[];
  accessors: { bufferView: number; componentType: number; count: number; type: string; min?: number[]; max?: number[] }[];
  bufferViews: { buffer: number; byteOffset: number; byteLength: number; target: number }[];
  buffers: { byteLength: number }[];
};

function parse(glb: Uint8Array) {
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  expect(dv.getUint32(0, true)).toBe(0x46546c67);
  expect(dv.getUint32(4, true)).toBe(2);
  expect(dv.getUint32(8, true)).toBe(glb.byteLength);
  const jsonLen = dv.getUint32(12, true);
  expect(dv.getUint32(16, true)).toBe(0x4e4f534a);
  expect(jsonLen % 4).toBe(0);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLen))) as Json;
  const binAt = 20 + jsonLen, binLen = dv.getUint32(binAt, true);
  expect(dv.getUint32(binAt + 4, true)).toBe(0x004e4942);
  expect(binLen % 4).toBe(0);
  expect(binAt + 8 + binLen).toBe(glb.byteLength);
  return { json, bin: new DataView(glb.buffer, glb.byteOffset + binAt + 8, binLen) };
}

// Catches: a writer whose counts, offsets, padding or accessor bounds disagree with the data, which Blender would
// reject or (worse) read as garbage.
test("the serpent's .glb parses back with consistent counts, alignment and bounds", () => {
  const baked = bakeScene(serpent, { time: 1, density: { along: 32, around: 12 } });
  const { json, bin } = parse(writeGlb(baked));
  expect(json.asset.version).toBe("2.0");
  expect(json.nodes.map((n) => n.name)).toEqual(baked.bodies.map((b) => b.name));
  expect(json.buffers[0].byteLength).toBe(bin.byteLength);
  let end = 0;
  for (const v of json.bufferViews) {
    expect(v.byteOffset % 4).toBe(0);
    expect(v.byteOffset).toBeGreaterThanOrEqual(end);
    end = v.byteOffset + v.byteLength;
    expect(end).toBeLessThanOrEqual(bin.byteLength);
  }
  const width = { SCALAR: 1, VEC2: 2, VEC3: 3 } as const;
  baked.bodies.forEach((b, k) => {
    const prim = json.meshes[k].primitives[0];
    expect(json.meshes[k].name).toBe(b.name);
    expect(json.materials[prim.material].doubleSided).toBe(b.doubleSided);
    const read = (id: number) => {
      const a = json.accessors[id], view = json.bufferViews[a.bufferView], w = width[a.type as keyof typeof width];
      expect(view.byteLength).toBe(a.count * w * 4);
      const data = a.componentType === 5126
        ? Array.from({ length: a.count * w }, (_, i) => bin.getFloat32(view.byteOffset + 4 * i, true))
        : Array.from({ length: a.count * w }, (_, i) => bin.getUint32(view.byteOffset + 4 * i, true));
      return { a, data, w };
    };
    const pos = read(prim.attributes.POSITION);
    expect(pos.a.count).toBe(b.positions.length / 3);
    expect(pos.data).toEqual(Array.from(b.positions));
    for (let c = 0; c < 3; c++) {
      const col = pos.data.filter((_, i) => i % 3 === c);
      expect(pos.a.min![c]).toBe(Math.min(...col));
      expect(pos.a.max![c]).toBe(Math.max(...col));
    }
    expect(read(prim.attributes.NORMAL).data).toEqual(Array.from(b.normals));
    expect(read(prim.attributes.TEXCOORD_0).data).toEqual(Array.from(b.uvs));
    expect(read(prim.attributes.COLOR_0).data).toEqual(Array.from(b.colors));
    const idx = read(prim.indices);
    expect(idx.data).toEqual(Array.from(b.indices));
    expect(Math.max(...idx.data)).toBe(idx.a.max![0]);
    expect(idx.a.max![0]).toBeLessThan(pos.a.count);
  });
});
