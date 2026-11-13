//! loft-view: draws a Loft artefact folder headless with loft-loader, and times it.
//!
//!   loft-view <dir> --view game --time 1.0 --size 1280x800 --out f.png [--input name=v[,v...]] [--param name=v]
//!             [--frames N [--wait]] [--pose-time]
//!
//! One frame waits for its own level-of-detail bounds (as `loft render` does) and is written as PNG. `--frames N` then
//! draws N consecutive frames of the same view as a game would (planning with the last bounds read, never
//! waiting; `--wait` makes each frame wait for its own, as a headless frame does) and prints, per frame, the CPU time
//! inside the loader (from the first write to the caller's submit, less any wait for the GPU inside the call) and, when
//! the adapter grants timestamp queries, the GPU time as `loft profile`'s "normal frame" defines it: the pose pass
//! (start to end) plus the render passes (first start to last end), the gap between the two submits not counted.
//! `--pose-time`: the pose stages alone, as tools/pose_time.ts measures them (40 repeats in one timed pass, least of 8).

use loft_loader::{read_dir, Bounds, Loft, Timestamps, OUTPUT_FORMAT};
use std::path::PathBuf;
use std::time::Instant;

struct Args {
    dir: PathBuf,
    view: String,
    time: f64,
    size: (u32, u32),
    out: Option<PathBuf>,
    inputs: Vec<(String, Vec<f32>)>,
    params: Vec<(String, f32)>,
    frames: usize,
    wait: bool,
    pose_time: bool,
}

fn fail(msg: String) -> ! {
    eprintln!("loft-view: {msg}");
    std::process::exit(2)
}

fn parse() -> Args {
    let mut it = std::env::args().skip(1);
    let mut a = Args {
        dir: it.next().map(PathBuf::from).unwrap_or_else(|| fail("usage: loft-view <dir> --view game --time 1 --size 1280x800 --out f.png".into())),
        view: "game".into(), time: 1.0, size: (1280, 800), out: None, inputs: vec![], params: vec![], frames: 0, wait: false, pose_time: false,
    };
    let num = |s: &str, flag: &str| s.parse::<f64>().unwrap_or_else(|_| fail(format!("{flag}: not a number: {s}")));
    while let Some(flag) = it.next() {
        let mut value = || it.next().unwrap_or_else(|| fail(format!("{flag} needs a value")));
        match flag.as_str() {
            "--view" => a.view = value(),
            "--time" => a.time = num(&value(), "--time"),
            "--size" => {
                let v = value();
                let (w, h) = v.split_once('x').unwrap_or_else(|| fail(format!("--size: expected WxH, got {v}")));
                a.size = (num(w, "--size") as u32, num(h, "--size") as u32);
            }
            "--out" => a.out = Some(value().into()),
            "--input" | "--param" => {
                let v = value();
                let (name, vals) = v.split_once('=').unwrap_or_else(|| fail(format!("{flag}: expected name=value, got {v}")));
                let vals: Vec<f32> = vals.split(',').map(|x| num(x, &flag) as f32).collect();
                match flag.as_str() {
                    "--input" => a.inputs.push((name.into(), vals)),
                    _ => a.params.push((name.into(), vals[0])),
                }
            }
            "--frames" => a.frames = num(&value(), "--frames") as usize,
            "--wait" => a.wait = true,
            "--pose-time" => a.pose_time = true,
            _ => fail(format!("unknown flag {flag}")),
        }
    }
    a
}

fn stats(xs: &mut [f64]) -> String {
    xs.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let q = |p: f64| xs[((xs.len() - 1) as f64 * p).round() as usize];
    format!("least {:.3}  median {:.3}  most {:.3} ms", q(0.0), q(0.5), q(1.0))
}

