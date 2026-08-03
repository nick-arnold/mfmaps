#!/usr/bin/env python3
"""Diagnose the Mt Hood (OR608) STATSGO2 fill, step by step.

Runs the EXACT logic statsgo_fill.clip_region uses, but for OR608's hole only,
and writes:
  - or608_fate.csv       : one row per STATSGO2 polygon touching OR608, with the
                           exact gate result (WRITTEN / skip:empty / skip:no_attrs /
                           skip:no_series / skip:water) + clipped area + attributes
  - or608_written.geojson : the geometry of every piece that WOULD be written to
                           the fill (load in QGIS / geojson.io / pmtiles.io to see
                           how much of the rectangle is actually covered)
  - or608_hole.geojson    : the OR608 NOTCOM hole itself (the target rectangle)

Usage:
  python3 diag_or608.py ~/Documents
"""
import sys, os, glob, json, csv
from shapely.geometry import shape, mapping, Point
from shapely.ops import unary_union
import pyogrio
import build_ssurgo as B

MT_HOOD = Point(-121.9623, 44.9907)

def main(parent):
    here = os.path.dirname(os.path.abspath(__file__))
    notcom_path = os.path.join(here, "notcom.geojsonseq")
    if not os.path.exists(notcom_path):
        # fall back to cwd
        notcom_path = "notcom.geojsonseq"
    print(f"reading holes from {notcom_path}")

    holes = []
    with open(notcom_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            g = shape(json.loads(line)["geometry"])
            if g.is_valid and not g.is_empty:
                holes.append(g)
    print(f"  {len(holes)} total NOTCOM holes")

    # isolate OR608's hole (the one containing the Mt Hood point)
    from shapely.geometry import box as _box
    _mthood = _box(-122.1, 44.9, -121.4, 45.5)
    containing = sorted([h for h in holes if h.intersects(_mthood)], key=lambda h:-h.area)
    if not containing:
        print("!! no NOTCOM hole contains the Mt Hood point — OR608 not recorded as NOTCOM")
        sys.exit(1)
    or608 = containing[0]
    print(f"  OR608 hole found, area={or608.area:.4f} deg^2")

    # the fill clips against the FULL union, so replicate that exactly
    hole_union = unary_union(holes)

    # locate the STATSGO2 US region
    region = None
    for d in sorted(glob.glob(os.path.join(parent, "wss_gsmsoil_*"))):
        if "US" in os.path.basename(d):
            region = d
            break
    if not region:
        print("!! no wss_gsmsoil_US_* folder found")
        sys.exit(1)
    print(f"  STATSGO2 region: {region}")

    tabular = os.path.join(region, "tabular")
    attrs = B.build_attrs(tabular, B.load_mstab(tabular), B.load_schema(tabular))
    print(f"  parsed {len(attrs)} STATSGO2 mukeys")

    shp = glob.glob(os.path.join(glob.escape(region), "spatial", "gsmsoilmu_a_*.shp"))[0]
    gdf = pyogrio.read_dataframe(shp, columns=["MUKEY"])
    geoms = list(gdf.geometry.values)
    mukeys = [str(m) for m in gdf["MUKEY"].values]

    # every STATSGO2 polygon that touches OR608's rectangle
    touching = [i for i, g in enumerate(geoms) if g.intersects(or608)]
    print(f"  {len(touching)} STATSGO2 polygons intersect OR608\n")

    rows = []
    written_features = []
    covered_pieces = []
    for i in touching:
        poly = geoms[i]
        mukey = mukeys[i]
        # EXACT clip_region logic, clipping against the full union
        piece = poly.intersection(hole_union)
        a = attrs.get(mukey)
        # also clip against just OR608 to measure local coverage
        local = poly.intersection(or608)

        if piece.is_empty:
            fate = "skip:empty_vs_union"
        elif not a:
            fate = "skip:no_attrs"
        elif not a.get("series"):
            fate = "skip:no_series"
        elif a["series"].strip().lower() == "water":
            fate = "skip:water"
        else:
            fate = "WRITTEN"
            written_features.append({
                "type": "Feature",
                "geometry": mapping(piece),
                "properties": {
                    "mukey": mukey,
                    "series": a.get("series"),
                    "taxorder": a.get("taxorder"),
                    "taxsubgrp": a.get("taxsubgrp"),
                    "soilgroup": B.group_of(a.get("taxsubgrp")),
                }
            })
            covered_pieces.append(piece)

        rows.append({
            "mukey": mukey,
            "fate": fate,
            "clip_area_vs_union": round(piece.area, 6) if not piece.is_empty else 0,
            "clip_area_vs_or608": round(local.area, 6) if not local.is_empty else 0,
            "series": (a or {}).get("series", ""),
            "taxorder": (a or {}).get("taxorder", ""),
            "taxsubgrp": (a or {}).get("taxsubgrp", ""),
            "dom_pct": (a or {}).get("dom_pct", ""),
        })

    # sort: written first, then by area
    rows.sort(key=lambda r: (r["fate"] != "WRITTEN", -r["clip_area_vs_or608"]))

    csv_path = os.path.join(here, "or608_fate.csv")
    with open(csv_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    # geojson of written pieces
    with open(os.path.join(here, "or608_written.geojson"), "w") as f:
        json.dump({"type": "FeatureCollection", "features": written_features}, f)
    # geojson of the hole itself
    with open(os.path.join(here, "or608_hole.geojson"), "w") as f:
        json.dump({"type": "FeatureCollection",
                   "features": [{"type": "Feature", "geometry": mapping(or608), "properties": {"name": "OR608 NOTCOM hole"}}]}, f)

    # summary
    from collections import Counter
    c = Counter(r["fate"] for r in rows)
    print("=== FATE SUMMARY ===")
    for fate, n in c.most_common():
        print(f"  {fate}: {n}")
    if covered_pieces:
        covered = unary_union(covered_pieces)
        print(f"\nOR608 hole area:      {or608.area:.4f}")
        print(f"WRITTEN pieces cover: {covered.area:.4f}  ({covered.area/or608.area*100:.1f}% of the rectangle)")
    else:
        print("\n!! ZERO pieces would be written — nothing fills OR608")
    print(f"\nwrote:\n  {csv_path}\n  or608_written.geojson\n  or608_hole.geojson")

if __name__ == "__main__":
    parent = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Documents")
    main(parent)
