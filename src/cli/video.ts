// Raw RGBA frames straight into ffmpeg's stdin. Nothing touches disk but the .mp4.
import { EnvironmentError } from "../errors.ts";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type VideoWriter = { write(rgba: Uint8Array): Promise<void>; finish(): Promise<void> };

/** libx264 needs even dimensions for yuv420p; the caller must pass even width and height. */
export function openVideo(path: string, width: number, height: number, fps: number): VideoWriter {
  if (width % 2 !== 0 || height % 2 !== 0) throw new Error(`video size ${width}x${height}: yuv420p needs even width and height`);
  mkdirSync(dirname(path), { recursive: true });
  if (Bun.which("ffmpeg") === null) throw new EnvironmentError("ffmpeg is not on PATH; it encodes the clip (brew install ffmpeg, apt install ffmpeg)", false);
  const proc = Bun.spawn(
    ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${width}x${height}`, "-r", String(fps), "-i", "-",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path],
    { stdin: "pipe", stdout: "ignore", stderr: "pipe" },
  );
  return {
    async write(rgba) {
      proc.stdin.write(rgba);
      await proc.stdin.flush(); // backpressure: do not render far ahead of the encoder
    },
    async finish() {
      await proc.stdin.end();
      const code = await proc.exited;
      if (code !== 0) throw new EnvironmentError(`ffmpeg failed (${code}): ${await new Response(proc.stderr).text()}`, false);
    },
  };
}
