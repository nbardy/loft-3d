// Form finer than the curves, in a surface's own coordinates (DESIGN.md 8): height functions and stamps, sculpt layers,
// displacement, and the shell tracer `draw.relief` draws with.
export * from "./height.ts";
export { sculptLayer, sampleGrid, SculptTable } from "./sculpt.ts";
export { displace, shellFrame, type ShellFrame } from "./displace.ts";
export { firstRoot, shellModel, traceMarch, tracePlain, KIND, type MarchBudget, type ShellModel, type ShellRay, type Traced } from "./trace.ts";
