// End to end on real GPU work, at a tiny size: a good scene, a scene whose compile throws, a file that throws on
// import and a non-scene. The failures must be recorded on the page and must not cost the good scene its pictures.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseGalleryArgs } from "../src/cli/gallery_args.ts";
import { gallery } from "../src/cli/gallery.ts";
import { pageFiles, type GalleryData } from "../src/cli/gallery_page.ts";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "loft-gallery-run-"));
  writeFileSync(join(dir, "good.ts"), `export { default } from ${JSON.stringify(resolve("examples/pearls.ts"))};\n`);
  writeFileSync(join(dir, "badcompile.ts"), "export default { things: [{}], ground: {}, sun: [0, 1, 0], cameras: {} };\n");
  writeFileSync(join(dir, "boom.ts"), 'throw new Error("boom at import");\n');
  writeFileSync(join(dir, "helper.ts"), "export const x = 1;\n");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const args = () => parseGalleryArgs(["--out", join(dir, "out"), "--scenes", `${dir}/*.ts`, "--styles", "toon", "--size", "64x40", "--clip-seconds", "0.2"]);
const pageData = (): GalleryData => JSON.parse(/<script type="application\/json" id="data">(.*?)<\/script>/s.exec(readFileSync(join(dir, "out/index.html"), "utf8"))![1]!.replace(/\\u003c/g, "<"));

test("failures are recorded and the run goes on; the page references only files that exist; a second run reuses everything", async () => {
  const first = await gallery(args());
  expect(first.failed).toBe(2);
  const data = pageData();
  const by = Object.fromEntries(data.entries.map((e) => [e.name, e]));
  expect(by.good!.kind).toBe("scene");
  expect(by.badcompile).toMatchObject({ kind: "failed" });
  expect(by.boom).toMatchObject({ kind: "failed", error: expect.stringContaining("boom at import") });
  expect(data.skipped.map((s) => s.name)).toEqual(["helper"]);
  for (const f of pageFiles(data)) expect(existsSync(join(dir, "out", f)), f).toBe(true);

  const second = await gallery(args());
  expect(second.rendered).toBe(0);
  expect(second.reused).toBeGreaterThan(0);
}, 240_000);
