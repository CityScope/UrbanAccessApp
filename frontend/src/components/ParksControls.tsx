interface Props {
  distanceWalk: number;
  onChangeWalk: (v: number) => void;
}

export default function ParksControls({ distanceWalk, onChangeWalk }: Props) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
        Walking Distance
      </h3>
      <div className="rounded-xl bg-emerald-500/10 p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-emerald-400">Walking</span>
          <span className="rounded-lg bg-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-300">
            {(distanceWalk / 1000).toFixed(2)} km
          </span>
        </div>
        <input
          type="range"
          min={100} max={2000} step={50}
          value={distanceWalk}
          onChange={(e) => onChangeWalk(Number(e.target.value))}
          className="w-full accent-emerald-500 h-1.5 cursor-pointer appearance-none rounded-full bg-white/10"
        />
        <div className="mt-1 flex justify-between text-[10px] text-gray-500">
          <span>0.1 km</span>
          <span>2.0 km</span>
        </div>
      </div>
      <p className="text-xs text-gray-500">
        Area reachable on foot from any park entrance.
      </p>
    </div>
  );
}
