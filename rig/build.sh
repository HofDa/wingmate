#!/usr/bin/env bash
# Exports every printable part as STL (rig/stl/) and renders previews
# (rig/img/). Usage: rig/build.sh [extra -D overrides, e.g. -D working_distance=35]
set -euo pipefail
cd "$(dirname "$0")"
OPENSCAD=${OPENSCAD:-openscad}
mkdir -p stl img
for part in base stage carrier carrier_wip tower spacer deck leg stop knob ring diffuser; do
  "$OPENSCAD" -q "$@" -D "part=\"$part\"" -o "stl/$part.stl" wingmate-rig.scad
  echo "stl/$part.stl"
done
if [[ "${PREVIEWS:-1}" == 1 ]]; then
  for view in assembly exploded; do
    "$OPENSCAD" -q "$@" -D "part=\"$view\"" --colorscheme=Tomorrow --imgsize=1600,1100 \
      --camera=-45,0,50,60,0,35,640 --projection=p -o "img/$view.png" wingmate-rig.scad
    echo "img/$view.png"
  done
  # Section seen from the front (-y), orthographic.
  "$OPENSCAD" -q "$@" -D 'part="section"' --colorscheme=Tomorrow --imgsize=1600,800 \
    --camera=-50,0,40,90,0,180,420 --projection=o -o img/section.png wingmate-rig.scad
  echo img/section.png
fi
