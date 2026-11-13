//! A loader of Loft artefacts (docs/artefact_format.md) on wgpu: an executor of the manifest. It creates the objects
//! the manifest lists, in order, and per frame runs its recipe; it decides nothing about the scene.
//!
//! ```ignore
//! let artefact = loft_loader::read_dir(dir)?;
//! let mut loft = loft_loader::Loft::load(&device, &queue, &artefact)?;
//! loft.set_camera(loft.camera("game")?);
//! loft.set_time(t);
//! loft.set_input("phase", &[2.0])?;
//! let stats = loft.encode_frame(&device, &queue, &mut encoder, &target_view, width, height, Bounds::Latest)?;
//! queue.submit([encoder.finish()]);
//! ```

mod camera;
pub mod manifest;
mod plan;
mod read;

pub use manifest::Camera;
pub use read::{read_dir, Artefact, Error};

use manifest::{BoundsRead, DrawCommand, FrameWrite, GroupResource, LoadOp, Manifest, Target};
use plan::{Memory, Run};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// The output format every frame ends in (the caller's target texture must be this format).
pub const OUTPUT_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;

/// Which level-of-detail bounds a frame plans with.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Bounds {
    /// This frame's: the loader waits for the pose and the read-back (headless frames, pictures).
    Latest,
    /// The last read that has completed (one or two frames old; none before the first): never waits on the GPU.
    Last,
}

/// What a frame drew, and how long the loader waited for the GPU inside the call (only `Bounds::Latest` waits).
#[derive(Debug, Clone, Copy)]
pub struct FrameStats {
    pub triangles: u64,
    pub draws: u32,
    pub gpu_wait: Duration,
}

/// Measuring only: timestamps the frame writes when the device has `TIMESTAMP_QUERY`, `2 + 2 * passes` of them: the
/// pose pass's begin and end at 0 and 1 (unwritten when there is no pose pass), render pass k's at `2 + 2k`, `3 + 2k`.
pub struct Timestamps {
    pub set: wgpu::QuerySet,
}

/// The view-sized textures and every bind group, for one size.
struct Sized {
    size: (u32, u32),
    views: Vec<wgpu::TextureView>,
    groups: Vec<wgpu::BindGroup>,
}

/// The read-back of the grids' bounds (`frame.bounds`), across frames.
enum Read {
    Idle,
    /// `map_async` issued; the callback fills the slot.
    InFlight(Arc<Mutex<Option<Result<(), wgpu::BufferAsyncError>>>>),
}

pub struct Loft {
    m: Manifest,
    buffers: Vec<wgpu::Buffer>,
    textures: Vec<wgpu::TextureDescriptor<'static>>,
    layouts: Vec<wgpu::BindGroupLayout>,
    samplers: Vec<wgpu::Sampler>,
    compute: Vec<wgpu::ComputePipeline>,
    render: Vec<wgpu::RenderPipeline>,
    fixed_groups: Vec<Option<wgpu::BindGroup>>,
    sized: Option<Sized>,
    // The view: set by the caller, written each frame.
    inputs: Vec<f32>,
    params: Vec<f32>,
    time: f64,
    camera: Option<Camera>,
    cell_pixels: f64,
    construction: bool,
    // Level of detail.
    detail: Vec<f32>,
    memory: Memory,
    plan: Vec<Vec<Run>>,
    read: Read,
    bounds_at: HashMap<usize, usize>,
    last_bounds: Option<Vec<f32>>,
    timestamps: Option<Timestamps>,
    /// Each render pass's load and store operations, classified at load.
    ops: Vec<PassOps>,
}

struct PassOps {
    color: wgpu::Operations<wgpu::Color>,
    depth: Option<wgpu::Operations<f32>>,
}

fn block<T>(f: impl std::future::Future<Output = T>) -> T {
    pollster::block_on(f)
}

/// Runs `create` inside a validation scope; an error names `what`.
fn scoped<T>(device: &wgpu::Device, what: impl FnOnce() -> String, create: impl FnOnce() -> T) -> Result<T, Error> {
    let scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
    let v = create();
    match block(scope.pop()) {
        None => Ok(v),
        Some(e) => Err(Error::Gpu { what: what(), message: e.to_string() }),
    }
}

