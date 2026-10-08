// Wingmate rig – 3D-printable smartphone imaging box for bee forewings.
//
// Stack (bottom to top): base (LED light box) -> stage (slide drawer channel,
// diffuser pocket) -> tower (dark chamber; height = working distance) ->
// [spacer frames] -> deck (phone plate with camera window, stop slots, leg).
// Two drawers: "carrier" (window, transmitted light = venation) and
// "carrier_wip" (solid black, flock recess = wing interference patterns).
// "ring" is an experimental WIP light ring hung under the deck.
//
// Coordinates: x = long axis (drawer slides in from +x), y = depth, z = up,
// origin at the centre of the base underside. Units: mm.
// Render one part:  openscad -D 'part="base"' -o base.stl wingmate-rig.scad
// All parts:        rig/build.sh

/* [Part] */
part = "assembly"; // [assembly, exploded, section, base, stage, carrier, carrier_wip, tower, spacer, deck, leg, stop, knob, ring, diffuser]

/* [Optics – measure your phone] */
// Lens-to-wing distance. iPhone macro (ultra-wide) focuses from ~20 mm; closer = more
// pixels on the wing. Increase with spacer frames if the phone does not focus.
working_distance = 25;
// How far the camera bump protrudes from the phone back.
camera_bump = 4.5;
// Camera window in the deck (must clear the whole camera bump).
window_size = [46, 46];

// Spacer frames (5 mm each) between tower and deck add to the working distance
// without reprinting the tower. Reprint the leg after changing this.
spacer_count = 0; // [0:4]

/* [Phone deck] */
// Deck extends beyond the box on the -x side so the phone body is supported.
deck_extension = 100;
deck_thickness = 6;
// Support leg under the far end of the deck.
with_leg = true;

/* [Box] */
outer = [110, 86];
wall = 3.0;
base_height = 30;
floor_thickness = 2;
stage_thickness = 10;
corner_radius = 4;

/* [Slide and diffuser] */
// ISO 8037 slide 76 x 26 x 1 mm (US slides 75 x 25 also fit).
slide = [76, 26, 1.0];
// Diffuser strip, slid into the stage from the -x side (2 mm opal acrylic or printed).
diffuser = [87, 30, 2.0];
// Light window under the slide (stage and transmitted-light carrier). As large as the
// slide allows: the ultra-wide camera sees far more than the slide at 25 mm.
light_window = [70, 22];
led_strip_width = 8;

/* [Fit] */
tol = 0.25;       // clearance per side for sliding / stacking fits
lip_w = 1.4;      // stacking lip width (inner part of the wall top)
lip_h = 2.0;
$fn = 48;

// ---------- derived ----------
W = outer[0];
D = outer[1];
stage_z = base_height;                       // stage bottom
stage_top = stage_z + stage_thickness;       // = tower bottom
channel_depth = 3.2;
carrier_t = 3.0;
carrier_w = 34;                              // drawer width (y)
channel_w = carrier_w + 2 * tol;
carrier_stop_x = -47;                        // drawer left end when fully inserted
slide_top = stage_top - channel_depth + carrier_t - 1.1 + slide[2]; // slide pocket 1.1 deep
wing_z = slide_top + 0.17;                   // cover slip
tower_height = working_distance + camera_bump + wing_z - stage_top - deck_thickness;
spacer_height = 5;
tower_top = stage_top + tower_height;
deck_z = tower_top + spacer_count * spacer_height;   // deck underside
effective_working_distance = working_distance + spacer_count * spacer_height;
deck_x0 = -W / 2 - deck_extension;
assert(tower_height > 12, "Arbeitsabstand zu klein für diesen Aufbau");

