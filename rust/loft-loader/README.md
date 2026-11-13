# loft-loader

Loads a Loft artefact folder (`docs/artefact_format.md`, format version 1) onto a `wgpu` 30 device and draws its
frames. It is an executor of the manifest: it creates the objects the manifest lists, in order, and per frame runs the
recipe (frame writes, the pose compute pass, the level-of-detail bounds read and plan, the render passes). It knows
nothing about scenes. `loft-view` is a small headless binary on top of it, for pictures and timing.

```
cargo build --release                      # in rust/loft-loader; output in rust/loft-loader/target (git-ignored)
target/release/loft-view <dir> --view game --time 1.0 --size 1280x800 --out f.png
target/release/loft-view <dir> --view game --frames 60          # CPU and GPU time per frame
target/release/loft-view <dir> --view game --pose-time          # pose stages alone, as tools/pose_time.ts
```

## The surface

```rust
let artefact = loft_loader::read_dir(dir)?;                 // reads and refuses (format, version, cpu tables, blob sizes)
let mut loft = Loft::load(&device, &queue, artefact)?;      // on the caller's device; every pipeline compiled here
loft.set_camera(loft.camera("game")?);                      // or a Camera of the game's own
loft.set_time(seconds);
loft.set_input("strike.at", &[x, z])?;                      // by name; unknown names and wrong lengths are errors
loft.set_param("woodblock.outline", 0.12)?;
let stats = loft.encode_frame(&device, &queue, &mut encoder, &view, width, height, Bounds::Last)?;
queue.submit([encoder.finish()]);                            // the caller submits
```

- `Loft::load` takes a `wgpu::Device` and `Queue` it does not own, so a game shares its device. Errors are typed
  (`loft_loader::Error`) and name what they refuse: a module that fails to compile names its label, a pipeline its
  label, a view an unknown input by name.
- `encode_frame` writes the frame's buffers, submits the pose pass as its own command buffer (it must run before the
  draws; the queue orders it ahead of the caller's submit), plans, and records the render passes into the caller's
  encoder, ending in `view` (`OUTPUT_FORMAT`, `rgba8unorm`, exactly `width` x `height`). The game can record its own
  passes before or after in the same encoder.
- `Bounds::Last` never waits on the GPU: it plans with the last level-of-detail bounds read (one or two frames old).
  `Bounds::Latest` waits for this frame's (pictures, tests). `FrameStats.gpu_wait` says how long a call waited.
- Inputs, params, time, camera, `set_cell_pixels`, `set_construction` hold until set again. `set_curves` replaces
  the curve rows. `cameras()` lists the artefact's named cameras.
- Measuring hooks: `set_timestamps` (pass-boundary timestamps per frame: pose pass at 0 and 1, render pass k at `2 + 2k` and `3 + 2k`; resolve them only after the frame has completed: on Metal a resolve in the next submit read the last passes' end samples before they were written) and `encode_pose` (the pose dispatches
  into a caller's compute pass).

## What the game needs next to show a monster

The format assumes Loft owns the whole frame. Concretely, in version 1:

- **The output.** Every frame ends in an `rgba8unorm` texture that the last pass writes whole: the scene pass clears it
  (the scene's clear colour), the sky and sea cover it, and the post pass clears and rewrites it. A game drawing a
  monster into its own frame needs Loft to draw into the game's colour target without clearing it, in the game's format
  (often `bgra8unorm-srgb`; Loft's shaders write display-referred sRGB values into a unorm target, so an sRGB target
  would encode twice). Today it must render into its own texture and composite it, with no transparency to composite
  by: the alpha written is not coverage.
- **The depth.** Loft's depth (`depth32float`, 4x) is its own; near and far are fixed by the camera at distance / 100
  and distance x 100 (`docs/artefact_format.md`). A monster that should be hidden behind the game's geometry, or hide
  it, needs a shared depth convention: Loft draws with the game's depth attachment (same sample count, format and
  projection), which means the frame uniform must take the game's matrices rather than a Loft `Camera`.
- **The camera.** `set_camera` takes Loft's camera model (eye, target, fovY or ortho height). The game's camera is a
  view and a projection matrix. The frame write should accept matrices (and near, which the level-of-detail plan uses).
- **The scene's surroundings.** A boss artefact contains its sea, sky and post pass. A game with its own sea needs the
  artefact without them: a build option (`loft build --subject-only`) or draws tagged by layer so the loader can skip
  them, and the post pass then applied to the game's frame or dropped.
- **Many monsters.** Each `Loft` owns its buffers and passes; ten monsters are ten frames of passes. Sharing passes
  needs the manifest split into a "draws" part the game schedules into its own passes.

## Proposed format changes (from writing this loader)

See `docs/gpu_native.md`, "Rust loader", for the measurements behind these.

1. **Chunks Naga can compile, checked at build.** At c0959b4 the compiler emitted `smoothstep(0.7, 1.0, 0.0)` and
   `mix(13.4, 2.0, 0.51)` with only abstract literals inside functions. Tint folds them; Naga 30's constant evaluator
   implements neither, so 64 of 294 modules were rejected. Main's rate lifting (4b4dd17, constants folded in f32)
   removed the construct by the way: 0 of 407 modules rejected now. Nothing stops it coming back: `loft build` should
   validate every module with Naga (`naga` CLI or the crate) as well as Tint and refuse what either rejects.
2. **Which formats a file may use.** The format says strings are WebGPU IDL values but not which ones a loader must
   accept. The sea's `r8unorm` (main, no version bump) failed this loader, which had enumerated the three formats
   version-1 files then used; it now reads every core uncompressed format. The format should say "any core format
   without features" (what this loader reads) or list them, and the same for view dimensions and topologies, which the
   loader still reads as `2d` and `triangle-list` only (phase 3 widens them, with a version bump).
3. **The time input by slot.** `{ kind: "inputs", buffer, timeSlot }` instead of "an input named `time`".
4. **Bind groups made at load or per size, said.** A `sized: true` (or two lists) instead of inferring it by scanning
   entries for a texture.
5. **One kind of reference.** `plan[k].detail.bound.buffer` is a buffer name, the only reference that is not an index;
   no loader needs it (`frame.bounds.grids` carries the copies). Drop it from the file's `Detail`.
6. **A frame that does not own the frame** (above): matrices in, the caller's colour and depth attachments, no clears of
   the output, surroundings optional.
