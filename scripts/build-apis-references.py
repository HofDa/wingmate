"""Build an attributed, colony-separated Apis landmark collection offline."""
import csv
import hashlib
import io
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "models" / "apis-source"

def parse_csv(content):
    return list(csv.DictReader(io.StringIO(content.decode("utf-8-sig")), skipinitialspace=True))

def build(folder=DEST):
    record_bytes = (folder / "source-record.json").read_bytes()
    record = json.loads(record_bytes)
    if record["id"] != 18845767 or record["metadata"]["access_right"] != "open" or record["metadata"]["license"]["id"] != "odc-odbl":
        raise ValueError("Unexpected source identity/access/licence")
    files = sorted((f for f in record["files"] if f["key"].endswith(".csv")), key=lambda f: f["key"])
    if len(files) != 20:
        raise ValueError("Unexpected source inventory")
    content, checksums = {}, {}
    for item in files:
        name = item["key"]
        if Path(name).name != name:
            raise ValueError("Unsafe source filename")
        raw = (folder / "originals" / name).read_bytes()
        if len(raw) != item["size"] or "md5:" + hashlib.md5(raw).hexdigest() != item["checksum"]:
            raise ValueError("Source checksum mismatch: " + name)
        content[name] = raw
        checksums[name] = hashlib.sha256(raw).hexdigest()
    colonies, seen, counts, unmatched = {}, set(), {}, []
    for name in sorted(n for n in content if n.endswith("-raw-coordinates.csv")):
        metadata = parse_csv(content[name.replace("-raw-coordinates.csv", "-data.csv")])
        by_file = {r["file"]: r for r in metadata}
        if len(by_file) != len(metadata):
            raise ValueError("Duplicate metadata wing identity")
        rows = parse_csv(content[name])
        expected = ["file"] + [axis + str(i) for i in range(1, 20) for axis in ("x", "y")]
        if not rows or list(rows[0]) != expected:
            raise ValueError("Unexpected landmark columns")
        raw_ids = {r["file"] for r in rows}
        missing = sorted(raw_ids - set(by_file))
        extra = sorted(set(by_file) - raw_ids)
        # Two publisher DE filenames differ by an _0 suffix. Keep originals
        # unchanged and exclude these wings; do not guess a join correction.
        if missing or extra:
            if name != "DE-raw-coordinates.csv" or missing != ["DE-0003-14.dw.png", "DE-0003-4.dw.png"] or extra != ["DE-0003-14_0.dw.png", "DE-0003-4_0.dw.png"]:
                raise ValueError("Unexpected unmatched source identities")
            unmatched.append({"file": name, "landmarksOnly": missing, "metadataOnly": extra})
        for row in rows:
            wing = row["file"]
            if wing in seen:
                raise ValueError("Duplicate wing identity")
            seen.add(wing)
            counts[wing[:2]] = counts.get(wing[:2], 0) + 1
            if wing not in by_file:
                continue
            colony = by_file[wing]["sample"].strip()
            country = wing[:2]
            if not colony.startswith(country + "-") or not wing.startswith(colony + "-"):
                raise ValueError("Missing or inconsistent country-qualified colony")
            coordinates = [int(row[key]) for key in expected[1:]]
            if any(v < 0 for v in coordinates):
                raise ValueError("Invalid raw coordinate")
            entry = {"id": wing, "species": "Apis mellifera", "country": country,
                     "colony": colony, "splitGroup": colony, "landmarks": coordinates}
            # Stable single representative prevents colony replication from
            # overwhelming training. This is not a representative prevalence sample.
            rank = hashlib.sha256(("wingmate-apis-v1:" + wing).encode()).hexdigest()
            if colony not in colonies or rank < colonies[colony][0]:
                colonies[colony] = (rank, entry)
    if len(seen) != 29043 or len(colonies) != 1342 or len(counts) != 10:
        raise ValueError("Unexpected source population")
    citation = "; ".join(c["name"] for c in record["metadata"]["creators"]) + ". (2026). Fore wings of honey bees (Apis mellifera) from northwestern Europe (v2). Zenodo. https://doi.org/10.5281/zenodo.18845767"
    attribution = {"citation": citation, "sourceUrl": record["doi_url"], "license": "ODbL-1.0",
                   "licenseUrl": "https://opendatacommons.org/licenses/odbl/1-0/",
                   "notice": "Contains information from the Machlowska et al. honeybee wing database under ODbL 1.0. This adapted numeric database is also available under ODbL 1.0.",
                   "sourceSha256": checksums,
                   "sourceRecordSha256": hashlib.sha256(record_bytes).hexdigest(),
                   "alterations": "Join metadata by exact wing filename; exclude two unmatched DE wings (see excludedJoins); preserve original coordinates and species; select one wing per country-qualified colony by smallest SHA-256 of wingmate-apis-v1:<filename>. No subspecies, worker pairing or coordinate homology is inferred.",
                   "recipe": "scripts/build-apis-references.py",
                   "databaseUrl": "https://hofda.github.io/wingmate/models/apis-source/references.json"}
    return {"format": "wingmate-published-landmarks-1", "attribution": attribution,
            "landmarkScheme": "apis-nawrocka-2018-19", "coordinateSystem": "original pixels, origin lower-left, y-up",
            "status": "reference-collection; not an installable classifier or app feature export",
            "sourceWings": len(seen), "sourceColonies": len(colonies), "wingsByCountry": counts, "excludedJoins": unmatched,
            "references": [colonies[key][1] for key in sorted(colonies)]}

if __name__ == "__main__":
    result = build()
    (DEST / "references.json").write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps({k: result[k] for k in ("sourceWings", "sourceColonies", "wingsByCountry")}, indent=2))
