# Lighting the print: looks and recipes

The woodblock style (`src/style/woodblock.ts`) lights its bodies by a recipe (and so can any style, through `litBodies`: `toon({ light })` and `--light name` on a toon scene, `sketch`; docs/styles.md): a record of shading treatments, each on or
off with its own options. With no recipe the style is the print as it was (the rule's own two tones, split at
N.L = 0), and every picture made before recipes is unchanged. Code: `src/style/light.ts` (the treatments, the named
recipes), `src/draw/light.ts` (shadows that fall from one thing on another). Why it is built this way, what was
predicted and what came out: `docs/art_direction/DIRECTION.md`, "Lighting and shading".

## Picking one

A look is chosen by one word. In a scene:

```ts
import { LIGHT, LOOKS, light, paint, seaPalette, woodblock } from "loft";

woodblock({ light: LIGHT.threeTone })                       // a lighting recipe
woodblock(LOOKS.engraving.on({ print: myRule }))            // a whole look over the scene's own spec
woodblock({ light: light.recipe({                           // your own: every treatment not given is off
  core: light.core(light.edge.section({ at: 0.3 })),
  rim: light.rim({ width: 0.08 }),
}) })
woodblock({ paint: { mottle: paint.mottle() }, water: { palette: seaPalette.deep() } })   // palette options, each off by default
```

The crab's design has the looks as a slot declared a look (`looks: ["foam", "light"]` in
`examples/bosses/reefback_titan.ts`), so it does not multiply `check --combinations`:

```
bun src/cli/main.ts render examples/bosses/reefback_titan.ts --variant bruiser,light=engraving --views game --out out/x.webp
```

On any scene drawn in the woodblock style, without editing it, `--light <look>` (with `render`, `clip`, `frames`,
`profile`, `build`, `variants`) asks the style for the look of that name (`Style.lights`); an unknown name fails and
lists the names:

```
bun src/cli/main.ts clip examples/bosses/crab_lineup.ts --light engraving --view lineup --seconds 24 --out out/x.mp4
```

The sun is the host input `sun` on the crab and the lineup: `--input sun=-0.95,0.3,0.05` puts it low behind the lineup.

## The looks (`LOOKS`)

Cost is what the look adds to a normal frame of the bruiser from `game` at 1280x800, beside the print as it is in
alternating timing rounds (`bun tools/light_gallery.ts cost`: the print as it is and the look profiled in turn, the median difference of n pairs; the print as it is read 1.8 to 3.6 ms, other workers sharing the GPU, so a difference under about 0.3 ms is unresolved).

| Name | What it is | For | Cost |
|---|---|---|---|
| `flat` | No shading: every surface in its lit ink, and the key line. | A diagram, a far camera, a base to build on. | none measurable (median -0.07 ms, n=3) |
| `twoTone` | The shadow side of every form in a warm block, and the shadows the parts cast on each other. | The cel look; reads at game size. | +0.2 ms (n=3; spread -0.1 to +0.6: unresolved) |
| `threeTone` | `twoTone` and a hard cream shape on each form's lit shoulder. | A wet shell; close cameras. | +0.1 ms (n=3; unresolved) |
| `bokashi` | Flat inks, each form's lower half and its foot washed into indigo. | The quiet print; a still. The one soft look. | none measurable (n=3) |
| `hatched` | The shadow side engraved: lines round the form in each ink's own shade, 5 to 10 px apart at any distance, ragged ends. | The video; close and middle cameras. | none measurable (median 0.00 ms, n=5) |
| `contact` | Flat inks, a dark band where a part lies on another or stands in the water. | Separating parts without lighting them. | +1.0 ms (n=5, +0.6 to +1.5) |
| `rim` | The body mostly under a deep indigo block, a cream edge toward the sun. | Night, a storm, a lamp behind. | +0.5 ms (n=5, +0.4 to +0.9) |
| `cel` | Two tones, cast shadows, contact bands, sparse highlights (the painted `shade_best` mix). | The richest game-camera look. | +1.2 ms (n=4, +0.9 to +1.8) |
| `sunset` | Hatched toward a light fixed up-left of the camera, undersides washed violet, a gold rim toward the sun. | The sun low behind the subject: fronts stay readable. | +0.5 ms (n=3, 0 to +1.0: unresolved) |
| `referencePalette` | The print's own two tones in the reference palette (below). | The reference pictures' colour without changing the light. | +0.7 ms (n=4, +0.5 to +0.8) |
| `engraving` | `hatched` in the reference palette. **The four-crab video's look.** | The video, a poster. | +0.7 ms (n=4, +0.3 to +0.9); the four crabs: +0.2 and +0.7 ms (n=2, unresolved) on a 3.0 to 3.3 ms frame |
| `engravingSunset` | `sunset` in the reference palette. | The video with the sun behind the line. | +1.3 ms (n=4, +1.0 to +2.2) |

