// `loft gallery`: render every scene and write one static page (out/gallery/index.html) showing all of it.
//
// Incremental by content address. Every output file carries a hash in its name: the scene's import closure, the commit
// of src/, and the options that shape that output. Present file = valid output, so "reuse" is an existence check and a
// stale file is simply never referenced again (and is swept at the end). Failures are not cached; the next run retries.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { Artefact, Camera, Host } from "../artefact.ts";
import { UsageError } from "./args.ts";
import { FALLBACK_CAMERAS } from "./cameras.ts";
import { commitOf, closureHash, discover, headCommit, sha, type Discovered } from "./gallery_discover.ts";
import type { GalleryCommand } from "./gallery_args.ts";
import { renderPage, type Checks, type Entry, type GalleryData, type Media, type Numbers } from "./gallery_page.ts";
import { headlessHost } from "./load.ts";
import type { GpuHost } from "../host/host.ts";
import { writeWebp } from "./image.ts";
import { openVideo } from "./video.ts";

const STILL_TIME = 1.0; // seconds into the scene; same as `loft render`'s default
const FPS = 30;
const TIMING_FRAMES = 12;

/** Counts for the summary line, and the set of media paths this run stands behind (everything else is swept). */
type Ledger = { rendered: number; reused: number; failed: number; readonly live: Set<string> };
type Meta = { readonly numbers: Numbers; readonly cameras: readonly string[]; readonly checks: Checks };

const errText = (e: unknown): string => (e instanceof Error ? (e.stack ?? e.message) : String(e));
const ms = (t: number) => `${(performance.now() - t).toFixed(0)} ms`;

/** Where one scene's outputs live and how they are named. Pure: names depend only on the keys passed in. */
class Store {
  constructor(readonly outDir: string, readonly scene: string, readonly sceneKey: string, readonly ledger: Ledger) {}
  private rel(label: string, key: string, ext: string) { return `media/${this.scene}/${label}.${key.slice(0, 12)}.${ext}`; }
  key(...options: readonly string[]) { return sha(this.sceneKey, ...options); }
  stillPath(label: string, ...options: readonly string[]) { return this.rel(label, this.key(label, ...options), "webp"); }
  clipPath(...options: readonly string[]) { return this.rel("clip", this.key("clip", ...options), "mp4"); }
  metaPath(...options: readonly string[]) { return this.rel("meta", this.key("meta", ...options), "json"); }
  abs(rel: string) { return join(this.outDir, rel); }
  has(rel: string) { return existsSync(this.abs(rel)); }
}

/**
 * Make the output at `rel` unless it exists. A throw becomes a `failed` Media carrying the error text, and the run
 * goes on: one scene's shader error must not cost the other scenes' pictures.
 */
async function ensure(store: Store, label: string, rel: string, make: (absPath: string) => Promise<void>): Promise<Media> {
  if (store.has(rel)) { store.ledger.reused++; store.ledger.live.add(rel); console.log(`  reused    ${label}`); return { kind: "ok", file: rel }; }
  const t = performance.now();
  try {
    mkdirSync(dirname(store.abs(rel)), { recursive: true });
    await make(store.abs(rel));
    store.ledger.rendered++;
    store.ledger.live.add(rel);
    console.log(`  rendered  ${label}  ${ms(t)}`);
    return { kind: "ok", file: rel };
  } catch (e) {
    store.ledger.failed++;
    console.log(`  FAILED    ${label}: ${errText(e).split("\n")[0]}`);
    return { kind: "failed", error: errText(e) };
  }
}

async function compileTimed(scene: unknown): Promise<{ artefact: Artefact; ms: number }> {
  const { compile } = (await import("../index.ts")) as { compile: (s: unknown) => Artefact };
  const t = performance.now();
  const artefact = compile(scene);
  return { artefact, ms: performance.now() - t };
}

function camerasOf(artefact: Artefact): { name: string; camera: Camera }[] {
  const own = Object.entries(artefact.cameras).map(([name, camera]) => ({ name, camera }));
  return own.length > 0 ? own : Object.entries(FALLBACK_CAMERAS).map(([name, camera]) => ({ name, camera }));
}

async function runChecksOf(scene: unknown, checks: unknown): Promise<Checks> {
  if (checks === undefined) return { kind: "none" };
  if (!Array.isArray(checks)) return { kind: "error", error: "the module's `checks` export is not an array" };
  try {
    const { runChecks } = await import("../check.ts");
    return { kind: "table", rows: runChecks(scene as Parameters<typeof runChecks>[0], checks) };
  } catch (e) {
    return { kind: "error", error: errText(e) };
  }
}

