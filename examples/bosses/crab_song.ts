// The lineup's song (docs/lineup.md, "The song"): a crab-style idol-pop instrumental composed as a function of the
// dance's score. Every cue is read from `DANCE` (its keys, canon, mirror, solos, the struck button and each key's
// `click`) and from the attacks' counts; nothing here retypes a count the score holds. Move a key and the song follows.
//
//   import { crabSong } from "./crab_song.ts";
//   const song = crabSong("main");          // from DANCE; crabSong("main", otherRoutine) scores another
//                                            // events (tools/synth.ts renders them), its chords, its cues
//
// Takes: "main", and three alternates that each change one thing: "otherHook", "halfTime" (the chorus's drums),
// "bMinor" (up a whole tone).

// The attacks' counts (slam: five claws down; grip: the claws close on the boats; release: every boat let go, the drop;
// lands: the boats come down) are the lineup's own: stated once, there.
import { ATTACK_COUNTS, DANCE, LINE } from "./crab_lineup.ts";
import { BEAT } from "./lineup_shots.ts";
import type { Key, Routine, Solo } from "../../src/spacetime/routine.ts";
import type { Event, Pitch, Sound, Vowel } from "../../tools/synth.ts";

export const TAKES = ["main", "otherHook", "halfTime", "bMinor"] as const;
export type Take = (typeof TAKES)[number];

// ---- pitch ----
const NAMES: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** A note name ("C5", "A4") as a MIDI number. */
export const n = (name: string): Pitch => {
  const m = /^([A-G])(-?\d)$/.exec(name);
  if (m === null) throw new Error(`crab song: no note "${name}"`);
  return NAMES[m[1]!]! + 12 * (Number(m[2]) + 1);
};
/** The key: A natural minor; melodies on its pentatonic. Pitch classes from the tonic. */
export const MINOR = [0, 2, 3, 5, 7, 8, 10], PENTATONIC = [0, 3, 5, 7, 10];
const TONIC = 9; // A

/** A chord: its root (for the bass) and a close voicing for the stabs and pad. */
type Chord = { readonly name: string; readonly root: Pitch; readonly voicing: readonly Pitch[] };
const ch = (name: string, root: string, voicing: string): Chord => ({ name, root: n(root), voicing: voicing.split(" ").map(n) });
const Am = ch("Am", "A1", "A3 C4 E4 A4"), F = ch("F", "F1", "F3 A3 C4 F4"), C = ch("C", "C2", "C4 E4 G4 C5"), G = ch("G", "G1", "G3 B3 D4 G4"), Dm = ch("Dm", "D2", "D4 F4 A4 D5");
const WIDE_AM = "A1 A2 E3 C4 E4 A4 C5 E5".split(" ").map(n), WIDE_G = "G2 D3 B3 D4 A4".split(" ").map(n);

// ---- the score, read once ----
type Click = Key & { readonly click?: number };
/** What the song reads of the dance. Counts throughout (0 is the loop's first downbeat). */
export type Cues = {
  readonly length: number;
  readonly crouch: number; readonly clawsUp: number; readonly slam: number;
  readonly grip: number; readonly release: number; readonly lands: number;
  /** The struck pose: its count and the count its hold ends (past the loop's end it wraps). */
  readonly button: { readonly at: number; readonly until: number };
  readonly canon: { readonly at: number; readonly members: readonly number[] };
  readonly mirror: number;
  readonly solos: readonly { readonly member: number; readonly on: readonly number[] }[];
  /** The travel back into the button's formation: when it starts. */
  readonly travelBack: number;
  readonly unison: readonly number[];
  /** Each claw snap: when (counts, canon delays included) and whose. */
  readonly clicks: readonly { readonly at: number; readonly member: number }[];
};

