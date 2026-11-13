// The rule that keeps the styles honest (docs/styles.md): a built-in style may use nothing a user cannot import.
//
//   bun tools/style_imports.ts
//
// Checks, for every file in src/style/ but the registry (index.ts) and the sheet tool (sheet.ts):
//  1. it imports nothing from a style's file (a style named n lives in src/style/n.ts, one per entry of STYLES);
//  2. every name it imports from elsewhere in src/ is exported by the public entry point, src/index.ts: a probe file
//     imports each of them from there and the type checker judges it (TypeScript 7 has no compiler API to ask).
// Prints each breach and exits 1, or one line and exits 0.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { STYLE_NAMES } from "../src/style/index.ts";

const ROOT = resolve(import.meta.dir, "..");
const STYLE_DIR = join(ROOT, "src/style");
const files = readdirSync(STYLE_DIR).filter((f) => f.endsWith(".ts") && f !== "index.ts" && f !== "sheet.ts").sort();
const styleFiles = new Set(STYLE_NAMES.map((n) => `${n}.ts`));

const breaches: string[] = [];
for (const f of styleFiles) if (!existsSync(join(STYLE_DIR, f))) breaches.push(`style "${basename(f, ".ts")}" has no file src/style/${f}`);

/** Every name imported from a relative path, as `type X` or `X`, with where it was imported. */
const wanted = new Map<string, string>();
const IMPORT = /^import\s+(type\s+)?\{([^}]*)\}\s+from\s+"(\.[^"]+)";/gm;
for (const f of files) {
  const text = readFileSync(join(STYLE_DIR, f), "utf8");
  if (/^import\s+(?!type\s*\{|\{)[^;]*from\s+"\./m.test(text)) breaches.push(`${f}: a default or namespace import from a relative path (only named imports are checked)`);
  for (const m of text.matchAll(IMPORT)) {
    const [, allTypes, names, spec] = m;
    if (dirname(resolve(STYLE_DIR, spec!)) === STYLE_DIR && styleFiles.has(basename(spec!)) && basename(spec!) !== f) breaches.push(`${f}: imports "${spec}", another style's file`);
    for (const raw of names!.split(",").map((s) => s.trim()).filter(Boolean)) {
      const isType = allTypes !== undefined || raw.startsWith("type ");
      const name = raw.replace(/^type\s+/, "").split(/\s+as\s+/)[0]!.trim();
      wanted.set(`${isType ? "type " : ""}${name}`, `${f} from "${spec}"`);
    }
  }
}

// The probe: each name imported from the public entry point. A missing one is a type error that names it.
const outDir = join(ROOT, "out/style_imports");
mkdirSync(outDir, { recursive: true });
const probe = join(outDir, "probe.ts");
const list = [...wanted.keys()];
writeFileSync(probe, `import { ${list.join(", ")} } from "../../src/index.ts";\nexport type Probe = [${list.map((n) => (n.startsWith("type ") ? n.slice(5) : `typeof ${n}`)).join(", ")}];\n`);
const tsc = spawnSync("pnpm", ["exec", "tsc", "--ignoreConfig", "--noEmit", "--strict", "--skipLibCheck", "--allowImportingTsExtensions", "--module", "esnext", "--moduleResolution", "bundler", "--target", "esnext", "--types", "bun", probe], { cwd: ROOT, encoding: "utf8" });
for (const line of `${tsc.stdout}${tsc.stderr}`.split("\n").filter((l) => l.includes("probe.ts") && /has no exported member|declares .* locally/.test(l))) {
  const name = /member named '([^']+)'|member '([^']+)'|declares '([^']+)'/.exec(line);
  const n = name?.[1] ?? name?.[2] ?? name?.[3] ?? line;
  breaches.push(`${wanted.get(n) ?? wanted.get(`type ${n}`) ?? "?"}: ${n} is not exported by src/index.ts`);
}
if (tsc.status !== 0 && breaches.length === 0) breaches.push(`the probe did not typecheck:\n${`${tsc.stdout}${tsc.stderr}`.split("\n").slice(0, 8).join("\n")}`);

if (breaches.length > 0) {
  console.log(breaches.join("\n"));
  process.exit(1);
}
console.log(`style imports: ${files.length} files in src/style/, ${styleFiles.size} styles, ${wanted.size} names; every import is public and none is another style's file`);
