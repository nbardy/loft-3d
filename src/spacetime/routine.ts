// A routine: one dance for a group, as a score of key poses on counts (docs/lineup.md, "A drilled group"). Every member
// reads the same score, so unison is a property of the data: the same key arrives at the same instant with the same ease
// and the same size for everyone, unless the key says otherwise (`who`: a canon down the line, or a mirror about the
// centre). A member's own manner enters only through its solo.
//
// Every channel (the body's lean, its level, which way it faces, where it stands, each limb's aim) is a track of key
// poses: a value that arrives on a count and is held until the next key of that channel. A track is the sum of eased
// steps from each key's value to the next, and it is cyclic: the value before the first key is the last key's, and a
// key whose move starts before the loop's start also runs at its end, so the loop closes by construction. A formation
// change is a key on the place channel; a turn, a key on the facing channel; both take whole counts (`over`) so that
// feet can step.
//
// Under everything, the groove: the knees go down on every count (`size.bounce`), except while a struck pose (`hit`)
// holds dead still.
//
// `inSync` is the instrument: from each member's own readouts (its rig, not the score) it measures, on the CPU, when each
// key arrives and how far it goes, member against member.

import type { Check, Probe } from "../check.ts";
import { add, clamp, cos, div, floor, ge, lift, lt, mul, select, sub, time, vec2, vec3, type Expr, type In } from "../expr.ts";
import { anticipated, slowInOut } from "../geom/lively.ts";

type F = Expr<"f32">;
type V2 = Expr<"vec2">;
type V3 = readonly [number, number, number];

/** Where a limb's wrist goes, from its shoulder, in the body's axes (forward, up, out from its own side), in arm spans; or back to its own rest. */
export type Aim = V3 | "rest";
/**
 * Who takes a key other than everyone together: a canon (member k arrives `canon` counts after member k - 1; below 0,
 * from the last member), a mirror (members before the centre take the sided values negated, the centre none), or only
 * the members listed (the rest keep what they have: two levels at once, a soloist's own clicks).
 */
export type Who = "mirror" | { readonly canon: number } | { readonly only: readonly number[] };
/** A key pose: what arrives on count `at`. Absent channels keep their value. */
export type Key = {
  readonly at: number;
  /** Counts it takes to arrive (default: the manner's `arrive` seconds). A travel or a turn takes at least one count, so its feet can step. */
  readonly over?: number;
  readonly who?: Who;
  /** Counts it is held dead still after it arrives: struck in a few frames (`struck`'s timing), the groove stopped. */
  readonly hit?: number;
  /** The weight's side, -1 .. 1 (+ onto the member's own right). */
  readonly lean?: number;
  /** -1 a deep crouch .. 1 a full rise. */
  readonly level?: number;
  /** Radians off the member's own heading, + toward its right. */
  readonly face?: number;
  /** A formation of `places`: walk there (sideways, stepping). */
  readonly go?: string;
  /** The aims of the larger gripping limb (`claw`) and the smaller one (`small`). */
  readonly claw?: Aim;
  readonly small?: Aim;
  /**
   * Clicks: the larger limb's fingers snap shut this many times, on `at` and then every half count. Each opens wide
   * before its count and shuts on it in two frames at 30 a second (the snap of `struck`); the last is held shut a moment
   * and let go to the limb's own. A song plays a clack on each snap, so a clack that is heard is one that is seen.
   */
  readonly click?: number;
};
/** A member's solo: its own dance (its own manner) with moves landing on these counts. */
export type Solo = { readonly solo: number; readonly on: readonly number[] };

export type RoutineSpec = {
  /** Seconds a count. */
  readonly beat: number;
  /** Counts in the loop. */
  readonly length: number;
  /**
   * What a mirror is about: a member (who takes no sided value), or the half between two (`0.5`: a duet, both
   * mirrored). The half came from two buoys (examples/second/buoys.ts): about a member, one of a pair stood still
   * through every mirror.
   */
  readonly centre: number;
  /** Each formation: every member's place (world x, z), in member order. */
  readonly places: Readonly<Record<string, readonly (readonly [number, number])[]>>;
  /** The group's manner: seconds a key takes to arrive (unless it says `over`), and how sharply (the ease's power). */
  readonly manner: { readonly arrive: number; readonly snap: number };
  /** Sizes, the same for every member: the groove's depth (units), the sway and roll of a lean of 1 (units, radians), the rise of a level of 1 (units; a crouch of -1 sinks as far). */
  readonly size: { readonly bounce: number; readonly lean: number; readonly roll: number; readonly level: number };
  readonly score: readonly (Key | Solo)[];
};

