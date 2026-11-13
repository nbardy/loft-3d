//! The manifest (docs/artefact_format.md; normative types `src/host/manifest.ts`), classified once into Rust types.
//!
//! Every WebGPU enum the format names is an enum of ours with its WebGPU spelling, converted to wgpu by one exhaustive
//! `match`. (wgpu-types' own serde forms are wgpu's serialization, not WebGPU's, and change between wgpu versions.) An
//! unknown variant is a serde error naming it; fields a loader may ignore (`stats`, `dynamic`, table placement) are not
//! read. Every reference between lists is an index (`Id`).

use serde::Deserialize;
use std::collections::BTreeMap;

pub const FORMAT: &str = "loft-artefact";
pub const VERSION: u32 = 1;

pub type Id = usize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub format: String,
    pub version: u32,
    pub chunks: Vec<String>,
    pub blobs: Vec<Blob>,
    pub inputs: Vec<InputSlot>,
    pub input_floats: usize,
    pub params: Vec<ParamSlot>,
    pub param_floats: usize,
    pub cameras: BTreeMap<String, Camera>,
    pub curves: Curves,
    pub buffers: Vec<BufferDesc>,
    pub textures: Vec<TextureDesc>,
    pub samplers: Vec<SamplerDesc>,
    pub bind_group_layouts: Vec<BindGroupLayoutDesc>,
    pub pipeline_layouts: Vec<PipelineLayoutDesc>,
    pub modules: Vec<ModuleDesc>,
    pub compute_pipelines: Vec<ComputePipelineDesc>,
    pub render_pipelines: Vec<RenderPipelineDesc>,
    pub bind_groups: Vec<BindGroupDesc>,
    pub frame: Frame,
    pub plan: Vec<PlanDraw>,
    pub tables: Vec<TableEntry>,
}

/// Read before the rest, so another format or version is refused by name rather than as a parse error.
#[derive(Deserialize)]
pub struct Header {
    pub format: String,
    pub version: u32,
}

