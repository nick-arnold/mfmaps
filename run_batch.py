#!/usr/bin/env python3
"""National SSURGO -> soil pmtiles, batched & streaming.
Per area: download -> attributes -> enrich geometry -> append to batch seq ->
DELETE raw immediately. Per batch: tile -> ship to Spaces. Raw never persists.
Resumable: a batch whose pmtiles already exists locally is skipped.
Needs ssurgo_fetch.py and build_ssurgo.py in the same folder.
  python3 run_batch.py plan US         # areas / batch count
  python3 run_batch.py test            # 3 OR areas, full path incl. ship
  python3 run_batch.py run US 500      # the nation, 500 per batch
  python3 run_batch.py run OR 500      # one state
  python3 run_batch.py assemble        # tile-join batches -> soils_US.pmtiles
"""
import sys, os, json, glob, shutil, subprocess
import ssurgo_fetch as fetch
import build_ssurgo as build

SPACES = "s3://mfmaps-tiles/soils"
WORK = os.path.expanduser("~/ssurgo_work")
TILE = ["-l", "soils", "-Z9", "-z13",
        "--detect-shared-borders",
        "--simplification=4",
        "--coalesce-densest-as-needed", "--extend-zooms-if-still-dropping",
        "--no-tiny-polygon-reduction",
        "--force"]

def all_areas(scope):
    where = "areasymbol != 'US'"
    if scope and scope.upper() != "US":
        where += " AND areasymbol LIKE '%s%%'" % scope.upper()
    rows = fetch.sda_query("SELECT areasymbol FROM sacatalog WHERE %s "
                           "ORDER BY areasymbol" % where)
    return [r["areasymbol"] for r in rows]

def chunks(xs, n):
    for i in range(0, len(xs), n):
        yield i // n, xs[i:i + n]

NOTCOM_PATH = os.path.join(os.path.dirname(__file__), 'notcom.geojsonseq')

def enrich(area_dir, area, seq_fh, notcom_fh=None):
    tab = os.path.join(area_dir, "tabular")
    attrs = build.build_attrs(tab, build.load_mstab(tab), build.load_schema(tab))
    shp = glob.glob(os.path.join(area_dir, "spatial", "soilmu_a_*.shp"))
    if not shp: return 0, 0
    geom = "/tmp/%s_geom.geojsonseq" % area
    subprocess.run(["ogr2ogr", "-f", "GeoJSONSeq", "-t_srs", "EPSG:4326",
                    geom, shp[0], "-select", "MUKEY"], check=True)
    n = m = 0
    with open(geom) as fi:
        for line in fi:
            if not line.strip(): continue
            feat = json.loads(line); n += 1
            a = attrs.get(str(feat.get("properties", {}).get("MUKEY", "")))
            if a: m += 1
            props = a or {"series": None}
            if props.get("series") == "NOTCOM":
                if notcom_fh is not None:
                    notcom_fh.write(json.dumps({"type":"Feature","geometry":feat["geometry"],"properties":{}}) + "\n")
                continue
            feat["properties"] = props
            seq_fh.write(json.dumps(feat) + "\n")
    os.remove(geom)
    return n, m

def do_batch(bid, areas):
    out = "soils_batch_%03d.pmtiles" % bid
    if os.path.exists(out):
        print("batch %03d already built (%s) - skip" % (bid, out)); return
    os.makedirs(WORK, exist_ok=True)
    seq = "/tmp/batch_%03d.geojsonseq" % bid
    ncf = open(NOTCOM_PATH, "a")   # accumulate NOTCOM across all batches
    with open(seq, "w") as fh:
        for area in areas:
            try:
                fetch.download([area], WORK)
            except Exception as e:
                print("  dl FAIL %s: %s" % (area, e)); continue
            adir = os.path.join(WORK, area)
            if not os.path.isdir(adir):
                print("  %s: no data (skipped)" % area); continue
            try:
                n, mm = enrich(adir, area, fh, ncf)
                print("  %s: %d polys (%d matched)" % (area, n, mm))
            except Exception as e:
                print("  build FAIL %s: %s" % (area, e))
            shutil.rmtree(adir, ignore_errors=True)
    ncf.close()
    if os.path.getsize(seq) == 0:
        print(f"  batch {bid:03d}: EMPTY (upstream throttle?) — skipping, will retry next run")
        os.remove(seq)
        return
    subprocess.run(["tippecanoe", "-o", out, *TILE, seq], check=True)
    os.remove(seq)
    try:
        subprocess.run(["s3cmd", "put", out, "%s/%s" % (SPACES, out),
                        "--acl-public", "--mime-type=application/octet-stream"], check=True)
        print("  shipped %s" % out)
    except Exception as e:
        print("  ship FAIL (kept local) %s: %s" % (out, e))

def assemble():
    parts = sorted(glob.glob("soils_batch_*.pmtiles"))
    if not parts: sys.exit("no soils_batch_*.pmtiles to assemble")
    print("joining %d batches -> soils_US.pmtiles" % len(parts))
    subprocess.run(["tile-join", "-o", "soils_US.pmtiles", "-pk",
                    "--no-tile-size-limit", *parts], check=True)
    subprocess.run(["s3cmd", "put", "soils_US.pmtiles", "%s/soils_US.pmtiles" % SPACES,
                    "--acl-public", "--mime-type=application/octet-stream"], check=True)
    print("shipped soils_US.pmtiles")

if __name__ == "__main__":
    a = sys.argv[1:]
    mode = a[0] if a else "plan"
    if mode == "assemble":
        assemble(); raise SystemExit
    if mode == "test":
        do_batch(999, ["OR601", "OR638", "OR657"]); raise SystemExit
    scope = a[1] if len(a) > 1 else "US"
    size = int(a[2]) if len(a) > 2 else 500
    areas = all_areas(scope)
    batches = list(chunks(areas, size))
    print("scope=%s  areas=%d  batches=%d (size %d)" % (scope, len(areas), len(batches), size))
    if mode == "plan":
        raise SystemExit
    for bid, chunk in batches:
        print("=== batch %03d (%d areas) ===" % (bid, len(chunk)))
        do_batch(bid, chunk)
    print("all batches done. next:  python3 run_batch.py assemble")