/** One member's dance: closed forms of a clock (seconds; `time` by default). */
export type Dancer = {
  /** Where it stands at the loop's start (world x, z): its place's default. */
  readonly home: readonly [number, number];
  /** Units its body rises over its rest (the groove and the level). */
  rise(t?: In<"f32">): F;
  /** The weight's side, -1 .. 1 (+ onto its own right): the body sways `size.lean` units and rolls `size.roll` radians a unit of it. */
  lean(t?: In<"f32">): F;
  /** Radians it has turned to its right from its own heading. */
  face(t?: In<"f32">): F;
  /** World (x, z) it has moved from `home`. */
  place(t?: In<"f32">): V2;
  /** How far it is in its solo (0..1): 1 from three quarters of a count before its first accent to a count after its last, eased over a quarter second at each end. Its own dance has it there; the score's limb aims give way. */
  soloing(t?: In<"f32">): F;
  /** 1 while a struck pose holds, else 0. */
  still(t?: In<"f32">): F;
  /** A limb's aim (from its shoulder, in its axes, in arm spans) and how far the limb is given to it (0 its own rest, 1 the aim). Side 1 the larger limb. */
  claw(side: 1 | -1, t?: In<"f32">): { readonly weight: F; readonly aim: Expr<"vec3"> };
  /** The larger limb's fingers by the score's clicks: how far they are the score's (0 the claw's own), and how open (0 shut .. 1 wide). */
  click(t?: In<"f32">): { readonly weight: F; readonly open: F };
  /** Its solo's accents, seconds into the loop, ascending (none if it has no solo). */
  readonly solo: readonly number[];
};

/** What the instrument reads of a member, as expressions of `time`: body lift over its ride (units), its roll (radians), its heading off its own (radians), its larger limb's wrist over its shoulder (arm spans). */
export type Readouts = {
  readonly lift: F; readonly lean: F; readonly face: F;
  /** Absent for a member with no gripping limb (examples/second/buoys.ts); then no key may score `claw` or `click`. */
  readonly claw?: F;
  /** The larger limb's fingers as drawn: 0 shut .. 1 wide open. */
  readonly click?: F;
};

/**
 * The error `routine`, `Routine.member` and `inSync` raise when a score cannot be danced as written: a key outside the
 * loop or on a formation not in `places`, a travel or turn shorter than a count, two keys on one channel whose moves
 * overlap, a click while a struck pose holds, a canon that runs past the loop's end, a channel the score sets that a
 * member's readouts lack. It carries only its message, which names the member, the score index and the seconds.
 */
export class RoutineError extends Error {}

type Channel = "lean" | "level" | "face" | "claw" | "small";
/** A key's `who`, classified once. */
type Taking = { readonly kind: "together" } | { readonly kind: "canon"; readonly by: number } | { readonly kind: "mirror" } | { readonly kind: "only"; readonly members: ReadonlySet<number> };
const takingOf = (w: Who | undefined): Taking =>
  w === undefined ? { kind: "together" } : w === "mirror" ? { kind: "mirror" } : "canon" in w ? { kind: "canon", by: w.canon } : { kind: "only", members: new Set(w.only) };
const whoName = (t: Taking): string => {
  switch (t.kind) {
    case "together": return "together";
    case "mirror": return "mirror";
    case "canon": return `canon ${t.by}`;
    case "only": return `only ${[...t.members].join(",")}`;
  }
};
/** A key as one member takes it on one channel. */
type Step = { readonly arrive: number; readonly lead: number; readonly value: number; readonly ease: Ease; readonly key: number };
type Ease = { readonly kind: "smooth"; readonly power: number } | { readonly kind: "struck" } | { readonly kind: "jump" };
/** The score, classified once. */
type Entry = { readonly kind: "key"; readonly key: Key; readonly index: number } | { readonly kind: "solo"; readonly solo: Solo };

/** Seconds a struck pose takes to arrive: four frames at 30 a second (`struck`). */
const SNAP = 0.13;
/** A click's snap shut: two frames at 30 a second. Its opening takes half of the half count before it; the last snap of a
 * run is held shut 0.4 of a half count and let go over the rest of it. */
const CLICK_SNAP = 2 / 30, CLICK_HOLD = 0.4;
const TAU = Math.PI * 2;

/**
 * A group dance as `routine` builds it: `member(m)` is member m's dance as closed forms of a clock (a `Dancer`),
 * `inSync(readouts, limits)` the check that measures the members as drawn against each other, `period` the loop's
 * seconds and `members` how many dance.
 */
export class Routine {
  readonly period: number;
  readonly members: number;
  private readonly keys: readonly { readonly key: Key; readonly index: number; readonly who: Taking }[];
  private readonly solos: readonly Solo[];

