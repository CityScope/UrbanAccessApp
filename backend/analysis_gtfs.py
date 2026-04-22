"""
GTFS Transit LOS pipeline.

Requires:
  - pyGTFSHandler (see pyproject.toml)
  - MOBILITY_DB_TOKEN environment variable (Mobility Database refresh token)

When pyGTFSHandler is not installed, all public functions raise RuntimeError.
"""
import os
import zipfile
from datetime import date, datetime, time, timedelta
from typing import Optional

import geopandas as gpd
import osmnx as ox
import pandas as pd

import UrbanAccessAnalyzer.h3_utils as h3_utils
import UrbanAccessAnalyzer.isochrones as isochrones
import UrbanAccessAnalyzer.population as population
import UrbanAccessAnalyzer.utils as uaa_utils

from backend.utils import (
    drop_invalid_geometries_for_h3,
    geocode,
    gdf_to_geojson,
    sanitize_filename,
)

try:
    from pyGTFSHandler.feed import Feed
    from pyGTFSHandler.downloaders.mobility_database import MobilityDatabaseClient
    import pyGTFSHandler.processing_helpers as processing_helpers

    PYGTFS_AVAILABLE = True
except ImportError:
    PYGTFS_AVAILABLE = False

RESULTS_PATH = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "output"))
GTFS_PATH = os.path.join(RESULTS_PATH, "gtfs_files")
H3_RESOLUTION = 10

# LOS grades used in the analysis (A1 is best, F is worst)
LOS_GRADES = ["A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3", "D", "E", "F"]


def _require_pygtfs():
    if not PYGTFS_AVAILABLE:
        raise RuntimeError(
            "pyGTFSHandler is not installed. "
            "Add it as a local dependency in pyproject.toml."
        )


def _get_token() -> str:
    token = os.environ.get("MOBILITY_DB_TOKEN", "Token goes here")
    if not token:
        raise RuntimeError(
            "MOBILITY_DB_TOKEN environment variable is not set. "
            "Get a refresh token from https://mobilitydatabase.org/"
        )
    return token


def _search_mobility_feeds(
    api: "MobilityDatabaseClient",
    aoi_wgs84: gpd.GeoDataFrame,
    place_query: Optional[str] = None,
) -> list[dict]:
    """
    Match the worldwide_public_transport notebook: prefer Nominatim-derived
    country / subdivision / municipality filters; AOI-only search often misses feeds.

    ``place_query`` is typically the city name or address string used to pick the AOI.
    """
    if place_query:
        geo = uaa_utils.get_geographic_suggestions_from_string(
            place_query, user_agent="UrbanAccessApp"
        )
        feeds = api.search_gtfs_feeds(
            country_code=geo["country_codes"],
            subdivision_name=geo["subdivision_names"],
            municipality=geo["municipalities"],
            is_official=True,
        )
        if feeds:
            return feeds
    feeds = api.search_gtfs_feeds(aoi=aoi_wgs84, is_official=None)
    if feeds:
        return feeds
    if place_query:
        geo = uaa_utils.get_geographic_suggestions_from_string(
            place_query, user_agent="UrbanAccessApp"
        )
        feeds = api.search_gtfs_feeds(
            country_code=geo["country_codes"],
            subdivision_name=geo["subdivision_names"],
            municipality=geo["municipalities"],
            is_official=None,
        )
        if feeds:
            return feeds
    return []


def get_gtfs_feeds(
    aoi_gdf: gpd.GeoDataFrame, place_query: Optional[str] = None
) -> list[dict]:
    """
    Search Mobility Database for GTFS feeds covering the given AOI.

    Returns a list of dicts: [{id, provider, name}, ...]
    """
    _require_pygtfs()
    api = MobilityDatabaseClient(_get_token())
    aoi_wgs84 = aoi_gdf.to_crs("EPSG:4326")
    feeds = _search_mobility_feeds(api, aoi_wgs84, place_query=place_query)
    return [
        {
            "id": str(f.get("id", i)),
            "provider": f.get("provider", "Unknown"),
            "name": f.get("name") or f.get("provider", "Unknown"),
        }
        for i, f in enumerate(feeds)
    ]


