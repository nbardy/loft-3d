//! Camera matrices and the frame uniform (docs/artefact_format.md, "The frame uniform"; reference src/host/camera.ts).
//! f64 throughout, rounded once to f32 when written. Matrices are column-major: (row r, column c) at `c * 4 + r`.

use crate::manifest::Camera;
use crate::read::Error;

pub type Mat4 = [f64; 16];
type V3 = [f64; 3];

fn sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn dot(a: V3, b: V3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn cross(a: V3, b: V3) -> V3 {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
fn normalize(a: V3) -> V3 {
    let s = 1.0 / dot(a, a).sqrt();
    [a[0] * s, a[1] * s, a[2] * s]
}

pub struct Matrices {
    pub view_proj: Mat4,
    pub inv_view_proj: Mat4,
    pub eye: V3,
    pub forward: V3,
    /// 1 perspective, 0 orthographic (`frame.eye.w`).
    pub perspective: f64,
    pub near: f64,
}

fn multiply(a: &Mat4, b: &Mat4) -> Mat4 {
    let mut m = [0.0; 16];
    for c in 0..4 {
        for r in 0..4 {
            // From +0.0 as camera.ts does (Rust's `sum` starts at -0.0, which changes the sign of exact zeros).
            m[c * 4 + r] = (0..4).fold(0.0, |s, k| s + a[k * 4 + r] * b[c * 4 + k]);
        }
    }
    m
}

/// General inverse by cofactors, term for term as camera.ts (so both hosts round alike).
fn invert(m: &Mat4) -> Result<Mat4, Error> {
    let [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = *m;
    let (b00, b01, b02) = (a00 * a11 - a01 * a10, a00 * a12 - a02 * a10, a00 * a13 - a03 * a10);
    let (b03, b04, b05) = (a01 * a12 - a02 * a11, a01 * a13 - a03 * a11, a02 * a13 - a03 * a12);
    let (b06, b07, b08) = (a20 * a31 - a21 * a30, a20 * a32 - a22 * a30, a20 * a33 - a23 * a30);
    let (b09, b10, b11) = (a21 * a32 - a22 * a31, a21 * a33 - a23 * a31, a22 * a33 - a23 * a32);
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if !(det.abs() > 0.0) {
        return Err(Error::Camera(format!("singular view-projection (det = {det})")));
    }
    let d = 1.0 / det;
    Ok([
        (a11 * b11 - a12 * b10 + a13 * b09) * d, (a02 * b10 - a01 * b11 - a03 * b09) * d,
        (a31 * b05 - a32 * b04 + a33 * b03) * d, (a22 * b04 - a21 * b05 - a23 * b03) * d,
        (a12 * b08 - a10 * b11 - a13 * b07) * d, (a00 * b11 - a02 * b08 + a03 * b07) * d,
        (a32 * b02 - a30 * b05 - a33 * b01) * d, (a20 * b05 - a22 * b02 + a23 * b01) * d,
        (a10 * b10 - a11 * b08 + a13 * b06) * d, (a01 * b08 - a00 * b10 - a03 * b06) * d,
        (a30 * b04 - a31 * b02 + a33 * b00) * d, (a21 * b02 - a20 * b04 - a23 * b00) * d,
        (a11 * b07 - a10 * b09 - a12 * b06) * d, (a00 * b09 - a01 * b07 + a02 * b06) * d,
        (a31 * b01 - a30 * b03 - a32 * b00) * d, (a20 * b03 - a21 * b01 + a22 * b00) * d,
    ])
}

pub fn matrices(camera: &Camera, aspect: f64) -> Result<Matrices, Error> {
    let (eye, target) = match *camera {
        Camera::Perspective { eye, target, .. } | Camera::Orthographic { eye, target, .. } => (eye, target),
    };
    let distance = dot(sub(target, eye), sub(target, eye)).sqrt();
    if !(distance > 0.0) {
        return Err(Error::Camera(format!("eye and target coincide at {eye:?}")));
    }
    let (near, far) = (distance / 100.0, distance * 100.0);
    let forward = normalize(sub(target, eye));
    let reference = if forward[1].abs() > 0.999999 { [0.0, 0.0, -forward[1].signum()] } else { [0.0, 1.0, 0.0] };
    let right = normalize(cross(forward, reference));
    let up = cross(right, forward);
    let mut view = [0.0; 16];
    for (i, r) in [right, up, [-forward[0], -forward[1], -forward[2]]].into_iter().enumerate() {
        view[i] = r[0];
        view[4 + i] = r[1];
        view[8 + i] = r[2];
        view[12 + i] = -dot(r, eye);
    }
    view[15] = 1.0;
    let mut p = [0.0; 16];
    let perspective = match *camera {
        Camera::Perspective { fov_y, .. } => {
            let f = 1.0 / (fov_y / 2.0).tan();
            p[0] = f / aspect;
            p[5] = f;
            p[10] = far / (near - far);
            p[11] = -1.0;
            p[14] = near * far / (near - far);
            1.0
        }
        Camera::Orthographic { height, .. } => {
            p[0] = 2.0 / (height * aspect);
            p[5] = 2.0 / height;
            p[10] = 1.0 / (near - far);
            p[14] = near / (near - far);
            p[15] = 1.0;
            0.0
        }
    };
    let view_proj = multiply(&p, &view);
    Ok(Matrices { inv_view_proj: invert(&view_proj)?, view_proj, eye, forward, perspective, near })
}

/// The 48 floats of the prelude's `struct Frame`.
pub fn frame_uniform(m: &Matrices, width: u32, height: u32, time: f64) -> [f32; 48] {
    let mut u = [0f32; 48];
    let (w, h) = (width as f64, height as f64);
    let tail = [
        m.eye[0], m.eye[1], m.eye[2], m.perspective,
        m.forward[0], m.forward[1], m.forward[2], 0.0,
        w, h, 1.0 / w, 1.0 / h,
        time, 0.0, 0.0, 0.0,
    ];
    for (k, v) in m.view_proj.iter().chain(m.inv_view_proj.iter()).chain(tail.iter()).enumerate() {
        u[k] = *v as f32;
    }
    u
}
