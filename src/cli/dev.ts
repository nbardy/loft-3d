// `loft dev`: bundle viewer/main.ts together with the scene for the browser, serve it, rebuild on change and tell
// the page over a WebSocket. The scene reaches the bundle through the virtual module "scene:current", so the viewer
// source never names a scene.
import { watch } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Command } from "./args.ts";

const ROOT = resolve(import.meta.dir, "../..");

type DevCommand = Extract<Command, { kind: "dev" }>;
type Built = { readonly kind: "ok"; readonly js: string } | { readonly kind: "error"; readonly text: string };

/**
 * The scene and the compiler are imported lazily (`import()` stays inside the one bundle), so a scene that throws while
 * its module evaluates is an error the viewer can show, not a blank page: the viewer's own code is already running.
 */
function sceneModule(cmd: DevCommand): string {
  const idx = JSON.stringify(resolve(ROOT, "src/index.ts"));
  switch (cmd.source.kind) {
    // `build(style)`: "scene" for the scene's own style, or a name from src/style/index.ts (the viewer's selector);
    // `startStyle` is the `--style` the server was started with. The fixture is a compiled artefact: no styles.
    case "fixture":
      return `export const sceneName = "fixture";\nexport const styleNames = [];\nexport const startStyle = "scene";\nexport const build = async () => (await import(${JSON.stringify(resolve(ROOT, "src/host/fixture.ts"))})).fixture;\n`;
    case "file": {
      const styles = JSON.stringify(resolve(ROOT, "src/style/index.ts"));
      const start = JSON.stringify(cmd.source.style.kind === "named" ? cmd.source.style.name : "scene");
      // A design's chosen variant (validated when the server starts, src/cli/variant.ts), or the module's default export.
      const pick = cmd.source.variant.kind === "ask" ? `mod.design.build(mod.design.resolve(${JSON.stringify(cmd.source.variant.ask)})).scene` : "mod.default";
      return `export const sceneName = ${JSON.stringify(cmd.source.path)};\nexport { STYLE_NAMES as styleNames } from ${styles};\nexport const startStyle = ${start};\nexport const build = async (style) => {\n  const [mod, { compile }, s] = await Promise.all([import(${JSON.stringify(resolve(cmd.source.path))}), import(${idx}), import(${styles})]);\n  const scene = ${pick};\n  return compile(style === "scene" ? scene : s.withStyle(scene, s.styleNamed(style)));\n};\n`;
    }
  }
}

/**
 * Served as /live.js and independent of the bundle, so a build that fails still gets its error on the page and the page
 * still reloads when the file is fixed. `reload` keeps nothing itself: the viewer saves its state on `pagehide`.
 */
const LIVE_JS = `
const box = document.getElementById("buildError");
let wasConnected = false;
function connect() {
  const ws = new WebSocket("ws://" + location.host + "/ws");
  ws.onopen = () => { if (wasConnected) location.reload(); wasConnected = true; };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "reload") location.reload();
    else { box.textContent = "build failed:\\n" + msg.text; box.hidden = false; }
  };
  ws.onclose = () => setTimeout(connect, 500);
}
connect();
`;

/** Only these edits can change what the page shows; screenshots and logs written beside a scene must not rebuild. */
const SOURCE_FILE = /\.(ts|tsx|js|json|wgsl|css|html)$/;

async function bundle(cmd: DevCommand): Promise<Built> {
  const result = await Bun.build({
    entrypoints: [resolve(ROOT, "viewer/main.ts")],
    target: "browser",
    sourcemap: "inline",
    plugins: [{
      name: "loft-scene",
      setup(b) {
        b.onResolve({ filter: /^scene:current$/ }, () => ({ path: "scene:current", namespace: "loft" }));
        b.onLoad({ filter: /.*/, namespace: "loft" }, () => ({ contents: sceneModule(cmd), loader: "ts", resolveDir: ROOT }));
      },
    }],
    throw: false,
  });
  if (!result.success) return { kind: "error", text: result.logs.map((l) => l.message).join("\n") };
  return { kind: "ok", js: await result.outputs[0]!.text() };
}

export async function dev(cmd: DevCommand): Promise<void> {
  // An unknown variant, slot or option fails here, in the terminal, with the valid names; not later in the page.
  if (cmd.source.kind === "file" && cmd.source.variant.kind === "ask") await (await import("./variant.ts")).chosenAt(cmd.source.path, cmd.source.variant);
  let built = await bundle(cmd);
  const sockets = new Set<{ send(s: string): void }>();
  const announce = () => {
    const msg = JSON.stringify(built.kind === "ok" ? { type: "reload" } : { type: "error", text: built.text });
    for (const s of sockets) s.send(msg);
  };

  const server = Bun.serve({
    port: cmd.port,
    fetch(req, srv) {
      const url = new URL(req.url);
      switch (url.pathname) {
        case "/": return new Response(Bun.file(resolve(ROOT, "viewer/index.html")));
        case "/style.css": return new Response(Bun.file(resolve(ROOT, "viewer/style.css")));
        case "/live.js": return new Response(LIVE_JS, { headers: { "content-type": "text/javascript", "cache-control": "no-store" } });
        // A failed build serves an empty module: live.js owns showing the error and the reload that follows the fix.
        case "/app.js": return new Response(built.kind === "ok" ? built.js : "", { headers: { "content-type": "text/javascript", "cache-control": "no-store" } });
        case "/favicon.ico": return new Response(null, { status: 204 });
        case "/ws": return srv.upgrade(req) ? undefined : new Response("expected a WebSocket", { status: 426 });
        default: return new Response("not found", { status: 404 });
      }
    },
    websocket: {
      open: (ws) => { sockets.add(ws); if (built.kind === "error") ws.send(JSON.stringify({ type: "error", text: built.text })); },
      close: (ws) => { sockets.delete(ws); },
      message() {},
    },
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const rebuild = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const t = performance.now();
      built = await bundle(cmd);
      console.log(`rebuild  ${(performance.now() - t).toFixed(0)} ms  ${built.kind === "ok" ? "ok" : "ERROR\n" + built.text}`);
      announce();
    }, 80);
  };
  const dirs = [resolve(ROOT, "src"), resolve(ROOT, "examples"), resolve(ROOT, "viewer")];
  if (cmd.source.kind === "file") dirs.push(dirname(resolve(cmd.source.path)));
  for (const d of new Set(dirs)) {
    try { watch(d, { recursive: true }, (_event, file) => { if (file === null || SOURCE_FILE.test(file)) rebuild(); }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
  console.log(`loft dev  http://localhost:${server.port}/  (${cmd.source.kind === "file" ? cmd.source.path : "fixture"})  ctrl-c to stop`);
  await new Promise(() => {});
}
