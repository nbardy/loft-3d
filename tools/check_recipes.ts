// Every recipe stands alone: a file under examples/ whose first line is `// RECIPE:` imports the library only through
// its public entry (src/index.ts) and no other example file, except those its header names on a `// Uses:` line (and a
// file named there may not be under src/). The kit below must all be recipes, so losing the mark fails too.
//   bun tools/check_recipes.ts            (exits 1 on a violation)
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const ENTRY = resolve(ROOT, "src/index.ts");
export const KIT = [
  "examples/recipes/film.ts", "examples/recipes/hull.ts", "examples/recipes/ship.ts", "examples/recipes/thunderhead.ts",
  "examples/bosses/lib/face_parts.ts", "examples/bosses/lib/stalk_eyes.ts", "examples/bosses/lib/growth.ts",
  "examples/bosses/lib/impact.ts", "examples/bosses/lib/scale_ship.ts", "examples/bosses/lib/warning.ts",
  "examples/scenes/lib/wyrm.ts", "examples/scenes/lib/fleet.ts",
] as const;

const t = new Bun.Transpiler({ loader: "ts" });
const recipes = [...new Bun.Glob("examples/**/*.ts").scanSync(ROOT)].filter((f) => readFileSync(resolve(ROOT, f), "utf8").startsWith("// RECIPE:")).sort();
const violations: string[] = [];
for (const k of KIT) if (!recipes.includes(k)) violations.push(`${k} is not marked "// RECIPE:" on its first line`);
for (const r of recipes) {
  const file = resolve(ROOT, r), code = readFileSync(file, "utf8");
  // The `// Uses:` line at the top names the other files it may import, as relative paths.
  const usesLine = code.match(/^\/\/ Uses:.*$/m)?.[0] ?? "";
  const uses = new Set([...usesLine.matchAll(/(\.\.?\/[\w./]+\.ts)/g)].map((m) => resolve(dirname(file), m[1]!)));
  for (const u of uses) if (u.startsWith(resolve(ROOT, "src") + "/")) violations.push(`${r}: its Uses line names ${relative(ROOT, u)}, under src/`);
  // Type-only imports count too: a recipe copied elsewhere must still typecheck.
  const specs = [...t.scanImports(code).map((i) => i.path), ...[...code.matchAll(/^import\s+type\s[\s\S]*?from\s+"([^"]+)"/gm)].map((m) => m[1]!)];
  for (const s of new Set(specs)) {
    if (!s.startsWith(".")) continue; // node: and packages
    const target = resolve(dirname(file), s);
    if (target === ENTRY || uses.has(target)) continue;
    violations.push(`${r} imports ${relative(ROOT, target)}${target.startsWith(resolve(ROOT, "src")) ? " (under src/, not the public entry)" : " (another example's file, not named on its Uses line)"}`);
  }
}
console.log(`${recipes.length} recipes: ${recipes.join(", ")}`);
if (violations.length > 0) { console.log(violations.join("\n")); process.exit(1); }
console.log("each imports only the public entry and the files its header names");