fn main() {
    let a = parse();
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        ..Default::default()
    }))
    .unwrap_or_else(|e| fail(format!("no adapter: {e}")));
    let timing = adapter.features().contains(wgpu::Features::TIMESTAMP_QUERY);
    let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
        label: Some("loft-view"),
        required_features: if timing { wgpu::Features::TIMESTAMP_QUERY } else { wgpu::Features::empty() },
        ..Default::default()
    }))
    .unwrap_or_else(|e| fail(format!("no device: {e}")));
    eprintln!("adapter {} ({:?}); timestamp queries {}; inside encoders {}", adapter.get_info().name, adapter.get_info().backend, if timing { "granted" } else { "not granted" }, adapter.features().contains(wgpu::Features::TIMESTAMP_QUERY_INSIDE_ENCODERS));

    let t = Instant::now();
    let artefact = read_dir(&a.dir).unwrap_or_else(|e| fail(e.to_string()));
    let read_ms = t.elapsed().as_secs_f64() * 1e3;
    let t = Instant::now();
    let mut loft = Loft::load(&device, &queue, artefact).unwrap_or_else(|e| fail(e.to_string()));
    eprintln!("read {read_ms:.0} ms, load {:.0} ms", t.elapsed().as_secs_f64() * 1e3);
    loft.set_camera(loft.camera(&a.view).unwrap_or_else(|e| fail(e.to_string())));
    loft.set_time(a.time);
    for (name, v) in &a.inputs {
        loft.set_input(name, v).unwrap_or_else(|e| fail(e.to_string()));
    }
    for (name, v) in &a.params {
        loft.set_param(name, *v).unwrap_or_else(|e| fail(e.to_string()));
    }

    let (w, h) = a.size;
    let output = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("loft-view output"),
        size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: OUTPUT_FORMAT,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let target = output.create_view(&Default::default());
    let row = (w * 4).div_ceil(256) * 256;
    let readback = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("loft-view readback"),
        size: (row * h) as u64,
        usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });

    // The picture: a frame that waits for its own bounds.
    let mut encoder = device.create_command_encoder(&Default::default());
    let drawn = loft.encode_frame(&device, &queue, &mut encoder, &target, w, h, Bounds::Latest).unwrap_or_else(|e| fail(e.to_string()));
    encoder.copy_texture_to_buffer(
        output.as_image_copy(),
        wgpu::TexelCopyBufferInfo { buffer: &readback, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(row), rows_per_image: Some(h) } },
        output.size(),
    );
    queue.submit([encoder.finish()]);
    readback.map_async(wgpu::MapMode::Read, .., |r| r.expect("readback map"));
    device.poll(wgpu::PollType::wait_indefinitely()).expect("poll");
    let mut rgba = Vec::with_capacity((w * h * 4) as usize);
    {
        let mapped = readback.get_mapped_range(..).expect("readback range");
        for y in 0..h as usize {
            rgba.extend_from_slice(&mapped[y * row as usize..y * row as usize + w as usize * 4]);
        }
    }
    readback.unmap();
    eprintln!("frame: {} triangles in {} draw calls", drawn.triangles, drawn.draws);
    if let Some(out) = &a.out {
        let file = std::fs::File::create(out).unwrap_or_else(|e| fail(format!("{}: {e}", out.display())));
        let mut png = png::Encoder::new(std::io::BufWriter::new(file), w, h);
        png.set_filter(png::Filter::NoFilter); // tools/picdiff.ts reads unfiltered rows only
        png.set_color(png::ColorType::Rgba);
        png.set_depth(png::BitDepth::Eight);
        png.write_header().and_then(|mut wr| wr.write_image_data(&rgba)).unwrap_or_else(|e| fail(format!("png: {e}")));
    }

    if a.frames > 0 {
        frames(&a, &device, &queue, &mut loft, &target, (&output, &readback, row), timing);
    }
    if a.pose_time {
        pose_time(&device, &queue, &loft, timing);
    }
}

/// Timestamps resolved into a buffer this frame, and the readable copy.
struct Clock {
    resolve: wgpu::Buffer,
    read: wgpu::Buffer,
    period_ns: f64,
}
impl Clock {
    fn new(device: &wgpu::Device, queue: &wgpu::Queue, n: u64) -> Clock {
        let buffer = |usage, label| device.create_buffer(&wgpu::BufferDescriptor { label: Some(label), size: n * 8, usage, mapped_at_creation: false });
        Clock {
            resolve: buffer(wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC, "resolve"),
            read: buffer(wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST, "read"),
            period_ns: queue.get_timestamp_period() as f64,
        }
    }
    fn encode(&self, encoder: &mut wgpu::CommandEncoder, set: &wgpu::QuerySet, n: u32) {
        encoder.resolve_query_set(set, 0..n, &self.resolve, 0);
        encoder.copy_buffer_to_buffer(&self.resolve, 0, &self.read, 0, None);
    }
    /// After the submit: waits, and returns the ticks.
    fn ticks(&self, device: &wgpu::Device) -> Vec<u64> {
        self.read.map_async(wgpu::MapMode::Read, .., |r| r.expect("timestamp map"));
        device.poll(wgpu::PollType::wait_indefinitely()).expect("poll");
        let t = self.read.get_mapped_range(..).expect("timestamp range").chunks_exact(8).map(|c| u64::from_le_bytes(c.try_into().unwrap())).collect();
        self.read.unmap();
        t
    }
}