// ---------- helpers ----------
module rounded(size, r = corner_radius) {
  // size = [x, y, z], centred in x/y, z from 0
  linear_extrude(size[2])
    offset(r) square([size[0] - 2 * r, size[1] - 2 * r], center = true);
}
module lip() {
  // Stacking lip on top of a part: inner half of the wall.
  difference() {
    rounded([W - 2 * (wall - lip_w), D - 2 * (wall - lip_w), lip_h], corner_radius - (wall - lip_w));
    translate([0, 0, -1]) rounded([W - 2 * wall, D - 2 * wall, lip_h + 2], corner_radius - wall);
  }
}
module lip_recess() {
  // Matching groove in the underside of the part above (with clearance).
  translate([0, 0, -1]) difference() {
    rounded([W - 2 * (wall - lip_w) + 2 * tol, D - 2 * (wall - lip_w) + 2 * tol, lip_h + 0.2 + 1], corner_radius - (wall - lip_w) + tol);
    translate([0, 0, -1]) rounded([W - 2 * wall - 2 * tol, D - 2 * wall - 2 * tol, lip_h + 4], corner_radius - wall - tol);
  }
}
module frame(h) {
  // Open wall ring with outer size W x D.
  difference() {
    rounded([W, D, h]);
    translate([0, 0, -1]) rounded([W - 2 * wall, D - 2 * wall, h + 2], corner_radius - wall);
  }
}

// ---------- parts ----------
// Light box. Print in WHITE: the inside works as a reflector.
module base() {
  difference() {
    rounded([W, D, base_height]);
    translate([0, 0, floor_thickness]) rounded([W - 2 * wall, D - 2 * wall, base_height], corner_radius - wall);
    // Shallow guides for three LED strip rows (x direction).
    for (y = [-16, 0, 16])
      translate([0, y, floor_thickness - 0.3]) cube([W - 2 * wall - 8, led_strip_width + 0.4, 0.62], center = true);
    // Cable exit, back wall.
    translate([W / 2 - 20, D / 2 - wall / 2, floor_thickness + 3]) cube([10, wall + 2, 6], center = true);
  }
  translate([0, 0, base_height]) lip();
}

// Stage: diffuser pocket from below, light window, drawer channel on top.
// Print in WHITE, top side up.
module stage() {
  difference() {
    union() {
      rounded([W, D, stage_thickness]);
      translate([0, 0, stage_thickness]) difference() {
        lip();
        // Lip interrupted where the drawer passes under the tower wall.
        translate([W / 2 - wall, 0, lip_h / 2]) cube([wall * 3, channel_w + 2, lip_h + 2], center = true);
      }
    }
    lip_recess();
    // Diffuser slot, entered from the -x face; the diffuser rests on the
    // edges of the light window and ends flush with the face.
    translate([-W / 2 - 1, -(diffuser[1] / 2 + tol), lip_h + 0.4]) cube([diffuser[0] + 1 + tol, diffuser[1] + 2 * tol, diffuser[2] + 0.4]);
    translate([-W / 2, 0, lip_h + 0.4 + diffuser[2] / 2]) cylinder(r = 7, h = diffuser[2] + 0.4 + 2, center = true); // finger notch
    // Light window.
    cube([light_window[0], light_window[1], 3 * stage_thickness], center = true);
    // Drawer channel, open to +x, closed at the stop.
    // (extends 1 mm upwards so the floor lies exactly at channel_depth)
    translate([(carrier_stop_x - 0.2 + W / 2 + 1) / 2, 0, stage_thickness - channel_depth / 2 + 0.5])
      cube([W / 2 + 1 - (carrier_stop_x - 0.2), channel_w, channel_depth + 1], center = true);
  }
}

// Drawer. wip = false: light window (venation). wip = true: solid, print BLACK,
// with a recess for adhesive black flock under the slide.
module carrier(wip = false) {
  body = W / 2 - carrier_stop_x;                  // stop to outer wall face
  pocket = [slide[0] + 2 * tol + 0.1, slide[1] + 2 * tol + 0.1, 1.1];
  difference() {
    union() {
      translate([carrier_stop_x, -carrier_w / 2, 0]) cube([body + 0.2, carrier_w, carrier_t]);
      // Handle flange: pull grip, stop against the wall, and light seal over the
      // channel opening. Starts at the drawer underside so the part prints flat.
      translate([W / 2 + 0.2, -22, 0]) cube([10, 44, 9.5]);
    }
    // Slide pocket, centred on the optical axis.
    translate([0, 0, carrier_t - pocket[2] / 2 + 0.5]) cube(pocket + [0, 0, 1], center = true);
    // Finger notches to lift the slide out.
    for (s = [-1, 1]) translate([s * (slide[0] / 2), 0, carrier_t]) cylinder(r = 6, h = 3, center = true);
    if (!wip) cube([light_window[0], light_window[1] - 2, 20], center = true);
    else translate([0, 0, carrier_t - pocket[2] - 0.4 + 0.01]) cube([60, 24, 0.8], center = true);
    // Centre marks (x and y) for aiming the camera.
    for (s = [-1, 1]) {
      translate([s * (pocket[0] / 2 + 3), 0, carrier_t]) cube([4, 0.6, 0.8], center = true);
      translate([0, s * (pocket[1] / 2 + 2.2), carrier_t]) cube([0.6, 2.4, 0.8], center = true);
    }
    // Grip ridges on the handle.
    for (z = [1.5 : 2.5 : 8]) translate([W / 2 + 10.4, 0, z]) cube([1.2, 46, 0.8], center = true);
  }
}