/// `f` over `items` on up to 8 threads, results in order.
fn par_map<T: Sync, R: Send>(items: &[T], f: impl Fn(&T) -> R + Sync) -> Vec<R> {
    let threads = std::thread::available_parallelism().map_or(1, |n| n.get()).min(8);
    let next = std::sync::atomic::AtomicUsize::new(0);
    let mut out: Vec<(usize, R)> = std::thread::scope(|s| {
        let workers: Vec<_> = (0..threads)
            .map(|_| {
                s.spawn(|| {
                    let mut done = Vec::new();
                    loop {
                        let k = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        let Some(item) = items.get(k) else { return done };
                        done.push((k, f(item)));
                    }
                })
            })
            .collect();
        workers.into_iter().flat_map(|w| w.join().expect("pipeline worker panicked")).collect()
    });
    out.sort_by_key(|(k, _)| *k);
    out.into_iter().map(|(_, r)| r).collect()
}

fn constants(c: &std::collections::BTreeMap<String, f64>) -> Vec<(&str, f64)> {
    c.iter().map(|(k, v)| (k.as_str(), *v)).collect()
}

fn bytes(f: &[f32]) -> Vec<u8> {
    f.iter().flat_map(|x| x.to_le_bytes()).collect()
}

impl Loft {
    /// Creates every object the manifest lists on the caller's device (steps 3 to 11 of "Load, call by call").
    /// Shader modules and pipelines are compiled here, eagerly; a compile error names the module or pipeline.
    pub fn load(device: &wgpu::Device, queue: &wgpu::Queue, a: Artefact) -> Result<Loft, Error> {
        let Artefact { manifest, chunks, blobs } = a;
        let m = &manifest;
        let ops = check(m)?;
        let buffers: Vec<wgpu::Buffer> = m
            .buffers
            .iter()
            .map(|d| {
                let b = device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some(&d.label),
                    size: d.size,
                    usage: manifest::buffer_usage(&d.usage),
                    mapped_at_creation: false,
                });
                if let Some(name) = &d.init {
                    let blob = blobs.get(name).ok_or_else(|| Error::MissingBlob(d.label.clone(), name.clone()))?;
                    if !blob.is_empty() {
                        queue.write_buffer(&b, 0, blob);
                    }
                }
                Ok(b)
            })
            .collect::<Result<_, Error>>()?;
        let samplers = m
            .samplers
            .iter()
            .map(|s| {
                device.create_sampler(&wgpu::SamplerDescriptor {
                    label: Some(&s.label),
                    mag_filter: s.mag_filter.wgpu(),
                    min_filter: s.min_filter.wgpu(),
                    address_mode_u: s.address_mode_u.wgpu(),
                    address_mode_v: s.address_mode_v.wgpu(),
                    ..Default::default()
                })
            })
            .collect();
        let layouts: Vec<wgpu::BindGroupLayout> = m
            .bind_group_layouts
            .iter()
            .map(|l| {
                let entries: Vec<_> = l
                    .entries
                    .iter()
                    .map(|e| wgpu::BindGroupLayoutEntry {
                        binding: e.binding,
                        visibility: manifest::visibility(&e.visibility),
                        ty: e.resource.wgpu(),
                        count: None,
                    })
                    .collect();
                scoped(device, || format!("bind group layout \"{}\"", l.label), || {
                    device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor { label: Some(&l.label), entries: &entries })
                })
            })
            .collect::<Result<_, _>>()?;
        let pipeline_layouts: Vec<wgpu::PipelineLayout> = m
            .pipeline_layouts
            .iter()
            .map(|p| {
                let groups: Vec<Option<&wgpu::BindGroupLayout>> = p.bind_group_layouts.iter().map(|&i| Some(&layouts[i])).collect();
                device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                    label: Some(&p.label),
                    bind_group_layouts: &groups,
                    immediate_size: 0,
                })
            })
            .collect();
        let modules: Vec<wgpu::ShaderModule> = m
            .modules
            .iter()
            .map(|d| {
                let code: String = d.chunks.iter().map(|&c| chunks[c].as_str()).collect();
                scoped(device, || format!("{} failed to compile", d.label), || {
                    device.create_shader_module(wgpu::ShaderModuleDescriptor {
                        label: Some(&d.label),
                        source: wgpu::ShaderSource::Wgsl(code.into()),
                    })
                })
            })
            .collect::<Result<_, _>>()?;
        // Pipelines compile in parallel (Naga per stage, then Metal), as Dawn's createRenderPipelineAsync does; each
        // worker thread has its own error scope (wgpu's scopes are thread-local with its `std` feature).
        let compute = par_map(&m.compute_pipelines, |p| {
                scoped(device, || format!("pose stage \"{}\": pipeline creation failed", p.label), || {
                    device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                        label: Some(&p.label),
                        layout: Some(&pipeline_layouts[p.layout]),
                        module: &modules[p.module],
                        entry_point: Some(&p.entry_point),
                        compilation_options: Default::default(),
                        cache: None,
                    })
                })
            })
            .into_iter()
            .collect::<Result<_, _>>()?;
        let render = par_map(&m.render_pipelines, |p| {
                let (vc, fc) = (constants(&p.vertex.constants), constants(&p.fragment.stage.constants));
                let targets: Vec<Option<wgpu::ColorTargetState>> = p
                    .fragment
                    .targets
                    .iter()
                    .map(|t| {
                        Some(wgpu::ColorTargetState {
                            format: t.format.wgpu(),
                            blend: t.blend.map(|b| b.wgpu()),
                            write_mask: wgpu::ColorWrites::ALL,
                        })
                    })
                    .collect();
                scoped(device, || format!("{}: pipeline creation failed", p.label), || {
                    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                        label: Some(&p.label),
                        layout: Some(&pipeline_layouts[p.layout]),
                        vertex: wgpu::VertexState {
                            module: &modules[p.vertex.module],
                            entry_point: Some(&p.vertex.entry_point),
                            compilation_options: wgpu::PipelineCompilationOptions { constants: &vc, ..Default::default() },
                            buffers: &[],
                        },
                        fragment: Some(wgpu::FragmentState {
                            module: &modules[p.fragment.stage.module],
                            entry_point: Some(&p.fragment.stage.entry_point),
                            compilation_options: wgpu::PipelineCompilationOptions { constants: &fc, ..Default::default() },
                            targets: &targets,
                        }),
                        primitive: p.primitive.wgpu(),
                        depth_stencil: p.depth_stencil.as_ref().map(|d| wgpu::DepthStencilState {
                            format: d.format.wgpu(),
                            depth_write_enabled: Some(d.depth_write_enabled),
                            depth_compare: Some(d.depth_compare.wgpu()),
                            stencil: Default::default(),
                            bias: Default::default(),
                        }),
                        multisample: wgpu::MultisampleState { count: p.multisample.count, ..Default::default() },
                        multiview_mask: None,
                        cache: None,
                    })
                })
            })
            .into_iter()
            .collect::<Result<_, _>>()?;
        let textures = m
            .textures
            .iter()
            .map(|t| wgpu::TextureDescriptor {
                label: None,
                size: wgpu::Extent3d::default(),
                mip_level_count: 1,
                sample_count: t.sample_count,
                dimension: wgpu::TextureDimension::D2,
                format: t.format.wgpu(),
                usage: manifest::texture_usage(&t.usage),
                view_formats: &[],
            })
            .collect();
        let bounds_at = match &m.frame.bounds {
            BoundsRead::None => HashMap::new(),
            BoundsRead::Read { grids, .. } => grids.iter().map(|g| (g.slot, g.at)).collect(),
        };
        let mut loft = Loft {
            buffers,
            textures,
            layouts,
            samplers,
            compute,
            render,
            fixed_groups: Vec::new(),
            sized: None,
            inputs: vec![0.0; m.input_floats],
            params: vec![0.0; m.param_floats],
            time: 0.0,
            camera: None,
            cell_pixels: 7.0,
            construction: false,
            detail: vec![0.0; m.frame.detail.floats],
            memory: Memory::new(),
            plan: Vec::new(),
            read: Read::Idle,
            bounds_at,
            last_bounds: None,
            timestamps: None,
            ops,
            m: manifest,
        };
        for i in &loft.m.inputs {
            loft.inputs[i.slot..i.slot + i.def.len()].copy_from_slice(&i.def);
        }
        for p in &loft.m.params {
            loft.params[p.slot] = p.def;
        }
        loft.fixed_groups = (0..loft.m.bind_groups.len()).map(|k| loft.fixed_group(device, k)).collect();
        Ok(loft)
    }
}

