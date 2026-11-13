// A small offline synthesiser for a looped song (docs/lineup.md, "The song"). A song is a list of events (a sound at a
// time); each sound is one variant of `Sound`, rendered by its own handler (`note`). The mixer writes every note into
// one period's buffer at its sample index modulo the period, so a tail that rings past the end lands at the top: the
// loop is closed by construction. Stateful effects (the reverb, the limiter, the loudness filter) run over the period
// tiled and keep a middle copy, so they too see the loop as endless.
//
// Nothing here knows about crabs or dances: examples/bosses/crab_song.ts composes; tools/crab_song.ts writes the WAVs.

import { writeFileSync, readFileSync } from "node:fs";

export const RATE = 48000;
const TAU = Math.PI * 2;

/** A MIDI note number (A4 = 69). */
export type Pitch = number;
export type Vowel = "ah" | "eh";
export type ChordShape = "stab" | "pad" | "wide";
/** Every sound the synthesiser makes. Durations are seconds the note is held (a tail may ring past). */
export type Sound =
  | { readonly kind: "kick" }
  | { readonly kind: "clap" }
  | { readonly kind: "hat"; readonly open: boolean }
  | { readonly kind: "clack"; readonly pitch: Pitch }
  | { readonly kind: "bubble" }
  | { readonly kind: "sea"; readonly seconds: number; readonly cutoff: readonly [number, number]; readonly level: readonly [number, number] }
  | { readonly kind: "riser"; readonly seconds: number }
  | { readonly kind: "whoosh"; readonly seconds: number }
  | { readonly kind: "impact" }
  | { readonly kind: "bass"; readonly pitch: Pitch; readonly seconds: number }
  | { readonly kind: "chord"; readonly pitches: readonly Pitch[]; readonly seconds: number; readonly shape: ChordShape }
  | { readonly kind: "koto"; readonly pitch: Pitch; readonly seconds: number }
  | { readonly kind: "voice"; readonly pitch: Pitch; readonly seconds: number; readonly vowel: Vowel }
  | { readonly kind: "fiddle"; readonly pitch: Pitch; readonly seconds: number }
  | { readonly kind: "taiko" }
  | { readonly kind: "bell"; readonly pitch: Pitch }
  | { readonly kind: "brass"; readonly pitches: readonly Pitch[]; readonly seconds: number }
  | { readonly kind: "temple"; readonly pitch: Pitch }
  | { readonly kind: "suzu" };
export type Kind = Sound["kind"];

/** A sound at `at` seconds into the loop: its peak level (dBFS before the master), its place (-1 left .. 1 right), and how much goes to the reverb (0..1). */
export type Event = { readonly at: number; readonly sound: Sound; readonly db: number; readonly pan: number; readonly send: number };

/** The role a pitched note plays, for the harmony instrument: a melody note (the pentatonic), a chord tone, the bass, or a tuned percussion hit. */
export type Role = "melody" | "chord" | "bass" | "tuned";
export type Sounding = { readonly pitch: Pitch; readonly seconds: number; readonly role: Role };

/** The pitches a sound holds and for how long; an unpitched sound (or a glide, or an inharmonic bell's partials) holds none. */
export function pitchesOf(s: Sound): readonly Sounding[] {
  switch (s.kind) {
    case "kick": case "clap": case "hat": case "bubble": case "sea": case "riser": case "whoosh": case "impact": case "taiko": case "suzu": return [];
    case "clack": return [{ pitch: s.pitch, seconds: 0.03, role: "tuned" }];
    case "bass": return [{ pitch: s.pitch, seconds: s.seconds, role: "bass" }];
    case "chord": return s.pitches.map((p) => ({ pitch: p, seconds: s.seconds, role: "chord" }));
    case "brass": return s.pitches.map((p) => ({ pitch: p, seconds: s.seconds, role: "chord" }));
    case "koto": case "voice": case "fiddle": return [{ pitch: s.pitch, seconds: s.seconds, role: "melody" }];
    case "bell": return [{ pitch: s.pitch, seconds: 0.15, role: "melody" }];
    case "temple": return [{ pitch: s.pitch, seconds: 1, role: "chord" }];
  }
}

