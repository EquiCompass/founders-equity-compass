import { createFileRoute } from "@tanstack/react-router";
import { EquiCompassLogo } from "@/components/EquiCompassLogo";
import { useEffect, useState } from "react";
import { Simulator } from "@/components/Simulator";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ExportButton } from "@/components/ExportButton";
import { DECODED_STATE_KEY } from "@/components/TermSheetDecoder";
import { DEFAULT_STATE, type SimulatorState } from "@/lib/equity/types";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/simulator")({
  head: () => ({
    meta: [{ title: "EquiCompass — Equity Simulator" }],
  }),
  component: SimulatorPage,
});

function SimulatorPage() {
  const [state, setState] = useState<SimulatorState>(DEFAULT_STATE);

  // Pick up a deal handed over from the term-sheet decoder (/decode).
  // Done in an effect (not the useState initializer) to stay SSR/hydration-safe.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DECODED_STATE_KEY);
      if (raw) {
        sessionStorage.removeItem(DECODED_STATE_KEY);
        setState({ ...DEFAULT_STATE, ...(JSON.parse(raw) as SimulatorState) });
      }
    } catch {
      /* corrupt or unavailable storage — keep defaults */
    }
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* Dark navy header */}
      <header style={{ background: "oklch(0.22 0.04 265)" }} className="border-b border-white/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3.5">
          <Link to="/" className="flex items-center gap-2.5 group">
            <EquiCompassLogo variant="nav" dark={true} />
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/decode" className="text-xs font-medium text-white/60 hover:text-white transition-colors">
              Decode a term sheet
            </Link>
            <span className="hidden sm:inline text-xs text-white/40 font-medium">
              All changes saved locally
            </span>
            <ExportButton state={state} scenarioName="My Scenario" />
          </div>
        </div>
      </header>

      {/* Subtle gradient strip below header */}
      <div
        className="h-1 w-full"
        style={{ background: "linear-gradient(90deg, oklch(0.76 0.15 285), oklch(0.87 0.07 270), oklch(0.76 0.15 285))" }}
      />

      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-6">
        <ErrorBoundary>
          <Simulator state={state} onChange={setState} />
        </ErrorBoundary>
      </main>
    </div>
  );
}