def run_gtfs_analysis(
    city_name: Optional[str] = None,
    address: Optional[str] = None,
    buffer_m: float = 0,
    feed_ids: list[str] = None,
    start_hour: int = 8,
    end_hour: int = 20,
    analysis_date: Optional[str] = None,
    distance_walk: int = 500,
    progress_callback=None,
) -> dict:
    """
    Run GTFS Transit LOS pipeline.

    Steps:
      1. AOI
      2. Download selected GTFS feeds
      3. Parse Feed, compute service quality per stop
      4. isochrones.buffers to create LOS buffer polygons per grade
      5. H3 hexagons + population overlay
    """
    _require_pygtfs()
    from backend.gtfs_service_quality import compute_stop_service_quality_gdf

    def _progress(msg: str):
        if progress_callback:
            progress_callback(msg)

    if not city_name and not address:
        raise ValueError("Provide either city_name or address")

    if feed_ids is None or len(feed_ids) == 0:
        raise ValueError("At least one feed_id must be provided")

    aoi_key = city_name if city_name else f"{address} r={int(round(buffer_m))}m"
    city_filename = sanitize_filename(aoi_key)
    city_results_path = os.path.join(RESULTS_PATH, city_filename + "_gtfs")
    os.makedirs(city_results_path, exist_ok=True)
    os.makedirs(RESULTS_PATH, exist_ok=True)
    os.makedirs(GTFS_PATH, exist_ok=True)

    # 1. AOI
    if city_name:
        _progress("Fetching city geometry...")
        aoi_raw = uaa_utils.get_city_geometry(city_name)
        aoi = gpd.GeoDataFrame(geometry=[aoi_raw.union_all()], crs=aoi_raw.crs)
        aoi = aoi.to_crs(aoi.estimate_utm_crs())
    else:
        _progress("Geocoding address...")
        gdf = geocode(address, results=1, buffer=buffer_m)
        if gdf is None or gdf.empty:
            raise ValueError(f"Could not geocode: {address}")
        aoi = gpd.GeoDataFrame(geometry=[gdf.union_all()], crs=gdf.crs)
        aoi = aoi.to_crs(aoi.estimate_utm_crs())

    aoi_download = aoi.buffer(0)

    # 2. Download GTFS feeds
    _progress("Downloading GTFS feeds...")
    api = MobilityDatabaseClient(_get_token())
    aoi_wgs84 = aoi_download.to_crs("EPSG:4326")
    place_query = city_name or address
    all_feeds = _search_mobility_feeds(api, aoi_wgs84, place_query=place_query)
    want = {str(x) for x in feed_ids}
    selected_feeds = [f for f in all_feeds if str(f.get("id", "")) in want]
    if not selected_feeds:
        raise ValueError(f"None of the requested feed IDs {feed_ids} were found.")

    files = api.download_feeds(
        selected_feeds, download_folder=GTFS_PATH, overwrite=False
    )

    # 3. Parse GTFS and compute service quality
    _progress("Parsing GTFS feeds...")
    if analysis_date:
        chosen_date = date.fromisoformat(analysis_date)
    else:
        chosen_date = date.today() + timedelta(days=1)

    start_dt = datetime.combine(chosen_date, time())
    end_dt = datetime.combine(chosen_date + timedelta(days=30), time())

    gtfs = Feed(
        files,
        aoi=aoi_download,
        stop_group_distance=100,
        start_date=start_dt,
        end_date=end_dt,
        check_files=False,
    )

    _progress("Computing stop service quality...")
    service_quality_gdf = compute_stop_service_quality_gdf(
        gtfs,
        chosen_date,
        start_hour,
        end_hour,
    ).to_crs(aoi.crs)

    service_quality_col = f"service_quality_{start_hour}h_{end_hour}h"
    if service_quality_col not in service_quality_gdf.columns:
        raise ValueError(
            f"Expected column '{service_quality_col}' not found in service quality output. "
            f"Available: {list(service_quality_gdf.columns)}"
        )
    if service_quality_gdf.empty:
        raise ValueError(
            "No transit stops with computable headways in the chosen date and hours. "
            "Try another calendar date, widen the service hours, or pick a different feed."
        )

    # 4. LOS buffer polygons per grade
    _progress("Generating LOS buffers...")
    # Fix: UrbanAccessAnalyzer expects "poi_quality" column in distance_matrix
    dm = processing_helpers.DISTANCE_MATRIX.copy()
    if "service_quality" in dm.columns:
        dm = dm.rename(columns={"service_quality": "poi_quality"})

    level_of_service_gdf = isochrones.buffers(
        service_quality_gdf,
        distance_matrix=dm,
        accessibility_values=LOS_GRADES,
        poi_quality_col=service_quality_col,
    )
    level_of_service_gdf = level_of_service_gdf.to_crs(aoi.crs)
    level_of_service_gdf = drop_invalid_geometries_for_h3(level_of_service_gdf)
    if level_of_service_gdf.empty:
        raise ValueError(
            "Transit LOS polygons were empty after buffering; nothing to map to H3. "
            "Try another area, date, or feed."
        )

    # 5. H3 hexagons from LOS buffers
    _progress("Converting LOS buffers to H3 hexagons...")
    access_h3_df = h3_utils.from_gdf(
        level_of_service_gdf,
        resolution=H3_RESOLUTION,
        columns=["accessibility"],
        value_order=LOS_GRADES,
        contain="overlap",
        method="min",
        buffer=10,
    )

    # 6. Population
    pop_raster_ref = os.path.join(city_results_path, ".population_raster_path")
    population_file = None
    if os.path.exists(pop_raster_ref):
        with open(pop_raster_ref) as f:
            cached_path = f.read().strip()
        if os.path.exists(cached_path):
            _progress("Using cached population raster...")
            population_file = cached_path

    if population_file is None:
        _progress("Downloading population data...")
        population_file = population.download_worldpop_population(
            aoi_download, 2025, folder=RESULTS_PATH, resolution="100m"
        )
        if ".zip" in population_file:
            extract_dir = os.path.splitext(population_file)[0]
            os.makedirs(extract_dir, exist_ok=True)
            with zipfile.ZipFile(population_file, "r") as zip_ref:
                zip_ref.extractall(extract_dir)
            for file_name in os.listdir(extract_dir):
                if file_name.lower().endswith(".tif") and "_T_" in file_name:
                    population_file = os.path.join(extract_dir, file_name)
                    break
        with open(pop_raster_ref, "w") as f:
            f.write(population_file)

    _progress("Processing population grid...")
    pop_h3_df = h3_utils.from_raster(
        population_file, aoi=aoi_download, resolution=H3_RESOLUTION
    )
    pop_h3_df = pop_h3_df.rename(columns={"value": "population"})

    # 7. Merge + stats
    _progress("Merging data...")
    results_h3_df = access_h3_df.merge(
        pop_h3_df, left_index=True, right_index=True, how="outer"
    )
    results_h3_df = h3_utils.to_gdf(results_h3_df).to_crs(aoi.crs)
    results_h3_df = results_h3_df[results_h3_df.intersects(aoi.union_all())]

    stats_df = results_h3_df.groupby("accessibility", as_index=False)["population"].sum()
    total_population = stats_df["population"].sum()
    stats_df = pd.concat(
        [stats_df, pd.DataFrame([{"accessibility": "total population", "population": total_population}])],
        ignore_index=True,
    )
    stats_df["population_pct"] = (stats_df["population"] * 100 / total_population).round(2)
    stats_df["population"] = stats_df["population"].round(0).astype(int)

    # Stops as POIs
    stops_gdf = service_quality_gdf[["geometry"]].copy().to_crs("EPSG:4326")
    if "stop_name" in service_quality_gdf.columns:
        stops_gdf["name"] = service_quality_gdf["stop_name"]

    _progress("Building response...")
    return {
        "aoi": gdf_to_geojson(aoi.to_crs("EPSG:4326")),
        "pois": gdf_to_geojson(stops_gdf),
        "hexagons": gdf_to_geojson(results_h3_df.to_crs("EPSG:4326")),
        "edges": gdf_to_geojson(level_of_service_gdf.to_crs("EPSG:4326")),
        "stats": stats_df.to_dict(orient="records"),
    }
