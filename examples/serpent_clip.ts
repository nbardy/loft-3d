// A 7-second clip of the serpent in two formats, four shots (three cuts): a use of the film recipe (recipes/film.ts).
//   bun tools/film.ts examples/serpent_clip.ts out/serpent_clip all
import serpent from "./serpent.ts";
import { film, type Format, type Lens } from "./recipes/film.ts";

const side: Lens = { eye: [-0.5, 4, 28], target: [-0.5, 1.2, 0], fovY: 0.6 };
const three: Lens = { eye: [14, 8.5, 16], target: [0, 1, 0], fovY: 0.6 };
const head: Lens = { eye: [15, 3.8, 8], target: [5, 2.8, 0], fovY: 0.5 };
const above: Lens = { eye: [6, 20, 12], target: [0, 0.5, 0], fovY: 0.7 };
const low: Lens = { eye: [-16, 1.2, 9], target: [0, 1.4, 0], fovY: 0.55 };
// The square sees less across, so each camera opens up by a third.
const wider = (l: Lens): Lens => ({ ...l, fovY: l.fovY * 1.33 });
const cuts = (w: (l: Lens) => Lens): Format["cuts"] => [
  { at: 0, shot: { kind: "move", name: "along", from: w(side), to: w(three), start: 0, end: 2 } },
  { at: 2, shot: { kind: "still", name: "head", lens: w(head) } },
  { at: 3.5, shot: { kind: "move", name: "rise", from: w(three), to: w(above), start: 3.5, end: 5.5 } },
  { at: 5.5, shot: { kind: "still", name: "low", lens: w(low) } },
];

export default film({
  name: "serpent", scene: serpent, seconds: 7, tempo: { kind: "none" },
  formats: [{ name: "wide", width: 1920, height: 1080, cuts: cuts((l) => l) }, { name: "square", width: 1080, height: 1080, cuts: cuts(wider) }],
});