/** Which bus a sound is mixed on: the drums, the bus the kick ducks (bass and pad), or the rest. */
type Bus = "drums" | "ducked" | "music";
function busOf(s: Sound): Bus {
  switch (s.kind) {
    case "kick": case "clap": case "hat": case "impact": case "taiko": return "drums";
    case "bass": return "ducked";
    case "chord": return s.shape === "pad" ? "ducked" : "music";
    case "clack": case "bubble": case "sea": case "riser": case "whoosh": case "koto": case "voice": case "fiddle": case "bell": case "brass": case "temple": case "suzu": return "music";
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// building blocks

export const hz = (p: Pitch): number => 440 * 2 ** ((p - 69) / 12);
export const dbToGain = (db: number): number => 10 ** (db / 20);
const cents = (c: number): number => 2 ** (c / 1200);

/** A seeded generator (mulberry32): the same event makes the same noise in the mix and in any stem. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const white = (r: () => number) => () => 2 * r() - 1;

/** A band-limited saw (PolyBLEP). */
function saw(phase0 = 0) {
  let p = phase0;
  return (dt: number): number => {
    p += dt;
    if (p >= 1) p -= 1;
    let v = 2 * p - 1;
    if (p < dt) { const x = p / dt; v -= x + x - x * x - 1; } else if (p > 1 - dt) { const x = (p - 1) / dt; v -= x * x + x + x + 1; }
    return v;
  };
}

/** A state-variable filter (the trapezoidal form): low, band (unit peak) and high outputs; cutoff may move every sample. */
class Svf {
  private a = 0; private b = 0;
  run(x: number, fc: number, q: number): { lp: number; bp: number; hp: number } {
    const g = Math.tan((Math.PI * Math.min(fc, 0.45 * RATE)) / RATE), k = 1 / q;
    const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    const v3 = x - this.b, v1 = a1 * this.a + a2 * v3, v2 = this.b + a2 * this.a + a3 * v3;
    this.a = 2 * v1 - this.a; this.b = 2 * v2 - this.b;
    return { lp: v2, bp: k * v1, hp: x - k * v1 - v2 };
  }
}

const len = (s: number) => Math.max(1, Math.round(s * RATE));
/** A note: left and right (the same array when mono). */
type Note = { readonly l: Float32Array; readonly r: Float32Array };
const mono = (n: number, f: (i: number, t: number) => number): Note => {
  const l = new Float32Array(n);
  for (let i = 0; i < n; i++) l[i] = f(i, i / RATE);
  return { l, r: l };
};
const stereo = (n: number, f: (ch: 0 | 1) => (i: number, t: number) => number): Note => {
  const l = new Float32Array(n), r = new Float32Array(n), fl = f(0), fr = f(1);
  for (let i = 0; i < n; i++) { l[i] = fl(i, i / RATE); r[i] = fr(i, i / RATE); }
  return { l, r };
};
/** Attack-release gate: 0 before, ramps up over `a` s, held to `hold` s, ramps down over `rel` s. */
const gate = (t: number, a: number, hold: number, rel: number): number => (t < a ? t / a : t < hold ? 1 : t < hold + rel ? 1 - (t - hold) / rel : 0);

// ---------------------------------------------------------------------------------------------------------------------
// one handler per sound

/** Render one sound, seeded by `seed` (its sample index). Peak-normalised: the event's `db` sets its level. */
export function note(s: Sound, seed: number): Note {
  const r = rng(seed ^ hashKind(s.kind)), noise = white(r);
  switch (s.kind) {
    case "kick": return kick(noise);
    case "clap": {
      const nl = white(rng(seed * 7 + 1)), nr = white(rng(seed * 7 + 2));
      return stereo(len(0.5), (ch) => {
        const f = new Svf(), src = ch === 0 ? nl : nr;
        return (_, t) => {
          let env = 0;
          for (let b = 0; b < 3; b++) if (t >= b * 0.009) env = Math.max(env, Math.exp(-(t - b * 0.009) / 0.006));
          if (t >= 0.018) env = Math.max(env, 0.6 * Math.exp(-(t - 0.018) / 0.12));
          return f.run(src(), 1400, 0.7).bp * env;
        };
      });
    }
    case "hat": {
      const tau = s.open ? 0.22 : 0.035, a = new Svf(), b = new Svf();
      return mono(len(tau * 6), (_, t) => b.run(a.run(noise(), 7000, 0.7).hp, 7000, 0.7).hp * Math.exp(-t / tau));
    }
    case "clack": {
      const f = hz(s.pitch);
      return mono(len(0.15), (_, t) => Math.sin(TAU * f * t) * Math.exp(-t / 0.025) + 0.5 * Math.sin(TAU * 2.76 * f * t) * Math.exp(-t / 0.012) + (t < 0.0015 ? 0.6 * noise() * (1 - t / 0.0015) : 0));
    }
    case "bubble": {
      let ph = 0;
      return mono(len(0.15), (_, t) => { ph += (TAU * 500 * 3 ** (t / 0.05)) / RATE; return Math.sin(ph) * Math.min(1, t / 0.002) * Math.exp(-t / 0.04); });
    }
    case "sea": {
      const f = new Svf(), T = s.seconds, [c0, c1] = s.cutoff, [d0, d1] = s.level;
      return mono(len(T), (_, t) => {
        const u = t / T, fade = Math.min(1, t / 0.3, (T - t) / 0.3);
        return f.run(noise(), c0 * (c1 / c0) ** u, 0.7).lp * dbToGain(d0 + (d1 - d0) * u) * (0.75 + 0.25 * Math.sin((TAU * t) / 4)) * fade;
      });
    }
    case "riser": {
      const f = new Svf(), T = s.seconds;
      return mono(len(T), (_, t) => f.run(noise(), 400 * 20 ** (t / T), 4).bp * dbToGain(-18 + 18 * (t / T)) * Math.min(1, (T - t) / 0.003));
    }
    case "whoosh": {
      const f = new Svf(), T = s.seconds;
      return mono(len(T), (_, t) => f.run(noise(), 6000 * (300 / 6000) ** (t / T), 2).bp * Math.min(1, t / 0.02) * (1 - t / T));
    }
    case "impact": {
      const k = kick(noise), f = new Svf();
      let ph = 0;
      return mono(len(3), (i, t) => {
        ph += (TAU * (32 + 38 * Math.exp(-t / 0.3))) / RATE;
        return 0.9 * Math.sin(ph) * Math.min(1, t / 0.001) * Math.exp(-t / 1.2) + 0.45 * f.run(noise(), 3000, 0.7).lp * Math.exp(-t / 0.8) + 0.7 * (i < k.l.length ? k.l[i]! : 0);
      });
    }
    case "bass": {
      const f0 = hz(s.pitch), o = saw(), flt = new Svf();
      let ph = 0;
      return mono(len(s.seconds + 0.03), (_, t) => {
        ph += (TAU * f0) / RATE;
        const body = flt.run(o(f0 / RATE), 400 + 1800 * Math.exp(-t / 0.12), 1.2).lp;
        return (0.8 * Math.sin(ph) + 0.5 * body) * gate(t, 0.003, s.seconds, 0.03);
      });
    }
    case "chord": return chord(s.pitches, s.seconds, s.shape, r);
    case "koto": {
      const f0 = hz(s.pitch), H: { f: number; a: number; tau: number }[] = [];
      for (let n = 1; n <= 16 && n * f0 < 0.45 * RATE; n++) H.push({ f: n * f0 * Math.sqrt(1 + 1e-4 * n * n), a: Math.abs(Math.sin(n * Math.PI * 0.23)) / n ** 1.1, tau: 1.2 / (1 + 0.6 * (n - 1)) });
      return mono(len(2.2), (_, t) => {
        let y = t < 0.002 ? 0.3 * noise() * (1 - t / 0.002) : 0;
        for (const h of H) y += h.a * Math.sin(TAU * h.f * t) * Math.exp(-t / h.tau);
        return y * Math.min(1, t / 0.0008);
      });
    }
    case "voice": {
      const F = s.vowel === "ah" ? [[730, 9], [1090, 12], [2440, 20]] : [[530, 7], [1840, 18], [2480, 20]], G = [1, 0.6, 0.6];
      return stereo(len(s.seconds + 0.06), (ch) => {
        const o = saw(ch === 0 ? 0 : 0.37), fs = F.map(() => new Svf()), f0 = hz(s.pitch) * cents(ch === 0 ? -6 : 6);
        return (_, t) => {
          const vib = t < 0.15 ? 1 : cents(15 * Math.sin(TAU * 5.5 * (t - 0.15) + ch));
          const x = o((f0 * vib) / RATE);
          let y = 0;
          fs.forEach((f, j) => { y += G[j]! * f.run(x, F[j]![0]!, F[j]![1]!).bp; });
          return y * gate(t, 0.015, s.seconds, 0.06);
        };
      });
    }
    case "fiddle": {
      const f0 = hz(s.pitch), o = saw(), b1 = new Svf(), b2 = new Svf(), lp = new Svf();
      return mono(len(s.seconds + 0.08), (_, t) => {
        const x = o((f0 * cents(25 * Math.sin(TAU * 6 * t)) * 1) / RATE);
        return (0.6 * b1.run(x, 450, 2).bp + 0.5 * b2.run(x, 2800, 2).bp + 0.3 * lp.run(x, 5000, 0.7).lp) * gate(t, 0.04, s.seconds, 0.08);
      });
    }
    case "taiko": {
      const f = new Svf();
      let ph = 0;
      return mono(len(1.2), (_, t) => {
        ph += (TAU * (60 + 35 * Math.exp(-t / 0.08))) / RATE;
        return Math.sin(ph) * Math.min(1, t / 0.001) * Math.exp(-t / 0.5) + 0.4 * f.run(noise(), 800, 0.7).lp * Math.exp(-t / 0.06);
      });
    }
    case "bell": {
      const f0 = hz(s.pitch);
      return mono(len(2), (_, t) => Math.sin(TAU * f0 * t + (0.5 + 2 * Math.exp(-t / 0.15)) * Math.sin(TAU * 2 * f0 * t)) * Math.min(1, t / 0.001) * Math.exp(-t / 0.6));
    }
    case "brass": {
      const oscs = s.pitches.flatMap((p) => [-7, 7].map((c) => ({ o: saw(r()), dt: (hz(p) * cents(c)) / RATE }))), f = new Svf();
      return mono(len(s.seconds + 0.08), (_, t) => {
        let x = 0;
        for (const q of oscs) x += q.o(q.dt);
        const cut = t < 0.06 ? 300 + 2200 * (t / 0.06) : 1200 + 1300 * Math.exp(-(t - 0.06) / 0.15);
        return Math.tanh(2 * f.run(x / oscs.length, cut, 1.5).lp) * gate(t, 0.02, s.seconds, 0.08);
      });
    }
    case "temple": {
      const f0 = hz(s.pitch), P = [[1, 1, 2.5], [2, 0.6, 1.6], [2.76, 0.5, 1.2], [5.4, 0.25, 0.5]] as const;
      return mono(len(4), (_, t) => {
        let y = 0.5 * Math.sin(TAU * (f0 + 0.7) * t) * Math.exp(-t / 2.5);
        for (const [m, a, tau] of P) y += a * Math.sin(TAU * m * f0 * t) * Math.exp(-t / tau);
        return y * Math.min(1, t / 0.002);
      });
    }
    case "suzu": {
      const pings = Array.from({ length: 12 }, () => ({ f: 4000 + 5000 * r(), at: 0.06 * r(), a: 0.4 + 0.6 * r() }));
      return mono(len(0.6), (_, t) => {
        let y = 0;
        for (const p of pings) if (t >= p.at) y += p.a * Math.sin(TAU * p.f * (t - p.at)) * Math.exp(-(t - p.at) / 0.12);
        return y;
      });
    }
  }
}

function kick(noise: () => number): Note {
  let ph = 0;
  return mono(len(0.6), (_, t) => {
    ph += (TAU * (48 + 112 * Math.exp(-t / 0.035))) / RATE;
    const click = t < 0.004 ? 0.3 * noise() * (1 - t / 0.004) : 0;
    return Math.tanh(1.5 * (Math.sin(ph) * Math.min(1, t / 0.0005) * Math.exp(-t / 0.32) + click)) / Math.tanh(1.5);
  });
}

/** Three saws a note at -10, 0, +10 cents (left -10 and 0, right 0 and +10) through a low-pass: a stab, a pad or a wide ringing chord. */
function chord(pitches: readonly Pitch[], seconds: number, shape: ChordShape, r: () => number): Note {
  const tail = shape === "stab" ? 0.4 : shape === "pad" ? 0.3 : 2.5;
  return stereo(len(seconds + tail), (ch) => {
    const oscs = pitches.flatMap((p) => (ch === 0 ? [-10, 0] : [0, 10]).map((c) => ({ o: saw(r()), dt: (hz(p) * cents(c)) / RATE, a: c === 0 ? 0.7 : 1 }))), f = new Svf();
    return (_, t) => {
      let x = 0;
      for (const q of oscs) x += q.a * q.o(q.dt);
      x /= Math.sqrt(oscs.length);
      switch (shape) {
        case "stab": return f.run(x, 2000 + 7000 * Math.exp(-t / 0.15), 0.9).lp * Math.min(1, t / 0.002) * Math.exp(-t / 0.09);
        case "pad": return f.run(x, 900, 0.7).lp * gate(t, 0.08, seconds, 0.3);
        case "wide": return f.run(x, 1500 + 3500 * Math.exp(-t / 1.0), 0.8).lp * Math.min(1, t / 0.003) * Math.exp(-t / 1.2);
      }
    };
  });
}

function hashKind(k: string): number { let h = 2166136261; for (const c of k) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

// ---------------------------------------------------------------------------------------------------------------------
// the mixer

export type Stereo = { readonly l: Float32Array; readonly r: Float32Array };
const zeros = (n: number): Stereo => ({ l: new Float32Array(n), r: new Float32Array(n) });

/** The sample an event starts on. */
export const sampleOf = (at: number, N: number): number => ((Math.round(at * RATE) % N) + N) % N;

/** Add a note into a period's buffer from sample `start`, wrapping at the end; peak-normalised, scaled by `gain`, panned equal-power. */
function place(n: Note, into: Stereo, start: number, gain: number, pan: number, peak: number): void {
  const N = into.l.length, a = ((pan + 1) * Math.PI) / 4, gl = (gain * Math.cos(a) * Math.SQRT2) / peak, gr = (gain * Math.sin(a) * Math.SQRT2) / peak;
  for (let i = 0; i < n.l.length; i++) { const j = (start + i) % N; into.l[j]! += gl * n.l[i]!; into.r[j]! += gr * n.r[i]!; }
}
const peakOf = (n: Note): number => { let p = 1e-12; for (let i = 0; i < n.l.length; i++) p = Math.max(p, Math.abs(n.l[i]!), Math.abs(n.r[i]!)); return p; };

/** Each bus of a period's mix, and the reverb's send. */
export type Buses = Readonly<Record<Bus | "send", Stereo>>;
export function mixBuses(events: readonly Event[], period: number): Buses {
  const N = Math.round(period * RATE), out: Record<Bus | "send", Stereo> = { drums: zeros(N), ducked: zeros(N), music: zeros(N), send: zeros(N) };
  for (const e of events) {
    const s = sampleOf(e.at, N), n = note(e.sound, s), p = peakOf(n), g = dbToGain(e.db);
    place(n, out[busOf(e.sound)], s, g, e.pan, p);
    if (e.send > 0) place(n, out.send, s, g * e.send, e.pan, p);
  }
  return out;
}

/** Where a single event's sound starts in the loop: the first sample (from 10 ms before its scheduled one) at which it passes 5% of its own peak, through the mixer's own placement. Seconds after the scheduled time. */
export function onsetError(e: Event, period: number): number {
  const N = Math.round(period * RATE), s = sampleOf(e.at, N), n = note(e.sound, s), p = peakOf(n);
  const W = 480, buf = zeros(N);
  place(n, buf, s, 1, 0, p);
  for (let k = -W; k < W + n.l.length; k++) {
    const j = (((s + k) % N) + N) % N;
    if (Math.max(Math.abs(buf.l[j]!), Math.abs(buf.r[j]!)) / Math.SQRT2 >= 0.05) return k / RATE;
  }
  return NaN;
}

/** Run a stateful process over the loop seen as endless: the period tiled `copies` times, the middle copy kept. */
function periodic(x: Stereo, copies: number, f: (x: Stereo) => Stereo): Stereo {
  const N = x.l.length, t = zeros(N * copies);
  for (let c = 0; c < copies; c++) { t.l.set(x.l, c * N); t.r.set(x.r, c * N); }
  const y = f(t), m = Math.floor(copies / 2) * N;
  return { l: y.l.slice(m, m + N), r: y.r.slice(m, m + N) };
}

/** A four-line feedback delay network (Householder), damped above 5 kHz, 20 ms pre-delay; RT60 seconds. */
function reverb(x: Stereo, rt60: number): Stereo {
  const D = [1427, 1781, 1973, 2099], pre = 960, n = x.l.length, y = zeros(n);
  const lines = D.map((d) => ({ buf: new Float32Array(d), i: 0, lp: 0, g: 10 ** ((-3 * d) / (rt60 * RATE)) })), damp = Math.exp((-TAU * 5000) / RATE);
  for (let i = 0; i < n; i++) {
    const inL = i >= pre ? x.l[i - pre]! : 0, inR = i >= pre ? x.r[i - pre]! : 0;
    const outs = lines.map((L) => L.buf[L.i]!), sum = outs.reduce((a, b) => a + b, 0) * 0.5;
    y.l[i] = outs[0]! + outs[2]!; y.r[i] = outs[1]! + outs[3]!;
    lines.forEach((L, k) => {
      const fb = (outs[k]! - sum) * L.g;
      L.lp = (1 - damp) * fb + damp * L.lp;
      L.buf[L.i] = L.lp + (k % 2 === 0 ? inL : inR) * 0.5;
      L.i = (L.i + 1) % L.buf.length;
    });
  }
  return y;
}

/** The ducking gain of the sidechain: -10 dB at each kick (3 ms down), back in 0.15 s. */
function sidechain(N: number, kicks: readonly number[]): Float32Array {
  const g = new Float32Array(N).fill(1), ramp = Math.round(0.003 * RATE), back = Math.round(0.4 * RATE);
  for (const k of kicks) for (let i = -ramp; i < back; i++) {
    const j = (((k + i) % N) + N) % N, d = i < 0 ? 0.684 * (1 + i / ramp) : 0.684 * Math.exp(-i / RATE / 0.05);
    g[j] = Math.min(g[j]!, 1 - d);
  }
  return g;
}

/** A lookahead limiter (offline, so the window is centred): no sample above `ceiling`; 5 ms to come down, `release` s back. */
function limit(x: Stereo, ceiling: number, release: number): Stereo {
  const n = x.l.length, W = Math.round(0.005 * RATE), need = new Float32Array(n);
  for (let i = 0; i < n; i++) { const a = Math.max(Math.abs(x.l[i]!), Math.abs(x.r[i]!)); need[i] = a > ceiling ? ceiling / a : 1; }
  // The least need within W either side (a monotone deque), then the release, then a box of width W: every gain at a
  // peak is at most its need, because each value in the box's reach saw that peak.
  const h = new Float32Array(n), q = new Int32Array(n);
  let head = 0, tail = 0;
  for (let i = 0; i < n + W; i++) {
    if (i < n) { while (tail > head && need[q[tail - 1]!]! >= need[i]!) tail--; q[tail++] = i; }
    const c = i - W;
    if (c >= 0) { while (q[head]! < c - W) head++; h[c] = need[q[head]!]!; }
  }
  const e = Math.exp(-1 / (release * RATE));
  for (let i = 1; i < n; i++) h[i] = Math.min(h[i]!, 1 - (1 - h[i - 1]!) * e);
  const sum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) sum[i + 1] = sum[i]! + h[i]!;
  const y = zeros(n), half = W >> 1;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half), b = Math.min(n, i + half + 1), g = Math.min(h[i]! < 1 ? 1 : 1, (sum[b]! - sum[a]!) / (b - a));
    y.l[i] = x.l[i]! * g; y.r[i] = x.r[i]! * g;
  }
  return y;
}

