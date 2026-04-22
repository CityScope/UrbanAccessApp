export type AnalysisMode = "gtfs" | "schools" | "parks";

export interface Suggestion {
  display_name: string;
  lat: string;
  lon: string;
}

export type CityAOI = {
  kind: "city";
  city_name: string;
};

export type AddressAOI = {
  kind: "address";
  address: string;
  buffer_m: number;
};

export type AoiSelection = CityAOI | AddressAOI;

export interface GtfsFeed {
  id: string;
  provider: string;
  name: string;
}

export interface AnalysisRequest {
  analysis_type: AnalysisMode;
  city_name?: string;
  address?: string;
  buffer_m?: number;
  // Schools / Parks
  distance_walk?: number;
  distance_bike?: number;
  distance_car?: number;
  kids_only?: boolean;
  // GTFS
  feed_ids?: string[];
  start_hour?: number;
  end_hour?: number;
  analysis_date?: string;
}

export interface StatsRow {
  accessibility: string;
  population: number;
  population_pct: number;
}

export interface AnalysisResult {
  aoi: GeoJSON.FeatureCollection;
  pois: GeoJSON.FeatureCollection;
  hexagons: GeoJSON.FeatureCollection;
  edges: GeoJSON.FeatureCollection;
  stats: StatsRow[];
}

export interface JobStatus {
  status: "running" | "completed" | "failed";
  progress: string;
  result?: AnalysisResult;
  error?: string;
}
