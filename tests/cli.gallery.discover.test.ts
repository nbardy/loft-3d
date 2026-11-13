import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closureHash, discover } from "../src/cli/gallery_discover.ts";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "loft-gallery-"));
  mkdirSync(join(dir, "sub"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const put = (rel: string, text: string) => writeFileSync(join(dir, rel), text);

const SCENE = "export default { things: [], ground: {}, sun: [0, 1, 0], cameras: {} };\n";

test("discovery lists scenes, names every skipped file with its reason, and reports unloadable files", async () => {
  put("a.ts", SCENE);
  put("sub/b.ts", SCENE);
  put("helper.ts", "export const x = 1;\n");
  put("number.ts", "export default 3;\n");
  put("broken.ts", "export default (\n");
  const found = await discover([`${dir}/*.ts`, `${dir}/sub/*.ts`], dir);
  const by = Object.fromEntries(found.map((d) => [d.name, d]));
  expect(Object.keys(by).sort()).toEqual(["a", "b", "broken", "helper", "number"]);
  expect(by.a!.kind).toBe("scene");
  expect(by.b!.kind).toBe("scene");
  expect(by.helper).toMatchObject({ kind: "skipped", reason: "no default export" });
  expect(by.number).toMatchObject({ kind: "skipped", reason: expect.stringContaining("not a scene") });
  expect(by.broken!.kind).toBe("unloadable");
});

test("two files with one basename get distinct names (their media directories must not collide)", async () => {
  put("dup.ts", SCENE);
  put("sub/dup.ts", SCENE);
  const found = await discover([`${dir}/dup.ts`, `${dir}/sub/dup.ts`], dir);
  expect(new Set(found.map((d) => d.name)).size).toBe(2);
});

test("a scene file added later is found without any change to the tool", async () => {
  expect((await discover([`${dir}/sub/*.ts`], dir)).map((d) => d.name)).not.toContain("late");
  put("sub/late.ts", SCENE);
  expect((await discover([`${dir}/sub/*.ts`], dir)).map((d) => d.name)).toContain("late");
});

test("cache key follows relative imports (transitively) and ignores unrelated files", () => {
  put("leaf.ts", "export const k = 1;\n");
  put("mid.ts", 'import { k } from "./leaf.ts";\nexport const m = k;\n');
  put("entry.ts", 'import { m } from "./mid";\nexport default { m };\n');
  put("unrelated.ts", "export const u = 1;\n");
  const before = closureHash(join(dir, "entry.ts"));
  put("unrelated.ts", "export const u = 2;\n");
  expect(closureHash(join(dir, "entry.ts"))).toBe(before);
  put("leaf.ts", "export const k = 2;\n");
  expect(closureHash(join(dir, "entry.ts"))).not.toBe(before);
});
