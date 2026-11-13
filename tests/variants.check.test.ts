// Every named variant of a design passes the design's checks (docs/variants.md: the checks are the contract), run the
// way an artist runs them: `loft check <design>` with no --variant. It catches an option, a named variant or a rig edit
// that leaves some variant unable to land Claw Crush inside its warning, to close the cutter on the ship and keep it
// through the throw's stroke, or to throw it clear, and a variant that no longer builds (two things with one name, an
// option asking a number the design does not have, an input given two defaults in one scene).
import { expect, test } from "bun:test";

test("every named variant of the Reefback Titan passes its checks", () => {
  const r = Bun.spawnSync(["bun", "src/cli/main.ts", "check", "examples/bosses/reefback_titan.ts"], { stdout: "pipe", stderr: "pipe" });
  const out = r.stdout.toString();
  const rows = /variant\s+checks\n([\s\S]*?)\n\n(\d+) of (\d+) variants pass/.exec(out);
  expect(rows, `no summary in:\n${out}\n${r.stderr.toString()}`).not.toBeNull();
  // Ten checks each: Claw Crush lands and is warned, the Grab is warned, grips and lets go as it says, its ship flies
  // as released, lands, keeps clear and leaves the fingers cleanly, the slam's ring waits for its front and carries the
  // second boat.
  // Every variant also asks that no leg overstretches or folds over the loop (`limbsReach`), so each count is one more.
  expect(rows![1]).toMatch(/^base\s+11\/11 pass$/m);
  // The islander's face asks three more of itself (titan/face/dandy.ts): each eye's size from the game camera, and that
  // its expressions show and differ on screen.
  expect(rows![1]).toMatch(/^islander\s+14\/14 pass$/m);
  // The fiddler's face asks four (titan/face/jitter.ts), on both fiddlers: those three, and that neither eye is behind a
  // claw from the game camera for more than half a second.
  for (const name of ["fiddler", "fiddlerBaseDisc"]) expect(rows![1]).toMatch(new RegExp(`^${name}\\s+15/15 pass$`, "m"));
  // The spider crab's asks five (titan/face/mourner.ts): those four, and the right eye's size from the `far` camera,
  // the one that holds the whole crab (the game camera cuts its shrine).
  expect(rows![1]).toMatch(/^stilt\s+16\/16 pass$/m);
  // The bruiser's face asks five (titan/face/brow.ts): each eye's size, its expressions told apart, the width of its roar,
  // and that the claws keep off the eyes and the mouth from the game camera.
  expect(rows![1]).toMatch(/^bruiser\s+16\/16 pass$/m);
  // The samurai's face asks seven (titan/face/mask.ts): each eye's size from the game camera, a brow plate's length, the
  // roar's gape, that its expressions show and differ on screen, that the claws keep off it, and that its struck poses
  // hold dead still.
  expect(rows![1]).toMatch(/^mask\s+18\/18 pass$/m);
  expect(rows![2]).toBe(rows![3]);
  expect(r.exitCode).toBe(0);
}, 600_000);
