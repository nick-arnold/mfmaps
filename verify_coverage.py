#!/usr/bin/env python3
"""Prove soils_US.pmtiles covers every SSURGO survey area.
Extracts areasymbols present in the tileset (decoded at z9 — every area has a
polygon there) and set-diffs against SDA's authoritative sacatalog list.
Prints the exact missing areasymbols (empty = provably complete)."""
import subprocess, re, sys, json, urllib.request

SDA = "https://sdmdataaccess.nrcs.usda.gov/Tabular/post.rest"

def sda_all_areas():
    body = json.dumps({"format":"JSON+COLUMNNAME",
                       "query":"SELECT areasymbol FROM sacatalog WHERE areasymbol != 'US'"}).encode()
    req = urllib.request.Request(SDA, data=body, headers={"Content-Type":"application/json"})
    rows = json.load(urllib.request.urlopen(req, timeout=90)).get("Table", [])
    return {r[0] for r in rows[1:]}

def present_in_tiles(pmtiles, z=9):
    # decode the whole zoom level; grep areasymbols. (z9 = coarse, every area present, fast-ish)
    p = subprocess.Popen(["tippecanoe-decode", pmtiles, str(z)],
                         stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    found = set()
    for line in p.stdout:
        found.update(re.findall(r'"areasymbol"\s*:\s*"([^"]+)"', line))
    p.wait()
    return found

if __name__ == "__main__":
    pm = sys.argv[1] if len(sys.argv) > 1 else "soils_US.pmtiles"
    print("fetching authoritative area list from SDA…")
    expected = sda_all_areas()
    print(f"  {len(expected)} survey areas expected")
    print(f"extracting areasymbols present in {pm} (z9 decode)…")
    present = present_in_tiles(pm)
    print(f"  {len(present)} areas present in tileset")
    missing = sorted(expected - present)
    print(f"\nMISSING: {len(missing)}")
    if missing:
        print(" ".join(missing))
        open("missing_areas.txt","w").write("\n".join(missing) + "\n")
        print("\n-> written to missing_areas.txt")
    else:
        print("NONE — tileset is provably complete.")