  constructor(readonly spec: RoutineSpec) {
    const { beat, length, centre, places, manner, size, score } = spec;
    if (!(beat > 0 && Number.isFinite(beat))) throw new RoutineError(`routine: beat must be a positive number of seconds, got ${beat}`);
    if (!(Number.isInteger(length) && length > 0)) throw new RoutineError(`routine: length must be a whole number of counts, got ${length}`);
    const forms = Object.values(places);
    if (forms.length === 0) throw new RoutineError("routine: no formations in `places`");
    this.members = forms[0]!.length;
    for (const [name, f] of Object.entries(places)) if (f.length !== this.members) throw new RoutineError(`routine: formation "${name}" places ${f.length} members, "${Object.keys(places)[0]}" ${this.members}`);
    if (!(Number.isInteger(centre * 2) && centre >= 0 && centre <= this.members - 1)) throw new RoutineError(`routine: centre must be a member or halfway between two (0, 0.5 .. ${this.members - 1}), got ${centre}`);
    if (!(manner.arrive > 0 && manner.snap >= 1)) throw new RoutineError(`routine: manner needs arrive > 0 s and snap >= 1, got ${manner.arrive}, ${manner.snap}`);
    for (const [k, v] of Object.entries(size)) if (!(v >= 0 && Number.isFinite(v))) throw new RoutineError(`routine: size.${k} must be a finite number, at least 0; got ${v}`);
    this.period = length * beat;
    const entries: Entry[] = score.map((e, index) => ("solo" in e ? { kind: "solo", solo: e } : { kind: "key", key: e, index }));
    this.keys = entries.flatMap((e) => (e.kind === "key" ? [{ key: e.key, index: e.index, who: takingOf(e.key.who) }] : []));
    this.solos = entries.flatMap((e) => (e.kind === "solo" ? [e.solo] : []));
    for (const { key: k, index } of this.keys) {
      const where = `routine: score[${index}] (count ${k.at})`;
      if (!(k.at >= 0 && k.at < length)) throw new RoutineError(`${where}: a key lands inside the loop, 0 <= at < ${length}`);
      if (k.go !== undefined && places[k.go] === undefined) throw new RoutineError(`${where}: no formation "${k.go}" (${Object.keys(places).join(", ")})`);
      if ((k.go !== undefined || k.face !== undefined) && !(k.over !== undefined && k.over >= 1)) throw new RoutineError(`${where}: a travel or a turn takes at least one count (\`over\`), so its feet can step`);
      if (k.hit !== undefined && !(k.hit > 0)) throw new RoutineError(`${where}: hit is the counts a struck pose is held, more than 0`);
      if (k.over !== undefined && !(k.over > 0)) throw new RoutineError(`${where}: over must be more than 0 counts`);
      if (k.click !== undefined && !(Number.isInteger(k.click) && k.click >= 1)) throw new RoutineError(`${where}: click is how many snaps, a whole number, at least 1; got ${k.click}`);
      if (k.click !== undefined && !(beat / 4 >= CLICK_SNAP)) throw new RoutineError(`${where}: a click opens over a quarter count and snaps in ${CLICK_SNAP.toFixed(3)} s; a count of ${beat} s is too quick`);
      const w = takingOf(k.who);
      if (w.kind === "only" && (w.members.size === 0 || [...w.members].some((m) => !(Number.isInteger(m) && m >= 0 && m < this.members)))) throw new RoutineError(`${where}: who.only lists members 0 .. ${this.members - 1}, at least one; got [${[...w.members].join(", ")}]`);
    }
    for (const s of this.solos) {
      if (!(Number.isInteger(s.solo) && s.solo >= 0 && s.solo < this.members)) throw new RoutineError(`routine: a solo by member ${s.solo}, of ${this.members}`);
      s.on.forEach((c, i) => { if (!(c >= 0 && c < length) || (i > 0 && !(c > s.on[i - 1]!))) throw new RoutineError(`routine: member ${s.solo}'s solo lands on counts inside the loop, ascending; got [${s.on.join(", ")}]`); });
    }
    if (!this.keys.some((k) => k.key.go !== undefined)) throw new RoutineError("routine: no key says where the members stand (`go`)");
    // Each member's tracks, built once here so an overlap is refused before anything is drawn.
    for (let m = 0; m < this.members; m++) {
      for (const c of ["lean", "level", "face", "claw", "small"] as const) this.steps(m, c);
      this.clickSteps(m, "weight");
      // A struck pose is dead still: no click may move the fingers while one holds.
      for (const c of this.clicksOf(m)) for (const h of this.holdsOf(m)) {
        const P = this.period, a = c.from, b = c.to;
        for (const shift of [-P, 0, P]) if (a < h.to + shift && b > h.from + shift) throw new RoutineError(`routine: member ${m}'s click score[${c.key}] moves its fingers (${a.toFixed(3)} .. ${b.toFixed(3)} s) while the struck pose of score[${h.key}] holds (${h.from.toFixed(3)} .. ${h.to.toFixed(3)} s)`);
      }
    }
  }