impl Loft {
    /// A bind group from its descriptor; `views` are the view-sized textures (none for a group naming no texture).
    fn group(&self, device: &wgpu::Device, k: usize, views: &[wgpu::TextureView]) -> wgpu::BindGroup {
        let g = &self.m.bind_groups[k];
        let entries: Vec<wgpu::BindGroupEntry> = g
            .entries
            .iter()
            .map(|e| wgpu::BindGroupEntry {
                binding: e.binding,
                resource: match e.resource {
                    GroupResource::Buffer(b) => self.buffers[b].as_entire_binding(),
                    GroupResource::Texture(t) => wgpu::BindingResource::TextureView(&views[t]),
                    GroupResource::Sampler(s) => wgpu::BindingResource::Sampler(&self.samplers[s]),
                },
            })
            .collect();
        device.create_bind_group(&wgpu::BindGroupDescriptor { label: Some(&g.label), layout: &self.layouts[g.layout], entries: &entries })
    }

    /// FORMAT: whether a group is made at load or per view size is inferred from its entries (proposal in the README).
    fn fixed_group(&self, device: &wgpu::Device, k: usize) -> Option<wgpu::BindGroup> {
        let names_texture = self.m.bind_groups[k].entries.iter().any(|e| match e.resource {
            GroupResource::Texture(_) => true,
            GroupResource::Buffer(_) | GroupResource::Sampler(_) => false,
        });
        (!names_texture).then(|| self.group(device, k, &[]))
    }

