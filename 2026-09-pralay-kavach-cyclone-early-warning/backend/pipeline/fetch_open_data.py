"""Fetch the open datasets the demo runs on and cache them in backend/data/.

Everything here is public and keyless:
  - IBTrACS v04r01 best track for Cyclone Fani (2019)        -> fani_track.json
  - Terrarium elevation/bathymetry tiles (AWS open data)      -> dem.npz
  - WorldPop 2020 1 km population, cropped to the region      -> population.npz
  - OpenStreetMap assets via Overpass                         -> assets.json, roads.json
  - GeoNames populated places                                 -> villages.json
  - NASA GIBS MODIS true-colour image of Fani near landfall   -> satellite_2019-05-02.jpg

Run once:  python -m pipeline.fetch_open_data
Each step is cached; delete a file to refetch it.
"""

from __future__ import annotations

import csv
import io
import json
import math
import sys
from pathlib import Path

import httpx
import numpy as np
from PIL import Image

from app.geo import BBOX, DEM_ZOOM, lonlat_to_tile, tile_bounds_mercator

DATA = Path(__file__).resolve().parent.parent / "data"
DATA.mkdir(exist_ok=True)

IBTRACS_URL = (
    "https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/"
    "v04r01/access/csv/ibtracs.NI.list.v04r01.csv"
)
TERRARIUM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
WORLDPOP_URL = (
    "https://data.worldpop.org/GIS/Population/Global_2000_2020_1km_UNadj/2020/IND/"
    "ind_ppp_2020_1km_Aggregated_UNadj.tif"
)
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
GEONAMES_URL = "https://download.geonames.org/export/dump/IN.zip"
GIBS_URL = (
    "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0"
    "&LAYERS=MODIS_Terra_CorrectedReflectance_TrueColor&CRS=EPSG:4326&BBOX={s},{w},{n},{e}"
    "&WIDTH=1200&HEIGHT=1200&FORMAT=image/jpeg&TIME={date}"
)

client = httpx.Client(timeout=180, follow_redirects=True, headers={"User-Agent": "pralay-kavach-prototype"})


def log(msg: str) -> None:
    print(f"[fetch] {msg}", flush=True)


def _num(value: str) -> float | None:
    value = value.strip()
    return float(value) if value else None


def fetch_track() -> None:
    out = DATA / "fani_track.json"
    if out.exists():
        return log("track cached")
    log("downloading IBTrACS North Indian basin (~28 MB)")
    text = client.get(IBTRACS_URL).text
    points = []
    for row in csv.DictReader(io.StringIO(text)):
        if row["NAME"] != "FANI" or row["SEASON"] != "2019":
            continue
        # Prefer IMD (New Delhi RSMC) values, fall back to WMO then JTWC.
        wind = _num(row["NEWDELHI_WIND"]) or _num(row["WMO_WIND"]) or _num(row["USA_WIND"])
        pres = _num(row["NEWDELHI_PRES"]) or _num(row["WMO_PRES"]) or _num(row["USA_PRES"])
        if wind is None or pres is None:
            continue
        points.append({
            "time": row["ISO_TIME"].replace(" ", "T") + "Z",
            "lat": float(row["LAT"]),
            "lon": float(row["LON"]),
            "wind_kt": wind,
            "pres_hpa": pres,
            "rmw_nm": _num(row["USA_RMW"]),
            "dist2land_km": _num(row["DIST2LAND"]),
        })
    out.write_text(json.dumps({"name": "FANI", "season": 2019, "source": "IBTrACS v04r01", "points": points}, indent=1))
    log(f"track: {len(points)} fixes")