  /** Whether member m takes a key at all (`who.only` leaves the others out). */
  private takes(m: number, w: Taking): boolean {
    return w.kind !== "only" || w.members.has(m);
  }
  /** Member m's struck holds, seconds into the loop. */
  private holdsOf(m: number): { readonly from: number; readonly to: number; readonly key: number }[] {
    return this.keys.filter((k) => k.key.hit !== undefined && this.takes(m, k.who)).map((k) => ({ from: k.key.at * this.spec.beat + this.delay(m, k.who), to: (k.key.at + k.key.hit!) * this.spec.beat + this.delay(m, k.who), key: k.index }));
  }
  /** Member m's runs of clicks: each snap's instant (seconds), and the span the fingers move over (runs that would overlap are one). */
  private clicksOf(m: number): { readonly snaps: readonly number[]; readonly from: number; readonly to: number; readonly key: number }[] {
    const half = this.spec.beat / 2;
    return this.keys.filter((k) => k.key.click !== undefined && this.takes(m, k.who)).map((k) => {
      const a = k.key.at * this.spec.beat + this.delay(m, k.who), snaps = Array.from({ length: k.key.click! }, (_, i) => a + i * half);
      return { snaps, from: a - CLICK_SNAP - half / 2, to: snaps[snaps.length - 1]! + half, key: k.index };
    }).sort((x, y) => x.from - y.from).reduce<{ snaps: readonly number[]; from: number; to: number; key: number }[]>((runs, r) => {
      // A run that starts opening before the last one has let go continues it: its fingers stay the score's.
      const last = runs[runs.length - 1];
      if (last !== undefined && r.from < last.to) runs[runs.length - 1] = { ...last, snaps: [...last.snaps, ...r.snaps], to: r.to };
      else runs.push(r);
      return runs;
    }, []);
  }
  /**
   * Member m's clicks as two tracks: `weight` (how far the fingers are the score's, 0 their own: 1 from the first
   * opening to the last snap's let-go) and `open` (0 shut .. 1 wide: opened over a quarter count before each snap,
   * snapped shut on it).
   */
  private clickSteps(m: number, part: "weight" | "open"): Step[] {
    const half = this.spec.beat / 2, out: Step[] = [];
    for (const c of this.clicksOf(m)) {
      if (part === "weight") {
        out.push({ arrive: c.from + half / 2, lead: half / 2, value: 1, ease: { kind: "smooth", power: 2 }, key: c.key });
        out.push({ arrive: c.to, lead: half * (1 - CLICK_HOLD), value: 0, ease: { kind: "smooth", power: 2 }, key: c.key });
      } else for (const s of c.snaps) {
        out.push({ arrive: s - CLICK_SNAP, lead: half / 2, value: 1, ease: { kind: "smooth", power: 2 }, key: c.key });
        out.push({ arrive: s, lead: CLICK_SNAP, value: 0, ease: { kind: "struck" }, key: c.key });
      }
    }
    return this.inOrder(out.map((s) => ({ ...s, arrive: wrap(s.arrive, this.period) })).sort((a, b) => a.arrive - b.arrive), m, `click ${part}`);
  }

  /** Seconds after the score's count at which member m takes a key (its canon delay). */
  private delay(m: number, who: Taking): number {
    switch (who.kind) {
      case "together": case "mirror": case "only": return 0;
      case "canon": return (who.by >= 0 ? m * who.by : (this.members - 1 - m) * -who.by) * this.spec.beat;
    }
  }
  /** The sign member m gives a sided value (lean, face) of a key. */
  private side(m: number, who: Taking): number {
    switch (who.kind) {
      case "together": case "canon": case "only": return 1;
      case "mirror": return m < this.spec.centre ? -1 : m === this.spec.centre ? 0 : 1;
    }
  }
  private leadOf(k: Key): { readonly lead: number; readonly ease: Ease } {
    if (k.hit !== undefined) return { lead: SNAP, ease: { kind: "struck" } };
    if (k.over !== undefined) return { lead: k.over * this.spec.beat, ease: { kind: "smooth", power: 2 } };
    return { lead: this.spec.manner.arrive, ease: { kind: "smooth", power: this.spec.manner.snap } };
  }

  /** Member m's keys on a scalar channel, in the order it takes them; an aim's three parts are channels "claw.0" .. "claw.2". */
  private steps(m: number, c: Channel, part?: 0 | 1 | 2): Step[] {
    const out: Step[] = [];
    let aimFrom: Aim = "rest";
    const ordered = this.keys.filter((k) => this.takes(m, k.who)).sort((a, b) => a.key.at + this.delay(m, a.who) / this.spec.beat - (b.key.at + this.delay(m, b.who) / this.spec.beat));
    for (const { key: k, index, who } of ordered) {
      const v = valueOf(k, c);
      if (v === undefined) continue;
      const { lead, ease } = this.leadOf(k), arrive = k.at * this.spec.beat + this.delay(m, who);
      const value = (() => {
        switch (v.kind) {
          case "sided": return v.value * this.side(m, who);
          case "plain": return v.value;
          // A claw: its weight (part undefined), or one part of its aim. An aim given from rest jumps there at the
          // start of the move (unseen: the claw is at its own rest), so the claw rises straight to it.
          case "aim": return part === undefined ? (v.aim === "rest" ? 0 : 1) : v.aim === "rest" ? undefined : v.aim[part];
        }
      })();
      if (value === undefined) continue;
      if (!(arrive < this.period)) throw new RoutineError(`routine: member ${m} takes score[${index}] at ${arrive.toFixed(3)} s, after the loop's end (${this.period} s): a canon must finish inside the loop`);
      const jump = part !== undefined && v.kind === "aim" && aimFrom === "rest";
      if (v.kind === "aim") aimFrom = v.aim;
      out.push({ arrive, lead, value, ease: jump ? { kind: "jump" } : ease, key: index });
    }
    return this.inOrder(out, m, `${c}${part === undefined ? "" : `[${part}]`}`);
  }

