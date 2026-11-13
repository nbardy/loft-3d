// The lineup's song as WAVs (docs/lineup.md, "The song"): exactly one period, 48 kHz stereo, -14 LUFS, looping.
//
//   bun tools/crab_song.ts <out dir> [take ...]     takes: main otherHook halfTime bMinor (default: all four)
//
// Writes <out dir>/song.wav (main) and song_<take>.wav for the alternates, and prints each master's numbers.
import { mkdirSync } from "node:fs";
import { crabSong, TAKES, type Take } from "../examples/bosses/crab_song.ts";
import { PERIOD } from "../examples/bosses/lineup_shots.ts";
import { DANCE } from "../examples/bosses/crab_lineup.ts";
import { master, mixBuses, RATE, sampleOf, writeWav, type Master } from "./synth.ts";

/** The master of a take: the mix, its gain, loudness and peak. */
export function renderSong(take: Take): Master {
  if (DANCE.period !== PERIOD) throw new Error(`crab song: the dance's period (${DANCE.period} s) is not the video's (${PERIOD} s)`);
  const song = crabSong(take), N = Math.round(PERIOD * RATE);
  const kicks = song.events.filter((e) => e.sound.kind === "kick" || e.sound.kind === "impact").map((e) => sampleOf(e.at, N));
  return master(mixBuses(song.events, PERIOD), kicks, { lufs: -14, ceilingDb: -1.3, rt60: 1.4 });
}
export const songFile = (take: Take): string => (take === "main" ? "song.wav" : `song_${take}.wav`);

if (import.meta.main) {
  const [dir, ...asked] = process.argv.slice(2);
  if (dir === undefined) throw new Error("usage: bun tools/crab_song.ts <out dir> [main|otherHook|halfTime|bMinor ...]");
  const takes = (asked.length > 0 ? asked : [...TAKES]).map((t) => { const k = TAKES.find((x) => x === t); if (k === undefined) throw new Error(`no take "${t}": [${TAKES.join(", ")}]`); return k; });
  mkdirSync(dir, { recursive: true });
  for (const take of takes) {
    const t0 = performance.now(), m = renderSong(take), path = `${dir}/${songFile(take)}`;
    writeWav(path, m.mix);
    console.log(`wrote ${path}: ${(m.mix.l.length / RATE).toFixed(3)} s, gain ${m.gainDb.toFixed(1)} dB, ${m.lufs.toFixed(2)} LUFS, sample peak ${m.peakDb.toFixed(2)} dBFS (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
  }
}
