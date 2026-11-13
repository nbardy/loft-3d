// The frames that prove a built artefact draws as its scene does (docs/gpu_native.md phase 2): per scene, a view, three
// frames drawn in order on one load (t = 1.0; t = 2.5; t = 2.5 with one host value changed), and the SHA-256 (first 16
// hex digits) of each frame's RGBA as the phase-1 host drew it at commit 7c9f841, before the artefact became files.
// Data only: imported by tools/files_frames.ts, whose import closure must stay clear of the compiler.

export type Case = { readonly time: number; readonly inputs?: Readonly<Record<string, number>>; readonly params?: Readonly<Record<string, number>> };
export type Proof = { readonly path: string; readonly view: string; readonly cases: readonly Case[]; readonly phase1: readonly string[] };

export const SIZE = { width: 640, height: 400 } as const;

/** The third frame changes an input where one shows at t = 2.5; reefback's and the two time-only scenes change a param. */
export const PROOFS: Readonly<Record<string, Proof>> = {
  maelstrom_wyrm: { path: "examples/bosses/maelstrom_wyrm.ts", view: "game", cases: [{ time: 1 }, { time: 2.5 }, { time: 2.5, inputs: { "lash.at": 1.0 } }], phase1: ["4478814b656f19eb", "46cf805bac90df09", "0d9580a727ade8d3"] },
  reefback_titan: { path: "examples/bosses/reefback_titan.ts", view: "game", cases: [{ time: 1 }, { time: 2.5 }, { time: 2.5, params: { "woodblock.outline": 0.12 } }], phase1: ["297a45fe8a61b2e4", "c9c10e6082fde0c5", "f883159e54f89408"] },
  thundermaw: { path: "examples/bosses/thundermaw.ts", view: "game", cases: [{ time: 1 }, { time: 2.5 }, { time: 2.5, inputs: { phase: 2 } }], phase1: ["a060017d0018418d", "fcf4e8bbdc5bca62", "5e31491373fb75e1"] },
  tithe_fleet: { path: "examples/bosses/tithe_fleet.ts", view: "game", cases: [{ time: 1 }, { time: 2.5 }, { time: 2.5, inputs: { "broadside_starboard.flashSeconds": 100 } }], phase1: ["b5b0d7af5de25c0d", "23be203abc3fbdd5", "4b3bdcd1e419adc4"] },
  wreckers_lamp: { path: "examples/bosses/wreckers_lamp.ts", view: "game", cases: [{ time: 1 }, { time: 2.5 }, { time: 2.5, params: { "woodblock.outline": 0.12 } }], phase1: ["db427fb0fa3bd452", "3b8dd3974a35b851", "1c019cd9dbfa1e08"] },
  grab: { path: "examples/grab.ts", view: "three", cases: [{ time: 1 }, { time: 2.5 }, { time: 2.5, params: { "toon.outline": 0.12 } }], phase1: ["3f1415950f80fb65", "2c8fc7ec720e7e64", "2dc8e8fcafdec800"] },
};