#[derive(Debug, Deserialize)]
pub struct Blob {
    pub name: String,
    pub bytes: usize,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum NumTy {
    F32,
    Vec2,
    Vec3,
    Vec4,
}
impl NumTy {
    pub fn floats(self) -> usize {
        match self {
            NumTy::F32 => 1,
            NumTy::Vec2 => 2,
            NumTy::Vec3 => 3,
            NumTy::Vec4 => 4,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct InputSlot {
    pub name: String,
    pub ty: NumTy,
    pub slot: usize,
    pub def: Vec<f32>,
}

#[derive(Debug, Deserialize)]
pub struct ParamSlot {
    pub name: String,
    pub slot: usize,
    pub def: f32,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Camera {
    #[serde(rename_all = "camelCase")]
    Perspective { eye: [f64; 3], target: [f64; 3], fov_y: f64 },
    Orthographic { eye: [f64; 3], target: [f64; 3], height: f64 },
}

#[derive(Debug, Deserialize)]
pub struct Curves {
    pub buffer: Id,
    pub floats: usize,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[allow(non_camel_case_types)]
pub enum BufferUsage {
    MAP_READ,
    COPY_SRC,
    COPY_DST,
    UNIFORM,
    STORAGE,
}

#[derive(Debug, Deserialize)]
pub struct BufferDesc {
    pub label: String,
    pub size: u64,
    pub usage: Vec<BufferUsage>,
    pub init: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[allow(non_camel_case_types)]
pub enum TextureUsage {
    COPY_SRC,
    TEXTURE_BINDING,
    RENDER_ATTACHMENT,
}

/// A texture format by its WebGPU name: every core, uncompressed format (the ones a device has without features).
/// (The first loader listed only the three formats version-1 files used, and refused the sea's `r8unorm` by name.)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Format(wgpu::TextureFormat);

const FORMATS: &[(&str, wgpu::TextureFormat)] = {
    use wgpu::TextureFormat as F;
    &[
        ("r8unorm", F::R8Unorm), ("r8snorm", F::R8Snorm), ("r8uint", F::R8Uint), ("r8sint", F::R8Sint),
        ("r16uint", F::R16Uint), ("r16sint", F::R16Sint), ("r16float", F::R16Float),
        ("rg8unorm", F::Rg8Unorm), ("rg8snorm", F::Rg8Snorm), ("rg8uint", F::Rg8Uint), ("rg8sint", F::Rg8Sint),
        ("r32uint", F::R32Uint), ("r32sint", F::R32Sint), ("r32float", F::R32Float),
        ("rg16uint", F::Rg16Uint), ("rg16sint", F::Rg16Sint), ("rg16float", F::Rg16Float),
        ("rgba8unorm", F::Rgba8Unorm), ("rgba8unorm-srgb", F::Rgba8UnormSrgb), ("rgba8snorm", F::Rgba8Snorm),
        ("rgba8uint", F::Rgba8Uint), ("rgba8sint", F::Rgba8Sint), ("bgra8unorm", F::Bgra8Unorm),
        ("bgra8unorm-srgb", F::Bgra8UnormSrgb), ("rgb10a2uint", F::Rgb10a2Uint), ("rgb10a2unorm", F::Rgb10a2Unorm),
        ("rg11b10ufloat", F::Rg11b10Ufloat), ("rgb9e5ufloat", F::Rgb9e5Ufloat),
        ("rg32uint", F::Rg32Uint), ("rg32sint", F::Rg32Sint), ("rg32float", F::Rg32Float),
        ("rgba16uint", F::Rgba16Uint), ("rgba16sint", F::Rgba16Sint), ("rgba16float", F::Rgba16Float),
        ("rgba32uint", F::Rgba32Uint), ("rgba32sint", F::Rgba32Sint), ("rgba32float", F::Rgba32Float),
        ("stencil8", F::Stencil8), ("depth16unorm", F::Depth16Unorm), ("depth24plus", F::Depth24Plus),
        ("depth24plus-stencil8", F::Depth24PlusStencil8), ("depth32float", F::Depth32Float),
    ]
};

impl<'de> Deserialize<'de> for Format {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let name = String::deserialize(d)?;
        FORMATS.iter().find(|(n, _)| *n == name).map(|&(_, f)| Format(f)).ok_or_else(|| {
            serde::de::Error::custom(format!("unknown texture format `{name}` (a loader without features reads the core uncompressed formats)"))
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextureDesc {
    pub label: String,
    pub format: Format,
    pub sample_count: u32,
    pub usage: Vec<TextureUsage>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Filter {
    Nearest,
    Linear,
}
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Address {
    ClampToEdge,
    Repeat,
    MirrorRepeat,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SamplerDesc {
    pub label: String,
    pub mag_filter: Filter,
    pub min_filter: Filter,
    pub address_mode_u: Address,
    pub address_mode_v: Address,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[allow(clippy::upper_case_acronyms)]
pub enum Stage {
    VERTEX,
    FRAGMENT,
    COMPUTE,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BufferBinding {
    Uniform,
    Storage,
    ReadOnlyStorage,
}
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SampleType {
    Float,
    UnfilterableFloat,
    Depth,
}
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ViewDimension {
    #[serde(rename = "2d")]
    D2,
}
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SamplerBinding {
    Filtering,
    NonFiltering,
}

/// One of `buffer`, `texture`, `sampler`: serde's untagged matching on which key is present.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LayoutResource {
    Buffer {
        #[serde(rename = "type")]
        ty: BufferBinding,
    },
    #[serde(rename_all = "camelCase")]
    Texture { sample_type: SampleType, view_dimension: ViewDimension, multisampled: bool },
    Sampler {
        #[serde(rename = "type")]
        ty: SamplerBinding,
    },
}

#[derive(Debug, Deserialize)]
pub struct LayoutEntry {
    pub binding: u32,
    pub visibility: Vec<Stage>,
    #[serde(flatten)]
    pub resource: LayoutResource,
}

#[derive(Debug, Deserialize)]
pub struct BindGroupLayoutDesc {
    pub label: String,
    pub entries: Vec<LayoutEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineLayoutDesc {
    pub label: String,
    pub bind_group_layouts: Vec<Id>,
}

#[derive(Debug, Deserialize)]
pub struct ModuleDesc {
    pub label: String,
    pub chunks: Vec<Id>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputePipelineDesc {
    pub label: String,
    pub layout: Id,
    pub module: Id,
    pub entry_point: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageDesc {
    pub module: Id,
    pub entry_point: String,
    pub constants: BTreeMap<String, f64>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BlendFactor {
    Zero,
    One,
    Src,
    OneMinusSrc,
    SrcAlpha,
    OneMinusSrcAlpha,
    Dst,
    OneMinusDst,
    DstAlpha,
    OneMinusDstAlpha,
}
#[derive(Debug, Clone, Copy, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum BlendOperation {
    /// WebGPU's default for an absent `operation`.
    #[default]
    Add,
    Subtract,
    ReverseSubtract,
    Min,
    Max,
}
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlendComponent {
    pub src_factor: BlendFactor,
    pub dst_factor: BlendFactor,
    #[serde(default)]
    pub operation: BlendOperation,
}
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct BlendState {
    pub color: BlendComponent,
    pub alpha: BlendComponent,
}
#[derive(Debug, Deserialize)]
pub struct ColorTarget {
    pub format: Format,
    pub blend: Option<BlendState>,
}

#[derive(Debug, Deserialize)]
pub struct FragmentDesc {
    #[serde(flatten)]
    pub stage: StageDesc,
    pub targets: Vec<ColorTarget>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Topology {
    TriangleList,
}
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FrontFace {
    Ccw,
    Cw,
}
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CullMode {
    None,
    Front,
    Back,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Primitive {
    pub topology: Topology,
    pub front_face: FrontFace,
    pub cull_mode: CullMode,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Compare {
    Never,
    Less,
    Equal,
    LessEqual,
    Greater,
    NotEqual,
    GreaterEqual,
    Always,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DepthStencil {
    pub format: Format,
    pub depth_write_enabled: bool,
    pub depth_compare: Compare,
}
#[derive(Debug, Deserialize)]
pub struct Multisample {
    pub count: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderPipelineDesc {
    pub label: String,
    pub layout: Id,
    pub vertex: StageDesc,
    pub fragment: FragmentDesc,
    pub primitive: Primitive,
    pub depth_stencil: Option<DepthStencil>,
    pub multisample: Multisample,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GroupResource {
    Buffer(Id),
    Texture(Id),
    Sampler(Id),
}
#[derive(Debug, Deserialize)]
pub struct BindGroupEntry {
    pub binding: u32,
    #[serde(flatten)]
    pub resource: GroupResource,
}
#[derive(Debug, Deserialize)]
pub struct BindGroupDesc {
    pub label: String,
    pub layout: Id,
    pub entries: Vec<BindGroupEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FrameWrite {
    Frame { buffer: Id },
    Inputs { buffer: Id },
    Params { buffer: Id },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Dispatch {
    pub label: String,
    pub pipeline: Id,
    pub bind_groups: Vec<Id>,
    pub workgroups: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GridCopy {
    pub slot: usize,
    pub from: Id,
    pub from_offset: u64,
    pub at: usize,
    pub instances: usize,
}
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BoundsRead {
    None,
    Read { buffer: Id, grids: Vec<GridCopy> },
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Target {
    Texture { texture: Id },
    Output,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LoadOp {
    Load,
    Clear,
}
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum StoreOp {
    Store,
    Discard,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorAttachment {
    pub view: Target,
    pub resolve_target: Option<Target>,
    pub load_op: LoadOp,
    pub store_op: StoreOp,
    pub clear_value: Option<[f64; 4]>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DepthAttachment {
    pub view: Id,
    pub depth_load_op: LoadOp,
    pub depth_store_op: StoreOp,
    pub depth_clear_value: Option<f32>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DrawCommand {
    Fixed { pipeline: Id, vertices: u32, instances: u32 },
    Planned { pipeline: Id, draw: usize },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderPassDesc {
    pub label: String,
    pub color: ColorAttachment,
    pub depth: Option<DepthAttachment>,
    pub bind_groups: Vec<Id>,
    pub commands: Vec<DrawCommand>,
}

#[derive(Debug, Deserialize)]
pub struct DetailWrite {
    pub buffer: Id,
    pub floats: usize,
}

#[derive(Debug, Deserialize)]
pub struct Frame {
    pub writes: Vec<FrameWrite>,
    pub pose: Vec<Dispatch>,
    pub bounds: BoundsRead,
    pub detail: DetailWrite,
    pub passes: Vec<RenderPassDesc>,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Layer {
    Scene,
    Construction,
}

#[derive(Debug, Deserialize)]
pub struct Level {
    pub cells: [f32; 2],
    pub vertices: u32,
    pub cell: f64,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Detail {
    Fixed,
    Grid { slot: usize, radius: f64, levels: Vec<Level> },
    Projected { slot: usize, cell: f64, plane: f64, reach: f64, lift: f64 },
}

#[derive(Debug, Deserialize)]
pub struct PlanDraw {
    pub label: String,
    pub layer: Layer,
    pub vertices: u32,
    pub instances: u32,
    pub detail: Detail,
}

/// Only how a table is filled is read: a `cpu` fill is JavaScript and refused by name.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TableFill {
    Map,
    Scan,
    Cpu { why: String },
}
#[derive(Debug, Deserialize)]
pub struct TableEntry {
    pub name: String,
    pub fill: TableFill,
}

// ---- to wgpu: one exhaustive match per kind ----------------------------------------------------------------------

impl Format {
    pub fn wgpu(self) -> wgpu::TextureFormat {
        self.0
    }
}

pub fn buffer_usage(u: &[BufferUsage]) -> wgpu::BufferUsages {
    u.iter().fold(wgpu::BufferUsages::empty(), |n, u| {
        n | match u {
            BufferUsage::MAP_READ => wgpu::BufferUsages::MAP_READ,
            BufferUsage::COPY_SRC => wgpu::BufferUsages::COPY_SRC,
            BufferUsage::COPY_DST => wgpu::BufferUsages::COPY_DST,
            BufferUsage::UNIFORM => wgpu::BufferUsages::UNIFORM,
            BufferUsage::STORAGE => wgpu::BufferUsages::STORAGE,
        }
    })
}

pub fn texture_usage(u: &[TextureUsage]) -> wgpu::TextureUsages {
    u.iter().fold(wgpu::TextureUsages::empty(), |n, u| {
        n | match u {
            TextureUsage::COPY_SRC => wgpu::TextureUsages::COPY_SRC,
            TextureUsage::TEXTURE_BINDING => wgpu::TextureUsages::TEXTURE_BINDING,
            TextureUsage::RENDER_ATTACHMENT => wgpu::TextureUsages::RENDER_ATTACHMENT,
        }
    })
}

pub fn visibility(v: &[Stage]) -> wgpu::ShaderStages {
    v.iter().fold(wgpu::ShaderStages::empty(), |n, s| {
        n | match s {
            Stage::VERTEX => wgpu::ShaderStages::VERTEX,
            Stage::FRAGMENT => wgpu::ShaderStages::FRAGMENT,
            Stage::COMPUTE => wgpu::ShaderStages::COMPUTE,
        }
    })
}

impl Filter {
    pub fn wgpu(self) -> wgpu::FilterMode {
        match self {
            Filter::Nearest => wgpu::FilterMode::Nearest,
            Filter::Linear => wgpu::FilterMode::Linear,
        }
    }
}
impl Address {
    pub fn wgpu(self) -> wgpu::AddressMode {
        match self {
            Address::ClampToEdge => wgpu::AddressMode::ClampToEdge,
            Address::Repeat => wgpu::AddressMode::Repeat,
            Address::MirrorRepeat => wgpu::AddressMode::MirrorRepeat,
        }
    }
}

impl LayoutResource {
    pub fn wgpu(&self) -> wgpu::BindingType {
        match *self {
            LayoutResource::Buffer { ty } => wgpu::BindingType::Buffer {
                ty: match ty {
                    BufferBinding::Uniform => wgpu::BufferBindingType::Uniform,
                    BufferBinding::Storage => wgpu::BufferBindingType::Storage { read_only: false },
                    BufferBinding::ReadOnlyStorage => wgpu::BufferBindingType::Storage { read_only: true },
                },
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            LayoutResource::Texture { sample_type, view_dimension, multisampled } => wgpu::BindingType::Texture {
                sample_type: match sample_type {
                    SampleType::Float => wgpu::TextureSampleType::Float { filterable: true },
                    SampleType::UnfilterableFloat => wgpu::TextureSampleType::Float { filterable: false },
                    SampleType::Depth => wgpu::TextureSampleType::Depth,
                },
                view_dimension: match view_dimension {
                    ViewDimension::D2 => wgpu::TextureViewDimension::D2,
                },
                multisampled,
            },
            LayoutResource::Sampler { ty } => wgpu::BindingType::Sampler(match ty {
                SamplerBinding::Filtering => wgpu::SamplerBindingType::Filtering,
                SamplerBinding::NonFiltering => wgpu::SamplerBindingType::NonFiltering,
            }),
        }
    }
}

impl BlendFactor {
    fn wgpu(self) -> wgpu::BlendFactor {
        match self {
            BlendFactor::Zero => wgpu::BlendFactor::Zero,
            BlendFactor::One => wgpu::BlendFactor::One,
            BlendFactor::Src => wgpu::BlendFactor::Src,
            BlendFactor::OneMinusSrc => wgpu::BlendFactor::OneMinusSrc,
            BlendFactor::SrcAlpha => wgpu::BlendFactor::SrcAlpha,
            BlendFactor::OneMinusSrcAlpha => wgpu::BlendFactor::OneMinusSrcAlpha,
            BlendFactor::Dst => wgpu::BlendFactor::Dst,
            BlendFactor::OneMinusDst => wgpu::BlendFactor::OneMinusDst,
            BlendFactor::DstAlpha => wgpu::BlendFactor::DstAlpha,
            BlendFactor::OneMinusDstAlpha => wgpu::BlendFactor::OneMinusDstAlpha,
        }
    }
}
impl BlendComponent {
    fn wgpu(self) -> wgpu::BlendComponent {
        wgpu::BlendComponent {
            src_factor: self.src_factor.wgpu(),
            dst_factor: self.dst_factor.wgpu(),
            operation: match self.operation {
                BlendOperation::Add => wgpu::BlendOperation::Add,
                BlendOperation::Subtract => wgpu::BlendOperation::Subtract,
                BlendOperation::ReverseSubtract => wgpu::BlendOperation::ReverseSubtract,
                BlendOperation::Min => wgpu::BlendOperation::Min,
                BlendOperation::Max => wgpu::BlendOperation::Max,
            },
        }
    }
}
impl BlendState {
    pub fn wgpu(self) -> wgpu::BlendState {
        wgpu::BlendState { color: self.color.wgpu(), alpha: self.alpha.wgpu() }
    }
}

impl Primitive {
    pub fn wgpu(&self) -> wgpu::PrimitiveState {
        wgpu::PrimitiveState {
            topology: match self.topology {
                Topology::TriangleList => wgpu::PrimitiveTopology::TriangleList,
            },
            front_face: match self.front_face {
                FrontFace::Ccw => wgpu::FrontFace::Ccw,
                FrontFace::Cw => wgpu::FrontFace::Cw,
            },
            cull_mode: match self.cull_mode {
                CullMode::None => None,
                CullMode::Front => Some(wgpu::Face::Front),
                CullMode::Back => Some(wgpu::Face::Back),
            },
            ..Default::default()
        }
    }
}

impl Compare {
    pub fn wgpu(self) -> wgpu::CompareFunction {
        match self {
            Compare::Never => wgpu::CompareFunction::Never,
            Compare::Less => wgpu::CompareFunction::Less,
            Compare::Equal => wgpu::CompareFunction::Equal,
            Compare::LessEqual => wgpu::CompareFunction::LessEqual,
            Compare::Greater => wgpu::CompareFunction::Greater,
            Compare::NotEqual => wgpu::CompareFunction::NotEqual,
            Compare::GreaterEqual => wgpu::CompareFunction::GreaterEqual,
            Compare::Always => wgpu::CompareFunction::Always,
        }
    }
}

impl StoreOp {
    pub fn wgpu(self) -> wgpu::StoreOp {
        match self {
            StoreOp::Store => wgpu::StoreOp::Store,
            StoreOp::Discard => wgpu::StoreOp::Discard,
        }
    }
}