    /// The view-sized textures and the groups that name them, re-created when the size changes.
    fn sized_for(&mut self, device: &wgpu::Device, size: (u32, u32)) {
        if self.sized.as_ref().is_some_and(|s| s.size == size) {
            return;
        }
        self.sized = None; // drops (destroys) the previous set
        let views: Vec<wgpu::TextureView> = self
            .textures
            .iter()
            .zip(&self.m.textures)
            .map(|(d, t)| {
                let extent = wgpu::Extent3d { width: size.0, height: size.1, depth_or_array_layers: 1 };
                device.create_texture(&wgpu::TextureDescriptor { label: Some(&t.label), size: extent, ..d.clone() }).create_view(&Default::default())
            })
            .collect();
        let groups = (0..self.m.bind_groups.len())
            .map(|k| self.fixed_groups[k].clone().unwrap_or_else(|| self.group(device, k, &views)))
            .collect();
        self.sized = Some(Sized { size, views, groups });
    }

    // ---- the view ------------------------------------------------------------------------------------------------

    /// The artefact's named cameras.
    pub fn cameras(&self) -> impl Iterator<Item = (&str, &Camera)> {
        self.m.cameras.iter().map(|(k, v)| (k.as_str(), v))
    }
    pub fn camera(&self, name: &str) -> Result<Camera, Error> {
        self.m.cameras.get(name).copied().ok_or_else(|| Error::UnknownName { kind: "camera", name: name.into() })
    }
    pub fn set_camera(&mut self, camera: Camera) {
        self.camera = Some(camera);
    }
    pub fn set_time(&mut self, seconds: f64) {
        self.time = seconds;
    }
    /// Level of detail: a grid cell's size on screen in pixels (default 7; 0 draws every grid at its finest).
    pub fn set_cell_pixels(&mut self, pixels: f64) {
        self.cell_pixels = pixels;
    }
    pub fn set_construction(&mut self, show: bool) {
        self.construction = show;
    }
    /// An input by name: as many floats as its type. Holds until set again. `time` is set by `set_time`.
    pub fn set_input(&mut self, name: &str, value: &[f32]) -> Result<(), Error> {
        if name == "time" {
            return Err(Error::TimeInput);
        }
        let i = self.m.inputs.iter().find(|i| i.name == name).ok_or_else(|| Error::UnknownName { kind: "input", name: name.into() })?;
        if value.len() != i.ty.floats() {
            return Err(Error::InputFloats { name: name.into(), want: i.ty.floats(), got: value.len() });
        }
        self.inputs[i.slot..i.slot + value.len()].copy_from_slice(value);
        Ok(())
    }
    /// A param by name. `min` and `max` are for editors: not clamped.
    pub fn set_param(&mut self, name: &str, value: f32) -> Result<(), Error> {
        let p = self.m.params.iter().find(|p| p.name == name).ok_or_else(|| Error::UnknownName { kind: "param", name: name.into() })?;
        self.params[p.slot] = value;
        Ok(())
    }
    /// Replaces the curve rows (an editor moving a curve); the length must not change.
    pub fn set_curves(&mut self, queue: &wgpu::Queue, floats: &[f32]) -> Result<(), Error> {
        if floats.len() != self.m.curves.floats {
            return Err(Error::Curves(floats.len(), self.m.curves.floats));
        }
        if !floats.is_empty() {
            queue.write_buffer(&self.buffers[self.m.curves.buffer], 0, &bytes(floats));
        }
        Ok(())
    }
    /// Measuring only: write the four `Timestamps` each frame (None stops).
    pub fn set_timestamps(&mut self, t: Option<Timestamps>) {
        self.timestamps = t;
    }
    /// The render passes' labels, in frame order (for reading `Timestamps`).
    pub fn pass_labels(&self) -> impl Iterator<Item = &str> {
        self.m.frame.passes.iter().map(|p| p.label.as_str())
    }
    pub fn timestamps(&self) -> Option<&Timestamps> {
        self.timestamps.as_ref()
    }

