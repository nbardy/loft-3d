// `loft gallery` flags. Kept beside the command so args.ts only has to route to it.
import { parseSize, UsageError, type Size } from "./args.ts";

export type GalleryCommand = {
  readonly kind: "gallery";
  readonly out: string;
  /** Comma-separated globs in the flag; one entry each here. */
  readonly scenes: readonly string[];
  readonly styles: readonly string[];
  readonly size: Size;
  readonly clipSeconds: number;
  readonly only: readonly string[];
  readonly force: boolean;
};

const VALUE_FLAGS = ["--out", "--scenes", "--styles", "--size", "--clip-seconds", "--only"] as const;
const list = (s: string) => s.split(",").map((x) => x.trim()).filter((x) => x !== "");

export function parseGalleryArgs(rest: readonly string[]): GalleryCommand {
  const values = new Map<string, string>();
  let force = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--force") { force = true; continue; }
    if (!(VALUE_FLAGS as readonly string[]).includes(a)) throw new UsageError(a.startsWith("--") ? `flag ${a} does not apply to "gallery"` : `gallery takes no positional argument, got "${a}"`);
    const v = rest[++i];
    if (v === undefined || v.startsWith("--")) throw new UsageError(`flag ${a} needs a value`);
    if (values.has(a)) throw new UsageError(`flag ${a} given twice`);
    values.set(a, v);
  }
  const seconds = Number(values.get("--clip-seconds") ?? "6");
  if (!(seconds > 0) || !Number.isFinite(seconds)) throw new UsageError(`--clip-seconds: "${values.get("--clip-seconds")}" must be a positive number`);
  const size = parseSize(values.get("--size") ?? "960x600");
  if (size.width % 2 !== 0 || size.height % 2 !== 0) throw new UsageError(`--size: ${size.width}x${size.height} must be even (the clip is yuv420p)`);
  return {
    kind: "gallery",
    out: values.get("--out") ?? "out/gallery",
    scenes: list(values.get("--scenes") ?? "examples/*.ts,examples/scenes/*.ts"),
    styles: list(values.get("--styles") ?? "toon,woodblock,biolume,papercraft"),
    size,
    clipSeconds: seconds,
    only: list(values.get("--only") ?? ""),
    force,
  };
}
