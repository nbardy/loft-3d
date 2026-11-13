// A lighthouse searches the bay: its lit band sweeps an arc of water round the rock and stops on a boat, every nine
// seconds. A game reads it as an attack: the arc is marked on the water before the band arrives (the telegraph), the
// band arms when it reaches the boat, and the checks below say the warning came first and the band stopped short.
// Shows: `attack` with a `sweep` motion, `animate`, `telegraph`, and `warned`, `landsInside`, `stopsAt`, `staysClear`.
// Ground: a calm sea (the bay is its own water: nothing to change when floors arrive).
//
// Theory, before running. A sweep swings the end of a spine round the arc's centre from `from` to `to`: a beam's lit
// footprint is exactly that, with the tower at the centre and the whole band swept (`root: 0`). Predicted fits: the
// hit shape, the telegraph, the schedule (`every`), the four checks. Predicted fights: the sweep is a mix between the
// rest spine and the swept posture (`mix(rest, swept, p)`), so on the way back the band cuts across the arc's chord and
// shrinks instead of turning back; and the motion is the attack's (a wind-up, a strike that lands at the arming time),
// so a beam that keeps turning, hitting each place as it passes, is not an attack this module can state.
// Predicted numbers: the warning (3.9 s) covers the first movement (windup 1.0 + strike 2.2 = 3.2 s);
// the band lands 0.1 or less from the boat's disc.
//
// Scored. `attack` with a sweep, `telegraph`, `every`, `warned`, `landsInside`, `stopsAt` and `staysClear` fit, with one
// fight in `attack`: the sweep joins its swept stretch to the rest posture over 0.08 of m after `root` even when
// `root` is 0, so the band's inner end was a chord inside the arc and `landsInside` failed it (2.9% outside). Opened:
// with `root` 0 the whole spine is swept. Two things are parameters, not fights: `travel` (a tail whips; a beam is
// rigid: 1000), and the strike lands at its peak at zero speed, so a band that lands on contact touches for the last
// frames (it lands 0.02 short). Not fixed, as predicted: on the way back the band is a linear mix of the swept and
// rest postures, so it shrinks across the chord (frame at t = 6.2) instead of turning back; and a beam that keeps turning,
// hitting each place as it passes, is not one attack. Warning 3.9 s against 3.2 s of movement, as predicted.
import { atan2, cos, every, lift, mix, mul, place, rigid, scene, sea, sin, strand, sub, toon, vec3, type F, type P3 } from "../../src/index.ts";
import { animate, attack, hit, part, telegraph, type Target } from "../../src/spacetime/index.ts";
import { landsInside, staysClear, stopsAt, warned } from "../../src/check.ts";

const BAY = sea({ swell: [] }); // the bay's water
const TOWER = 8, ARC = { inner: 2.6, outer: 12.5, from: 0.25 }, BAND = { half: 0.35, inset: 0.45, height: 0.05 };
const BOAT = { bearing: 1.95, range: 9, radius: 0.9 };
const boatAt = [BOAT.range * Math.cos(BOAT.bearing), BOAT.range * Math.sin(BOAT.bearing)] as const;
const boat: Target = { kind: "disc", centre: lift<"vec2">(boatAt), radius: lift<"f32">(BOAT.radius) };

