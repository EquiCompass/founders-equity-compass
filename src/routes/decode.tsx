import { createFileRoute, Link } from "@tanstack/react-router";
import { EquiCompassLogo } from "@/components/EquiCompassLogo";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { TermSheetDecoder } from "@/components/TermSheetDecoder";

export const Route = createFileRoute("/decode")({
  head: () => ({
    meta: [
      { title: "EquiCompass — Decode your term sheet" },
      { name: "description", content: "Got a term sheet? Answer 8 questions off the document and see what you take home, whether you keep control, and exactly what to push back on." },
    ],
  }),
  component: DecodePage,
});

function DecodePage() {
  return (
    <div className="min-h-screen bg-background">
      <header style={{ background: "oklch(0.22 0.04 265)" }} className="border-b border-white/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3.5">
          <Link to="/" className="flex items-center gap-2.5 group">
            <EquiCompassLogo variant="nav" dark={true} />
          </Link>
          <Link to="/simulator" className="text-xs font-medium text-white/60 hover:text-white transition-colors">
            Skip to full simulator →
          </Link>
        </div>
      </header>
      <div
        className="h-1 w-full"
        style={{ background: "linear-gradient(90deg, oklch(0.76 0.15 285), oklch(0.87 0.07 270), oklch(0.76 0.15 285))" }}
      />
      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
        <ErrorBoundary>
          <TermSheetDecoder />
        </ErrorBoundary>
      </main>
    </div>
  );
}
