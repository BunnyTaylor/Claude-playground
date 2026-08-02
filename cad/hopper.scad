// hopper.scad — refillable bulk hopper with a funnel floor + lid (brief §4/§8).
//
// Sits above the scoop window of disc_housing.scad. Funnels loose pills down toward
// the disc so a pocket passing under the opening scoops exactly one. Removable for
// refilling ("dump your pills in"); windowed wall so remaining pills are visible.
include <params.scad>

hopper_id      = 42;                 // internal width at the top (bulk volume)
hopper_h       = 55;                 // straight-wall height
funnel_h       = 26;                 // funnel taper height
mouth_d        = round_pocket_d*1.7; // funnel exit ≈ scoop window over the disc
hopper_wall    = wall;

module hopper_body() {
  difference() {
    union() {
      // straight bulk section
      translate([0,0,funnel_h])
        cylinder(h = hopper_h, d = hopper_id + 2*hopper_wall);
      // funnel section
      cylinder(h = funnel_h, d1 = mouth_d + 2*hopper_wall,
                              d2 = hopper_id + 2*hopper_wall);
    }
    // hollow interior
    union() {
      translate([0,0,funnel_h])
        cylinder(h = hopper_h + 0.1, d = hopper_id);
      translate([0,0,-0.1])
        cylinder(h = funnel_h + 0.2, d1 = mouth_d, d2 = hopper_id);
    }
    // viewing window (windowed wall — pair with firmware low-pill count)
    translate([0,0,funnel_h + hopper_h*0.45])
      rotate([90,0,0])
        translate([0,0, (hopper_id/2)])
          cube([hopper_id*0.5, hopper_h*0.4, hopper_wall*3], center = true);
  }
}

module hopper_lid() {
  // Simple friction lid; keeps pills clean/dry. Add a lock feature here if the
  // safety review calls for a locking lid (brief §10).
  lid_d = hopper_id + 2*hopper_wall;
  union() {
    cylinder(h = hopper_wall, d = lid_d + 2);
    translate([0,0,-3]) cylinder(h = 3.1, d = hopper_id - 0.6); // plug
  }
}

// Render the hopper. Uncomment the lid to see/print it separately.
hopper_body();
// translate([hopper_id + 20, 0, 0]) hopper_lid();

echo(str("hopper_id=", hopper_id, "  mouth_d=", mouth_d));
