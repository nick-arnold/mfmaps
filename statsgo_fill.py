#!/usr/bin/env python3
"""STATSGO2 NOTCOM infill — runs AFTER the SSURGO batches.

Unions the accumulated NOTCOM holes (notcom.geojsonseq), clips each STATSGO2
region shapefile to those holes (true geometric intersection), colors/groups
the clipped pieces with the SAME functions as SSURGO, and tiles them to
soils_fill.pmtiles. tile-join that with the SSURGO batch tiles for the final
seamless coverage.

Usage:
  python3 statsgo_fill.py /path/to/statsgo_parent_dir
    where that dir contains wss_gsmsoil_US_[...], _AK_[...], _HI_[...] folders.
"""
import sys, os, glob, json, subprocess
from shapely.geometry import shape, mapping
from shapely.ops import unary_union
from shapely import STRtree
import pyogrio
import build_ssurgo as B   # reuse load_schema/load_mstab/build_attrs/group_of/series_color

TILE = ["-l", "soils", "-Z9", "-z13", "--detect-shared-borders",
        "--simplification=4", "--coalesce-densest-as-needed",
        "--extend-zooms-if-still-dropping", "--no-tiny-polygon-reduction", "--force"]

def load_notcom_union(path):
    geoms = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line: continue
            g = shape(json.loads(line)["geometry"])
            if g.is_valid and not g.is_empty:
                geoms.append(g)
    print(f"  {len(geoms)} NOTCOM polygons -> unioning…")
    return unary_union(geoms)

def statsgo_attrs(tabular):
    """mukey -> dominant-component attrs, via the SSURGO parser (same schema)."""
    schema = B.load_schema(tabular)
    f2t = B.load_mstab(tabular)
    return B.build_attrs(tabular, f2t, schema)   # {mukey: {series,taxorder,taxsubgrp,...}}

def clip_region(region_dir, hole_union, out_fh):
    tabular = os.path.join(region_dir, "tabular")
    shp = glob.glob(os.path.join(region_dir, "spatial", "gsmsoilmu_a_*.shp"))
    if not shp:
        print(f"  !! no gsmsoilmu_a_*.shp in {region_dir}"); return 0
    attrs = statsgo_attrs(tabular)

    gdf = pyogrio.read_dataframe(shp[0], columns=["MUKEY"])
    geoms = list(gdf.geometry.values)
    mukeys = [str(m) for m in gdf["MUKEY"].values]
    tree = STRtree(geoms)

    written = 0
    # candidate STATSGO polygons that touch the hole union (bbox prefilter)
    cand_idx = tree.query(hole_union)
    for i in cand_idx:
        poly = geoms[i]
        piece = poly.intersection(hole_union)
        if piece.is_empty: continue
        a = attrs.get(mukeys[i])
        if not a or not a.get("series"): continue
        # color/group with the SAME functions as SSURGO
        a = dict(a)
        a["color"] = B.series_color(a.get("taxorder"), a.get("series"))
        a["soilgroup"] = B.group_of(a.get("taxsubgrp"))
        a["source"] = "statsgo"   # tag so you can tell infill from SSURGO
        out_fh.write(json.dumps({"type":"Feature","geometry":mapping(piece),"properties":a}) + "\n")
        written += 1
    print(f"  {os.path.basename(region_dir)}: {written} infill pieces")
    return written

def main(parent):
    notcom_path = os.path.join(os.path.dirname(__file__), "notcom.geojsonseq")
    if not os.path.exists(notcom_path):
        sys.exit("no notcom.geojsonseq — run the SSURGO batches first")
    print("building NOTCOM union…")
    hole_union = load_notcom_union(notcom_path)
    print(f"  hole union area (deg^2): {hole_union.area:.2f}")

    fill_seq = "/tmp/statsgo_fill.geojsonseq"
    total = 0
    with open(fill_seq, "w") as out:
        for region_dir in sorted(glob.glob(os.path.join(parent, "wss_gsmsoil_*"))):
            if os.path.isdir(region_dir):
                total += clip_region(region_dir, hole_union, out)
    print(f"total infill pieces: {total}")
    if total == 0:
        sys.exit("no infill produced — nothing to tile")

    subprocess.run(["tippecanoe", "-o", "soils_fill.pmtiles", *TILE, fill_seq], check=True)
    print("wrote soils_fill.pmtiles")
    print("\nNext: tile-join it with your SSURGO batches into the final tileset:")
    print("  tile-join -o soils_US.pmtiles -pk --no-tile-size-limit soils_batch_*.pmtiles soils_fill.pmtiles")

if __name__ == "__main__":
    parent = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Documents")
    main(parent)
