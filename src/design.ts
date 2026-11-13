// Design variants (docs/variants.md). A design is one subject: a record of numbers, slots with named options, named
// variants, and a build from a resolved choice to a scene with its checks. Validity is the checks: a variant is any
// choice that builds and passes them, whatever proportions it changes.
//
// Order of a build: numbers (base, then each chosen option's, then the variant's), then the subject's `build`, which
// asks its options for what they offer the rig, builds the rig, draws each slot and assembles the scene.

import type { Check } from "./check.ts";
import { LoadError } from "./errors.ts";
import type { Drawable } from "./compile/context.ts";
import type { Sea, SeaDeform, SeaSpec } from "./geom/sea.ts";
import type { Scene } from "./scene.ts";

/** Overrides on a numbers record: any field, nested records merged, arrays and numbers replaced whole. */
export type Overrides<N> = { readonly [K in keyof N]?: N[K] extends readonly unknown[] ? N[K] : N[K] extends object ? Overrides<N[K]> : N[K] };

/** Number literals widened, so overrides of an `as const` record may take other values. */
export type Widen<T> = T extends number ? number : T extends readonly unknown[] ? { readonly [K in keyof T]: Widen<T[K]> } : T extends object ? { readonly [K in keyof T]: Widen<T[K]> } : T;

/** One option of a slot. The subject's own slot type adds what it draws; `numbers` are what it needs of the rig. */
export type Option<N> = { readonly about: string; readonly numbers?: Overrides<N> };
export type SlotTable<N> = { readonly [slot: string]: { readonly base: Option<N>; readonly [option: string]: Option<N> } };
/** An option name for every slot. */
export type Choice<T> = { readonly [S in keyof T]: keyof T[S] & string };
/** The chosen option objects, one per slot. */
export type Picked<T> = { readonly [S in keyof T]: T[S][keyof T[S]] };

export type VariantSpec<N, T> = { readonly about: string; readonly pick?: Partial<Choice<T>>; readonly numbers?: Overrides<N> };

/**
 * What every build gives: the scene and its checks. A subject with more for its game (an attack's strikes, holds and
 * ring waves, a hand-off record) says so in its own `B`, which extends this; the crab's does. Until a lantern fish
 * (examples/second/lanternfish.ts) the attack readouts were required here, and a subject with no attacks wrote three
 * empty records.
 */
export type Built = { readonly scene: Scene; readonly checks: readonly Check[] };

/** One of several subjects in a scene (src/lineup.ts): what it draws (the sea is the scene's) and its checks, and whatever more its game reads. */
export type Member = { readonly things: readonly Drawable[]; readonly checks: readonly Check[] };
/**
 * A subject built in two stages, so that several can share one sea: first what it does to the sea (its attacks' ring
 * waves) and the sea it would have alone; then, on the sea the scene made with every subject's deformations, the rest.
 */
export type Staged<M extends Member = Member> = { readonly deforms: readonly SeaDeform[]; readonly sea: SeaSpec; readonly finish: (water: Sea) => M };

/**
 * `B` is what this subject's build gives: `Built`, and whatever more its game reads (a hand-off record), kept typed
 * through `Design.build`. `H` is how a staged build is told to stand (a place, a show), and `M` what it gives.
 */
export type DesignSpec<N, T extends SlotTable<N>, B extends Built = Built, H = never, M extends Member = Member> = {
  readonly name: string;
  readonly numbers: N;
  readonly slots: T;
  /** Named variants. `base` is the option named `base` in every slot with the design's own numbers, and is implicit. */
  readonly variants: Readonly<Record<string, VariantSpec<N, T>>>;
  /** The cameras `loft variants` compares by default, in column order. */
  readonly compare: readonly string[];
  /**
   * Slots whose options change only how the subject is painted (a style's choice), never what it is: no check can tell
   * them apart, so `combinations` leaves each at its base option instead of multiplying by it. Picked like any slot
   * (`--variant islander,foam=apron`). Default none.
   */
  readonly looks?: readonly (keyof T & string)[];
  readonly build: (picked: Picked<T>, numbers: N) => B;
  /** The same subject as a member of a larger scene, in two stages. A design without it cannot be lined up. */
  readonly stage?: (picked: Picked<T>, numbers: N, how: H) => Staged<M>;
};

/** A choice as asked for: a named variant (`base` when only slots are given) and slot picks over it. */
export type VariantAsk = { readonly variant: string; readonly picks: readonly (readonly [slot: string, option: string])[] };
export const BASE_ASK: VariantAsk = { variant: "base", picks: [] };

export type Resolved<N = unknown> = {
  /** Canonical text: the variant's name, then the picks that differ from it (`stilt,face=mask`). */
  readonly label: string;
  readonly choice: Readonly<Record<string, string>>;
  readonly numbers: N;
};

export type DesignErrorKind = "syntax" | "unknown-variant" | "unknown-slot" | "unknown-option" | "unknown-number" | "conflict";
/**
 * Raised when a variant request is malformed or names a variant, slot, option or number that does not exist, two
 * options set the same number differently, or a staged build is asked of a design without one. Carries a `kind`
 * (`DesignErrorKind`) and a message that names the offender.
 */