A look that casts shadows or bands overlaps (`twoTone`, `threeTone`, `contact`, `rim`, `cel`) pays for drawing them
after the bodies (a phase `on-bodies`); the others shade in the bodies' own fragments and add no draw. The reference
palette costs about 0.7 ms on the crab, more than its two noise octaves and a few derivatives per fragment should; where
it goes was not measured (overdraw on the bodies is the first suspect). For the cheapest picture close to the video's,
`hatched` alone costs nothing measurable.

## The reference palette (options of the style, each off by default)

`REFERENCE_PAINT` and the deep sea are what `referencePalette`, `engraving` and `engravingSunset` turn on.

| Option | What it does |
|---|---|
| `paint.warm: paint.hotter()` | A paint whose red stands above its green and blue by 0.33 is multiplied by (1.27, 1.18, 1): brick (0.66, 0.22, 0.13) to (0.84, 0.26, 0.13). |
| `paint.mottle: paint.mottle()` | Darker blotches (0.74 of the paint) on the warm paints, from two octaves of noise in the surface's own anchor (they ride the body, never swim), about 0.4 units across. |
| `paint.line: paint.swelling()` | The key line up to 0.05 heavier inside the hull on the side away from the light. |
| `outline: 1.4` | The key line 1.4 times the param `woodblock.outline` (a factor: the param is one per process). |
| `water.palette: seaPalette.deep()` | The sea one deep indigo (0.08, 0.17, 0.30), darker troughs, thin cream lines, a dark far haze. The foam is untouched. |

## The treatments

Each is a field of `LightRecipe`, a sum type with an `off`, built by `light.<name>(options)`.

