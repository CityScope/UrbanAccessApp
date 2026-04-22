"""
Stop-level service quality from GTFS headways.

pyGTFSHandler v1.0.0 ships with ``get_service_quality`` commented out in
``processing_helpers.py``; this module implements the same idea using the public
``Feed.get_headway_at_stops`` API (harmonic-mean headway in minutes).
"""
from __future__ import annotations

from datetime import date, datetime, time

import geopandas as gpd
import pandas as pd
import polars as pl
from pyGTFSHandler.feed import Feed
from pyGTFSHandler.processing_helpers import ROUTE_TYPES, assign_service_quality_to_interval

# Same spirit as the worldwide_public_transport notebook: bus = everything,
# tram = broad modes, rail = heavy rail.
MODE_ROUTE_TYPES: dict[str, list[int] | str] = {
    "rail": [1, 2],
    "tram": [0, 1, 2, 4, 5, 6, 7],
    "bus": "all",
}


def _end_time(hour: int) -> time:
    if hour >= 24:
        return time(23, 59, 59)
    return time(hour=hour, minute=0, second=0)


def compute_stop_service_quality_gdf(
    gtfs: Feed,
    processing_date: date,
    start_hour: int,
    end_hour: int,
) -> gpd.GeoDataFrame:
    """
    Build a GeoDataFrame of stop points with one column
    ``service_quality_{start_hour}h_{end_hour}h`` (values 1–12, lower is better).
    """
    st = time(hour=start_hour, minute=0, second=0)
    et = _end_time(end_hour)
    analysis_dt = datetime.combine(processing_date, time.min)

    best_by_station: dict[str, float] = {}
    for mode in ROUTE_TYPES:
        rtypes = MODE_ROUTE_TYPES.get(mode)
        if rtypes is None:
            continue
        try:
            lf = gtfs.get_headway_at_stops(
                date=analysis_dt,
                start_time=st,
                end_time=et,
                route_types=rtypes,
                by="shape_direction",
                at="parent_station",
                how="best",
                n_divisions=1,
            )
        except Exception:
            continue
        if isinstance(lf, pl.LazyFrame):
            pdf = lf.collect().to_pandas()
        else:
            pdf = lf.to_pandas()

        if pdf.empty:
            continue
        for _, row in pdf.iterrows():
            pid = row.get("parent_station")
            if pid is None or (isinstance(pid, float) and pd.isna(pid)):
                continue
            hw = row.get("headway")
            if hw is None or (isinstance(hw, float) and pd.isna(hw)) or hw <= 0:
                continue
            sq = assign_service_quality_to_interval(float(hw), mode)
            if sq is None:
                continue
            key = str(pid)
            if key not in best_by_station or sq < best_by_station[key]:
                best_by_station[key] = float(sq)

    col = f"service_quality_{start_hour}h_{end_hour}h"
    stops = gtfs.stops.gdf[["stop_id", "parent_station", "geometry"]].copy()
    stops["parent_station"] = stops["parent_station"].astype(str)
    if not best_by_station:
        stops[col] = None
        return stops[0:0]

    sq_df = pd.DataFrame(
        [{"parent_station": k, col: v} for k, v in best_by_station.items()]
    )
    stops = stops.merge(sq_df, on="parent_station", how="inner")
    stops = stops.dropna(subset=[col])
    stops = stops.drop_duplicates(subset=["parent_station"], keep="first")

    name_res = gtfs.stops.lf.select(["stop_id", "stop_name"])
    if isinstance(name_res, pl.LazyFrame):
        name_lf = name_res.collect().to_pandas()
    else:
        name_lf = name_res.to_pandas()

    stops = stops.merge(name_lf, on="stop_id", how="left")
    return stops
