// The map algebra (DESIGN.md 7): signatures, warps, placement, products, tables as functions.
export * from "./types.ts";
export { carry, compose, on, place, points, posed, posedList, posesOf, shifted, size, sized, sizeLengths, turn, rotate as inFrame, world, type PointSpec, type PoseSpec, type Turn } from "./chart.ts";
export { warp, tile } from "./warp.ts";
export { tabulate, type Schedule } from "./table.ts";
export { extrude, framed, framedPose, lathe, loft, mapNormal, sheet, surface, thicken } from "./surface.ts";
export { Body, rotateAbout, stationSample, sweep, type FrameSample, type Section, type Tip, type Transport } from "./sweep.ts";