| Field | On | Options (defaults) |
|---|---|---|
| `core` | The shadow block printed flat on the shadow side of a terminator. | `light.core(edge)`; an edge is `light.edge.section({ at: 0.4, key })` or `light.edge.sun({ at, key })` |
| `hatch` | Lines round the form (constant length along its spine) whose weight swells from nothing above the terminator to `cap` below it; the period on screen kept between `least` and 2 `least` px by splitting or merging lines (measured on the lines' own screen rate); none on rings seen end on; each line's end moved by a hash of its index. | `edge` (section at 0.3, key 60 off the lens), `over` 0.16, `deep` 0.32, `cap` 0.72, `spacing` 0.2, `least` 5 px, `ragged` 0.1 |
| `waterline` | A flat band where a body stands in the water. | `height` 0.22, `amount` 1 |
| `bokashi` | The block wiped to a grade: up from the water, and round every underside. | `foot` 2.2, `under` [-0.15, 0.75], `amount` 1 |
| `rim` | A light edge inside the key line on the key's side, cut out of the block. | `width` 0.1, `ink` cream, `amount` 0.9, `key` the sun |
| `highlight` | A lighter ink where the surface faces half way between key and eye. | `size` 13 degrees (5% of a ball's disc), `ink` cream, `amount` 0.32, `key` |
| `cast` | Shadows of every skeleton's capsules on the other bodies. | `reach` 9, `thin` 0.13 (thinner capsules cast nothing) |
| `overlap` | A band on whatever lies close behind a nearer part. | `width` 0.16, `gap` 1.6, `amount` 1 |
| `block` | The shadow block's ink. | `{ kind: "rule" }`, the style's own, or `light.block({ ink, amount, value })` |

Two ideas the options name:

- **The key** (`light.key.sun()`, `light.key.offLens(45)`, `light.key.camera(side, up)`; `camera` is a light fixed to the camera, for a sun behind the subject). The game camera looks down the sun (23 degrees off it), and
  a form lit from behind the lens has no shadow side: a ball shows 4% of itself in shadow. `offLens(n)` is the sun
  swung away from the view axis, in the plane of the two, until it is `n` degrees off; a camera already further off
  sees the sun itself. It is one direction for the whole picture and turns with the camera, not with the things. Cast
  shadows always fall along the sun itself.
- **The terminator round the section** (`light.edge.section`). A bare threshold N.K < `at` blacks out a limb that
  points along the light and pulses as the limb swings. The `section` edge is N.K < `at` |K across the limb|: the same
  share of every section in shadow, however the limb points. The limb's direction is the gradient of the arc length
  along its spine (`ShadeCtx.anchor.x`); on an end cap, and on a traced solid, it is the plain threshold.

## How the block is printed

A recipe's shadows are one overprinted block, as a printer's are: a tone, 1 where the paper is left and 0 where the
block prints whole. Core, hatching, waterline and wash each give a tone and the darkest wins; the rim cuts its edge out
of it; the highlight goes on what is left. The fixed order is in `lit()` (`src/style/light.ts`).

Without `cast` or `overlap` the block is printed in each body's own fragment. With either, the bodies write the tone to
the picture's alpha (the style's `mark`) and three kinds of draw follow in a new phase, `on-bodies`, before the water
(`src/draw/light.ts`): a box per capsule that lowers the tone where the capsule's shadow falls on the opaque scene
(found from its depth); one full-screen draw for the overlap bands; one that prints the block by blending alone
(`picture * alpha + ink * (1 - alpha)`) and sets alpha back to 1. The first two blend alpha with `min`, so shadows over
each other are one shadow. Nothing reads the picture back.

Under a recipe a `bands` or `keys` print rule prints its lit inks and takes the block over them; the rule's own second
inks are for the style without a recipe.

Host and format: two blend states (`Draw.blend` `alpha-min` and `alpha-pull`, lowered to WebGPU blend descriptors the
loaders already read). No new pass, texture or uniform; `docs/artefact_format.md` and the Rust loader are unchanged.

## The sun

`scene({ sun: movable([0.15, 0.8, 0.6]) })` (`src/sun.ts`) makes the sun the host input `sun`, that direction its
default: `--input sun=x,y,z`, `--sweep sun=a..b` on a clip, or a game writing the input. A bare vector is a fixed sun,
a literal in every shader, as before. The crab and the lineup use a movable sun; their default pictures are the same
to the bit. A cloud's own light tables (`src/soft/`) are made on the CPU from the stated direction and do not follow a
moved sun.

## Limits

- A thing without a skeleton casts nothing: the crab's head, the island's own outline (the reef's capsule stands for
  it), trees, sails. A wide flat form casts as the round chain of its skeleton.
- A cast shadow that crosses a highlight prints over the highlight's lighter ink, so it is a little paler there.
- A smear (`src/spacetime/smear.ts`) shades its own fragments whole: it has the core shadow but nothing cast on it.
- `cast` and `overlap` need hull outlines (the default); with `outline: "screen"` the compile fails by name.
- The `section` edge reads screen derivatives, which are constant over a triangle: on a broad, nearly flat face the
  terminator can show steps of a pixel or two along the grid.

## Looking at them

`bun tools/light_gallery.ts stills|sheets|clips|cost` renders every recipe on the crab, another boss and the lineup,
assembles the labelled sheets under `out/shade/`, encodes a clip per recipe, and measures each recipe's frame beside
the print as it is.
