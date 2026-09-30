"""Pull Earth Engine layers for the Fani hindcast into backend/data/.

  observed_flood.npz   Sentinel-1 SAR flood extent after landfall (change detection vs. pre-storm)
  hydro.npz            GPM IMERG storm rainfall, MERIT Hydro height above nearest drainage (HAND),
                       and JRC permanent water, all on one 150 m grid

Setup (once):
  pip install earthengine-api
  earthengine authenticate
  export EE_PROJECT=<your Google Cloud project with the Earth Engine API enabled>

Run:
  python -m pipeline.gee_precompute
"""

from __future__ import annotations

import io
import os

import numpy as np

from app.geo import BBOX, DATA

SCALE_M = 150  # matches the DEM grid (~150 m at z10)


def _download(image, band: str, region, dtype) -> np.ndarray:
    import httpx

    url = image.rename(band).getDownloadURL({"region": region, "scale": SCALE_M, "format": "NPY", "crs": "EPSG:4326"})
    arr = np.load(io.BytesIO(httpx.get(url, timeout=600, follow_redirects=True).content))
    return np.asarray(arr[band] if arr.dtype.names else arr).astype(dtype)


def hydro() -> None:
    """Rainfall and terrain drainage for the rain-flood model."""
    import ee

    w, s, e, n = BBOX
    region = ee.Geometry.Rectangle([w, s, e, n])
    # IMERG is mm/hr per half-hour step; 2-4 May covers Fani's approach, landfall and passage.
    rain = (ee.ImageCollection("NASA/GPM_L3/IMERG_V07").filterDate("2019-05-02", "2019-05-05")
            .select("precipitation").sum().multiply(0.5).resample("bilinear"))
    hand = ee.Image("MERIT/Hydro/v1_0_1").select("hnd")
    permanent = ee.Image("JRC/GSW1_4/GlobalSurfaceWater").select("seasonality").gte(10).unmask(0)
    print("downloading rainfall, HAND and permanent water ...")
    rain_mm = _download(rain.round().toInt16(), "rain", region, np.int16)
    hand_dm = _download(hand.multiply(10).round().clamp(0, 30000).unmask(30000).toInt16(), "hand", region, np.int16)
    perm = _download(permanent.toByte(), "perm", region, np.uint8)
    np.savez_compressed(DATA / "hydro.npz", rain_mm=rain_mm, hand_dm=hand_dm, permanent=perm, bounds=np.array([w, s, e, n]))
    print(f"hydro.npz: {rain_mm.shape}, rain {rain_mm.min()}-{rain_mm.max()} mm")


def main() -> None:
    import ee
    import httpx

    ee.Initialize(project=os.environ.get("EE_PROJECT"))
    hydro()
    w, s, e, n = BBOX
    region = ee.Geometry.Rectangle([w, s, e, n])

    s1 = (ee.ImageCollection("COPERNICUS/S1_GRD")
          .filterBounds(region)
          .filter(ee.Filter.eq("instrumentMode", "IW"))
          .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
          .select("VV"))
    pre_all = s1.filterDate("2019-04-01", "2019-04-30")
    post_all = s1.filterDate("2019-05-03", "2019-05-08")  # floodwater is most visible in the first days

    # Compare each post-storm pass with pre-storm passes from the same relative orbit, so the
    # viewing geometry matches; water appears dark in VV backscatter.
    def per_orbit(orbit):
        orbit = ee.Number(orbit)
        pre = pre_all.filter(ee.Filter.eq("relativeOrbitNumber_start", orbit)).median().focal_median(50, "circle", "meters")
        post = post_all.filter(ee.Filter.eq("relativeOrbitNumber_start", orbit)).min().focal_median(50, "circle", "meters")
        return post.lt(-16).And(post.subtract(pre).lt(-3)).unmask(0).rename("flood").toByte()

    orbits = post_all.aggregate_array("relativeOrbitNumber_start").distinct()
    pre_orbits = pre_all.aggregate_array("relativeOrbitNumber_start").distinct()
    shared = orbits.filter(ee.Filter.inList("item", pre_orbits))
    print("orbits compared:", shared.getInfo())
    flood = ee.ImageCollection(shared.map(per_orbit)).max()

    permanent = ee.Image("JRC/GSW1_4/GlobalSurfaceWater").select("seasonality").gte(10).unmask(0)
    slope = ee.Terrain.slope(ee.Image("USGS/SRTMGL1_003"))
    flood = flood.And(permanent.Not()).And(slope.lt(5)).rename("flood").toByte()
    # Drop speckle: keep patches of at least ~8 connected pixels.
    flood = flood.updateMask(flood.connectedPixelCount(8).gte(8)).unmask(0).toByte()

    url = flood.getDownloadURL({"region": region, "scale": SCALE_M, "format": "NPY", "crs": "EPSG:4326"})
    print("downloading observed flood mask ...")
    raw = httpx.get(url, timeout=600, follow_redirects=True).content
    arr = np.load(io.BytesIO(raw))
    mask = np.asarray(arr["flood"] if arr.dtype.names else arr).astype(np.uint8)
    np.savez_compressed(DATA / "observed_flood.npz", mask=mask, bounds=np.array([w, s, e, n]))
    km2 = mask.sum() * (SCALE_M / 1000) ** 2
    print(f"observed_flood.npz: {mask.shape}, ~{km2:.0f} km2 flagged as flooded")


if __name__ == "__main__":
    main()