    // ---- a frame -------------------------------------------------------------------------------------------------

    /// Writes the frame, submits the pose pass (its own command buffer, first on the queue), plans, and records the
    /// render passes into the caller's `encoder`, ending in `target` (`OUTPUT_FORMAT`, `width` x `height`). The caller
    /// submits `encoder`. Every pass of the format clears or overwrites `target` (see the README).
    #[allow(clippy::too_many_arguments)]
    pub fn encode_frame(
        &mut self, device: &wgpu::Device, queue: &wgpu::Queue, encoder: &mut wgpu::CommandEncoder, target: &wgpu::TextureView,
        width: u32, height: u32, bounds: Bounds,
    ) -> Result<FrameStats, Error> {
        if width == 0 || height == 0 {
            return Err(Error::Size(width, height));
        }
        let camera = self.camera.ok_or_else(|| Error::Camera("no camera set".into()))?;
        let mats = camera::matrices(&camera, width as f64 / height as f64)?;
        // 1. Frame writes.
        if let Some(t) = self.m.inputs.iter().find(|i| i.name == "time") {
            self.inputs[t.slot] = self.time as f32;
        }
        for w in &self.m.frame.writes {
            let (buffer, data) = match *w {
                FrameWrite::Frame { buffer } => (buffer, bytes(&camera::frame_uniform(&mats, width, height, self.time))),
                FrameWrite::Inputs { buffer } => (buffer, bytes(&self.inputs)),
                FrameWrite::Params { buffer } => (buffer, bytes(&self.params)),
            };
            if !data.is_empty() {
                queue.write_buffer(&self.buffers[buffer], 0, &data);
            }
        }
        let mut gpu_wait = Duration::ZERO;
        // A headless frame wants this frame's bounds: an older read still in flight is finished first.
        if bounds == Bounds::Latest {
            gpu_wait += self.harvest(device, true)?;
        }
        // 2-3. Pose, and the copy of the bounds when no read is in flight.
        let copy = match (&self.m.frame.bounds, &self.read) {
            (BoundsRead::Read { .. }, Read::Idle) => true,
            (BoundsRead::Read { .. }, Read::InFlight(_)) | (BoundsRead::None, _) => false,
        };
        let mut pose = device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("loft pose") });
        if !self.m.frame.pose.is_empty() {
            let timestamp_writes = self.timestamps.as_ref().map(|t| wgpu::ComputePassTimestampWrites {
                query_set: &t.set,
                beginning_of_pass_write_index: Some(0),
                end_of_pass_write_index: Some(1),
            });
            let mut pass = pose.begin_compute_pass(&wgpu::ComputePassDescriptor { label: Some("loft pose"), timestamp_writes });
            self.encode_pose(&mut pass);
        }
        if let (true, BoundsRead::Read { buffer, grids }) = (copy, &self.m.frame.bounds) {
            for g in grids {
                pose.copy_buffer_to_buffer(&self.buffers[g.from], g.from_offset, &self.buffers[*buffer], g.at as u64 * 16, Some(g.instances as u64 * 16));
            }
        }
        queue.submit([pose.finish()]);
        if let (true, BoundsRead::Read { buffer, .. }) = (copy, &self.m.frame.bounds) {
            let slot = Arc::new(Mutex::new(None));
            let done = slot.clone();
            self.buffers[*buffer].map_async(wgpu::MapMode::Read, .., move |r| *done.lock().unwrap() = Some(r));
            self.read = Read::InFlight(slot);
        }
        // 4. Read the bounds: wait for this frame's, or take whatever has completed.
        gpu_wait += self.harvest(device, bounds == Bounds::Latest)?;
        // 5. Plan, and the level-of-detail slots.
        let read = match &self.last_bounds {
            None => plan::Bounds::None,
            Some(floats) => plan::Bounds::Read { floats, at: &self.bounds_at },
        };
        plan::plan_frame(&self.m.plan, &mats, width, height, self.cell_pixels, self.construction, &read, &mut self.memory, &mut self.detail, &mut self.plan);
        let detail = self.m.frame.detail.buffer;
        queue.write_buffer(&self.buffers[detail], 0, &bytes(&self.detail));
        // 6. Passes.
        self.sized_for(device, (width, height));
        self.encode_passes(encoder, target);
        let (mut triangles, mut draws) = (0u64, 0u32);
        for r in self.plan.iter().flatten() {
            triangles += (r.vertices / 3) as u64 * r.instances as u64;
            draws += 1;
        }
        Ok(FrameStats { triangles, draws, gpu_wait })
    }

    /// The pose dispatches, in order, into an open compute pass (the frame's state must have been written).
    pub fn encode_pose(&self, pass: &mut wgpu::ComputePass) {
        for d in &self.m.frame.pose {
            pass.set_pipeline(&self.compute[d.pipeline]);
            for (i, &g) in d.bind_groups.iter().enumerate() {
                // Pose groups name no texture (checked at load).
                pass.set_bind_group(i as u32, self.fixed_groups[g].as_ref(), &[]);
            }
            pass.dispatch_workgroups(d.workgroups, 1, 1);
        }
    }

    /// Completes the bounds read in flight: waiting for it (`wait`), or only if it is done. Returns the time waited.
    fn harvest(&mut self, device: &wgpu::Device, wait: bool) -> Result<Duration, Error> {
        let Read::InFlight(slot) = &self.read else { return Ok(Duration::ZERO) };
        let t = Instant::now();
        let poll = if wait { wgpu::PollType::wait_indefinitely() } else { wgpu::PollType::Poll };
        device.poll(poll).map_err(|e| Error::Map(e.to_string()))?;
        let waited = if wait { t.elapsed() } else { Duration::ZERO };
        let result = slot.lock().unwrap().take();
        match result {
            None => Ok(waited),
            Some(Err(e)) => Err(Error::Map(e.to_string())),
            Some(Ok(())) => {
                let BoundsRead::Read { buffer, .. } = &self.m.frame.bounds else { unreachable!("a read is only started for BoundsRead::Read") };
                let b = &self.buffers[*buffer];
                let floats = b.get_mapped_range(..).map_err(|e| Error::Map(e.to_string()))?.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
                b.unmap();
                self.last_bounds = Some(floats);
                self.read = Read::Idle;
                Ok(waited)
            }
        }
    }

    fn encode_passes(&self, encoder: &mut wgpu::CommandEncoder, target: &wgpu::TextureView) {
        let sized = self.sized.as_ref().expect("sized_for runs before encode_passes");
        let view = |t: Target| match t {
            Target::Texture { texture } => &sized.views[texture],
            Target::Output => target,
        };
        for (k, (p, ops)) in self.m.frame.passes.iter().zip(&self.ops).enumerate() {
            let timestamp_writes = self.timestamps.as_ref().map(|t| wgpu::RenderPassTimestampWrites {
                query_set: &t.set,
                beginning_of_pass_write_index: Some(2 + 2 * k as u32),
                end_of_pass_write_index: Some(3 + 2 * k as u32),
            });
            let color = wgpu::RenderPassColorAttachment {
                view: view(p.color.view),
                depth_slice: None,
                resolve_target: p.color.resolve_target.map(view),
                ops: ops.color,
            };
            let mut rp = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some(&p.label),
                color_attachments: &[Some(color)],
                depth_stencil_attachment: p.depth.as_ref().map(|d| wgpu::RenderPassDepthStencilAttachment {
                    view: &sized.views[d.view],
                    depth_ops: ops.depth,
                    stencil_ops: None,
                }),
                timestamp_writes,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            for (i, &g) in p.bind_groups.iter().enumerate() {
                rp.set_bind_group(i as u32, &sized.groups[g], &[]);
            }
            for c in &p.commands {
                match *c {
                    DrawCommand::Fixed { pipeline, vertices, instances } => {
                        rp.set_pipeline(&self.render[pipeline]);
                        rp.draw(0..vertices, 0..instances);
                    }
                    DrawCommand::Planned { pipeline, draw } => {
                        let runs = &self.plan[draw];
                        if runs.is_empty() {
                            continue;
                        }
                        rp.set_pipeline(&self.render[pipeline]);
                        for r in runs {
                            rp.draw(0..r.vertices, r.first..r.first + r.instances);
                        }
                    }
                }
            }
        }
    }
}

