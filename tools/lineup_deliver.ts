// The crab lineup's deliverables: the film recipe's runner (tools/film.ts) on the lineup (examples/bosses/crab_lineup.ts,
// shots in examples/bosses/lineup_shots.ts, docs/lineup.md "A drilled group"), plus what only the lineup has: the sync
// instrument's table (sync.txt), the song muxed on, and the attacks' counts in README.txt.
//
//   bun tools/lineup_deliver.ts <out dir> <all|shots,strip,seam,time,clips> [--line fiddler,mask,islander,bruiser,stilt]
//                               [--look default] [--formats wide,square] [--fps 30,60] [--pick t,t,...] [--strip-width 960]
//                               [--scale 1] [--silent]
//
// --line: the variants left to right, as many as the dance has members; `+` for picks (`stilt+face=mask`). --look: a
// look of `LOOKS` in the scene. Clips are <out>/lineup_<format>_<fps>fps.mp4, one period each, carrying the song
// (examples/bosses/crab_song.ts, written as song.wav beside them) unless --silent. The rest: tools/film.ts.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { compileScene } from "../src/compile/index.ts";
import { Probe } from "../src/check.ts";
import { writeWav } from "./synth.ts";
import { renderSong } from "./crab_song.ts";
import { deliver, parseOptions } from "./film.ts";
import { film } from "../examples/recipes/film.ts";
import { ATTACK_COUNTS, DANCE, FAN, lineupScene, LINE } from "../examples/bosses/crab_lineup.ts";
import { BEAT, BPM, formats as formatsOf, hostInputs, PERIOD } from "../examples/bosses/lineup_shots.ts";

const argv = process.argv.slice(2);
const flag = (name: string, d: string): string => { const i = argv.indexOf(name); if (i < 0) return d; const v = argv[i + 1]; if (v === undefined) throw new Error(`${name} needs a value`); argv.splice(i, 2); return v; };
const line = flag("--line", LINE.join(",")).split(",").map((v) => v.replaceAll("+", ","));
const look = flag("--look", "default");
const formatNames = flag("--formats", "wide,square").split(",");
const silentAt = argv.indexOf("--silent"), silent = silentAt >= 0;
if (silent) argv.splice(silentAt, 1);
if (!argv.includes("--fps")) argv.push("--fps", "30,60");
const o = parseOptions(argv);
const dir = argv[0];
if (dir === undefined || argv.length !== 1) throw new Error("usage: bun tools/lineup_deliver.ts <out dir> <all|shots,strip,seam,time,clips> [--line a,b,c,d,e] [--look name] [--formats wide,square] [--fps 30,60] [--pick t,...] [--strip-width 960] [--scale 1] [--silent]");
const F = formatsOf(line);
const formats = formatNames.map((n) => { if (!(n in F)) throw new Error(`no format "${n}": [${Object.keys(F).join(", ")}]`); return F[n as keyof typeof F]; });
mkdirSync(dir, { recursive: true });

const built = lineupScene({ line, look });
// The sync instrument on the CPU from the same build (a few seconds): what the clip should show, measured.
{
  const rows = built.sync.table(new Probe(compileScene(built.scene), {}));
  const lines = [
    `the routine: ${DANCE.members} members (${line.join(", ")}), ${DANCE.period} s; ${rows.length} key-channels measured from each member's rig (CPU)`,
    "count  channel  who          arrival spread  size spread  pass",
    ...rows.map((r) => `${String(r.count).padStart(5)}  ${r.channel.padEnd(7)}  ${r.who.padEnd(11)}  ${(1000 * r.arrival).toFixed(2).padStart(9)} ms  ${(100 * r.size).toFixed(2).padStart(9)}%  ${r.pass ? "yes" : "NO"}`),
    `worst arrival spread ${(1000 * Math.max(...rows.map((r) => r.arrival))).toFixed(3)} ms (limit 16.7); worst size spread ${(100 * Math.max(...rows.map((r) => r.size))).toFixed(3)}% (limit 5); ${rows.filter((r) => !r.pass).length} out of limits`,
  ];
  writeFileSync(`${dir}/sync.txt`, lines.join("\n") + "\n");
  console.log(lines[lines.length - 1]);
}

const clips = o.what === "all" || o.what.includes("clips"), song = `${dir}/song.wav`;
if (clips && !silent) { const m = renderSong("main"); writeWav(song, m.mix); console.log(`wrote ${song}: ${m.lufs.toFixed(1)} LUFS, peak ${m.peakDb.toFixed(1)} dBFS`); }
// The host's boats (the landed thrown boats parked between cuts): every frame of every deliverable reads them.
const members = line.map((_, k) => `crab${k}`);
const lineup = film({
  name: "lineup", scene: built.scene, seconds: PERIOD, tempo: { kind: "beats", bpm: BPM, perBar: 4 }, formats,
  inputs: (t) => hostInputs(members, (k) => FAN[k]!, t),
});
await deliver(lineup, dir, { ...o, sound: clips && !silent ? song : undefined });

const at = (c: number) => `${(c * BEAT).toFixed(1)} s (count ${c})`;
writeFileSync(`${dir}/README.txt`, [
  "The crab lineup: examples/bosses/crab_lineup.ts, shots in examples/bosses/lineup_shots.ts (docs/lineup.md); delivered by tools/film.ts.",
  `Left to right: ${line.join(", ")}. Look: ${look}. The dance's score: examples/bosses/crab_lineup.ts (DANCE); the sync instrument: sync.txt.`,
  silent ? "No audio (--silent)." : "Audio: the song (examples/bosses/crab_song.ts, docs/lineup.md \"The song\"), song.wav beside the clips; AAC in each clip.",
  `The attacks, in unison: slam down ${at(ATTACK_COUNTS.slam)}; grips close ${at(ATTACK_COUNTS.grip)}; boats let go ${at(ATTACK_COUNTS.release)}; they land ${at(ATTACK_COUNTS.lands)}.`,
  "", readFileSync(`${dir}/README.txt`, "utf8"),
].join("\n"));
process.exit(0);
