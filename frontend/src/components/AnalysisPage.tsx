import { useCallback, useEffect, useRef, useState } from "react";
import { fetchCityGeometry, fetchGeocodeGeometry, pollJob, startAnalysis } from "../api";
import type { AnalysisMode, AnalysisResult, AoiSelection } from "../types";
import CityMap from "./CityMap";
import SchoolsControls from "./SchoolsControls";
import ParksControls from "./ParksControls";
import GtfsControls from "./GtfsControls";
import StatsPanel from "./StatsPanel";
import L from "leaflet";

interface Props {
  mode: AnalysisMode;
  aoi: AoiSelection;
  onBack: () => void;
}

// LOS grade legend items
const LOS_LEGEND = [
  { label: "A (best)", color: "bg-[#40916c]" },
  { label: "B",        color: "bg-[#d4ac0d]" },
  { label: "C",        color: "bg-[#fa8246]" },
  { label: "D",        color: "bg-[#b30202]" },
  { label: "E",        color: "bg-[#9b59b6]" },
  { label: "F (worst)", color: "bg-[#0051ff]" },
];

const SCHOOLS_LEGEND = [
  { label: "Walk",     color: "bg-emerald-500" },
  { label: "Bike",     color: "bg-blue-500"    },
  { label: "Bus/Car",  color: "bg-amber-500"   },
];

const PARKS_LEGEND = [
  { label: "Walk", color: "bg-emerald-500" },
];

function geojsonToBbox(geojson: GeoJSON.FeatureCollection): string | null {
  try {
    const layer = L.geoJSON(geojson as GeoJSON.GeoJsonObject);
    const bounds = layer.getBounds();
    if (!bounds.isValid()) return null;
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    return `${sw.lng},${sw.lat},${ne.lng},${ne.lat}`;
  } catch {
    return null;
  }
}