/** One frame at the first camera, drawn in the named style (or the scene's own when `style` is undefined). */
async function stillIn(host: Host, scene: unknown, style: string | undefined, camera: Camera, cmd: GalleryCommand, dest: string): Promise<void> {
  const styled = style === undefined ? scene : await withNamedStyle(scene, style);
  const { artefact } = await compileTimed(styled);
  const loaded = await host.load(artefact);
  try {
    writeWebp(dest, { ...cmd.size, rgba: await loaded.frame({ camera, ...cmd.size, time: STILL_TIME, params: {} }) });
  } finally {
    loaded.destroy();
  }
}

async function withNamedStyle(scene: unknown, name: string): Promise<unknown> {
  const styles = (await import("../style/index.ts")) as { styleNamed: (n: string) => unknown; withStyle: (s: unknown, st: unknown) => unknown };
  return styles.withStyle(scene, styles.styleNamed(name));
}

async function renderScene(host: GpuHost, d: Extract<Discovered, { kind: "scene" }>, cmd: GalleryCommand, store: Store): Promise<Entry> {
  const source = relative(cmd.out, d.path);
  const scene = d.module.default;
  const optionsOf = (...extra: readonly string[]) => [`${cmd.size.width}x${cmd.size.height}`, ...extra];
  const metaRel = store.metaPath(...optionsOf(String(cmd.clipSeconds), cmd.styles.join(",")));

  // Outputs that exist already need no GPU; the scene is loaded only when something is missing or the numbers are.
  const meta: Meta | undefined = store.has(metaRel) ? (JSON.parse(readFileSync(store.abs(metaRel), "utf8")) as Meta) : undefined;
  const stillRel = (label: string, ...extra: string[]) => store.stillPath(label, ...optionsOf(...extra));
  const clipRel = store.clipPath(...optionsOf(String(cmd.clipSeconds)));
  const styleRel = (s: string) => stillRel(`style-${s}`, "first-camera", s);
  const camRel = (c: string) => stillRel(`cam-${c}`, "own-style", c);
  if (meta !== undefined && !cmd.force) {
    const wanted = [...meta.cameras.map(camRel), ...cmd.styles.map(styleRel), clipRel];
    if (wanted.every((r) => store.has(r))) {
      store.ledger.reused += wanted.length;
      for (const r of [...wanted, metaRel]) store.ledger.live.add(r);
      console.log(`  reused    all ${wanted.length} outputs`);
      return {
        kind: "scene", name: d.name, source, numbers: meta.numbers, checks: meta.checks,
        cameras: meta.cameras.map((c) => ({ name: c, media: { kind: "ok", file: camRel(c) } })),
        styles: cmd.styles.map((s) => ({ style: s, media: { kind: "ok", file: styleRel(s) } })),
        clip: { kind: "ok", file: clipRel },
      };
    }
  }

  const base = await compileTimed(scene);
  const compileMs = base.ms;
  const t = performance.now();
  const loaded = await host.load(base.artefact);
  const loadMs = performance.now() - t;
  const cams = camerasOf(base.artefact);
  const first = cams[0]!;
  const force = cmd.force;
  if (force) for (const r of [clipRel, ...cams.map((c) => camRel(c.name)), ...cmd.styles.map(styleRel)]) rmSync(store.abs(r), { force: true });

  try {
    const cameras: { name: string; media: Media }[] = [];
    for (const c of cams) {
      cameras.push({ name: c.name, media: await ensure(store, `camera ${c.name}`, camRel(c.name), async (dest) => {
        writeWebp(dest, { ...cmd.size, rgba: await loaded.frame({ camera: c.camera, ...cmd.size, time: STILL_TIME, params: {} }) });
      }) });
    }

    // Best case: the minimum of a few frames after the stills above warmed everything.
    let best = Infinity, drawn = 0;
    for (let i = 0; i < TIMING_FRAMES; i++) {
      const t0 = performance.now();
      drawn = (await loaded.frameTimed({ camera: first.camera, ...cmd.size, time: STILL_TIME + i / FPS, params: {} })).drawn.triangles;
      best = Math.min(best, performance.now() - t0);
    }

    const clip = await ensure(store, "clip", clipRel, async (dest) => {
      const tmp = `${dest}.part.mp4`;
      const count = Math.max(1, Math.round(cmd.clipSeconds * FPS));
      const video = openVideo(tmp, cmd.size.width, cmd.size.height, FPS);
      try {
        for (let i = 0; i < count; i++) await video.write(await loaded.frame({ camera: first.camera, ...cmd.size, time: i / FPS, params: {} }));
        await video.finish();
      } catch (e) {
        rmSync(tmp, { force: true });
        throw e;
      }
      renameSync(tmp, dest);
    });

    const styles: { style: string; media: Media }[] = [];
    for (const s of cmd.styles) {
      styles.push({ style: s, media: await ensure(store, `style ${s}`, styleRel(s), (dest) => stillIn(host, scene, s, first.camera, cmd, dest)) });
    }

    const checks = await runChecksOf(scene, d.module.checks);
    const numbers: Numbers = { triangles: drawn, draws: base.artefact.stats.draws, compileMs, loadMs, msPerFrame: best };
    const everything = [...cameras, ...styles].every((x) => x.media.kind === "ok") && clip.kind === "ok";
    // The meta file is written last and only for a fully successful scene, so its presence means "all outputs exist".
    if (everything) {
      writeFileSync(store.abs(metaRel), JSON.stringify({ numbers, cameras: cams.map((c) => c.name), checks } satisfies Meta));
      store.ledger.live.add(metaRel);
    }
    return { kind: "scene", name: d.name, source, numbers, cameras, styles, clip, checks };
  } finally {
    loaded.destroy();
  }
}