/// `copy`: the output texture, readback buffer and row pitch. A waiting frame copies its picture out, as Dawn's `frame`
/// (whose GPU time profile reports) does.
#[allow(clippy::type_complexity)]
fn frames(a: &Args, device: &wgpu::Device, queue: &wgpu::Queue, loft: &mut Loft, target: &wgpu::TextureView, copy: (&wgpu::Texture, &wgpu::Buffer, u32), timing: bool) {
    let n = 2 + 2 * loft.pass_labels().count() as u32;
    let clock = timing.then(|| {
        loft.set_timestamps(Some(Timestamps { set: device.create_query_set(&wgpu::QuerySetDescriptor { label: Some("loft frame"), ty: wgpu::QueryType::Timestamp, count: n }) }));
        Clock::new(device, queue, n as u64)
    });
    let bounds = if a.wait { Bounds::Latest } else { Bounds::Last };
    let (mut cpu, mut gpu, mut pose, mut passes) = (vec![], vec![], vec![], vec![]);
    for _ in 0..a.frames {
        let t = Instant::now();
        let mut encoder = device.create_command_encoder(&Default::default());
        let s = loft.encode_frame(device, queue, &mut encoder, target, a.size.0, a.size.1, bounds).unwrap_or_else(|e| fail(e.to_string()));
        if a.wait {
            let (output, readback, row) = copy;
            encoder.copy_texture_to_buffer(
                output.as_image_copy(),
                wgpu::TexelCopyBufferInfo { buffer: readback, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(row), rows_per_image: Some(a.size.1) } },
                output.size(),
            );
        }
        let cmd = encoder.finish();
        queue.submit([cmd]);
        cpu.push((t.elapsed() - s.gpu_wait).as_secs_f64() * 1e3);
        // Outside the timed window: resolve the timestamps and wait for the frame.
        match (&clock, loft.timestamps()) {
            (Some(c), Some(ts)) => {
                // The frame first, then the resolve: resolving in the next submit without waiting read the last two
                // passes' end-of-fragment samples before Metal had written them (the previous frame's values came back).
                device.poll(wgpu::PollType::wait_indefinitely()).expect("poll");
                let mut e = device.create_command_encoder(&Default::default());
                c.encode(&mut e, &ts.set, n);
                queue.submit([e.finish()]);
                let t = c.ticks(device);
                let ms = |a: u64, b: u64| b.wrapping_sub(a) as f64 * c.period_ns / 1e6;
                pose.push(ms(t[0], t[1]));
                let last = n as usize - 1;
                passes.push(ms(t[2], t[last]));
                gpu.push(ms(t[0], t[1]) + ms(t[2], t[last]));
            }
            _ => {
                device.poll(wgpu::PollType::wait_indefinitely()).expect("poll");
            }
        }
    }
    // The first frames include first-use costs (pipeline residency, the first bounds read): reported, not hidden.
    println!("frames {}  ({})", a.frames, if a.wait { "each waits for its own bounds" } else { "planning with the last bounds read" });
    println!("cpu  per frame  {}", stats(&mut cpu.clone()));
    println!("cpu  frames 10+ {}", stats(&mut cpu[10.min(cpu.len() - 1)..].to_vec()));
    if !gpu.is_empty() {
        println!("gpu  per frame  {}  (pose pass + render passes, as profile's normal frame)", stats(&mut gpu));
        println!("gpu  pose pass  {}", stats(&mut pose));
        println!("gpu  passes     {}", stats(&mut passes));
    }
}

fn pose_time(device: &wgpu::Device, queue: &wgpu::Queue, loft: &Loft, timing: bool) {
    if !timing {
        fail("--pose-time: the adapter grants no timestamp queries".into());
    }
    let set = device.create_query_set(&wgpu::QuerySetDescriptor { label: Some("pose time"), ty: wgpu::QueryType::Timestamp, count: 2 });
    let clock = Clock::new(device, queue, 2);
    let (repeats, rounds) = (40, 8);
    let time = |n: usize| -> f64 {
        let mut best = f64::INFINITY;
        for _ in 0..n {
            let mut e = device.create_command_encoder(&Default::default());
            {
                let mut pass = e.begin_compute_pass(&wgpu::ComputePassDescriptor {
                    label: Some("pose x repeats"),
                    timestamp_writes: Some(wgpu::ComputePassTimestampWrites { query_set: &set, beginning_of_pass_write_index: Some(0), end_of_pass_write_index: Some(1) }),
                });
                for _ in 0..repeats {
                    loft.encode_pose(&mut pass);
                }
            }
            clock.encode(&mut e, &set, 2);
            queue.submit([e.finish()]);
            let t = clock.ticks(device);
            best = best.min(t[1].wrapping_sub(t[0]) as f64 * clock.period_ns / 1e6 / repeats as f64);
        }
        best
    };
    time(4); // warm-up, as pose_time.ts
    println!("pose stages {:.3} ms GPU (least of {rounds} rounds of {repeats} repeats in one pass)", time(rounds));
}
