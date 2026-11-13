// Put a song on an already rendered clip, without rendering again (docs/lineup.md, "The song"): the video stream copied
// as it is, the WAV as AAC 48 kHz stereo. The clip and the song must be the same length (one period each).
//
//   bun tools/mux_song.ts <clip.mp4> <song.wav> <out.mp4>
//
// Then checks what it wrote: the video packets the same as the clip's (md5), the audio's duration, and the decoded
// audio's lag against the WAV (cross-correlated over the first second).
import { renameSync } from "node:fs";
import { RATE, readWav } from "./synth.ts";

const run = (args: string[]): { out: Buffer; err: string } => {
  const r = Bun.spawnSync(args);
  if (r.exitCode !== 0) throw new Error(`${args[0]} failed (${r.exitCode}): ${r.stderr.toString().slice(-600)}`);
  return { out: r.stdout as Buffer, err: r.stderr.toString() };
};
const duration = (path: string, stream: "v" | "a"): number => Number(run(["ffprobe", "-v", "error", "-select_streams", `${stream}:0`, "-show_entries", "stream=duration", "-of", "csv=p=0", path]).out.toString().trim());
const videoMd5 = (path: string): string => run(["ffmpeg", "-v", "error", "-i", path, "-map", "0:v:0", "-c", "copy", "-f", "md5", "-"]).out.toString().trim();

/** Mux `wav` onto `clip` as `out` (the video copied); refuses a song and clip of different lengths. Returns what it checked. */
export function muxSong(clip: string, wav: string, out: string): string {
  const song = readWav(wav), seconds = song.l.length / RATE, video = duration(clip, "v");
  if (Math.abs(video - seconds) > 1e-3) throw new Error(`mux: the clip is ${video} s and the song ${seconds} s; both must be one period`);
  // Written beside the target and renamed, so the clip may be its own output.
  const tmp = `${out}.muxing.mp4`;
  run(["ffmpeg", "-y", "-v", "error", "-i", clip, "-i", wav, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", String(RATE), "-movflags", "+faststart", tmp]);
  const same = videoMd5(tmp) === videoMd5(clip);
  renameSync(tmp, out);
  // The decoded audio against the WAV: the lag that best aligns the first second (left channel).
  const dec = run(["ffmpeg", "-v", "error", "-i", out, "-map", "0:a:0", "-f", "f32le", "-ac", "2", "-ar", String(RATE), "-"]).out;
  const d = new Float32Array(dec.buffer, dec.byteOffset, dec.byteLength / 4), n = d.length / 2;
  let best = 0, bestC = -Infinity;
  for (let lag = -2048; lag <= 2048; lag++) {
    let c = 0;
    for (let i = 4096; i < RATE; i++) c += d[2 * (i + lag)]! * song.l[i]!;
    if (c > bestC) { bestC = c; best = lag; }
  }
  return `${out}: video ${same ? "the same packets as the clip's" : "DIFFERENT from the clip's"}; audio ${duration(out, "a").toFixed(4)} s, ${n} samples decoded (the WAV ${song.l.length}); decoded audio lags the WAV by ${best} samples`;
}

if (import.meta.main) {
  const [clip, wav, out] = process.argv.slice(2);
  if (clip === undefined || wav === undefined || out === undefined) throw new Error("usage: bun tools/mux_song.ts <clip.mp4> <song.wav> <out.mp4>");
  console.log(muxSong(clip, wav, out));
}
