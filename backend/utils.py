"""Shared utilities: geocoding, GeoDataFrame serialisation, filename sanitisation."""
import json
import re
import unicodedata

import geopandas as gpd
import numpy as np
import pandas as pd
import requests
from shapely.geometry import Point


def drop_invalid_geometries_for_h3(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """
    Remove rows that would break H3 4.x ``geo_to_h3shape`` / ``LatLngPoly``
    (empty polygons or empty coordinate lists → ``LatLngPoly()`` with no ``outer``).
    """
    if gdf is None or gdf.empty:
        return gdf
    out = gdf[gdf.geometry.notna()].copy()
    out = out[~out.geometry.is_empty]
    if out.empty:
        return out

    def _ok(geom) -> bool:
        if geom is None or geom.is_empty:
            return False
        gi = geom.__geo_interface__
        t = gi.get("type")
        coords = gi.get("coordinates")
        if t == "Polygon" and (coords is None or len(coords) == 0):
            return False
        if t == "MultiPolygon" and (coords is None or len(coords) == 0):
            return False
        return True

    out = out[out.geometry.apply(_ok)]
    return out


def sanitize_filename(name: str) -> str:
    """Lowercase, strip accents, replace non-alphanumeric chars with underscore."""
    text = str(name).lower().strip()
    text = "".join(
        c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn"
    )
    result = re.sub(r"[^a-zA-Z0-9_\-]", "_", text)
    if not result:
        raise ValueError(f"sanitize_filename produced empty string for input: {name!r}")
    return result


def geocode(q: str, results: int = 1, buffer: float = 0) -> gpd.GeoDataFrame | None:
    """Geocode a query string via Nominatim. Returns a GeoDataFrame or None."""
    try:
        r = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": q, "format": "json", "limit": results},
            headers={"User-Agent": "urban-access-app/1.0"},
            timeout=8,
        )
        r.raise_for_status()
        data = r.json()
        if not data:
            return None
        records = [
            {
                "query": q,
                "display_name": item["display_name"],
                "lat": float(item["lat"]),
                "lon": float(item["lon"]),
                "geometry": Point(float(item["lon"]), float(item["lat"])),
            }
            for item in data
        ]
        gdf = gpd.GeoDataFrame(records, geometry="geometry", crs="EPSG:4326")
        if buffer > 0:
            orig_crs = gdf.crs
            gdf = gdf.to_crs(gdf.estimate_utm_crs())
            gdf.geometry = gdf.geometry.buffer(buffer)
            gdf = gdf.to_crs(orig_crs)
        return gdf
    except Exception as e:
        print(f"Geocode error: {e}")
        return None


def gdf_to_geojson(gdf: gpd.GeoDataFrame) -> dict:
    """Convert a GeoDataFrame to a JSON-serialisable GeoJSON dict."""
    gdf = gdf.copy()
    for col in gdf.columns:
        if col == "geometry":
            continue
        dtype = gdf[col].dtype
        if pd.api.types.is_bool_dtype(dtype):
            gdf[col] = gdf[col].astype(object)
        elif pd.api.types.is_integer_dtype(dtype) and not isinstance(dtype, pd.api.extensions.ExtensionDtype):
            gdf[col] = gdf[col].astype(int)
        elif pd.api.types.is_integer_dtype(dtype):
            # nullable Int64 — preserve NA as None
            gdf[col] = gdf[col].where(gdf[col].notna(), other=None).astype(object)
        elif pd.api.types.is_float_dtype(dtype):
            gdf[col] = gdf[col].where(gdf[col].notna(), other=None)
        else:
            gdf[col] = gdf[col].astype(str)
    return json.loads(gdf.to_json())