  /** A track's steps, refused if one starts moving before the one before it has arrived (in a loop, the first after the last, a period earlier). */
  private inOrder(out: Step[], m: number, name: string): Step[] {
    for (let i = 0; i < out.length; i++) {
      const s = out[i]!, prev = i > 0 ? out[i - 1]! : out.length > 1 ? { ...out[out.length - 1]!, arrive: out[out.length - 1]!.arrive - this.period } : undefined;
      if (prev !== undefined && s.arrive - s.lead < prev.arrive - 1e-6) throw new RoutineError(`routine: member ${m}'s ${name} key score[${s.key}] starts moving (${(s.arrive - s.lead).toFixed(3)} s) before score[${prev.key}] has arrived (${prev.arrive.toFixed(3)} s)`);
    }
    return out;
  }

  /** A track: the last key's value, plus each key's eased step (and, for a key whose move starts before the loop does, the same step a period later). */
  private track(steps: readonly Step[], t: In<"f32">, rest = 0): F {
    if (steps.length === 0) return lift<"f32">(rest);
    const P = this.period, u = sub(t, mul(floor(div(t, P)), P));
    let x: F = lift<"f32">(steps[steps.length - 1]!.value);
    steps.forEach((s, i) => {
      const from = i > 0 ? steps[i - 1]!.value : steps[steps.length - 1]!.value, d = s.value - from;
      if (d === 0) return;
      for (const shift of s.arrive - s.lead < 0 ? [0, P] : [0]) x = add(x, mul(easeOf(s, sub(u, shift)), d));
    });
    return x;
  }

  /** The place track (world x, z): each `go` is a key on it, taken by every member with its own formation's place. */
  private placeSteps(m: number, axis: 0 | 1): Step[] {
    return this.inOrder(this.keys.filter((k) => k.key.go !== undefined && this.takes(m, k.who)).sort((a, b) => a.key.at - b.key.at).map(({ key: k, index, who }) => {
      const { lead, ease } = this.leadOf(k);
      return { arrive: k.at * this.spec.beat + this.delay(m, who), lead, value: this.spec.places[k.go!]![m]![axis], ease, key: index };
    }), m, axis === 0 ? "place x" : "place z");
  }

  /** Member m's solo, seconds into the loop: from three quarters of a count before its first accent to a count after its last. */
  private soloWindow(m: number): { readonly from: number; readonly to: number } | undefined {
    const on = this.solos.filter((s) => s.solo === m).flatMap((s) => s.on);
    if (on.length === 0) return undefined;
    return { from: (Math.min(...on) - 0.75) * this.spec.beat, to: (Math.max(...on) + 1) * this.spec.beat };
  }

  /** The groove: down on every count, a squared cosine (a narrow dip, symmetric about the count), stopped while a struck pose holds. */
  private groove(m: number, t: In<"f32">): F {
    return mul(mul(pow2(mul(add(cos(mul(div(t, this.spec.beat), TAU)), 1), 0.5)), -this.spec.size.bounce), sub(1, this.member(m).still(t)));
  }

  /** Member m's dance. */
  member(m: number): Dancer {
    if (!(Number.isInteger(m) && m >= 0 && m < this.members)) throw new RoutineError(`routine: no member ${m} (${this.members})`);
    const S = this.spec.size, beat = this.spec.beat, P = this.period;
    const lean = (t: In<"f32">) => this.track(this.steps(m, "lean"), t), level = (t: In<"f32">) => this.track(this.steps(m, "level"), t);
    const px = this.placeSteps(m, 0), pz = this.placeSteps(m, 1);
    const home = [valueAt(px, 0, P), valueAt(pz, 0, P)] as const;
    const holds = this.holdsOf(m);
    const still = (t: In<"f32">): F => {
      const u = sub(t, mul(floor(div(t, P)), P));
      // Clamped: two struck keys on one count (one for everyone, one for some) are one hold. Summed, `still` was 2 there
      // and the groove, scaled by 1 - still, ran backwards through the button (found on the render: the held frames moved).
      return clamp(holds.reduce<F>((s, h) => add(s, add(mul(select(ge(u, h.from), 1, 0), select(lt(u, h.to), 1, 0)), select(lt(u, h.to - P), 1, 0))), lift<"f32">(0)), 0, 1);
    };
    const groove = (t: In<"f32">): F => this.groove(m, t);
    const solo = this.soloWindow(m);
    const claw = (side: 1 | -1, t: In<"f32">) => {
      const c: Channel = side === 1 ? "claw" : "small";
      return { weight: this.track(this.steps(m, c), t), aim: vec3(this.track(this.steps(m, c, 0), t), this.track(this.steps(m, c, 1), t), this.track(this.steps(m, c, 2), t)) };
    };
    return {
      home,
      rise: (t = time) => add(groove(t), mul(level(t), S.level)),
      lean: (t = time) => lean(t),
      face: (t = time) => this.track(this.steps(m, "face"), t),
      place: (t = time) => vec2(sub(this.track(px, t), home[0]), sub(this.track(pz, t), home[1])),
      soloing: (t = time) => {
        if (solo === undefined) return lift<"f32">(0);
        const u = sub(lift<"f32">(t), mul(floor(div(t, P)), P));
        return mul(slowInOut(clamp(div(sub(u, solo.from), 0.25), 0, 1)), sub(1, slowInOut(clamp(div(sub(u, solo.to - 0.25), 0.25), 0, 1))));
      },
      still: (t = time) => still(t),
      claw: (side, t = time) => claw(side, t),
      click: (t = time) => ({ weight: this.track(this.clickSteps(m, "weight"), t), open: this.track(this.clickSteps(m, "open"), t) }),
      solo: this.solos.filter((s) => s.solo === m).flatMap((s) => s.on.map((c) => c * beat)).sort((a, b) => a - b),
    };
  }

