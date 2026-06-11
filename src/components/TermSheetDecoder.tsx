import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { computeSnaps, calcPayouts, latestSnap, fmtM } from "@/lib/equity/calc";
import {
  INDIA_DEFAULT_ROUNDS,
  US_DEFAULT_ROUNDS,
  ROUND_BENCHMARKS,
  US_ROUND_BENCHMARKS,
  ROUND_BENCHMARK_NOTES,
  ROUND_LABELS,
  type Holder,
  type Market,
  type RoundKey,
  type SimulatorState,
} from "@/lib/equity/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { OwnershipGauge } from "@/components/OwnershipGauge";
import { cn } from "@/lib/utils";

/** sessionStorage key used to hand the decoded deal to /simulator */
export const DECODED_STATE_KEY = "equicompass.decoded";

type PrefChoice = "1x-non" | "1x-part" | "2x-non" | "2x-part" | "unsure";
type AdChoice = "none" | "bbwa" | "ratchet" | "unsure";
type Leverage = "competing" | "normal" | "tight";

interface Answers {
  mkt: Market;
  round: RoundKey;
  pre: number;
  inv: number;
  pref: PrefChoice;
  ad: AdChoice;
  esopT: number;
  board: "0" | "observer" | "1" | "2";
  redemption: boolean;
  fdr: number;
  esopNow: number;
  you: number;
}

const DEFAULT_ANSWERS: Answers = {
  mkt: "india", round: "a", pre: 18, inv: 6,
  pref: "1x-non", ad: "bbwa", esopT: 12, board: "1",
  redemption: false, fdr: 85, esopNow: 10, you: 45,
};

/** Build a full SimulatorState from decoded answers — single source of truth
 *  so the decoder and the full simulator always agree. */
export function buildDecodedState(a: Answers, exitValue: number): SimulatorState {
  const base = a.mkt === "us" ? US_DEFAULT_ROUNDS : INDIA_DEFAULT_ROUNDS;
  const rounds = Object.fromEntries(
    Object.entries(base).map(([k, r]) => [k, { ...r, enabled: false }]),
  ) as SimulatorState["rounds"];
  rounds[a.round] = {
    ...rounds[a.round],
    enabled: true,
    preMoney: a.pre,
    raise: a.inv,
    esop: a.esopT,
    board: a.board === "0" ? "0" : a.board,
    prefMult: a.pref.startsWith("2x") ? 2 : 1,
    prefType: a.pref.endsWith("part") ? "part" : "non",
    antiDilution: a.ad === "ratchet" ? "full-ratchet" : a.ad === "none" ? "none" : "bbwa",
    redemptionEnabled: a.redemption,
    secondary: 0,
    prorata: 0,
  };

  const others = Math.max(0, 100 - a.fdr - a.esopNow);
  const coFounders = Math.max(0, a.fdr - a.you);
  const founders: Holder[] = [
    { name: "Founder 1", role: "You", pct: a.you, type: "founder" },
    ...(coFounders > 0 ? [{ name: "Founder 2", role: "Co-founders", pct: coFounders, type: "founder" as const }] : []),
    { name: "ESOP Pool", role: "Employees", pct: a.esopNow, type: "esop" },
    ...(others > 0 ? [{ name: "Advisory Pool", role: "Angels & advisors", pct: others, type: "advisory" as const }] : []),
  ];

  return {
    founderSeats: 2,
    market: a.mkt,
    founderStructure: a.mkt === "us" ? "us" : "india-only",
    safe: { enabled: false, amount: 0, cap: 0, discount: 0, mfn: false },
    rounds,
    exitValue,
    usePref: true,
    vestingEnabled: false,
    accelerationAtExit: true,
    vesting: {},
    founders,
  };
}

/* ───────────────────────── intake UI helpers ───────────────────────── */

function Opt({ sel, title, desc, onClick }: { sel: boolean; title: string; desc?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-lg border p-3.5 text-left transition-colors",
        sel ? "border-accent bg-accent/10" : "border-border bg-card hover:border-accent/60",
      )}
    >
      <div className="text-sm font-semibold">{title}</div>
      {desc && <div className="mt-0.5 text-xs text-muted-foreground">{desc}</div>}
    </button>
  );
}

function QHeader({ n, title, hint }: { n: number; title: string; hint: string }) {
  return (
    <>
      <div className="text-[11px] font-bold tracking-widest text-accent">QUESTION {n} OF 8</div>
      <h2 className="mt-1 text-lg font-semibold">{title}</h2>
      <p className="mb-4 mt-0.5 text-xs text-muted-foreground">{hint}</p>
    </>
  );
}

