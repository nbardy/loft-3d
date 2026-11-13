// Attacks defined once (src/spacetime, src/check.ts): the posed body lands where the specification says for any
// target, the telegraph draws exactly the simulation's hit shape, the checks give the right verdicts on good and bad
// attacks, and a smear's copies are the body at earlier times.
import { expect, test } from "bun:test";
import strike, { checks, strikes } from "../examples/strike.ts";
import { PRELUDE_WGSL, SCENE_CLEARANCE_WGSL, SCENE_DEPTH_WGSL, type Artefact } from "../src/artefact.ts";
import {
  attack, compile, f, fetch, hit, hitSdf, landsInside, Probe, runChecks, scene, sea, staysClear, stopsAt, sub, telegraph, time, toon, vec2,
  type Check, type Hit, type Target,
} from "../src/index.ts";
import { compileScene } from "../src/compile/index.ts";
import { cameraMatrices, createHost, project } from "../src/host/index.ts";
import { FRAGMENT, gpu, layouts, VERTEX } from "./compile.harness.ts";

const compiled = compileScene(strike);
const ARM = 2.4, LASH_ARM = 5.6;

// Catches: a change to the motion (the envelopes, the mixing weight, the retarded clock, the landing rule) that leaves
// the striking end somewhere other than the specification's point at the arming time, or that only holds for the
// default target. The expected point is recomputed here in plain numbers from the inputs, not from the library.
test("at the arming time the striking end is where the specification says, for any target position", () => {
  // The serpent's body: its m = 0 is the spine end the lunge places (the head rides it), its m = 1 the sweep's tip.
  const body = strikes.lash.part.body;
  for (const ship of [[14.5, 1.5], [13.2, -2.6], [15.6, 4.2], [12.4, 0.3]] as const) {
    const probe = new Probe(compiled, { "ship.at": [...ship] });
    const end = probe.eval([body.skeleton.joint(0).p], ARM)[0] as number[];
    // Lane from the anchor (7.4, 0) to the ship; b is 0.53 short of the ship's centre (the half-beam 0.95 less 0.42, so
    // the tip touches the hull); the tip lands half the radius (0.95) short of b; the spine end lands 1.95 (the lead)
    // behind the tip at height 0.8.
    const d = [ship[0] - 7.4, ship[1]], l = Math.hypot(d[0], d[1]), u = [d[0] / l, d[1] / l];
    const back = 0.53 + 0.475 + 1.95;
    const want = [ship[0] - u[0] * back, 0.8, ship[1] - u[1] * back];
    for (let c = 0; c < 3; c++) expect(Math.abs(end[c] - want[c])).toBeLessThan(1e-3);
    // And not just at an instant that happens to agree: a frame before, the end is still on its way.
    const before = probe.eval([body.skeleton.joint(0).p], ARM - 0.05)[0] as number[];
    expect(Math.hypot(before[0] - want[0], before[2] - want[2])).toBeGreaterThan(0.05);
  }
  // The sweep's tip (m = 1) lands on the arc's outer radius less the inset, the inset inside the arc's end angle.
  for (const ship of [[-3.3, -5.8], [-1.2, -5.9]] as const) {
    const probe = new Probe(compiled, { "ship2.at": [...ship] });
    const tip = probe.eval([body.skeleton.joint(body.skeleton.joints - 1).p], LASH_ARM)[0] as number[];
    const q = [ship[0] + 3, ship[1]], range = Math.hypot(q[0], q[1]);
    const from = Math.PI - 0.25;
    const bearing = from + (((Math.atan2(q[1], q[0]) - from) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    // The arc ends short of the ship's bearing by the angle 0.87 subtends at its range (the half-beam 0.95 less 0.08).
    const rho = 7.4 - 0.45, angle = bearing - 0.87 / range - 0.45 / rho;
    expect(Math.abs(tip[0] - (-3 + rho * Math.cos(angle)))).toBeLessThan(1e-3);
    expect(Math.abs(tip[2] - rho * Math.sin(angle))).toBeLessThan(1e-3);
  }
});

// Catches: a slice that reads the live table, a substitution of `time` that misses a clock (the attack's retarded
// clocks, the sea), or a memo keyed on the wrong thing. Copy k of the smear must be the body at t - k dt exactly.
test("a body taken for the smear at t - dt is the body at that time", () => {
  const head = strikes.bite.part.body;
  const probe = new Probe(compiled, {});
  for (const k of [1, 3]) {
    const slice = head.at(sub(time, k * (0.12 / 4)));
    const read = (t: typeof head) => Array.from({ length: t.table.entries * 3 }, (_, i) => fetch(t.table, Math.floor(i / 3), i % 3));
    for (const t of [2.2, 2.31]) {
      const copy = probe.eval(read(slice), t) as number[][];
      const live = probe.eval(read(head), t - k * 0.03) as number[][];
      for (let i = 0; i < copy.length; i++) for (let c = 0; c < 4; c++) expect(Math.abs(copy[i][c] - live[i][c])).toBeLessThan(1e-4 * Math.max(1, Math.abs(live[i][c])));
    }
  }
});

// Catches: a check that cannot fail. The example's own checks pass; a narrow lane (the head cannot fit) fails
// landsInside, a target placed on the lane fails staysClear and stopsAt (the head passes through it before arming).
test("checks pass the example's attacks and fail a bad one", () => {
  const good = runChecks(strike, checks, { compiled });
  expect(good.filter((v) => !v.pass).map((v) => v.name)).toEqual([]);

  const narrow = runChecks(strike, [landsInside(strikes.bite)], { compiled, inputs: { "bite.radius": 0.25 } })[0];
  expect(narrow.pass).toBe(false);
  expect(narrow.value).toBeGreaterThan(0.2);

  const inTheWay: Target = { kind: "disc", centre: vec2(10.2, 0.75), radius: f(0.4) };
  const early: Check[] = [staysClear(strikes.bite.part, inTheWay, { until: strikes.bite.attack.arm }), stopsAt(strikes.bite, inTheWay)];
  for (const v of runChecks(strike, early, { compiled })) expect(v.pass).toBe(false);
}, 120000); // the skin targets (src/geom/skin_distance.ts) take 3-10 s of CPU on a loaded machine

// ---- the telegraph against the analytic shape, on a real render ---------------------------------------------------

const calm = sea({ swell: [{ direction: [1, 0], length: 40, height: 0.001, speed: 0.1 }] });
const shapes: Record<string, Hit> = {
  capsule: hit.capsule({ a: [-3, -1], b: [3, 1.5], radius: 1.1 }),
  disc: hit.disc({ centre: [0.5, -0.3], radius: 2.6 }),
  arc: hit.arc({ centre: [-1, -3], inner: 1.5, outer: 5, from: 0.4, to: 2.2 }),
};

// Catches: a marker drawn from anything but the hit shape's distance (a footprint, a box, a wrong patch that clips the
// shape, teeth or ink that leak out of it, an arc patch that misses an end). The marker's covered pixels are compared
// with the analytic shape away from a band at its edge two pixels plus the ink line wide.
test("the telegraph covers exactly the hit shape (capsule, disc, arc)", async () => {
  const host = createHost(await gpu());
  const W = 400, H = 400, camera = { kind: "orthographic", eye: [0, 30, 0.001], target: [0, 0, 0], height: 14 } as const;
  const m = cameraMatrices(camera, W / H), pixel = 14 / H;
  for (const [name, h] of Object.entries(shapes)) {
    const a = attack({ name: `t_${name}`, arm: 3, warn: 2, target: { kind: "disc", centre: vec2(50, 50), radius: f(1) }, part: "none", motion: h.kind === "arc" ? { kind: "sweep", hit: h, root: 0.5, height: 0, inset: 0 } : { kind: "lunge", hit: h, reach: 0.3, lead: 1, height: 0, coil: 0, rise: 0, approach: 0, neck: 1 } });
    const loaded = await host.load(compile(scene({ ground: calm, things: [telegraph(a)], style: toon(), sun: [0.2, 1, 0.1] })));
    const water = await loaded.frame({ camera, width: W, height: H, time: 0 });
    const marked = await loaded.frame({ camera, width: W, height: H, time: 2.5 });
    loaded.destroy();
    const probe = new Probe(compileScene(scene({ ground: calm, things: [telegraph(a)], style: toon(), sun: [0.2, 1, 0.1] })), {});
    const sdf = probe.planar((p) => hitSdf(h, p), 0);
    let wrong = 0, inside = 0;
    for (let x = -6.8; x < 6.8; x += 0.05) for (let z = -6.8; z < 6.8; z += 0.05) {
      const d = sdf(x, z);
      if (Math.abs(d) < 2 * pixel + 0.06 + 0.13) continue; // the antialiased edge and the ink line outside it
      const q = project(m, [x, 0, z], W, H);
      const i = (Math.floor(q.y) * W + Math.floor(q.x)) * 4;
      const changed = Math.abs(marked[i] - water[i]) + Math.abs(marked[i + 1] - water[i + 1]) + Math.abs(marked[i + 2] - water[i + 2]) > 12;
      if (d < 0) inside++;
      if (changed !== d < 0) wrong++;
    }
    expect(inside).toBeGreaterThan(500);
    expect({ name, wrong }).toEqual({ name, wrong: 0 });
  }
}, 120000);

// Catches: WGSL from the telegraph, smear or wake that Dawn rejects, and draws whose state cannot make a pipeline.
test("the strike example's shaders build pipelines", async () => {
  const dev = await gpu();
  const a: Artefact = compiled.artefact;
  const [g0, g1] = layouts(dev, a, VERTEX | FRAGMENT);
  const depth = dev.createBindGroupLayout({ entries: [0, 1].map((binding) => ({ binding, visibility: VERTEX | FRAGMENT, texture: { sampleType: "unfilterable-float" as const } })) });
  const errors: string[] = [];
  for (const d of a.draws) {
    dev.pushErrorScope("validation");
    const module = dev.createShaderModule({ code: PRELUDE_WGSL + (d.sceneDepth === true ? SCENE_DEPTH_WGSL + SCENE_CLEARANCE_WGSL : "") + a.sceneWgsl + a.shaders[d.shader] });
    try {
      await dev.createRenderPipelineAsync({
        layout: dev.createPipelineLayout({ bindGroupLayouts: d.sceneDepth === true ? [g0, g1, depth] : [g0, g1] }),
        vertex: { module, entryPoint: "vs", constants: d.constants },
        fragment: { module, entryPoint: "fs", constants: d.constants, targets: [{ format: "rgba8unorm" }] },
        primitive: { topology: "triangle-list", cullMode: d.cull },
        depthStencil: { format: "depth32float", depthWriteEnabled: d.depthWrite, depthCompare: "less" },
        multisample: { count: 4 },
      });
    } catch (e) { errors.push(`${d.label}: ${e instanceof Error ? e.message : String(e)}`); }
    const err = await dev.popErrorScope();
    if (err) errors.push(`${d.label}: ${err.message}`);
  }
  expect(errors).toEqual([]);
}, 120000);
