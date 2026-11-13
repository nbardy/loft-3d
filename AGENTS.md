# Loft: agent guide

- `bun` runs everything; `pnpm` installs. Nothing is compiled ahead of time.
- Typecheck with `rtk proxy pnpm exec tsc --noEmit`. A shell hook rewrites a bare `tsc` and reports errors that are
  not there.
- `pnpm test` is the suite (`bun test --timeout 120000`: a bare `bun test` gives some GPU tests bun's 5 s limit, which
  they miss when the whole suite runs at once, although `tests/setup.ts` asks for 60 s). The old note: Under a loaded machine it can time out or fail once and pass on the next run; the intermittent shader-module
  failure was bun-webgpu freeing descriptor strings early, patched (`docs/reliable_render.md`). Exit codes: `docs/errors.md`.
- GPU time per draw: `bun src/cli/main.ts profile <scene> --view <camera>`. It also prints the pose stages (the
  per-frame tables, computed on the GPU since phase 1 of `docs/gpu_native.md`), the CPU pose time, and every table
  still filled on the CPU (`cpu`) with its reason. Pose stages alone: `bun tools/pose_time.ts [scene.ts:view ...]`. The GPU clock ticks in 0.065 ms steps; a reading below that is unresolved.
- Comparing two ways of drawing one thing in the same timing rounds: `bun tools/tracer_bench.ts`.
- Pictures and other output go under `out/`, which git ignores.
- Reference pictures (concepts, model sheets, storyboards, paint-overs of our renders) come from GPT image through the
  Codex CLI's `$imagegen` skill. It runs on the server, costs nothing extra and takes a few minutes for ten pictures:
  1. Make a scratch directory under `out/` with the brief in `brief.md` and any pictures to look at or paint over in
     `in/` as PNG (`dwebp x.webp -o in/x.png`).
  2. Run it in the background:
     `command codex exec -s workspace-write -C <dir> --skip-git-repo-check -o <dir>/final.txt "$(cat <dir>/brief.md)" < /dev/null`.
     `< /dev/null` is required or it waits on stdin forever. `command` skips the `--yolo` alias.
  3. The brief opens with: use the `$imagegen` skill in its built-in tool mode, never the CLI fallback or an API key;
     save PNGs in the current directory under exact file names; touch nothing else; stop and say so if the tool is
     unavailable. Then the character description and the style clause (both repeated in every prompt, so a set stays
     on model), then the numbered list of pictures, then what the final message should list.
     The tool takes at most five reference images per call: put no more than three or four in `in/`, and tell it to
     report a failed picture and go on, not stop (a thirteen-picture job stopped at the seventh on this).
  4. Ask for sheets a modeller can use: a turnaround (front, three-quarter, side, from above at the game camera's
     angle), an expression sheet, key poses of an action, a storyboard with single frames, close-ups of a surface, and
     paint-overs of our own renders at the same camera. Keep names, project details and anything personal out of the
     brief.
  5. Look at every picture, keep the good ones as WebP (`cwebp -q 90`) beside the brief under
     `docs/art_direction/<round>/`, and show them to the owner before anything is built from them.
  Worked briefs: `docs/art_direction/crab_round4/prompt.md` and `crab_round4/others/prompt.md`. The local Flux script
  (`tools/crab_concepts.py`) is the fallback; it is slower, rougher, and another session may be using that repo.
- Design as built: `DESIGN.md`. Research notes: `docs/`.
- A scene as files: `bun src/cli/main.ts build <scene> --out out/files/<name>`, drawn without the compiler by
  `render --artefact <dir>`. Format: `docs/artefact_format.md`. `bun tools/check_loader_closure.ts` fails if the file
  loader's imports reach the compiler; `bun tools/files_proof.ts` compares files, scene and phase-1 pixels.