  /**
   * The instrument (a check). For every key and every channel it sets that the readouts measure (level: lift, lean,
   * face, claw), each member's arrival (when its readout crosses halfway from its value before the move to its value
   * after) and the value it arrives at, sampled at `rate` a second around the key. Together and mirror: arrivals within
   * `arrival` seconds of each other, values within `size` of the channel's largest scored value of each other (a
   * mirror's sided values by magnitude, its other values within each half, its centre left out). Canon: each member's
   * arrival after the first within `arrival` of its scored delay. A member in its solo is its own manner and is not
   * measured there, nor a claw going back to its own rest (each rest is its own), nor the places (each walks its own
   * path). `who.only`: the members listed, against each other. Clicks: below.
   */
  inSync(readouts: (m: number) => Readouts, o: { readonly arrival: number; readonly size: number; readonly rate?: number }): Check & { table(probe: Probe): readonly SyncRow[] } {
    const rate = o.rate ?? 240, routine = this;
    const reads = Array.from({ length: this.members }, (_, m) => readouts(m));
    // Classified once: a channel the readouts lack is refused if the score sets it; otherwise its column is never read.
    for (const [ch, scored] of [["claw", this.keys.some((k) => k.key.claw !== undefined)], ["click", this.keys.some((k) => k.key.click !== undefined)]] as const) {
      const lacking = reads.findIndex((r) => r[ch] === undefined);
      if (scored && lacking >= 0) throw new RoutineError(`routine: the score sets \`${ch}\` but member ${lacking}'s readouts have none to measure`);
    }
    const unread = lift<"f32">(0);
    // The groove is the same closed form for every member: it is taken out of the lift so a level's arrival is not found
    // on the groove's own swing (a rig that did not apply it identically is still caught: the residue stays in the lift).
    const roots = reads.flatMap((r, m) => [sub(r.lift, this.groove(m, time)), r.lean, r.face, r.claw ?? unread, r.click ?? unread]);
    const CH = { level: 0, lean: 1, face: 2, claw: 3 } as const, N = 5, CLICK = 4;
    const scale: Record<keyof typeof CH, number> = {
      level: this.spec.size.level, lean: this.spec.size.roll,
      face: Math.max(1e-6, ...this.keys.map((k) => Math.abs(k.key.face ?? 0))), claw: Math.max(1e-6, ...this.keys.flatMap((k) => (k.key.claw === undefined || k.key.claw === "rest" ? [] : [Math.hypot(...k.key.claw)]))),
    };
    const table = (probe: Probe): SyncRow[] => {
      const at = new Map<number, number[]>();
      const sample = (t: number): number[] => { const q = Math.round(t * rate); let v = at.get(q); if (!v) { v = probe.eval(roots, q / rate) as number[]; at.set(q, v); } return v; };
      const rows: SyncRow[] = [];
      for (const { key: k, index, who: taking0 } of this.keys) for (const ch of Object.keys(CH) as (keyof typeof CH)[]) {
        const c = ch === "claw" ? k.claw : k[ch];
        if (c === undefined || c === "rest") continue;
        const { lead } = routine.leadOf(k);
        // Which members this key moves on this channel (a key that repeats a member's value moves nothing to measure).
        // A member in its solo is its own manner: not measured on a key whose move overlaps the solo.
        const moves = Array.from({ length: routine.members }, (_, m) => {
          const st = routine.steps(m, ch === "level" ? "level" : ch), i = st.findIndex((x) => x.key === index);
          if (i < 0) return false;
          const w = routine.soloWindow(m), a = st[i]!.arrive;
          if (w !== undefined && a > w.from && a - st[i]!.lead < w.to) return false;
          const prev = st[i > 0 ? i - 1 : st.length - 1]!;
          return st[i]!.value !== prev.value || (ch === "claw" && k.claw !== undefined);
        });
        if (!moves.some((x) => x)) continue;
        const per = Array.from({ length: routine.members }, (_, m) => {
          const a = k.at * routine.spec.beat + routine.delay(m, taking0), from = a - lead - 0.04, to = a + 0.03;
          const v0 = sample(from)[N * m + CH[ch]]!, v1 = sample(to)[N * m + CH[ch]]!, mid = (v0 + v1) / 2;
          let crossing = NaN;
          for (let q = Math.round(from * rate); q < Math.round(to * rate) && Number.isNaN(crossing); q++) {
            const x0 = sample(q / rate)[N * m + CH[ch]]!, x1 = sample((q + 1) / rate)[N * m + CH[ch]]!;
            if ((x0 - mid) * (x1 - mid) <= 0 && x0 !== x1) crossing = (q + (mid - x0) / (x1 - x0)) / rate;
          }
          return { arrival: crossing, value: v1, moved: Math.abs(v1 - v0) };
        });
        const who = whoName(taking0), mirror = taking0.kind === "mirror";
        const taking = per.map((p, m) => ({ ...p, m })).filter((p) => moves[p.m] && !(mirror && p.m === routine.spec.centre));
        // Arrivals: together and mirror against each other; a canon against its scored delays from the first member.
        // An arrival is when the readout crosses halfway: measured only for members whose readout moves at least 15% of
        // the channel's largest (a claw whose own rest lies near the aim has no halfway worth timing; its value still counts).
        const offs = taking.filter((p) => p.moved >= 0.15 * scale[ch]).map((p) => p.arrival - routine.delay(p.m, taking0));
        const arrival = offs.length < 2 ? 0 : Math.max(...offs) - Math.min(...offs);
        // Values: a sided channel (lean, face) under a mirror by magnitude, everyone against everyone; any other channel
        // under a mirror within each half (the halves' bodies lean opposite ways, so a claw on one side sits differently).
        const spread = (xs: readonly number[]) => (xs.length < 2 ? 0 : Math.max(...xs) - Math.min(...xs));
        const sided = ch === "lean" || ch === "face";
        const size = (mirror && !sided
          ? Math.max(spread(taking.filter((p) => p.m < routine.spec.centre).map((p) => p.value)), spread(taking.filter((p) => p.m > routine.spec.centre).map((p) => p.value)))
          : spread(taking.map((p) => (mirror ? Math.abs(p.value) : p.value)))) / scale[ch];
        rows.push({ key: index, count: k.at, channel: ch, who, arrival, size, pass: Number.isFinite(arrival) && arrival <= o.arrival && size <= o.size, arrivals: per.map((p) => p.arrival), values: per.map((p) => p.value) });
      }
      // Clicks: every snap of every member that takes it, soloists included (a clack is heard on the count whoever plays
      // it). Its arrival is when the drawn fingers cross halfway from wide open (as the snap starts) to shut, against the
      // scored instant: the snap's own ease puts that 8.5 ms before it, the same for every claw, so `arrival` here is the
      // largest distance of any member's crossing from the scored instant. Its size is how far any member's fingers are
      // from wide open as the snap starts or from shut just after it.
      for (const { key: k, index, who: w } of this.keys) {
        if (k.click === undefined) continue;
        for (let i = 0; i < k.click; i++) {
          const per = Array.from({ length: routine.members }, (_, m) => {
            if (!routine.takes(m, w)) return { arrival: NaN, value: NaN, off: NaN };
            const s = (k.at + i / 2) * routine.spec.beat + routine.delay(m, w), from = s - CLICK_SNAP, to = s + 0.03;
            const v0 = sample(from)[N * m + CLICK]!, v1 = sample(to)[N * m + CLICK]!;
            let crossing = NaN;
            for (let q = Math.floor(from * rate); q < Math.ceil(to * rate) && Number.isNaN(crossing); q++) {
              const x0 = sample(q / rate)[N * m + CLICK]!, x1 = sample((q + 1) / rate)[N * m + CLICK]!;
              if ((x0 - 0.5) * (x1 - 0.5) <= 0 && x0 !== x1) crossing = (q + (0.5 - x0) / (x1 - x0)) / rate;
            }
            return { arrival: crossing - s, value: v1, off: Math.max(Math.abs(1 - v0), Math.abs(v1)) };
          });
          const taking = per.filter((p) => !Number.isNaN(p.off));
          const arrival = Math.max(...taking.map((p) => Math.abs(p.arrival))), size = Math.max(...taking.map((p) => p.off));
          rows.push({ key: index, count: k.at + i / 2, channel: "click", who: whoName(w), arrival, size, pass: Number.isFinite(arrival) && arrival <= o.arrival && size <= o.size, arrivals: per.map((p) => p.arrival), values: per.map((p) => p.value) });
        }
      }
      return rows.sort((a, b) => a.count - b.count);
    };
    return {
      name: `the routine in sync (${this.keys.length} keys, ${this.members} members)`,
      table,
      run(probe) {
        const rows = table(probe), bad = rows.filter((r) => !r.pass);
        const worstA = rows.reduce((w, r) => (!(r.arrival <= w.arrival) ? r : w)), worstS = rows.reduce((w, r) => (r.size > w.size ? r : w));
        return {
          name: this.name, pass: bad.length === 0 && rows.length > 0, value: worstA.arrival,
          measured: `${rows.length} measured: worst arrival spread ${(1000 * worstA.arrival).toFixed(2)} ms (count ${worstA.count} ${worstA.channel}, ${worstA.who}); worst size spread ${(100 * worstS.size).toFixed(2)}% (count ${worstS.count} ${worstS.channel}, ${worstS.who})${bad.length > 0 ? `; ${bad.length} out: ${bad.slice(0, 4).map((r) => `${r.count} ${r.channel}`).join(", ")}` : ""}`,
          limit: `arrivals within ${(1000 * o.arrival).toFixed(1)} ms (a canon's of its scored delays), values within ${(100 * o.size).toFixed(0)}% of the channel's largest`,
        };
      },
    };
  }
}

