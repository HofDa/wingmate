"""Fetch pinned Apis numeric data only; ODbL source, no wing photographs."""
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "models" / "apis-source" / "originals"
RECORD = "https://zenodo.org/api/records/18845767"

def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Wingmate numeric-data importer"}), timeout=90) as response:
        return response.read()

def main():
    record_bytes = fetch(RECORD)
    record = json.loads(record_bytes)
    if record["id"] != 18845767 or record["metadata"]["access_right"] != "open" or record["metadata"]["license"]["id"] != "odc-odbl":
        raise ValueError("Publisher identity/access/licence requires review")
    files = sorted((f for f in record["files"] if f["key"].endswith(".csv")), key=lambda f: f["key"])
    if len(files) != 20:
        raise ValueError("Unexpected numeric file inventory")
    DEST.mkdir(parents=True, exist_ok=True)
    for item in files:
        name = item["key"]
        if Path(name).name != name or item["size"] > 10_000_000:
            raise ValueError("Unexpected numeric source path or size")
        path = DEST / name
        content = path.read_bytes() if path.exists() else fetch(item["links"]["self"])
        if len(content) != item["size"] or "md5:" + hashlib.md5(content).hexdigest() != item["checksum"]:
            raise ValueError("Source checksum mismatch: " + name)
        path.write_bytes(content)
        print(name, len(content), flush=True)
    (DEST.parent / "source-record.json").write_bytes(record_bytes)

if __name__ == "__main__":
    main()
