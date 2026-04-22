"""Parks accessibility pipeline. Uses osm.green_areas + poi_utils.polygons_to_points."""
import os
import zipfile
from typing import Optional

import geopandas as gpd
import osmnx as ox
import pandas as pd

import UrbanAccessAnalyzer.graph_processing as graph_processing
import UrbanAccessAnalyzer.h3_utils as h3_utils
import UrbanAccessAnalyzer.isochrones as isochrones
import UrbanAccessAnalyzer.osm as osm
import UrbanAccessAnalyzer.poi_utils as poi_utils
import UrbanAccessAnalyzer.population as population
import UrbanAccessAnalyzer.utils as uaa_utils

from backend.utils import (
    drop_invalid_geometries_for_h3,
    geocode,
    gdf_to_geojson,
    sanitize_filename,
)

RESULTS_PATH = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "output"))
MIN_EDGE_LENGTH = 30
H3_RESOLUTION = 10
ACCESSIBILITY_VALUES = ["walk"]


def _prepare_paths(aoi_key: str):
    city_filename = sanitize_filename(aoi_key)
    city_results_path = os.path.join(RESULTS_PATH, city_filename + "_parks")
    os.makedirs(city_results_path, exist_ok=True)
    return city_results_path, {
        "poi": os.path.join(city_results_path, "parks.gpkg"),
        "osm_xml": os.path.join(city_results_path, "streets.osm"),
        "graph": os.path.join(city_results_path, "streets.graphml"),
        "streets": os.path.join(city_results_path, "streets.gpkg"),
        "los_streets": os.path.join(city_results_path, "level_of_service_streets.gpkg"),
        "population": os.path.join(city_results_path, "population.gpkg"),
        "pop_raster_ref": os.path.join(city_results_path, ".population_raster_path"),
    }


def run_parks_analysis(
    city_name: Optional[str] = None,
    address: Optional[str] = None,
    buffer_m: float = 0,
    distance_walk: int = 500,
    progress_callback=None,
) -> dict:
    """Run parks accessibility pipeline. Returns GeoJSON-serialisable dict."""

    def _progress(msg: str):
        if progress_callback:
            progress_callback(msg)

    if not city_name and not address:
        raise ValueError("Provide either city_name or address")

    aoi_key = city_name if city_name else f"{address} r={int(round(buffer_m))}m"
    city_results_path, paths = _prepare_paths(aoi_key)
    os.makedirs(RESULTS_PATH, exist_ok=True)

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

    # 2. Street network (needed before park entry points)
    if os.path.exists(paths["graph"]):
        _progress("Loading cached street graph...")
        G = ox.load_graphml(paths["graph"])
    else:
        _progress("Downloading street network...")
        network_filter = osm.osmium_network_filter("walk+bike+primary")
        osm.geofabrik_to_osm(
            paths["osm_xml"],
            input_file=RESULTS_PATH,
            aoi=aoi_download,
            osmium_filter_args=network_filter,
            overwrite=False,
        )
        _progress("Building street graph...")
        G = ox.graph_from_xml(paths["osm_xml"])
        G = ox.project_graph(G, to_crs=aoi.estimate_utm_crs())
        _progress("Simplifying graph...")
        G = graph_processing.simplify_graph(
            G,
            min_edge_length=MIN_EDGE_LENGTH,
            min_edge_separation=MIN_EDGE_LENGTH * 2,
            undirected=True,
        )
        ox.save_graphml(G, paths["graph"])

    street_edges = ox.graph_to_gdfs(G, nodes=False).to_crs(aoi.crs)

    # 3. POIs (parks as entry points)
    if os.path.exists(paths["poi"]):
        _progress("Loading cached park entry points...")
        poi = gpd.read_file(paths["poi"]).to_crs(aoi.crs)
    else:
        _progress("Fetching parks from OSM...")
        parks_gdf = osm.green_areas(aoi_download)
        if parks_gdf.empty:
            raise ValueError("No parks found in this area.")
        parks_gdf = parks_gdf.to_crs(aoi.crs)
        _progress("Computing park entry points...")
        poi = poi_utils.polygons_to_points(parks_gdf, street_edges)
        poi = poi[poi.geometry.intersects(aoi_download.union_all())]
        if poi.empty:
            raise ValueError("No park entry points intersect the street network.")
        poi.to_file(paths["poi"])

    poi = poi[poi.geometry.intersects(aoi_download.union_all())]

    # 4. Add POIs to graph
    _progress("Adding park entry points to graph...")
    G, osmids = graph_processing.add_points_to_graph(
        poi, G, max_dist=100 + MIN_EDGE_LENGTH, min_edge_length=MIN_EDGE_LENGTH
    )
    poi["osmid"] = osmids

    # 5. Isochrones
    _progress("Computing isochrones...")
    accessibility_graph = isochrones.graph(
        G, poi, [distance_walk],
        poi_quality_col=None,
        accessibility_values=ACCESSIBILITY_VALUES,
        min_edge_length=MIN_EDGE_LENGTH,
    )
    _, accessibility_edges = ox.graph_to_gdfs(accessibility_graph)
    accessibility_edges.to_file(paths["los_streets"])
    accessibility_edges = drop_invalid_geometries_for_h3(accessibility_edges)
    if accessibility_edges.empty:
        raise ValueError(
            "No valid street geometries for H3; isochrones may be empty for this area."
        )

    # 6. H3
    _progress("Converting to H3 hexagons...")
    access_h3_df = h3_utils.from_gdf(
        accessibility_edges,
        resolution=H3_RESOLUTION,
        columns=["accessibility"],
        value_order=ACCESSIBILITY_VALUES,
        contain="overlap",
        method="min",
        buffer=10,
    )

    # 7. Population
    pop_raster_ref = paths["pop_raster_ref"]
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
    pop_h3_df = h3_utils.from_raster(population_file, aoi=aoi_download, resolution=H3_RESOLUTION)
    pop_h3_df = pop_h3_df.rename(columns={"value": "population"})

    # 8. Merge + stats
    _progress("Merging accessibility and population data...")
    results_h3_df = access_h3_df.merge(pop_h3_df, left_index=True, right_index=True, how="outer")
    results_h3_df = h3_utils.to_gdf(results_h3_df).to_crs(aoi.crs)
    results_h3_df = results_h3_df[results_h3_df.intersects(aoi.union_all())]
    results_h3_df.to_file(paths["population"])

    stats_df = results_h3_df.groupby("accessibility", as_index=False)["population"].sum()
    total_population = stats_df["population"].sum()
    stats_df = pd.concat(
        [stats_df, pd.DataFrame([{"accessibility": "total population", "population": total_population}])],
        ignore_index=True,
    )
    stats_df["population_pct"] = (stats_df["population"] * 100 / total_population).round(2)
    stats_df["population"] = stats_df["population"].round(0).astype(int)

    _progress("Building response...")
    return {
        "aoi": gdf_to_geojson(aoi.to_crs("EPSG:4326")),
        "pois": gdf_to_geojson(poi.to_crs("EPSG:4326")),
        "hexagons": gdf_to_geojson(results_h3_df.to_crs("EPSG:4326")),
        "edges": gdf_to_geojson(accessibility_edges.to_crs("EPSG:4326")),
        "stats": stats_df.to_dict(orient="records"),
    }
