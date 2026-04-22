import type { AnalysisRequest, GtfsFeed, JobStatus, Suggestion } from "./types";

const BASE = "/api";

export async function fetchSuggestions(query: string): Promise<Suggestion[]> {
  const res = await fetch(`${BASE}/suggestions?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error("Failed to fetch suggestions");
  return (await res.json()).suggestions;
}

export async function fetchCityGeometry(
  cityName: string
): Promise<GeoJSON.FeatureCollection> {
  const res = await fetch(`${BASE}/city-geometry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ city_name: cityName }),
  });
  if (!res.ok) throw new Error("Failed to fetch city geometry");
  return res.json();
}

export async function fetchGeocodeGeometry(
  address: string,
  bufferM: number
): Promise<GeoJSON.FeatureCollection> {
  const res = await fetch(`${BASE}/geocode-geometry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, buffer_m: bufferM }),
  });
  if (!res.ok) throw new Error("Failed to geocode address");
  return res.json();
}

export async function fetchGtfsFeeds(
  bbox: string,
  placeQuery?: string | null
): Promise<GtfsFeed[]> {
  const params = new URLSearchParams({ bbox });
  if (placeQuery) params.set("place_query", placeQuery);
  const res = await fetch(`${BASE}/gtfs-feeds?${params.toString()}`);
  if (!res.ok) throw new Error("Failed to fetch GTFS feeds");
  return res.json();
}

export async function startAnalysis(params: AnalysisRequest): Promise<string> {
  const res = await fetch(`${BASE}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? "Failed to start analysis");
  }
  return (await res.json()).job_id;
}

export async function pollJob(jobId: string): Promise<JobStatus> {
  const res = await fetch(`${BASE}/job/${jobId}`);
  if (!res.ok) throw new Error("Failed to poll job");
  return res.json();
}