export class DesignError extends Error {
  constructor(readonly kind: DesignErrorKind, message: string) { super(message); }
}

/** `name`, `slot=option,...` or `name,slot=option,...`. Syntax only; `Design.resolve` checks the names. */
export function parseVariantAsk(text: string): VariantAsk {
  const parts = text.split(",").map((s) => s.trim());
  if (parts.some((p) => p === "")) throw new DesignError("syntax", `variant "${text}": empty item (write name, slot=option or name,slot=option,...)`);
  const names = parts.filter((p) => !p.includes("="));
  if (names.length > 1) throw new DesignError("syntax", `variant "${text}": names two variants (${names.join(", ")}); give at most one, then slot=option picks`);
  if (names.length === 1 && parts[0] !== names[0]) throw new DesignError("syntax", `variant "${text}": the variant's name comes first`);
  const picks = parts.filter((p) => p.includes("=")).map((p): readonly [string, string] => {
    const [slot, option, more] = p.split("=");
    if (more !== undefined || slot === "" || option === "") throw new DesignError("syntax", `variant "${text}": "${p}" is not slot=option`);
    return [slot!, option!];
  });
  const slots = picks.map(([s]) => s);
  const twice = slots.find((s, i) => slots.indexOf(s) !== i);
  if (twice !== undefined) throw new DesignError("syntax", `variant "${text}": slot "${twice}" picked twice`);
  return { variant: names[0] ?? "base", picks };
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** `over` laid on `base`: records merged by key, anything else replaced. Every key must exist in `base`. */
function overlay<N>(base: N, over: unknown, where: string): N {
  if (!isRecord(over)) return over as N;
  if (!isRecord(base)) throw new DesignError("unknown-number", `${where}: sets fields on a value that has none`);
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (!(k in base)) throw new DesignError("unknown-number", `${where}: no number "${k}" (there are: ${Object.keys(base).join(", ")})`);
    out[k] = overlay(base[k], v, `${where}.${k}`);
  }
  return out as N;
}

