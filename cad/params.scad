// params.scad — shared parametric variables for the singulation module.
//
// EVERYTHING pill-specific lives here so a new pill regenerates every part
// (brief §4: "parametric pocket dimensions exposed as top-level variables").
// Measure your real pill with calipers, edit the four PILL numbers, re-render.
//
// Units: millimetres. Coordinate convention: disc lies in the XY plane, rotates
// about +Z; pills fall in -Z into the chute.

// ─────────────────────────────────────────────────────────────────────────────
// PILL (measure these)
// ─────────────────────────────────────────────────────────────────────────────
pill_shape     = "round";  // "round" (tablet) | "oblong" (capsule)
pill_diameter  = 9.0;      // round: tablet diameter
pill_thickness = 4.0;      // round: tablet height  (== oblong: capsule diameter)
pill_length    = 15.0;     // oblong: capsule length (ignored when round)
pill_width     = 7.0;      // oblong: capsule width  (ignored when round)

// ─────────────────────────────────────────────────────────────────────────────
// POCKET (derived from the pill + clearances — tune the clearances per pill)
// ─────────────────────────────────────────────────────────────────────────────
pocket_side_clear = 0.6;   // added around the pill so it drops in freely (not tight)
pocket_chamfer    = 0.8;   // chamfer at the pocket mouth so pills self-seat (anti-jam)

// Pocket depth ≈ ONE pill thickness so a second pill can't stack + ride along
// (brief §4). The disc thickness equals the pocket depth (pockets are through the
// disc; the housing floor holds the pill until it reaches the drop-hole).
pocket_depth      = pill_thickness + 0.6;   // small clearance over pill height

// Round pocket bore / oblong pocket footprint (computed, but overridable):
round_pocket_d    = pill_diameter + 2*pocket_side_clear;
oblong_pocket_l   = pill_length   + 2*pocket_side_clear;
oblong_pocket_w   = pill_width    + 2*pocket_side_clear;

// ─────────────────────────────────────────────────────────────────────────────
// DISC
// ─────────────────────────────────────────────────────────────────────────────
pocket_count   = 6;        // pockets evenly spaced around the disc
disc_edge_wall = 3.0;      // material between a pocket and the disc rim
disc_hub_d     = 14.0;     // solid central hub diameter (around the shaft)
disc_thickness = pocket_depth;               // see note above

// Radius of the circle the pocket CENTRES sit on. Derived so neighbouring pockets
// don't overlap and there's wall to the rim. Max pocket footprint radius:
pocket_reach   = (pill_shape == "oblong")
                    ? max(oblong_pocket_l, oblong_pocket_w)/2
                    : round_pocket_d/2;
pocket_ring_r  = max(disc_hub_d/2 + pocket_reach + 1,
                     // keep arc gap between pockets ≥ their footprint:
                     (pocket_reach + 1) / sin(180/pocket_count));
disc_d         = 2*(pocket_ring_r + pocket_reach + disc_edge_wall);

// ─────────────────────────────────────────────────────────────────────────────
// SHAFT / ACTUATOR COUPLING
// ─────────────────────────────────────────────────────────────────────────────
// "servo" = press onto an SG90 horn; "dshaft" = 5 mm D-shaft (stepper/motor).
shaft_type     = "servo";
dshaft_d       = 5.0;      // 28BYJ-48 / motor D-shaft nominal
dshaft_flat    = 3.0;      // flat-to-round chord for the D
servo_horn_d   = 8.0;      // recess dia for a round servo horn to sit in
servo_horn_h   = 2.0;      // horn thickness recess

// ─────────────────────────────────────────────────────────────────────────────
// HOUSING / CHUTE
// ─────────────────────────────────────────────────────────────────────────────
disc_clear     = 0.4;      // radial gap disc↔housing so it spins freely
floor_thick    = 2.0;      // housing floor under the disc
wiper_gap      = pill_thickness + 0.4;  // scraper lip height above disc face
drop_hole_d    = round_pocket_d + 2;    // clearance hole in floor at drop station
sensor_slot_w  = 6.0;      // slot for the IR emitter/receiver across the chute
wall           = 2.4;      // general printed wall thickness

// Rendering smoothness
$fn = 64;
