---
name: brief-a-worker
description: Hand a piece of Loft work to a parallel agent or subagent and integrate what comes back. Use when splitting work across workers, writing a brief, or merging a worker's branch.
---

# Briefing a worker on Loft

A worker knows only its brief and the repo. Point it at files; do not retype them. Spend the brief's words on what the
repo does not say: the owner's words, what is wrong today, and what done looks like.

## Which model, and how many

- Set `model` on every spawn. The orchestrating session may be on the most capable model; workers must not inherit
  it by default. Design, hard code and art that needs judging: `opus`. Rendering loops, measurement, building sheets
  and clips, merges, doc edits: `sonnet`. A worker's model cannot be changed once it is running: stop an early-stage
  one and respawn it; let a late-stage one finish.
- No more than three or four at once. Seven saturated one GPU (a render that loads in 5 s took 283 s) and spent a
  week's allowance in an evening; each used 350,000 to 960,000 tokens.
- Every brief carries the spending rules: script anything done more than twice and read its summary, not its log; `rg`
  logs, never read them whole; judge one contact sheet downscaled to about 1600 px, not many frames; do not re-read
  files; load a slow scene once and take every frame from that load; stop when the checks pass and the picture is right.

## What a brief contains

1. **The owner's words, quoted**, and what you take them to mean.
2. **Where it stands**: the command that renders today's state, and what you see wrong in it. The worker checks this
   itself.
3. **What to build**, with the library part separated from the scene part, and the acceptance stated as things that
   can be measured or seen from the `game` camera.
4. **Hard constraints**: pictures that must not change (the three `rgba` hashes), checks that must pass, files it must
   stay out of and who is working in them.
5. **The owner's rules**, by reference: theory first with predictions committed before building; be bold and say what
   is inherited; be critical of its own pictures. These are the owner's global rules (`~/AGENTS.md`), which a worker
   may not load: state them in the brief in a few lines. Name the docs to read first and the skills that apply
   (`art-direction-round`, `frame-time`, `lively-motion`).
6. **The report**: predictions against measurements, what the library gained with paths, check output, hashes, frame
   time, paths of pictures and clips, what is weak, and decisions the owner may want to reverse.

## Practicalities every brief needs

- Its own worktree: `cd ~/git/loft && git cambium add -b <branch> -name <name> -ephemeral ~/git/_wt/<name>`, then
  `pnpm install`. Commit everything it wants kept; do not push, merge or remove the worktree.
- The shell hook rejects `>` redirects (use `tee`). One scene per process. `echo ====` breaks in zsh.
- Pictures are WebP under `out/` (ignored by git); final ones are copied to `~/git/loft/out/<topic>/`.
- Do not run the whole test suite per worker. Under load it times out and the failures are noise; the integrator runs
  it once on a quiet machine.
- If it profiles, it follows `frame-time`: one state, and say when other workers were on the GPU.

## Splitting so branches merge

- Two workers must not own the same file. The crab's registry (`reefback_titan.ts`), `titan/numbers.ts` and
  `tests/variants.check.test.ts` are shared by every option: tell each worker to keep its edits there small and
  additive, and expect to merge those by hand.
- When one worker's output is another's input (the face follows `rig.shipNow`; the throw extends it), name the one
  readout both must use, so the merge needs no change on either side.
- When main moves, tell running workers what changed that touches them, and to merge main before they finish.

## Integrating

1. Look at the pictures yourself before reading the numbers.
2. Merge with `--no-ff`; typecheck (`rtk proxy pnpm exec tsc --noEmit`); `check` every variant; confirm the hashes that
   should not have changed.
3. Push as its own step, after the checks. Then `git cambium remove --safe --require-merged main --delete-branch <name>`.
   If it refuses for uncommitted changes, read the diff: if it is not plainly the worker's own scrap, keep it with
   `--salvage-ref refs/salvage/<name>-<date>` and say so. Never discard it.
4. Update the review page and open it for the owner.