// Dark chamber. Print in BLACK (matte). Height follows from working_distance.
module tower(h = tower_height) {
  difference() {
    union() {
      frame(h);
      translate([0, 0, h]) lip();
    }
    lip_recess();
    // Cable notch for the ring light at the top of the back wall.
    translate([-W / 2 + 25, D / 2 - wall / 2, h - 3]) cube([8, wall + 2, 6.1], center = true);
  }
}
module spacer() { tower(spacer_height); }

// Phone deck: camera window over the optical axis, three slots for stops,
// socket for the support leg, holes for the ring light. Print BLACK, top up.
module deck() {
  len = W / 2 - deck_x0;
  difference() {
    union() {
      rounded([W, D, deck_thickness]);
      translate([deck_x0, -D / 2, 0]) hull() {
        translate([corner_radius, corner_radius, 0]) cylinder(r = corner_radius, h = deck_thickness);
        translate([corner_radius, D - corner_radius, 0]) cylinder(r = corner_radius, h = deck_thickness);
        translate([len - 1, 0, 0]) cube([1, D, deck_thickness]);
      }
    }
    lip_recess();
    // Camera window with centre notches.
    cube([window_size[0], window_size[1], 3 * deck_thickness], center = true);
    for (a = [0 : 90 : 270]) rotate(a) translate([window_size[0] / 2, 0, deck_thickness]) rotate([0, 0, 45]) cube([2.4, 2.4, 2], center = true);
    // Stop slots (M3): two across the phone (y) and one along it (x).
    for (x = [deck_x0 + 30, W / 2 - 14]) translate([x, 0, 0]) slot([3.4, D - 20]);
    translate([(deck_x0 + W / 2) / 2 - 10, -D / 2 + 6, 0]) slot([len - 60, 3.4]);
    // Leg socket.
    if (with_leg) translate([deck_x0 + 14, 0, -0.01]) cube([12 + 2 * tol, 12 + 2 * tol, 8], center = true);
    // Ring light pegs.
    for (sx = [-1, 1], sy = [-1, 1]) translate([sx * 32, sy * 32, -0.01]) cylinder(d = 3.3, h = 4);
  }
}
module slot(size) {
  linear_extrude(3 * deck_thickness, center = true) hull()
    for (s = [-1, 1]) translate(size[0] > size[1] ? [s * size[0] / 2, 0] : [0, s * size[1] / 2]) circle(d = min(size));
}

// Support leg under the far end of the deck (prints standing).
module leg() {
  union() {
    rounded([34, 34, 3], 3);
    translate([0, 0, 3]) rounded([18, 18, deck_z - 3], 2);
    translate([0, 0, deck_z]) rounded([12, 12, 3.8], 1);
  }
}

// Phone stop: slides in a deck slot, clamped with an M3 bolt from below and a knob.
module stop() {
  difference() {
    union() {
      translate([-15, -5, 0]) cube([30, 10, 5]);
      translate([-15, -5, 0]) cube([30, 2.5, 12]);          // contact face (phone edge)
    }
    cylinder(d = 3.4, h = 30, center = true);
  }
}
module knob() {
  difference() {
    cylinder(d = 16, h = 8, $fn = 24);
    translate([0, 0, -1]) cylinder(d = 3.4, h = 10);
    translate([0, 0, 8 - 2.6]) cylinder(d = 6.6, h = 3, $fn = 6);   // M3 nut trap
    for (a = [0 : 30 : 330]) rotate(a) translate([8.4, 0, 4]) cylinder(d = 2.4, h = 10, center = true, $fn = 12);
  }
}

