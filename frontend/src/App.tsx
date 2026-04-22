import { useState } from "react";
import LandingPage from "./components/LandingPage";
import AnalysisPage from "./components/AnalysisPage";
import ErrorBoundary from "./components/ErrorBoundary";
import type { AnalysisMode, AoiSelection } from "./types";

export default function App() {
  const [mode, setMode] = useState<AnalysisMode>("gtfs");
  const [aoi, setAoi] = useState<AoiSelection | null>(null);

  if (!aoi) {
    return (
      <LandingPage
        mode={mode}
        onSelectMode={setMode}
        onSelect={setAoi}
      />
    );
  }

  return (
    <ErrorBoundary>
      <AnalysisPage
        mode={mode}
        aoi={aoi}
        onBack={() => setAoi(null)}
      />
    </ErrorBoundary>
  );
}