export function cuesOf(dance: Routine): Cues {
  const S = dance.spec, keys = S.score.filter((e): e is Key => !("solo" in e)), solos = S.score.filter((e): e is Solo => "solo" in e);
  const one = <T,>(xs: readonly T[], what: string): T => { if (xs.length !== 1) throw new Error(`crab song: the score must have one ${what}, it has ${xs.length}`); return xs[0]!; };
  const members = Array.from({ length: dance.members }, (_, m) => m);
  // The struck pose: several keys may strike it (the group's, and a member's own claw), on one count with one hold.
  const struck = keys.filter((k) => k.hit !== undefined);
  const hit = one(struck.filter((k, i) => struck.findIndex((j) => j.at === k.at && j.hit === k.hit) === i), "struck pose (keys with `hit` on one count, one hold)");
  // Who takes a key, classified once (the routine's `Who`): everyone, a canon down the line, a mirror about the centre, or the members listed.
  type Taking = { readonly kind: "all" } | { readonly kind: "mirror" } | { readonly kind: "canon"; readonly step: number } | { readonly kind: "only"; readonly members: readonly number[] };
  const takingOf = (k: Key): Taking => (k.who === undefined ? { kind: "all" } : k.who === "mirror" ? { kind: "mirror" } : "canon" in k.who ? { kind: "canon", step: k.who.canon } : { kind: "only", members: k.who.only });
  const canonKey = one(keys.filter((k) => takingOf(k).kind === "canon"), "canon key");
  const mirror = one(keys.filter((k) => k.who === "mirror"), "mirror key");
  const backGo = one(keys.filter((k) => k.go !== undefined && k.at === hit.at), "travel landing on the struck key");
  // Member m's delay under a key's `who` (the routine's rule: a canon of c counts, member m arrives m * c after the first).
  const delay = (k: Key, m: number): number => {
    const w = takingOf(k);
    switch (w.kind) {
      case "all": case "mirror": case "only": return 0;
      case "canon": return w.step >= 0 ? m * w.step : (dance.members - 1 - m) * -w.step;
    }
  };
  const takes = (k: Key, m: number): boolean => {
    const w = takingOf(k);
    switch (w.kind) {
      case "all": case "mirror": case "canon": return true;
      case "only": return w.members.includes(m);
    }
  };
  // The breaks belong to whoever has stepped out in front. A solo in a member's own manner is a `Solo` entry, but one
  // scored like any other move (the centre's) has only its step out, so the breaks are read from the travels: the run of
  // formations that each move exactly one member from where the formation before the run had everyone.
  const goes = keys.filter((k) => k.go !== undefined).sort((x, y) => x.at - y.at);
  const moved = (from: string, to: string): number[] => members.filter((m) => S.places[from]![m]!.some((v, i) => v !== S.places[to]![m]![i]));
  const first = goes.findIndex((g, i) => i > 0 && moved(goes[i - 1]!.go!, g.go!).length === 1);
  if (first < 0) throw new Error("crab song: the score has no step out (a travel that moves one member): no breaks to score");
  const base = goes[first - 1]!.go!, run = goes.slice(first).filter((g, i, all) => all.slice(0, i + 1).every((h) => moved(base, h.go!).length === 1));
  const sOn = run.map((g, i) => {
    const until = i + 1 < run.length ? run[i + 1]!.at : backGo.at - backGo.over!;
    return { member: moved(base, g.go!)[0]!, on: Array.from({ length: Math.max(1, Math.round(until - g.at)) }, (_, c) => g.at + c) };
  });
  if (solos.some((e) => !sOn.some((b) => b.member === e.solo))) throw new Error("crab song: a `solo` entry's member never steps out, so it has no break");
  const { slam, grip, release, lands } = ATTACK_COUNTS;
  // The slam's own seconds (warned four counts ahead: the crouch; three counts of wind-up: claws up).
  const crushWarn = 4, windup = 3;
  return {
    length: S.length, crouch: slam - crushWarn, clawsUp: slam - windup, slam, grip, release, lands,
    button: { at: hit.at, until: hit.at + hit.hit! },
    canon: { at: canonKey.at, members: members.map((m) => canonKey.at + delay(canonKey, m)) },
    mirror: mirror.at, solos: sOn, travelBack: backGo.at - backGo.over!,
    unison: [...new Set(keys.filter((k) => k.who === undefined).map((k) => k.at))].sort((a, b) => a - b),
    clicks: keys.flatMap((k) => { const c = (k as Click).click ?? 0; return members.filter((m) => takes(k, m)).flatMap((m) => Array.from({ length: c }, (_, i) => ({ at: k.at + delay(k, m) + 0.5 * i, member: m }))); }),
  };
}

