// Writes tests/fixtures/toon_serpent.rgba.gz: the serpent under `toon`, three-quarter camera, 200x125 at t = 1.3.
// Run once at a commit whose toon output is the reference: `bun tests/fixtures/make_toon_reference.ts`.
// The style tests compare a fresh render against it byte for byte (styles.gpu.test.ts).
import { gzipSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import serpent from "../../examples/serpent.ts";
import { compile } from "../../src/index.ts";
import { headlessDevice } from "../../src/host/headless.ts";
import { createHost } from "../../src/host/index.ts";

export const TOON_REFERENCE = { width: 200, height: 125, time: 1.3, path: new URL("./toon_serpent.rgba.gz", import.meta.url) } as const;

if (import.meta.main) {
  const a = compile(serpent);
  const loaded = await createHost(await headlessDevice()).load(a);
  const rgba = await loaded.frame({ camera: a.cameras.three!, width: TOON_REFERENCE.width, height: TOON_REFERENCE.height, time: TOON_REFERENCE.time });
  loaded.destroy();
  writeFileSync(TOON_REFERENCE.path, gzipSync(rgba, { level: 9 }));
  console.log(`wrote ${TOON_REFERENCE.path.pathname} (${rgba.length} bytes raw)`);
}