/// Every reference in the manifest resolves, and every pass's operations are complete; so a frame indexes freely.
fn check(m: &Manifest) -> Result<Vec<PassOps>, Error> {
    let id = |what: &str, kind: &'static str, id: usize, len: usize| {
        if id < len { Ok(()) } else { Err(Error::BadId { what: what.into(), kind, id }) }
    };
    for b in &m.bind_groups {
        id(&b.label, "bind group layout", b.layout, m.bind_group_layouts.len())?;
        for e in &b.entries {
            match e.resource {
                GroupResource::Buffer(k) => id(&b.label, "buffer", k, m.buffers.len())?,
                GroupResource::Texture(k) => id(&b.label, "texture", k, m.textures.len())?,
                GroupResource::Sampler(k) => id(&b.label, "sampler", k, m.samplers.len())?,
            }
        }
    }
    for p in &m.pipeline_layouts {
        for &l in &p.bind_group_layouts {
            id(&p.label, "bind group layout", l, m.bind_group_layouts.len())?;
        }
    }
    for d in &m.modules {
        for &c in &d.chunks {
            id(&d.label, "chunk", c, m.chunks.len())?;
        }
    }
    for p in &m.compute_pipelines {
        id(&p.label, "pipeline layout", p.layout, m.pipeline_layouts.len())?;
        id(&p.label, "module", p.module, m.modules.len())?;
    }
    for p in &m.render_pipelines {
        id(&p.label, "pipeline layout", p.layout, m.pipeline_layouts.len())?;
        id(&p.label, "module", p.vertex.module, m.modules.len())?;
        id(&p.label, "module", p.fragment.stage.module, m.modules.len())?;
    }
    id("curves", "buffer", m.curves.buffer, m.buffers.len())?;
    id("loft_detail", "buffer", m.frame.detail.buffer, m.buffers.len())?;
    for w in &m.frame.writes {
        let (FrameWrite::Frame { buffer } | FrameWrite::Inputs { buffer } | FrameWrite::Params { buffer }) = *w;
        id("frame write", "buffer", buffer, m.buffers.len())?;
    }
    for d in &m.frame.pose {
        id(&d.label, "compute pipeline", d.pipeline, m.compute_pipelines.len())?;
        for &g in &d.bind_groups {
            id(&d.label, "bind group", g, m.bind_groups.len())?;
            if m.bind_groups[g].entries.iter().any(|e| matches!(e.resource, GroupResource::Texture(_))) {
                return Err(Error::BadId { what: format!("{} (a pose group must name no texture)", d.label), kind: "bind group", id: g });
            }
        }
    }
    if let BoundsRead::Read { buffer, grids } = &m.frame.bounds {
        id("bounds", "buffer", *buffer, m.buffers.len())?;
        for g in grids {
            id("bounds", "buffer", g.from, m.buffers.len())?;
        }
    }
    let bad = |msg: String| Err(Error::Invalid(msg));
    for i in &m.inputs {
        if i.def.len() != i.ty.floats() || i.slot + i.ty.floats() > m.input_floats {
            return bad(format!("input \"{}\" at slot {} does not fit inputFloats = {}", i.name, i.slot, m.input_floats));
        }
    }
    for p in m.params.iter().filter(|p| p.slot >= m.param_floats) {
        return bad(format!("param \"{}\" at slot {} is past paramFloats = {}", p.name, p.slot, m.param_floats));
    }
    let slots = m.frame.detail.floats / 4;
    let grids: Vec<usize> = match &m.frame.bounds {
        BoundsRead::None => vec![],
        BoundsRead::Read { grids, .. } => grids.iter().map(|g| g.slot).collect(),
    };
    for d in &m.plan {
        let (end, grid) = match &d.detail {
            manifest::Detail::Fixed => (0, None),
            manifest::Detail::Grid { slot, levels, .. } if !levels.is_empty() => (slot + d.instances as usize, Some(*slot)),
            manifest::Detail::Grid { .. } => return bad(format!("draw \"{}\": a grid with no levels", d.label)),
            manifest::Detail::Projected { slot, .. } => (slot + 2, None),
        };
        if end > slots {
            return bad(format!("draw \"{}\": its slots end at {end}, past loft_detail's {slots}", d.label));
        }
        if let Some(slot) = grid.filter(|s| !grids.contains(s)) {
            return bad(format!("draw \"{}\": grid slot {slot} has no bounds copy", d.label));
        }
    }
    let target = |what: &str, t: Target| match t {
        Target::Texture { texture } => id(what, "texture", texture, m.textures.len()),
        Target::Output => Ok(()),
    };
    m.frame
        .passes
        .iter()
        .map(|p| {
            target(&p.label, p.color.view)?;
            p.color.resolve_target.map_or(Ok(()), |t| target(&p.label, t))?;
            for &g in &p.bind_groups {
                id(&p.label, "bind group", g, m.bind_groups.len())?;
            }
            for c in &p.commands {
                match *c {
                    DrawCommand::Fixed { pipeline, .. } => id(&p.label, "render pipeline", pipeline, m.render_pipelines.len())?,
                    DrawCommand::Planned { pipeline, draw } => {
                        id(&p.label, "render pipeline", pipeline, m.render_pipelines.len())?;
                        id(&p.label, "planned draw", draw, m.plan.len())?;
                    }
                }
            }
            let c = &p.color;
            let color = wgpu::Operations {
                load: match (c.load_op, c.clear_value) {
                    (LoadOp::Load, _) => wgpu::LoadOp::Load,
                    (LoadOp::Clear, Some([r, g, b, a])) => wgpu::LoadOp::Clear(wgpu::Color { r, g, b, a }),
                    (LoadOp::Clear, None) => return Err(Error::ClearWithoutValue(p.label.clone(), "clearValue")),
                },
                store: c.store_op.wgpu(),
            };
            let depth = match &p.depth {
                None => None,
                Some(d) => {
                    id(&p.label, "texture", d.view, m.textures.len())?;
                    Some(wgpu::Operations {
                        load: match (d.depth_load_op, d.depth_clear_value) {
                            (LoadOp::Load, _) => wgpu::LoadOp::Load,
                            (LoadOp::Clear, Some(v)) => wgpu::LoadOp::Clear(v),
                            (LoadOp::Clear, None) => return Err(Error::ClearWithoutValue(p.label.clone(), "depthClearValue")),
                        },
                        store: d.depth_store_op.wgpu(),
                    })
                }
            };
            Ok(PassOps { color, depth })
        })
        .collect()
}
