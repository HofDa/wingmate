#!/usr/bin/env bash
# Collision check: every listed pair of assembled parts must not overlap.
set -uo pipefail
cd "$(dirname "$0")"
OPENSCAD=${OPENSCAD:-openscad}
fail=0
for pair in base:stage base:carrier base:diffuser stage:carrier stage:diffuser stage:tower stage:slide \
            carrier:slide carrier:tower carrier:diffuser tower:deck tower:ring deck:ring deck:leg ring:slide; do
  a=${pair%%:*}; b=${pair##*:}
  out=$("$OPENSCAD" "$@" -D 'part="check"' -D "check_a=\"$a\"" -D "check_b=\"$b\"" -o /tmp/wingmate-check.stl wingmate-rig.scad 2>&1)
  # Empty, or zero volume (faces that merely touch, e.g. stacked parts) is fine.
  if grep -q "Current top level object is empty" <<<"$out"; then echo "ok        $a / $b"; continue; fi
  read -r vol bbox <<<"$(python3 stlvol.py /tmp/wingmate-check.stl)"
  if python3 -c "import sys; sys.exit(0 if float('$vol') < 0.01 else 1)"; then echo "contact   $a / $b"
  else echo "OVERLAP   $a / $b  ($vol mm³ at $bbox)"; fail=1; fi
done
exit $fail
