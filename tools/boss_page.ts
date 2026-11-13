// out/bosses/index.html: each of the five monsters beside its old version in the game.
//   bun tools/boss_page.ts
// The new pictures are whatever is in out/bosses/<name>/ (render them with `loft render|frames|clip`). The old ones
// are copied from the game repository's baseline renders, when that folder is present.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

const OUT = new URL("../out/bosses/", import.meta.url).pathname;
const OLD = `${homedir()}/git/room-runners-arena-lib/output/boss_variants/baseline`;

const MONSTERS: readonly { name: string; title: string; subject: string }[] = [
  { name: "maelstrom_wyrm", title: "Maelstrom Wyrm", subject: "A sea serpent coiled round the whirlpool it keeps spinning." },
  { name: "reefback_titan", title: "Reefback Titan", subject: "A hermit crab the size of an island, wearing a dead atoll and a ruined fort." },
  { name: "thundermaw", title: "Thundermaw", subject: "The storm serpent, in its thunderhead." },
  { name: "tithe_fleet", title: "Tithe Fleet", subject: "A drowned admiral's ghost flagship and three phantom escorts." },
  { name: "wreckers_lamp", title: "Wrecker's Lamp", subject: "A spire of coral and bone round a drowned siren whose eye is the lamp." },
];

/** The old version's gameplay still, copied in as WebP; the path relative to the page, or a note that it is missing. */
function oldStill(name: string): string {
  const src = `${OLD}/art_boss_${name}/gameplay-desktop.png`;
  if (!existsSync(src)) return `<p class="missing">old render not found at ${src}</p>`;
  mkdirSync(`${OUT}${name}`, { recursive: true });
  execFileSync("cwebp", ["-quiet", "-q", "90", src, "-o", `${OUT}${name}/old.webp`]);
  return `<img src="${name}/old.webp" alt="old ${name}">`;
}

const section = (m: (typeof MONSTERS)[number]): string => {
  const have = existsSync(`${OUT}${m.name}`) ? readdirSync(`${OUT}${m.name}`) : [];
  const img = (file: string, label: string) => (have.includes(file) ? `<figure><img src="${m.name}/${file}" alt="${label}"><figcaption>${label}</figcaption></figure>` : "");
  const frames = have.find((f) => /frames\.webp$/.test(f));
  const STYLE_ROW = [["three.webp", "Print, thick line (the scene's own style)"], ["style_toon.webp", "Toon, thick line"], ["style_papercraft.webp", "Papercraft"], ["style_biolume.webp", "Biolume"]] as const;
  return `<section>
<h2>${m.title}</h2><p class="subject">${m.subject}</p>
<div class="pair"><figure>${oldStill(m.name)}<figcaption>Old, in the game</figcaption></figure>${img("game.webp", "New, game camera")}</div>
<div class="pair">${img("close.webp", "Close")}</div>
<h3>The same scene in four styles</h3>
<div class="quad">${STYLE_ROW.map(([f, label]) => img(f, label)).join("")}</div>
${img("grab.webp", "The grab: reach, close on the ship's beam, lift, squeeze, set down")}
${frames ? `<figure><img src="${m.name}/${frames}" alt="attack"><figcaption>The attack, frame by frame</figcaption></figure>` : ""}
${have.includes("clip.mp4") ? `<figure><video src="${m.name}/clip.mp4" controls loop muted playsinline></video><figcaption>In motion</figcaption></figure>` : ""}
</section>`;
};

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Five monsters</title>
<style>
  :root { --bg: #10151c; --line: #263140; --ink: #e6edf3; --soft: #9aa7b4; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.5 -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; }
  main { max-width: 1280px; margin: 0 auto; padding: 28px 16px 64px; }
  h1 { font-size: 28px; margin: 0 0 6px; } h2 { font-size: 22px; margin: 0 0 2px; }
  .lede, .subject, figcaption, .missing { color: var(--soft); } .subject { margin: 0 0 12px; }
  section { border-top: 1px solid var(--line); padding-top: 22px; margin-top: 30px; }
  .pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; margin-bottom: 12px; }
  .quad { display: grid; grid-template-columns: repeat(auto-fit, minmax(480px, 1fr)); gap: 12px; margin-bottom: 12px; }
  h3 { font-size: 16px; margin: 18px 0 8px; color: var(--soft); font-weight: 600; }
  figure { margin: 0 0 12px; } figcaption { font-size: 13.5px; margin-top: 4px; }
  img, video { display: block; width: 100%; height: auto; border-radius: 6px; border: 1px solid var(--line); background: #0b0f14; }
</style></head><body><main>
<h1>Five monsters, old and new</h1>
<p class="lede">The same five subjects as the game's bosses, rebuilt in Loft in a woodblock-print direction. The old pictures are from the game's showroom.</p>
${MONSTERS.map(section).join("\n")}
</main></body></html>`;
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}index.html`, html);
console.log(`wrote ${OUT}index.html`);