def fetch_dem() -> None:
    out = DATA / "dem.npz"
    if out.exists():
        return log("dem cached")
    w, s, e, n = BBOX
    x0, y0 = lonlat_to_tile(w, n, DEM_ZOOM)
    x1, y1 = lonlat_to_tile(e, s, DEM_ZOOM)
    log(f"downloading {(x1 - x0 + 1) * (y1 - y0 + 1)} terrarium tiles at z{DEM_ZOOM}")
    rows = []
    for y in range(y0, y1 + 1):
        row = []
        for x in range(x0, x1 + 1):
            png = client.get(TERRARIUM_URL.format(z=DEM_ZOOM, x=x, y=y)).content
            rgb = np.asarray(Image.open(io.BytesIO(png)).convert("RGB"), dtype=np.float32)
            row.append(rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768)
        rows.append(np.hstack(row))
        log(f"  row {y - y0 + 1}/{y1 - y0 + 1}")
    elev = np.vstack(rows).astype(np.float32)
    mx0, my1, _, _ = tile_bounds_mercator(x0, y0, DEM_ZOOM)  # top-left
    _, _, mx1, my0 = tile_bounds_mercator(x1, y1, DEM_ZOOM)  # bottom-right
    np.savez_compressed(out, elev=elev, merc_bounds=np.array([mx0, my0, mx1, my1]))
    log(f"dem: {elev.shape}, range {elev.min():.0f}..{elev.max():.0f} m")


def fetch_population() -> None:
    out = DATA / "population.npz"
    if out.exists():
        return log("population cached")
    log("downloading WorldPop 2020 India 1 km (~18 MB)")
    Image.MAX_IMAGE_PIXELS = None
    img = Image.open(io.BytesIO(client.get(WORLDPOP_URL).content))
    scale = img.tag_v2[33550]  # ModelPixelScaleTag
    tie = img.tag_v2[33922]  # ModelTiepointTag: (i, j, k, x, y, z)
    px, py = scale[0], scale[1]
    lon0, lat0 = tie[3], tie[4]
    w, s, e, n = BBOX
    c0, c1 = int((w - lon0) / px), int(math.ceil((e - lon0) / px))
    r0, r1 = int((lat0 - n) / py), int(math.ceil((lat0 - s) / py))
    pop = np.array(img.crop((c0, r0, c1, r1)), dtype=np.float32)
    pop[pop < 0] = 0
    np.savez_compressed(
        out, pop=pop,
        bounds=np.array([lon0 + c0 * px, lat0 - r1 * py, lon0 + c1 * px, lat0 - r0 * py]),
    )
    log(f"population: {pop.shape}, total {pop.sum() / 1e6:.1f} M people in region")


OVERPASS_MIRRORS = [OVERPASS_URL, "https://overpass.kumi.systems/api/interpreter",
                    "https://overpass.private.coffee/api/interpreter"]


def overpass(query: str) -> dict:
    last = None
    for attempt in range(6):
        url = OVERPASS_MIRRORS[attempt % len(OVERPASS_MIRRORS)]
        try:
            r = client.post(url, data={"data": query})
            r.raise_for_status()
            return r.json()
        except (httpx.HTTPError, ValueError) as exc:
            last = exc
            log(f"  overpass attempt {attempt + 1} failed ({exc.__class__.__name__}), retrying")
    raise RuntimeError(f"Overpass failed: {last}")


