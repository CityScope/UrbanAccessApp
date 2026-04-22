import type { StatsRow } from "../types";

// Colors for schools/parks modes
const ROW_COLORS: Record<string, string> = {
  walk: "text-emerald-400",
  bike: "text-blue-400",
  "bus/car": "text-amber-400",
  "total population": "text-white",
};

const BAR_COLORS: Record<string, string> = {
  walk: "bg-emerald-500",
  bike: "bg-blue-500",
  "bus/car": "bg-amber-500",
};

// GTFS LOS grade colors (A=green, B=yellow, C=orange, D=red, E=purple, F=blue)
const LOS_GRADE_BG: Record<string, string> = {
  A1: "bg-[#68b684]", A2: "bg-[#40916c]", A3: "bg-[#1b4332]",
  B1: "bg-[#f1c40f]", B2: "bg-[#d4ac0d]", B3: "bg-[#b7950b]",
  C1: "bg-[#ffa75a]", C2: "bg-[#fa8246]", C3: "bg-[#cf5600]",
  D: "bg-[#b30202]",
  E: "bg-[#9b59b6]",
  F: "bg-[#0051ff]",
};

function getBarClass(acc: string): string {
  return BAR_COLORS[acc] ?? LOS_GRADE_BG[acc] ?? "bg-gray-500";
}

function getTextClass(acc: string): string {
  return ROW_COLORS[acc] ?? "text-gray-300";
}

interface Props {
  stats: StatsRow[];
}

export default function StatsPanel({ stats }: Props) {
  const dataRows = stats.filter((r) => r.accessibility !== "total population");
  const totalRow = stats.find((r) => r.accessibility === "total population");

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
        Population Coverage
      </h3>

      {dataRows.map((row) => (
        <div key={row.accessibility} className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className={`font-medium capitalize ${getTextClass(row.accessibility)}`}>
              {row.accessibility}
            </span>
            <span className="tabular-nums text-gray-300">
              {row.population.toLocaleString()} ({row.population_pct}%)
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
            <div
              className={`h-full rounded-full transition-all duration-500 ${getBarClass(row.accessibility)}`}
              style={{ width: `${Math.min(row.population_pct, 100)}%` }}
            />
          </div>
        </div>
      ))}

      {totalRow && (
        <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-sm font-semibold text-white">
          <span>Total Population</span>
          <span className="tabular-nums">{totalRow.population.toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}
