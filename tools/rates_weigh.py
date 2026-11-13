# Per-frame work that rate lifting removes from draws, weighted by invocations (docs/gpu_native.md "Rates"): for each
# draw, the per-frame nodes lifted out of its vertex function (surf_<label>) times the vertices it drew (triangles x 3),
# and out of its fragment function (paint_ / colour_<label>) times an upper bound on its pixels (the whole 1280 x 800
# view). Also the before/after per-frame costs, least of the rounds, from tools/rates_bench.ts --profile JSON.
#   python3 tools/rates_weigh.py <census json dir> <profile json dir> <scene> ...
import json, sys, glob
census_dir, prof_dir, scenes = sys.argv[1], sys.argv[2], sys.argv[3:]
PIXELS = 1280 * 800
for s in scenes:
    rows = {r["name"]: r for r in json.load(open(f"{census_dir}/census_{s}.json"))}
    prof = {v: [json.load(open(f)) for f in sorted(glob.glob(f"{prof_dir}/{s}.{v}.*.json")) if open(f).read().strip()] for v in ("base", "after")}
    least = lambda v, f: min(f(p) for p in prof[v])
    base0 = prof["base"][0]
    vert = frag = 0
    for label, d in base0["draws"].items():
        v = rows.get(f"surf_{label}")
        if v and v["lifted"] > 0: vert += v["frame"] * d["triangles"] * 3
        for k in (f"paint_{label}", f"colour_{label}"):
            r = rows.get(k)
            if r and r["lifted"] > 0: frag += r["frame"] * PIXELS
    pose = lambda p: p["stages"].get("pose stages, one pass", 0)
    sea = lambda p: p["draws"]["sea"]["net"]
    draws = lambda p: sum(d["net"] for d in p["draws"].values())
    fixed = lambda p: sum(ms for k, ms in p["stages"].items() if not k.startswith("pose"))
    print(f"{s:16} lifted per-frame ops: vertex {vert/1e6:.2f} M, fragment <= {frag/1e6:.1f} M")
    for name, f in [("normal frame", lambda p: p["normal"]["ms"]), ("  its pose", lambda p: p["normal"]["pose"]), ("  its draws", lambda p: p["normal"]["draws"]), ("profiling total", lambda p: p["total"]), ("draws", draws), ("sea", sea), ("fixed stages", fixed), ("pose one pass", pose), ("CPU pose", lambda p: p["cpuPose"]), ("CPU encode", lambda p: p["cpuEncode"])]:
        b, a = least("base", f), least("after", f)
        rb = [round(f(p), 3) for p in prof["base"]]; ra = [round(f(p), 3) for p in prof["after"]]
        print(f"    {name:14} before {b:7.3f} {rb}   after {a:7.3f} {ra}")
