// A body expressed through `sweep` (and a part placed on it) against values recorded from the strand implementation it
// replaced, before that was deleted (see tests/sweep.fixture.ts). When recorded, the sweep matched them to 4e-8 on the
// body and 2.3e-7 on the placed part (f32 storage of the posed tables): anything past 1e-5 is a changed body.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { on, place, scene, sea, strand, toon, variable } from "../src/index.ts";
import { compileScene } from "../src/compile/index.ts";
import { stateAt } from "./compile.harness.ts";
import { probe, SAMPLES, stub, TIMES } from "./sweep.fixture.ts";

const reference = JSON.parse(readFileSync(new URL("./fixtures/sweep_reference.json", import.meta.url), "utf8")) as Record<string, number[][]>;

// Catches: any change to what a body is: the transport of frames, the interpolation between stations, the section, the
// tips, the chart's frame axes, volume preservation, or how a placed part follows its host's chart.
test("a sweep and a part placed on it reproduce the recorded strand surface and chart", () => {
  const body = strand({ name: "probe", ...probe, paint: [1, 0, 0] });
  const part = place(strand({ name: "stub", ...stub.spec, paint: [1, 1, 1] }), on(body, [stub.at.m, stub.at.v, stub.at.rho]));
  const c = compileScene(scene({ ground: sea({ swell: [] }), things: [body, part], style: toon(), sun: [0, 1, 0] }));
  const k = variable("c", "vec3");
  let worst = 0;
  for (const [name, b] of [["probe", body], ["stub", part]] as const) {
    const fr = b.frame(k);
    const run = c.cpu([b.point(k.x, k.y), b.normal(k.x, k.y), fr.o, fr.x, fr.y, fr.z]);
    for (const t of TIMES) {
      const frame = c.frame(stateAt(c.artefact, t));
      SAMPLES.forEach((s, i) => {
        const [pos, normal, o, x, y, z] = run(frame, { c: s }) as number[][];
        const got = [...o, ...normal, ...x, ...y, ...z];
        reference[`${name}@${t}`][i].forEach((want, j) => { worst = Math.max(worst, Math.abs(got[j] - want)); });
        // The skin is the chart at rho = 1.
        if (s[2] === 1) pos.forEach((p, j) => { worst = Math.max(worst, Math.abs(p - o[j])); });
      });
    }
  }
  expect(worst).toBeLessThan(1e-5);
});
