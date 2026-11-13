// The artefact as files (docs/artefact_format.md): what others build on is that a written directory is the same
// artefact, that it draws the same pixels without the compiler, and that nothing JavaScript can slip into it.
import { beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { compile } from "../src/compile/index.ts";
import { fixture } from "../src/host/fixture.ts";
import { headlessDevice } from "../src/host/headless.ts";
import { loadBundle, NotDataError } from "../src/host/host.ts";
import { lower } from "../src/host/lower.ts";
import { readBundle, writeBundle } from "../src/host/files.ts";
import shell from "../examples/shell.ts";
import { closure, LOADER_ENTRIES } from "../tools/check_loader_closure.ts";

let device: GPUDevice;
beforeAll(async () => { device = await headlessDevice(); });

test("the file loader's import closure never reaches the compiler, and the check can fail", () => {
  expect(closure(LOADER_ENTRIES).violations).toEqual([]);
  // A tool that compiles: the same check must catch it (a check that cannot fail proves nothing).
  expect(closure(["tools/pose_time.ts"]).violations.some((v) => v.includes("src/compile"))).toBe(true);
});

test("a written artefact reads back equal, and draws the same pixels as the compiled one", async () => {
  const a = compile(shell);
  const bundle = lower(a);
  const dir = mkdtempSync(join(tmpdir(), "loft-files-"));
  try {
    writeBundle(dir, bundle);
    const back = readBundle(dir);
    expect(back.manifest).toEqual(bundle.manifest);
    expect(back.chunks).toEqual(bundle.chunks);
    expect([...back.blobs.keys()]).toEqual([...bundle.blobs.keys()]);
    for (const [k, v] of bundle.blobs) expect(Buffer.from(back.blobs.get(k)!).equals(Buffer.from(v))).toBe(true);
    const view = { camera: a.cameras.three!, width: 96, height: 64, time: 1.3 };
    const hash = async (b: typeof bundle) => {
      const loaded = await loadBundle(device, b, { kind: "none" });
      // Two frames: the second plans with the first's level-of-detail memory, as a game's frames do.
      await loaded.frame({ ...view, time: 0.4 });
      const px = await loaded.frame(view);
      loaded.destroy();
      return createHash("sha256").update(px).digest("hex");
    };
    expect(await hash(back)).toBe(await hash(bundle));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a cpu table is refused by name: not written, and not loaded without its JavaScript", async () => {
  const bundle = lower(fixture);
  expect(() => writeBundle(join(tmpdir(), "loft-never-written"), bundle)).toThrow(NotDataError);
  expect(() => writeBundle(join(tmpdir(), "loft-never-written"), bundle)).toThrow(/"stations"/);
  await expect(loadBundle(device, bundle, { kind: "none" })).rejects.toThrow(/"stations"/);
});
