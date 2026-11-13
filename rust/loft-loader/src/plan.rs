//! The level-of-detail plan (docs/artefact_format.md, "The level-of-detail plan"; src/host/detail.ts line for line):
//! per planned draw, the runs of draw calls, and the `loft_detail` slots the shaders read.

use crate::camera::Matrices;
use crate::manifest::{Detail, Layer, Level, PlanDraw};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy)]
pub struct Run {
    pub vertices: u32,
    pub instances: u32,
    pub first: u32,
}

/// The level each instance of each grid slot drew last frame (-1: not drawn, or never): the loader's only memory.
pub type Memory = HashMap<usize, Vec<i16>>;

/// Bounds of each grid this frame, as `(x, y, z, scale)` per instance: none read yet, or the read-back floats
/// (grid slot -> its first vec4 in `floats`).
pub enum Bounds<'a> {
    None,
    Read { floats: &'a [f32], at: &'a HashMap<usize, usize> },
}

const HYSTERESIS: f64 = 1.25;
const MIN_PIXELS: f64 = 1.0;
const CELL_PIXELS: f64 = 7.0;

struct View<'a> {
    m: &'a Matrices,
    width: f64,
    height: f64,
    fy: f64,
}

fn hypot3(a: f64, b: f64, c: f64) -> f64 {
    (a * a + b * b + c * c).sqrt()
}

