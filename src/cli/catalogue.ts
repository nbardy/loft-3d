// The catalogue of what Loft exports, read from the source at run time so it cannot go stale: every name an entry point
// exports, traced to its declaration, with its signature (or a type's fields), its doc comment, and the comment's
// "cannot" and "relatives" lists. `loft api` prints it (src/cli/api.ts); `loft context` prints it short.
//
// It reads the text, not the types: no TypeScript API is available here (typescript 7 ships a binary only), and a
// scan of `export` statements covers every form the library uses (declarations, `export *`, `export { a as b } from`,
// `export { a }` of an import, several constants in one statement). A form it does not know is an error naming the file.

import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

/** What one exported name is, where it is declared, and what its comment says. */
export type Entry = {
  readonly name: string;
  /** Declared as a type (type, interface) or a value (function, constant, class). A class is both; it counts as a value. */
  readonly kind: "value" | "type";
  /** The file that declares it, relative to the repository. */
  readonly file: string;
  /** The comment as written above the declaration, joined to one paragraph per blank line; empty when there is none. */
  readonly doc: string;
  /** The declaration as written, without its body: a function's parameters and result, a type's fields, a class's heritage. */
  readonly signature: string;
  /** For a constant that is an object of named parts (`draw`, `palette`, `hit`): each part, its comment, and its declaration (the part's own, or the function it names). */
  readonly members: readonly Member[];
  /** For a type that is an object: each field and its type as written (a method `f(a): R` as `(a) => R`). */
  readonly fields: readonly Field[];
};
export type Member = { readonly name: string; readonly doc: string; readonly signature: string };
export type Field = { readonly name: string; readonly optional: boolean; readonly type: string };

const ROOT = resolve(import.meta.dir, "../..");
const rel = (p: string) => relative(ROOT, p);

