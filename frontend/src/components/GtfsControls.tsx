import { useCallback, useEffect, useState } from "react";
import { fetchGtfsFeeds } from "../api";
import type { GtfsFeed } from "../types";

interface Props {
  aoiBbox: string | null;        // "minx,miny,maxx,maxy" — set once AOI is loaded
  /** City name or address — backend uses Nominatim + Mobility DB metadata (matches notebook). */
  placeQueryForFeeds?: string | null;
  startHour: number;
  endHour: number;
  selectedFeedIds: string[];
  onChangeStartHour: (v: number) => void;
  onChangeEndHour: (v: number) => void;
  onChangeFeedIds: (ids: string[]) => void;
}

export default function GtfsControls({
  aoiBbox,
  placeQueryForFeeds,
  startHour,
  endHour,
  selectedFeedIds,
  onChangeStartHour,
  onChangeEndHour,
  onChangeFeedIds,
}: Props) {
  const [feeds, setFeeds] = useState<GtfsFeed[]>([]);
  const [loadingFeeds, setLoadingFeeds] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);

  const loadFeeds = useCallback(async (bbox: string, place: string | null | undefined) => {
    setLoadingFeeds(true);
    setFeedError(null);
    try {
      const results = await fetchGtfsFeeds(bbox, place ?? undefined);
      setFeeds(results);
    } catch (e: unknown) {
      setFeedError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingFeeds(false);
    }
  }, []);

  useEffect(() => {
    if (aoiBbox) loadFeeds(aoiBbox, placeQueryForFeeds);
  }, [aoiBbox, placeQueryForFeeds, loadFeeds]);

  function toggleFeed(id: string) {
    if (selectedFeedIds.includes(id)) {
      onChangeFeedIds(selectedFeedIds.filter((f) => f !== id));
    } else {
      onChangeFeedIds([...selectedFeedIds, id]);
    }
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
        Service Hours
      </h3>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-white/5 p-3">
          <p className="mb-1 text-xs text-gray-400">Start hour</p>
          <input
            type="number" min={0} max={23} step={1}
            value={startHour}
            onChange={(e) => onChangeStartHour(Number(e.target.value))}
            className="w-full bg-transparent text-lg font-semibold text-white outline-none"
          />
        </div>
        <div className="rounded-xl bg-white/5 p-3">
          <p className="mb-1 text-xs text-gray-400">End hour</p>
          <input
            type="number" min={0} max={23} step={1}
            value={endHour}
            onChange={(e) => onChangeEndHour(Number(e.target.value))}
            className="w-full bg-transparent text-lg font-semibold text-white outline-none"
          />
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-gray-400">
          GTFS Feeds
        </h3>

        {!aoiBbox && (
          <p className="text-xs text-gray-500">Loading AOI to search feeds...</p>
        )}

        {aoiBbox && loadingFeeds && (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <div className="h-3 w-3 animate-spin rounded-full border border-gray-500 border-t-purple-400" />
            Searching Mobility Database...
          </div>
        )}

        {feedError && (
          <p className="text-xs text-red-400">{feedError}</p>
        )}

        {!loadingFeeds && feeds.length === 0 && aoiBbox && !feedError && (
          <p className="text-xs text-gray-500">No feeds found for this area.</p>
        )}

        {feeds.length > 0 && (
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {feeds.map((feed) => (
              <label
                key={feed.id}
                className="flex cursor-pointer items-start gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm transition hover:bg-white/10"
              >
                <input
                  type="checkbox"
                  checked={selectedFeedIds.includes(feed.id)}
                  onChange={() => toggleFeed(feed.id)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-purple-500"
                />
                <div>
                  <p className="font-medium text-gray-200">{feed.provider}</p>
                  {feed.name !== feed.provider && (
                    <p className="text-xs text-gray-500">{feed.name}</p>
                  )}
                </div>
              </label>
            ))}
          </div>
        )}

        {feeds.length > 0 && selectedFeedIds.length === 0 && (
          <p className="mt-1 text-xs text-amber-400">Select at least one feed to run analysis.</p>
        )}
      </div>
    </div>
  );
}
