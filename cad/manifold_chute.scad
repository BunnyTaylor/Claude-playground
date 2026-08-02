// manifold_chute.scad — merges all N bins' drop-holes into one chute → shared cup
// (brief §8: manifold_chute.scad).
//
// Parametric in the number of bins. Each bin's disc_housing drops a pill into its
// own inlet; the manifold funnels every inlet into one common outlet over the cup.
include <params.scad>

bin_count    = 4;                 // set to your build's bin count (4–6)
bin_pitch    = disc_d + 12;       // centre-to-centre spacing of bin modules
inlet_d      = drop_hole_d + 3;   // catch cone under each housing drop-hole
outlet_d     = 26;                // final chute mouth over the cup
manifold_h   = 40;                // vertical drop height for merge
mwall        = wall;

// Bins are laid in a row; the outlet sits under the row centre.
row_len   = (bin_count - 1) * bin_pitch;
outlet_x  = row_len / 2;

module inlet_funnel(x) {
  // Cone from each bin's drop-hole down toward the common outlet.
  translate([x, 0, 0])
    difference() {
      cylinder(h = manifold_h, d1 = inlet_d + 2*mwall, d2 = outlet_d/2 + 2*mwall);
      translate([0,0,-0.1])
        cylinder(h = manifold_h + 0.2, d1 = inlet_d, d2 = outlet_d/2);
    }
}

module merged_outlet() {
  translate([outlet_x, 0, -manifold_h*0.6])
    difference() {
      cylinder(h = manifold_h*0.6 + 0.1, d1 = outlet_d + 2*mwall, d2 = outlet_d*0.8 + 2*mwall);
      translate([0,0,-0.1])
        cylinder(h = manifold_h*0.6 + 0.3, d1 = outlet_d, d2 = outlet_d*0.8);
    }
}

module manifold_chute() {
  union() {
    for (i = [0 : bin_count - 1]) inlet_funnel(i * bin_pitch);
    merged_outlet();
    // NOTE: the top faces of adjacent inlet funnels should overlap into a single
    // sloped trough so no pill can land on a wall between inlets. With real bin
    // spacing this is done by hulling neighbouring inlet mouths — added in Phase D
    // once bin_pitch is fixed by the printed frame.
  }
}

manifold_chute();

echo(str("bin_count=", bin_count, "  bin_pitch=", bin_pitch,
         "  row_len=", row_len, "  outlet_x=", outlet_x));
