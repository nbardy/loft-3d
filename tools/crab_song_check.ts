// The song's instruments (docs/lineup.md, "The song"): what the composition predicted, measured on what was written.
//
//   bun tools/crab_song_check.ts <dir with song.wav>
//
// Prints: onsets (each kick, clap, impact and clack rendered alone through the mixer's own placement), the claws against
// the score (and against a probe score that adds clicks), loudness and peak (ffmpeg's ebur128 on the file, and clipped
// samples), loudness and energy by band in each section, the seam (the file looped twice), the harmony (from the
// events), and each alternate's loudness and peak. Writes spectrogram.webp (counts marked: thin each count, bright each
// bar, red the attacks).
import { existsSync } from "node:fs";
import { crabSong, cuesOf, MINOR, PENTATONIC, TAKES, type Song } from "../examples/bosses/crab_song.ts";
import { DANCE } from "../examples/bosses/crab_lineup.ts";
import { BEAT, PERIOD } from "../examples/bosses/lineup_shots.ts";
import { routine, type Key } from "../src/spacetime/routine.ts";
import { writeWebp } from "../src/cli/image.ts";
import { songFile } from "./crab_song.ts";
import { kWeighted, momentary, onsetError, pitchesOf, RATE, readWav, type Event, type Kind, type Stereo } from "./synth.ts";

const dir = process.argv[2];
if (dir === undefined) throw new Error("usage: bun tools/crab_song_check.ts <dir with song.wav>");
const N = Math.round(PERIOD * RATE), out: string[] = [];
const say = (s: string) => { out.push(s); console.log(s); };
const f2 = (x: number, d = 2) => x.toFixed(d);

// ---- onsets ----
const song = crabSong("main");
const onsets = (s: Song, kinds: readonly Kind[]) => kinds.map((k) => {
  const es = s.events.filter((e) => e.sound.kind === k), errs = es.map((e) => onsetError(e, PERIOD));
  return { k, n: es.length, worst: errs.reduce((w, x) => (Number.isNaN(x) || Math.abs(x) > Math.abs(w) ? x : w), 0) };
});
say("onsets (each event alone, through the mixer's placement; where it first passes 5% of its peak):");
for (const o of onsets(song, ["kick", "clap", "impact", "clack"])) say(`  ${o.k.padEnd(7)} ${String(o.n).padStart(3)} events, worst ${o.n === 0 ? "-" : `${f2(1000 * o.worst, 3)} ms`}  ${o.n === 0 || Math.abs(o.worst) <= 0.001 ? "within 1 ms" : "OUT"}`);
const impacts = song.events.filter((e) => e.sound.kind === "impact").map((e) => e.at / BEAT);
say(`  impacts on counts [${impacts.map((c) => f2(c, 3)).join(", ")}]`);

// ---- the claws: a clack only on a scored click ----
const clicked = (s: Song) => s.cues.clicks.map((c) => +((c.at % s.cues.length) * BEAT).toFixed(6)).sort((a, b) => a - b);
const clacks = (s: Song) => s.events.filter((e) => e.sound.kind === "clack").map((e) => +e.at.toFixed(6)).sort((a, b) => a - b);
const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]!) < 1e-9);
say(`claws: the score has ${song.cues.clicks.length} snaps; the song has ${clacks(song).length} clacks; ${same(clicked(song), clacks(song)) ? "one clack per snap, at its time, none elsewhere" : "MISMATCH"}`);
// (Until the score had clicks of its own, a probe score with added snaps stood here; the real score's snaps are the test now.)

