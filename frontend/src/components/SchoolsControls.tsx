interface Props {
  distanceWalk: number;
  distanceBike: number;
  distanceCar: number;
  kidsOnly: boolean;
  onChangeWalk: (v: number) => void;
  onChangeBike: (v: number) => void;
  onChangeCar: (v: number) => void;
  onChangeKidsOnly: (v: boolean) => void;
}

const MODES = [
  { label: "Walking",  color: "emerald", min: 200,  max: 3000,  step: 100, key: 0 },
  { label: "Biking",   color: "blue",    min: 500,  max: 8000,  step: 250, key: 1 },
  { label: "Bus/Car",  color: "amber",   min: 1000, max: 20000, step: 500, key: 2 },
] as const;

const C = {
  emerald: { bg: "bg-emerald-500/10", text: "text-emerald-400", accent: "accent-emerald-500", badge: "bg-emerald-500/20 text-emerald-300" },
  blue:    { bg: "bg-blue-500/10",    text: "text-blue-400",    accent: "accent-blue-500",    badge: "bg-blue-500/20 text-blue-300"    },
  amber:   { bg: "bg-amber-500/10",   text: "text-amber-400",   accent: "accent-amber-500",   badge: "bg-amber-500/20 text-amber-300"  },
};

export default function SchoolsControls(props: Props) {
  const values = [props.distanceWalk, props.distanceBike, props.distanceCar];
  const handlers = [props.onChangeWalk, props.onChangeBike, props.onChangeCar];

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
        Distance Thresholds
      </h3>
      {MODES.map((mode, i) => {
        const c = C[mode.color];
        return (
          <div key={mode.label} className={`rounded-xl ${c.bg} p-4`}>
            <div className="mb-2 flex items-center justify-between">
              <span className={`text-sm font-medium ${c.text}`}>{mode.label}</span>
              <span className={`rounded-lg px-2 py-0.5 text-xs font-semibold ${c.badge}`}>
                {(values[i] / 1000).toFixed(1)} km
              </span>
            </div>
            <input
              type="range"
              min={mode.min} max={mode.max} step={mode.step}
              value={values[i]}
              onChange={(e) => handlers[i](Number(e.target.value))}
              className={`w-full ${c.accent} h-1.5 cursor-pointer appearance-none rounded-full bg-white/10`}
            />
            <div className="mt-1 flex justify-between text-[10px] text-gray-500">
              <span>{(mode.min / 1000).toFixed(1)} km</span>
              <span>{(mode.max / 1000).toFixed(1)} km</span>
            </div>
          </div>
        );
      })}
      <label className="flex cursor-pointer items-center gap-3 rounded-xl bg-white/5 p-3">
        <input
          type="checkbox"
          checked={props.kidsOnly}
          onChange={(e) => props.onChangeKidsOnly(e.target.checked)}
          className="h-4 w-4 accent-emerald-500"
        />
        <span className="text-sm text-gray-300">Children under 18 only (population)</span>
      </label>
    </div>
  );
}