export default function AnalysisPage({ mode, aoi, onBack }: Props) {
  const [aoiGeojson, setAoiGeojson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [aoiBbox, setAoiBbox] = useState<string | null>(null);
  const [loadingAoi, setLoadingAoi] = useState(true);

  // Schools params
  const [distanceWalk, setDistanceWalk] = useState(1000);
  const [distanceBike, setDistanceBike] = useState(2500);
  const [distanceCar, setDistanceCar] = useState(10000);
  const [kidsOnly, setKidsOnly] = useState(false);

  // Parks params
  const [parksWalk, setParksWalk] = useState(500);

  // GTFS params
  const [startHour, setStartHour] = useState(8);
  const [endHour, setEndHour] = useState(20);
  const [selectedFeedIds, setSelectedFeedIds] = useState<string[]>([]);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingAoi(true);
    setError(null);
    setAoiBbox(null);

    const fetchAoi = async () => {
      try {
        const geojson =
          aoi.kind === "city"
            ? await fetchCityGeometry(aoi.city_name)
            : await fetchGeocodeGeometry(aoi.address, aoi.buffer_m);
        if (!cancelled) {
          setAoiGeojson(geojson);
          setAoiBbox(geojsonToBbox(geojson));
        }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoadingAoi(false);
      }
    };
    fetchAoi();
    return () => { cancelled = true; };
  }, [aoi]);

  const handleRun = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    setProgress("Starting analysis...");

    const aoiParams =
      aoi.kind === "city"
        ? { city_name: aoi.city_name }
        : { address: aoi.address, buffer_m: aoi.buffer_m };

    let modeParams = {};
    if (mode === "schools") {
      modeParams = { distance_walk: distanceWalk, distance_bike: distanceBike, distance_car: distanceCar, kids_only: kidsOnly };
    } else if (mode === "parks") {
      modeParams = { distance_walk: parksWalk };
    } else {
      modeParams = { feed_ids: selectedFeedIds, start_hour: startHour, end_hour: endHour };
    }

    try {
      const jobId = await startAnalysis({ analysis_type: mode, ...aoiParams, ...modeParams });
      pollRef.current = setInterval(async () => {
        try {
          const status = await pollJob(jobId);
          setProgress(status.progress);
          if (status.status === "completed") {
            clearInterval(pollRef.current!);
            setResult(status.result!);
            setRunning(false);
          } else if (status.status === "failed") {
            clearInterval(pollRef.current!);
            setError(status.error ?? "Unknown error");
            setRunning(false);
          }
        } catch {
          clearInterval(pollRef.current!);
          setError("Lost connection to server");
          setRunning(false);
        }
      }, 2000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setRunning(false);
    }
  }, [aoi, mode, distanceWalk, distanceBike, distanceCar, kidsOnly, parksWalk, startHour, endHour, selectedFeedIds]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const canRun = !running && !loadingAoi && (mode !== "gtfs" || selectedFeedIds.length > 0);
  const legend = mode === "gtfs" ? LOS_LEGEND : mode === "schools" ? SCHOOLS_LEGEND : PARKS_LEGEND;
  const title = aoi.kind === "city" ? aoi.city_name : aoi.address;

  return (
    <div className="flex h-full bg-gray-950 text-white">
      <aside className="flex w-[360px] shrink-0 flex-col gap-5 overflow-y-auto border-r border-white/5 bg-gray-900/60 p-6 backdrop-blur-sm">
        <div>
          <button onClick={onBack} className="mb-3 flex items-center gap-1.5 text-sm text-gray-400 transition hover:text-white">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            Back
          </button>
          <h2 className="text-lg font-semibold leading-tight">{title}</h2>
          <p className="mt-0.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
            {mode === "gtfs" ? "Transit LOS" : mode === "schools" ? "Schools" : "Parks"}
          </p>
          {loadingAoi && <p className="mt-1 text-sm text-gray-500">Loading geometry...</p>}
        </div>

        {mode === "schools" && (
          <SchoolsControls
            distanceWalk={distanceWalk} distanceBike={distanceBike} distanceCar={distanceCar} kidsOnly={kidsOnly}
            onChangeWalk={setDistanceWalk} onChangeBike={setDistanceBike} onChangeCar={setDistanceCar} onChangeKidsOnly={setKidsOnly}
          />
        )}
        {mode === "parks" && (
          <ParksControls distanceWalk={parksWalk} onChangeWalk={setParksWalk} />
        )}
        {mode === "gtfs" && (
          <GtfsControls
            aoiBbox={aoiBbox}
            placeQueryForFeeds={aoi.kind === "city" ? aoi.city_name : aoi.address}
            startHour={startHour} endHour={endHour}
            selectedFeedIds={selectedFeedIds}
            onChangeStartHour={setStartHour} onChangeEndHour={setEndHour}
            onChangeFeedIds={setSelectedFeedIds}
          />
        )}

        <button
          onClick={handleRun}
          disabled={!canRun}
          className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-900/30 transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? (
            <><div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> Running...</>
          ) : (
            <><svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" /></svg> Run Analysis</>
          )}
        </button>

        {running && (
          <div className="rounded-xl bg-blue-500/10 px-4 py-3 text-sm text-blue-300">
            <div className="mb-1 flex items-center gap-2">
              <div className="h-2 w-2 animate-pulse rounded-full bg-blue-400" />
              <span className="font-medium">Processing</span>
            </div>
            <p className="text-blue-300/80">{progress}</p>
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-300">
            <p className="font-medium">Error</p>
            <p className="mt-1 text-red-300/80">{error}</p>
          </div>
        )}

        {result && <StatsPanel stats={result.stats} />}

        <div className="mt-auto space-y-2 border-t border-white/5 pt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Legend</h4>
          {legend.map((item) => (
            <div key={item.label} className="flex items-center gap-2 text-sm text-gray-400">
              <span className={`inline-block h-3 w-3 rounded-sm ${item.color}`} />
              {item.label}
            </div>
          ))}
        </div>
      </aside>

      <main className="relative flex-1 p-3">
        <CityMap aoiGeojson={aoiGeojson} result={result} />
      </main>
    </div>
  );
}
