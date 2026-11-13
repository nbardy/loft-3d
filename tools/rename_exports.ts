// Renames the public entry's retired names to their current ones in TypeScript files and in the ```ts blocks of
// Markdown files: the import from the entry (or from the module that defined the name) and every reference to it in
// that file. Files that do not import a retired name from there are not touched, so a local variable or an unrelated
// import that shares an old name elsewhere is left alone.
//
//   bun tools/rename_exports.ts [--dry] <file or directory> ...
//
// e.g. `bun tools/rename_exports.ts examples tools tests README.md docs`. It prints each file it changed; with an error in
// any file it prints every error, writes nothing and exits 1.
//
// It reads tokens, not types (the repository's TypeScript 7 has no JavaScript API): within a file that imports `lines`,
// every identifier `lines` that is not a property name (`x.lines`, `{ lines: ... }`) is the import. It stops with an
// error, writing nothing, where that could be wrong or where a rename needs judgement:
// - the file also declares the old name itself (`const lines = ...`, a parameter `lines`): a local shadows the import.
// - the file already uses the new name for something other than the same import (a local `coil` where `shell` is
//   called).
// - a retired spec whose fields it cannot see (below).
// Retired spec fields are carried too: `ShellSpec`'s `coil` became `hand`, and its `aspect` and `ridges` moved into
// `section: { aspect, ridges }`, in an object literal passed straight to `shell(...)` or declared `: ShellSpec`.
//
// To retire another name, add it to RENAMES and the module that defined it to DEFINED_IN.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";

/** Retired name to current name. Values and types alike. */
const RENAMES: Readonly<Record<string, string>> = {
  shell: "coil", ShellSpec: "CoilSpec",
  crest: "sheetOn", CrestSpec: "SheetOnSpec",
  limb: "chain", Limb: "Chain", LimbSpec: "ChainSpec",
  lines: "ropes", LinesSpec: "RopesSpec",
};

/** The modules an import of a retired name may come from: the entry, its layer files and the defining modules. */
const ROOT = resolve(import.meta.dir, "..");
const ENTRY = ["src/index.ts", "src/core.ts", "src/shapes.ts", "src/motion.ts", "src/actions.ts", "src/checks.ts", "src/styles.ts"];
const DEFINED_IN = ["src/geom/spiral.ts", "src/geom/crest.ts", "src/geom/limb.ts", "src/geom/lines.ts"];
const PUBLIC = new Set([...ENTRY, ...DEFINED_IN].map((f) => resolve(ROOT, f)));
/** In Markdown the snippet's own path is unknown, so a specifier is matched by its ending. */
const PUBLIC_SUFFIX = new RegExp(`(^|/)(${[...ENTRY, ...DEFINED_IN].map((f) => f.replace(/[./]/g, (c) => `\\${c}`)).join("|")})$`);
/** The spec fields `shell` took that `coil` takes inside `section`. */
const SHELL_SECTION = new Set(["aspect", "ridges"]);

class RenameError extends Error {}

// ---- tokens ---------------------------------------------------------------------------------------------------------

type Tok = { readonly kind: "id" | "punct" | "str" | "num"; readonly text: string; readonly start: number; readonly end: number };

const ID0 = /[A-Za-z_$]/, ID = /[\w$]/;
/** After these a `/` starts a regular expression, not a division. */
const BEFORE_REGEX = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^", "return", "typeof", "case", "=>", "&&", "||", "??"]);

