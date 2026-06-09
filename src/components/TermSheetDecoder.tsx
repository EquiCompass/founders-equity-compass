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
import { cn } from "@/lib/utils";

/** sessionStorage key used to hand the decoded deal to /simulator */
export const DECODED_STATE_KEY = "equicompass.decoded";

type PrefChoice = "1x-non" | "1x-part" | "2x-non" | "2x-part" | "unsure";
type AdChoice = "none" | "bbwa" | "ratchet" | "unsure";

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

/* ───────────────────────── component ───────────────────────── */

export function TermSheetDecoder() {
  const navigate = useNavigate();
  const [a, setA] = useState<Answers>(DEFAULT_ANSWERS);
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [exitVal, setExitVal] = useState(50);
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

  interface Flag { sev: "high" | "med"; cost?: number; title: string; body: string; ask: string }
  const flags: Flag[] = [];
  if (part) {
    flags.push({
      sev: "high",
      cost: youUnder({ pref: mult === 2 ? "2x-non" : "1x-non" }) - youBase,
      title: 'Remove "participating" from the liquidation preference',
      body: `At a ${fmtM(exitVal)} exit, participating preferred costs you personally the amount shown vs. standard non-participating.`,
      ask: a.mkt === "india"
        ? '"Preference shares shall be non-participating. Investors elect preference OR pro-rata — not both." Non-participating is the India market standard at every stage.'
        : "NVCA model documents default to non-participating — ask them to conform.",
    });
  }
  if (mult > 1) {
    flags.push({
      sev: "high",
      cost: youUnder({ pref: part ? "1x-part" : "1x-non" }) - youBase,
      title: `Cut the ${mult}x multiple to 1x`,
      body: `A ${mult}x preference means ${fmtM(a.inv * mult)} comes off the top before common sees anything.`,
      ask: "1x is standard in every market. Anything above 1x is a price negotiation in disguise — counter on valuation instead.",
    });
  }
  if (a.ad === "ratchet") {
    const downPre = (a.pre + a.inv) * 0.6;
    const boosted = vcPct * ((a.pre + a.inv) / downPre);
    flags.push({
      sev: "high",
      title: "Replace full ratchet with broad-based weighted average",
      body: `If your next round prices 40% lower, full ratchet boosts this investor from ${vcPct.toFixed(1)}% to ~${boosted.toFixed(1)}% — entirely at your expense.`,
      ask: 'Ask for "broad-based weighted average" — the market standard everywhere. Full ratchet is not standard in any geography.',
    });
  }
  if (a.redemption) {
    flags.push({
      sev: "high",
      cost: undefined,
      title: "Strike redemption rights",
      body: `A ${fmtM(a.inv)}+ cash liability the investor can trigger in ~5 years, potentially forcing a sale on their timeline.`,
      ask: a.mkt === "india"
        ? "Cite Companies Act §68 — buybacks require distributable profits. Counter: 1x cap, trigger after year 7 only, 3-year installments."
        : "NVCA model documents (post-2015) omit redemption entirely — most US VCs drop it when pushed.",
    });
  }
  if (a.esopT >= 15) {
    flags.push({
      sev: "med",
      title: `Negotiate the ESOP top-up below ${a.esopT}%`,
      body: "The pool is created pre-money, so the entire top-up comes out of existing holders — not the investor.",
      ask: "Counter with a bottoms-up 18-month hiring plan; 10–12% is usually defensible.",
    });
  }
  if (a.board === "2") {
    flags.push({
      sev: "high",
      title: "Refuse the second board seat",
      body: "Two investor seats after one round means investor + independent can outvote founders.",
      ask: "One seat for the lead is standard. Offer an observer seat for the co-investor instead.",
    });
  }
  if (vcPct > bench.hi) {
    flags.push({
      sev: "med",
      title: `Dilution is above market (${vcPct.toFixed(1)}% vs ${bench.lo}–${bench.hi}% typical)`,
      body: ROUND_BENCHMARK_NOTES[a.mkt][a.round],
      ask: `Counter on valuation: at ${fmtM(a.inv)} raised, a pre-money of ${fmtM((a.inv * 100) / bench.hi - a.inv)} brings them to ${bench.hi}% — the top of the market range.`,
    });
  }
  if (a.pref === "unsure") {
    flags.push({ sev: "med", title: "Confirm the liquidation preference wording with your lawyer", body: "We assumed 1x non-participating. If it says \"participating\", the numbers above are optimistic.", ask: "" });
  }
  if (a.ad === "unsure") {
    flags.push({ sev: "med", title: "Confirm the anti-dilution clause", body: "We assumed broad-based weighted average. If it says \"full ratchet\", treat it as a deal-breaker.", ask: "" });
  }
  const highs = flags.filter((f) => f.sev === "high").length;

  const memo = useMemo(() => {
    const items = flags
      .map((f, i) => `${i + 1}. ${f.title}${f.cost !== undefined && f.cost > 0.005 ? ` (worth ${fmtM(f.cost)} to you at a ${fmtM(exitVal)} exit)` : ""}`)
      .join("\n");
    return `TERM SHEET RESPONSE — ${ROUND_LABELS[a.round].toUpperCase()} (${fmtM(a.inv)} on ${fmtM(a.pre)} pre-money)

POSITION: We are excited to move forward. We accept the valuation and
investment amount. Before signing we need the following terms brought
to market standard:

${items || "— No structural changes requested. Proceeding to confirmatory diligence."}

CONTEXT FOR OUR SIDE (do not send):
- Post-round: founders ${fdrPct.toFixed(1)}% | investor ${vcPct.toFixed(1)}% | you personally ${youPct.toFixed(1)}%
- At a ${fmtM(exitVal)} exit you personally take ${fmtM(youBase)} under current terms
- Market benchmark for ${ROUND_LABELS[a.round]} (${a.mkt.toUpperCase()}): ${bench.lo}–${bench.hi}% dilution — this deal: ${vcPct.toFixed(1)}%`;
  }, [flags, a, exitVal, fdrPct, vcPct, youPct, youBase, bench]);

  /* ─────────────── render: intake ─────────────── */
  if (!done) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-bold">You got a term sheet. Let's decode it.</h1>
        <p className="mt-1 mb-6 text-sm text-muted-foreground">
          Answer 8 questions straight off the document — takes 3 minutes. We'll tell you what you take home,
          whether you keep control, and exactly what to push back on.
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

  /* ─────────────── render: results ─────────────── */
  const verdict =
    highs === 0
      ? { cls: "border-success bg-success/10", head: "Sign-able with minor pushback.", body: "The structure is market standard. Resolve any flagged items, then negotiate price if anything." }
      : highs === 1
        ? { cls: "border-warning bg-warning/10", head: "Negotiate before signing — 1 clause is costing you real money.", body: "The deal is workable, but fix the red item below first. It's a standard ask; a reasonable investor will move." }
        : { cls: "border-danger bg-danger/10", head: `Do not sign as-is — ${highs} clauses are off-market.`, body: "Individually each is negotiable; together they suggest an investor testing what you'll accept. Counter all of them at once, in writing." };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-bold">Your term sheet, decoded.</h1>
        <Button variant="outline" size="sm" onClick={() => setDone(false)}>Edit answers</Button>
        <Button size="sm" onClick={openSimulator}>Open in full simulator →</Button>
      </div>

      <div className={cn("mb-5 rounded-xl border p-4", verdict.cls)}>
        <div className="font-bold">{verdict.head}</div>
        <div className="mt-0.5 text-sm text-muted-foreground">{verdict.body}</div>
      </div>

      <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">① What you personally take home</h2>
      <Card className="mb-5 p-5">
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">If the company exits at</span>
          <Input type="number" className="w-28" value={exitVal} step={5} onChange={(e) => +e.target.value > 0 && setExitVal(+e.target.value)} />
          <span className="text-xs text-muted-foreground">$M</span>
        </div>
        <div className="mt-3 text-3xl font-bold text-success">{fmtM(youBase)}</div>
        <p className="mt-1 text-xs text-muted-foreground">
          Your payout at a {fmtM(exitVal)} exit, holding {youPct.toFixed(1)}% after this round (down from {a.you}%).
        </p>
        <table className="mt-3 w-full text-sm">
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

      <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">② Do you keep control?</h2>
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

      <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">③ What to push back on — priced in dollars</h2>
      <div className="mb-5 grid gap-3">
        {flags.length === 0 && (
          <Card className="border-l-4 border-l-success p-4">
            <div className="text-sm font-semibold">This is a clean, market-standard term sheet</div>
            <p className="mt-1 text-xs text-muted-foreground">1x non-participating, weighted-average anti-dilution, standard board. Negotiate valuation if anything — the structure is fine.</p>
          </Card>
        )}
        {flags.map((f) => (
          <Card key={f.title} className={cn("flex gap-4 border-l-4 p-4", f.sev === "high" ? "border-l-danger" : "border-l-warning")}>
            <div className="flex-1">
              <div className="text-sm font-semibold">{f.title}</div>
              <p className="mt-1 text-xs text-muted-foreground">{f.body}</p>
              {f.ask && <p className="mt-1.5 text-xs font-medium text-accent-foreground/80">Ask: {f.ask}</p>}
            </div>
            {f.cost !== undefined && f.cost > 0.005 && (
              <div className={cn("min-w-[90px] text-right text-lg font-bold", f.sev === "high" ? "text-danger" : "text-warning")}>
                +{fmtM(f.cost)}
              </div>
            )}
          </Card>
        ))}
      </div>

      <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Your negotiation one-pager</h2>
      <p className="mb-2 text-xs text-muted-foreground">Forward this to your lawyer and co-founders. Read from it on the call.</p>
      <pre className="whitespace-pre-wrap rounded-xl border border-dashed border-border bg-muted/30 p-5 font-mono text-xs leading-relaxed">{memo}</pre>
      <div className="mt-3 flex gap-2">
        <Button onClick={() => navigator.clipboard?.writeText(memo)}>Copy memo</Button>
        <Button variant="outline" onClick={openSimulator}>Open in full simulator →</Button>
      </div>
    </div>
  );
}