const search = attack({
  name: "search", arm: every(9, 4.2), warn: 3.9, target: boat, part: "band",
  // The band stops with its edge 0.02 short of the boat: its centre line `inset / range` short of `to`, its edge `half`
  // further. (Landing on contact, it touched for the last frames: the strike lands at its peak, at zero speed.)
  motion: { kind: "sweep", hit: hit.arc({ centre: [0, 0], ...ARC, to: BOAT.bearing - (BOAT.radius + BAND.half - BAND.inset + 0.02) / BOAT.range }), root: 0, height: BAND.height, inset: BAND.inset },
  // `travel`: how fast the motion runs along the body. A tail whips (2.2 a second); a beam is rigid, all of it at once.
  timing: { windup: 1.0, strike: 2.2, hold: 1.2, recover: 0.5, travel: 1000 },
});
// The rest posture: the band lying along the arc's first edge (the sweep's own posture at q = 0).
const rest = (m: F): P3 => {
  const rho = mix(ARC.inner + BAND.inset, ARC.outer - BAND.inset, m), a = ARC.from + BAND.inset / 7;
  return vec3(mul(rho, Math.cos(a)), BAND.height, mul(rho, Math.sin(a)));
};
const lit = animate(rest, [search], (spine) => {
  const band = strand({ name: "band", spine, stations: 16, girth: BAND.half, section: { aspect: 0.15 }, tips: ["round", "round"], paint: [1.0, 0.93, 0.6], detail: { along: 40, around: 10 } });
  return { things: [band], parts: { band: part("band", band, { tip: 1 }) } };
});

// ---- the light: a lamp housing turned toward the band's middle, on a striped tower on a rock --------------------------------
const mid = lit.spine(lift<"f32">(0.5)), facing = atan2(mid.z, mid.x);
const lamp = place(strand({ name: "lamp", spine: (m) => vec3(mul(sub(m, 0.3), 1.1), 0, 0), stations: 4, girth: 0.45, tips: ["round", "open"], paint: [1, 0.95, 0.7], detail: { along: 8, around: 16 } }),
  rigid({ o: vec3(0, TOWER + 0.5, 0), x: vec3(cos(facing), 0, sin(facing)), y: vec3(0, 1, 0), z: vec3(mul(sin(facing), -1), 0, cos(facing)) }));
const tower = strand({
  name: "tower", spine: (m) => vec3(0, mul(m, TOWER), 0), stations: 8, girth: (m) => mix(0.95, 0.55, m), tips: ["open", "open"],
  paint: (m) => mix(vec3(0.95, 0.94, 0.9), vec3(0.8, 0.12, 0.1), mul(sin(mul(m, Math.PI * 4)), sin(mul(m, Math.PI * 4)))), detail: { along: 24, around: 20 },
});
const rock = strand({ name: "rock", spine: (m) => vec3(mul(sub(m, 0.5), 3.2), -0.4, 0), stations: 6, girth: 1.6, section: { aspect: 0.5, squareness: 2.6 }, tips: [{ round: 0.5 }, { round: 0.5 }], paint: [0.35, 0.33, 0.3], detail: { along: 16, around: 16 } });
const hull = place(strand({ name: "skiff", spine: (m) => vec3(mul(sub(m, 0.5), 2.2), 0.1, 0), stations: 8, girth: (m) => mul(sin(mul(m, Math.PI)), 0.55), section: { aspect: 0.5 }, tips: ["point", "round"], paint: [0.3, 0.2, 0.12], detail: { along: 20, around: 12 } }),
  rigid({ o: vec3(boatAt[0], 0, boatAt[1]), x: vec3(1, 0, 0), y: vec3(0, 1, 0), z: vec3(0, 0, 1) }));

export default scene({
  ground: BAY, things: [rock, tower, lamp, hull, ...lit.things, telegraph(search)],
  style: toon({ bands: 3, outline: 0.03 }), sun: [0.4, 0.7, -0.5], period: 9,
  cameras: { game: { kind: "perspective", eye: [13, 27, -11], target: [1.5, 0, 6], fovY: 0.62 } },
});

const band = lit.strikes.search!;
export const checks = [
  warned(search),
  landsInside(band),
  stopsAt(band, boat, { contact: 0.1 }),
  // With zeta 0.9 the band crept onto the boat and touched it 0.2 s early: the strike's peak is a flat top. At the
  // default 0.5 it arrives at speed, on the arming time.
  staysClear(band.part, boat, { until: search.arming, label: "the band does not touch the boat before it arms" }),
];
