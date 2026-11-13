// A field of pearls: one per cell of a lattice, ray-cast per pixel by walking the cells each view ray crosses
// (`impostors`). The top layer floats on the swell; two layers below are scattered through the water, sparser and
// smaller with depth. Every pearl's size, place, colour and presence come from a hash of its cell; nothing is listed.
import { add, clamp, dot, impostors, lt, mix, mul, pow, saturate, scene, sea, select, sin, sub, time, toon, vec2, vec3 } from "../src/index.ts";
import { hash33, hsv } from "../src/lib/index.ts";

const CELL: [number, number, number] = [1.3, 1.3, 1.3];
const swell = sea({ swell: [{ direction: [1, 0.25], length: 10, height: 0.3, speed: 1.0 }, { direction: [-0.4, 1], length: 4.5, height: 0.08, speed: 0.6 }], foam: 0.22 });

const pearls = impostors("pearls", {
  cell: CELL,
  bounds: { min: [-9, -2.6, -9], max: [9, 0, 9] },
  shape: (c) => {
    const h = c.hash;
    const top = lt(-0.5, c.id.y); // the cell layer at y = 0
    // Present in 85% of the top cells, fewer lower down.
    const keep = lt(h.x, select(top, 0.85, add(0.6, mul(c.id.y, 0.12))));
    const radius = mul(mix(0.2, 0.46, h.y), select(top, 1, 0.7));
    // Jitter in x and z, staying inside the cell.
    const room = sub(CELL[0] / 2, radius);
    const j = hash33(add(c.id, vec3(17, 31, 7)));
    const jitter = vec2(mul(sub(j.x, 0.5), mul(room, 1.9)), mul(sub(j.y, 0.5), mul(room, 1.9)));
    const wx = add(c.centre.x, jitter.x), wz = add(c.centre.z, jitter.y);
    // Afloat: the centre rides the swell (a little more than half submerged); below: a slow drift up and down.
    const afloat = sub(add(swell.height(vec2(wx, wz)), mul(radius, 0.35)), c.centre.y);
    const drift = mul(sin(add(mul(time, 0.8), mul(h.x, 40))), 0.12);
    const y = clamp(select(top, afloat, drift), sub(radius, CELL[1] / 2), sub(CELL[1] / 2, radius));
    return { kind: "sphere", centre: vec3(jitter.x, y, jitter.y), radius: select(keep, radius, 0) };
  },
  paint: ({ normal, cell }) => {
    // Saturated pearl colours (rose, gold, mint, violet, sky) with a pale sheen toward the top.
    const hue = add(mul(cell.hash.z, 0.9), 0.02);
    const base = hsv(hue, 0.62, 1.0);
    const sheen = pow(saturate(dot(normal, vec3(0.2, 0.95, 0.2))), 6);
    return mix(base, vec3(1, 0.97, 0.92), mul(sheen, 0.55));
  },
  cells: 48,
  outline: "silhouette",
});

export default scene({
  ground: swell,
  things: [pearls],
  style: toon({ bands: 3 }),
  sun: [-0.45, 0.8, 0.4],
  cameras: {
    three: { kind: "perspective", eye: [10, 6.5, 11], target: [0, -0.3, 0], fovY: 0.6 },
    front: { kind: "perspective", eye: [0, 2.2, 15], target: [0, -0.4, 0], fovY: 0.6 },
    side: { kind: "perspective", eye: [15, 1.4, 0], target: [0, -0.4, 0], fovY: 0.6 },
    top: { kind: "perspective", eye: [0.01, 17, 0.01], target: [0, 0, 0], fovY: 0.6 },
    close: { kind: "perspective", eye: [2.6, 1.3, 3.2], target: [0.3, -0.3, 0], fovY: 0.6 },
  },
});
