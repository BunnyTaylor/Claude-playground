// singulation_disc.scad — the pocket disc ("star wheel" / indexing disc).
//
// A flat disc with `pocket_count` through-pockets near the rim, each sized to hold
// EXACTLY ONE pill. As a pocket passes under the hopper it scoops one pill; the
// housing floor holds the pill in the pocket until the pocket reaches the drop-hole,
// where the pill falls into the chute. One stroke = advance one pocket = one pill.
//
// Starter variant: round tablet (set pill_shape="round" in params.scad). An oblong
// path is included for capsules. Tune params.scad, re-render, print, iterate
// (brief §4 / Phase C: target ≥200 consecutive correct single-drops before trust).
include <params.scad>

module round_pocket() {
  // Through bore for a round tablet, chamfered at the top mouth so pills self-seat.
  union() {
    cylinder(h = disc_thickness + 0.1, d = round_pocket_d, center = false);
    // top chamfer (anti-jam mouth)
    translate([0, 0, disc_thickness - pocket_chamfer])
      cylinder(h = pocket_chamfer + 0.1,
               d1 = round_pocket_d,
               d2 = round_pocket_d + 2*pocket_chamfer);
  }
}

module oblong_pocket() {
  // Capsule-shaped through slot (hull of two bores) + chamfered mouth.
  r = oblong_pocket_w/2;
  dx = (oblong_pocket_l - oblong_pocket_w)/2;
  union() {
    linear_extrude(height = disc_thickness + 0.1)
      hull() { translate([ dx,0]) circle(r=r); translate([-dx,0]) circle(r=r); }
    translate([0,0,disc_thickness - pocket_chamfer])
      linear_extrude(height = pocket_chamfer + 0.1, scale = (r+pocket_chamfer)/r)
        hull() { translate([ dx,0]) circle(r=r); translate([-dx,0]) circle(r=r); }
  }
}

module shaft_coupling() {
  if (shaft_type == "dshaft") {
    // D-shaped bore for a motor/stepper D-shaft.
    intersection() {
      cylinder(h = disc_thickness + 1, d = dshaft_d, center = true);
      translate([-(dshaft_d), -(dshaft_d), -(disc_thickness)])
        cube([2*dshaft_d, dshaft_d/2 + dshaft_flat, 2*disc_thickness]);
    }
  } else {
    // Servo: through bore + a recess on the underside for a round servo horn.
    cylinder(h = disc_thickness + 1, d = 3.2, center = true);           // horn screw
    translate([0,0,-0.1]) cylinder(h = servo_horn_h + 0.1, d = servo_horn_d);
  }
}

module singulation_disc() {
  difference() {
    // solid disc
    cylinder(h = disc_thickness, d = disc_d);

    // pockets, evenly spaced on the pocket ring
    for (i = [0 : pocket_count - 1]) {
      rotate([0, 0, i * 360 / pocket_count])
        translate([pocket_ring_r, 0, -0.05])
          if (pill_shape == "oblong") oblong_pocket(); else round_pocket();
    }

    // central shaft coupling
    translate([0, 0, 0]) shaft_coupling();
  }
}

singulation_disc();

// Handy echo so the console shows the generated geometry when you render.
echo(str("disc_d=", disc_d, "  pocket_ring_r=", pocket_ring_r,
         "  disc_thickness=", disc_thickness, "  pockets=", pocket_count));
