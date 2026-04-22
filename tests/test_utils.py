"""Tests for backend/utils.py pure functions."""
import json
import geopandas as gpd
import numpy as np
from shapely.geometry import Point, Polygon
from backend.utils import sanitize_filename, gdf_to_geojson


def test_sanitize_filename_basic():
    assert sanitize_filename("New York, USA") == "new_york__usa"


def test_sanitize_filename_accents():
    assert sanitize_filename("Bilbão") == "bilbao"


def test_sanitize_filename_spaces():
    result = sanitize_filename("São Paulo")
    assert " " not in result
    assert result == "sao_paulo"


def test_gdf_to_geojson_returns_feature_collection():
    gdf = gpd.GeoDataFrame(
        {"name": ["test"], "value": [42.0]},
        geometry=[Point(0, 0)],
        crs="EPSG:4326",
    )
    result = gdf_to_geojson(gdf)
    assert result["type"] == "FeatureCollection"
    assert len(result["features"]) == 1
    assert result["features"][0]["properties"]["name"] == "test"


def test_gdf_to_geojson_handles_nan():
    gdf = gpd.GeoDataFrame(
        {"value": [np.nan]},
        geometry=[Point(0, 0)],
        crs="EPSG:4326",
    )
    result = gdf_to_geojson(gdf)
    assert json.dumps(result)  # no serialisation error


def test_gdf_to_geojson_handles_polygon():
    poly = Polygon([(0, 0), (1, 0), (1, 1), (0, 1)])
    gdf = gpd.GeoDataFrame({"accessibility": ["walk"]}, geometry=[poly], crs="EPSG:4326")
    result = gdf_to_geojson(gdf)
    assert result["features"][0]["geometry"]["type"] == "Polygon"
