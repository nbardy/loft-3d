// The lineup's sync instrument, key by key (docs/lineup.md, "The instrument"): every key the score sets that the
// readouts measure, each member's arrival (seconds, against the scored count plus its canon delay) and value, and the
// spreads the check judges. CPU only, no render: `bun tools/lineup_sync.ts [--out file]` (a few seconds after the compile).
import { writeFileSync } from "node:fs";
import { Probe } from "../src/check.ts";
import { compileScene } from "../src/compile/index.ts";
import { DANCE, LINE, lineupScene } from "../examples/bosses/crab_lineup.ts";

const args = process.argv.slice(2), out = args.includes("--out") ? args[args.indexOf("--out") + 1] : undefined;
const built = lineupScene({ line: LINE, look: "default" });
const probe = new Probe(compileScene(built.scene), {});
const t0 = performance.now(), rows = built.sync.table(probe);
const lines = [
  `the routine: ${DANCE.members} members (${LINE.join(", ")}), ${DANCE.period} s; ${rows.length} key-channels measured in ${((performance.now() - t0) / 1000).toFixed(1)} s`,
  "count  channel  who          arrival spread  size spread  pass  arrivals (s, each member)                 values",
  ...rows.map((r) => `${String(r.count).padStart(5)}  ${r.channel.padEnd(7)}  ${r.who.padEnd(11)}  ${(1000 * r.arrival).toFixed(2).padStart(9)} ms  ${(100 * r.size).toFixed(2).padStart(9)}%  ${r.pass ? "yes " : "NO  "}  ${r.arrivals.map((a) => a.toFixed(4)).join(" ").padEnd(40)}  ${r.values.map((v) => v.toFixed(3)).join(" ")}`),
  `worst arrival spread ${(1000 * Math.max(...rows.map((r) => r.arrival))).toFixed(3)} ms; worst size spread ${(100 * Math.max(...rows.map((r) => r.size))).toFixed(3)}%; ${rows.filter((r) => !r.pass).length} out of limits`,
];
console.log(lines.join("\n"));
if (out !== undefined) writeFileSync(out, lines.join("\n") + "\n");
process.exit(0);
