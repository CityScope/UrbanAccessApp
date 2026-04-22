import { useEffect, useRef } from "react";
import { GeoJSON, MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import type { AnalysisResult } from "../types";

const poiIcon = L.divIcon({
  className: "",
  iconSize: [28, 36],
  iconAnchor: [14, 36],
  popupAnchor: [0, -34],
  html: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
    <filter id="ds" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-color="#000" flood-opacity="0.5"/>
    </filter>
    <path filter="url(#ds)" d="M14 0C6.268 0 0 6.268 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.268 21.732 0 14 0z" fill="#ef4444" stroke="#fff" stroke-width="2"/>
    <circle cx="14" cy="13" r="5.5" fill="#fff"/>
  </svg>`,
});

// Schools / Parks mode colors
const ACCESSIBILITY_COLORS: Record<string, string> = {
  walk: "#22c55e",
  bike: "#3b82f6",
  "bus/car": "#f59e0b",
};

// GTFS LOS grade colors
const LOS_GRADE_COLORS: Record<string, string> = {
  A1: "#68b684", A2: "#40916c", A3: "#1b4332",
  B1: "#f1c40f", B2: "#d4ac0d", B3: "#b7950b",
  C1: "#ffa75a", C2: "#fa8246", C3: "#cf5600",
  D:  "#b30202",
  E:  "#9b59b6",
  F:  "#0051ff",
};

function getFeatureColor(accessibility: string): string {
  return (
    ACCESSIBILITY_COLORS[accessibility] ??
    LOS_GRADE_COLORS[accessibility] ??
    "#6b7280"
  );
}

type FeatureProps = {
  accessibility?: string;
  population?: number | string;
  name?: string;
};
type MapFeature = GeoJSON.Feature<GeoJSON.Geometry, FeatureProps>;

function FitBounds({ geojson }: { geojson: GeoJSON.FeatureCollection }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current && geojson.features.length > 0) {
      const layer = L.geoJSON(geojson as GeoJSON.GeoJsonObject);
      const bounds = layer.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 40] });
        fitted.current = true;
      }
    }
  }, [geojson, map]);
  return null;
}

function ResetFit({ geojson }: { geojson: GeoJSON.FeatureCollection }) {
  const map = useMap();
  useEffect(() => {
    if (geojson.features.length > 0) {
      const layer = L.geoJSON(geojson as GeoJSON.GeoJsonObject);
      const bounds = layer.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40] });
    }
  }, [geojson, map]);
  return null;
}

interface Props {
  aoiGeojson: GeoJSON.FeatureCollection | null;
  result: AnalysisResult | null;
}

export default function CityMap({ aoiGeojson, result }: Props) {
  const hexagonStyle = (feature?: MapFeature) => {
    const color = getFeatureColor(feature?.properties?.accessibility ?? "");
    return { fillColor: color, fillOpacity: 0.45, color, weight: 0.5, opacity: 0.7 };
  };

  const edgeStyle = (feature?: MapFeature) => {
    const color = getFeatureColor(feature?.properties?.accessibility ?? "");
    return { color, weight: 2, opacity: 0.8 };
  };

  const aoiStyle = {
    fillColor: "transparent",
    fillOpacity: 0,
    color: "#e5e7eb",
    weight: 2.5,
    dashArray: "6 4",
  };

  const displayAoi = result?.aoi ?? aoiGeojson;

  return (
    <MapContainer
      center={[40, -3]}
      zoom={3}
      className="h-full w-full rounded-xl"
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://carto.com/">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />

      {displayAoi && (
        <>
          <FitBounds geojson={displayAoi} />
          <GeoJSON data={displayAoi} style={() => aoiStyle} />
        </>
      )}

      {result && (
        <>
          <ResetFit geojson={result.aoi} />
          <GeoJSON
            data={result.hexagons}
            style={hexagonStyle}
            onEachFeature={(feature: GeoJSON.Feature, layer) => {
              const p = (feature as MapFeature).properties;
              if (p) {
                const pop = p.population;
                const popText =
                  pop == null || String(pop) === "nan"
                    ? "N/A"
                    : Math.round(Number(pop)).toString();
                layer.bindPopup(
                  `<b>Accessibility:</b> ${p.accessibility ?? "N/A"}<br/><b>Population:</b> ${popText}`
                );
              }
            }}
          />
          <GeoJSON data={result.edges} style={edgeStyle} />
          {result.pois?.features?.map((f, i) => {
            const coords = (f.geometry as GeoJSON.Point).coordinates;
            if (!coords) return null;
            return (
              <Marker key={i} position={[coords[1], coords[0]]} icon={poiIcon}>
                <Popup>
                  <span className="font-medium">{f.properties?.name ?? "POI"}</span>
                </Popup>
              </Marker>
            );
          })}
        </>
      )}
    </MapContainer>
  );
}
