// Camera maths for the host and the viewer. Plain functions over plain numbers; no library.
//
// Conventions (see src/artefact.ts): world y is up; the view looks down its own -z (right-handed); clip space is
// WebGPU's, so depth runs 0 at the near plane to 1 at the far plane and NDC y is up. Matrices are column-major
// Float64Arrays of 16, the layout WGSL's `mat4x4<f32>` expects once copied into a Float32Array.

import type { Camera } from "../artefact.ts";

export type Vec3 = readonly [number, number, number];
/** Column-major 4x4: element (row r, column c) is at index c * 4 + r. */
export type Mat4 = Float64Array;

export type CameraMatrices = {
  readonly viewProj: Mat4;
  readonly invViewProj: Mat4;
  readonly eye: Vec3;
  /** Unit direction from eye to target. */
  readonly forward: Vec3;
  /** 1 for perspective, 0 for orthographic: the `frame.eye.w` the prelude's `view_dir` mixes by. */
  readonly perspective: 0 | 1;
  readonly near: number;
  readonly far: number;
};

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const normalize = (a: Vec3): Vec3 => scale(a, 1 / Math.sqrt(dot(a, a)));

/**
 * Near and far planes from the eye-target distance. A ratio of 1e4 keeps f32 depth resolution usable at the target
 * (the scene's subject) while leaving room for a sea that runs to the horizon and a near plane a hand's width away.
 */
function depthRange(distance: number): { near: number; far: number } {
  return { near: distance / 100, far: distance * 100 };
}

/** The world-to-view matrix: rows are right, up, -forward. */
function lookAt(eye: Vec3, target: Vec3): { view: Mat4; forward: Vec3 } {
  const forward = normalize(sub(target, eye));
  // World y is up. Looking straight up or down, y cannot define the roll, so -z (screen-up = away from the viewer
  // in a top view) takes its place. Algorithmic: the same frame construction, a different reference vector.
  const ref: Vec3 = Math.abs(forward[1]) > 0.999999 ? [0, 0, -Math.sign(forward[1])] : [0, 1, 0];
  const right = normalize(cross(forward, ref));
  const up = cross(right, forward);
  const m = new Float64Array(16);
  const rows: readonly Vec3[] = [right, up, scale(forward, -1)];
  rows.forEach((r, i) => {
    m[0 * 4 + i] = r[0];
    m[1 * 4 + i] = r[1];
    m[2 * 4 + i] = r[2];
    m[3 * 4 + i] = -dot(r, eye);
  });
  m[15] = 1;
  return { view: m, forward };
}

/** Right-handed perspective to WebGPU clip space (z in [0, 1]). */
function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float64Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = far / (near - far);
  m[11] = -1;
  m[14] = (near * far) / (near - far);
  return m;
}

/** Right-handed orthographic to WebGPU clip space; `height` is the world-space height of the view. */
function orthographic(height: number, aspect: number, near: number, far: number): Mat4 {
  const m = new Float64Array(16);
  m[0] = 2 / (height * aspect);
  m[5] = 2 / height;
  m[10] = 1 / (near - far);
  m[14] = near / (near - far);
  m[15] = 1;
  return m;
}

function projection(camera: Camera, aspect: number, near: number, far: number): Mat4 {
  switch (camera.kind) {
    case "perspective": return perspective(camera.fovY, aspect, near, far);
    case "orthographic": return orthographic(camera.height, aspect, near, far);
  }
}

const PERSPECTIVE_FLAG: Record<Camera["kind"], 0 | 1> = { perspective: 1, orthographic: 0 };

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const m = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      m[c * 4 + r] = s;
    }
  }
  return m;
}

