# Variants of a built artefact's sea fragment program, to price its parts by measurement (docs/gpu_native.md "Rates").
# Writes <dir>_<variant> copies whose sea module differs: noband (contact band returns "no body near"), outer (only the
# outer ring of 8 taps), flat (the fragment returns a constant colour: the draw's floor).
#   python3 tools/sea_variants.py <built dir>
import os, re, shutil, sys
src = sys.argv[1].rstrip("/")
def variant(name, edit):
    dst = f"{src}_{name}"
    shutil.rmtree(dst, ignore_errors=True)
    shutil.copytree(src, dst)
    hits = 0
    for f in os.listdir(f"{dst}/wgsl"):
        p = f"{dst}/wgsl/{f}"
        t = open(p).read()
        u = edit(t)
        if u != t:
            open(p, "w").write(u); hits += 1
    print(name, "chunks edited:", hits)
band = re.compile(r"(fn loft_contact_band\(p: vec3<f32>, px: vec2<f32>, width: f32\) -> f32 \{)")
variant("noband", lambda t: band.sub(r"\1\n  return -1.0;", t))
variant("outer", lambda t: t.replace("if (gap < 2.0 * width) {", "if (false) {"))
variant("flat", lambda t: re.sub(r"(@fragment fn fs\(in: VOut\) -> @location\(0\) vec4<f32> \{) return colour_sea\(", r"\1 return vec4<f32>(0.1, 0.2, 0.4, 0.5); return colour_sea(", t))
# none: every vertex outside the clip volume, so the sea draws nothing (what the frame costs without it).
variant("none", lambda t: t.replace("  out.clip = frame.view_proj * vec4<f32>(p, 1.0);\n  out.world = p;", "  out.clip = vec4<f32>(0.0, 0.0, 2.0, 1.0);\n  out.world = p;") if "fn colour_sea(" in t else t)
