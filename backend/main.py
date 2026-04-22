"""FastAPI backend for UrbanAccessApp: Transit, Schools, Parks accessibility analysis."""
import asyncio
import uuid
from contextlib import asynccontextmanager
from typing import Literal, Optional

import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, model_validator

import geopandas as gpd
from shapely.geometry import box

from backend.analysis_schools import run_schools_analysis
from backend.analysis_parks import run_parks_analysis
from backend.analysis_gtfs import get_gtfs_feeds as _get_gtfs_feeds, run_gtfs_analysis
from backend.utils import geocode

jobs: dict[str, dict] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    jobs.clear()


app = FastAPI(title="Urban Access Analyzer", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request / Response models ──────────────────────────────────────


class CityRequest(BaseModel):
    city_name: str


class GeocodeRequest(BaseModel):
    address: str
    buffer_m: float


class AnalysisRequest(BaseModel):
    analysis_type: Literal["schools", "parks", "gtfs"]
    city_name: Optional[str] = None
    address: Optional[str] = None
    buffer_m: float = 5000
    # Schools / Parks
    distance_walk: int = 1000
    distance_bike: int = 2500
    distance_car: int = 10000
    kids_only: bool = False
    # GTFS
    feed_ids: Optional[list[str]] = None
    start_hour: int = 8
    end_hour: int = 20
    analysis_date: Optional[str] = None

    @model_validator(mode="after")
    def check_aoi(self):
        if not self.city_name and not self.address:
            raise ValueError("Provide either city_name or address")
        if self.city_name and self.address:
            raise ValueError("Provide only one of city_name or address")
        return self


# ── Endpoints ──────────────────────────────────────────────────────


@app.get("/api/suggestions")
async def suggestions(q: str):
    """Nominatim autocomplete."""
    try:
        resp = await asyncio.to_thread(
            lambda: requests.get(
                "https://nominatim.openstreetmap.org/search",
                params={"q": q, "format": "json", "limit": 8, "addressdetails": 1},
                headers={"User-Agent": "urban-access-app/1.0"},
                timeout=10,
            )
        )
        resp.raise_for_status()
        return {
            "suggestions": [
                {"display_name": item["display_name"], "lat": item["lat"], "lon": item["lon"]}
                for item in resp.json()
            ]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/city-geometry")
async def city_geometry(req: CityRequest):
    """Return city boundary as GeoJSON (EPSG:4326)."""
    try:
        def _fetch():
            import UrbanAccessAnalyzer.utils as uaa_utils
            from shapely.geometry import mapping
            aoi = uaa_utils.get_city_geometry(req.city_name)
            aoi = gpd.GeoDataFrame(geometry=[aoi.union_all()], crs=aoi.crs).to_crs("EPSG:4326")
            return {
                "type": "FeatureCollection",
                "features": [{"type": "Feature", "geometry": mapping(aoi.geometry.iloc[0]), "properties": {}}],
            }
        return await asyncio.to_thread(_fetch)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/geocode-geometry")
async def geocode_geometry(req: GeocodeRequest):
    """Geocode address + buffer, return as GeoJSON (EPSG:4326)."""
    try:
        def _fetch():
            from shapely.geometry import mapping
            gdf = geocode(req.address, results=1, buffer=req.buffer_m)
            if gdf is None or gdf.empty:
                raise ValueError(f"Could not geocode: {req.address}")
            aoi = gdf.to_crs("EPSG:4326")
            return {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "geometry": mapping(aoi.geometry.iloc[0]),
                        "properties": {"display_name": aoi.iloc[0].get("display_name", req.address)},
                    }
                ],
            }
        return await asyncio.to_thread(_fetch)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/gtfs-feeds")
async def gtfs_feeds(bbox: str, place_query: Optional[str] = None):
    """
    Search Mobility Database for GTFS feeds covering the given bounding box.
    bbox format: "minx,miny,maxx,maxy" in EPSG:4326.
    When place_query is set (city name or address), uses Nominatim-derived filters
    like the worldwide_public_transport notebook; bbox-only search often returns no feeds.
    """
    try:
        def _fetch():
            minx, miny, maxx, maxy = map(float, bbox.split(","))
            aoi_gdf = gpd.GeoDataFrame(
                geometry=[box(minx, miny, maxx, maxy)], crs="EPSG:4326"
            )
            return _get_gtfs_feeds(aoi_gdf, place_query=place_query)
        return await asyncio.to_thread(_fetch)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/analyze")
async def start_analysis(req: AnalysisRequest):
    """Start a long-running analysis job. Returns job_id for polling."""
    job_id = str(uuid.uuid4())
    jobs[job_id] = {"status": "running", "progress": "Starting...", "result": None, "error": None}

    async def _run():
        loop = asyncio.get_event_loop()
        try:
            def progress_cb(msg: str):
                jobs[job_id]["progress"] = msg

            if req.analysis_type == "schools":
                result = await loop.run_in_executor(
                    None,
                    lambda: run_schools_analysis(
                        city_name=req.city_name,
                        address=req.address,
                        buffer_m=req.buffer_m,
                        distance_steps=[req.distance_walk, req.distance_bike, req.distance_car],
                        accessibility_values=["walk", "bike", "bus/car"],
                        kids_only=req.kids_only,
                        progress_callback=progress_cb,
                    ),
                )
            elif req.analysis_type == "parks":
                result = await loop.run_in_executor(
                    None,
                    lambda: run_parks_analysis(
                        city_name=req.city_name,
                        address=req.address,
                        buffer_m=req.buffer_m,
                        distance_walk=req.distance_walk,
                        progress_callback=progress_cb,
                    ),
                )
            else:  # gtfs
                result = await loop.run_in_executor(
                    None,
                    lambda: run_gtfs_analysis(
                        city_name=req.city_name,
                        address=req.address,
                        buffer_m=req.buffer_m,
                        feed_ids=req.feed_ids or [],
                        start_hour=req.start_hour,
                        end_hour=req.end_hour,
                        analysis_date=req.analysis_date,
                        distance_walk=req.distance_walk,
                        progress_callback=progress_cb,
                    ),
                )

            jobs[job_id]["status"] = "completed"
            jobs[job_id]["result"] = result
        except Exception as e:
            jobs[job_id]["status"] = "failed"
            jobs[job_id]["error"] = str(e)

    asyncio.create_task(_run())
    return {"job_id": job_id}


@app.get("/api/job/{job_id}")
async def job_status(job_id: str):
    """Poll for analysis job status and result."""
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    job = jobs[job_id]
    response = {"status": job["status"], "progress": job["progress"]}
    if job["status"] == "completed":
        response["result"] = job["result"]
    elif job["status"] == "failed":
        response["error"] = job["error"]
    return response
