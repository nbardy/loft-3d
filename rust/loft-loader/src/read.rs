//! Reading an artefact directory (docs/artefact_format.md, "Load, call by call" steps 1 and 2), and the loader's errors.

use crate::manifest::{Header, Manifest, TableFill, FORMAT, VERSION};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Everything that can refuse a load or a frame, each naming what it refuses.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{path}: {source}")]
    Io { path: PathBuf, source: std::io::Error },
    #[error("{path}: manifest does not parse: {source}")]
    Manifest { path: PathBuf, source: serde_json::Error },
    #[error("{0}: not a Loft artefact (format \"{1}\")")]
    NotLoft(PathBuf, String),
    #[error("{0}: artefact format version {1}; this loader reads version {VERSION}")]
    Version(PathBuf, u32),
    #[error("{path}: bin/{name}.bin has {got} bytes; the manifest says {want}")]
    BlobLength { path: PathBuf, name: String, got: usize, want: usize },
    #[error("artefact: {0} table(s) are filled by JavaScript, which a file cannot hold: {1}")]
    CpuTables(usize, String),
    #[error("artefact: {what} names {kind} {id}, which the manifest lacks")]
    BadId { what: String, kind: &'static str, id: usize },
    #[error("artefact: buffer \"{0}\" starts from blob \"{1}\", which the manifest lacks")]
    MissingBlob(String, String),
    #[error("artefact: {0}")]
    Invalid(String),
    #[error("artefact: pass \"{0}\" clears without a {1}")]
    ClearWithoutValue(String, &'static str),
    #[error("{what}:\n{message}")]
    Gpu { what: String, message: String },
    #[error("view {kind} \"{name}\": the artefact declares no such {kind}")]
    UnknownName { kind: &'static str, name: String },
    #[error("view input \"{name}\": expected {want} floats, got {got}")]
    InputFloats { name: String, want: usize, got: usize },
    #[error("view input \"time\": set the time instead")]
    TimeInput,
    #[error("camera: {0}")]
    Camera(String),
    #[error("view: size must be positive, got {0} x {1}")]
    Size(u32, u32),
    #[error("set_curves: got {0} floats; the artefact has {1}")]
    Curves(usize, usize),
    #[error("bounds read-back failed: {0}")]
    Map(String),
}

/// A manifest with the texts and bytes it names: what `loft build` writes.
pub struct Artefact {
    pub manifest: Manifest,
    /// `chunks[i]` is the text of `manifest.chunks[i]`.
    pub chunks: Vec<String>,
    pub blobs: HashMap<String, Vec<u8>>,
}

fn read(path: PathBuf) -> Result<Vec<u8>, Error> {
    std::fs::read(&path).map_err(|source| Error::Io { path, source })
}

/// Reads a built directory. Refuses another format or version, a short blob, and any `cpu` table, by name.
pub fn read_dir(dir: &Path) -> Result<Artefact, Error> {
    let path = dir.join("manifest.json");
    let bytes = read(path.clone())?;
    let header: Header =
        serde_json::from_slice(&bytes).map_err(|source| Error::Manifest { path: path.clone(), source })?;
    if header.format != FORMAT {
        return Err(Error::NotLoft(dir.into(), header.format));
    }
    if header.version != VERSION {
        return Err(Error::Version(dir.into(), header.version));
    }
    let manifest: Manifest = serde_json::from_slice(&bytes).map_err(|source| Error::Manifest { path, source })?;
    let cpu: Vec<String> = manifest
        .tables
        .iter()
        .filter_map(|t| match &t.fill {
            TableFill::Map | TableFill::Scan => None,
            TableFill::Cpu { why } => Some(format!("\"{}\" ({why})", t.name)),
        })
        .collect();
    if !cpu.is_empty() {
        return Err(Error::CpuTables(cpu.len(), cpu.join(", ")));
    }
    let chunks = manifest
        .chunks
        .iter()
        .map(|name| {
            let p = dir.join("wgsl").join(format!("{name}.wgsl"));
            String::from_utf8(read(p.clone())?).map_err(|e| Error::Io {
                path: p,
                source: std::io::Error::new(std::io::ErrorKind::InvalidData, e),
            })
        })
        .collect::<Result<_, _>>()?;
    let mut blobs = HashMap::new();
    for b in &manifest.blobs {
        let p = dir.join("bin").join(format!("{}.bin", b.name));
        let data = read(p.clone())?;
        if data.len() != b.bytes {
            return Err(Error::BlobLength { path: p, name: b.name.clone(), got: data.len(), want: b.bytes });
        }
        blobs.insert(b.name.clone(), data);
    }
    Ok(Artefact { manifest, chunks, blobs })
}