// ---- loudness and peak ----
const wav = readWav(`${dir}/song.wav`);
const ebur = (path: string) => {
  const r = Bun.spawnSync(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-"]), e = r.stderr.toString();
  const grab = (re: RegExp) => { const m = re.exec(e); return m === null ? NaN : Number(m[1]); };
  return { I: grab(/I:\s+(-?[\d.]+) LUFS/), LRA: grab(/LRA:\s+(-?[\d.]+) LU/), TP: grab(/Peak:\s+(-?[\d.]+) dBFS/) };
};
const peakOf = (x: Int16Array) => { let p = 0, clip = 0; for (const v of x) { p = Math.max(p, Math.abs(v)); if (v >= 32767 || v <= -32768) clip++; } return { db: 20 * Math.log10(p / 32767), clip }; };
{
  const e = ebur(`${dir}/song.wav`), p = peakOf(wav.raw);
  say(`loudness: ${f2(wav.l.length / RATE, 4)} s (${wav.l.length} samples, ${wav.l.length === N ? "one period" : "NOT one period"}); ffmpeg ebur128: integrated ${f2(e.I, 1)} LUFS, range ${f2(e.LRA, 1)} LU, true peak ${f2(e.TP, 1)} dBFS; sample peak ${f2(p.db)} dBFS; ${p.clip} clipped samples`);
}

// ---- sections: loudness and energy by band ----
const fft = (re: Float64Array, im: Float64Array) => {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j]!, re[i]!]; [im[i], im[j]] = [im[j]!, im[i]!]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const ur = re[i + k]!, ui = im[i + k]!, vr = re[i + k + len / 2]! * cr - im[i + k + len / 2]! * ci, vi = re[i + k + len / 2]! * ci + im[i + k + len / 2]! * cr; re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
};
const W = 2048, hann = Float64Array.from({ length: W }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / W));
/** Power spectrum of the mono mix in a window starting at sample s (wrapping). */
const spectrum = (x: Stereo, s: number): Float64Array => {
  const re = new Float64Array(W), im = new Float64Array(W);
  for (let i = 0; i < W; i++) { const j = (s + i) % N; re[i] = 0.5 * (x.l[j]! + x.r[j]!) * hann[i]!; }
  fft(re, im);
  return Float64Array.from({ length: W / 2 }, (_, k) => re[k]! ** 2 + im[k]! ** 2);
};
const BANDS = [["sub", 0, 60], ["bass", 60, 250], ["mids", 250, 2000], ["presence", 2000, 6000], ["air", 6000, 24000]] as const;
const k = kWeighted(wav);
say("sections: mean momentary loudness (LUFS) and energy by band (dB of the section's total): sub, bass, mids, presence, air");
const bySection: Record<string, { lufs: number; bands: number[] }> = {};
for (const sec of song.sections) {
  const a = Math.round(sec.from * BEAT * RATE), b = Math.round(sec.to * BEAT * RATE);
  let e = 0, m = 0;
  for (let s = a + Math.round(0.4 * RATE); s <= b; s += 2400) { e += 10 ** ((momentary(k, s) + 0.691) / 10); m++; }
  const lufs = m === 0 ? NaN : -0.691 + 10 * Math.log10(e / m);
  const bands = BANDS.map(() => 0);
  for (let s = a; s + W <= b; s += W / 2) { const p = spectrum(wav, s); p.forEach((v, k2) => { const f = (k2 * RATE) / W; const i = BANDS.findIndex(([, lo, hi]) => f >= lo && f < hi); if (i >= 0) bands[i]! += v; }); }
  const tot = bands.reduce((x, y) => x + y, 0), db = bands.map((v) => 10 * Math.log10(v / tot));
  bySection[sec.name] = { lufs, bands: db };
  say(`  ${sec.name.padEnd(12)} counts ${String(sec.from).padStart(2)} to ${String(sec.to).padStart(2)}: ${f2(lufs, 1).padStart(6)} LUFS; ${db.map((d) => f2(d, 1).padStart(6)).join("")}`);
}
{
  const v = bySection.verse!, c = bySection.chorus!;
  const bright = (x: number[]) => 10 * Math.log10(10 ** (x[3]! / 10) + 10 ** (x[4]! / 10));
  say(`  the chorus against the verse: ${f2(c.lufs - v.lufs, 1)} dB louder; presence ${f2(c.bands[3]! - v.bands[3]!, 1)} dB, air ${f2(c.bands[4]! - v.bands[4]!, 1)} dB of the total (presence and air together ${f2(bright(c.bands) - bright(v.bands), 1)} dB)`);
}

// ---- the seam: the file looped twice ----
{
  const two = (c: Float32Array) => { const t = new Float32Array(2 * N); t.set(c); t.set(c, N); return t; };
  const L2 = two(wav.l), R2 = two(wav.r), step = (i: number) => Math.max(Math.abs(L2[i + 1]! - L2[i]!), Math.abs(R2[i + 1]! - R2[i]!));
  const near = Math.round(0.002 * RATE), around = Math.round(0.1 * RATE);
  let atSeam = 0, elsewhere = 0;
  for (let i = N - near; i < N + near; i++) atSeam = Math.max(atSeam, step(i));
  for (let i = N - around; i < N + around; i++) if (i < N - near || i >= N + near) elsewhere = Math.max(elsewhere, step(i));
  const Ls = [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3].map((d) => momentary(k, Math.round(N + d * RATE)));
  const bump = Ls[3]! - (Ls[2]! + Ls[4]!) / 2;
  say(`seam: largest sample step within 2 ms of it ${f2(atSeam, 4)}, within 100 ms around it ${f2(elsewhere, 4)} (${atSeam <= elsewhere ? "no larger" : "LARGER"}); momentary loudness at -0.3 .. +0.3 s: ${Ls.map((l) => f2(l, 1)).join(", ")} LUFS; bump at the seam ${f2(bump, 2)} dB`);
}