// ---- loudness (ITU-R BS.1770-4 at 48 kHz) ----
function biquad(x: Float32Array, b: readonly number[], a: readonly number[]): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = b[0]! * x[i]! + b[1]! * x1 + b[2]! * x2 - a[1]! * y1 - a[2]! * y2; x2 = x1; x1 = x[i]!; y2 = y1; y1 = v; y[i] = v; }
  return y;
}
/** The K-weighted loop (the filters run over the loop as endless). */
export function kWeighted(x: Stereo): Stereo {
  return periodic(x, 2, (t) => {
    const k = (c: Float32Array) => biquad(biquad(c, [1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585]), [1, -2, 1], [1, -1.99004745483398, 0.99007225036621]);
    return { l: k(t.l), r: k(t.r) };
  });
}
/** Loudness (LUFS) of a 400 ms window of a K-weighted loop ending at sample `end` (wrapping). */
export function momentary(k: Stereo, end: number): number {
  const N = k.l.length, W = Math.round(0.4 * RATE);
  let s = 0;
  for (let i = end - W; i < end; i++) { const j = ((i % N) + N) % N; s += k.l[j]! ** 2 + k.r[j]! ** 2; }
  return -0.691 + 10 * Math.log10(s / W + 1e-30);
}
/** Integrated loudness of the loop (gated blocks of 400 ms every 100 ms, the loop wrapping). */
export function integrated(x: Stereo): number {
  const k = kWeighted(x), N = k.l.length, step = Math.round(0.1 * RATE);
  const blocks: number[] = [];
  for (let e = 0; e < N; e += step) blocks.push(momentary(k, e));
  const abs = blocks.filter((l) => l > -70), mean = (ls: number[]) => -0.691 + 10 * Math.log10(ls.reduce((a, l) => a + 10 ** ((l + 0.691) / 10), 0) / ls.length);
  const rel = mean(abs) - 10;
  return mean(abs.filter((l) => l > rel));
}

