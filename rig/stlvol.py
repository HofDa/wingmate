"""Volume and bounding box of an ASCII STL (used by check.sh)."""
import sys
tri, cur = [], []
for line in open(sys.argv[1]):
    t = line.split()
    if t and t[0] == "vertex":
        cur.append(tuple(map(float, t[1:4])))
        if len(cur) == 3:
            tri.append(cur); cur = []
vol = sum((a[0]*(b[1]*c[2]-b[2]*c[1]) - a[1]*(b[0]*c[2]-b[2]*c[0]) + a[2]*(b[0]*c[1]-b[1]*c[0])) / 6 for a, b, c in tri)
pts = [p for t in tri for p in t]
bb = [(min(p[i] for p in pts), max(p[i] for p in pts)) for i in range(3)] if pts else []
print(f"{abs(vol):.3f} " + " ".join(f"{lo:.2f}..{hi:.2f}" for lo, hi in bb))