/** Remove files under media/<scene>/ that this run did not reference: older hashes of outputs that have been remade. */
function sweep(outDir: string, entries: readonly Entry[], kept: ReadonlySet<string>): void {
  for (const e of entries) {
    const dir = join(outDir, "media", e.name);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) if (!kept.has(`media/${e.name}/${f}`)) rmSync(join(dir, f), { force: true });
  }
}

export async function gallery(cmd: GalleryCommand): Promise<{ readonly rendered: number; readonly reused: number; readonly failed: number }> {
  const t0 = performance.now();
  const outDir = resolve(cmd.out);
  const cmdAbs: GalleryCommand = { ...cmd, out: outDir };
  const root = resolve(dirname(new URL(import.meta.url).pathname), "../..");
  const srcDir = join(root, "src");
  const { STYLE_NAMES } = (await import("../style/index.ts")) as { STYLE_NAMES: readonly string[] };
  for (const s of cmd.styles) if (!STYLE_NAMES.includes(s)) throw new UsageError(`--styles: unknown style "${s}" (styles: ${STYLE_NAMES.join(", ")})`);

  const found = await discover(cmd.scenes, process.cwd());
  const wanted = cmd.only.length === 0 ? found : found.filter((d) => cmd.only.includes(d.name));
  for (const n of cmd.only) if (!found.some((d) => d.name === n)) throw new UsageError(`--only: no scene named "${n}" (found: ${found.map((d) => d.name).join(", ") || "none"})`);
  if (found.length === 0) throw new UsageError(`--scenes: no files match ${cmd.scenes.join(", ")}`);

  const skipped = wanted.flatMap((d) => (d.kind === "skipped" ? [{ name: d.name, reason: d.reason }] : []));
  for (const s of skipped) console.log(`skipped   ${s.name}: ${s.reason}`);

  const ledger: Ledger = { rendered: 0, reused: 0, failed: 0, live: new Set() };
  const commit = commitOf(srcDir);
  mkdirSync(outDir, { recursive: true });
  const host = await headlessHost();
  const entries: Entry[] = [];
  const failedScenes: string[] = [];

  for (const d of wanted) {
    if (d.kind === "skipped") continue;
    const source = relative(outDir, d.path);
    console.log(`${d.name}`);
    switch (d.kind) {
      case "unloadable":
        ledger.failed++;
        console.log(`  FAILED    import: ${d.error.split("\n")[0]}`);
        entries.push({ kind: "failed", name: d.name, source, error: d.error });
        failedScenes.push(d.name);
        break;
      case "scene": {
        const store = new Store(outDir, d.name, sha(closureHash(d.path), commit), ledger);
        try {
          entries.push(await renderScene(host, d, cmdAbs, store));
        } catch (e) {
          ledger.failed++;
          console.log(`  FAILED    scene: ${errText(e).split("\n")[0]}`);
          entries.push({ kind: "failed", name: d.name, source, error: errText(e) });
          failedScenes.push(d.name);
        }
        break;
      }
    }
  }

  const data: GalleryData = {
    commit: headCommit(srcDir), date: new Date().toISOString().slice(0, 16).replace("T", " "),
    styles: cmd.styles, size: cmd.size, skipped, entries,
  };
  sweep(outDir, entries, ledger.live);
  writeFileSync(join(outDir, "index.html"), renderPage(data));

  console.log(`\n${ledger.rendered} rendered, ${ledger.reused} reused, ${ledger.failed} failed, ${skipped.length} skipped  (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
  if (failedScenes.length > 0) console.log(`failed scenes: ${failedScenes.join(", ")}`);
  console.log(`page: ${join(outDir, "index.html")}`);
  return { rendered: ledger.rendered, reused: ledger.reused, failed: ledger.failed };
}
