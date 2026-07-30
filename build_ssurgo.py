#!/usr/bin/env python3
"""Build ONE extracted SSURGO survey area into a soil pmtiles with baked
attributes (series/taxorder/taxsubgrp/drainage/dom_pct/texture/hue/components).
Tabular join is pure Python via the shipped mstab/mstabcol schema. SSURGO text
files are pipe-delimited AND double-quote-qualified, so we parse with csv."""
import sys, os, csv, json, hashlib, glob, subprocess, shutil
from collections import defaultdict

csv.field_size_limit(10**7)  # some SSURGO description fields are huge

def rows_of(path):
    with open(path, encoding="latin-1", newline="") as f:
        yield from csv.reader(f, delimiter="|", quotechar='"')

def load_schema(tabular):
    cols = defaultdict(list)
    for r in rows_of(os.path.join(tabular, "mstabcol.txt")):
        if len(r) < 3: continue
        try: seq = int(r[1])
        except ValueError: continue
        cols[r[0]].append((seq, r[2]))
    return {t: [n for _, n in sorted(c)] for t, c in cols.items()}

def load_mstab(tabular):
    f2t = {}
    for r in rows_of(os.path.join(tabular, "mstab.txt")):
        if len(r) >= 5 and r[4]:
            f2t[r[4]] = r[0]
    return f2t

def read(tabular, filebase, f2t, schema):
    real = f2t.get(filebase, filebase)
    if real not in schema and filebase in schema:
        real = filebase
    names = schema[real]; idx = {n: i for i, n in enumerate(names)}
    rows = []
    for r in rows_of(os.path.join(tabular, filebase + ".txt")):
        r = (r + [""] * len(names))[:len(names)]
        rows.append(r)
    return idx, rows

def to_int(v):
    try: return int(v)
    except (ValueError, TypeError): return None

def build_attrs(tabular, f2t, schema):
    ci, comp = read(tabular, "comp", f2t, schema)
    comps = defaultdict(list)
    for r in comp: comps[r[ci["mukey"]]].append(r)
    dom, complist = {}, {}
    for mukey, rows in comps.items():
        rows.sort(key=lambda r: (-(to_int(r[ci["comppct_r"]]) or -1), r[ci["cokey"]]))
        top = rows[0]
        dom[mukey] = dict(series=top[ci["compname"]] or None,
                          taxorder=top[ci["taxorder"]] or None,
                          taxsubgrp=top[ci["taxsubgrp"]] or None,
                          drainage=top[ci["drainagecl"]] or None,
                          dom_pct=to_int(top[ci["comppct_r"]]),
                          cokey=top[ci["cokey"]])
        complist[mukey] = [dict(series=r[ci["compname"]] or None,
                                pct=to_int(r[ci["comppct_r"]]),
                                order=r[ci["taxorder"]] or None) for r in rows]
    hi, hor = read(tabular, "chorizon", f2t, schema)
    surf = {}
    for r in hor:
        cok, ch = r[hi["cokey"]], r[hi["chkey"]]
        dep = to_int(r[hi["hzdept_r"]]);  dep = 10**9 if dep is None else dep
        cur = surf.get(cok)
        if cur is None or dep < cur[0] or (dep == cur[0] and ch < cur[1]):
            surf[cok] = (dep, ch)
    ti, tex = read(tabular, "chtexgrp", f2t, schema)
    ch_tex = {}
    for r in tex:
        if r[ti["rvindicator"]].strip().lower() == "yes":
            ch_tex.setdefault(r[ti["chkey"]], r[ti["texture"]] or None)
    cokey_tex = {cok: ch_tex.get(ch) for cok, (_, ch) in surf.items()}
    mi, mu = read(tabular, "mapunit", f2t, schema)
    mapu = {r[mi["mukey"]]: (r[mi["musym"]] or None, r[mi["muname"]] or None) for r in mu}
    attrs = {}
    for mukey, d in dom.items():
        s = d["series"]; musym, muname = mapu.get(mukey, (None, None))
        attrs[mukey] = dict(series=s, taxorder=d["taxorder"], taxsubgrp=d["taxsubgrp"],
                            drainage=d["drainage"], dom_pct=d["dom_pct"],
                            texture=cokey_tex.get(d["cokey"]),
                            hue=(int(hashlib.md5(s.encode()).hexdigest(), 16) % 360) if s else None,
                            musym=musym, muname=muname,
                            components=json.dumps(complist[mukey], separators=(",", ":")))
    return attrs

def emit_tiles(area_dir, area, attrs, have_tools):
    shp = glob.glob(os.path.join(area_dir, "spatial", "soilmu_a_*.shp"))
    if not shp: sys.exit("no soilmu_a_*.shp under " + area_dir)
    if not have_tools:
        print("\n[skip tiles] install tools then rerun:  brew install gdal tippecanoe")
        return
    seq_in, seq_out = f"/tmp/{area}_geom.geojsonseq", f"/tmp/{area}_enriched.geojsonseq"
    subprocess.run(["ogr2ogr", "-f", "GeoJSONSeq", "-t_srs", "EPSG:4326",
                    seq_in, shp[0], "-select", "MUKEY"], check=True)
    matched = total = 0
    with open(seq_in) as fi, open(seq_out, "w") as fo:
        for line in fi:
            if not line.strip(): continue
            feat = json.loads(line); total += 1
            mk = str(feat.get("properties", {}).get("MUKEY", ""))
            a = attrs.get(mk)
            if a: matched += 1
            feat["properties"] = a or {"series": None, "hue": None}
            fo.write(json.dumps(feat) + "\n")
    print(f"  polygons: {total}  matched to attrs: {matched}")
    out = f"soils_{area}.pmtiles"
    subprocess.run(["tippecanoe", "-o", out, "-l", "soils", "-Z6", "-z13",
                    "--coalesce-densest-as-needed", "--extend-zooms-if-still-dropping",
                    "-S10", "--force", seq_out], check=True)
    print("  wrote", out)

if __name__ == "__main__":
    area_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/ssurgo_test/OR657")
    area = os.path.basename(area_dir.rstrip("/"))
    tab = os.path.join(area_dir, "tabular")
    schema = load_schema(tab); f2t = load_mstab(tab)
    attrs = build_attrs(tab, f2t, schema)
    ntax = sum(1 for a in attrs.values() if a["taxorder"])
    nspod = sum(1 for a in attrs.values() if a["taxorder"] == "Spodosols")
    nand = sum(1 for a in attrs.values() if a["taxorder"] == "Andisols")
    print(f"map units: {len(attrs)}   with taxorder: {ntax}   Spodosols: {nspod}   Andisols: {nand}")
    print("sample:", json.dumps(next(iter(attrs.values())), indent=2)[:600])
    have = all(shutil.which(t) for t in ("ogr2ogr", "tippecanoe"))
    emit_tiles(area_dir, area, attrs, have)