// EXPERIMENTAL WIP light ring: square hopper hung under the deck; stick a COB
// strip on the four inclined inner faces. Light hits the wing obliquely;
// best WIP angle must be found by testing (see rig/README.md).
module ring() {
  h = 12;
  inner_top = window_size[0] + 2;
  difference() {
    translate([-38, -38, -h]) cube([76, 76, h]);
    // Hopper: wide at the bottom, window size at the top (faces lean ~45°).
    translate([0, 0, -h - 0.01]) linear_extrude(h + 0.02, scale = inner_top / (inner_top + 2 * h))
      square(inner_top + 2 * h, center = true);
    // Pegs into the deck are added below.
  }
  for (sx = [-1, 1], sy = [-1, 1]) translate([sx * 32, sy * 32, 0]) cylinder(d = 3.0, h = 3.6);
}
// Printed diffuser (alternative to 2 mm opal acrylic): print in WHITE, 100 % infill.
module diffuser_printed() { translate([0, 0, 0.9]) cube([diffuser[0] - 0.4, diffuser[1] - 0.4, 1.8], center = true); }

// ---------- views ----------
module assembly(e = 0) {
  color("white") base();
  color("whitesmoke") translate([0, 0, stage_z + e]) stage();
  color("steelblue") translate([0, 0, stage_top - channel_depth + 2 * e]) carrier();
  color("lightcyan", 0.6) translate([0, 0, slide_top - slide[2] / 2 + 2 * e]) cube([slide[0], slide[1], slide[2]], center = true);
  color("white", 0.8) translate([-W / 2 + diffuser[0] / 2 - e, 0, stage_z + lip_h + 0.4 + diffuser[2] / 2 + e]) cube(diffuser, center = true);
  color("dimgray") translate([0, 0, stage_top + 3 * e]) tower();
  for (i = [0 : spacer_count - 1]) if (spacer_count > 0) color("gray") translate([0, 0, tower_top + i * spacer_height + 4 * e]) spacer();
  color("dimgray") translate([0, 0, deck_z + 5 * e]) render() deck();
  color("gold") translate([0, 0, deck_z + 4 * e]) ring();
  if (with_leg) color("gray") translate([deck_x0 + 14, 0, 0]) leg();
  // Phone placeholder (dimensions of a typical 6.1" phone).
  color("black", 0.35) translate([-147 + 22, -36, deck_z + deck_thickness + 6 * e]) cube([147, 72, 8]);
}

// Parts in their assembled position (for collision checks: rig/check.sh).
module placed(name) {
  if (name == "base") base();
  if (name == "stage") translate([0, 0, stage_z]) stage();
  if (name == "diffuser") translate([-W / 2 + diffuser[0] / 2, 0, stage_z + lip_h + 0.4 + diffuser[2] / 2]) cube(diffuser - [0.4, 0.4, 0.2], center = true);
  if (name == "carrier") translate([0, 0, stage_top - channel_depth]) carrier();
  if (name == "slide") translate([0, 0, slide_top - slide[2] / 2]) cube([slide[0], slide[1], slide[2]], center = true);
  if (name == "tower") translate([0, 0, stage_top]) tower();
  if (name == "deck") translate([0, 0, deck_z]) deck();
  if (name == "ring") translate([0, 0, deck_z]) ring();
  if (name == "leg") translate([deck_x0 + 14, 0, 0]) leg();
}
check_a = "";
check_b = "";
if (part == "check") intersection() { placed(check_a); placed(check_b); }
else if (part == "assembly") assembly(0);
else if (part == "exploded") assembly(18);
else if (part == "section") difference() {   // cut at y = 0: light path and working distance
  assembly(0);
  translate([-400, 0, -10]) cube([800, 400, 400]);
}
else if (part == "base") base();
else if (part == "stage") stage();
else if (part == "carrier") carrier(false);
else if (part == "carrier_wip") carrier(true);
else if (part == "tower") tower();
else if (part == "spacer") spacer();
else if (part == "deck") deck();
else if (part == "leg") leg();
else if (part == "stop") stop();
else if (part == "knob") knob();
else if (part == "ring") translate([0, 0, 12]) ring();   // pegs up; inner faces lean 45°
else if (part == "diffuser") diffuser_printed();

echo(str("RIG tower_height=", tower_height, " deck_z=", deck_z, " wing_z=", wing_z, " effective_working_distance=", effective_working_distance, " total_height=", deck_z + deck_thickness));