export type Master = { readonly mix: Stereo; readonly gainDb: number; readonly lufs: number; readonly peakDb: number };
/** The master: the ducked bus under every kick, the reverb, then gain and the limiter until the loop is `lufs` integrated. */
export function master(b: Buses, kicks: readonly number[], o: { readonly lufs: number; readonly ceilingDb: number; readonly rt60: number }): Master {
  const N = b.drums.l.length, duck = sidechain(N, kicks), wet = periodic(b.send, 2, (t) => reverb(t, o.rt60));
  const sum = zeros(N);
  for (let i = 0; i < N; i++) {
    sum.l[i] = b.drums.l[i]! + b.music.l[i]! + duck[i]! * b.ducked.l[i]! + wet.l[i]!;
    sum.r[i] = b.drums.r[i]! + b.music.r[i]! + duck[i]! * b.ducked.r[i]! + wet.r[i]!;
  }
  const ceiling = dbToGain(o.ceilingDb);
  let gainDb = o.lufs - integrated(sum), mix = sum, lufs = 0;
  for (let it = 0; it < 8; it++) {
    const g = dbToGain(gainDb), scaled = { l: sum.l.map((v) => v * g), r: sum.r.map((v) => v * g) };
    mix = periodic(scaled, 3, (t) => limit(t, ceiling, 0.08));
    lufs = integrated(mix);
    if (Math.abs(lufs - o.lufs) < 0.02) break;
    gainDb += o.lufs - lufs;
  }
  let peak = 0;
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(mix.l[i]!), Math.abs(mix.r[i]!));
  return { mix, gainDb, lufs, peakDb: 20 * Math.log10(peak) };
}