/* ───────────────────────── advice model ───────────────────────── */

type Concede = "high" | "medium" | "low";
const CONCEDE_LABEL: Record<Concede, string> = {
  high: "VCs usually concede this",
  medium: "Often negotiable",
  low: "Rarely moves without competition",
};

interface Flag {
  tier: "blocker" | "ask" | "confirm";
  cost?: number;
  concede: Concede;
  title: string;
  body: string;
  ask: string;
}

interface AcceptItem { title: string; note: string }

/* ───────────────────────── component ───────────────────────── */

export function TermSheetDecoder() {
  const navigate = useNavigate();
  const [a, setA] = useState<Answers>(DEFAULT_ANSWERS);
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [exitVal, setExitVal] = useState(50);
  const [leverage, setLeverage] = useState<Leverage>("normal");
  const [showFull, setShowFull] = useState(false);
  const set = <K extends keyof Answers>(k: K, v: Answers[K]) => setA((p) => ({ ...p, [k]: v }));

  const capOk = a.fdr + a.esopNow <= 100 && a.you <= a.fdr && a.fdr > 0;

  const state = useMemo(() => buildDecodedState(a, exitVal), [a, exitVal]);
  const snap = useMemo(() => latestSnap(computeSnaps(state)), [state]);
  const payouts = useMemo(() => calcPayouts(snap, exitVal, true), [snap, exitVal]);

  /** Re-run the waterfall under modified terms — used to price each pushback in $. */
  const youUnder = (patch: Partial<Answers>, ev = exitVal) => {
    const s = buildDecodedState({ ...a, ...patch }, ev);
    const sn = latestSnap(computeSnaps(s));
    return calcPayouts(sn, ev, true)["Founder 1"] ?? 0;
  };

  const openSimulator = () => {
    try {
      sessionStorage.setItem(DECODED_STATE_KEY, JSON.stringify(state));
    } catch {
      /* private mode — simulator falls back to defaults */
    }
    navigate({ to: "/simulator" });
  };

  /* ── derived results ── */
  const mult = a.pref.startsWith("2x") ? 2 : 1;
  const part = a.pref.endsWith("part");
  const bench = (a.mkt === "us" ? US_ROUND_BENCHMARKS : ROUND_BENCHMARKS)[a.round];
  const vcH = snap.holders.find((h) => h.type === "vc");
  const vcPct = vcH?.pct ?? 0;
  const fdrPct = snap.holders.filter((h) => h.type === "founder").reduce((s, h) => s + h.pct, 0);
  const youPct = snap.holders.find((h) => h.name === "Founder 1")?.pct ?? 0;
  const youBase = payouts["Founder 1"] ?? 0;
  const vcSeats = snap.vcSeats;

  /* ── build flags in three tiers ── */
  const blockers: Flag[] = [];
  const allAsks: Flag[] = [];
  const confirms: Flag[] = [];
  const accepts: AcceptItem[] = [];

  if (a.ad === "ratchet") {
    const downPre = (a.pre + a.inv) * 0.6;
    const boosted = vcPct * ((a.pre + a.inv) / downPre);
    blockers.push({
      tier: "blocker", concede: "high",
      title: "Full ratchet anti-dilution — fix before signing",
      body: `If your next round prices 40% lower, this investor jumps from ${vcPct.toFixed(1)}% to ~${boosted.toFixed(1)}% at your expense. No serious VC defends full ratchet when challenged — it's not market standard anywhere.`,
      ask: 'Ask to replace with "broad-based weighted average" — the standard in both India and the US. This is a 5-minute redline, not a fight.',
    });
  } else if (a.ad === "bbwa") {
    accepts.push({ title: "Broad-based weighted average anti-dilution", note: "Market standard. Don't spend a chip here." });
  } else if (a.ad === "none") {
    accepts.push({ title: "No anti-dilution protection", note: "Rare and founder-friendly. Say nothing." });
  }

  if (mult > 1) {
    blockers.push({
      tier: "blocker", concede: "high",
      cost: youUnder({ pref: part ? "1x-part" : "1x-non" }) - youBase,
      title: `${mult}x preference multiple — fix before signing`,
      body: `${fmtM(a.inv * mult)} comes off the top before common sees anything. Above-1x multiples are a price negotiation in disguise.`,
      ask: "Ask for 1x — universal standard. If they want more downside protection, the honest conversation is valuation, not multiple.",
    });
  }

  if (part) {
    allAsks.push({
      tier: "ask", concede: "high",
      cost: youUnder({ pref: mult === 2 ? "2x-non" : "1x-non" }) - youBase,
      title: 'Ask to remove "participating"',
      body: `At a ${fmtM(exitVal)} exit this costs you personally the amount shown. Non-participating is the market norm at every stage in both markets.`,
      ask: a.mkt === "india"
        ? 'Proposed language: "Investors elect preference OR pro-rata — not both." Frame it as conforming to India market standard, not as a concession.'
        : "Frame it as conforming to the NVCA model documents — most US funds accept without argument.",
    });
  } else if (mult === 1 && a.pref !== "unsure") {
    accepts.push({ title: "1x non-participating preference", note: "Exactly what you want. Accept as drafted." });
  }

  if (a.redemption) {
    allAsks.push({
      tier: "ask", concede: a.mkt === "us" ? "high" : "medium",
      title: "Ask to soften or remove redemption rights",
      body: `A ${fmtM(a.inv)}+ potential cash liability after ~5 years. ${a.mkt === "us" ? "Post-2015 NVCA documents omit redemption — most US VCs drop it when asked." : "Indian funds keep it for DPI optics but rarely enforce; most will cap and defer it."}`,
      ask: a.mkt === "india"
        ? "If they won't strike it: 1x cap (no premium), trigger only after year 7, payable in installments. Companies Act §68 limits enforcement anyway — use that, gently."
        : "Ask for removal citing NVCA. Fall-back: 1x cap, year-7 trigger, 75% preferred approval.",
    });
  } else {
    accepts.push({ title: "No redemption rights", note: "Good. Nothing to do." });
  }

  if (a.board === "2") {
    allAsks.push({
      tier: "ask", concede: "medium",
      title: "Ask to convert the second board seat to an observer",
      body: "Two investor seats after one round means investor + independent can outvote founders.",
      ask: "One seat for the lead is standard; offer the co-investor an observer seat. Reasonable funds accept this often — but a lead set on two seats rarely moves.",
    });
  } else if (a.board === "1") {
    accepts.push({ title: "One investor board seat", note: "Standard for a priced-round lead. Accept it — fighting this reads as naive." });
  } else if (a.board === "observer") {
    accepts.push({ title: "Observer seat only", note: "Founder-friendly. Accept." });
  }

  if (a.esopT >= 15) {
    allAsks.push({
      tier: "ask", concede: "medium",
      title: `Ask to size the ESOP top-up below ${a.esopT}%`,
      body: "The pool is created pre-money, so the entire top-up dilutes existing holders — not the investor.",
      ask: "Counter with a bottoms-up 18-month hiring plan. 10–12% is usually defensible. VCs concede when shown a real plan; they hold firm against naked pushback.",
    });
  } else if (a.esopT > 0) {
    accepts.push({ title: `ESOP top-up of ${a.esopT}%`, note: "Within market norms. Accept." });
  }

  if (vcPct > bench.hi) {
    allAsks.push({
      tier: "ask", concede: leverage === "competing" ? "medium" : "low",
      title: `Dilution above market (${vcPct.toFixed(1)}% vs ${bench.lo}–${bench.hi}% typical)`,
      body: ROUND_BENCHMARK_NOTES[a.mkt][a.round],
      ask: leverage === "competing"
        ? `You have competing offers — this is exactly when price moves. A pre-money of ${fmtM((a.inv * 100) / bench.hi - a.inv)} brings them to ${bench.hi}%.`
        : "Price rarely moves without a competing offer. If this is your only term sheet, take the structural wins above and let the price stand.",
    });
  } else {
    accepts.push({ title: `Dilution of ${vcPct.toFixed(1)}%`, note: `Within the ${bench.lo}–${bench.hi}% market range for ${ROUND_LABELS[a.round]}. Fair.` });
  }

  if (a.pref === "unsure") {
    confirms.push({ tier: "confirm", concede: "high", title: "Confirm the liquidation preference wording with your lawyer", body: 'We assumed 1x non-participating. If it says "participating", re-run this with that answer.', ask: "" });
  }
  if (a.ad === "unsure") {
    confirms.push({ tier: "confirm", concede: "high", title: "Confirm the anti-dilution clause", body: 'We assumed broad-based weighted average. If it says "full ratchet", treat it as a deal-breaker.', ask: "" });
  }

  /* ── leverage-aware ask budget: spend chips on the best battles only ── */
  const askBudget = leverage === "competing" ? 3 : leverage === "tight" ? 1 : 2;
  const concedeRank: Record<Concede, number> = { high: 0, medium: 1, low: 2 };
  const sortedAsks = [...allAsks].sort((x, y) => {
    const cx = x.cost ?? 0, cy = y.cost ?? 0;
    if (Math.abs(cy - cx) > 0.01) return cy - cx;
    return concedeRank[x.concede] - concedeRank[y.concede];
  });
  const asks = sortedAsks.slice(0, askBudget);
  const parked = sortedAsks.slice(askBudget);

  /* ── verdict ── */
  const verdict = blockers.length > 0
    ? {
        cls: "border-danger bg-danger/10",
        head: `Fix ${blockers.length === 1 ? "one deal-breaker" : `${blockers.length} deal-breakers`} — the rest of this deal can stand.`,
        body: leverage === "tight"
          ? "Even with short runway, these specific clauses cost more later than a quick redline costs now. VCs concede them when challenged — this is a fast fix, not a stand-off."
          : "These aren't negotiating positions; they're off-market terms no serious investor defends. Ask once, in writing, citing the market standard.",
      }
    : asks.length > 0
      ? {
          cls: "border-warning bg-warning/10",
          head: leverage === "competing"
            ? `Sign-able — and you have the leverage to win ${asks.length === 1 ? "your ask" : `all ${asks.length} asks`}.`
            : leverage === "tight"
              ? "Sign-able. Spend your one ask wisely, then close."
              : `Sign-able after ${asks.length === 1 ? "one quick ask" : `${asks.length} quick asks`}.`,
          body: leverage === "tight"
            ? "With limited runway, a closed round beats a perfect round. Make the single ask below once; if they decline, sign anyway."
            : "The structure is workable. Make the asks below in one short, friendly email — not a list of demands — and accept the rest as drafted.",
        }
      : {
          cls: "border-success bg-success/10",
          head: "This is a clean, market-standard term sheet.",
          body: leverage === "competing"
            ? "Even with competing offers, there's nothing structural to fix here. If you push, push on valuation — and gently. Don't manufacture a negotiation."
            : leverage === "tight"
              ? "Good news given your runway: nothing needs fixing. Confirm the details with your lawyer and close as fast as possible."
              : "Don't manufacture a negotiation. Confirm the details with your lawyer and sign while the offer is warm.",
        };

  /* ── collaborative memo ── */
  const memo = useMemo(() => {
    const blockerLines = blockers.map((f) => `  • ${f.title.replace(" — fix before signing", "")}: ${f.ask.split(".")[0]}.`).join("\n");
    const askLines = asks.map((f) => `  • ${f.title.replace(/^Ask to /, "").replace(/^./, (c) => c.toUpperCase())}${f.cost && f.cost > 0.005 ? ` (worth ${fmtM(f.cost)} to the founding team at a ${fmtM(exitVal)} exit)` : ""}`).join("\n");
    return `DRAFT EMAIL TO YOUR LEAD INVESTOR
─────────────────────────────────

Subject: ${ROUND_LABELS[a.round]} term sheet — ready to move quickly

Thank you for the term sheet — we're excited to partner with you,
and we want to move fast. The valuation and investment amount work
for us, and almost all of the documentation is fine as drafted.
${blockers.length > 0 ? `\nBefore we sign, we need to align on:\n${blockerLines}\n` : ""}${asks.length > 0 ? `\n${blockers.length > 0 ? "We'd also like to request" : "We have " + (asks.length === 1 ? "one request" : asks.length + " requests")}:\n${askLines}\n` : ""}
Everything else stands as drafted. If we can align on the above,
we're ready to sign this week.

─────────────────────────────────
PRIVATE NOTES — do not send
─────────────────────────────────
• Post-round: founders ${fdrPct.toFixed(1)}% | investor ${vcPct.toFixed(1)}% | you personally ${youPct.toFixed(1)}%
• Your take-home at a ${fmtM(exitVal)} exit under current terms: ${fmtM(youBase)}
• Concede odds: ${[...blockers, ...asks].map((f) => `${f.title.split(" — ")[0].replace(/^Ask to /, "")} → ${CONCEDE_LABEL[f.concede].toLowerCase()}`).join("; ") || "n/a"}
${parked.length > 0 ? `• Parked (not worth a chip right now): ${parked.map((f) => f.title.replace(/^Ask to /, "")).join("; ")}\n` : ""}${confirms.length > 0 ? `• Confirm with lawyer: ${confirms.map((f) => f.title.replace("Confirm the ", "")).join("; ")}\n` : ""}• Rule: one email, all asks at once, collaborative tone. Never drip-feed redlines.`;
  }, [blockers, asks, parked, confirms, a.round, exitVal, fdrPct, vcPct, youPct, youBase]);

  /* ─────────────── render: intake ─────────────── */
  if (!done) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-bold">You got a term sheet. Let's decode it.</h1>
        <p className="mt-1 mb-6 text-sm text-muted-foreground">
          Answer 8 questions straight off the document — takes 3 minutes. We'll tell you what you take home,
          whether you keep control, and which battles are actually worth fighting.
        </p>

        <div className="mb-6 flex gap-1.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className={cn("h-1 flex-1 rounded-full", i <= step ? "bg-accent" : "bg-border")} />
          ))}
        </div>

        <Card className="p-6">
          {step === 0 && (
            <>
              <QHeader n={1} title="Where are you incorporated, and which round is this?" hint='The round is in the heading — e.g. "Series A Preferred" or "Seed Preference Shares".' />
              <div className="mb-3 grid grid-cols-2 gap-2.5">
                <Opt sel={a.mkt === "india"} title="🇮🇳 India" onClick={() => set("mkt", "india")} />
                <Opt sel={a.mkt === "us"} title="🇺🇸 US (Delaware)" onClick={() => set("mkt", "us")} />
              </div>
              <div className="grid gap-2.5">
                {(Object.entries(ROUND_LABELS) as [RoundKey, string][]).map(([k, label]) => (
                  <Opt key={k} sel={a.round === k} title={label} onClick={() => set("round", k)} />
                ))}
              </div>
            </>
          )}
          {step === 1 && (
            <>
              <QHeader n={2} title="What are the headline numbers?" hint='Look for "Pre-Money Valuation" and "Investment Amount" — usually in the first table.' />
              <div className="grid grid-cols-2 gap-4">
                <label className="text-xs text-muted-foreground">
                  Pre-money valuation ($M)
                  <Input type="number" className="mt-1.5" value={a.pre} step={0.5} onChange={(e) => set("pre", +e.target.value || 0)} />
                </label>
                <label className="text-xs text-muted-foreground">
                  They're investing ($M)
                  <Input type="number" className="mt-1.5" value={a.inv} step={0.25} onChange={(e) => set("inv", +e.target.value || 0)} />
                </label>
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <QHeader n={3} title='What does the "Liquidation Preference" clause say?' hint='Find the words "participating" or "non-participating", and the multiple (1x / 2x).' />
              <div className="grid gap-2.5">
                <Opt sel={a.pref === "1x-non"} title="1x non-participating" desc="Market standard. Good." onClick={() => set("pref", "1x-non")} />
                <Opt sel={a.pref === "1x-part"} title="1x participating" desc="They get their money back AND their share of the rest. Double-dip." onClick={() => set("pref", "1x-part")} />
                <Opt sel={a.pref === "2x-non"} title="2x non-participating" desc="They get 2× their money before you see anything." onClick={() => set("pref", "2x-non")} />
                <Opt sel={a.pref === "2x-part"} title="2x participating" desc="Both. Aggressive — rarely market standard anywhere." onClick={() => set("pref", "2x-part")} />
                <Opt sel={a.pref === "unsure"} title="Can't find it / not sure" desc="We'll assume 1x non-participating and flag it for your lawyer." onClick={() => set("pref", "unsure")} />
              </div>
            </>
          )}
          {step === 3 && (
            <>
              <QHeader n={4} title='What does "Anti-Dilution" say?' hint='Look for "broad-based weighted average" or "full ratchet" in the protective provisions.' />
              <div className="grid gap-2.5">
                <Opt sel={a.ad === "bbwa"} title="Broad-based weighted average" desc="Market standard. Fine." onClick={() => set("ad", "bbwa")} />
                <Opt sel={a.ad === "ratchet"} title="Full ratchet" desc="Their price fully resets in a down round — your stake pays for it. Red flag." onClick={() => set("ad", "ratchet")} />
                <Opt sel={a.ad === "none"} title="No anti-dilution clause" desc="Rare but great for you." onClick={() => set("ad", "none")} />
                <Opt sel={a.ad === "unsure"} title="Not sure" desc="We'll assume weighted average and flag it." onClick={() => set("ad", "unsure")} />
              </div>
            </>
          )}
          {step === 4 && (
            <>
              <QHeader n={5} title="Do they require an ESOP pool top-up before closing?" hint='Look for "Option Pool" or "ESOP" — e.g. "the Company shall reserve 12% post-financing". This dilution comes out of your side, not theirs.' />
              <div className="grid gap-2.5">
                <Opt sel={a.esopT === 0} title="No top-up required" onClick={() => set("esopT", 0)} />
                <Opt sel={a.esopT === 10} title="Yes — 10% post-financing" onClick={() => set("esopT", 10)} />
                <Opt sel={a.esopT === 12} title="Yes — 12% post-financing" onClick={() => set("esopT", 12)} />
                <Opt sel={a.esopT === 15} title="Yes — 15% post-financing" desc="Common ask in US Series A. Negotiate it down to your actual 18-month hiring plan." onClick={() => set("esopT", 15)} />
                <div className={cn(
                  "flex items-center gap-3 rounded-lg border p-3.5 transition-colors",
                  ![0, 10, 12, 15].includes(a.esopT) ? "border-accent bg-accent/10" : "border-border bg-card",
                )}>
                  <span className="text-sm font-semibold">Yes — a different number:</span>
                  <Input
                    type="number"
                    className="w-24"
                    min={0}
                    max={40}
                    step={0.5}
                    placeholder="e.g. 8"
                    value={[0, 10, 12, 15].includes(a.esopT) ? "" : a.esopT}
                    onChange={(e) => {
                      const v = +e.target.value;
                      if (e.target.value !== "" && v >= 0 && v <= 40) set("esopT", v);
                    }}
                  />
                  <span className="text-xs text-muted-foreground">% post-financing</span>
                </div>
              </div>
            </>
          )}
          {step === 5 && (
            <>
              <QHeader n={6} title="How many board seats do they get?" hint='Under "Board of Directors". Count investor seats only.' />
              <div className="grid gap-2.5">
                <Opt sel={a.board === "0"} title="None" onClick={() => set("board", "0")} />
                <Opt sel={a.board === "observer"} title="Observer only" desc="No vote — fine." onClick={() => set("board", "observer")} />
                <Opt sel={a.board === "1"} title="1 seat" desc="Standard for a priced round lead." onClick={() => set("board", "1")} />
                <Opt sel={a.board === "2"} title="2 seats" desc="Aggressive for a single round — flag." onClick={() => set("board", "2")} />
              </div>
            </>
          )}
          {step === 6 && (
            <>
              <QHeader n={7} title='Is there a "Redemption Rights" clause?' hint='Lets the investor force the company to buy back their shares after ~5 years. Search the document for "redemption".' />
              <div className="grid gap-2.5">
                <Opt sel={!a.redemption} title="No" onClick={() => set("redemption", false)} />
                <Opt sel={a.redemption} title="Yes" desc="Investor can force a buyback after ~5 years — a real cash liability." onClick={() => set("redemption", true)} />
              </div>
            </>
          )}
          {step === 7 && (
            <>
              <QHeader n={8} title="Who owns the company today?" hint="Your cap table before this round, adding up to 100%. Ballpark is fine." />
              <div className="grid grid-cols-3 gap-4">
                <label className="text-xs text-muted-foreground">
                  All founders together (%)
                  <Input type="number" className="mt-1.5" value={a.fdr} onChange={(e) => set("fdr", +e.target.value || 0)} />
                </label>
                <label className="text-xs text-muted-foreground">
                  ESOP pool (%)
                  <Input type="number" className="mt-1.5" value={a.esopNow} onChange={(e) => set("esopNow", +e.target.value || 0)} />
                </label>
                <label className="text-xs text-muted-foreground">
                  Angels / others (%)
                  <Input type="number" className="mt-1.5 opacity-70" value={Math.max(0, 100 - a.fdr - a.esopNow)} disabled />
                </label>
              </div>
              <p className={cn("mt-2.5 text-xs", a.fdr + a.esopNow > 100 ? "text-danger" : "text-muted-foreground")}>
                {a.fdr + a.esopNow > 100
                  ? "Founders + ESOP exceed 100% — adjust one of them."
                  : `Founders ${a.fdr}% + ESOP ${a.esopNow}% + others ${Math.max(0, 100 - a.fdr - a.esopNow)}% = 100% ✓`}
              </p>
              <label className="mt-4 block text-xs text-muted-foreground">
                Out of the founders' {a.fdr}%, how much is <b>yours personally</b>?
                <Input type="number" className="mt-1.5 max-w-[200px]" value={a.you} onChange={(e) => set("you", +e.target.value || 0)} />
              </label>
              {a.you > a.fdr && <p className="mt-1.5 text-xs text-danger">Your personal stake can't exceed the founders' total of {a.fdr}%.</p>}
            </>
          )}
        </Card>

        <div className="mt-4 flex justify-between">
          <Button variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))} className={cn(step === 0 && "invisible")}>
            ← Back
          </Button>
          <Button
            onClick={() => (step === 7 ? capOk && setDone(true) : setStep((s) => s + 1))}
            disabled={step === 7 && !capOk}
          >
            {step === 7 ? "Decode my term sheet →" : "Next →"}
          </Button>
        </div>
      </div>
    );
  }

  /* ─────────────── render: results (one screen, detail on demand) ─────────────── */
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-bold">Your term sheet, decoded.</h1>
        <Button variant="outline" size="sm" onClick={() => { setDone(false); setShowFull(false); }}>Edit answers</Button>
        <Button size="sm" onClick={openSimulator}>Open in full simulator →</Button>
      </div>

      {/* leverage selector — changes the advice, not the math */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Your position:</span>
        {([
          ["competing", "I have competing offers"],
          ["normal", "This is my main option"],
          ["tight", "Under 4 months of runway"],
        ] as [Leverage, string][]).map(([v, label]) => (
          <button
            key={v}
            type="button"
            onClick={() => setLeverage(v)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              leverage === v ? "border-accent bg-accent/15 text-foreground" : "border-border text-muted-foreground hover:border-accent/60",
            )}
          >
            {label}
          </button>
        ))}
        <span className="w-full text-[11px] text-muted-foreground sm:w-auto">
          → ask budget: <b>{askBudget}</b>{allAsks.length > 0 ? ` · using ${asks.length} of ${allAsks.length} possible asks` : " · nothing worth asking — this deal is clean"}
        </span>
      </div>

      <div className={cn("mb-5 rounded-xl border p-4", verdict.cls)}>
        <div className="font-bold">{verdict.head}</div>
        <div className="mt-0.5 text-sm text-muted-foreground">{verdict.body}</div>
      </div>

      {/* the one screen that matters: your number + the compass + your battles */}
      <Card className="mb-5 p-5">
        <div className="flex flex-wrap items-center gap-5">
          <OwnershipGauge pct={fdrPct} size={140} />
          <div className="mr-auto">
            <div className="font-display text-4xl font-bold" style={{ background: "linear-gradient(135deg, oklch(0.82 0.1 280), oklch(0.85 0.19 160))", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
              {fmtM(youBase)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              your personal take-home at a {fmtM(exitVal)} exit · you hold {youPct.toFixed(1)}% after this round
            </p>
            <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              exit value
              <Input type="number" className="w-24" value={exitVal} step={5} onChange={(e) => +e.target.value > 0 && setExitVal(+e.target.value)} />
              $M
            </label>
          </div>
        </div>
      </Card>

      {(blockers.length > 0 || asks.length > 0) && (
        <>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Your {blockers.length + asks.length === 1 ? "one battle" : `${blockers.length + asks.length} battles`} — ranked, everything else is fine
          </h2>
          <div className="mb-5 grid gap-3">
            {blockers.map((f) => (
              <Card key={f.title} className="border-l-4 border-l-danger p-4">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="text-sm font-semibold">{f.title}</div>
                  <span className="ml-auto rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-danger">Deal-breaker</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{f.body}</p>
                <p className="mt-1.5 text-xs font-medium">{f.ask}</p>
                <p className="mt-1.5 text-[11px] font-semibold text-success">{CONCEDE_LABEL[f.concede]}</p>
              </Card>
            ))}
            {asks.map((f) => (
              <Card key={f.title} className="border-l-4 border-l-warning p-4">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="text-sm font-semibold">{f.title}</div>
                  {f.cost !== undefined && f.cost > 0.005 && (
                    <span className="ml-auto text-sm font-bold text-warning">worth {fmtM(f.cost)} to you</span>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{f.body}</p>
                <p className="mt-1.5 text-xs font-medium">{f.ask}</p>
                <p className={cn("mt-1.5 text-[11px] font-semibold", f.concede === "high" ? "text-success" : f.concede === "medium" ? "text-warning" : "text-danger")}>
                  {CONCEDE_LABEL[f.concede]}
                </p>
              </Card>
            ))}
          </div>
        </>
      )}

      {accepts.length > 0 && (
        <Card className="mb-5 border-l-4 border-l-success p-4">
          <div className="text-sm font-semibold">Accept as drafted — don't spend chips here</div>
          <ul className="mt-2 grid gap-1">
            {accepts.map((it) => (
              <li key={it.title} className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{it.title}.</span> {it.note}
              </li>
            ))}
          </ul>
          {parked.length > 0 && (
            <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Parked for now:</span>{" "}
              {parked.map((f) => f.title.replace(/^Ask to /, "")).join("; ")} — real issues, but not worth your
              {leverage === "tight" ? " single ask" : ` ${askBudget} asks`} in this position.
            </p>
          )}
        </Card>
      )}

      {confirms.length > 0 && (
        <Card className="mb-5 border-l-4 border-l-warning p-4">
          <div className="text-sm font-semibold">Confirm with your lawyer</div>
          <ul className="mt-2 grid gap-1">
            {confirms.map((f) => (
              <li key={f.title} className="text-xs text-muted-foreground">{f.body}</li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mb-5 flex gap-2">
        <Button variant="outline" onClick={() => setShowFull((s) => !s)}>
          {showFull ? "Hide full analysis" : "Show full analysis →"}
        </Button>
        <Button onClick={() => navigator.clipboard?.writeText(memo)}>Copy negotiation email</Button>
      </div>

      {showFull && (
        <>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Payouts across exit values</h2>
          <Card className="mb-5 p-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1.5 font-medium">Exit value</th>
                  <th className="py-1.5 text-right font-medium">VC takes</th>
                  <th className="py-1.5 text-right font-medium">You take</th>
                </tr>
              </thead>
              <tbody>
                {[exitVal * 0.5, exitVal, exitVal * 2].map((ev) => {
                  const p = calcPayouts(snap, ev, true);
                  const vcTake = snap.holders.filter((h) => h.type === "vc").reduce((s, h) => s + (p[h.name] ?? 0), 0);
                  return (
                    <tr key={ev} className="border-t border-border">
                      <td className="py-1.5">{fmtM(ev)}</td>
                      <td className="py-1.5 text-right">{fmtM(vcTake)}</td>
                      <td className="py-1.5 text-right font-semibold">{fmtM(p["Founder 1"] ?? 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Control</h2>
          <div className="mb-5 grid gap-4 sm:grid-cols-3">
            <Card className="p-4">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Board</div>
              <div className={cn("mt-1 text-xl font-bold", vcSeats >= 2 ? "text-danger" : "text-success")}>
                {vcSeats === 0 ? "You control it" : `${vcSeats} investor seat${vcSeats > 1 ? "s" : ""}`}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {vcSeats >= 2
                  ? "Two investor seats after one round is aggressive — with an independent, you can be outvoted."
                  : vcSeats === 1
                    ? "Typical 2-1-1 board. You're not outvoted unless the independent sides against you."
                    : "No investor vote on the board."}
              </p>
            </Card>
            <Card className="p-4">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Founder ownership</div>
              <div className={cn("mt-1 text-xl font-bold", fdrPct >= 51 ? "text-success" : fdrPct >= 26 ? "text-warning" : "text-danger")}>
                {fdrPct.toFixed(1)}%
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {fdrPct >= 51
                  ? "Founders keep majority — you pass ordinary resolutions alone."
                  : fdrPct >= 26
                    ? a.mkt === "india"
                      ? "Below 51% you can't pass ordinary resolutions alone; above 26% you still block special resolutions (Companies Act)."
                      : "Below 50%, but you likely retain blocking rights via protective provisions — check the voting agreement."
                    : "Below 26% — you lose statutory blocking rights. This round takes you into dependent territory."}
              </p>
            </Card>
            <Card className="p-4">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Dilution vs. market</div>
              <div className={cn("mt-1 text-xl font-bold", vcPct > bench.hi ? "text-danger" : vcPct >= bench.lo ? "text-warning" : "text-success")}>
                {vcPct.toFixed(1)}%
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {ROUND_BENCHMARK_NOTES[a.mkt][a.round]} Typical: {bench.lo}–{bench.hi}%.
              </p>
            </Card>
          </div>

          <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Your negotiation email — draft</h2>
          <p className="mb-2 text-xs text-muted-foreground">One email, all asks at once, collaborative tone. The private notes stay with you.</p>
          <pre className="whitespace-pre-wrap rounded-xl border border-dashed border-border bg-muted/30 p-5 font-mono text-xs leading-relaxed">{memo}</pre>
          <div className="mt-3 flex gap-2">
            <Button onClick={() => navigator.clipboard?.writeText(memo)}>Copy email</Button>
            <Button variant="outline" onClick={openSimulator}>Open in full simulator →</Button>
          </div>
        </>
      )}
    </div>
  );
}
