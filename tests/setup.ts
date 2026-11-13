// Loaded before every test file (bunfig.toml). These tests create GPU pipelines, which took over 10 s under a load
// average above 60 on a shared machine, against bun's default of 5 s per test. The `timeout` key in bunfig.toml was
// not being honoured (a relief test still timed out at 5 s on 2026-11-11), so the limit is set in code here.
import { setDefaultTimeout } from "bun:test";
setDefaultTimeout(60_000);
