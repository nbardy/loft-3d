// `loft check <scene.ts>`: a scene's checks (src/check.ts), run on the CPU against the scene they were built with,
// printed as a table. A plain module: its exported `checks` against its default export. A design (docs/variants.md):
// the variant given, or else every named variant, or with `--combinations` every combination of slot options; one
// table per variant. Exits 5 when any check fails, or as the error of a variant that fails to build (README "Exit codes").
import type { Command } from "./args.ts";
import { choose, subjectAt, type Chosen } from "./variant.ts";
import type { VariantAsk } from "../design.ts";
import { ChecksFailed } from "./verdict.ts";
import { UsageError } from "./args.ts";
import { LoadError } from "../errors.ts";

type Outcome = { readonly label: string; readonly about: string; readonly result: { readonly kind: "built"; readonly failed: number; readonly total: number; readonly failing: readonly string[] } | { readonly kind: "unbuilt"; readonly error: string; readonly thrown: unknown } };

export async function check(cmd: Extract<Command, { kind: "check" }>): Promise<void> {
  const subject = await subjectAt(cmd.path);
  const { runChecks, formatChecks } = await import("../check.ts");

  /** One variant's table; a variant that throws while it is built or compiled is a failure with its reason, and the rest go on. */
  const run = (label: string, about: string, pick: () => Chosen): Outcome => {
    const t = performance.now();
    try {
      const c = pick();
      if (c.checks.kind === "absent") throw new LoadError(`${cmd.path} exports no \`checks\` array. Fix: export const checks = [...] beside the default export, e.g. export const checks = [budget({ triangles: 100_000 })]`);
      const verdicts = runChecks(c.scene, c.checks.list);
      const failed = verdicts.filter((v) => !v.pass).length;
      console.log(`${formatChecks(verdicts)}\n\n${verdicts.length - failed} passed, ${failed} failed  (${(performance.now() - t).toFixed(0)} ms, including compile)`);
      return { label: c.label, about, result: { kind: "built", failed, total: verdicts.length, failing: verdicts.filter((v) => !v.pass).map((v) => v.name) } };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.log(`NOT CHECKED: ${error}`);
      return { label, about, result: { kind: "unbuilt", error, thrown: e } };
    }
  };

  const outcomes: Outcome[] = [];
  const each = (asks: readonly { readonly label: string; readonly about: string; readonly ask: VariantAsk }[]) => {
    for (const a of asks) {
      console.log(`\n== variant ${a.label}: ${a.about}`);
      outcomes.push(run(a.label, a.about, () => choose(subject, cmd.path, { kind: "ask", ask: a.ask, text: a.label })));
    }
  };
  switch (subject.kind) {
    case "scene":
      if (cmd.combinations) throw new UsageError(`--combinations: ${cmd.path} exports a scene, not a design: it has no slot options to combine (drop --combinations)`);
      outcomes.push(run("scene", "", () => choose(subject, cmd.path, cmd.variant)));
      break;
    case "design": {
      const d = subject.design;
      // Labelled from the picks, not resolved here: a combination whose options disagree on a number fails in its own row.
      if (cmd.combinations) each(d.combinations().map((ask) => ({ label: ask.picks.length === 0 ? "base" : ask.picks.map(([s, o]) => `${s}=${o}`).join(","), about: "combination", ask })));
      else if (cmd.variant.kind === "ask") each([{ label: cmd.variant.text, about: "as asked", ask: cmd.variant.ask }]);
      else each(d.variants.map((v) => ({ label: v, about: d.about(v), ask: { variant: v, picks: [] } })));
      break;
    }
  }

  const bad = outcomes.filter((o) => o.result.kind === "unbuilt" || o.result.failed > 0);
  if (outcomes.length > 1) {
    console.log(`\nvariant${" ".repeat(34)}checks`);
    for (const o of outcomes) {
      const r = o.result;
      console.log(`${o.label.padEnd(40)} ${r.kind === "built" ? `${r.total - r.failed}/${r.total} pass` : `not checked: ${r.error.split("\n")[0]}`}`);
    }
    console.log(`\n${outcomes.length - bad.length} of ${outcomes.length} variants pass`);
  }
  // A variant that did not build ends the command as its error does (src/cli/verdict.ts); else failed checks.
  const unbuilt = outcomes.find((o) => o.result.kind === "unbuilt");
  if (unbuilt !== undefined && unbuilt.result.kind === "unbuilt") throw unbuilt.result.thrown;
  // The last line names each failing check, so a script (or a model) reads what failed without the table.
  const named = bad.map((o) => (o.result.kind === "built" ? `${outcomes.length === 1 ? "" : `${o.label}: `}${o.result.failing.join(", ")}` : o.label));
  if (bad.length > 0) throw new ChecksFailed(`${bad.length} of ${outcomes.length} ${outcomes.length === 1 ? "scene has" : "variants have"} failing checks: ${named.join("; ")}`);
}
