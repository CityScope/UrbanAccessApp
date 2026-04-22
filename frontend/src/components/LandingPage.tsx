import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSuggestions } from "../api";
import type { AnalysisMode, AoiSelection, Suggestion } from "../types";

interface Props {
  mode: AnalysisMode;
  onSelectMode: (m: AnalysisMode) => void;
  onSelect: (aoi: AoiSelection) => void;
}

const MODES: { value: AnalysisMode; label: string; description: string }[] = [
  { value: "gtfs",    label: "Transit",  description: "Public transport level of service" },
  { value: "schools", label: "Schools",  description: "Walking, biking, and driving to school" },
  { value: "parks",   label: "Parks",    description: "Green space within walking distance" },
];

const SearchIcon = () => (
  <svg className="h-5 w-5 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
  </svg>
);

const PinIcon = () => (
  <svg className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 0 1 15 0Z" />
  </svg>
);

function SuggestionDropdown({ suggestions, onSelect }: { suggestions: Suggestion[]; onSelect: (s: Suggestion) => void }) {
  return (
    <ul className="absolute top-full z-50 mt-2 max-h-72 w-full overflow-y-auto rounded-xl border border-white/10 bg-gray-900/95 shadow-2xl backdrop-blur-xl">
      {suggestions.map((s, i) => (
        <li key={i}>
          <button
            onClick={() => onSelect(s)}
            className="flex w-full items-start gap-3 px-5 py-3 text-left text-sm text-gray-200 transition hover:bg-white/5"
          >
            <PinIcon />
            <span>{s.display_name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function useSearch() {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const search = useCallback(async (q: string) => {
    if (q.length < 3) { setSuggestions([]); return; }
    setLoading(true);
    try {
      const results = await fetchSuggestions(q);
      setSuggestions(results);
      setShowDropdown(true);
    } catch { setSuggestions([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, search]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node))
        setShowDropdown(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return { query, setQuery, suggestions, showDropdown, setShowDropdown, loading, wrapperRef };
}

function CitySearch({ onSelect }: { onSelect: (aoi: AoiSelection) => void }) {
  const { query, setQuery, suggestions, showDropdown, setShowDropdown, loading, wrapperRef } = useSearch();
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
        Search by city boundary
      </p>
      <div ref={wrapperRef} className="relative">
        <div className="flex items-center rounded-2xl border border-white/10 bg-white/10 shadow-2xl backdrop-blur-xl transition focus-within:border-emerald-400/50 focus-within:ring-2 focus-within:ring-emerald-400/20">
          <div className="ml-5"><SearchIcon /></div>
          <input
            type="text" value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Enter a city name (e.g. Bilbao, Spain)"
            className="w-full bg-transparent px-4 py-4 text-lg text-white placeholder-gray-400 outline-none"
          />
          {loading && <div className="mr-4 h-5 w-5 animate-spin rounded-full border-2 border-gray-500 border-t-emerald-400" />}
        </div>
        {showDropdown && suggestions.length > 0 && (
          <SuggestionDropdown
            suggestions={suggestions}
            onSelect={(s) => { setShowDropdown(false); onSelect({ kind: "city", city_name: s.display_name }); }}
          />
        )}
      </div>
    </div>
  );
}

function AddressSearch({ onSelect }: { onSelect: (aoi: AoiSelection) => void }) {
  const { query, setQuery, suggestions, showDropdown, setShowDropdown, loading, wrapperRef } = useSearch();
  const [selectedAddr, setSelectedAddr] = useState<Suggestion | null>(null);
  const [bufferM, setBufferM] = useState(5000);
  const skipNextRef = useRef(false);

  function handleAddrPick(s: Suggestion) {
    setShowDropdown(false);
    skipNextRef.current = true;
    setQuery(s.display_name);
    setSelectedAddr(s);
  }

  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
        Search by address + radius
      </p>
      <div className="flex gap-3">
        <div ref={wrapperRef} className="relative flex-1">
          <div className="flex items-center rounded-2xl border border-white/10 bg-white/10 shadow-2xl backdrop-blur-xl transition focus-within:border-blue-400/50 focus-within:ring-2 focus-within:ring-blue-400/20">
            <div className="ml-5"><PinIcon /></div>
            <input
              type="text" value={query}
              onChange={(e) => { setQuery(e.target.value); if (selectedAddr) setSelectedAddr(null); }}
              placeholder="Enter an address or place name"
              className="w-full bg-transparent px-4 py-4 text-base text-white placeholder-gray-400 outline-none"
            />
            {loading && <div className="mr-4 h-5 w-5 animate-spin rounded-full border-2 border-gray-500 border-t-blue-400" />}
          </div>
          {showDropdown && suggestions.length > 0 && (
            <SuggestionDropdown suggestions={suggestions} onSelect={handleAddrPick} />
          )}
        </div>
        <div className="flex w-[140px] shrink-0 flex-col items-center justify-center rounded-2xl border border-white/10 bg-white/10 px-3 backdrop-blur-xl">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Buffer</span>
          <div className="flex items-baseline gap-1">
            <input
              type="number" min={100} max={100000} step={500} value={bufferM}
              onChange={(e) => setBufferM(Number(e.target.value))}
              className="w-[70px] bg-transparent text-center text-lg font-semibold text-white outline-none"
            />
            <span className="text-xs text-gray-400">m</span>
          </div>
        </div>
        <button
          onClick={() => selectedAddr && onSelect({ kind: "address", address: selectedAddr.display_name, buffer_m: bufferM })}
          disabled={!selectedAddr}
          className="flex w-[56px] shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-lg transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
          </svg>
        </button>
      </div>
      {selectedAddr && (
        <p className="mt-2 text-xs text-gray-400">
          Selected: <span className="text-gray-200">{selectedAddr.display_name}</span>
          {" "}&mdash; {(bufferM / 1000).toFixed(1)} km radius
        </p>
      )}
    </div>
  );
}

export default function LandingPage({ mode, onSelectMode, onSelect }: Props) {
  return (
    <div className="relative h-full w-full overflow-hidden bg-gray-950">
      <video
        className="absolute inset-0 h-full w-full object-cover opacity-50"
        autoPlay loop muted playsInline
        poster="https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=1920&q=80"
      >
        <source src="https://cdn.coverr.co/videos/coverr-aerial-view-of-city-buildings-1573/1080p.mp4" type="video/mp4" />
      </video>
      <div className="absolute inset-0 bg-gradient-to-b from-gray-950/70 via-gray-950/40 to-gray-950/80" />

      <div className="relative z-10 flex h-full flex-col items-center justify-center px-4">
        <h1 className="mb-2 text-4xl font-bold tracking-tight text-white md:text-5xl">
          Urban Access Analyzer
        </h1>
        <p className="mb-8 max-w-xl text-center text-lg text-gray-300">
          Analyze urban accessibility for transit, schools, and parks.
        </p>

        {/* Mode selector */}
        <div className="mb-8 flex gap-2 rounded-2xl border border-white/10 bg-white/5 p-1.5 backdrop-blur-xl">
          {MODES.map((m) => (
            <button
              key={m.value}
              onClick={() => onSelectMode(m.value)}
              className={`rounded-xl px-5 py-2.5 text-sm font-semibold transition ${
                mode === m.value
                  ? "bg-white/15 text-white shadow"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="mb-6 text-sm text-gray-400">
          {MODES.find((m) => m.value === mode)?.description}
        </p>

        <div className="w-full max-w-3xl space-y-6">
          <CitySearch onSelect={onSelect} />
          <div className="flex items-center gap-4">
            <div className="h-px flex-1 bg-white/10" />
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">or</span>
            <div className="h-px flex-1 bg-white/10" />
          </div>
          <AddressSearch onSelect={onSelect} />
        </div>

        <p className="mt-8 text-sm text-gray-500">
          Powered by OpenStreetMap &middot; WorldPop &middot; H3 &middot; Mobility Database
        </p>
      </div>
    </div>
  );
}