/** Where member m stands at count c (the last formation it has arrived in), as a pan: the camera's left (+z) is the left speaker. */
function panOf(dance: Routine, m: number, c: number): number {
  const PLACES = dance.spec.places, goes = dance.spec.score.filter((e): e is Key => !("solo" in e) && e.go !== undefined).sort((a, b) => a.at - b.at);
  const last = [...goes].reverse().find((k) => k.at <= c) ?? goes[goes.length - 1]!;
  const zmax = Math.max(...Object.values(PLACES).flatMap((f) => f.map(([, z]) => Math.abs(z))));
  return -PLACES[last.go!]![m]![1] / zmax;
}

// ---- the song ----
export type Song = {
  readonly take: Take; readonly cues: Cues; readonly events: readonly Event[];
  /** The chord at each change, counts (cyclic). */
  readonly chords: readonly { readonly at: number; readonly chord: Chord }[];
  /** The key's tonic pitch class (A = 9). */
  readonly tonic: number;
  /** The sections, for the analysis: [from, to) in counts. */
  readonly sections: readonly { readonly name: string; readonly from: number; readonly to: number }[];
};

/** The song of a take, scored from a routine (the lineup's `DANCE` unless another is given). */
export function crabSong(take: Take, dance: Routine = DANCE): Song {
  if (dance.members !== LINE.length) throw new Error(`crab song: the routine has ${dance.members} members, the lineup ${LINE.length}`);
  const q = cuesOf(dance), L = q.length, shift = take === "bMinor" ? 2 : 0;
  const ev: Event[] = [];
  const t = (c: number) => (((c % L) + L) % L) * BEAT;
  const add = (c: number, sound: Sound, db: number, pan = 0, send = 0) => ev.push({ at: t(c), sound, db, pan, send });
  const range = (from: number, to: number, step: number) => { const out: number[] = []; for (let c = from; c < to - 1e-9; c += step) out.push(+c.toFixed(6)); return out; };
  const firstSolo = q.solos[0]!.on[0]!, verseFrom = Math.ceil(q.button.until - L), hookAt = q.release + 4;

  // ---- harmony (counts, cyclic) ----
  const chords = [
    { at: q.button.at, chord: Am }, { at: 4, chord: F }, { at: q.crouch, chord: G }, { at: q.slam, chord: Am },
    { at: 16, chord: Dm }, { at: 20, chord: F }, { at: q.grip, chord: G }, { at: q.release, chord: Am },
    { at: hookAt, chord: F }, { at: hookAt + 4, chord: C }, { at: hookAt + 8, chord: G }, { at: hookAt + 12, chord: Am },
    { at: q.canon.at, chord: F }, { at: q.mirror, chord: G },
    { at: firstSolo, chord: Am }, { at: q.solos[2]!.on[0]!, chord: F }, { at: q.solos[4]!.on[0]!, chord: G },
  ].sort((a, b) => a.at - b.at).map((x) => ({ at: x.at, chord: transpose(x.chord, shift) }));
  const chordAt = (c: number): Chord => { const u = ((c % L) + L) % L; return ([...chords].reverse().find((x) => x.at <= u) ?? chords[chords.length - 1]!).chord; };
  const P = (name: string) => n(name) + shift;
  const safe = (c: number): Pitch[] => {
    // The pentatonic notes no chord tone is a semitone from, A4 .. A6.
    const pcs = chordAt(c).voicing.map((p) => p % 12);
    return range(n("A4") + shift, n("A6") + shift + 1, 1).filter((p) => PENTATONIC.includes((p - TONIC - shift + 120) % 12) && pcs.every((x) => { const d = (p - x + 120) % 12; return d !== 1 && d !== 11; }));
  };

  // ---- drums ----
  const kick = (c: number, db = -6) => add(c, { kind: "kick" }, db);
  const clap = (c: number, db = -12) => add(c, { kind: "clap" }, db, 0, 0.12);
  const hat = (c: number, open: boolean, db: number) => add(c, { kind: "hat", open }, db, 0.2);
  const impact = (c: number) => add(c, { kind: "impact" }, -4);
  // verse: kick on even counts, a soft clap on odd ones, hats on the "and"
  for (const c of range(verseFrom, q.crouch, 1)) (c % 2 === 0 ? kick(c, -8) : clap(c, -18));
  for (const c of range(verseFrom, q.crouch, 1)) hat(c + 0.5, false, -24);
  // build: a kick on the crouch, claps in eighths from the claws going up, sixteenths in the last count, silence before the slam
  kick(q.crouch);
  for (const c of range(q.clawsUp, q.slam - 1, 0.5)) clap(c, -16 + 4 * ((c - q.clawsUp) / (q.slam - q.clawsUp)));
  for (const c of range(q.slam - 1, q.slam - 0.25, 0.25)) clap(c, -12);
  // the slam and its aftermath
  impact(q.slam);
  kick(q.slam + 2, -8);
  for (const c of range(q.slam + 1, 16, 0.5)) hat(c + 0.5, false, -24);
  // pre-chorus (16 to the release): four on the floor, claps tightening, sixteenth hats rising; silence in the last half count
  for (const c of range(16, q.release - 1, 1)) kick(c);
  const pre = q.release - 16;
  // claps: the backbeat for the first half, eighths for the next quarter, sixteenths for the last
  for (const c of range(16, q.release - 0.5, 0.25)) {
    const u = (c - 16) / pre, step = u < 0.5 ? 1 : u < 0.75 ? 0.5 : 0.25, k = (c - 16) / step;
    if (Number.isInteger(+k.toFixed(6)) && (step < 1 || (c - 16) % 2 === 1)) clap(c, -16 + 6 * u);
  }
  for (const c of range(16, q.release - 0.5, 0.25)) hat(c, false, -26 + 6 * ((c - 16) / pre));
  // the drop and the chorus (to the first solo): four on the floor (half time in that take), backbeat claps, sixteenth hats with an open hat on the "and"
  impact(q.release);
  for (const c of range(q.release + 1, firstSolo, 1)) {
    const b = ((c % 4) + 4) % 4;
    switch (take === "halfTime" ? "half" : "four") {
      case "four": kick(c); if (b === 1 || b === 3) clap(c); break;
      case "half": if (b === 0) kick(c); if (b === 2) clap(c, -10); break;
    }
  }
  if (take === "halfTime") for (const bar of range(q.release, firstSolo, 4)) kick(bar + 2.5, -9);
  for (const c of range(q.release + 1, firstSolo, 0.25)) {
    const f = c - Math.floor(c);
    if (take === "halfTime" && f !== 0 && f !== 0.5) continue;
    hat(c, f === 0.5, f === 0.5 ? -15 : f === 0 ? -16 : -19);
  }
  // breaks: a kick on each soloist's first accent, light hats
  for (const s of q.solos) kick(s.on[0]!);
  for (const c of range(firstSolo, q.travelBack, 0.5)) if (c % 1 !== 0) hat(c, false, -27);
  // travel back: four on the floor, a clap roll, silence in the last quarter
  for (const c of range(q.travelBack, q.button.at, 1)) kick(c);
  for (const c of range(q.travelBack, q.button.at - 0.25, 0.25)) if (c < q.travelBack + 2 ? c % 0.5 === 0 : true) clap(c, -16 + 5 * ((c - q.travelBack) / (q.button.at - q.travelBack)));
  for (const c of range(q.travelBack, q.button.at - 0.25, 0.25)) hat(c, false, -24);
  impact(q.button.at);

  // ---- the sea, risers and the boats ----
  add(verseFrom, { kind: "sea", seconds: (q.crouch - verseFrom) * BEAT, cutoff: [500, 700], level: [-30, -28] }, -28, 0, 0);
  add(q.crouch, { kind: "sea", seconds: (q.slam - q.crouch) * BEAT, cutoff: [300, 4000], level: [-24, -12] }, -18);
  add(q.slam, { kind: "sea", seconds: (16 - q.slam) * BEAT, cutoff: [2500, 500], level: [-12, -30] }, -20);
  add(q.clawsUp, { kind: "riser", seconds: (q.slam - 0.25 - q.clawsUp) * BEAT }, -18);
  add(16, { kind: "riser", seconds: (q.release - 1 - 16) * BEAT }, -16);
  add(q.release - 1, { kind: "whoosh", seconds: 0.5 * BEAT }, -16);
  add(q.travelBack, { kind: "riser", seconds: (q.button.at - 0.25 - q.travelBack) * BEAT }, -17);
  add(q.lands, { kind: "sea", seconds: 1.2, cutoff: [5000, 600], level: [0, -24] }, -14);
  for (const c of [q.lands, q.lands + 0.125, q.lands + 0.375]) add(c, { kind: "bubble" }, -20, 0.3);
  for (const c of [1.75, 5.25, 6.75, q.slam + 1.25, q.slam + 1.5, q.slam + 2.75]) add(c, { kind: "bubble" }, -22, ((c * 7) % 3) / 3 - 0.3);

  // ---- bass ----
  const bass = (c: number, p: Pitch, counts: number, db = -10) => add(c, { kind: "bass", pitch: p, seconds: counts * BEAT * 0.9 }, db);
  const pattern = (from: number, to: number, steps: readonly (readonly [number, number, number])[], db = -10) => {
    // steps: [sixteenth in the bar, sixteenths long, semitones over the root]
    for (let bar = Math.floor(from / 4) * 4; bar < to; bar += 4) for (const [s, l, iv] of steps) { const c = bar + s / 4; if (c >= from - 1e-9 && c < to - 1e-9) bass(c, chordAt(c).root + iv, l / 4, db); }
  };
  const VERSE = [[0, 2, 0], [6, 1, 12], [8, 2, 0], [11, 1, 0], [14, 2, 7]] as const;
  const EIGHTHS = Array.from({ length: 8 }, (_, i) => [2 * i, 2, 0] as const);
  const BOUNCE = Array.from({ length: 8 }, (_, i) => [2 * i, 2, i % 2 === 0 ? 0 : 12] as const);
  pattern(verseFrom, q.crouch, VERSE, -12);
  bass(q.crouch, chordAt(q.crouch).root, q.slam - 0.25 - q.crouch, -14);
  bass(q.slam, chordAt(q.slam).root, 2, -9);
  pattern(q.slam + 2, 16, VERSE, -12);
  pattern(16, q.release - 0.5, EIGHTHS, -11);
  bass(q.release, chordAt(q.release).root, 1, -9);
  pattern(q.release + 1, firstSolo, BOUNCE, -10);
  for (const s of q.solos) bass(s.on[0]!, chordAt(s.on[0]!).root, 1, -11);
  pattern(q.travelBack, q.button.at - 0.25, EIGHTHS, -11);
  bass(q.button.at, chordAt(q.button.at).root, 2.5, -9);

  // ---- chords: the pad under the song, a stab on every unison key of the chorus, wide chords on the hits ----
  for (let i = 0; i < chords.length; i++) {
    const a = chords[i]!.at, b = i + 1 < chords.length ? chords[i + 1]!.at : chords[0]!.at + L;
    if (a >= firstSolo && a < q.travelBack) continue; // the breaks keep their own colour
    if (a === q.button.at) continue; // the button rings on its own
    add(a, { kind: "chord", pitches: chords[i]!.chord.voicing, seconds: (b - a) * BEAT, shape: "pad" }, a >= q.release && a < firstSolo ? -22 : -26, 0, 0.1);
  }
  for (const c of q.unison.filter((c) => c > q.release && c < firstSolo)) add(c, { kind: "chord", pitches: chordAt(c).voicing, seconds: 0.15, shape: "stab" }, -12, 0, 0.15);
  add(q.grip, { kind: "chord", pitches: chordAt(q.grip).voicing, seconds: 0.15, shape: "stab" }, -11, 0, 0.15);
  for (const c of [q.slam, q.release]) add(c, { kind: "chord", pitches: chordAt(c).voicing.map((p) => p - 12).concat(chordAt(c).voicing), seconds: 0.5, shape: "wide" }, -10, 0, 0.25);
  add(q.mirror, { kind: "chord", pitches: WIDE_G.map((p) => p + shift), seconds: (firstSolo - q.mirror) * BEAT, shape: "wide" }, -10, 0, 0.3);
  add(q.button.at, { kind: "chord", pitches: WIDE_AM.map((p) => p + shift), seconds: (q.button.until - q.button.at) * BEAT, shape: "wide" }, -8, 0, 0.3);

  // ---- the koto: the verse's riff, the slam's falling answer, doubling the hook ----
  const koto = (c: number, name: string | Pitch, counts: number, db = -16, pan = -0.25) => add(c, { kind: "koto", pitch: typeof name === "number" ? name : P(name), seconds: counts * BEAT }, db, pan, 0.25);
  const line = (from: number, notes: readonly (readonly [number, string, number])[], f: (c: number, p: string, l: number) => void) => notes.forEach(([c, p, l]) => f(from + c, p, l));
  line(0, [[1, "E5", 0.5], [1.5, "G5", 0.5], [2, "A5", 0.75], [2.75, "G5", 0.25], [3, "E5", 0.5], [3.5, "D5", 0.5], [4, "C5", 0.5], [4.5, "D5", 0.5], [5, "A4", 1], [6, "C5", 0.5], [6.5, "D5", 0.5], [7, "G4", 1]], (c, p, l) => c >= verseFrom && koto(c, p, l));
  line(q.slam + 1, [[0, "A5", 0.5], [0.5, "G5", 0.5], [1, "E5", 0.5], [1.5, "D5", 0.5], [2, "C5", 0.5], [2.5, "A4", 0.5]], (c, p, l) => koto(c, p, l));

  // ---- the hook: the formant voice, the koto an octave up ----
  const HOOK: Readonly<Record<"main" | "other", readonly (readonly [number, string, number])[]>> = {
    main: [
      [0, "C5", 0.5], [0.5, "C5", 0.5], [1, "D5", 0.5], [1.5, "A5", 1], [2.5, "G5", 0.5], [3, "D5", 1],
      [4, "C5", 0.5], [4.5, "C5", 0.5], [5, "D5", 0.5], [5.5, "G5", 1], [6.5, "E5", 0.5], [7, "C5", 1],
      [8, "D5", 0.5], [8.5, "D5", 0.5], [9, "E5", 0.5], [9.5, "A5", 1], [10.5, "G5", 0.5], [11, "D5", 1],
      [12, "E5", 0.5], [12.5, "D5", 0.5], [13, "C5", 0.5], [13.5, "A4", 1.5],
    ],
    other: [
      [0, "A5", 0.75], [0.75, "G5", 0.25], [1, "A5", 0.5], [1.5, "C6", 0.5], [2, "A5", 1], [3, "G5", 0.5], [3.5, "D5", 0.5],
      [4, "G5", 0.75], [4.75, "E5", 0.25], [5, "G5", 0.5], [5.5, "A5", 0.5], [6, "G5", 1], [7, "E5", 0.5], [7.5, "C5", 0.5],
      [8, "A5", 0.75], [8.75, "G5", 0.25], [9, "A5", 0.5], [9.5, "D6", 0.5], [10, "A5", 1], [11, "G5", 0.5], [11.5, "D5", 0.5],
      [12, "E5", 0.75], [12.75, "D5", 0.25], [13, "C5", 0.5], [13.5, "D5", 0.5], [14, "A4", 1],
    ],
  };
  line(hookAt, HOOK[take === "otherHook" ? "other" : "main"], (c, p, l) => {
    const vowel: Vowel = l >= 1 ? "ah" : "eh";
    if (c + l > q.canon.at + 1e-9) throw new Error(`crab song: the hook runs past the canon (${c + l} > ${q.canon.at})`);
    add(c, { kind: "voice", pitch: P(p), seconds: l * BEAT * 0.95, vowel }, -12, 0, 0.2);
    koto(c, P(p) + 12, l, -19, 0.3);
  });

  // ---- the canon: one falling note per member at its own delay, from where it stands ----
  const CANON = ["A5", "G5", "D5", "C5", "A4"];
  q.canon.members.forEach((c, m) => koto(c, CANON[m % CANON.length]!, 0.5, -13, panOf(dance, m, c)));

  // ---- the claws: a clack on each scored snap and nowhere else, tuned to the member's degree ----
  const DEGREE = ["A5", "C6", "D6", "E6", "G6"];
  for (const k of q.clicks) add(k.at, { kind: "clack", pitch: P(DEGREE[k.member % DEGREE.length]!) }, -12, panOf(dance, k.member, k.at), 0.08);

  // ---- the solos: each member's signature on its own accents, from where it stands ----
  for (const s of q.solos) {
    const variant = LINE[s.member]!, pan = (c: number) => panOf(dance, s.member, c);
    switch (signatureOf(variant)) {
      case "fiddle": s.on.forEach((a, i) => { const run = safe(a).slice(0, 6), notes = i % 2 === 0 ? run.slice(0, 4) : run.slice(-4).reverse(); notes.forEach((p, j) => add(a + j / 4, { kind: "fiddle", pitch: p, seconds: BEAT / 4 }, -14, pan(a), 0.3)); }); break;
      case "taiko": s.on.forEach((a, i) => (i % 2 === 0 ? [0, 0.5] : [0, 0.25, 0.5]).forEach((d, j) => add(a + d, { kind: "taiko" }, j === 0 ? -10 : -14, pan(a), 0.15))); break;
      case "spiral": { const notes = safe(s.on[0]!).slice(0, 4 * s.on.length); s.on.forEach((a, i) => notes.slice(4 * i, 4 * i + 4).forEach((p, j) => add(a + j / 4, { kind: "bell", pitch: p }, -15, pan(a), 0.35))); break; }
      case "brass": s.on.forEach((a, i) => { const r = chordAt(a).root + 12 + (i % 2 === 0 ? 0 : 7); add(a, { kind: "brass", pitches: [r, r + 12], seconds: 0.6 * BEAT * 2 }, -14, pan(a), 0.2); }); break;
      case "shrine": add(s.on[0]!, { kind: "temple", pitch: chordAt(s.on[0]!).root + 24 }, -13, pan(s.on[0]!), 0.35); s.on.forEach((a) => add(a, { kind: "suzu" }, -16, pan(a), 0.3)); break;
    }
  }

  return {
    take, cues: q, events: ev, chords, tonic: (TONIC + shift) % 12,
    sections: [
      { name: "verse", from: verseFrom, to: q.crouch }, { name: "build", from: q.crouch, to: q.slam },
      { name: "pre-chorus", from: 16, to: q.release }, { name: "chorus", from: q.release, to: firstSolo },
      { name: "breaks", from: firstSolo, to: q.travelBack }, { name: "travel back", from: q.travelBack, to: q.button.at },
    ],
  };
}

/** Each member's signature, by its variant; a variant without one is refused. */
type Signature = "fiddle" | "taiko" | "spiral" | "brass" | "shrine";
function signatureOf(variant: string): Signature {
  switch (variant) {
    case "fiddler": return "fiddle";
    case "mask": return "taiko";
    case "islander": return "spiral";
    case "bruiser": return "brass";
    case "stilt": return "shrine";
    default: throw new Error(`crab song: no solo signature for the variant "${variant}"`);
  }
}

const transpose = (c: Chord, s: number): Chord => ({ name: c.name, root: c.root + s, voicing: c.voicing.map((p) => p + s) });