def fetch_osm() -> None:
    w, s, e, n = BBOX
    bb = f"{s},{w},{n},{e}"
    assets_out, roads_out, villages_out = DATA / "assets.json", DATA / "roads.json", DATA / "villages.json"

    if not assets_out.exists():
        log("overpass: hospitals, shelters, substations")
        q = f"""[out:json][timeout:120];
        (
          nwr["amenity"="hospital"]({bb});
          nwr["amenity"="clinic"]["healthcare"="hospital"]({bb});
          nwr["emergency"="shelter"]({bb});
          nwr["name"~"[Cc]yclone [Ss]helter|MCS|MPCS"]({bb});
          nwr["amenity"~"^(school|college)$"]["name"]({bb});
          nwr["power"="substation"]({bb});
        );
        out center tags;"""
        assets = []
        for el in overpass(q)["elements"]:
            tags = el.get("tags", {})
            lat = el.get("lat") or el.get("center", {}).get("lat")
            lon = el.get("lon") or el.get("center", {}).get("lon")
            if lat is None:
                continue
            name = tags.get("name", "")
            if tags.get("power") == "substation":
                kind = "substation"
            elif tags.get("amenity") in ("hospital", "clinic"):
                kind = "hospital"
            else:
                # OSM barely maps Odisha's cyclone shelters, so schools and colleges (which double as
                # shelters) stand in until the OSDMA shelter registry is plugged in.
                kind = "shelter"
            assets.append({"id": f"{el['type'][0]}{el['id']}", "kind": kind, "name": name, "lat": lat, "lon": lon,
                           "voltage": tags.get("voltage"), "capacity": tags.get("capacity"),
                           "proxy": kind == "shelter" and tags.get("amenity") in ("school", "college")})
        assets_out.write_text(json.dumps(assets))
        log(f"assets: {sum(a['kind'] == 'hospital' for a in assets)} hospitals, "
            f"{sum(a['kind'] == 'shelter' for a in assets)} shelters, "
            f"{sum(a['kind'] == 'substation' for a in assets)} substations")

    if not roads_out.exists():
        log("overpass: trunk/primary/secondary roads")
        q = f"""[out:json][timeout:180];
        way["highway"~"^(motorway|trunk|primary|secondary)$"]({bb});
        out geom tags;"""
        roads = []
        for el in overpass(q)["elements"]:
            geom = el.get("geometry") or []
            if len(geom) < 2:
                continue
            roads.append({"id": el["id"], "ref": el.get("tags", {}).get("ref") or el.get("tags", {}).get("name", ""),
                          "class": el["tags"]["highway"],
                          "coords": [[round(p["lon"], 5), round(p["lat"], 5)] for p in geom]})
        roads_out.write_text(json.dumps(roads))
        log(f"roads: {len(roads)} ways")

    if not villages_out.exists():
        fetch_villages(villages_out)


def fetch_villages(out: Path) -> None:
    """Populated places from GeoNames (a static dump, far faster than Overpass for this)."""
    import zipfile

    log("downloading GeoNames India populated places (~16 MB)")
    z = zipfile.ZipFile(io.BytesIO(client.get(GEONAMES_URL).content))
    w, s, e, n = BBOX
    villages = []
    for line in z.read("IN.txt").decode("utf-8").splitlines():
        f = line.split("\t")
        if f[6] != "P" or f[7] == "PPLQ":  # PPLQ = abandoned
            continue
        lat, lon = float(f[4]), float(f[5])
        if not (w <= lon <= e and s <= lat <= n):
            continue
        odia = next((a for a in f[3].split(",") if any("\u0b00" <= ch <= "\u0b7f" for ch in a)), None)
        villages.append({"id": int(f[0]), "name": f[1], "place": f[7], "lat": lat, "lon": lon, "name_or": odia})
    if not villages:
        raise RuntimeError("GeoNames returned no places in the region")
    out.write_text(json.dumps(villages))
    log(f"villages: {len(villages)} populated places")


def fetch_satellite() -> None:
    # Wide view of the storm the day before landfall; used on the map and as Gemini's image input.
    for date in ("2019-05-02",):
        out = DATA / f"satellite_{date}.jpg"
        if out.exists():
            log(f"satellite {date} cached")
            continue
        url = GIBS_URL.format(s=13, w=80, n=25, e=92, date=date)
        out.write_bytes(client.get(url).content)
        log(f"satellite {date}: {out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    steps = {"track": fetch_track, "dem": fetch_dem, "population": fetch_population,
             "osm": fetch_osm, "satellite": fetch_satellite}
    wanted = sys.argv[1:] or list(steps)
    for name in wanted:
        steps[name]()
    log("done")
