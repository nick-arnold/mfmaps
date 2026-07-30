#!/usr/bin/env python3
"""Automated SSURGO download by survey area — stdlib only, no R, no pip."""
import json, sys, os, zipfile, io, datetime, urllib.request, urllib.error

SDA = "https://sdmdataaccess.nrcs.usda.gov/Tabular/post.rest"
WSS = "https://websoilsurvey.sc.egov.usda.gov/DSD/Download/Cache/SSA"

def sda_query(sql):
    body = json.dumps({"format": "JSON+COLUMNNAME", "query": sql}).encode()
    req = urllib.request.Request(SDA, data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        rows = json.load(r).get("Table", [])
    return [dict(zip(rows[0], row)) for row in rows[1:]] if rows else []

def wss_urls(areasymbols):
    quoted = ",".join("'%s'" % a for a in areasymbols)
    sql = ("SELECT areasymbol, saverest FROM sacatalog "
           "WHERE areasymbol != 'US' AND areasymbol IN (%s)" % quoted)
    urls = []
    for row in sda_query(sql):
        d = datetime.datetime.strptime(row["saverest"].split()[0], "%m/%d/%Y").date()
        urls.append((row["areasymbol"],
                     "%s/wss_SSA_%s_[%s].zip" % (WSS, row["areasymbol"], d.isoformat())))
    return urls

def download(areasymbols, destdir):
    os.makedirs(destdir, exist_ok=True)
    got = []
    for asym, url in wss_urls(areasymbols):
        print("GET", url)
        try:
            with urllib.request.urlopen(url, timeout=600) as r:
                blob = r.read()
        except urllib.error.HTTPError as e:
            print("  !! HTTP", e.code, "- date or areasymbol mismatch"); continue
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            z.extractall(destdir)
        print("  ok %s  (%.1f MB)" % (asym, len(blob) / 1e6))
        got.append(asym)
    return got

if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] == "--list":
        st = args[1] if len(args) > 1 else "OR"
        rows = sda_query("SELECT areasymbol, areaname, saverest FROM sacatalog "
                         "WHERE areasymbol LIKE '%s%%' ORDER BY areasymbol" % st)
        for r in rows:
            print(r["areasymbol"], "-", r["areaname"])
        print("\n%d survey areas for %s" % (len(rows), st))
        raise SystemExit
    areas = args or ["OR039", "OR043"]
    dest = os.path.expanduser("~/ssurgo_test")
    download(areas, dest)
    print("\nExtracted tree (first 40 entries):")
    n = 0
    for root, _, files in os.walk(dest):
        for f in sorted(files):
            print("  ", os.path.join(root, f)); n += 1
            if n >= 40: raise SystemExit
