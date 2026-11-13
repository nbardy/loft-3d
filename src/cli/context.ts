// `loft context`: what a model (or a person) needs in its context to write a Loft scene, in one print read whole before
// every scene, so every word is paid for each time. docs/context.md is the written part (the craft, condensed;
// failures; where to read more) and the API map is generated (src/cli/api.ts) and printed where that file's marker
// stands. No GPU, no compiler: it reads text.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { apiMap } from "./api.ts";

const ROOT = resolve(import.meta.dir, "../..");
const MARKER = "<!-- the API map is printed here -->";

export function context(): string {
  const text = readFileSync(resolve(ROOT, "docs/context.md"), "utf8");
  const [before, after] = text.split(MARKER);
  if (after === undefined) throw new Error(`docs/context.md: the marker "${MARKER}" is missing`);
  const clean = (s: string) => s.replace(/<!--[\s\S]*?-->\n*/g, "").trim();
  return `${clean(before!)}\n\n${apiMap()}\n\n${clean(after)}\n`;
}