/** The code tokens of a TypeScript text: comments dropped, strings and template text as single tokens. */
function tokens(text: string): Tok[] {
  const out: Tok[] = [];
  const braces: ("code" | "template")[] = [];
  let i = 0;
  const templateBody = (from: number): number => {
    // From just inside a template literal to its end (returns after the closing backtick) or to a `${` (returns after it).
    let j = from;
    while (j < text.length) {
      if (text[j] === "\\") { j += 2; continue; }
      if (text[j] === "`") return j + 1;
      if (text[j] === "$" && text[j + 1] === "{") { braces.push("template"); return j + 2; }
      j++;
    }
    throw new RenameError("unterminated template literal");
  };
  while (i < text.length) {
    const c = text[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (c === "/" && text[i + 1] === "/") { while (i < text.length && text[i] !== "\n") i++; continue; }
    if (c === "/" && text[i + 1] === "*") { const e = text.indexOf("*/", i + 2); i = e < 0 ? text.length : e + 2; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === "\\" ? 2 : 1;
      out.push({ kind: "str", text: text.slice(i, j + 1), start: i, end: j + 1 }); i = j + 1; continue;
    }
    if (c === "`") { const j = templateBody(i + 1); out.push({ kind: "str", text: text.slice(i, j), start: i, end: j }); i = j; continue; }
    if (c === "}" && braces.at(-1) === "template") {
      braces.pop();
      const j = templateBody(i + 1); out.push({ kind: "str", text: text.slice(i, j), start: i, end: j }); i = j; continue;
    }
    if (c === "/") {
      const prev = out.at(-1);
      if (!prev || BEFORE_REGEX.has(prev.text)) {
        let j = i + 1, cls = false;
        while (j < text.length && (cls || text[j] !== "/")) { if (text[j] === "\\") j++; else if (text[j] === "[") cls = true; else if (text[j] === "]") cls = false; j++; }
        j++;
        while (j < text.length && ID.test(text[j]!)) j++;
        out.push({ kind: "str", text: text.slice(i, j), start: i, end: j }); i = j; continue;
      }
    }
    if (ID0.test(c)) { let j = i + 1; while (j < text.length && ID.test(text[j]!)) j++; out.push({ kind: "id", text: text.slice(i, j), start: i, end: j }); i = j; continue; }
    if (/[0-9]/.test(c)) { let j = i + 1; while (j < text.length && /[\w.]/.test(text[j]!)) j++; out.push({ kind: "num", text: text.slice(i, j), start: i, end: j }); i = j; continue; }
    const three = text.slice(i, i + 3), two = text.slice(i, i + 2);
    const p = ["...", "===", "!==", "**="].includes(three) ? three : ["=>", "?.", "&&", "||", "??", "==", "!=", "<=", ">=", "+=", "-=", "*=", "/="].includes(two) ? two : c;
    if (p === "{") braces.push("code");
    if (p === "}") braces.pop();
    out.push({ kind: "punct", text: p, start: i, end: i + p.length }); i += p.length;
  }
  return out;
}

// ---- one source text ------------------------------------------------------------------------------------------------

type Edit = { readonly start: number; readonly end: number; readonly text: string };

function isPublic(specifier: string, from: string | undefined): boolean {
  if (from === undefined) return PUBLIC_SUFFIX.test(specifier);
  return specifier.startsWith(".") && PUBLIC.has(resolve(dirname(from), specifier));
}

const DECLARES = new Set(["const", "let", "var", "function", "class", "type", "interface", "enum"]);

/** The edits that rename retired names in one source text; `from` is its path (undefined for a Markdown snippet). */
function editsOf(text: string, label: string, from: string | undefined): Edit[] {
  const t = tokens(text);
  const where = (k: number) => `${label}:${text.slice(0, t[k]!.start).split("\n").length}`;
  const edits: Edit[] = [];

  // Imports from the public modules: `import [type] { a, b as c, type d } from "<public>";`
  const imported = new Map<string, number>(); // imported name -> token index of its specifier (unaliased only)
  const importTokens = new Set<number>();
  const retired = new Map<string, string>(); // local name -> new name
  for (let k = 0; k < t.length; k++) {
    if (t[k]!.text !== "import") continue;
    let open = k + 1;
    if (t[open]?.text === "type") open++;
    if (t[open]?.text !== "{") continue;
    let close = open;
    while (t[close]!.text !== "}") close++;
    const spec = t[close + 2];
    if (t[close + 1]?.text !== "from" || spec?.kind !== "str" || !isPublic(spec.text.slice(1, -1), from)) continue;
    for (let j = open; j <= close + 2; j++) importTokens.add(j);
    for (let j = open + 1; j < close; j++) {
      if (t[j]!.kind !== "id" || t[j]!.text === "type" && t[j + 1]?.kind === "id") continue;
      if (t[j - 1]!.text === "as") continue;
      const name = t[j]!.text, aliased = t[j + 1]?.text === "as";
      const next = RENAMES[name];
      if (next !== undefined) {
        if (aliased) edits.push({ start: t[j]!.start, end: t[j]!.end, text: next });
        else retired.set(name, next);
      }
      if (!aliased) imported.set(name, j);
    }
  }
  if (retired.size === 0) return edits;

  // Each specifier: renamed in place, or dropped when the new name is imported already.
  for (const [old, next] of retired) {
    const j = imported.get(old)!;
    if (!imported.has(next)) { edits.push({ start: t[j]!.start, end: t[j]!.end, text: next }); continue; }
    const first = t[j - 1]!.text === "{" || t[j - 1]!.text === "type" && t[j - 2]!.text === "{";
    const from_ = t[j - 1]!.text === "type" ? j - 1 : j;
    if (first) edits.push({ start: t[from_]!.start, end: t[j + 1]!.text === "," ? t[j + 2]!.start : t[j]!.end, text: "" });
    else edits.push({ start: t[from_ - 1]!.start, end: t[j]!.end, text: "" });
  }

  // Bracket stack, to tell an object literal's key from a reference.
  const stack: { text: string; at: number }[] = [];
  const matching = (k: number): number => {
    let depth = 0;
    for (let j = k; j < t.length; j++) {
      if (["(", "[", "{"].includes(t[j]!.text)) depth++;
      if ([")", "]", "}"].includes(t[j]!.text) && --depth === 0) return j;
    }
    return t.length - 1;
  };
  for (let k = 0; k < t.length; k++) {
    const tok = t[k]!;
    if (["(", "[", "{"].includes(tok.text)) stack.push({ text: tok.text, at: k });
    if ([")", "]", "}"].includes(tok.text)) stack.pop();
    if (importTokens.has(k) || tok.kind !== "id") continue;
    const prev = t[k - 1], nxt = t[k + 1];
    const isOld = retired.has(tok.text), isNew = [...retired.values()].includes(tok.text);
    if (!isOld && !isNew) continue;
    if (prev && (prev.text === "." || prev.text === "?.")) continue; // a property
    const inBraces = stack.at(-1)?.text === "{";
    // A key: in an object literal after `{` or `,`; in a type literal also after `;` or `readonly`, and optional (`key?:`).
    const keyed = nxt?.text === ":" || nxt?.text === "?" && t[k + 2]?.text === ":";
    const before = prev?.text === "readonly" ? t[k - 2] : prev; // `readonly key:` in a type literal
    if (keyed && inBraces && before && ["{", ",", ";"].includes(before.text)) continue;
    if (isNew) throw new RenameError(`${where(k)}: "${tok.text}" already names something in this file; rename it first`);
    // A declaration of the old name: a local that may shadow the import.
    const declares = prev && (DECLARES.has(prev.text)
      || (stack.at(-1)?.text === "(" && [",", "("].includes(prev.text) && [":", ",", ")", "=", "?"].includes(nxt?.text ?? "") && isParams(stack.at(-1)!.at))
      || ((prev.text === "{" || prev.text === "[" || prev.text === ",") && stack.length > 0 && DECLARES.has(t[stack.at(-1)!.at - 1]?.text ?? "")));
    if (declares) throw new RenameError(`${where(k)}: the file declares its own "${tok.text}", which may shadow the import; rename that first`);
    const shorthand = inBraces && prev && (prev.text === "{" || prev.text === ",") && ["}", ","].includes(nxt?.text ?? "");
    const next = retired.get(tok.text)!;
    edits.push({ start: tok.start, end: tok.end, text: shorthand ? `${tok.text}: ${next}` : next });
    if (next === "coil" && nxt?.text === "(") carryShell(k + 1, false);
    if (next === "CoilSpec" && prev?.text === ":" && t[k + 1]?.text === "=") carryShell(k + 1, true);
  }

  /** Whether the parenthesis at token `k` opens a parameter list: `) =>`, `) {` or `): T` after it, or `function f(`. */
  function isParams(k: number): boolean {
    const after = t[matching(k) + 1]?.text;
    return after === "=>" || after === "{" || after === ":" || t[k - 2]?.text === "function" || t[k - 1]?.text === "function";
  }

  /** The retired shell spec's fields, in the object literal after a call's `(` (or after `=`). */
  function carryShell(k: number, declared: boolean): void {
    const o = k + 1;
    if (t[o]?.text !== "{") throw new RenameError(`${where(k)}: a shell spec that is not an object literal; carry coil/aspect/ridges to hand/section by hand`);
    if (!declared && t[matching(o) + 1]?.text !== ")") throw new RenameError(`${where(k)}: shell(...) with more than a spec; carry its fields by hand`);
    const end = matching(o);
    // Top-level properties: [first token, last token] split at depth-0 commas.
    const props: [number, number][] = [];
    let depth = 0, from = o + 1;
    for (let j = o + 1; j < end; j++) {
      const x = t[j]!.text;
      if (["(", "[", "{"].includes(x)) depth++;
      if ([")", "]", "}"].includes(x)) depth--;
      if (depth === 0 && x === ",") { props.push([from, j - 1]); from = j + 1; }
    }
    if (from < end) props.push([from, end - 1]);
    const section: string[] = [];
    let first: [number, number] | undefined;
    props.forEach(([a, b], i) => {
      if (t[a]!.text === "...") throw new RenameError(`${where(a)}: a spread in a shell spec may carry coil/aspect/ridges; carry them by hand`);
      const key = t[a]!.text;
      if (key === "coil") edits.push(a === b ? { start: t[a]!.start, end: t[a]!.end, text: "hand: coil" } : { start: t[a]!.start, end: t[a]!.end, text: "hand" });
      else if (SHELL_SECTION.has(key)) {
        section.push(text.slice(t[a]!.start, t[b]!.end));
        if (first === undefined) first = [a, b];
        else edits.push({ start: t[props[i - 1]![1]]!.end, end: t[b]!.end, text: "" });
      }
    });
    if (first) edits.push({ start: t[first[0]]!.start, end: t[first[1]]!.end, text: `section: { ${section.join(", ")} }` });
  }
  return edits;
}

function apply(text: string, edits: readonly Edit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  for (let i = 1; i < sorted.length; i++) if (sorted[i]!.end > sorted[i - 1]!.start) throw new RenameError(`overlapping edits at offset ${sorted[i]!.start}`);
  let out = text;
  for (const e of sorted) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/** Each ```ts block of a Markdown file, renamed as a file of its own. */
function renameMd(path: string, text: string): string {
  return text.replace(/(```(?:ts|typescript)[^\n]*\n)([\s\S]*?)(```)/g, (_m, open: string, body: string, close: string, at: number) =>
    open + apply(body, editsOf(body, `${path}:${text.slice(0, at).split("\n").length}+`, undefined)) + close);
}

function filesUnder(p: string): string[] {
  if (statSync(p).isDirectory()) return readdirSync(p).filter((f) => f !== "node_modules" && !f.startsWith(".")).flatMap((f) => filesUnder(join(p, f)));
  return [".ts", ".md"].includes(extname(p)) ? [p] : [];
}

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const paths = args.filter((a) => a !== "--dry");
if (paths.length === 0) throw new RenameError("usage: bun tools/rename_exports.ts [--dry] <file or directory> ...");
const self = resolve(import.meta.path);
const errors: string[] = [];
const results = paths.flatMap(filesUnder).filter((f) => resolve(f) !== self).flatMap((f) => {
  const before = readFileSync(f, "utf8");
  try {
    return [{ f, before, after: extname(f) === ".md" ? renameMd(f, before) : apply(before, editsOf(before, f, resolve(f))) }];
  } catch (e) {
    if (!(e instanceof RenameError)) throw e;
    errors.push(e.message);
    return [];
  }
});
// Every file is renamed before any is written, so an error anywhere leaves the tree as it was.
if (errors.length > 0) {
  console.error(`nothing written; fix these first:\n${errors.join("\n")}`);
  process.exit(1);
}
for (const r of results) if (r.after !== r.before) {
  console.log(r.f);
  if (!dry) writeFileSync(r.f, r.after);
}