const DECL = /^export\s+(?:declare\s+)?(?:async\s+)?(function\*?|const|let|var|class|abstract\s+class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/;

type FileScan = { readonly text: string; readonly lines: readonly string[] };
const scans = new Map<string, FileScan>();
function scan(path: string): FileScan {
  let s = scans.get(path);
  if (s === undefined) {
    const text = readFileSync(path, "utf8");
    s = { text, lines: text.split("\n") };
    scans.set(path, s);
  }
  return s;
}

/** The comment immediately above line `at`: a `/** *\/` block, or a run of `//` lines. */
function commentAbove(lines: readonly string[], at: number): string {
  let i = at - 1;
  if (i < 0) return "";
  const out: string[] = [];
  if (lines[i]!.trim().endsWith("*/")) {
    while (i >= 0 && !lines[i]!.trim().startsWith("/*")) out.unshift(lines[i--]!);
    if (i < 0) return "";
    out.unshift(lines[i]!);
    return joinComment(out.map((l) => l.trim().replace(/^\/\*\*?/, "").replace(/\*\/$/, "").replace(/^\*\s?/, "")));
  }
  while (i >= 0 && lines[i]!.trim().startsWith("//")) out.unshift(lines[i--]!.trim().replace(/^\/\/\s?/, ""));
  return joinComment(out);
}

/** Lines to paragraphs; a line starting "- " starts a new bullet inside its paragraph. */
function joinComment(lines: readonly string[]): string {
  const paras: string[] = [];
  let cur = "";
  for (const raw of lines) {
    const l = raw.trim();
    if (l === "") { if (cur !== "") paras.push(cur); cur = ""; continue; }
    // A bullet starts a line; so does an unindented line after a bullet (the list has ended); an indented one continues it.
    const afterBullet = /(^|\n)- [^\n]*$/.test(cur) && !/^\s{2,}/.test(raw);
    if (l.startsWith("- ") || afterBullet) cur += (cur === "" ? "" : "\n") + l;
    else cur += (cur === "" ? "" : " ") + l;
  }
  if (cur !== "") paras.push(cur);
  return paras.join("\n\n").trim();
}

/** Names declared on a line `export const a = ..., b = ...`: the first, and any after a comma at bracket depth 0. */
function constNames(line: string): string[] {
  const m = /^export\s+(?:const|let|var)\s+/.exec(line);
  if (!m) return [];
  const names: string[] = [];
  let depth = 0, inStr: string | null = null, start = m[0].length;
  const take = (from: number) => { const n = /^\s*([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=/.exec(line.slice(from)); if (n) names.push(n[1]!); };
  take(start);
  for (let i = start; i < line.length; i++) {
    const c = line[i]!;
    if (inStr) { if (c === inStr && line[i - 1] !== "\\") inStr = null; continue; }
    if (c === '"' || c === "'" || c === "`") inStr = c;
    else if ("([{<".includes(c)) depth++;
    else if (")]}>".includes(c)) depth = Math.max(0, depth - 1);
    else if (c === "," && depth === 0) take(i + 1);
  }
  return names;
}

/** The statement starting at line `i` up to its closing `;` or `}` (re-export lists span lines). */
function statement(lines: readonly string[], i: number): { text: string; end: number } {
  let text = lines[i]!, j = i;
  while (!/[;}]\s*(from\s+["'][^"']+["'];?)?\s*$/.test(text) && j + 1 < lines.length && !/from\s+["']/.test(text)) text += " " + lines[++j]!;
  // A brace list ending in `}` with `from` on the same or next line.
  if (/^\s*export\s+(type\s+)?\{/.test(text) && !/from\s+["']/.test(text) && j + 1 < lines.length && /^\s*from\s+/.test(lines[j + 1]!)) text += " " + lines[++j]!;
  return { text, end: j };
}

const specifiers = (list: string) => list.split(",").map((s) => s.trim()).filter((s) => s !== "").map((s) => {
  const m = /^(type\s+)?([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(s);
  if (!m) throw new Error(`catalogue: cannot read export specifier "${s}"`);
  return { type: m[1] !== undefined, from: m[2]!, as: m[3] ?? m[2]! };
});

const resolveFrom = (file: string, spec: string) => resolve(dirname(file), spec);

/** Every name `file` exports, each traced to its declaration. Memoised: `export *` trees share files. */
const exportCache = new Map<string, Map<string, Entry>>();
export function exportsOf(file: string): Map<string, Entry> {
  const cached = exportCache.get(file);
  if (cached) return cached;
  const out = new Map<string, Entry>();
  exportCache.set(file, out);
  const { lines } = scan(file);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.startsWith("export")) continue;
    const d = DECL.exec(line);
    if (d) {
      const kind = d[1] === "type" || d[1] === "interface" ? "type" : "value";
      const doc = commentAbove(lines, i);
      const names = kind === "value" && /^export\s+(const|let|var)\s/.test(line) ? constNames(line) : [d[2]!];
      // An overloaded function: the comment sits above the first signature; later ones must not erase it.
      const members = names.length === 1 && /^export\s+const\s+[\w$]+(\s*:[^=]+)?\s*=\s*\{\s*$/.test(line) ? membersAfter(file, lines, i) : [];
      const signature = signatureAt(lines, i, kind), fields = kind === "type" ? fieldsAt(lines, i) : [];
      for (const name of names) if (!(doc === "" && out.get(name)?.file === rel(file))) out.set(name, { name, kind, file: rel(file), doc, signature, members, fields });
      continue;
    }
    const { text, end } = statement(lines, i);
    i = end;
    let m: RegExpExecArray | null;
    if ((m = /^export\s+\*\s+from\s+["']([^"']+)["']/.exec(text))) {
      for (const [k, v] of exportsOf(resolveFrom(file, m[1]!))) if (k !== "default") out.set(k, v);
    } else if ((m = /^export\s+(type\s+)?\{([^}]*)\}\s*from\s+["']([^"']+)["']/.exec(text))) {
      const target = exportsOf(resolveFrom(file, m[3]!));
      for (const s of specifiers(m[2]!)) {
        const e = target.get(s.from);
        if (!e) throw new Error(`catalogue: ${rel(file)} re-exports "${s.from}", which ${m[3]} does not export`);
        out.set(s.as, { ...e, name: s.as });
      }
    } else if ((m = /^export\s+(type\s+)?\{([^}]*)\}\s*;?\s*$/.exec(text))) {
      for (const s of specifiers(m[2]!)) out.set(s.as, { ...localOrImported(file, s.from), name: s.as });
    } else if (/^export\s+default\b/.test(text)) {
      out.set("default", { name: "default", kind: "value", file: rel(file), doc: commentAbove(lines, i), signature: "", members: [], fields: [] });
    } else {
      throw new Error(`catalogue: ${rel(file)}:${i + 1}: an export form this scanner does not read: ${text.slice(0, 80)}`);
    }
  }
  return out;
}

/** Split at commas or semicolons outside brackets (an arrow's `=>` is not a bracket). */
export function topLevel(t: string, sep = /[,;]/): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (c === "=" && t[i + 1] === ">") { cur += "=>"; i++; continue; }
    if ("([{<".includes(c)) depth++;
    else if (")]}>".includes(c)) depth--;
    if (depth === 0 && sep.test(c)) { out.push(cur.trim()); cur = ""; } else cur += c;
  }
  if (cur.trim() !== "") out.push(cur.trim());
  return out;
}

const squash = (t: string) => t.replace(/\s+/g, " ").trim();

/**
 * A declaration without its body. A type that is an object lists its fields (`name`, `name?`); any other type is its
 * text. A function is everything before the brace that opens its body; a constant, its annotation or its arrow's
 * parameters; a class, its heading. Long ones are cut at 300 characters, marked with "...".
 */
function signatureAt(lines: readonly string[], at: number, kind: "value" | "type"): string {
  const head = lines[at]!.replace(/^export\s+(declare\s+)?/, "");
  const cut = (t: string) => (t.length > 300 ? `${t.slice(0, 297)}...` : t);
  if (kind === "type") {
    if (/=\s*\{\s*$/.test(head) || /^interface\b.*\{\s*$/.test(head)) {
      const fields: string[] = [];
      for (let i = at + 1; i < lines.length && !/^\}/.test(lines[i]!); i++) {
        const m = /^ {2}(?:readonly\s+)?([A-Za-z_$][\w$]*)(\??)\s*[:(]/.exec(lines[i]!);
        if (m) fields.push(m[1]! + m[2]!);
      }
      return cut(`${squash(head.replace(/\{\s*$/, ""))} { ${fields.join(", ")} }`);
    }
    let t = head, j = at;
    while (!/;\s*$/.test(t) && j + 1 < lines.length && j < at + 8) t += " " + lines[++j]!.trim();
    return cut(squash(t.replace(/;\s*$/, "")));
  }
  if (/^(async\s+)?function|^(abstract\s+)?class/.test(head)) {
    let t = head, j = at;
    while (!/\{\s*$/.test(t) && !/;\s*$/.test(t) && j + 1 < lines.length && j < at + 12) t += " " + lines[++j]!.trim();
    return cut(squash(t.replace(/\s*\{\s*$/, "").replace(/;\s*$/, "")));
  }
  // A constant: its annotation, or an arrow's parameters and result, or the start of its value.
  const ann = /^(const|let|var)\s+([\w$]+)\s*:\s*(.+?)\s*=\s/.exec(head);
  if (ann) return cut(`const ${ann[2]}: ${ann[3]}`);
  const arrow = /^(const|let|var)\s+([\w$]+)\s*=\s*(<[^=]*>)?\s*(\(.*?\)(?:\s*:\s*[^=]+?)?)\s*=>/.exec(head);
  if (arrow) return cut(`const ${arrow[2]} = ${arrow[3] ?? ""}${arrow[4]} =>`);
  return cut(squash(head.replace(/\{\s*$/, "{ ... }").replace(/;\s*$/, "")));
}

/**
 * The named parts of an object literal opened on line `at`: keys at two spaces' indent, up to the closing brace. A
 * part's signature is its own (`curve(name, curve, o): Drawable`, `x: (a) => ...`), or that of the function it names
 * (`surface: drawSurface`), or empty when neither can be read.
 */
function membersAfter(file: string, lines: readonly string[], at: number): Member[] {
  const out: Member[] = [];
  for (let i = at + 1; i < lines.length && !/^\}/.test(lines[i]!); i++) {
    const m = /^ {2}(?:async\s+)?([A-Za-z_$][\w$]*)\s*(?:[:(<]|,|$)/.exec(lines[i]!);
    if (!m) continue;
    const rest = lines[i]!.slice(m[0].length - 1).trim();
    let signature = "";
    const named = /^:\s*([A-Za-z_$][\w$]*)\s*,?\s*$/.exec(rest);
    if (named) { try { signature = localOrImported(file, named[1]!).signature; } catch { signature = ""; } }
    else if (/^[(<]/.test(rest)) signature = squash(`${m[1]}${rest}`.replace(/\s*\{\s*$/, ""));
    else if (/^:\s*(<[^=]*>)?\s*\(/.test(rest)) signature = squash(`const ${m[1]} = ${rest.replace(/^:\s*/, "")}`);
    out.push({ name: m[1]!, doc: commentAbove(lines, i), signature });
  }
  return out;
}

/** The fields of an object type opened on line `at` (two spaces' indent), each with its type as written on its line. */
function fieldsAt(lines: readonly string[], at: number): Field[] {
  const head = lines[at]!;
  // A type written on one line: `type O = { readonly a: A; readonly b?: B };`.
  const one = /=\s*\{(.*)\}\s*;?\s*$/.exec(head);
  if (one) return topLevel(one[1]!).flatMap((f) => {
    const m = /^(?:readonly\s+)?([A-Za-z_$][\w$]*)(\??)\s*:\s*([\s\S]*)$/.exec(f);
    return m ? [{ name: m[1]!, optional: m[2] === "?", type: m[3]!.trim() }] : [];
  });
  if (!(/=\s*\{\s*$/.test(head) || /^export\s+interface\b.*\{\s*$/.test(head))) return [];
  const out: Field[] = [];
  for (let i = at + 1; i < lines.length && !/^\}/.test(lines[i]!); i++) {
    const m = /^ {2}(?:readonly\s+)?([A-Za-z_$][\w$]*)(\??)\s*([:(])(.*)$/.exec(lines[i]!);
    if (!m) continue;
    const type = (m[3] === "(" ? `(${m[4]!.replace(/\)\s*:\s*/, ") => ")}` : m[4]!).trim().replace(/[;,]\s*$/, "");
    out.push({ name: m[1]!, optional: m[2] === "?", type });
  }
  return out;
}

/** `export { a }` of something declared in the file without `export`, or imported into it. */
function localOrImported(file: string, name: string): Entry {
  const { lines, text } = scan(file);
  const imp = new RegExp(`import\\s+(?:type\\s+)?\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s+["']([^"']+)["']`).exec(text);
  if (imp) {
    const e = exportsOf(resolveFrom(file, imp[1]!)).get(name);
    if (e) return e;
  }
  const decl = new RegExp(`^(?:function\\*?|const|let|var|class|type|interface)\\s+${name}\\b`);
  const at = lines.findIndex((l) => decl.test(l));
  if (at < 0) throw new Error(`catalogue: ${rel(file)} exports "${name}" but its declaration was not found`);
  return { name, kind: /^(type|interface)\s/.test(lines[at]!) ? "type" : "value", file: rel(file), doc: commentAbove(lines, at), signature: signatureAt(lines, at, /^(type|interface)\s/.test(lines[at]!) ? "type" : "value"), members: [], fields: /^(type|interface)\s/.test(lines[at]!) ? fieldsAt(lines, at) : [] };
}

/** The first sentence of a comment (to the first ". " before a capital, or the paragraph's end). */
export function firstSentence(doc: string): string {
  const para = doc.split("\n\n")[0]!.replace(/\n/g, " ");
  const m = /^(.+?[.!?])(?:\s+(?=[A-Z`(])|$)/.exec(para);
  return (m ? m[1]! : para).trim();
}

/**
 * The lines of a comment's list introduced by a line matching `header`: the bullets that follow it, up to the first line
 * that is not a bullet. With no bullets after it, the header's own sentence when `sentences` (a limit stated in prose
 * is still a limit; a mention of relatives without a list is not a list). This is how a component's comment states
 * what it cannot do and which relatives to try (`spiralTube` in src/geom/spiral.ts is the worked example).
 */
function listUnder(doc: string, header: RegExp, sentences: boolean): string[] {
  const out: string[] = [];
  const lines = doc.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.startsWith("- ") || !header.test(lines[i]!)) continue;
    const items: string[] = [];
    for (let j = i + 1; j < lines.length && lines[j]!.startsWith("- "); j++) items.push(lines[j]!.slice(2).trim());
    if (items.length > 0) out.push(...items);
    else if (sentences) out.push(...lines[i]!.split(/(?<=[.;])\s+(?=[A-Z])/).filter((x) => header.test(x)).map((x) => x.trim()));
  }
  return out;
}

/** What the thing cannot do, as its comment states it. A limit that is not written down is read as the whole space. */
export const cannotLines = (doc: string): string[] => listUnder(doc, /\bcannot\b|\bcan't\b/i, true);
/** The relatives its comment invites a reader to try: other shapes from similar mathematics. */
export const relativesLines = (doc: string): string[] => listUnder(doc, /\brelatives?\b/i, false);

/** The first sentence of a file's opening comment: what the module is for. */
export function moduleLine(file: string): string {
  const lines = scan(resolve(ROOT, file)).lines;
  const head: string[] = [];
  for (const l of lines) { if (!l.trim().startsWith("//")) break; head.push(l.trim().replace(/^\/\/\s?/, "")); }
  return firstSentence(joinComment(head));
}

export type Group = {
  /** The layer: one of the files the entry point re-exports (`src/core.ts` ...), or the entry itself when it has none. */
  readonly layer: Layer;
  /** The module that declares these names, and its opening sentence. */
  readonly file: string;
  readonly line: string;
  /** Exported after the layer file's "one user so far" marker: not yet shown to be general. */
  readonly unproven: boolean;
  readonly values: readonly Entry[];
  readonly types: readonly Entry[];
};
export type Layer = { readonly file: string; readonly name: string; readonly line: string };

/** A layer file marks the start of its unproven exports with a comment line saying so. */
const UNPROVEN = /^\/\/.*one user so far/i;

/** Names exported by statements after the unproven marker of a layer file. */
function unprovenIn(file: string): Set<string> {
  const lines = scan(file).lines, out = new Set<string>();
  const at = lines.findIndex((l) => UNPROVEN.test(l));
  if (at < 0) return out;
  for (let i = at + 1; i < lines.length; i++) {
    if (!lines[i]!.startsWith("export")) continue;
    const { text, end } = statement(lines, i);
    i = end;
    const m = /^export\s+(type\s+)?\{([^}]*)\}/.exec(text);
    if (m) for (const sp of specifiers(m[2]!)) out.add(sp.as);
    else if (/^export\s+\*/.test(text)) throw new Error(`catalogue: ${rel(file)}: \`export *\` after the unproven marker cannot be told apart by name`);
  }
  return out;
}

/**
 * The catalogue of one entry point, by layer. When the entry re-exports layer files (`export * from "./core.ts"` ...,
 * each opening with a comment "<Name> layer: ..."), each is a layer, in that order, named from its opening comment; otherwise the entry is one layer. Within a layer, names
 * are grouped by the module that declares them, in the layer's order, the unproven groups last.
 */
export function catalogue(entry: string): Group[] {
  const path = resolve(ROOT, entry);
  const layerFiles = scan(path).lines.map((l) => /^export\s+\*\s+from\s+["']([^"']+)["']/.exec(l)?.[1]).filter((x): x is string => x !== undefined)
    .map((spec) => resolveFrom(path, spec)).filter((f) => /^\S+ layer:/i.test(moduleLine(rel(f))));
  // An entry whose `export *` targets do not open "<Name> layer:" (src/lib/index.ts) is one layer itself.
  const layers = layerFiles.length > 0 ? layerFiles : [path];
  const seen = new Set<string>();
  const out: Group[] = [];
  for (const lf of layers) {
    const opening = moduleLine(rel(lf));
    const layer: Layer = { file: rel(lf), name: /^(.+?) layer\b/i.exec(opening)?.[1] ?? rel(lf), line: opening.replace(/^.+? layer:\s*/i, "") };
    const unproven = unprovenIn(lf);
    const byKey = new Map<string, { file: string; unproven: boolean; es: Entry[] }>();
    for (const e of exportsOf(lf).values()) {
      if (seen.has(e.name)) continue;
      seen.add(e.name);
      const u = unproven.has(e.name), key = `${e.file}|${u}`;
      const g = byKey.get(key) ?? { file: e.file, unproven: u, es: [] };
      g.es.push(e);
      byKey.set(key, g);
    }
    const groups = [...byKey.values()];
    for (const g of [...groups.filter((x) => !x.unproven), ...groups.filter((x) => x.unproven)]) {
      out.push({ layer, file: g.file, line: moduleLine(g.file), unproven: g.unproven, values: g.es.filter((e) => e.kind === "value"), types: g.es.filter((e) => e.kind === "type") });
    }
  }
  return out;
}