// ---- WAV (16-bit PCM, stereo) ----
export function writeWav(path: string, x: Stereo): void {
  const n = x.l.length, buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 4, 40);
  const q = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  for (let i = 0; i < n; i++) { buf.writeInt16LE(q(x.l[i]!), 44 + i * 4); buf.writeInt16LE(q(x.r[i]!), 46 + i * 4); }
  writeFileSync(path, buf);
}
/** A WAV this module wrote (16-bit stereo at RATE); anything else is refused. */
export function readWav(path: string): Stereo & { readonly raw: Int16Array } {
  const b = readFileSync(path);
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.readUInt16LE(22) !== 2 || b.readUInt32LE(24) !== RATE || b.readUInt16LE(34) !== 16) throw new Error(`${path}: not a 16-bit stereo ${RATE} Hz WAV`);
  const n = b.readUInt32LE(40) / 4, raw = new Int16Array(n * 2), l = new Float32Array(n), r = new Float32Array(n);
  for (let i = 0; i < n; i++) { raw[2 * i] = b.readInt16LE(44 + i * 4); raw[2 * i + 1] = b.readInt16LE(46 + i * 4); l[i] = raw[2 * i]! / 32767; r[i] = raw[2 * i + 1]! / 32767; }
  return { l, r, raw };
}