// ---- harmony ----
const harmony = (s: Song) => {
  const notes = s.events.flatMap((e: Event) => pitchesOf(e.sound).map((p) => ({ ...p, from: e.at, to: e.at + p.seconds })));
  const pc = (p: number) => (((p - s.tonic) % 12) + 12) % 12;
  const outKey = notes.filter((x) => !MINOR.includes(pc(x.pitch))), outPenta = notes.filter((x) => (x.role === "melody" || x.role === "tuned") && !PENTATONIC.includes(pc(x.pitch)));
  const L = s.cues.length, chordAt = (c: number) => ([...s.chords].reverse().find((x) => x.at <= c) ?? s.chords[s.chords.length - 1]!).chord;
  const bassDown = notes.filter((x) => x.role === "bass" && Math.abs((x.from / BEAT) % 4) < 1e-6);
  const wrongRoot = bassDown.filter((x) => (x.pitch - chordAt(((x.from / BEAT) % L)).root) % 12 !== 0);
  const P = PERIOD, overlap = (a: { from: number; to: number }, b: { from: number; to: number }) => [0, P, -P].some((d) => a.from < b.to + d && b.from + d < a.to);
  const clashes: string[] = [];
  for (let i = 0; i < notes.length; i++) for (let j = i + 1; j < notes.length; j++) {
    const a = notes[i]!, b = notes[j]!, d = Math.abs(a.pitch - b.pitch);
    if ((d === 1 || d === 13) && overlap(a, b)) clashes.push(`${f2(a.from / BEAT, 2)}/${f2(b.from / BEAT, 2)} (${a.role} ${a.pitch}, ${b.role} ${b.pitch})`);
  }
  return { notes: notes.length, outKey: outKey.length, outPenta: outPenta.length, bassDown: bassDown.length, wrongRoot: wrongRoot.length, clashes };
};
for (const take of TAKES) {
  const h = harmony(take === "main" ? song : crabSong(take));
  say(`harmony (${take}): ${h.notes} pitched notes; ${h.outKey} outside the key, ${h.outPenta} melodic outside the pentatonic; bass on ${h.bassDown} downbeats, ${h.wrongRoot} off the chord's root; ${h.clashes.length} overlapping pairs 1 or 13 semitones apart${h.clashes.length > 0 ? `: ${h.clashes.slice(0, 6).join("; ")}` : ""}`);
}

// ---- the alternates ----
for (const take of TAKES.filter((t) => t !== "main")) {
  const path = `${dir}/${songFile(take)}`;
  if (!existsSync(path)) { say(`${take}: not written`); continue; }
  const e = ebur(path), p = peakOf(readWav(path).raw);
  say(`${take}: ${f2(e.I, 1)} LUFS, true peak ${f2(e.TP, 1)} dBFS, sample peak ${f2(p.db)} dBFS, ${p.clip} clipped`);
}

// ---- the spectrogram ----
{
  const Wd = 1600, H = 420, fLo = 30, fHi = 16000, rgba = new Uint8Array(Wd * H * 4);
  const cols: Float64Array[] = [];
  let top = -Infinity;
  for (let x = 0; x < Wd; x++) {
    const p = spectrum(wav, Math.round((x / Wd) * N)), col = new Float64Array(H);
    for (let y = 0; y < H; y++) {
      const f = fLo * (fHi / fLo) ** (1 - y / (H - 1)), bin = Math.min(W / 2 - 1, Math.round((f * W) / RATE));
      col[y] = 10 * Math.log10(p[bin]! + 1e-12); top = Math.max(top, col[y]!);
    }
    cols.push(col);
  }
  const ramp = (u: number): [number, number, number] => [255 * Math.min(1, 1.6 * u), 255 * Math.max(0, Math.min(1, 2 * u - 0.6)), 255 * Math.max(0, Math.min(1, 0.6 - 1.2 * Math.abs(u - 0.3)) + Math.max(0, 3 * u - 2.4))];
  for (let x = 0; x < Wd; x++) for (let y = 0; y < H; y++) { const u = Math.max(0, Math.min(1, (cols[x]![y]! - top + 80) / 80)), [r, g, b] = ramp(u), o = 4 * (y * Wd + x); rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255; }
  const q = song.cues, attacks = [q.slam, q.grip, q.release, q.lands, q.button.at];
  for (let c = 0; c < q.length; c++) {
    const x = Math.round((c / q.length) * Wd), col: [number, number, number] = attacks.includes(c) ? [255, 40, 40] : c % 4 === 0 ? [235, 235, 235] : [90, 90, 90];
    for (let y = 0; y < (c % 4 === 0 || attacks.includes(c) ? H : 12); y++) { const o = 4 * (y * Wd + x); rgba[o] = col[0]; rgba[o + 1] = col[1]; rgba[o + 2] = col[2]; }
  }
  writeWebp(`${dir}/spectrogram.webp`, { width: Wd, height: H, rgba });
  say(`wrote ${dir}/spectrogram.webp (log frequency 30 Hz to 16 kHz, bottom to top; white lines bars, red the slam, grip, release, landing and button)`);
}
await Bun.write(`${dir}/check.txt`, out.join("\n") + "\n");