/** Leaf paths a set of overrides touches, with their values (for conflicts between options). */
function leaves(over: unknown, path: string, out: Map<string, unknown>): void {
  if (!isRecord(over)) { out.set(path, over); return; }
  for (const [k, v] of Object.entries(over)) leaves(v, path === "" ? k : `${path}.${k}`, out);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * One subject with named slots of options and named variants, built into a scene and its checks. `design(spec)` makes
 * one; `resolve` turns a variant request into a choice and numbers, and `build` turns that into the scene. Every
 * variant is resolved when the design is made, so a bad name fails there, not when drawn.
 */
export class Design<N, T extends SlotTable<N>, B extends Built = Built, H = never, M extends Member = Member> {
  readonly kind = "design";
  private readonly built = new Map<string, B>();
  constructor(readonly spec: DesignSpec<N, T, B, H, M>) {
    if ("base" in spec.variants) throw new DesignError("conflict", `design "${spec.name}": "base" is implicit (every slot's base option); do not declare it`);
    // Every named variant must resolve (its slots, options and numbers exist) when the design is made, not when drawn.
    for (const name of Object.keys(spec.variants)) this.resolve({ variant: name, picks: [] });
  }

  get name(): string { return this.spec.name; }
  get slots(): readonly string[] { return Object.keys(this.spec.slots); }
  options(slot: string): readonly string[] { return Object.keys(this.slotOf(slot)); }
  /** Every named variant, `base` first. */
  get variants(): readonly string[] { return ["base", ...Object.keys(this.spec.variants)]; }
  about(variant: string): string { return variant === "base" ? "every slot's base option" : this.variantOf(variant).about; }

  private slotOf(slot: string): T[keyof T] {
    const s = this.spec.slots[slot];
    if (s === undefined) throw new DesignError("unknown-slot", `design "${this.name}" has no slot "${slot}" (slots: ${this.slots.join(", ")})`);
    return s as T[keyof T];
  }
  private variantOf(name: string): VariantSpec<N, T> {
    const v = this.spec.variants[name];
    if (v === undefined) throw new DesignError("unknown-variant", `design "${this.name}" has no variant "${name}" (variants: ${this.variants.join(", ")})`);
    return v;
  }
  private optionOf(slot: string, option: string): Option<N> {
    const o = this.slotOf(slot)[option];
    if (o === undefined) throw new DesignError("unknown-option", `slot "${slot}" of design "${this.name}" has no option "${option}" (options: ${this.options(slot).join(", ")})`);
    return o;
  }

  /**
   * A choice made concrete: an option for every slot, and the numbers (base, then the options', then the variant's,
   * then `also`: what a scene that stages this subject changes of it, its seconds on a beat).
   */
  resolve(ask: VariantAsk, also: Overrides<N> = {} as Overrides<N>): Resolved<N> {
    const v: VariantSpec<N, T> = ask.variant === "base" ? { about: "" } : this.variantOf(ask.variant);
    const choice: Record<string, string> = Object.fromEntries(this.slots.map((s) => [s, "base"]));
    for (const [slot, option] of Object.entries(v.pick ?? {})) { this.optionOf(slot, option as string); choice[slot] = option as string; }
    const named = { ...choice };
    for (const [slot, option] of ask.picks) { this.optionOf(slot, option); choice[slot] = option; }

    // Options may not disagree on a number; the variant's own numbers then win over every option's.
    const setBy = new Map<string, { readonly by: string; readonly value: unknown }>();
    let numbers = this.spec.numbers;
    for (const slot of this.slots) {
      const o = this.optionOf(slot, choice[slot]!), by = `${slot}=${choice[slot]}`;
      const touched = new Map<string, unknown>();
      leaves(o.numbers ?? {}, "", touched);
      for (const [path, value] of touched) {
        const prior = setBy.get(path);
        if (prior !== undefined && !same(prior.value, value)) throw new DesignError("conflict", `${prior.by} sets ${path} to ${JSON.stringify(prior.value)} and ${by} sets it to ${JSON.stringify(value)}; a variant's numbers may settle it`);
        setBy.set(path, { by, value });
      }
      numbers = overlay(numbers, o.numbers ?? {}, by);
    }
    numbers = overlay(numbers, v.numbers ?? {}, `variant ${ask.variant}`);
    numbers = overlay(numbers, also, "the staging's numbers");

    const extra = this.slots.filter((s) => choice[s] !== named[s]).map((s) => `${s}=${choice[s]}`);
    const label = ask.variant === "base" && extra.length > 0 ? extra.join(",") : [ask.variant, ...extra].join(",");
    return { label, choice, numbers };
  }

  /** The scene for a resolved choice, built once per label. */
  build(r: Resolved<N>): B {
    const hit = this.built.get(r.label);
    if (hit !== undefined) return hit;
    const picked = Object.fromEntries(this.slots.map((s) => [s, this.optionOf(s, r.choice[s]!)])) as Picked<T>;
    const b = this.spec.build(picked, r.numbers);
    this.built.set(r.label, b);
    return b;
  }

  /** The first stage of the subject as a member of a larger scene (not kept: each call builds anew, in the caller's namespace). */
  stage(r: Resolved<N>, how: H): Staged<M> {
    if (this.spec.stage === undefined) throw new DesignError("conflict", `design "${this.name}" has no staged build: it cannot be one of several in a scene`);
    const picked = Object.fromEntries(this.slots.map((s) => [s, this.optionOf(s, r.choice[s]!)])) as Picked<T>;
    return this.spec.stage(picked, r.numbers, how);
  }

  /** Every combination of options, over the design's own numbers plus whatever the options ask (for checking seams); `looks` slots stay at base. */
  combinations(): VariantAsk[] {
    const looks: readonly string[] = this.spec.looks ?? [];
    return this.slots.filter((slot) => !looks.includes(slot)).reduce<VariantAsk[]>(
      (asks, slot) => asks.flatMap((a) => this.options(slot).map((o) => ({ variant: "base", picks: o === "base" ? a.picks : [...a.picks, [slot, o] as const] }))),
      [BASE_ASK],
    );
  }
}

/**
 * Makes a `Design` from a spec: the subject's `numbers`, its `slots` of options, its named `variants`, and a `build`
 * from a chosen option per slot to a scene with its checks. Use it when one subject has several variants that
 * `loft variants` compares; a single fixed scene needs only `scene`.
 */
export function design<N, T extends SlotTable<N>, B extends Built = Built, H = never, M extends Member = Member>(spec: DesignSpec<N, T, B, H, M>): Design<N, T, B, H, M> {
  return new Design(spec);
}

/** A loaded scene module, classified once: a design (its variants), or a plain scene with whatever checks it exports. */
export type AnyDesign = Design<unknown, SlotTable<unknown>>;
export type Subject =
  | { readonly kind: "design"; readonly design: AnyDesign }
  /** `checks` is what the module exports: an array, or nothing (`check` refuses that; drawing does not care). */
  | { readonly kind: "scene"; readonly scene: Scene; readonly checks: { readonly kind: "exported"; readonly list: readonly Check[] } | { readonly kind: "absent" } };

export function subjectOf(mod: Record<string, unknown>, path: string): Subject {
  if (mod.design instanceof Design) return { kind: "design", design: mod.design as AnyDesign };
  if (mod.design !== undefined) throw new Error(`${path} exports a "design" that is not a Loft design (make it with design() from src/design.ts)`);
  if (mod.default === undefined) throw new LoadError(`${path} has no default export (it must export a scene or a design). Fix: export default scene({ ... })`);
  if (mod.default instanceof Design) throw new LoadError(`${path}: the default export is a design; a design is exported by name. Fix: export const design = design({ ... }) (import design as makeDesign if the names clash)`);
  if (mod.checks !== undefined && !Array.isArray(mod.checks)) throw new Error(`${path} exports \`checks\` that is not an array`);
  return { kind: "scene", scene: mod.default as Scene, checks: mod.checks === undefined ? { kind: "absent" } : { kind: "exported", list: mod.checks as readonly Check[] } };
}