/** One key on one channel, measured across members. `arrival` is the spread in seconds (a canon's: of its scored delays), `size` the spread of values as a share of the channel's largest. */
export type SyncRow = { readonly key: number; readonly count: number; readonly channel: string; readonly who: string; readonly arrival: number; readonly size: number; readonly pass: boolean; readonly arrivals: readonly number[]; readonly values: readonly number[] };

/** What a key sets on a channel: a sided value (lean, face: a mirror negates it), a plain one, or a claw's aim. */
function valueOf(k: Key, c: Channel): { readonly kind: "sided" | "plain"; readonly value: number } | { readonly kind: "aim"; readonly aim: Aim } | undefined {
  switch (c) {
    case "lean": return k.lean === undefined ? undefined : { kind: "sided", value: k.lean };
    case "face": return k.face === undefined ? undefined : { kind: "sided", value: k.face };
    case "level": return k.level === undefined ? undefined : { kind: "plain", value: k.level };
    case "claw": return k.claw === undefined ? undefined : { kind: "aim", aim: k.claw };
    case "small": return k.small === undefined ? undefined : { kind: "aim", aim: k.small };
  }
}

/** How far a step has gone at loop time u: 0 before its move starts, 1 from its arrival. */
function easeOf(s: Step, u: F): F {
  const x = clamp(div(sub(u, s.arrive - s.lead), s.lead), 0, 1);
  switch (s.ease.kind) {
    case "smooth": return slowInOut(x, s.ease.power);
    // Struck: it leaves the wrong way, arrives at speed and stops (`anticipated`, the snap of `struck`).
    case "struck": return anticipated(x);
    case "jump": return select(ge(u, s.arrive - s.lead), 1, 0);
  }
}