/** General 4x4 inverse by cofactors. Throws on a singular matrix (a degenerate camera). */
export function invert(m: Mat4): Mat4 {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!(Math.abs(det) > 0)) throw new Error(`invert: singular matrix (det = ${det})`);
  const d = 1 / det;
  return Float64Array.from([
    (a11 * b11 - a12 * b10 + a13 * b09) * d, (a02 * b10 - a01 * b11 - a03 * b09) * d,
    (a31 * b05 - a32 * b04 + a33 * b03) * d, (a22 * b04 - a21 * b05 - a23 * b03) * d,
    (a12 * b08 - a10 * b11 - a13 * b07) * d, (a00 * b11 - a02 * b08 + a03 * b07) * d,
    (a32 * b02 - a30 * b05 - a33 * b01) * d, (a20 * b05 - a22 * b02 + a23 * b01) * d,
    (a10 * b10 - a11 * b08 + a13 * b06) * d, (a01 * b08 - a00 * b10 - a03 * b06) * d,
    (a30 * b04 - a31 * b02 + a33 * b00) * d, (a21 * b02 - a20 * b04 - a23 * b00) * d,
    (a11 * b07 - a10 * b09 - a12 * b06) * d, (a00 * b09 - a01 * b07 + a02 * b06) * d,
    (a31 * b01 - a30 * b03 - a32 * b00) * d, (a20 * b03 - a21 * b01 + a22 * b00) * d,
  ]);
}

/** View-projection, its inverse, and the vectors the `Frame` uniform carries, for a viewport of this aspect (w / h). */
export function cameraMatrices(camera: Camera, aspect: number): CameraMatrices {
  const distance = Math.sqrt(dot(sub(camera.target, camera.eye), sub(camera.target, camera.eye)));
  if (!(distance > 0)) throw new Error(`camera: eye and target coincide at [${camera.eye.join(", ")}]`);
  const { near, far } = depthRange(distance);
  const { view, forward } = lookAt(camera.eye, camera.target);
  const viewProj = multiply(projection(camera, aspect, near, far), view);
  return { viewProj, invViewProj: invert(viewProj), eye: camera.eye, forward, perspective: PERSPECTIVE_FLAG[camera.kind], near, far };
}

/**
 * Where a world point lands in a width x height image: x right and y down from the top-left corner, in pixels
 * (pixel i covers [i, i + 1)), and its depth in [0, 1]. `w` is the clip w (positive in front of a perspective eye).
 */
export function project(m: CameraMatrices, p: Vec3, width: number, height: number): { x: number; y: number; depth: number; w: number } {
  const v = m.viewProj;
  const clip = [0, 1, 2, 3].map((r) => v[r] * p[0] + v[4 + r] * p[1] + v[8 + r] * p[2] + v[12 + r]);
  const [cx, cy, cz, cw] = clip as [number, number, number, number];
  return { x: ((cx / cw + 1) / 2) * width, y: ((1 - cy / cw) / 2) * height, depth: cz / cw, w: cw };
}

/** Pitch is held short of the poles so the orbit never flips through the up axis. */
const PITCH_LIMIT = Math.PI / 2 - 1e-3;

/**
 * Orbit the eye around the target: yaw about world y, pitch toward or away from it, and scale the distance by
 * `zoom` (> 0; < 1 moves in). An orthographic camera's apparent size is its `height`, so zoom scales that as well.
 */
export function orbit(camera: Camera, dYaw: number, dPitch: number, zoom: number): Camera {
  if (!(zoom > 0)) throw new Error(`orbit: zoom must be positive, got ${zoom}`);
  const d = sub(camera.eye, camera.target);
  const r = Math.sqrt(dot(d, d));
  const yaw = Math.atan2(d[0], d[2]) + dYaw;
  const pitch = Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, Math.asin(d[1] / r) + dPitch));
  const rr = r * zoom;
  const t = camera.target;
  const eye: Vec3 = [t[0] + rr * Math.cos(pitch) * Math.sin(yaw), t[1] + rr * Math.sin(pitch), t[2] + rr * Math.cos(pitch) * Math.cos(yaw)];
  switch (camera.kind) {
    case "perspective": return { ...camera, eye };
    case "orthographic": return { ...camera, eye, height: camera.height * zoom };
  }
}
