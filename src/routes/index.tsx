import { createFileRoute, Link } from "@tanstack/react-router";
import { EquiCompassLogo } from "@/components/EquiCompassLogo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  PieChart, Users, TrendingUp, Globe,
  XCircle, CheckCircle2, ArrowRight, Github,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "EquiCompass — Know what you give away before you sign" },
      { name: "description", content: "Equity dilution simulator for Indian and US founders. Model VC rounds, SAFEs, board seats and liquidation preferences in minutes." },
      { property: "og:title", content: "EquiCompass — Equity Dilution Simulator" },
      { property: "og:description", content: "Model every VC round, SAFE, board seat, and liquidation preference before you sign the term sheet." },
      { property: "og:type", content: "website" },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-white">

      {/* ── Nav ──────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b" style={{ borderColor: "oklch(0.22 0.04 265 / 0.08)" }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <EquiCompassLogo variant="nav" />
          <div className="flex items-center gap-2">
            <a href="https://github.com/EquiCompass/founders-equity-compass" target="_blank" rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-full border transition-colors hover:bg-gray-50"
              style={{ color: "oklch(0.22 0.04 265)", borderColor: "oklch(0.22 0.04 265 / 0.2)" }}>
              <Github className="h-3.5 w-3.5" /> GitHub
            </a>
            <Link to="/simulator">
              <button className="text-sm font-semibold px-5 py-2 rounded-full transition-all"
                style={{ background: "oklch(0.22 0.04 265)", color: "white" }}
                onMouseEnter={e => { (e.target as HTMLElement).style.background = "oklch(0.76 0.15 285)"; (e.target as HTMLElement).style.color = "oklch(0.22 0.04 265)"; }}
                onMouseLeave={e => { (e.target as HTMLElement).style.background = "oklch(0.22 0.04 265)"; (e.target as HTMLElement).style.color = "white"; }}>
                Open simulator
              </button>
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section style={{ background: "linear-gradient(135deg, oklch(0.22 0.04 265) 0%, oklch(0.28 0.07 270) 50%, oklch(0.35 0.1 275) 100%)" }} className="relative overflow-hidden">
        {/* Decorative lavender blobs */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full opacity-20"
            style={{ background: "oklch(0.76 0.15 285)" }} />
          <div className="absolute bottom-0 left-1/4 w-64 h-64 rounded-full opacity-10"
            style={{ background: "oklch(0.87 0.07 270)" }} />
        </div>

        <div className="relative mx-auto max-w-6xl px-6 py-24 md:py-32">
          <div className="max-w-3xl">
            <div className="mb-6 flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium" style={{ background: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.85)", border: "1px solid rgba(255,255,255,0.15)" }}>
                🇮🇳 India · 🇺🇸 US · Free & open source
              </span>
            </div>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-white leading-[1.05]">
              Know exactly what<br />you're giving away<br />
              <span style={{ color: "oklch(0.76 0.15 285)" }}>before you sign.</span>
            </h1>
            <p className="mt-6 text-lg md:text-xl max-w-2xl" style={{ color: "rgba(255,255,255,0.7)" }}>
              Model every VC round, SAFE, board seat, and liquidation preference — in minutes. No login required.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <Link to="/decode">
                <button className="flex items-center gap-2 text-base font-semibold px-7 py-3.5 rounded-full transition-all shadow-lg"
                  style={{ background: "oklch(0.76 0.15 285)", color: "oklch(0.22 0.04 265)" }}>
                  Got a term sheet? Decode it <ArrowRight className="h-4 w-4" />
                </button>
              </Link>
              <Link to="/simulator">
                <button className="flex items-center gap-2 text-base font-semibold px-7 py-3.5 rounded-full transition-all"
                  style={{ background: "rgba(255,255,255,0.1)", color: "white", border: "1.5px solid rgba(255,255,255,0.2)" }}>
                  Explore the simulator
                </button>
              </Link>
              <a href="https://github.com/EquiCompass/founders-equity-compass" target="_blank" rel="noopener noreferrer">
                <button className="flex items-center gap-2 text-base font-semibold px-7 py-3.5 rounded-full transition-all"
                  style={{ background: "rgba(255,255,255,0.1)", color: "white", border: "1.5px solid rgba(255,255,255,0.2)" }}>
                  <Github className="h-4 w-4" /> View on GitHub
                </button>
              </a>
            </div>
          </div>
        </div>

        {/* Bottom wave */}
        <div className="absolute bottom-0 left-0 right-0 h-12 bg-white" style={{ clipPath: "ellipse(55% 100% at 50% 100%)" }} />
      </section>

      {/* ── Stats strip ──────────────────────────────────────── */}
      <section className="bg-white border-b" style={{ borderColor: "oklch(0.22 0.04 265 / 0.08)" }}>
        <div className="mx-auto max-w-6xl px-6 py-8 grid grid-cols-2 md:grid-cols-4 gap-6">
          {[
            { label: "Funding rounds", value: "5" },
            { label: "Anti-dilution models", value: "3" },
            { label: "Veto rights tracked", value: "24" },
            { label: "Markets supported", value: "2" },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-3xl font-bold tracking-tight" style={{ color: "oklch(0.22 0.04 265)" }}>{s.value}</div>
              <div className="text-sm mt-1" style={{ color: "oklch(0.52 0.03 265)" }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Problem / Solution ───────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl p-8 border" style={{ background: "oklch(0.99 0.003 27)", borderColor: "oklch(0.577 0.245 27 / 0.15)" }}>
            <h3 className="text-xl font-semibold mb-6" style={{ color: "oklch(0.22 0.04 265)" }}>What founders get wrong</h3>
            <ul className="space-y-4">
              {[
                "Board control silently lost at Series A",
                "Liquidation preferences wipe out founder exit",
                "ESOP top-ups dilute only founders, not VCs",
              ].map((t) => (
                <li key={t} className="flex gap-3 items-start">
                  <XCircle className="h-5 w-5 shrink-0 mt-0.5 text-red-500" />
                  <span className="text-sm" style={{ color: "oklch(0.4 0.03 265)" }}>{t}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl p-8 border" style={{ background: "oklch(0.975 0.008 285)", borderColor: "oklch(0.76 0.15 285 / 0.3)" }}>
            <h3 className="text-xl font-semibold mb-6" style={{ color: "oklch(0.22 0.04 265)" }}>What EquiCompass shows you</h3>
            <ul className="space-y-4">
              {[
                "Exact board seat math round-by-round",
                "Exit waterfall with 1× / 2× prefs modelled",
                "Pre-money vs post-money ESOP impact, side by side",
              ].map((t) => (
                <li key={t} className="flex gap-3 items-start">
                  <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" style={{ color: "oklch(0.62 0.16 150)" }} />
                  <span className="text-sm font-medium" style={{ color: "oklch(0.28 0.03 265)" }}>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Feature cards ────────────────────────────────────── */}
      <section style={{ background: "oklch(0.975 0.008 285)" }} className="py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight" style={{ color: "oklch(0.22 0.04 265)" }}>
              Everything before the term sheet lands
            </h2>
            <p className="mt-3 text-base" style={{ color: "oklch(0.52 0.03 265)" }}>Eight tools in one simulator. No spreadsheets.</p>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            {[
              { icon: PieChart, title: "Cap Table Simulator", desc: "Model Seed → Series C with SAFEs, priced rounds and ESOP top-ups. See dilution at every step.", color: "oklch(0.76 0.15 285)" },
              { icon: Users, title: "Board Control Tracker", desc: "Watch founder, investor and independent seats shift across rounds. Know when you lose the room.", color: "oklch(0.62 0.16 150)" },
              { icon: TrendingUp, title: "Exit Payout Calculator", desc: "Project individual founder payouts at any exit valuation, with 1× and 2× liquidation preferences.", color: "oklch(0.75 0.16 75)" },
              { icon: Globe, title: "India / US Benchmarks", desc: "Term sheet norms from both markets — ESOP sizing, preference stacks and board composition.", color: "oklch(0.6 0.22 25)" },
            ].map((f) => (
              <div key={f.title} className="bg-white rounded-2xl p-8 border shadow-sm transition-shadow hover:shadow-md" style={{ borderColor: "oklch(0.22 0.04 265 / 0.08)" }}>
                <div className="flex h-11 w-11 items-center justify-center rounded-xl mb-5" style={{ background: `${f.color}22` }}>
                  <f.icon className="h-5 w-5" style={{ color: f.color }} />
                </div>
                <h3 className="text-base font-semibold mb-2" style={{ color: "oklch(0.22 0.04 265)" }}>{f.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: "oklch(0.52 0.03 265)" }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA banner ───────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="rounded-3xl px-8 py-16 md:px-16 text-center relative overflow-hidden"
          style={{ background: "linear-gradient(135deg, oklch(0.22 0.04 265) 0%, oklch(0.35 0.1 275) 100%)" }}>
          <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full opacity-20" style={{ background: "oklch(0.76 0.15 285)" }} />
          <div className="relative">
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-white">
              Your next term sheet is coming.
              <br />
              <span style={{ color: "oklch(0.76 0.15 285)" }}>Be ready.</span>
            </h2>
            <p className="mt-4 text-base" style={{ color: "rgba(255,255,255,0.65)" }}>Free, open source, no account needed.</p>
            <div className="mt-8">
              <Link to="/simulator">
                <button className="inline-flex items-center gap-2 text-base font-semibold px-8 py-4 rounded-full transition-all"
                  style={{ background: "oklch(0.76 0.15 285)", color: "oklch(0.22 0.04 265)" }}>
                  Open EquiCompass <ArrowRight className="h-4 w-4" />
                </button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer className="border-t" style={{ borderColor: "oklch(0.22 0.04 265 / 0.08)" }}>
        <div className="mx-auto max-w-6xl px-6 py-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div>
            <EquiCompassLogo variant="nav" iconSize={26} className="mb-2" />
            <p className="text-xs max-w-md" style={{ color: "oklch(0.52 0.03 265)" }}>
              For negotiation planning only — not legal advice. MIT licence.
            </p>
          </div>
          <nav className="flex flex-wrap gap-6 text-sm" style={{ color: "oklch(0.52 0.03 265)" }}>
            <Link to="/" className="hover:text-foreground transition-colors">Home</Link>
            <Link to="/simulator" className="hover:text-foreground transition-colors">Simulator</Link>
            <Link to="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
            <Link to="/terms" className="hover:text-foreground transition-colors">Terms of Use</Link>
            <a href="https://github.com/EquiCompass/founders-equity-compass" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors flex items-center gap-1">
              <Github className="h-3.5 w-3.5" /> GitHub
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}