/** A track's value at a loop time, on the CPU (the eases are all 0 or 1 away from their moves). */
function valueAt(steps: readonly Step[], u: number, P: number): number {
  if (steps.length === 0) return 0;
  let x = steps[steps.length - 1]!.value;
  steps.forEach((s, i) => {
    const from = i > 0 ? steps[i - 1]!.value : steps[steps.length - 1]!.value;
    for (const shift of s.arrive - s.lead < 0 ? [0, P] : [0]) if (u - shift >= s.arrive) x += s.value - from;
  });
  return x;
}

const pow2 = (x: F): F => mul(x, x);
/** Seconds into the loop, 0 .. period. */
const wrap = (t: number, P: number): number => ((t % P) + P) % P;

/**
 * A routine: one dance for a group, as a score of key poses on counts that every member reads, so unison is a property
 * of the data: the same key arrives at the same instant with the same ease and size for everyone, unless the key says
 * otherwise (`who`: a canon down the line, a mirror about the centre, or only some members).
 *
 * What it assumes about the body, tried so far on a legged, two-armed body and on floating buoys: every member has the
 * same fixed channels, a lean (its weight's side, with a sway and a roll), a level (a rise or a crouch), a facing, and a
 * place on the ground (x, z); and optionally a larger and a smaller limb aimed in the body's axes (`claw`, `small`),
 * the larger with fingers that click. A member without limbs leaves those out (its readouts have no `claw`); a subject
 * with some other moving part (a bell, a jib, a tail) cannot have it scored. One set of sizes serves every member.
 *
 * The law. A loop of `length` counts of `beat` seconds. Each channel is a cyclic track: the last key's value plus, for
 * each key, an eased step from the value before it to its own, arriving on its count (plus a canon's delay) over
 * `over` counts or the manner's `arrive` seconds, eased by slowInOut (power `snap`, or 2 with `over`); a key with `hit`
 * is struck instead (`anticipated` over 0.13 s) and held dead still for `hit` counts. A step that starts before the loop
 * also runs a period later, so the loop closes by construction. A mirror negates the sided values (lean, face) of
 * members before `centre`. Under it all the groove: the level drops by bounce ((1 + cos(2 pi t / beat)) / 2)^2, lowest
 * on every count, stopped while a struck pose holds.
 *
 * Parameters: everything in the spec is a fixed number (the score is data); a member's readouts are closed forms of a
 * clock t, an expression, so a body reads them at delayed clocks too.
 *
 * What it cannot do, because of the law:
 * - score a channel it does not know: only lean, level, face, place, two limb aims and clicks.
 * - change tempo or loop length: one beat, one loop, the same for every member.
 * - pass through a pose: each key is held until the next; there are no curves through keys.
 * - overlap two keys' moves on one channel, or run a canon past the loop's end (both refused).
 * - give one member a different size of move: one size table (scale a member's readouts yourself).
 * - groove on any pattern but every count.
 *
 * Going past it: `member(m)` gives every track as a closed form of the clock, so a rig mixes them with its own motion
 * (a solo is an `emote` armed on the member's counts, faded in by `soloing`); and `inSync` measures whatever the rig
 * drew.
 * Relatives worth trying:
 * - keys over named channels the routine is given (a bell's swing, a jib's slew), with lean, level and face as a default
 *   set: the same track law over a record of channels.
 * - keys that flow: a curve through the key values (`through`) instead of eased steps, so a move passes through a pose.
 * - a swung groove: the drop on the count, a smaller one on the off-beat.
 * - a crowd: members' places from a formula of the index, and a canon whose delay grows along the line.
 */
export function routine(spec: RoutineSpec): Routine {
  return new Routine(spec);
}