impl View<'_> {
    fn ppu(&self, w: f64) -> f64 {
        self.height * self.fy / (2.0 * w)
    }
    /// Clip w of a world point, and the length of the row giving it (1 perspective, 0 orthographic).
    fn clip_w(&self, x: f64, y: f64, z: f64) -> (f64, f64) {
        let v = &self.m.view_proj;
        (v[3] * x + v[7] * y + v[11] * z + v[15], hypot3(v[3], v[7], v[11]))
    }
    fn ndc(&self, p: [f64; 3]) -> [f64; 2] {
        let v = &self.m.view_proj;
        let w = v[3] * p[0] + v[7] * p[1] + v[11] * p[2] + v[15];
        [(v[0] * p[0] + v[4] * p[1] + v[8] * p[2] + v[12]) / w, (v[1] * p[0] + v[5] * p[1] + v[9] * p[2] + v[13]) / w]
    }
    /// Where the ray through NDC (x, y) meets the plane y = h ahead, and its view depth.
    fn hit(&self, x: f64, y: f64, h: f64) -> Option<([f64; 3], f64)> {
        let m = &self.m.inv_view_proj;
        let un = |z: f64| {
            let w = m[3] * x + m[7] * y + m[11] * z + m[15];
            [
                (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
                (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
                (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
            ]
        };
        let (a, b) = (un(0.0), un(1.0));
        let dy = b[1] - a[1];
        if dy.abs() < 1e-12 {
            return None;
        }
        let t = (h - a[1]) / dy;
        if !(t > 0.0) {
            return None;
        }
        let p = [a[0] + t * (b[0] - a[0]), h, a[2] + t * (b[2] - a[2])];
        let (f, e) = (self.m.forward, self.m.eye);
        Some((p, (p[0] - e[0]) * f[0] + (p[1] - e[1]) * f[1] + (p[2] - e[2]) * f[2]))
    }
}

fn choose_level(levels: &[Level], cell_px: impl Fn(usize) -> f64, px_across: f64, target: f64, prev: i16) -> i16 {
    if px_across < MIN_PIXELS {
        return -1;
    }
    let mut fresh = 0;
    while fresh + 1 < levels.len() && cell_px(fresh + 1) <= target {
        fresh += 1;
    }
    let fresh = fresh as i16;
    if prev < 0 || prev as usize >= levels.len() {
        return fresh;
    }
    let p = prev as usize;
    if cell_px(p) > target * HYSTERESIS || (p + 1 < levels.len() && cell_px(p + 1) <= target / HYSTERESIS) {
        return fresh;
    }
    prev
}

fn set(out: &mut [f32], slot: usize, v: [f32; 4]) {
    out[slot * 4..slot * 4 + 4].copy_from_slice(&v);
}

#[allow(clippy::too_many_arguments)]
fn grid_runs(
    slot: usize, radius: f64, levels: &[Level], instances: usize, view: &View, bounds: &Bounds, target: f64,
    memory: &mut Memory, out: &mut [f32],
) -> Vec<Run> {
    let (floats, first) = match bounds {
        Bounds::None => {
            for i in 0..instances {
                set(out, slot + i, [levels[0].cells[0], levels[0].cells[1], 0.0, 0.0]);
            }
            return vec![Run { vertices: levels[0].vertices, instances: instances as u32, first: 0 }];
        }
        Bounds::Read { floats, at } => (*floats, at[&slot]),
    };
    let seen = memory.remove(&slot).unwrap_or_else(|| vec![-1; instances]);
    let mut chosen = vec![-1i16; instances];
    let near = view.m.near;
    for i in 0..instances {
        let b = &floats[(first + i) * 4..(first + i) * 4 + 4];
        let (w, persp) = view.clip_w(b[0] as f64, b[1] as f64, b[2] as f64);
        let scale = (b[3] as f64).abs();
        let r = scale * radius;
        let behind = w + r * persp <= near;
        let near_ppu = view.ppu((w - r * persp).max(near));
        let across = 2.0 * r * view.ppu(w.max(near));
        let level =
            if behind { -1 } else { choose_level(levels, |k| scale * levels[k].cell * near_ppu, across, target, seen[i]) };
        chosen[i] = level;
        if level >= 0 {
            let c = levels[level as usize].cells;
            set(out, slot + i, [c[0], c[1], 0.0, 0.0]);
        }
    }
    let mut runs = Vec::new();
    let mut i = 0;
    while i < instances {
        let mut j = i + 1;
        while j < instances && chosen[j] == chosen[i] {
            j += 1;
        }
        if chosen[i] >= 0 {
            runs.push(Run { vertices: levels[chosen[i] as usize].vertices, instances: (j - i) as u32, first: i as u32 });
        }
        i = j;
    }
    memory.insert(slot, chosen);
    runs
}

fn projected_runs(slot: usize, cell: f64, plane: f64, reach: f64, lift: f64, view: &View, target: f64, out: &mut [f32]) -> Vec<Run> {
    let cell_px = cell * if target > 0.0 { target } else { CELL_PIXELS };
    let lifted = view.hit(0.0, -1.0, plane).map(|(p, _)| view.ndc([p[0], p[1] + lift, p[2]]));
    let m = 0.02 + lifted.map_or(0.1, |l| ((l[1] + 1.0).abs() * 1.25).min(1.0));
    let inside = |y: f64| view.hit(0.0, y, plane).is_some_and(|(_, depth)| depth <= reach);
    let edge = |mut a: f64, mut b: f64| {
        for _ in 0..40 {
            let mid = (a + b) / 2.0;
            if inside(mid) { a = mid } else { b = mid }
        }
        a
    };
    let (lo, hi) = (-1.0 - m, 1.0 + m);
    let rows = match (inside(lo), inside(hi)) {
        (true, true) => (lo, hi),
        (true, false) => (lo, edge(lo, hi)),
        (false, true) => (edge(hi, lo), hi),
        (false, false) => return Vec::new(),
    };
    let nx = (((2.0 + 2.0 * m) / 2.0) * view.width / cell_px).ceil().max(1.0);
    let ny = (((rows.1 - rows.0) / 2.0) * view.height / cell_px).ceil().max(1.0);
    set(out, slot, [nx as f32, ny as f32, rows.0 as f32, rows.1 as f32]);
    set(out, slot + 1, [m as f32, 0.0, 0.0, 0.0]);
    vec![Run { vertices: 6 * nx as u32 * ny as u32, instances: 1, first: 0 }]
}

/// The frame's plan (runs per `plan[k]`) and `loft_detail` contents. `out` persists between frames, as in detail.ts.
#[allow(clippy::too_many_arguments)]
pub fn plan_frame(
    draws: &[PlanDraw], m: &Matrices, width: u32, height: u32, cell_pixels: f64, construction: bool, bounds: &Bounds,
    memory: &mut Memory, out: &mut [f32], plan: &mut Vec<Vec<Run>>,
) {
    let v = &m.view_proj;
    let view = View { m, width: width as f64, height: height as f64, fy: hypot3(v[1], v[5], v[9]) };
    // A surface and its outline share a slot: the first draw to reach it chooses, the second reuses the choice.
    let mut chosen: HashMap<usize, usize> = HashMap::new();
    plan.clear();
    for (k, d) in draws.iter().enumerate() {
        let runs = match (d.layer, construction) {
            (Layer::Construction, false) => Vec::new(),
            (Layer::Scene, _) | (Layer::Construction, true) => match &d.detail {
                Detail::Fixed => vec![Run { vertices: d.vertices, instances: d.instances, first: 0 }],
                Detail::Grid { slot, radius, levels } => match chosen.get(slot) {
                    Some(&earlier) => plan[earlier].clone(),
                    None => {
                        chosen.insert(*slot, k);
                        grid_runs(*slot, *radius, levels, d.instances as usize, &view, bounds, cell_pixels, memory, out)
                    }
                },
                Detail::Projected { slot, cell, plane, reach, lift } => {
                    projected_runs(*slot, *cell, *plane, *reach, *lift, &view, cell_pixels, out)
                }
            },
        };
        plan.push(runs);
    }
}
