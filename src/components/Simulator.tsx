import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  computeSnaps,
  calcPayouts,
  founderPayouts,
  vestedFraction,
  fmtM,
  fmtVal,
  latestSnap,
} from "@/lib/equity/calc";
import {
  DEFAULT_STATE,
  DEFAULT_VESTING,
  HOLDER_COLORS,
  INDIA_DEFAULT_ROUNDS,
  INITIAL_HOLDERS,
  ROUND_BENCHMARK_NOTES,
  ROUND_BENCHMARKS,
  ROUND_ICONS,
  ROUND_KEYS,
  ROUND_LABELS,
  US_DEFAULT_ROUNDS,
  US_ROUND_BENCHMARKS,
  type RoundConfig,
  type RoundKey,
  type SimulatorState,
  type VestingConfig,
} from "@/lib/equity/types";
import { Users, Settings2, PieChart as PieChartIcon, Shield, BarChart3 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { cn } from "@/lib/utils";

const EXTRA_FOUNDER_COLORS = ["#6366f1", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#84cc16", "#06b6d4"];

/** One-click journey presets — load a complete, realistic multi-round scenario
 *  from the market defaults, then let the user tweak instead of author. */
interface JourneyPreset {
  id: string;
  label: string;
  desc: string;
  rounds: RoundKey[];
  safe?: boolean;
}

const JOURNEY_PRESETS: Record<"india" | "us", JourneyPreset[]> = {
  india: [
    { id: "in-seed-a", label: "🌱 Seed → Series A", desc: "The standard India venture path", rounds: ["seed", "a"] },
    { id: "in-safe", label: "🤝 Angel SAFE → Seed → A", desc: "Angel SAFE converts at Seed", rounds: ["seed", "a"], safe: true },
    { id: "in-full", label: "🚀 Pre-seed → Series C", desc: "The full journey, all five rounds", rounds: ["preseed", "seed", "a", "b", "c"] },
  ],
  us: [
    { id: "us-yc", label: "🟧 YC route: SAFE → Seed → A", desc: "$500K SAFE converts at Seed", rounds: ["seed", "a"], safe: true },
    { id: "us-seed-a", label: "🌱 Seed → Series A", desc: "The standard US venture path", rounds: ["seed", "a"] },
    { id: "us-full", label: "🚀 Pre-seed → Series C", desc: "The full journey, all five rounds", rounds: ["preseed", "seed", "a", "b", "c"] },
  ],
};

interface Props {
  state: SimulatorState;
  onChange: (next: SimulatorState) => void;
  readOnly?: boolean;
}


export function Simulator({ state, onChange, readOnly = false }: Props) {
  const snaps = useMemo(() => computeSnaps(state), [state]);
  const snapKeys = Object.keys(snaps);
  const latest = latestSnap(snaps);
  const [capRound, setCapRound] = useState<string>("pre");
  const activeCap = snaps[capRound] ?? latest;
  const [expertMode, setExpertMode] = useState(false);
  const [negLeverage, setNegLeverage] = useState<"competing" | "normal" | "tight">("normal");
  const [showVetoLibrary, setShowVetoLibrary] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [activeTab, setActiveTab] = useState("setup");
  const [savedScenarios, setSavedScenarios] = useState<
    Array<{
      name: string;
      founderPct: number;
      vcPct: number;
      vcSeats: number;
      boardStatus: string;
      totalRaise: number;
      totalPref: number;
      founderPayout50: number;
      founderPayout100: number;
      founderPayout200: number;
    }>
  >([]);
  const [savingMode, setSavingMode] = useState(false);
  const [newScenarioName, setNewScenarioName] = useState("");

  const updateRound = (k: RoundKey, patch: Partial<RoundConfig>) => {
    if (readOnly) return;
    onChange({ ...state, rounds: { ...state.rounds, [k]: { ...state.rounds[k], ...patch } } });
  };

  const applyJourney = (p: JourneyPreset) => {
    if (readOnly) return;
    const base = state.market === "us" ? US_DEFAULT_ROUNDS : INDIA_DEFAULT_ROUNDS;
    const rounds = Object.fromEntries(
      Object.entries(base).map(([k, r]) => [k, { ...r, enabled: p.rounds.includes(k as RoundKey) }]),
    ) as SimulatorState["rounds"];
    onChange({
      ...state,
      rounds,
      safe: p.safe
        ? { enabled: true, amount: state.market === "us" ? 0.5 : 0.25, cap: state.market === "us" ? 8 : 3, discount: 20, mfn: false }
        : { ...state.safe, enabled: false },
    });
  };

  const updateSafe = <K extends keyof SimulatorState["safe"]>(field: K, value: SimulatorState["safe"][K]) => {
    if (readOnly) return;
    onChange({ ...state, safe: { ...state.safe, [field]: value } });
  };

  const updateVesting = (name: string, patch: Partial<VestingConfig>) => {
    if (readOnly) return;
    const current = state.vesting?.[name] ?? DEFAULT_VESTING;
    onChange({ ...state, vesting: { ...state.vesting, [name]: { ...current, ...patch } } });
  };

  const saveScenario = () => {
    if (!newScenarioName.trim() || !anyRoundsEnabled) return;
    const boardStatus =
      latest.vcSeats > founderSeats ? "VC-controlled"
      : latest.vcSeats === founderSeats && latest.vcSeats > 0 ? "Tied"
      : "Founder-ctrl";
    const minPayoutAt = (ev: number) => {
      const s2 = computeSnaps({ ...state, exitValue: ev });
      const l2 = latestSnap(s2);
      const fp2 = founderPayouts(l2, ev, state.usePref);
      if (!fp2.length) return 0;
      return fp2.reduce((m, f) => (f.payout < m ? f.payout : m), fp2[0].payout);
    };
    const next = {
      name: newScenarioName.trim(),
      founderPct, vcPct, vcSeats: latest.vcSeats,
      boardStatus, totalRaise: totalInvested, totalPref,
      founderPayout50: minPayoutAt(50),
      founderPayout100: minPayoutAt(100),
      founderPayout200: minPayoutAt(200),
    };
    setSavedScenarios((prev) => {
      const arr = [...prev, next];
      return arr.length <= 3 ? arr : arr.slice(arr.length - 3);
    });
    setSavingMode(false);
    setNewScenarioName("");
  };

  // Pre-funding cap table (custom or default)
  const founders = state.founders ?? INITIAL_HOLDERS;
  const founderOnlyHolders = founders.filter((h) => h.type === "founder");

  const updateFounderField = (idx: number, patch: Partial<{ name: string; role: string; pct: number }>) => {
    if (readOnly) return;
    const next = founders.map((h, i) => (i === idx ? { ...h, ...patch } : h));
    onChange({ ...state, founders: next });
  };

  const addFounder = () => {
    if (readOnly) return;
    const taken = founders.reduce((s, h) => s + h.pct, 0);
    const remaining = Math.max(0, parseFloat((100 - taken).toFixed(1)));
    // Insert before ESOP/Advisory rows
    const insertAt = founders.findIndex((h) => h.type === "esop");
    const newHolder = { name: "New Founder", role: "Co-founder", pct: remaining, type: "founder" as const };
    const next = insertAt >= 0
      ? [...founders.slice(0, insertAt), newHolder, ...founders.slice(insertAt)]
      : [...founders, newHolder];
    onChange({ ...state, founders: next });
  };

  const removeFounder = (idx: number) => {
    if (readOnly) return;
    onChange({ ...state, founders: founders.filter((_, i) => i !== idx) });
  };

  const founderSum = founders.reduce((s, h) => s + h.pct, 0);
  const founderSumOk = Math.abs(founderSum - 100) < 0.11;

  const founderPct = latest.holders.filter((h) => h.type === "founder").reduce((s, h) => s + h.pct, 0);
  // Include SAFE investors — they hold converted equity just like VC investors
  const vcPct = latest.holders.filter((h) => h.type === "vc" || h.type === "safe").reduce((s, h) => s + h.pct, 0);

  // Founder seats from state (BUG FIX 3)
  const founderSeats = state.founderSeats;
  const totalSeats = founderSeats + 1 + latest.vcSeats;
  const fSeatPct = Math.round((founderSeats / totalSeats) * 100);
  const vSeatPct = Math.round((latest.vcSeats / totalSeats) * 100);
  const iSeatPct = 100 - fSeatPct - vSeatPct;

  const fPayouts = founderPayouts(
    latest,
    state.exitValue,
    state.usePref,
    state.vestingEnabled ?? false,
    state.vesting ?? {},
    state.accelerationAtExit ?? true,
  );
  const founderTotal = fPayouts.reduce((s, f) => s + f.payout, 0);
  const totalPref = (latest.roundData || []).filter((r) => r.type === "vc").reduce((s, r) => s + r.investment * r.prefMult, 0);
  const totalInvested = (latest.roundData || []).filter((r) => r.type === "vc").reduce((s, r) => s + r.investment, 0);
  const allPayouts = calcPayouts(latest, state.exitValue, state.usePref);
  const vcTotal = latest.holders.filter((h) => h.type === "vc" || h.type === "safe").reduce((s, h) => s + (allPayouts[h.name] || 0), 0);


  // ── Input validation ──
  const validationErrors = useMemo(() => {
    const errs: Record<string, string> = {};

    // SAFE validation
    if (state.safe.enabled) {
      if (state.safe.amount <= 0) errs["safe-amount"] = "Amount must be greater than 0";
      if (!state.safe.mfn) {
        if (state.safe.cap <= 0) errs["safe-cap"] = "Valuation cap must be greater than 0";
        if (state.safe.cap < state.safe.amount) errs["safe-cap"] = "Cap should be larger than the SAFE amount";
        if (state.safe.discount < 0 || state.safe.discount > 50) errs["safe-discount"] = "Discount must be between 0% and 50%";
      }
    }

    // Round validation
    ROUND_KEYS.forEach((k) => {
      const r = state.rounds[k];
      if (!r.enabled) return;
      if (!r.preMoney || r.preMoney <= 0) errs[`${k}-pre`] = "Pre-money must be greater than 0";
      if (!r.raise || r.raise <= 0) errs[`${k}-raise`] = "Raise must be greater than 0";
      if (r.preMoney > 0 && r.raise > 0 && r.raise >= r.preMoney) {
        errs[`${k}-raise`] = "Raise is larger than pre-money — VC would own over 50%. Double-check these numbers.";
      }
      if (r.esop < 0 || r.esop > 30) errs[`${k}-esop`] = "ESOP must be between 0% and 30%";
    });

    return errs;
  }, [state.safe, state.rounds]);

  const hasErrors = Object.keys(validationErrors).length > 0;

  const enabledRounds = ROUND_KEYS.filter((k) => state.rounds[k].enabled);
  const roundsEnabledCount = enabledRounds.length;

  // ── Redemption rights derived values ──
  const redemptionItems = enabledRounds.map((k) => {
    const r = state.rounds[k];
    if (!r.redemptionEnabled) return null;
    const mult    = r.redemptionMultiple ?? 1;
    const years   = r.redemptionYears   ?? 5;
    const liability = r.raise * mult;
    return { roundKey: k, label: ROUND_LABELS[k as RoundKey], investment: r.raise, liability, years, mult };
  }).filter(Boolean) as Array<{ roundKey: string; label: string; investment: number; liability: number; years: number; mult: number }>;
  const totalRedemptionLiability = redemptionItems.reduce((s, r) => s + r.liability, 0);
  const hasRedemption = redemptionItems.length > 0;
  const anyRoundsEnabled = roundsEnabledCount > 0;

  const protectData = useMemo(() => {
    return snapKeys.map((k) => {
      const snap = snaps[k];
      const founders = snap.holders.filter((h) => h.type === "founder").reduce((s, h) => s + h.pct, 0);
      return { round: snap.label, founders: Number(founders.toFixed(2)) };
    });
  }, [snapKeys, snaps]);

  const perFounderAmt = useMemo(() => {
    if (!fPayouts.length) return 0;
    return fPayouts.reduce((min, f) => (f.payout < min ? f.payout : min), fPayouts[0].payout);
  }, [fPayouts]);

  const hasParticipatingPreferred = enabledRounds.some((k) => state.rounds[k].prefType === "part");
  const participatingRoundNames = enabledRounds.filter((k) => state.rounds[k].prefType === "part").map((k) => ROUND_LABELS[k]).join(", ");

  // ── Negotiate tab: leverage-aware battle ranking (mirrors /decode logic) ──
  type NegBattle = { tier: "blocker" | "ask"; title: string; detail: string; cost?: number; concede: string; concedeTone: "good" | "mid" | "bad" };
  const negBattleData = useMemo(() => {
    const founderTakeUnder = (mod: Partial<RoundConfig>) => {
      const rounds = Object.fromEntries(
        ROUND_KEYS.map((k) => [k, state.rounds[k].enabled ? { ...state.rounds[k], ...mod } : state.rounds[k]]),
      ) as SimulatorState["rounds"];
      const sn = latestSnap(computeSnaps({ ...state, rounds }));
      const p = calcPayouts(sn, state.exitValue, true);
      return sn.holders.filter((h) => h.type === "founder").reduce((acc, h) => acc + (p[h.name] || 0), 0);
    };
    const currentTake = founderTakeUnder({});
    // isUS is declared later in the component — derive locally to avoid TDZ
    const fs = state.founderStructure ?? (state.market === "us" ? "us" : "india-flip");
    const usMode = fs === "us" || fs === "india-us-move";

    const blockers: NegBattle[] = [];
    const asksAll: NegBattle[] = [];
    const accepts: string[] = [];

    const ratchetRounds = enabledRounds.filter((k) => state.rounds[k].antiDilution === "full-ratchet");
    if (ratchetRounds.length > 0) {
      blockers.push({
        tier: "blocker",
        title: `Full ratchet anti-dilution at ${ratchetRounds.map((k) => ROUND_LABELS[k]).join(", ")}`,
        detail: "In any down round, this investor's price fully resets at the founders' expense. Not market standard anywhere — ask for broad-based weighted average. A 5-minute redline, not a fight.",
        concede: "VCs usually concede this", concedeTone: "good",
      });
    }
    const multRounds = enabledRounds.filter((k) => state.rounds[k].prefMult > 1);
    if (multRounds.length > 0) {
      blockers.push({
        tier: "blocker",
        title: `${multRounds.map((k) => `${state.rounds[k].prefMult}x at ${ROUND_LABELS[k]}`).join(", ")} preference multiple`,
        detail: "Anything above 1x is a price negotiation in disguise. Ask for 1x — the universal standard; counter on valuation if they want downside protection.",
        cost: founderTakeUnder({ prefMult: 1 }) - currentTake,
        concede: "VCs usually concede this", concedeTone: "good",
      });
    }
    if (hasParticipatingPreferred) {
      asksAll.push({
        tier: "ask",
        title: `Remove "participating" (${participatingRoundNames})`,
        detail: usMode
          ? "Non-participating is the NVCA-model default — most US funds conform without argument."
          : 'Non-participating is the India market standard at every stage. Proposed language: "Investors elect preference OR pro-rata — not both."',
        cost: founderTakeUnder({ prefType: "non" }) - currentTake,
        concede: "VCs usually concede this", concedeTone: "good",
      });
    } else if (anyRoundsEnabled && multRounds.length === 0) {
      accepts.push("1x non-participating preference everywhere — exactly what you want. Accept as drafted.");
    }
    if (hasRedemption) {
      asksAll.push({
        tier: "ask",
        title: `Soften or remove redemption rights (${fmtM(totalRedemptionLiability)} liability)`,
        detail: usMode
          ? "Post-2015 NVCA documents omit redemption entirely — most US VCs drop it when asked. Fall-back: 1x cap, year-7 trigger, 75% preferred approval."
          : "Indian funds keep it for DPI optics but rarely enforce. Fall-back: 1x cap, trigger after year 7 only, 3-year installments. Companies Act §68 limits enforcement anyway.",
        concede: usMode ? "VCs usually concede this" : "Often negotiable", concedeTone: usMode ? "good" : "mid",
      });
    } else if (anyRoundsEnabled) {
      accepts.push("No redemption rights — good. Nothing to do.");
    }
    const fatEsopRounds = enabledRounds.filter((k) => state.rounds[k].esop >= 15);
    if (fatEsopRounds.length > 0) {
      asksAll.push({
        tier: "ask",
        title: `Size the ESOP top-up below ${Math.max(...fatEsopRounds.map((k) => state.rounds[k].esop))}% (${fatEsopRounds.map((k) => ROUND_LABELS[k]).join(", ")})`,
        detail: "The pool is created pre-money — the entire top-up dilutes existing holders, not the investor. Counter with a bottoms-up 18-month hiring plan; 10–12% is usually defensible.",
        concede: "Often negotiable", concedeTone: "mid",
      });
    }
    if (anyRoundsEnabled && latest.vcSeats >= founderSeats && latest.vcSeats > 0) {
      asksAll.push({
        tier: "ask",
        title: `Rebalance the board (VCs hold ${latest.vcSeats} vs your ${founderSeats})`,
        detail: "Push later rounds to observer seats; one seat for each lead is defensible, parity or worse is not. Also negotiate founders nominate the independent director.",
        concede: "Often negotiable", concedeTone: "mid",
      });
    } else if (anyRoundsEnabled && latest.vcSeats < founderSeats) {
      accepts.push("Founder-controlled board — standard seat ask per lead is fine. Don't fight observer seats.");
    }
    if (anyRoundsEnabled && ratchetRounds.length === 0 && enabledRounds.every((k) => state.rounds[k].antiDilution !== "full-ratchet")) {
      accepts.push("Weighted-average (or no) anti-dilution — market standard. Don't spend a chip here.");
    }

    const budget = negLeverage === "competing" ? 3 : negLeverage === "tight" ? 1 : 2;
    const toneRank = { good: 0, mid: 1, bad: 2 } as const;
    const sorted = [...asksAll].sort((x, y) => {
      const cx = x.cost ?? 0, cy = y.cost ?? 0;
      if (Math.abs(cy - cx) > 0.01) return cy - cx;
      return toneRank[x.concedeTone] - toneRank[y.concedeTone];
    });
    return { blockers, asks: sorted.slice(0, budget), parked: sorted.slice(budget), accepts, budget, totalAsks: asksAll.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, enabledRounds, hasParticipatingPreferred, participatingRoundNames, hasRedemption, totalRedemptionLiability, anyRoundsEnabled, latest, founderSeats, negLeverage]);

  // founderStructure drives market + compliance guidance
  // Normalise: old saves without founderStructure default to matching market field
  const founderStructure = state.founderStructure ?? (state.market === "us" ? "us" : "india-flip");
  const isUS = founderStructure === "us" || founderStructure === "india-us-move";
  const isIndiaResident = founderStructure === "india-only" || founderStructure === "india-flip";
  const isFlip = founderStructure === "india-flip";
  const isMoveToUS = founderStructure === "india-us-move";

  const riskSignals = useMemo(() => {
    const signals: Array<{ tone: "red" | "orange" | "yellow" | "green" | "amber" | "blue"; text: string }> = [];

    // Signal 1 — Board control
    if (latest.vcSeats >= founderSeats) {
      signals.push({
        tone: "red",
        text: isUS
          ? `VCs hold ${latest.vcSeats} board seats — under DGCL, the board controls CEO hiring/firing, M&A approval, and company strategy`
          : `VCs hold ${latest.vcSeats} board seats — independent director decides all key votes`,
      });
    } else {
      signals.push({
        tone: "green",
        text: isUS
          ? `Founder-controlled board: ${founderSeats} vs ${latest.vcSeats} VC seats — protected under your Delaware SHA`
          : `Founder-controlled board: ${founderSeats} vs ${latest.vcSeats} VC seats`,
      });
    }

    // Signal 2 — Equity threshold (statutory in India, contractual in US)
    if (isUS) {
      if (founderPct < 30) {
        signals.push({
          tone: "red",
          text: `Founders at ${founderPct.toFixed(1)}% — US VCs rely on contractual protective provisions, not statutory thresholds. At this level, most exit decisions require investor approval.`,
        });
      } else if (founderPct < 50) {
        signals.push({
          tone: "orange",
          text: `Founders at ${founderPct.toFixed(1)}% — lost simple majority. US term sheets grant VCs veto rights over M&A, new share classes, and charter amendments regardless of %.`,
        });
      }
    } else {
      if (founderPct < 26) {
        signals.push({ tone: "red", text: `Founders at ${founderPct.toFixed(1)}% — below 26%, VCs can block ALL major decisions under Companies Act 2013` });
      } else if (founderPct < 51) {
        signals.push({ tone: "orange", text: `Founders at ${founderPct.toFixed(1)}% — lost simple majority` });
      } else if (founderPct < 75) {
        signals.push({ tone: "yellow", text: `Founders at ${founderPct.toFixed(1)}% — VCs have special resolution blocking power (75% threshold)` });
      }
    }

    // Signal 3 — VC combined stake
    if (vcPct > 50) {
      signals.push({ tone: "red", text: `VCs combined at ${vcPct.toFixed(1)}% — can override founders on ordinary resolutions` });
    } else if (vcPct > 26) {
      signals.push({
        tone: "orange",
        text: isUS
          ? `VCs at ${vcPct.toFixed(1)}% — protective provisions give veto over M&A, new share issuances, and certificate of incorporation amendments`
          : `VCs at ${vcPct.toFixed(1)}% — can veto M&A, SHA changes, new share issuances`,
      });
    }

    // Signal 4 — Preference overhang
    if (totalPref > 0) {
      const overhangRatio = state.exitValue > 0 ? totalPref / state.exitValue : 0;
      const tone = overhangRatio > 0.5 ? "red" : overhangRatio > 0.25 ? "orange" : "yellow";
      signals.push({ tone, text: `${fmtM(totalPref)} liquidation overhang — founders receive $0 in any exit below this amount` });
    }

    // Signal 5 — Participating preferred
    if (hasParticipatingPreferred) {
      signals.push({
        tone: "orange",
        text: `Participating preferred in ${participatingRoundNames} — VCs collect preference then also participate in remaining proceeds`,
      });
    }

    // US-specific signals
    if (isUS) {
      signals.push({
        tone: "yellow",
        text: "If currently incorporated in India: most US institutional VCs (YC, Sequoia US, a16z) require a Delaware C-Corp flip before closing. If already a Delaware entity, this does not apply.",
      });
      if (state.safe.enabled) {
        signals.push({
          tone: "yellow",
          text: "YC post-money SAFE: investor dilution is fixed at SAFE ÷ cap. All future dilution (ESOP top-ups, bridge rounds) falls entirely on founders until conversion.",
        });
      }
    } else {
      // India-specific: FEMA / foreign investment signal if any VC rounds
      if (anyRoundsEnabled) {
        signals.push({
          tone: "yellow",
          text: "If any investor is foreign-domiciled (US, Singapore, Cayman, etc.): FEMA compliance required — FC-GPR filing within 30 days and FMV pricing per SEBI norms. Indian VC investment does not require FC-GPR.",
        });
      }
    }

    // SAFE with no cap warning
    if (state.safe.enabled && !state.safe.mfn && (state.safe.cap <= 0 || state.safe.cap < state.safe.amount * 2)) {
      signals.push({
        tone: "red",
        text: state.safe.cap <= 0
          ? "SAFE has no valuation cap — it converts at whatever price your next round sets, giving the investor no dilution protection. Without a cap, the SAFE behaves like a discount-only note: potentially very cheap equity for the investor at a high-valuation round."
          : `SAFE cap of ${fmtM(state.safe.cap)} is less than 2× the SAFE amount (${fmtM(state.safe.amount)}) — this is an unusually tight cap. If your next round values the company above the cap, the SAFE investor gets a large ownership boost at your expense. Review the conversion math.`,
      });
    }

    // Down round → governance renegotiation prompt
    const hasDownRound = Object.values(snaps).some((s) => s.isDownRound);
    if (hasDownRound) {
      const worstDrop = Math.max(...Object.values(snaps).filter((s) => s.isDownRound).map((s) => s.valDrop));
      signals.push({
        tone: "red",
        text: `Down round detected (−${worstDrop}% below previous post-money). This is your strongest leverage to renegotiate governance: push to reset board composition, remove or sunset anti-dilution clauses from prior rounds, and negotiate new vesting cliff resets for founders. VCs in a down round need your cooperation — use it.`,
      });
    }

    // India: flip structure warning
    if (isFlip && anyRoundsEnabled) {
      signals.push({
        tone: "amber",
        text: "US flip structure required before US VC closes: Indian residents cannot directly own a Delaware C-Corp under RBI / FEMA rules. You need: LLP → Delaware C-Corp → India Pvt Ltd. Start 3–4 months before signing. See the Flip Structure card in the Setup tab.",
      });
    }
    // Move to US: residency change signals
    if (isMoveToUS && anyRoundsEnabled) {
      signals.push({
        tone: "blue",
        text: "Moving to US: update FEMA residential status with your AD bank, file Indian exit-year return (exit tax under Section 9 may apply on unrealised gains), and obtain OCI card. DTAA (India-US tax treaty) prevents double taxation on salary and future equity gains.",
      });
    }

    // India: angel tax risk
    if (!isUS && state.safe.enabled && state.safe.amount > 0) {
      signals.push({
        tone: "yellow",
        text: "India angel tax risk: if your company receives investment above FMV (as assessed by a SEBI-registered valuer), the excess is taxable as 'income from other sources' under Section 56(2)(viib) of the Income Tax Act. Foreign investors are now included (Finance Act 2023). Get a 409A-equivalent FMV valuation from a registered valuer before closing any round.",
      });
    } else if (!isUS && anyRoundsEnabled && enabledRounds.includes("preseed")) {
      signals.push({
        tone: "yellow",
        text: "India angel tax (Section 56(2)(viib)): if share allotment price exceeds FMV (SEBI-registered valuer), the premium is taxable income for the company. Applies to both domestic and foreign investors post-2023. Always obtain a certified FMV report before closing — cost is ₹30–80K but avoids a potential multi-crore tax demand.",
      });
    }

    // Co-founder vesting sync check
    if ((state.vestingEnabled ?? false) && founderOnlyHolders.length >= 2) {
      const vestSchedules = founderOnlyHolders.map((f) => state.vesting?.[f.name] ?? DEFAULT_VESTING);
      const cliffs  = vestSchedules.map((v) => v.cliffMonths);
      const totals  = vestSchedules.map((v) => v.vestMonths);
      const cliffMismatch = Math.max(...cliffs) - Math.min(...cliffs) > 6;
      const totalMismatch = Math.max(...totals) - Math.min(...totals) > 12;
      if (cliffMismatch || totalMismatch) {
        signals.push({
          tone: "orange",
          text: `Co-founder vesting schedules are mismatched${cliffMismatch ? ` — cliff varies by ${Math.max(...cliffs) - Math.min(...cliffs)} months` : ""}${totalMismatch ? `${cliffMismatch ? " and" : " —"} total vest period varies by ${Math.max(...totals) - Math.min(...totals)} months` : ""}. Misaligned schedules create a "quick vest and leave" incentive for the founder with shorter terms. VCs will flag this in due diligence. Align all co-founders to the same cliff and vest length before raising.`,
        });
      }
    }

    // Cap table mess warning — >5 pre-funding holders is a complexity flag
    if (founderOnlyHolders.length > 4) {
      signals.push({
        tone: "yellow",
        text: `${founderOnlyHolders.length} founders on the pre-funding cap table. More than 4 co-founders raises governance questions for VCs: decision-making speed, board seat allocation, and what happens if one leaves. Be prepared to explain the founding team structure and individual contributions clearly in due diligence.`,
      });
    }
    const preFundingHolderCount = founders.length;
    if (preFundingHolderCount > 6 && !anyRoundsEnabled) {
      signals.push({
        tone: "yellow",
        text: `Pre-funding cap table has ${preFundingHolderCount} holders. Complex early-stage cap tables (angels, advisors, friends & family all in before Seed) slow down VC due diligence and create blocking rights issues. Consider consolidating or converting informal agreements to a single SAFE before the priced round.`,
      });
    }

    return signals.slice(0, 10);
  }, [
    isUS,
    latest.vcSeats,
    founderSeats,
    founderPct,
    vcPct,
    totalPref,
    state.exitValue,
    hasParticipatingPreferred,
    participatingRoundNames,
    state.safe.enabled,
    state.safe.cap,
    state.safe.amount,
    state.safe.mfn,
    anyRoundsEnabled,
    snaps,
    enabledRounds,
    founderOnlyHolders,
    state.vestingEnabled,
    state.vesting,
    founders,
    isFlip,
    isMoveToUS,
    isIndiaResident,
  ]);

  const recommendations = useMemo(() => {
    type Timing = "now" | "next-round" | "ongoing";
    type Priority = "critical" | "high" | "medium";
    interface Rec {
      priority: Priority;
      timing: Timing;
      action: string;
      why: string;
      nextStep: string;
      leverage?: string;
    }
    const recs: Rec[] = [];
    const vcSeats = latest.vcSeats;

    // ── Board control lost ───────────────────────────────────────────────────
    if (vcSeats >= founderSeats + 1) {
      recs.push({
        priority: "critical",
        timing: "now",
        action: `Reclaim board balance — VCs hold ${vcSeats} seats, you hold ${founderSeats}`,
        why: isUS
          ? `Under DGCL the board controls CEO removal, M&A approval, and new equity issuances. With ${vcSeats} VC seats vs your ${founderSeats}, every major decision can be forced through without you.`
          : `With ${vcSeats} VC seats vs your ${founderSeats} founder seats, VCs can remove the CEO, block any acquisition, and issue new shares that dilute you further — all without your vote.`,
        nextStep: isUS
          ? "Add to your next SHA negotiation: (1) founders nominate the independent director, (2) supermajority board consent (≥75%) required for CEO removal, (3) cap all future rounds at 1 observer seat only."
          : "Add to your next SHA negotiation: (1) founders have the right to nominate the independent director, (2) unanimous board consent required for CEO removal, (3) future rounds get observer seats only — no new director rights.",
        leverage: "Use competing term sheets or a down-round scenario to reopen governance terms.",
      });
    }

    // ── Board tied ───────────────────────────────────────────────────────────
    if (vcSeats === founderSeats && vcSeats > 0) {
      recs.push({
        priority: "high",
        timing: "now",
        action: `Board is ${founderSeats}–${vcSeats} tied — the independent director is the swing vote on everything`,
        why: "A tied board means every contested decision — CEO comp, M&A, next round terms — is decided by whoever the independent director sides with. Most independents are former VCs or VC-network operators.",
        nextStep: isUS
          ? "Draft SHA clause this week: 'Founders shall have the right to nominate the independent director, subject to VC approval not to be unreasonably withheld.' Add a conflict-of-interest bar: the independent must not be a GP or LP in any fund on the board."
          : "Draft SHA clause: 'Founders shall have the right to nominate the independent director.' Bar: independent must not be an LP in any fund represented on the board.",
        leverage: "Raise this before the next round term sheet — it's easiest to fix when investors want the deal.",
      });
    }

    // ── Dual-class shares ────────────────────────────────────────────────────
    if (anyRoundsEnabled) {
      recs.push({
        priority: founderPct < 51 ? "high" : "medium",
        timing: "now",
        action: isUS
          ? "Set up dual-class shares (10:1 voting) in Delaware — must be done before first priced round closes"
          : "Set up dual-class shares (DVR, 10:1 voting) — must be done before first round closes",
        why: isUS
          ? `Your founders are at ${founderPct.toFixed(1)}% equity. With dual-class, even at 15% equity you keep majority votes. Google, Meta, and Snap all use this structure. Once VCs invest, adding it requires unanimous shareholder consent — they will almost always say no.`
          : `Your founders are at ${founderPct.toFixed(1)}% equity. With DVR shares (Class B, 10 votes each) under Companies Act Section 43, even at 20% equity you retain 70%+ of votes. After VCs invest, this requires unanimous consent — practically impossible.`,
        nextStep: isUS
          ? "Call a Delaware startup attorney this week. Ask for a dual-class recapitalisation: founders get Class B (10 votes), investors get Class A (1 vote). Cost: $5–15K. Timeline: 2–4 weeks. Do this before any term sheet is signed."
          : "Engage a CA/CS this week. Ask for DVR share issuance under Section 43 before the first round SPA is signed. Cost: ₹50K–₹2L. Must be approved by shareholders and ROC-filed before allotment.",
      });
    }

    // ── Board seat cap ───────────────────────────────────────────────────────
    if (anyRoundsEnabled && vcSeats >= 1 && vcSeats < founderSeats + 1) {
      recs.push({
        priority: "high",
        timing: "next-round",
        action: "Lock in a hard cap: all VCs combined ≤ 2 board seats, forever",
        why: `You currently have ${vcSeats} VC seat${vcSeats > 1 ? "s" : ""}. Without a cap, every future lead investor will demand a seat — you'll lose board control by Series B without a single bad decision.`,
        nextStep: isUS
          ? "Insist on this IRA / SHA clause before the next term sheet is signed: 'All Investor Directors combined shall not exceed two (2) seats at any time, regardless of future financing rounds.' Delaware courts will enforce it."
          : "Insist on this SHA clause: 'All investor directors combined shall not exceed two (2) seats at any time, regardless of future financings.' Have your lawyer add it to the SHA as a condition to closing.",
        leverage: "Offer a broader information rights package (quarterly updates, board observer access) in exchange for the seat cap.",
      });
    }

    // ── Series A 2-seat risk ─────────────────────────────────────────────────
    if (state.rounds.a.enabled && state.rounds.a.board === "2") {
      recs.push({
        priority: "high",
        timing: "next-round",
        action: "Negotiate Series A VC board from 2 seats down to 1",
        why: "2 VC seats at Series A + 1 at Series B = tied board. The independent director becomes kingmaker from Series B onward and you have no control over who that is.",
        nextStep: "Counter the term sheet with 1 seat + 1 observer for the Series A lead. Offer enhanced information rights (monthly financials, budget approval visibility) as the trade. Most institutional VCs will accept if you ask early.",
        leverage: "2 VC seats is not market standard at Series A in the US or India — use NVCA or YC safe harbour language to anchor the negotiation.",
      });
    }

    // ── Redemption rights ────────────────────────────────────────────────────
    if (hasRedemption) {
      recs.push({
        timing: "now",
        priority: "critical",
        action: `Remove redemption rights — ${fmtM(totalRedemptionLiability)} cash liability if triggered`,
        why: `${redemptionItems.map((r) => `${r.label} VC holds a ${r.mult}× redemption right worth ${fmtM(r.liability)} (due ${r.years}y post-close)`).join("; ")}. Total cash liability: ${fmtM(totalRedemptionLiability)}. If the company cannot repurchase at trigger, the VC can force a sale or liquidation at a time you don't control.`,
        nextStep: isUS
          ? "Strike redemption entirely (most US VCs accept this post-2015 NVCA revision). If they insist: cap at 1× cost (no premium), require approval of 75%+ of preferred, and include a 3-year installment clause. Reference NVCA Model Investors' Rights Agreement §4."
          : "Cite Companies Act 2013 §68 — repurchases require distributable profits and board + shareholder approval. Negotiate: cap at 1× cost, installment buyout over 3 years, trigger only on IPO failure after 7+ years. Blume/3one4/Elevation rarely enforce redemption; use this as leverage to remove it.",
        leverage: `${fmtM(totalRedemptionLiability)} is a concrete number — put it on the table. Show the VC that forcing redemption on a company with insufficient distributable profits triggers insolvency proceedings, destroying their investment too. Most VCs will drop it.`,
      });
    }

    // ── Participating preferred ──────────────────────────────────────────────
    if (hasParticipatingPreferred) {
      const fPayoutsBase = founderPayouts(latest, state.exitValue, false, false, {}, true);
      const fPayoutsPref = founderPayouts(latest, state.exitValue, true, false, {}, true);
      const baseTake = fPayoutsBase.reduce((s, f) => s + f.payout, 0);
      const prefTake = fPayoutsPref.reduce((s, f) => s + f.payout, 0);
      const lostM = baseTake - prefTake;
      recs.push({
        priority: "critical",
        timing: "next-round",
        action: "Strike participating preferred from every round — negotiate non-participating 1×",
        why: `At a ${fmtM(state.exitValue)} exit, participating preferred costs founders ${fmtM(lostM)} compared to non-participating — VCs get their capital back AND share the upside. This is the single most value-destructive term after board control.`,
        nextStep: isUS
          ? "Counter every term sheet with: 'Non-participating preferred, 1× liquidation preference.' Cite NVCA Model Documents — participating preferred is rare post-2015 in US institutional rounds. Walk away from any deal that won't move off participating."
          : "Cite the India market standard: non-participating at Seed, Series A, and beyond. Add to your SHA: 'Preference shares shall be non-participating. Investors elect either preference OR pro-rata common — not both.'",
        leverage: `${fmtM(lostM)} is a concrete number to put in front of a VC — show them the exit waterfall. Most reasonable investors will concede once they see the founder outcome.`,
      });
    }

    // ── 2× preference ───────────────────────────────────────────────────────
    const hasAggressivePref = enabledRounds.some((k) => state.rounds[k].prefMult >= 2);
    if (hasAggressivePref) {
      const aggressiveRounds = enabledRounds.filter((k) => state.rounds[k].prefMult >= 2).map((k) => ({ seed: "Seed", preseed: "Pre-seed", a: "Series A", b: "Series B", c: "Series C" }[k]));
      recs.push({
        priority: "critical",
        timing: "next-round",
        action: `Push back on 2× liquidation preference in ${aggressiveRounds.join(", ")}`,
        why: `A 2× preference means investors get double their money back before founders see anything. If your exit is smaller than expected, founders walk away with nothing while VCs are made whole twice over. 1× non-participating is the global market standard.`,
        nextStep: "Respond to the term sheet with: 'We'll accept 1× non-participating, standard market terms. We have another conversation ongoing and will move to whichever investor matches market.' Then actually run a competitive process — a single competing term sheet drops 2× to 1× in most cases.",
        leverage: "Use Carta / Visible term sheet benchmarks to show 2× is an outlier — data wins this argument.",
      });
    }

    // ── US-specific ──────────────────────────────────────────────────────────
    if (isUS) {
      recs.push({
        priority: "high",
        timing: "now",
        action: "If incorporated in India: flip to a Delaware C-Corp before your first US term sheet",
        why: "Most US institutional investors (YC, Sequoia, a16z, General Catalyst) legally cannot invest in Indian entities due to fund LP restrictions. They will pass on your deal — not because they don't like you, but because their fund documents prohibit it.",
        nextStep: "Engage Gunderson Dettmer, Cooley, or Wilson Sonsini this week. Ask for a 'redomiciliation flip' quote — Indian entity becomes a wholly-owned US subsidiary. Budget $30–50K legal, 60–90 days. Start before any term sheet so you don't lose a deal to timeline.",
        leverage: "If you already have a Delaware entity, this does not apply — skip it.",
      });
      if (!state.safe.enabled) {
        recs.push({
          priority: "medium",
          timing: "now",
          action: "For angel / pre-seed rounds: use YC's post-money SAFE — avoid bespoke SAFE terms",
          why: "Custom SAFEs often have ambiguous conversion mechanics and side letters that create hidden pro-rata obligations. Post-money SAFE fixes investor dilution at the cap; all ESOP top-up dilution falls on founders until conversion.",
          nextStep: "Download the YC SAFE from ycombinator.com/documents. Use the post-money version with a valuation cap. Add MFN for your first cheque. Decline any requests for side letters with additional information rights or pro-rata beyond what the SAFE provides.",
        });
      }
      const hasEsopRounds = enabledRounds.some((k) => state.rounds[k].esop > 0);
      if (hasEsopRounds) {
        recs.push({
          priority: "high",
          timing: "ongoing",
          action: "Get a 409A valuation within 12 months of every ESOP grant — and refresh after each round",
          why: "Without a 409A, the IRS classifies all options as NSOs. A senior engineer with 100K ISOs at a $200M exit loses ~$40K in tax treatment vs NSOs. You'll fail to attract top talent if your option plan isn't defensible.",
          nextStep: "After this round closes, order a 409A from Carta, Capshare, or a Big 4 team ($5–15K). Put a recurring calendar reminder: refresh 409A annually and within 90 days of any material financing event. ISOs go to US employees; use NSOs for international hires.",
        });
      }
    } else if (isIndiaResident) {
      // ── India-specific ───────────────────────────────────────────────────
      // Flip structure — only for india-flip path
      if (isFlip && anyRoundsEnabled) {
        recs.push({
          priority: "critical",
          timing: "now",
          action: "Initiate India → US entity flip structure before approaching US VCs",
          why: "Indian residents cannot directly own a Delaware C-Corp under FEMA / RBI regulations. US VCs will require a Delaware C-Corp before closing. Structure: LLP (India founders) → Delaware C-Corp → India Pvt Ltd subsidiary. Missing this means 3–6 month delays after a term sheet, which kills most deals.",
          nextStep: "Engage a CA/law firm experienced in FEMA/ODI filings. Steps in order: (1) Form LLP — ₹15K, 10 days; (2) LLP incorporates Delaware C-Corp — $600, 5 days; (3) file Form ODI with RBI via AD bank within 30 days; (4) Delaware C-Corp incorporates India Pvt Ltd subsidiary — ₹50K, 20 days; (5) founders swap LLP interest for Delaware shares at SEBI-registered FMV. Total cost: ₹3–8L, total timeline: 3–4 months. Do not sign a US term sheet before the Delaware entity exists.",
          leverage: "Come to the first VC meeting with the Delaware entity already incorporated. It signals seriousness and removes the single biggest closing risk. VCs who have been burned by post-term-sheet flip delays often pass on Indian teams that haven't done this.",
        });
      }
      recs.push({
        priority: "high",
        timing: "now",
        action: "Confirm investor domicile before allotment — your compliance path is completely different",
        why: "Indian VC (SEBI-registered AIF): standard board resolution + ROC filing, no RBI loop needed. Foreign VC (US, Singapore, Cayman): FEMA applies — FC-GPR mandatory within 30 days, pricing must be at or above FMV, funds must route through an authorised dealer bank.",
        nextStep: "Before signing any SPA: (1) ask the VC for their SEBI AIF registration number OR confirm their legal domicile, (2) if foreign — appoint an AD bank (HDFC, ICICI, or Kotak) to receive funds, (3) get a CA/CS to handle the allotment and FC-GPR filing. Price shares using SEBI DCF/NAV norms and get a valuation certificate before allotment.",
        leverage: "For Indian AIFs investing via GIFT City or offshore structures: domicile classification is not always obvious. Have your lawyer confirm before signing.",
      });
      const hasEarlyRounds = state.rounds.preseed.enabled || state.rounds.seed.enabled;
      if (hasEarlyRounds) {
        recs.push({
          priority: "medium",
          timing: "now",
          action: "Consider CCDs instead of direct equity for pre-seed and seed rounds",
          why: "Direct equity at early stages triggers FMV valuation requirements immediately. CCDs defer the FMV question until conversion — cleaner for sub-₹5Cr cheques and avoids a potentially ugly early valuation fight.",
          nextStep: "Ask your CA to structure the instrument as CCDs with: (1) 6–10% interest rate (arm's length), (2) mandatory conversion trigger at the next priced equity round, (3) conversion ratio set at a discount to that round's pre-money price. Avoid SAFEs for Indian entities — RBI has not provided clear FEMA guidance for them.",
        });
      }
    }

    // ── Founder Voting Agreement ─────────────────────────────────────────────
    if (anyRoundsEnabled) {
      const latestFounderHolders = latest.holders.filter((h) => h.type === "founder");
      const anyFounderBelowFloor = latestFounderHolders.some((h) => h.pct < 5);
      recs.push({
        priority: anyFounderBelowFloor ? "critical" : "high",
        timing: "now",
        action: anyFounderBelowFloor
          ? "Sign a Founder Voting Agreement immediately — at least one founder is below the 5% individual nomination floor"
          : "Sign a Founder Voting Agreement before your first institutional round",
        why: anyFounderBelowFloor
          ? `One or more founders now hold less than 5% individually. VCs can challenge their right to self-nominate as directors. Without a Voting Agreement, those founders can be removed from the board by a shareholder vote they can't win alone.`
          : `With ${founderOnlyHolders.length} founders, equity dilutes unevenly round by round. Founders with smaller initial stakes hit the 5% individual nomination floor earlier than others. A Voting Agreement locks in 2 founder board seats regardless of who gets diluted first — costs nothing to negotiate today, nearly impossible to add after Series A.`,
        nextStep: isUS
          ? "Have your lawyer draft a Voting Agreement this week (3–5 pages): all founders pledge to vote their shares to elect each other as directors. Must cover: (1) all current and future share classes, (2) survives any ROFR transfers, (3) terminates only on mutual written consent or qualified IPO. Sign before any term sheet is received."
          : "Have your lawyer prepare a Voting Agreement side letter this week: all founders agree to vote their shares to elect each other as directors. Clauses: (1) applies to all current and future equity classes, (2) survives secondary transfers between founders, (3) new co-founders may be added by unanimous consent. Sign before any VC term sheet.",
        leverage: isUS
          ? "VCs will try to block or dilute this clause at Series A — sign it now before any term sheet is in play. Pre-Series A founders have full leverage to sign among themselves."
          : "Easiest to sign now — after Seed round, VCs will require SHA consent for any new founder-side agreements and may object to bloc-voting clauses.",
      });
    }

    return recs;
  }, [isUS, isFlip, isMoveToUS, isIndiaResident, latest, founderSeats, founderPct, founderOnlyHolders, anyRoundsEnabled, state.rounds, state.exitValue, state.usePref, enabledRounds, hasParticipatingPreferred, state.safe.enabled, hasRedemption, redemptionItems, totalRedemptionLiability]);

  // Full-ratchet counterfactual — only runs when at least one enabled round has full-ratchet
  const hasFullRatchet = ROUND_KEYS.some((k) => state.rounds[k]?.enabled && state.rounds[k]?.antiDilution === "full-ratchet");

  const fullRatchetComparison = useMemo(() => {
    if (!hasFullRatchet) return null;
    const mkState = (ad: "bbwa" | "none") => ({
      ...state,
      rounds: Object.fromEntries(
        ROUND_KEYS.map((k) => [
          k,
          state.rounds[k]?.antiDilution === "full-ratchet"
            ? { ...state.rounds[k], antiDilution: ad }
            : state.rounds[k],
        ])
      ) as typeof state.rounds,
    });
    const snapsBBWA = computeSnaps(mkState("bbwa"));
    const snapsNone = computeSnaps(mkState("none"));
    const latestBBWA = latestSnap(snapsBBWA);
    const latestNone = latestSnap(snapsNone);
    const founderPctFR   = latest.holders.filter((h) => h.type === "founder").reduce((s, h) => s + h.pct, 0);
    const founderPctBBWA = latestBBWA.holders.filter((h) => h.type === "founder").reduce((s, h) => s + h.pct, 0);
    const founderPctNone = latestNone.holders.filter((h) => h.type === "founder").reduce((s, h) => s + h.pct, 0);
    const payFR   = founderPayouts(latest,     state.exitValue, state.usePref).reduce((s, f) => s + f.payout, 0);
    const payBBWA = founderPayouts(latestBBWA, state.exitValue, state.usePref).reduce((s, f) => s + f.payout, 0);
    const payNone = founderPayouts(latestNone, state.exitValue, state.usePref).reduce((s, f) => s + f.payout, 0);
    return { founderPctFR, founderPctBBWA, founderPctNone, payFR, payBBWA, payNone };
  }, [hasFullRatchet, state, latest]);

  // Line chart data with dynamic Y max (BUG FIX 2)
  const lineData = snapKeys.map((k) => {
    const row: Record<string, number | string> = { round: snaps[k].label };
    founderOnlyHolders.forEach((f) => {
      const h = snaps[k].holders.find((x) => x.name === f.name);
      row[f.name] = h ? Number(h.pct.toFixed(2)) : 0;
    });
    row["Total VC"] = Number(snaps[k].holders.filter((h) => h.type === "vc").reduce((s, h) => s + h.pct, 0).toFixed(2));
    return row;
  });
  const lineMaxRaw = Math.max(
    ...lineData.flatMap((d) => Object.entries(d).filter(([k]) => k !== "round").map(([, v]) => Number(v))),
    10,
  );
  const lineMax = Math.ceil(lineMaxRaw / 10) * 10;

  return (
    <div className="simulator-content space-y-4 pb-6 md:pb-6">
      {/* Summary Pills */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="hero-pill rounded-xl p-4">
          <div className="hero-pill-label">Founders Combined</div>
          <div className="hero-pill-number">{founderPct.toFixed(1)}%</div>
          <div className="hero-pill-status" style={{ color: founderPct > 51 ? "oklch(0.76 0.18 150)" : founderPct > 35 ? "oklch(0.85 0.18 75)" : "oklch(0.75 0.2 25)" }}>
            {founderPct > 51 ? "Majority — you have control" : founderPct > 35 ? "Caution — watch dilution" : "Minority position"}
          </div>
        </div>
        <Card className="stat-pill p-4 flex flex-col items-center justify-center text-center">
          <div className="stat-pill-label">Post-money Val.</div>
          <div className="stat-pill-number">{fmtVal(latest.valuation)}</div>
          <div className="stat-pill-sub">{latest.valuation ? latest.label : "Configure rounds"}</div>
        </Card>
        <Card className="stat-pill p-4 flex flex-col items-center justify-center text-center">
          <div className="stat-pill-label">Board Control</div>
          <div className="stat-pill-number">{latest.vcSeats === 0 ? "Safe" : latest.vcSeats < founderSeats ? "Safe" : latest.vcSeats === founderSeats ? "Tied" : "Lost"}</div>
          <div className="stat-pill-sub">F:{fSeatPct}% · V:{vSeatPct}% · I:{iSeatPct}%</div>
        </Card>
        <Card className="stat-pill p-4 flex flex-col items-center justify-center text-center">
          <div className="stat-pill-label">Investor Stake</div>
          <div className="stat-pill-number">{vcPct.toFixed(1)}%</div>
          <div className="stat-pill-sub">
            {(() => {
              const names = [...latest.vcNames];
              if (latest.holders.some((h) => h.type === "safe")) names.unshift("SAFE");
              return names.length ? names.join(", ") : "No rounds yet";
            })()}
          </div>
        </Card>
      </div>

      {/* Global validation warning */}
      {hasErrors && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-xs text-red-600 font-semibold">
          <span>⚠️</span>
          <span>Some inputs have errors — results may be inaccurate. Check the highlighted fields below.</span>
        </div>
      )}

      {/* Beginner / Expert toggle + Export */}
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => setShowExport(true)}
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
        >
          📤 Export
        </button>
        <span className={cn("text-xs font-semibold", !expertMode ? "text-primary" : "text-muted-foreground")}>Beginner</span>
        <Switch
          checked={expertMode}
          onCheckedChange={(v) => setExpertMode(v)}
        />
        <span className={cn("text-xs font-semibold", expertMode ? "text-primary" : "text-muted-foreground")}>Expert</span>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        {/* Tab scroll container with fade indicators */}
        <div
          className="tab-scroll-container hidden md:block"
          ref={(el) => {
            if (!el) return;
            const inner = el.querySelector(".tab-inner-scroll") as HTMLElement | null;
            if (!inner) return;
            const update = () => {
              el.classList.toggle("scrolled-start", inner.scrollLeft > 8);
              el.classList.toggle("scrolled-end", inner.scrollLeft + inner.clientWidth >= inner.scrollWidth - 8);
            };
            inner.addEventListener("scroll", update, { passive: true });
            update();
          }}
        >
          <div className="tab-inner-scroll overflow-x-auto -mx-1 px-1 pb-1 scrollbar-none" style={{ scrollbarWidth: "none" }}>
            <TabsList className="tab-hint-animate flex w-max min-w-full h-auto gap-1 p-1">
              <TabsTrigger value="setup" className="flex-shrink-0 text-xs px-3 py-2 gap-1.5"><Users className="h-3.5 w-3.5" /> Setup</TabsTrigger>
              <TabsTrigger value="rounds" className="flex-shrink-0 text-xs px-3 py-2 gap-1.5"><Settings2 className="h-3.5 w-3.5" /> Rounds</TabsTrigger>
              <TabsTrigger value="outcomes" className="flex-shrink-0 text-xs px-3 py-2 gap-1.5"><PieChartIcon className="h-3.5 w-3.5" /> Outcomes</TabsTrigger>
              <TabsTrigger value="negotiate" className="flex-shrink-0 text-xs px-3 py-2 gap-1.5"><Shield className="h-3.5 w-3.5" /> Negotiate</TabsTrigger>
              <TabsTrigger value="compare" className="flex-shrink-0 text-xs px-3 py-2 gap-1.5"><BarChart3 className="h-3.5 w-3.5" /> Compare</TabsTrigger>
            </TabsList>
          </div>
        </div>

        {/* ── SETUP ── */}
        <TabsContent value="setup" className="space-y-3 mt-4">

          {/* Company Name */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Company name</label>
            <input
              type="text"
              placeholder="e.g. Acme Inc."
              value={state.companyName ?? ""}
              readOnly={readOnly}
              onChange={(e) => onChange({ ...state, companyName: e.target.value })}
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm font-semibold placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          {/* Founder Structure Selector */}
          <div className="space-y-2">
            <div className="text-sm font-semibold" style={{ color: "oklch(0.22 0.04 265)" }}>Where are you based and what entity are you building?</div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              {([
                {
                  value: "india-only" as const,
                  flag: "🇮🇳",
                  title: "India entity only",
                  subtitle: "Pvt Ltd in India · raising from Indian VCs (SEBI-registered AIFs)",
                  market: "india" as const,
                  rounds: INDIA_DEFAULT_ROUNDS,
                },
                {
                  value: "india-flip" as const,
                  flag: "🇮🇳 → 🇺🇸",
                  title: "Staying in India · US entity via LLP",
                  subtitle: "LLP → Delaware C-Corp → India subsidiary · targeting US VCs",
                  market: "us" as const,
                  rounds: US_DEFAULT_ROUNDS,
                },
                {
                  value: "india-us-move" as const,
                  flag: "✈️ 🇺🇸",
                  title: "Moving to the US permanently",
                  subtitle: "Direct Delaware ownership · no LLP needed · OCI / visa path",
                  market: "us" as const,
                  rounds: US_DEFAULT_ROUNDS,
                },
                {
                  value: "us" as const,
                  flag: "🇺🇸",
                  title: "US-based founder",
                  subtitle: "Standard Delaware C-Corp · NVCA docs · 409A · QSBS",
                  market: "us" as const,
                  rounds: US_DEFAULT_ROUNDS,
                },
              ] as const).map((opt) => {
                const isSelected = founderStructure === opt.value;
                return (
                  <button
                    key={opt.value}
                    disabled={readOnly}
                    onClick={() => {
                      if (readOnly || founderStructure === opt.value) return;
                      const noRoundsActive = ROUND_KEYS.every((k) => !state.rounds[k].enabled);
                      onChange({
                        ...state,
                        founderStructure: opt.value,
                        market: opt.market,
                        rounds: noRoundsActive ? opt.rounds : state.rounds,
                      });
                    }}
                    className={cn(
                      "relative w-full rounded-xl border-2 px-3 py-3 text-center transition-all",
                      isSelected
                        ? "border-primary bg-primary/8 shadow-sm"
                        : "border-border bg-white hover:border-primary/40 hover:bg-muted/20",
                    )}
                  >
                    {isSelected && (
                      <div className="absolute top-2 right-2 h-4 w-4 rounded-full bg-primary flex items-center justify-center">
                        <div className="h-1.5 w-1.5 rounded-full bg-white" />
                      </div>
                    )}
                    <div className="text-2xl mb-1.5">{opt.flag}</div>
                    <div className={cn("text-xs font-semibold leading-tight", isSelected ? "text-primary" : "text-foreground")}>{opt.title}</div>
                    <div className="text-xs text-muted-foreground mt-1 leading-snug line-clamp-2">{opt.subtitle}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Context banner */}
          {founderStructure === "india-only" && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-xs text-amber-900">
              <span className="font-bold">India entity mode</span> — Guidance reflects Companies Act 2013, SEBI AIF norms, CCPS structures, angel tax (Section 56(2)(viib)), and MCA filing requirements. Round sizes in ₹Cr equivalent.
            </div>
          )}
          {founderStructure === "india-flip" && (
            <div className="rounded-xl border px-4 py-3 text-xs" style={{ borderColor: "oklch(0.76 0.15 285 / 0.4)", background: "oklch(0.975 0.008 285)" }}>
              <span className="font-bold" style={{ color: "oklch(0.22 0.04 265)" }}>India resident · Delaware entity mode</span>
              <span className="ml-1" style={{ color: "oklch(0.4 0.03 265)" }}>— Rounds follow US VC norms. Compliance guidance covers FEMA, ODI filings, and transfer pricing between your India subsidiary and Delaware parent. See the Flip Structure card below.</span>
            </div>
          )}
          {founderStructure === "india-us-move" && (
            <div className="rounded-xl border border-blue-200 bg-blue-50/60 px-4 py-3 text-xs text-blue-900">
              <span className="font-bold">Moving to US mode</span> — You can own Delaware shares directly (no LLP needed) once you are a non-resident under FEMA. Key steps: obtain OCI card or valid US visa, update your FEMA residential status, and file your Indian exit-year tax return with a CA. DTAA (India-US) eliminates double taxation on salary and capital gains.
            </div>
          )}
          {founderStructure === "us" && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800">
              <span className="font-bold">US mode</span> — Round sizes default to US norms. Insights reflect Delaware C-Corp structure, YC SAFE terms, 409A requirements, and NVCA protective provisions.
            </div>
          )}

          {/* Founder seats */}
          <Card className="p-4">
            <div className="flex items-center gap-1.5 mb-1">
              <Label className="text-xs font-semibold">Number of founder board directors</Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button className="w-4 h-4 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">?</button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[220px] text-xs">
                    <p className="font-bold text-primary mb-1">Founder Directors</p>
                    <p>How many board seats founders control. This flows into board control, voting power, and "safe / tied / lost" recommendations across rounds.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <p className="text-xs text-muted-foreground mb-2">Used in all board calculations, voting power, and recommendations.</p>
            <Select
              value={String(founderSeats)}
              disabled={readOnly}
              onValueChange={(v) => onChange({ ...state, founderSeats: parseInt(v, 10) })}
            >
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4].map((n) => <SelectItem key={n} value={String(n)}>{n} seat{n > 1 ? "s" : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </Card>

          {/* Board retention equity threshold */}
          <Card className="p-4">
            <div className="flex items-center gap-1.5 mb-1">
              <Label className="text-xs font-semibold">Min. founder equity to retain board seats</Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button className="w-4 h-4 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">?</button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[260px] text-xs">
                    <p className="font-bold text-primary mb-1">Board Retention Threshold</p>
                    <p>Most VC term sheets include a "Director Qualification Threshold" clause: if founders collectively dilute below this equity %, the SHA requires them to resign their director seats. {isUS ? "US standard: 10–15% (NVCA model)." : "India standard: 15–20% (standard SEBI / Blume-era SHA language)."}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              If founders collectively drop below this threshold, your SHA typically requires immediate resignation of all founder-nominated director seats.
            </p>
            <div className="flex items-center gap-3">
              <Input
                type="number"
                min={0}
                max={49}
                step={1}
                disabled={readOnly}
                value={state.boardRetentionPct ?? (isUS ? 10 : 15)}
                className="w-24 h-8 text-sm"
                onChange={(e) => {
                  const v = Math.max(0, Math.min(49, Number(e.target.value)));
                  onChange({ ...state, boardRetentionPct: v });
                }}
              />
              <span className="text-sm font-semibold">%</span>
              <span className="text-xs text-muted-foreground">collective founder equity (fully diluted)</span>
            </div>
            <div className="mt-2 text-xs text-muted-foreground bg-muted/40 rounded px-2 py-1">
              {isUS ? "💡 US default: 10% — Delaware / NVCA standard. Negotiate to 5% before signing." : "💡 India default: 15% — typical in SHA from Seed onward. Push to 10% and exclude VC-dilution rounds."}
            </div>
          </Card>

          {/* Day 0 Legal Checklist */}
          <Card className="p-4">
            <Accordion type="single" collapsible>
              <AccordionItem value="day0" className="border-0">
                <AccordionTrigger className="py-0 hover:no-underline">
                  <div className="font-semibold text-sm text-foreground">Day 0 Legal Checklist</div>
                </AccordionTrigger>
                <AccordionContent className="pt-3">
                <p className="text-xs text-muted-foreground mb-3">
                  These are non-negotiable before taking any VC money. Each item costs less than one lawyer hour to set up; skipping any creates a deal-blocker at due diligence.
                </p>
            {(() => {
              type CheckItem = { id: string; label: string; detail: string; critical: boolean; market?: "both" | "india" | "us" };
              const items: CheckItem[] = ([
                {
                  id: "ip",
                  label: "IP assignment agreement signed by all founders",
                  detail: isUS
                    ? "Every founder must sign a PIIA (Proprietary Information & Inventions Agreement) assigning all IP created before and during their tenure to the company. VCs will not close without this. Use Orrick or Cooley's standard form. Takes 20 minutes."
                    : "Every founder must sign an IP Assignment Deed under the Patents Act 1970 / Copyright Act 1957 transferring all pre-incorporation IP to the company. This includes code, designs, trademarks, and know-how. File with the company secretary. Cost: ~₹5,000 lawyer fee.",
                  critical: true,
                  market: "both",
                },
                {
                  id: "buysell",
                  label: "Co-founder buy-sell / shotgun clause in SHA",
                  detail: isUS
                    ? "A shotgun / buy-sell clause lets any co-founder set a price at which they'll either buy the other out or sell their stake at that price. It's the cleanest co-founder divorce mechanism. Without it, a departing co-founder can hold the company hostage. Add to your Founders' Agreement before Seed."
                    : "A buy-sell clause between co-founders should be in your Founders' Agreement or SHA. Without it, a departing founder retains shares and blocking rights indefinitely. Standard clause: either founder can trigger a valuation process; the non-triggering founder chooses to buy or sell at that value. Add this before any external investment.",
                  critical: true,
                  market: "both",
                },
                {
                  id: "vesting-agree",
                  label: "Co-founder vesting agreement in place",
                  detail: isUS
                    ? "Standard: 4-year vest, 1-year cliff, monthly thereafter. All co-founders should be on the same vesting schedule from day one — mismatched vesting is a red flag in VC due diligence. If one founder has shorter vesting, it creates an incentive to exit early and leave others holding the company."
                    : "Standard: 4-year vest, 1-year cliff (Indian market norm per Blume/3one4 playbooks). All co-founders on the same schedule. The vesting agreement should be a formal contract with the company, not just an informal understanding.",
                  critical: true,
                  market: "both",
                },
                {
                  id: "409a",
                  label: isUS ? "409A valuation obtained before option grants" : "Registered valuer FMV report before any share / option issuance",
                  detail: isUS
                    ? "Any option granted without a contemporaneous 409A valuation is a phantom income tax event for the employee. Get a 409A before your first option grant — costs $1,500–$3,000 and is valid for 12 months or until a material event (new round, acquisition)."
                    : "Under Companies Act 2013, shares issued above FMV attract income tax for the company (Section 56(2)(viib) angel tax). Get a SEBI-registered valuer's FMV report before allotting any shares or ESOPs. Cost: ₹30,000–₹80,000. Valid until next funding event.",
                  critical: !isUS,
                  market: "both",
                },
                {
                  id: "bank",
                  label: "Separate company bank account (no commingling)",
                  detail: "Company funds must be in a dedicated corporate account. Commingling personal and company funds pierces the corporate veil and is a deal-stopper in any serious due diligence. Set up a current account in the company's name on Day 1.",
                  critical: false,
                  market: "both",
                },
                {
                  id: "gstin",
                  label: "GST registration (if revenue > ₹20L threshold)",
                  detail: "If your company is generating revenue above the GST threshold or providing B2B SaaS services, register for GST immediately. Unregistered revenue creates retroactive tax liability that complicates any investment round.",
                  critical: false,
                  market: "india",
                },
              ] as CheckItem[]).filter((it) => !it.market || it.market === "both" || (isUS ? it.market === "us" : it.market === "india"));
              return (
                <div className="space-y-2">
                  {items.map((item) => (
                    <div key={item.id} className={`rounded-md border p-2.5 ${item.critical ? "border-amber-300/70 bg-amber-50/50 dark:bg-amber-950/20" : "border-border bg-muted/20"}`}>
                      <div className="flex items-start gap-2">
                        <span className="text-sm mt-0.5">{item.critical ? "⚠️" : "✓"}</span>
                        <div className="flex-1">
                          <div className="text-xs font-semibold">{item.label}</div>
                          <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{item.detail}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </Card>

          {/* India Entity Structure Card — only for india-flip */}
          {isFlip && (
            <Card className="p-4 border-l-4" style={{ borderLeftColor: "oklch(0.5 0.03 265 / 0.4)" }}>
              <Accordion type="single" collapsible>
                <AccordionItem value="flip" className="border-0">
                  <AccordionTrigger className="py-0 hover:no-underline">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-foreground">🏗️ India → US Flip Structure</span>
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: "oklch(0.76 0.15 285 / 0.2)", color: "oklch(0.22 0.04 265)" }}>Required before US VC</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pt-3">
                  <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                    Indian residents cannot directly own a US entity (Delaware C-Corp) under RBI / FEMA regulations.
                    The required structure before raising from US VCs:
                  </p>
              <div className="space-y-2 mb-3">
                {[
                  {
                    step: "1",
                    title: "Form an LLP in India",
                    detail: "All Indian resident founders register a Limited Liability Partnership. The LLP becomes the vehicle for outward remittance. Cost: ₹5,000–₹15,000. Timeline: 7–10 days.",
                    critical: true,
                  },
                  {
                    step: "2",
                    title: "LLP incorporates Delaware C-Corp",
                    detail: "The LLP (not individual founders) incorporates a Delaware C-Corp and holds 100% of shares initially. File Form ODI with RBI via your AD bank within 30 days of remittance. Cost: $500 legal + $90 state fee. Timeline: 3–5 days.",
                    critical: true,
                  },
                  {
                    step: "3",
                    title: "Delaware C-Corp creates India Pvt Ltd subsidiary",
                    detail: "The Delaware entity incorporates a wholly-owned Indian Private Limited company for India operations — employees, contracts, and India revenue sit here. The IP and cap table live in Delaware. Requires RBI FIPB-exempt automatic route or SIA approval. Cost: ₹20,000–₹50,000. Timeline: 15–20 days.",
                    critical: true,
                  },
                  {
                    step: "4",
                    title: "Founders swap LLP stakes → Delaware shares",
                    detail: "Founders receive shares in the Delaware C-Corp in exchange for their LLP interest. The exchange ratio must be at FMV. After this step, individual founders own Delaware shares and the LLP can be wound down. Get a SEBI-registered valuer's report for the swap.",
                    critical: false,
                  },
                ].map((s) => (
                  <div key={s.step} className={`rounded-md border p-2.5 ${s.critical ? "border-amber-200 bg-amber-50/50" : "border-border bg-muted/10"}`}>
                    <div className="flex gap-2.5 items-start">
                      <div className="flex-shrink-0 h-5 w-5 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: "oklch(0.22 0.04 265)" }}>{s.step}</div>
                      <div>
                        <div className="text-xs font-semibold">{s.title}</div>
                        <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{s.detail}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground leading-relaxed">
                <span className="font-semibold text-foreground">Key regulations:</span> FEMA 1999 · RBI Master Direction on ODI (2022) · Companies Act 2013 (Section 2(87) subsidiary definition) · Income Tax Act Section 9 (deemed income for IP held abroad). Start this process <span className="font-semibold text-foreground">3–4 months before</span> you need to sign a US term sheet. Do not sign a term sheet before the Delaware entity exists — restructuring post-investment is extremely expensive (₹15–40L in legal/CA fees).
              </div>
              <div className="mt-2.5 rounded-md border border-blue-200 bg-blue-50/50 px-3 py-2 text-xs leading-relaxed">
                <span className="font-semibold">Transfer pricing:</span> All transactions between the India Pvt Ltd and the Delaware parent (software licences, management fees, shared services) must be at arm's length under Section 92 of the Income Tax Act. Document these with a Transfer Pricing study. Undocumented intra-group charges are the #1 India tax audit trigger for VC-backed startups.
              </div>
              </AccordionContent>
              </AccordionItem>
              </Accordion>
            </Card>
          )}

          {/* Pre-funding Cap Table Editor */}
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold text-sm text-foreground">👥 Pre-funding Cap Table</div>
              <div className={cn(
                "text-xs font-bold px-2 py-0.5 rounded-full",
                founderSumOk ? "bg-emerald-500/15 text-emerald-700" : "bg-red-500/15 text-red-600",
              )}>
                {founderSum.toFixed(1)}% {founderSumOk ? "✓" : "≠ 100%"}
              </div>
            </div>
            <table className="w-full text-xs mb-3">
              <thead>
                <tr className="text-xs uppercase text-muted-foreground border-b">
                  <th className="text-left py-1.5 pr-2">Name</th>
                  <th className="text-left py-1.5 pr-2">Role</th>
                  <th className="text-right py-1.5 pr-2 w-20">Equity %</th>
                  {!readOnly && <th className="w-6" />}
                </tr>
              </thead>
              <tbody>
                {founders.map((h, idx) => (
                  <tr key={idx} className="border-b last:border-0">
                    <td className="py-1 pr-2">
                      {h.type === "esop" || h.type === "advisory" ? (
                        <span className="font-semibold text-muted-foreground">{h.name}</span>
                      ) : (
                        <Input
                          value={h.name}
                          disabled={readOnly}
                          className="h-7 text-xs px-2"
                          onChange={(e) => updateFounderField(idx, { name: e.target.value })}
                        />
                      )}
                    </td>
                    <td className="py-1 pr-2">
                      {h.type === "esop" || h.type === "advisory" ? (
                        <span className="text-muted-foreground">{h.role}</span>
                      ) : (
                        <Input
                          value={h.role}
                          disabled={readOnly}
                          className="h-7 text-xs px-2"
                          onChange={(e) => updateFounderField(idx, { role: e.target.value })}
                        />
                      )}
                    </td>
                    <td className="py-1 pr-2 w-20">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step={0.1}
                        value={h.pct}
                        disabled={readOnly}
                        className="h-7 text-xs px-2 text-right"
                        onChange={(e) => updateFounderField(idx, { pct: parseFloat(e.target.value) || 0 })}
                      />
                    </td>
                    {!readOnly && (
                      <td className="py-1 text-center">
                        {h.type === "founder" && (
                          <button
                            onClick={() => removeFounder(idx)}
                            className="w-5 h-5 rounded-full text-muted-foreground hover:text-red-500 hover:bg-red-50 flex items-center justify-center text-sm font-bold transition-colors"
                            title="Remove founder"
                          >
                            ×
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {!readOnly && (
              <div className="flex items-center gap-2">
                <button
                  onClick={addFounder}
                  className="rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10 transition-colors"
                >
                  + Add Founder
                </button>
                {state.founders && (
                  <button
                    onClick={() => onChange({ ...state, founders: undefined })}
                    className="text-xs text-muted-foreground hover:text-foreground underline"
                  >
                    Reset to defaults
                  </button>
                )}
              </div>
            )}
            {!founderSumOk && (
              <p className="text-xs text-red-500 mt-2">
                Equity must sum to exactly 100%. Current total: {founderSum.toFixed(1)}%.
              </p>
            )}
          </Card>

          {/* SAFE / Convertible Note */}
          {expertMode && <Card className="p-4">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xl">📝</span>
              <div className="font-bold flex-1">SAFE / Convertible Note</div>
              <Switch
                checked={state.safe.enabled}
                disabled={readOnly}
                onCheckedChange={(v) => updateSafe("enabled", v)}
              />
            </div>

            {state.safe.enabled && (
              <div className="space-y-3">
                <div className="text-xs bg-muted rounded-md px-3 py-2 text-muted-foreground">
                  {isUS
                    ? "YC post-money SAFE: converts at your first priced round. Use MFN (no cap) to model YC's $375K SAFE — it converts at the same price as your Seed investors."
                    : "SAFEs convert to equity at your first priced round. In India, CCDs (Compulsorily Convertible Debentures) are the more common equivalent for RBI compliance."}
                </div>

                <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                  <div>
                    <div className="text-xs font-semibold">MFN / No cap (YC standard)</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Converts at the next round's pre-money price — same as other investors. No cap, no discount.</div>
                  </div>
                  <Switch
                    checked={state.safe.mfn ?? false}
                    disabled={readOnly}
                    onCheckedChange={(v) => updateSafe("mfn", v)}
                  />
                </div>

                {isUS && (
                  <button
                    disabled={readOnly}
                    onClick={() => {
                      if (readOnly) return;
                      onChange({
                        ...state,
                        safe: { ...state.safe, enabled: true, amount: 0.375, mfn: true, cap: 0, discount: 0 },
                      });
                    }}
                    className="w-full rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/10 transition-colors"
                  >
                    ⚡ Fill YC $375K MFN SAFE
                  </button>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="flex items-center gap-1.5 mb-1">
                      <Label className="text-xs uppercase text-muted-foreground">Amount ($M)</Label>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button className="w-4 h-4 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">?</button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[220px] text-xs">
                            <p className="font-bold text-primary mb-1">SAFE Amount</p>
                            <p>Total cash raised via SAFE. Doesn't dilute immediately — converts to shares at your first priced round.</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <Input
                      type="number"
                      value={state.safe.amount}
                      disabled={readOnly}
                      className={validationErrors["safe-amount"] ? "border-red-400" : ""}
                      onChange={(e) => { updateSafe("amount", parseFloat(e.target.value) || 0); }}
                    />
                    {validationErrors["safe-amount"] && <p className="text-xs text-red-500 mt-1">{validationErrors["safe-amount"]}</p>}
                  </div>

                  {!state.safe.mfn && <>
                    <div>
                      <div className="flex items-center gap-1.5 mb-1">
                        <Label className="text-xs uppercase text-muted-foreground">Valuation Cap ($M)</Label>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button className="w-4 h-4 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">?</button>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-[220px] text-xs">
                              <p className="font-bold text-primary mb-1">Valuation Cap</p>
                              <p>Maximum valuation at which the SAFE converts. Protects early investors if the company grows fast before Seed.</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <Input
                        type="number"
                        value={state.safe.cap}
                        disabled={readOnly}
                        className={validationErrors["safe-cap"] ? "border-red-400" : ""}
                        onChange={(e) => { updateSafe("cap", parseFloat(e.target.value) || 0); }}
                      />
                      {validationErrors["safe-cap"] && <p className="text-xs text-red-500 mt-1">{validationErrors["safe-cap"]}</p>}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5 mb-1">
                        <Label className="text-xs uppercase text-muted-foreground">Discount (%)</Label>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button className="w-4 h-4 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">?</button>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-[220px] text-xs">
                              <p className="font-bold text-primary mb-1">SAFE Discount</p>
                              <p>SAFE investors get shares at X% cheaper than Seed investors. The SAFE takes the better of cap price or discounted price.</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <Input
                        type="number"
                        value={state.safe.discount}
                        disabled={readOnly}
                        className={validationErrors["safe-discount"] ? "border-red-400" : ""}
                        onChange={(e) => { updateSafe("discount", parseFloat(e.target.value) || 0); }}
                      />
                      {validationErrors["safe-discount"] && <p className="text-xs text-red-500 mt-1">{validationErrors["safe-discount"]}</p>}
                    </div>
                  </>}
                </div>

                {state.safe.mfn && (
                  <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-700 dark:bg-blue-950/40 dark:border-blue-800 dark:text-blue-200">
                    MFN SAFE converts at the next priced round's pre-money valuation — no cap, no discount. This matches the YC $375K standard SAFE.
                  </div>
                )}
              </div>
            )}
          </Card>}

          {/* Vesting Schedule Config */}
          {expertMode && (
            <Card className="p-4">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-xl">⏱️</span>
                <div className="font-bold flex-1">Founder Vesting Schedules</div>
                <Switch
                  checked={state.vestingEnabled ?? false}
                  disabled={readOnly}
                  onCheckedChange={(v) => onChange({ ...state, vestingEnabled: v })}
                />
              </div>

              {(state.vestingEnabled) && (
                <div className="space-y-4">
                  <div className="text-xs bg-muted rounded-md px-3 py-2 text-muted-foreground">
                    Standard 4-year cliff-then-linear vesting. Elapsed months tracks how much has already vested.
                    Single-trigger acceleration fully vests founders at acquisition.
                  </div>

                  <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                    <div>
                      <div className="text-xs font-semibold">Single-trigger acceleration at exit</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        All unvested equity vests immediately on acquisition. Market standard — always negotiate for it.
                      </div>
                    </div>
                    <Switch
                      checked={state.accelerationAtExit ?? true}
                      disabled={readOnly}
                      onCheckedChange={(v) => onChange({ ...state, accelerationAtExit: v })}
                    />
                  </div>

                  {founderOnlyHolders.map((f) => {
                    const v = state.vesting?.[f.name] ?? DEFAULT_VESTING;
                    const vFrac = v.elapsedMonths < v.cliffMonths ? 0 : Math.min(1, v.elapsedMonths / v.vestMonths);
                    return (
                      <div key={f.name} className="rounded-lg border border-border p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-xs font-bold">{f.name}</div>
                            <div className="text-xs text-muted-foreground">{f.role}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-bold" style={{ color: HOLDER_COLORS[f.name] }}>
                              {(vFrac * 100).toFixed(0)}% vested
                            </div>
                            {v.elapsedMonths < v.cliffMonths && (
                              <div className="text-xs text-muted-foreground">Cliff not reached</div>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <Label className="text-xs uppercase text-muted-foreground">Cliff (mo.)</Label>
                            <Input
                              type="number"
                              min={0}
                              max={24}
                              value={v.cliffMonths}
                              disabled={readOnly}
                              onChange={(e) => updateVesting(f.name, { cliffMonths: parseInt(e.target.value) || 0 })}
                            />
                          </div>
                          <div>
                            <Label className="text-xs uppercase text-muted-foreground">Total (mo.)</Label>
                            <Input
                              type="number"
                              min={12}
                              max={72}
                              value={v.vestMonths}
                              disabled={readOnly}
                              onChange={(e) => updateVesting(f.name, { vestMonths: parseInt(e.target.value) || 48 })}
                            />
                          </div>
                          <div>
                            <Label className="text-xs uppercase text-muted-foreground">Elapsed (mo.)</Label>
                            <Input
                              type="number"
                              min={0}
                              max={v.vestMonths}
                              value={v.elapsedMonths}
                              disabled={readOnly}
                              onChange={(e) => updateVesting(f.name, { elapsedMonths: parseInt(e.target.value) || 0 })}
                            />
                          </div>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: (vFrac * 100) + "%" }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          )}

          {/* CTA nudge to configure rounds */}
          <div className="rounded-xl border border-dashed border-border px-4 py-3 text-xs text-muted-foreground text-center">
            Setup complete? Head to <button className="font-semibold text-primary underline-offset-2 underline" onClick={() => setActiveTab("rounds")}>⚙️ Rounds</button> to model your funding path.
          </div>

        </TabsContent>

        {/* ── ROUNDS ── */}
        <TabsContent value="rounds" className="space-y-3 mt-4">

          {/* Market badge — read-only indicator, click goes to Setup */}
          <button
            onClick={() => setActiveTab("setup")}
            className="flex items-center gap-2 rounded-lg border border-border bg-muted/60 px-3 py-1.5 text-xs font-semibold hover:bg-muted transition-colors w-full"
          >
            <span>{isUS ? "🇺🇸" : "🇮🇳"}</span>
            <span>{isUS ? "United States" : "India"} mode</span>
            <span className="ml-auto text-muted-foreground">← change in Setup</span>
          </button>

          {/* One-click journey presets */}
          {!readOnly && (
            <Card className="p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                Start from a typical journey
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                One click loads realistic {isUS ? "US" : "India"} numbers for every round — then tweak anything below.
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                {JOURNEY_PRESETS[isUS ? "us" : "india"].map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applyJourney(p)}
                    className="rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-accent"
                  >
                    <div className="text-sm font-semibold">{p.label}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{p.desc}</div>
                  </button>
                ))}
              </div>
            </Card>
          )}

          {/* SECTION A — Insight Engine */}
          <Card className="p-4 bg-[#1a1a2e] text-white">
            <div className="text-xs font-semibold uppercase tracking-wide text-white/70 mb-2">
              Founder Outcome Summary
            </div>
            <div className="text-sm font-semibold leading-snug">
              {!anyRoundsEnabled ? (
                "Enable funding rounds below to see your outcome summary."
              ) : (
                <>
                  At current plan, founders end with {founderPct.toFixed(1)}% equity across {roundsEnabledCount}{" "}
                  round{roundsEnabledCount === 1 ? "" : "s"}, and take home ~{fmtM(perFounderAmt)} each at a{" "}
                  {fmtM(state.exitValue)} exit.
                </>
              )}
            </div>

            {!!riskSignals.length && (
              <div className="mt-3 space-y-2">
                {riskSignals.map((s, i) => {
                  const dotColor =
                    s.tone === "red"    ? "#ef4444"
                    : s.tone === "orange" ? "#f97316"
                    : s.tone === "yellow" ? "#facc15"
                    : s.tone === "amber"  ? "#f59e0b"
                    : s.tone === "blue"   ? "#60a5fa"
                    : "#34d399";
                  return (
                    <div key={i} className="flex items-start gap-2 text-xs text-white/90">
                      <span style={{ display: "block", width: "8px", height: "8px", minWidth: "8px", maxWidth: "8px", minHeight: "8px", maxHeight: "8px", borderRadius: "50%", backgroundColor: dotColor, flexShrink: 0, marginTop: "4px" }} />
                      <span>{s.text}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {ROUND_KEYS.map((k) => {
            const r = state.rounds[k];
            if (!r) return null;
            const dil = r.preMoney && r.raise ? (r.raise / (r.preMoney + r.raise)) * 100 : 0;
            const bench = (isUS ? US_ROUND_BENCHMARKS : ROUND_BENCHMARKS)[k];
            const benchNote = ROUND_BENCHMARK_NOTES[isUS ? "us" : "india"][k];
            const dilCls = dil === 0 ? "text-muted-foreground" : dil <= bench.hi ? "text-success" : dil <= bench.hi + 5 ? "text-warning" : "text-danger";
            const isPreSeed = k === "preseed";
            return (
              <Card key={k} className="p-4">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-xl">{ROUND_ICONS[k]}</span>
                  <div className="font-bold flex-1">{ROUND_LABELS[k]}</div>
                  {isPreSeed && isUS && !r.enabled && (
                    <button
                      disabled={readOnly}
                      onClick={() => {
                        if (readOnly) return;
                        // YC standard: $125K for 7% → pre-money $1.661M
                        updateRound(k, { enabled: true, preMoney: 1.661, raise: 0.125, esop: 0, board: "observer" });
                        // Also suggest enabling the MFN SAFE
                        if (!state.safe.enabled) {
                          onChange({
                            ...state,
                            rounds: { ...state.rounds, [k]: { ...state.rounds[k], enabled: true, preMoney: 1.661, raise: 0.125, esop: 0, board: "observer" } },
                            safe: { ...state.safe, enabled: true, amount: 0.375, mfn: true, cap: 0, discount: 0 },
                          });
                        }
                      }}
                      className="rounded-lg border border-dashed border-primary/40 bg-primary/5 px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/10 transition-colors"
                    >
                      ⚡ YC Standard
                    </button>
                  )}
                  <Switch checked={r.enabled} disabled={readOnly} onCheckedChange={(v) => updateRound(k, { enabled: v })} />
                </div>
                {isPreSeed && r.enabled && (
                  <div className="mb-3 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-200">
                    {isUS
                      ? "YC deal: $125K for 7% direct equity + $375K MFN SAFE (enable SAFE panel above). Pre-money auto-set to $1.661M so raise ÷ post = 7%."
                      : "Pre-seed equity round — typically angels, accelerators, or friends & family. No ESOP top-up required at this stage."}
                    {dil > 0 && <span className="ml-2 font-bold">Computed equity given: {dil.toFixed(1)}%</span>}
                  </div>
                )}
                {r.enabled && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="flex items-center gap-1.5 mb-1">
                          <Label className="text-xs uppercase text-muted-foreground">Pre-money ($M)</Label>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button className="w-4 h-4 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">?</button>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-[220px] text-xs">
                                <p className="font-bold text-primary mb-1">Pre-money</p>
                                <p>What investors agree the company is worth before they invest. e.g. $2.5M pre + $0.5M raise → $3M post-money.</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                        <Input type="number" value={r.preMoney} disabled={readOnly}
                          className={validationErrors[`${k}-pre`] ? "border-red-400" : ""}
                          onChange={(e) => updateRound(k, { preMoney: parseFloat(e.target.value) || 0 })} />
                        {validationErrors[`${k}-pre`] && <p className="text-xs text-red-500 mt-1">{validationErrors[`${k}-pre`]}</p>}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5 mb-1">
                          <Label className="text-xs uppercase text-muted-foreground">Raise ($M)</Label>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button className="w-4 h-4 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">?</button>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-[220px] text-xs">
                                <p className="font-bold text-primary mb-1">Raise</p>
                                <p>Total investment this round. VC % = Raise ÷ (Pre + Raise). Everyone existing dilutes proportionally.</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                        <Input type="number" value={r.raise} disabled={readOnly}
                          className={validationErrors[`${k}-raise`] ? "border-red-400" : ""}
                          onChange={(e) => updateRound(k, { raise: parseFloat(e.target.value) || 0 })} />
                        {validationErrors[`${k}-raise`] && <p className="text-xs text-red-500 mt-1">{validationErrors[`${k}-raise`]}</p>}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5 mb-1">
                          <Label className="text-xs uppercase text-muted-foreground">ESOP post (%)</Label>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button className="w-4 h-4 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">?</button>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-[220px] text-xs">
                                <p className="font-bold text-primary mb-1">ESOP post (%)</p>
                                <p className="mb-1">Target option pool <span className="font-semibold">after</span> this round closes, as a % of fully-diluted shares.</p>
                                <p className="mb-1"><span className="font-semibold text-amber-600">VCs always quote post-money.</span> The top-up is created <span className="font-semibold">before</span> their investment — so it dilutes you, not them. A 15% post-money pool on a $10M raise at $20M pre = founders absorb the entire top-up cost.</p>
                                <p>Counter: negotiate the pool size based on a 12–18 month hiring plan. Don't accept a "standard 15%" without modelling the actual headcount needed.</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                        <Input type="number" value={r.esop} disabled={readOnly}
                          className={validationErrors[`${k}-esop`] ? "border-red-400" : ""}
                          onChange={(e) => updateRound(k, { esop: parseFloat(e.target.value) || 0 })} />
                        {validationErrors[`${k}-esop`] && <p className="text-xs text-red-500 mt-1">{validationErrors[`${k}-esop`]}</p>}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5 mb-1">
                          <Label className="text-xs uppercase text-muted-foreground">VC Board Seat</Label>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button className="w-4 h-4 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">?</button>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-[220px] text-xs">
                                <p className="font-bold text-primary mb-1">VC Board Seat</p>
                                <p>Observer attends but cannot vote. Full seat = binding vote on CEO removal, M&A, pivots. Prefer observer-only at Seed.</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                        <Select value={r.board} disabled={readOnly} onValueChange={(v) => updateRound(k, { board: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="observer">Observer only</SelectItem>
                            <SelectItem value="1">1 Full seat</SelectItem>
                            <SelectItem value="2">2 Full seats</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {expertMode && <div>
                        <div className="flex items-center gap-1.5 mb-1">
                          <Label className="text-xs uppercase text-muted-foreground">Liq Pref Multiple</Label>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button className="w-4 h-4 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">?</button>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-[220px] text-xs">
                                <p className="font-bold text-primary mb-1">Liquidation Preference Multiple</p>
                                <p>In an exit, VCs get paid this many times their investment before founders see anything. 1× is standard. Push back on 2×.</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                        <Select value={String(r.prefMult)} disabled={readOnly} onValueChange={(v) => updateRound(k, { prefMult: parseFloat(v) })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1">1× (Standard)</SelectItem>
                            <SelectItem value="1.5">1.5×</SelectItem>
                            <SelectItem value="2">2× (Aggressive)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>}
                      {expertMode && <div>
                        <div className="flex items-center gap-1.5 mb-1">
                          <Label className="text-xs uppercase text-muted-foreground">Pref Type</Label>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button className="w-4 h-4 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">?</button>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-[220px] text-xs">
                                <p className="font-bold text-primary mb-1">Preference Type</p>
                                <p>Non-participating: VC chooses preference OR pro-rata — whichever is higher. Participating: VC gets preference first, then also takes pro-rata. Always push back on participating.</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                        <Select value={r.prefType} disabled={readOnly} onValueChange={(v) => updateRound(k, { prefType: v as "non" | "part" })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="non">Non-participating</SelectItem>
                            <SelectItem value="part">Participating</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>}
                      {expertMode && !isPreSeed && <div>
                        <div className="flex items-center gap-1.5 mb-1">
                          <Label className="text-xs uppercase text-muted-foreground">Anti-dilution</Label>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button className="w-4 h-4 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">?</button>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-[280px] text-xs">
                                <p className="font-bold text-primary mb-1">Anti-dilution Protection</p>
                                <p className="mb-1">Protects this VC if a future round prices lower (down round).</p>
                                <p className="mb-1"><span className="font-bold">BBWA</span> — Broad-Based Weighted Average. Market standard. Softens the adjustment using a weighted average of old and new prices.</p>
                                <p><span className="font-bold text-red-600">Full-Ratchet</span> — Resets conversion price entirely to the new round price. In a 50% down round, the VC's stake doubles. <span className="font-semibold">Never accept this.</span></p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                        <Select
                          value={r.antiDilution ?? "none"}
                          disabled={readOnly}
                          onValueChange={(v) => updateRound(k, { antiDilution: v as "none" | "bbwa" | "full-ratchet" })}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            <SelectItem value="bbwa">BBWA (Standard)</SelectItem>
                            <SelectItem value="full-ratchet">Full-Ratchet ⚠️</SelectItem>
                          </SelectContent>
                        </Select>
                        {r.antiDilution === "full-ratchet" && (
                          <div className="mt-2 p-2 rounded-md bg-red-500/10 border border-red-500/30 text-xs text-red-700 leading-relaxed">
                            <span className="font-bold">⚠️ Full-ratchet is not market standard anywhere.</span> At a 50% down round, this VC's stake doubles at your expense. Push back to BBWA in every negotiation — cite NVCA Model Documents (US) or standard Blume/Elevation/Accel term sheets (India) as your anchor.
                          </div>
                        )}
                      </div>}
                      {expertMode && !isPreSeed && (
                        <div>
                          <Label className="text-xs font-semibold mb-2 block">Redemption Rights</Label>
                          <div className="flex items-center gap-2 mb-2">
                            <Switch
                              checked={r.redemptionEnabled ?? false}
                              disabled={readOnly}
                              onCheckedChange={(v) => updateRound(k, { redemptionEnabled: v })}
                            />
                            <span className="text-xs text-muted-foreground">Investor can force company to repurchase shares after trigger period</span>
                          </div>
                          {r.redemptionEnabled && (
                            <div className="space-y-2 pl-1">
                              <div className="flex items-center gap-3">
                                <div className="flex-1">
                                  <Label className="text-xs text-muted-foreground">Trigger (years)</Label>
                                  <Input
                                    type="number" min={1} max={10} step={1}
                                    value={r.redemptionYears ?? 5}
                                    disabled={readOnly}
                                    onChange={(e) => updateRound(k, { redemptionYears: parseInt(e.target.value) || 5 })}
                                    className="h-7 text-xs mt-0.5"
                                  />
                                </div>
                                <div className="flex-1">
                                  <Label className="text-xs text-muted-foreground">Multiple on cost</Label>
                                  <Select
                                    value={String(r.redemptionMultiple ?? 1)}
                                    disabled={readOnly}
                                    onValueChange={(v) => updateRound(k, { redemptionMultiple: parseFloat(v) })}
                                  >
                                    <SelectTrigger className="h-7 text-xs mt-0.5"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="1">1× (cost)</SelectItem>
                                      <SelectItem value="1.25">1.25× (cost + 25%)</SelectItem>
                                      <SelectItem value="1.5">1.5× (cost + 50%)</SelectItem>
                                      <SelectItem value="2">2× (double)</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>
                              <div className="p-2 rounded-md bg-orange-500/10 border border-orange-500/30 text-xs text-orange-800 dark:text-orange-300">
                                ⚠️ Cash liability: <span className="font-bold">{fmtM(r.raise * (r.redemptionMultiple ?? 1))}</span> due after{" "}
                                <span className="font-bold">{r.redemptionYears ?? 5} years</span> if triggered.{" "}
                                {isUS
                                  ? "Push back: cap at 1× cost, require majority preferred approval to trigger, and include a buyout-by-installments clause (NVCA Model Documents)."
                                  : "Push back: cap at 1× cost, require board + majority preferred approval, and include installment buyout. India Companies Act §68 restricts repurchases to distributable profits — use as negotiation leverage."}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="rounded-md bg-muted px-3 py-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Dilution this round</span>
                        <span className={cn("font-bold", dilCls)}>
                          {dil.toFixed(1)}%{" "}
                          <span className="text-muted-foreground font-normal">({isUS ? "US" : "India"} norm: {bench.lo}–{bench.hi}%)</span>
                        </span>
                      </div>
                      {dil > 0 && <div className="mt-1 text-xs text-muted-foreground">{benchNote}</div>}
                    </div>
                    {/* Down-round warning — shown when this round's pre < previous post */}
                    {(() => {
                      const snap = snaps[k];
                      if (!snap?.isDownRound) return null;
                      const frRounds = ROUND_KEYS.filter((pk) => {
                        const pc = state.rounds[pk];
                        return pc?.enabled && pc.antiDilution === "full-ratchet" && pk !== k;
                      });
                      const bbwaRounds = ROUND_KEYS.filter((pk) => {
                        const pc = state.rounds[pk];
                        return pc?.enabled && pc.antiDilution === "bbwa" && pk !== k;
                      });

                      // Compute BBWA-counterfactual founder equity for comparison when full-ratchet is active
                      const frImpacts = frRounds.map((pk) => {
                        const rd = snap.roundData.find((rd) => rd.roundKey === pk);
                        if (!rd) return null;
                        const adFR   = r.preMoney / rd.postMoney;
                        const adBBWA = (rd.postMoney + r.raise) / (rd.postMoney + r.raise * (rd.postMoney / r.preMoney));
                        if (adFR >= 1) return null;
                        const h = snap.holders.find((h) => h.name === rd.vcName);
                        if (!h) return null;
                        // Back-compute pre-adjustment pct, then forward-compute BBWA equivalent
                        const preAdjPct  = h.pct * adFR;
                        const bbwaPct    = preAdjPct / adBBWA;
                        const extraCost  = parseFloat((h.pct - bbwaPct).toFixed(1));
                        const multiplier = parseFloat((1 / adFR).toFixed(2));
                        return { vcName: rd.vcName, multiplier, extraCost };
                      }).filter(Boolean) as Array<{ vcName: string; multiplier: number; extraCost: number }>;

                      const hasFR = frRounds.length > 0;
                      return (
                        <div className={cn(
                          "rounded-md border px-3 py-2.5 text-xs space-y-1.5",
                          hasFR
                            ? "border-red-500/50 bg-red-500/8 text-red-700"
                            : "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300",
                        )}>
                          <div className="font-bold">
                            {hasFR ? "🚨" : "⚠️"} Down round — {snap.valDrop}% below previous post-money.
                          </div>
                          {frImpacts.map((fi) => (
                            <div key={fi.vcName}>
                              <span className="font-semibold text-red-800">{fi.vcName} (full-ratchet):</span>{" "}
                              stake boosted {fi.multiplier}× — founders absorb {fi.extraCost}pp more dilution vs. BBWA.
                            </div>
                          ))}
                          {bbwaRounds.length > 0 && (
                            <div>BBWA triggered for {bbwaRounds.map((pk) => ROUND_LABELS[pk]).join(", ")} — founders diluted, but far less than full-ratchet.</div>
                          )}
                          {frRounds.length === 0 && bbwaRounds.length === 0 && (
                            <div>No anti-dilution active — prior investors absorb the full valuation drop.</div>
                          )}
                          {hasFR && (
                            <div className="font-semibold mt-1">
                              Negotiate full-ratchet → BBWA before any term sheet. In a down round, this is the single most dilutive clause a founder can face.
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </Card>
            );
          })}

          {/* SECTION B — Founder Playbook */}
          <Card className="p-4">
            <div className="flex items-center justify-between mb-1">
              <div className="font-semibold text-sm text-foreground">Founder Playbook</div>
              <Badge className="bg-primary/10 text-primary border border-primary/30">{recommendations.length} actions</Badge>
            </div>
            <p className="text-xs text-muted-foreground mb-4">Personalised to your current scenario. Each action includes the exact next step to take.</p>
            {recommendations.length === 0 ? (
              <div className="text-sm text-muted-foreground">Enable funding rounds above to see your playbook.</div>
            ) : (
              (() => {
                const timingGroups: Array<{ key: "now" | "next-round" | "ongoing"; label: string; icon: string; borderColor: string; bgColor: string }> = [
                  { key: "now",        label: "Do Now",             icon: "🔴", borderColor: "border-red-300",    bgColor: "bg-red-50 dark:bg-red-950/30" },
                  { key: "next-round", label: "Before Next Round",  icon: "🟡", borderColor: "border-amber-300",  bgColor: "bg-amber-50 dark:bg-amber-950/30" },
                  { key: "ongoing",    label: "Ongoing",            icon: "🔵", borderColor: "border-blue-300",   bgColor: "bg-blue-50 dark:bg-blue-950/30" },
                ];
                const priorityBadge = (p: string) => {
                  if (p === "critical") return <span className="text-xs font-bold uppercase px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">Critical</span>;
                  if (p === "high")     return <span className="text-xs font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">High</span>;
                  return                       <span className="text-xs font-bold uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">Medium</span>;
                };
                return (
                  <div className="space-y-5">
                    {timingGroups.map(({ key, label, icon, borderColor, bgColor }) => {
                      const group = recommendations.filter((r) => r.timing === key);
                      if (group.length === 0) return null;
                      return (
                        <div key={key}>
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-sm">{icon}</span>
                            <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
                            <div className="flex-1 h-px bg-border" />
                          </div>
                          <div className="space-y-3">
                            {group.map((r, idx) => (
                              <div key={idx} className={cn("rounded-xl border p-3.5 space-y-2.5", borderColor, bgColor)}>
                                <div className="flex items-start justify-between gap-2">
                                  <div className="font-bold text-sm leading-snug flex-1">{r.action}</div>
                                  {priorityBadge(r.priority)}
                                </div>
                                <div className="text-xs text-foreground/80 leading-relaxed">{r.why}</div>
                                <div className={cn("rounded-lg p-2.5 border", key === "now" ? "bg-white/70 border-red-200 dark:bg-black/20 dark:border-red-800" : key === "next-round" ? "bg-white/70 border-amber-200 dark:bg-black/20 dark:border-amber-800" : "bg-white/70 border-blue-200 dark:bg-black/20 dark:border-blue-800")}>
                                  <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">→ Next Step</div>
                                  <div className="text-xs leading-relaxed">{r.nextStep}</div>
                                </div>
                                {r.leverage && (
                                  <div className="text-xs text-muted-foreground italic leading-relaxed">
                                    💡 <span className="font-semibold">Leverage: </span>{r.leverage}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()
            )}
          </Card>
        </TabsContent>

        {/* ── CAP TABLE ── */}
        <TabsContent value="outcomes" className="space-y-3 mt-4">
          <Card className="p-4">
            <div className="flex gap-2 flex-wrap mb-3">
              {snapKeys.map((k) => (
                <button
                  key={k}
                  onClick={() => setCapRound(k)}
                  className={cn(
                    "px-3 py-1 rounded-full text-xs font-semibold border",
                    capRound === k ? "bg-foreground text-background border-foreground" : "bg-card text-muted-foreground border-border",
                  )}
                >
                  {snaps[k].label}
                </button>
              ))}
            </div>
            <div className="mt-1 space-y-2">
              {[...activeCap.holders].sort((a, b) => b.pct - a.pct).map((h, i) => (
                <div key={i} className="flex items-center gap-3">
                  {/* Name + role */}
                  <div className="w-28 shrink-0">
                    <div className="text-xs font-semibold text-foreground truncate">{h.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{h.role}</div>
                  </div>
                  {/* Bar */}
                  <div className="flex-1 relative h-5 bg-muted/40 rounded-full overflow-hidden">
                    <div
                      className="absolute left-0 top-0 h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.max(h.pct, 0.5)}%`, background: HOLDER_COLORS[h.name] || "#888" }}
                    />
                  </div>
                  {/* Percentage */}
                  <div className="w-14 text-right text-xs font-bold shrink-0" style={{ color: HOLDER_COLORS[h.name] || "#888" }}>
                    {h.pct.toFixed(1)}%
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <div className="font-semibold text-sm mb-3 text-foreground">Dilution over time</div>
            <div className="h-64">
              <ResponsiveContainer>
                <LineChart data={lineData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="round" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} domain={[0, lineMax]} tickFormatter={(v) => v + "%"} />
                  <RechartsTooltip formatter={(v: number) => v.toFixed(2) + "%"} />
                  <Legend wrapperStyle={{ fontSize: "10px" }} />
                  {founderOnlyHolders.map((f, i) => (
                    <Line key={f.name} type="monotone" dataKey={f.name} stroke={HOLDER_COLORS[f.name] || EXTRA_FOUNDER_COLORS[i % EXTRA_FOUNDER_COLORS.length]} strokeWidth={2} dot={{ r: 3 }} />
                  ))}
                  <Line type="monotone" dataKey="Total VC" stroke="#e74c3c" strokeWidth={2} strokeDasharray="5 3" dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* ── Full-ratchet impact card ── */}
          {hasFullRatchet && fullRatchetComparison && (() => {
            const { founderPctFR, founderPctBBWA, founderPctNone, payFR, payBBWA, payNone } = fullRatchetComparison;
            const costVsBBWA = parseFloat((founderPctBBWA - founderPctFR).toFixed(1));
            const costVsNone = parseFloat((founderPctNone - founderPctFR).toFixed(1));
            return (
              <Card className="p-4 border-red-500/50">
                <div className="flex items-center gap-2 mb-1">
                  <div className="font-bold text-sm text-red-700">Full-Ratchet Anti-Dilution Impact</div>
                  <Badge className="bg-red-500/15 text-red-700 border border-red-500/30 text-xs">Active</Badge>
                </div>
                <p className="text-xs text-muted-foreground mb-4">
                  Full-ratchet resets the VC's conversion price to the down-round price. This table shows what your founders' equity would be under each scenario.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-xs uppercase text-muted-foreground">
                        <th className="text-left py-1.5 pr-3">Scenario</th>
                        <th className="text-right py-1.5 px-2">Founder Equity</th>
                        <th className="text-right py-1.5 px-2">vs. Full-Ratchet</th>
                        <th className="text-right py-1.5 pl-2">Payout @{fmtM(state.exitValue)}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b bg-red-500/5">
                        <td className="py-2 pr-3 font-bold text-red-700">Full-Ratchet (current)</td>
                        <td className="py-2 px-2 text-right font-bold text-red-700">{founderPctFR.toFixed(1)}%</td>
                        <td className="py-2 px-2 text-right text-muted-foreground">—</td>
                        <td className="py-2 pl-2 text-right font-bold text-red-700">{fmtM(payFR)}</td>
                      </tr>
                      <tr className="border-b">
                        <td className="py-2 pr-3 font-semibold">BBWA (market standard)</td>
                        <td className="py-2 px-2 text-right font-semibold text-emerald-600">{founderPctBBWA.toFixed(1)}%</td>
                        <td className="py-2 px-2 text-right text-emerald-600 font-semibold">+{costVsBBWA}pp</td>
                        <td className="py-2 pl-2 text-right font-semibold text-emerald-600">{fmtM(payBBWA)}</td>
                      </tr>
                      <tr>
                        <td className="py-2 pr-3 font-semibold text-muted-foreground">No protection</td>
                        <td className="py-2 px-2 text-right font-semibold">{founderPctNone.toFixed(1)}%</td>
                        <td className="py-2 px-2 text-right text-emerald-700 font-semibold">+{costVsNone}pp</td>
                        <td className="py-2 pl-2 text-right font-semibold">{fmtM(payNone)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 text-xs text-red-700 bg-red-500/5 rounded px-2.5 py-2 leading-relaxed">
                  <span className="font-bold">You are losing {costVsBBWA}pp of equity vs. BBWA.</span>{" "}
                  Use the down round as your renegotiation window — insist on converting full-ratchet → BBWA as a condition of closing.
                  VCs participating in the new round want it to close: that's your leverage.
                </div>
              </Card>
            );
          })()}

          {/* ── Board Seat Runway ── */}
          {(() => {
            const twoSeatThreshold = isUS ? 20 : 25;
            const oneSeatThreshold = state.boardRetentionPct ?? (isUS ? 10 : 15);
            return (
              <Card className="p-4">
                <div className="flex items-center justify-between mb-1">
                  <div className="font-semibold text-sm">Board Seat Runway</div>
                  <div className="text-xs text-muted-foreground">≥{twoSeatThreshold}% = 2 seats · ≥{oneSeatThreshold}% = 1 seat · below = 0</div>
                </div>
                <p className="text-xs text-muted-foreground mb-4">How many founder director seats you can defend at each stage, based on collective equity vs. your SHA thresholds.</p>
                <div className="flex items-end gap-3 overflow-x-auto pb-1 scrollbar-none">
                  {snapKeys.map((k) => {
                    const snap = snaps[k];
                    const fEq = snap.holders.filter((h) => h.type === "founder").reduce((s, h) => s + h.pct, 0);
                    const regime = fEq >= twoSeatThreshold ? "2" : fEq >= oneSeatThreshold ? "1" : "0";
                    return (
                      <div key={k} className="flex flex-col items-center gap-1.5">
                        <div className={cn(
                          "w-12 h-12 rounded-full flex flex-col items-center justify-center border-2 text-base font-bold",
                          regime === "2" ? "bg-emerald-500/10 border-emerald-500/50 text-emerald-700"
                            : regime === "1" ? "bg-amber-500/10 border-amber-500/50 text-amber-700"
                            : "bg-red-500/10 border-red-500/50 text-red-700",
                        )}>
                          {regime}
                        </div>
                        <div className="text-xs text-muted-foreground text-center leading-tight whitespace-nowrap">{snap.label === "Pre-Funding" ? "Day 0" : snap.label}</div>
                        <div className={cn(
                          "text-xs font-semibold",
                          regime === "2" ? "text-emerald-600" : regime === "1" ? "text-amber-600" : "text-red-600",
                        )}>{fEq.toFixed(0)}%</div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
                  <span><span className="font-bold text-emerald-600">● 2</span> Both founder directors safe</span>
                  <span><span className="font-bold text-amber-600">● 1</span> One seat at risk — form a bloc</span>
                  <span><span className="font-bold text-red-600">● 0</span> SHA forces resignation</span>
                </div>
              </Card>
            );
          })()}

          {/* ── Individual Founder Nomination Eligibility ── */}
          {founderOnlyHolders.length > 0 && (
            <Card className="p-4">
              <div className="font-semibold text-sm mb-1">Individual Nomination Eligibility</div>
              <p className="text-xs text-muted-foreground mb-3">
                Each founder can self-nominate as a director only while they personally hold ≥5%. Below that, VCs can challenge the nomination in a shareholder vote — and win.
                A <span className="font-semibold">Founder Voting Agreement</span> (all founders pledge to vote each other in) fixes this regardless of individual stake size.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-xs uppercase text-muted-foreground">
                      <th className="text-left py-1.5 pr-3">Founder</th>
                      {snapKeys.map((k) => (
                        <th key={k} className="text-right py-1.5 px-2 whitespace-nowrap">{snaps[k].label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {founderOnlyHolders.map((founder) => (
                      <tr key={founder.name} className="border-b last:border-0">
                        <td className="py-2 pr-3 font-semibold whitespace-nowrap">{founder.name}</td>
                        {snapKeys.map((k) => {
                          const h = snaps[k].holders.find((x) => x.name === founder.name);
                          const pct = h ? h.pct : 0;
                          const ineligible = pct < 5;
                          return (
                            <td key={k} className={cn("py-2 px-2 text-right font-medium", ineligible ? "text-red-600" : "text-emerald-600")}>
                              {pct.toFixed(1)}%{ineligible && <span className="ml-0.5 text-xs">⚠</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 text-xs text-muted-foreground bg-amber-500/5 border border-amber-500/25 rounded px-2.5 py-2 leading-relaxed">
                <span className="font-semibold text-amber-700">⚠ Red = below 5% individual floor.</span> Fix before first round: all founders sign a Voting Agreement pledging to vote their shares to elect each other as directors — this keeps 2 seats safe even after heavy individual dilution.
              </div>
            </Card>
          )}

          {/* ── Board section ── */}
          <div className="flex items-center gap-2 pt-1">
            <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">🏛️ Board Composition</span>
            <div className="flex-1 h-px bg-border" />
          </div>
          {snapKeys.map((k) => {
            const snap = snaps[k];
            const total = founderSeats + 1 + snap.vcSeats;
            const fp = Math.round((founderSeats / total) * 100);
            const vp = Math.round((snap.vcSeats / total) * 100);
            const ip = 100 - fp - vp;
            const tied = snap.vcSeats === founderSeats && snap.vcSeats > 0;
            const danger = snap.vcSeats > founderSeats;
            // Board retention threshold check
            const snapFounderEquityPct = snap.holders.filter((h) => h.type === "founder").reduce((s, h) => s + h.pct, 0);
            const retentionThreshold = state.boardRetentionPct ?? (isUS ? 10 : 15);
            const belowRetention = k !== "pre" && snapFounderEquityPct < retentionThreshold;
            return (
              <Card key={k} className={cn("p-4", belowRetention && "border-red-500/50")}>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-bold uppercase text-muted-foreground">{snap.label}</div>
                  {belowRetention && (
                    <div className="text-xs font-bold text-red-600 bg-red-500/10 border border-red-500/30 rounded-full px-2 py-0.5">
                      ⚠️ Below retention threshold
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 mb-3">
                  {Array.from({ length: founderSeats }).map((_, i) => (
                    <div key={"f" + i} className={cn(
                      "px-3 py-1.5 rounded-md text-xs font-semibold border",
                      belowRetention
                        ? "bg-red-500/10 text-red-600 border-red-500/30 line-through opacity-60"
                        : "bg-primary/10 text-primary border-primary/30"
                    )}>Founder {i + 1}</div>
                  ))}
                  <div className="px-3 py-1.5 rounded-md text-xs font-semibold bg-success/10 text-success border border-success/30">Independent{tied ? " 🔑" : ""}</div>
                  {Array.from({ length: snap.vcSeats }).map((_, i) => {
                    const vcN = snap.vcNames[i] || "VC";
                    const rk = ROUND_KEYS.find((k) => ROUND_LABELS[k] + " VC" === vcN);
                    const p2p = rk && state.rounds[rk]?.payToPlay;
                    return (
                      <div key={"v" + i} className={cn("px-3 py-1.5 rounded-md text-xs font-semibold bg-danger/10 text-danger border border-danger/30", p2p && "border-emerald-500/50")}>
                        {vcN}{p2p ? " 🤝" : ""}
                      </div>
                    );
                  })}
                  {Array.from({ length: snap.vcObs }).map((_, i) => (
                    <div key={"o" + i} className="px-3 py-1.5 rounded-md text-xs font-semibold bg-warning/10 text-warning-foreground border border-warning/40 border-dashed">Observer</div>
                  ))}
                </div>
                <div className="flex h-2 rounded-full overflow-hidden mb-2">
                  <div className="bg-primary" style={{ width: fp + "%" }} />
                  <div className="bg-danger" style={{ width: vp + "%" }} />
                  <div className="bg-success" style={{ width: ip + "%" }} />
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span>● Founders {fp}%</span><span>● VCs {vp}%</span><span>● Independent {ip}%</span>
                  <span className="ml-auto">Founder equity: {snapFounderEquityPct.toFixed(1)}%</span>
                </div>
                <div className={cn(
                  "mt-2 inline-block text-xs font-bold px-3 py-1 rounded-full",
                  danger ? "bg-danger/10 text-danger" : tied ? "bg-warning/15 text-warning-foreground" : "bg-success/10 text-success",
                )}>
                  {danger ? `VC-controlled: ${vp}% vs founders ${fp}%` : tied ? `Tied — independent decides` : `Founder-controlled: ${fp}% vs ${vp}%`}
                </div>
                {/* Voting bloc strength */}
                <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1.5">
                  <span>🗳️ Founder voting bloc:</span>
                  <span className={cn(
                    "font-semibold",
                    snapFounderEquityPct > 50 ? "text-emerald-600" : snapFounderEquityPct > 33.33 ? "text-amber-600" : "text-red-600",
                  )}>{snapFounderEquityPct.toFixed(1)}%</span>
                  <span>—</span>
                  <span className={cn(
                    snapFounderEquityPct > 50 ? "text-emerald-700" : snapFounderEquityPct > 33.33 ? "text-amber-700" : "text-red-700",
                  )}>
                    {snapFounderEquityPct > 50
                      ? "majority: can elect any director in a shareholder vote"
                      : snapFounderEquityPct > 33.33
                      ? "minority: can block special resolutions but can't control elections alone"
                      : "⚠️ below 33% — limited blocking power, VCs can pass most resolutions without you"}
                  </span>
                </div>
                {belowRetention && (
                  <div className="mt-3 p-2.5 rounded-md bg-red-500/8 border border-red-500/25 text-xs text-red-700 leading-relaxed">
                    <span className="font-bold">SHA Board Retention Clause triggered.</span> Founders hold {snapFounderEquityPct.toFixed(1)}% equity — below the {retentionThreshold}% threshold set in your SHA. Under standard {isUS ? "IRA / SHA" : "SHA"} language, founders are required to resign all {founderSeats} director seat{founderSeats > 1 ? "s" : ""}. The independent director and VC directors would then fully control the board.{" "}
                    <span className="font-semibold">Negotiate this clause out before signing — or push the threshold down to {isUS ? "5%" : "10%"}.</span>
                  </div>
                )}
              </Card>
            );
          })}
        </TabsContent>

        {/* ── VETO ── */}
        <TabsContent value="negotiate" className="space-y-3 mt-4">

          {/* ── Your battles — leverage-aware, ranked (mirrors /decode) ── */}
          <Card className="p-4">
            <div className="font-semibold text-sm text-foreground mb-2">Your negotiation — ranked battles</div>
            {!anyRoundsEnabled ? (
              <p className="text-xs text-muted-foreground">Enable rounds in ⚙️ Rounds to get a ranked negotiation plan.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <span className="text-xs text-muted-foreground">Your position:</span>
                  {([
                    ["competing", "I have competing offers"],
                    ["normal", "This is my main option"],
                    ["tight", "Under 4 months of runway"],
                  ] as const).map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setNegLeverage(v)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        negLeverage === v ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:border-primary/50",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                  <span className="text-[11px] text-muted-foreground">
                    → ask budget: <b>{negBattleData.budget}</b>
                    {negBattleData.totalAsks > 0
                      ? ` · using ${negBattleData.asks.length} of ${negBattleData.totalAsks} possible asks`
                      : negBattleData.blockers.length > 0 ? "" : " · nothing worth asking — these terms are clean"}
                  </span>
                </div>

                <div className="space-y-2">
                  {negBattleData.blockers.map((b) => (
                    <div key={b.title} className="rounded-lg border border-l-4 border-l-danger border-border p-3">
                      <div className="flex flex-wrap items-start gap-2">
                        <div className="text-sm font-semibold">{b.title}</div>
                        <span className="ml-auto rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-danger">Deal-breaker</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{b.detail}</p>
                      <p className="mt-1 text-[11px] font-semibold text-success">{b.concede}</p>
                    </div>
                  ))}
                  {negBattleData.asks.map((b) => (
                    <div key={b.title} className="rounded-lg border border-l-4 border-l-warning border-border p-3">
                      <div className="flex flex-wrap items-start gap-2">
                        <div className="text-sm font-semibold">{b.title}</div>
                        {b.cost !== undefined && b.cost > 0.005 && (
                          <span className="ml-auto text-sm font-bold text-warning">worth {fmtM(b.cost)} to founders</span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{b.detail}</p>
                      <p className={cn("mt-1 text-[11px] font-semibold", b.concedeTone === "good" ? "text-success" : b.concedeTone === "mid" ? "text-warning" : "text-danger")}>{b.concede}</p>
                    </div>
                  ))}
                  {negBattleData.blockers.length === 0 && negBattleData.asks.length === 0 && (
                    <div className="rounded-lg border border-l-4 border-l-success border-border p-3">
                      <div className="text-sm font-semibold">These terms are market standard</div>
                      <p className="mt-1 text-xs text-muted-foreground">Don't manufacture a negotiation — confirm details with your lawyer and move forward.</p>
                    </div>
                  )}
                </div>

                {(negBattleData.accepts.length > 0 || negBattleData.parked.length > 0) && (
                  <div className="mt-3 rounded-lg border border-l-4 border-l-success border-border p-3">
                    <div className="text-xs font-semibold">Accept as drafted — don't spend chips here</div>
                    <ul className="mt-1.5 space-y-1">
                      {negBattleData.accepts.map((t) => (
                        <li key={t} className="text-xs text-muted-foreground">{t}</li>
                      ))}
                    </ul>
                    {negBattleData.parked.length > 0 && (
                      <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">Parked for now:</span>{" "}
                        {negBattleData.parked.map((b) => b.title).join("; ")} — real issues, but not worth your ask budget in this position.
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </Card>

          {/* ── Full veto-rights library (collapsed by default) ── */}
          <button
            type="button"
            onClick={() => setShowVetoLibrary((s) => !s)}
            className="w-full rounded-lg border border-border bg-muted/40 px-4 py-2.5 text-left text-xs font-semibold hover:bg-muted transition-colors"
          >
            {showVetoLibrary ? "▾ Hide" : "▸ Show"} the full veto-rights library — all 24 clauses with exact negotiation language
          </button>

          {showVetoLibrary && (
          <Card className="p-4">
            <div className="font-semibold text-sm text-foreground">VC Veto Rights — Active Triggers</div>
            <div className="text-xs text-muted-foreground mt-1">
              Tap any item to see what VCs demand, what to push back to, and the exact clause to negotiate.
            </div>

            {(() => {
              type VetoItem = { key: string; title: string; active: boolean; market: "both" | "india" | "us"; demand: string; push: string; clause: string; group: "board" | "economics" | "founder" | "governance" };
              const vetoItems: VetoItem[] = ([
                // ── Universal ──────────────────────────────────────────────
                {
                  key: "equity", group: "economics",
                  title: "New equity issuance approval",
                  active: state.rounds.seed.enabled,
                  market: "both",
                  demand: "Approval required for any new share issuance — including to advisors, employees, or in bridge rounds.",
                  push: "Carve out: (1) ESOP grants within board-approved plan, (2) advisor grants below the pre-agreed threshold, (3) exercises of existing options. Only new round-level issuances should require VC approval.",
                  clause: "Deemed approved if VC does not respond in writing within 10 business days of written notice.",
                },
                {
                  key: "exec", group: "board",
                  title: "CEO / executive hiring & firing",
                  active: state.rounds.a.enabled,
                  market: "both",
                  demand: "VC approval required to hire or remove CEO and all C-suite roles.",
                  push: "Limit veto to CEO and CFO only. Require 4/5 board votes to remove CEO. Define 'For Cause' narrowly: fraud, criminal conviction, or gross negligence — not 'underperformance'.",
                  clause: isUS
                    ? "CEO removal without Cause triggers 12-month salary, COBRA coverage, and full single-trigger acceleration of unvested equity."
                    : "Founders removed without Cause receive 6-month salary and full acceleration of unvested equity.",
                },
                {
                  key: "mna", group: "governance",
                  title: isUS ? "Acquisitions above $500K" : "Acquisitions above ₹4Cr (~$500K)",
                  active: state.rounds.a.enabled,
                  market: "both",
                  demand: isUS
                    ? "Any acquisition above $500K requires VC approval."
                    : "Any acquisition above ₹4Cr (~$500K) requires VC approval.",
                  push: isUS
                    ? "Raise threshold to $2M. Carve out acqui-hires under $750K (talent acquisitions with no product transfer)."
                    : "Raise threshold to ₹15Cr (~$2M). Carve out acqui-hires under ₹6Cr. Require VC response within 20 business days.",
                  clause: "VC must respond in writing within 15 business days of notice, or acquisition is deemed approved.",
                },
                {
                  key: "debt", group: "economics",
                  title: isUS ? "New debt above $250K" : "New debt above ₹2Cr (~$250K)",
                  active: state.rounds.seed.enabled,
                  market: "both",
                  demand: isUS
                    ? "Any new borrowing above $250K requires VC sign-off."
                    : "Any new borrowing above ₹2Cr requires VC sign-off.",
                  push: isUS
                    ? "Raise threshold to $1M. Carve out: revolving credit lines, equipment financing under $500K, government-backed loans (SBA, etc.)."
                    : "Raise threshold to ₹8Cr. Carve out: working capital revolvers, equipment financing under ₹4Cr, government-backed loans (MUDRA, SIDBI).",
                  clause: "Pre-approved for credit facilities and their renewals as disclosed in the SHA schedule.",
                },
                {
                  key: "related", group: "governance",
                  title: "Related party transactions",
                  active: state.rounds.seed.enabled,
                  market: "both",
                  demand: "Any transaction between the company and founders, their family, or affiliated entities requires VC consent.",
                  push: "Carve out: (1) employment agreements approved by the board, (2) expense reimbursements under ₹10L / $10K, (3) arm's-length transactions at market rate certified by auditor.",
                  clause: "Board audit committee certification sufficient for transactions under ₹1Cr / $100K. VC consent needed above that threshold.",
                },
                {
                  key: "windup", group: "governance",
                  title: "Voluntary liquidation / winding up",
                  active: state.rounds.seed.enabled,
                  market: "both",
                  demand: "VC must consent to any voluntary liquidation, dissolution, or cessation of business.",
                  push: "Accept this — it's standard. But push back on unilateral VC right to force wind-up: that must require 75%+ shareholder vote.",
                  clause: "No single investor or investor class can force wind-up without approval of 75% of all shareholders by value, regardless of ownership percentage.",
                },
                {
                  key: "amend", group: "governance",
                  title: isUS ? "Amendment of Charter / IRA / SHA" : "Amendment of SHA / AoA",
                  active: state.rounds.a.enabled,
                  market: "both",
                  demand: isUS
                    ? "Any amendment to the Certificate of Incorporation, IRA, or SHA requires VC preferred stockholder approval."
                    : "Any amendment to the SHA or Articles of Association (AoA) requires VC consent.",
                  push: isUS
                    ? "VC consent only for amendments that directly affect preferred stock rights. All other changes require 75% common + preferred shareholder vote."
                    : "VC consent only for amendments affecting VC-specific rights (liquidation preference, anti-dilution, board seats). Administrative AoA changes need 75% shareholder vote only.",
                  clause: isUS
                    ? "Amendments to Sections [X] (liquidation preference), [Y] (anti-dilution), and [Z] (board rights) require preferred approval. All others require 75% shareholder vote."
                    : "Amendments to SHA Clauses [X] (liquidation preference), [Y] (anti-dilution), and [Z] (board composition) require VC consent. All others require 75% shareholder approval.",
                },
                {
                  key: "esop", group: "economics",
                  title: "ESOP / option pool increase",
                  active: state.rounds.a.enabled,
                  market: "both",
                  demand: "Any ESOP pool increase above the current board-approved level requires VC approval.",
                  push: "Pre-agree a multi-year ESOP schedule (e.g., 12% now, up to 18% total by Series B) in the SHA. Increases within the schedule need board approval only — no VC veto.",
                  clause: "ESOP increases within the pre-agreed SHA schedule require board approval only. Increases beyond the schedule require VC consent within 10 business days.",
                },
                {
                  key: "ipo", group: "board",
                  title: "IPO decision",
                  active: state.rounds.b.enabled,
                  market: "both",
                  demand: "VCs must approve any IPO filing, choice of exchange, and banker selection.",
                  push: "After 5 years from first close, founders can initiate IPO with 51% shareholder approval. VCs cannot veto an IPO that achieves ≥3× their cost basis.",
                  clause: isUS
                    ? "Preferred stockholder approval not required for IPO if: (i) ≥5 years since first investment, (ii) IPO price ≥3× Series A cost basis, and (iii) 51% of shareholders approve."
                    : "VC consent not required for IPO if: (i) ≥5 years since first investment, (ii) IPO price ≥3× Series A cost basis, and (iii) 51% of shareholders by value approve.",
                },
                {
                  key: "div", group: "economics",
                  title: "Dividend declaration",
                  active: state.rounds.seed.enabled,
                  market: "both",
                  demand: "No dividends of any kind without VC approval.",
                  push: "Accept it — it's standard. Push for one carve-out: board-approved performance bonuses and salary increases paid to employees (including founders) are explicitly not dividends.",
                  clause: "Performance bonuses and salary increases approved by the board compensation committee are explicitly excluded from the dividend restriction.",
                },
                {
                  key: "budget", group: "economics",
                  title: "Annual budget & business plan approval",
                  active: state.rounds.seed.enabled,
                  market: "both",
                  demand: isUS
                    ? "VCs require board approval of the annual operating budget and 3-year business plan. Any spending outside the approved budget by more than 10–15% requires VC sign-off."
                    : "VCs require board approval of the annual operating budget and business plan. Any spend variance >10–15% on individual line items (headcount, capex, marketing) requires VC consent.",
                  push: isUS
                    ? "Push for: (1) board approval of aggregate budget, not line-item, (2) 20% variance allowance on any single line item without re-approval, (3) emergency capex up to $250K without approval if CEO certifies business necessity, (4) budget deemed approved if board hasn't voted within 30 days of submission."
                    : "Push for: (1) board approval of total budget envelope, not line-by-line, (2) 20% variance on any single line item without further approval, (3) emergency spend up to ₹2Cr on business-critical items without approval if signed off by CEO + CFO, (4) budget deemed approved if board hasn't voted within 30 days of founder submission.",
                  clause: isUS
                    ? "Annual budget approved by board majority (not preferred class vote). CEO may authorise variance up to 20% on any single budget line without re-approval. Aggregate variance >20% of total opex requires board notification (not approval) within 10 days."
                    : "Annual budget approved by board resolution. CEO may authorise line-item variance up to 20% without further board approval. Any variance exceeding 20% of aggregate opex requires board notification within 15 days. Budget is deemed approved if the board fails to vote within 30 days of submission by management.",
                },
                {
                  key: "rofr", group: "founder",
                  title: "Right of First Refusal on founder share sales",
                  active: state.rounds.seed.enabled,
                  market: "both",
                  demand: "If any founder wants to sell shares to a third party, the company and then VCs have the right to buy those shares first at the same price.",
                  push: isUS
                    ? "Accept ROFR but limit it: (1) ROFR waived for transfers to founder's family trust or wholly-owned entity, (2) ROFR expires after IPO, (3) VCs must exercise within 10 business days or right lapses."
                    : "Accept ROFR but limit it: (1) ROFR waived for transfers to family trust or wholly-owned entity, (2) ROFR expires on IPO or trade sale, (3) VCs must exercise within 20 business days.",
                  clause: isUS
                    ? "ROFR lapses if not exercised in writing within 10 business days of notice. Permitted transfers to founder's living trust or immediate family are exempt."
                    : "ROFR lapses if not exercised in writing within 20 business days of notice. Intra-family and estate-planning transfers are exempt.",
                },
                {
                  key: "drag", group: "founder",
                  title: "Drag-along rights",
                  active: state.rounds.a.enabled,
                  market: "both",
                  demand: "If VCs holding X% of shares approve a sale of the company, they can force all other shareholders (including founders) to sell at the same price and terms.",
                  push: isUS
                    ? `Push for: (1) drag requires approval of ≥75% of all shareholders (not just preferred), (2) drag price floor = ${latest.valuation ? fmtM(latest.valuation) : "last round post-money"} — no forced sale below current valuation, (3) founders are not dragged below their liquidation preference floor, (4) drag cannot be triggered by a single VC class alone.`
                    : `Push for: (1) drag requires ≥75% shareholder approval by value, (2) drag price floor = ${latest.valuation ? fmtM(latest.valuation) : "last round post-money"} (your current post-money) — a VC cannot drag you into a below-valuation fire sale, (3) founder employment contracts survive the drag, (4) drag cannot be triggered within 3 years of first investment.`,
                  clause: isUS
                    ? `Drag-along right requires approval of: (i) a majority of the board including at least one founder director, (ii) ≥75% of preferred stockholders, and (iii) ≥51% of common stockholders. Drag-along shall not be exercisable at a price per share less than ${latest.valuation ? fmtM(latest.valuation) : "[last round post-money]"} (the Floor Valuation), adjusted for any subsequent financings.`
                    : `Drag-along right requires approval of: (i) board resolution with founder director approval, (ii) ≥75% of preference shareholders, and (iii) ≥51% of equity shareholders by value. Drag-along shall not be triggered at a valuation below ${latest.valuation ? fmtM(latest.valuation) : "[last round post-money]"} (the Floor Valuation) without the unanimous written consent of all Founder Directors.`,
                },
                {
                  key: "bizchange", group: "governance",
                  title: "Change of principal business activity",
                  active: state.rounds.a.enabled,
                  market: "both",
                  demand: "Any material pivot away from the core business described in the SHA requires VC consent.",
                  push: "Define 'material change' narrowly: only applies to entering a completely different industry vertical. Adjacent product expansion, new geographies, and new customer segments are explicitly exempt.",
                  clause: "Change of principal business means shifting to a primary revenue activity unrelated to [defined business description]. Board-approved product pivots within the same technology domain are not a change of principal business.",
                },
                {
                  key: "keyman", group: "board",
                  title: "Key man / founder departure provisions",
                  active: state.rounds.a.enabled,
                  market: "both",
                  demand: isUS
                    ? "If the CEO or a named key person leaves, VCs may have the right to suspend new investment tranches, call special meetings, or trigger mandatory buyback of unvested shares."
                    : "If the CEO or named key persons leave, VCs may have the right to suspend drawdowns, accelerate conversion of preference shares, or demand a buyback of unvested founder shares.",
                  push: "Limit key man to CEO only (not all co-founders). Key man suspension is limited to 90 days to find a replacement approved by the board. Key man does NOT trigger drag-along or preference conversion.",
                  clause: isUS
                    ? "Key man event means departure of the named CEO only. Company has 90 days to appoint a board-approved replacement. Key man does not trigger drag-along, redemption rights, or any anti-dilution adjustment."
                    : "Key man event means voluntary departure of the CEO only. Company has 90 days to appoint a board-approved replacement. Key man event does not trigger preference share conversion, drag-along, or redemption rights.",
                },
                {
                  key: "badleaver", group: "founder",
                  title: "Bad leaver / good leaver definitions",
                  active: state.rounds.seed.enabled,
                  market: "both",
                  demand: isUS
                    ? "VCs define any founder departure as 'bad leaver' by default (fraud, resignation, termination for cause OR convenience) — triggering clawback of unvested shares at nominal/cost price."
                    : "VCs define broad 'bad leaver' categories including voluntary resignation, not-for-cause termination, and breach of employment terms — entitling the company to buy back vested AND unvested shares at cost.",
                  push: isUS
                    ? "Narrow bad leaver to: (1) fraud, (2) criminal conviction, (3) gross negligence causing material harm — nothing broader. Good leaver (death, disability, termination without cause) = vesting accelerates and shares transfer at FMV. Add a sunset: bad leaver provisions expire 12 months after IPO or trade sale."
                    : "Narrow bad leaver to: (1) fraud, (2) criminal conviction, (3) gross negligence. Good leaver (death, disability, termination without cause) = vesting accelerates and shares transfer at FMV. Explicitly exclude 'failure to meet KPIs' and 'strategic disagreement' as bad leaver triggers — these are VCs' favourite constructive-termination tools.",
                  clause: isUS
                    ? "'Bad Leaver' means a Founder whose employment is terminated solely by reason of: (i) conviction of a felony, (ii) fraud or embezzlement against the Company, or (iii) gross negligence causing material financial harm, as determined by a court of competent jurisdiction. Voluntary resignation and termination without cause are explicitly excluded from the Bad Leaver definition."
                    : "'Bad Leaver' means a Founder whose employment is terminated solely by reason of: (i) conviction of an offence involving moral turpitude, (ii) fraud or misappropriation of Company assets, or (iii) gross negligence causing material harm as determined by a competent court. For the avoidance of doubt, voluntary resignation for Good Reason, termination without cause, and strategic disagreements do not constitute Bad Leaver events.",
                },
                {
                  key: "quorum", group: "board",
                  title: "Board quorum and meeting requirements",
                  active: state.rounds.seed.enabled,
                  market: "both",
                  demand: isUS
                    ? "VCs may insist that quorum for board meetings requires the presence of at least one VC-nominated director — giving any single VC the ability to block decisions by simply not attending."
                    : "VCs insist that quorum for board meetings requires the presence of at least one VC-nominated director or an investor representative — enabling a single no-show to paralyse the board.",
                  push: isUS
                    ? "Push for: (1) quorum = simple majority of total directors (not class-based), (2) if quorum not met, meeting adjourned 5 business days and then proceeds regardless of VC attendance, (3) written consent resolutions (board action without a meeting) permitted for routine matters with 48-hour notice."
                    : "Push for: (1) quorum = majority of directors present in person or by video — no class-based quorum, (2) if quorum fails, meeting adjourned 7 days and then valid regardless, (3) circular resolutions permitted for routine operational matters with written consent of all directors.",
                  clause: isUS
                    ? "Quorum for any board meeting shall be a majority of the total number of directors then in office. If quorum is not present at any duly noticed meeting, such meeting shall be adjourned for five (5) business days, and such adjourned meeting shall proceed with a quorum consisting of any two (2) directors present."
                    : "Quorum for board meetings shall be a majority of directors then in office, present in person or by electronic means. If quorum is not met, the meeting shall stand adjourned for 7 (seven) days and may then proceed with those directors present, provided written notice of the adjourned meeting was sent to all directors.",
                },
                {
                  key: "inforights", group: "founder",
                  title: "Information rights — competitive risk",
                  active: state.rounds.seed.enabled,
                  market: "both",
                  demand: isUS
                    ? "Standard IRA information rights: monthly financials, annual audited accounts, annual budget, board materials, and the right to inspect books and records on 5 days' notice. Some VCs also demand pipeline data, customer names, and employee comp tables."
                    : "Standard SHA information rights: quarterly management accounts, annual audited financials, annual business plan, and board materials. Aggressive VCs request monthly operational metrics, customer cohorts, and access to accounting software.",
                  push: isUS
                    ? "Accept standard financials + board materials. Push back on: (1) customer-specific data — redact to cohort / ARR band, (2) employee comp tables — summarise by band, not individual, (3) pipeline CRM access — provide summary, not Salesforce login, (4) add a confidentiality clause: VC may not share information rights data with portfolio companies in the same space."
                    : "Accept quarterly accounts and board materials. Push back on: (1) customer names — provide anonymised cohort data, (2) salary details — provide banded summaries, (3) real-time metric dashboards — agree on monthly report format instead, (4) add an explicit competitive-use restriction: information received under these rights may not be shared with or used for the benefit of any VC portfolio company operating in the same sector.",
                  clause: isUS
                    ? "All information provided under these Information Rights is confidential. Investor shall not share, disclose, or use such information for the benefit of any other company in Investor's portfolio that operates in a business competitive with the Company. Breach of this confidentiality obligation entitles the Company to suspend Information Rights immediately on written notice."
                    : "All information provided to Investor under this clause shall be treated as confidential and shall not be shared with, or used for the benefit of, any portfolio company of Investor operating in the same or similar business as the Company. Investor shall procure that its partners, employees, and nominees treat such information as confidential. Breach entitles the Company to suspend information delivery on 14 days' written notice.",
                },
                // ── Board seat retention condition ─────────────────────────
                {
                  key: "boardretention", group: "board",
                  title: "Minimum equity condition for founder board seats",
                  active: anyRoundsEnabled,
                  market: "both",
                  demand: isUS
                    ? "VCs include a 'Director Qualification Threshold' in the IRA / SHA: if founders collectively fall below 10–15% fully-diluted ownership, they must immediately resign all director seats — giving VCs and the independent full board control."
                    : "VCs include a 'Board Seat Retention Condition' in the SHA: if founders collectively fall below 15–20% equity (fully diluted), founder-nominated directors must resign, leaving board control entirely with VCs and the independent director.",
                  push: isUS
                    ? "Push for: (1) threshold at 5%, not 10–15% — meaningful dilution should not cost your seat, (2) threshold applies ONLY if the drop was from founder-initiated secondary sales, not from company-issued new equity in any board-approved round, (3) 90-day cure period to recapture equity before resignation triggers, (4) right to appoint a non-executive observer seat even after threshold breach."
                    : "Push for: (1) lower threshold to 10%, not 15–20%, (2) VC-driven dilution from Qualified Financing Rounds does NOT count toward the threshold for 12 months post-closing, (3) 90-day cure period before forced resignation, (4) if threshold is breached, founders retain the right to nominate one non-executive independent director from an agreed list.",
                  clause: isUS
                    ? "Each Founder Director shall be required to resign their director seat only if (i) the aggregate equity ownership of all Founders falls below [5]% of the Company's fully diluted capitalization, AND (ii) such decrease results from voluntary transfers or secondary sales by Founders, and not from the issuance of new Company securities in a board-approved financing. The Company shall provide written notice to Founders within 10 business days of any such breach, with a 90-day cure period prior to any required resignation."
                    : "The right of the Founders to nominate Founder Directors shall lapse only if the aggregate equity shareholding of all Founders (on a fully diluted basis, excluding shares transferred in Secondary Sales) falls below [10]% of the fully diluted share capital of the Company. For the avoidance of doubt, dilution caused by allotment of shares in any Qualified Financing Round shall not reduce the Founders' qualifying shareholding for purposes of this clause for a period of 12 (twelve) months from the date of allotment. A 90-day notice and cure period shall apply before any required resignation.",
                },
                // ── India-specific ─────────────────────────────────────────
                {
                  key: "prefconv", group: "economics",
                  title: "Conversion timing of preference shares / CCDs",
                  active: state.rounds.seed.enabled,
                  market: "india",
                  demand: "VCs control when preference shares or CCDs convert to equity — including the right to delay conversion if conversion would be dilutive to their returns.",
                  push: "Specify mandatory conversion triggers in the SHA: (1) qualified IPO, (2) trade sale above agreed floor valuation, (3) at VC's election after 5 years. Prohibit VC-triggered conversion without corresponding liquidation event.",
                  clause: "Compulsory conversion occurs on: (i) qualified IPO at price ≥ 2× subscription price, (ii) trade sale at aggregate valuation ≥ ₹[X]Cr, or (iii) VC election after 60 months from allotment. Conversion price floor = subscription price.",
                },
                {
                  key: "auditor", group: "governance",
                  title: "Change of statutory auditor",
                  active: state.rounds.seed.enabled,
                  market: "india",
                  demand: "Appointment or change of statutory auditor (as required under Companies Act 2013) requires VC consent — VCs want a Big 4 or recognised firm auditing their investment.",
                  push: "Accept that a recognised statutory auditor is required, but push: (1) initial auditor choice is a founder decision at pre-seed, (2) from Seed onward, VC approval is only required if switching to a non-Big 4 / non-recognised firm, (3) auditor change for cost reasons must be pre-approved in annual budget.",
                  clause: "Change of statutory auditor requires board approval. Switch to a firm not in the pre-agreed approved list (to be annexed to SHA) requires VC consent. Annual auditor reappointment does not require VC consent.",
                },
                // ── US-specific ────────────────────────────────────────────
                {
                  key: "qsbs", group: "economics",
                  title: "QSBS eligibility — Section 1202 protection",
                  active: state.rounds.seed.enabled,
                  market: "us",
                  demand: "VCs will veto any corporate action that could disqualify their shares from Section 1202 QSBS tax treatment — worth up to $10M per investor in tax-free gains on exit.",
                  push: "This is largely in founders' interest too. Push to add a QSBS compliance covenant: company will provide written notice before any action that could breach QSBS requirements (>$50M gross assets, non-qualified business type, stock repurchases within 2 years of issuance).",
                  clause: "Company shall provide written notice to all investors at least 30 days prior to any action that would cause the company's stock to cease to qualify as QSBS under Section 1202 of the IRC.",
                },
                {
                  key: "repurchase", group: "economics",
                  title: "Stock repurchase (NVCA standard)",
                  active: state.rounds.seed.enabled,
                  market: "us",
                  demand: "No repurchase or redemption of any company stock without preferred stockholder approval — standard NVCA Model Protective Provision.",
                  push: "Accept the restriction but negotiate carve-outs: (1) repurchases pursuant to equity incentive agreements at cost (leavers), (2) repurchases at board-approved prices from terminated employees, (3) any repurchase where preferred stockholders are offered the same terms.",
                  clause: "Company may repurchase securities without preferred stockholder approval only: (i) pursuant to equity incentive plan repurchase rights at not more than cost, or (ii) pursuant to board-approved buybacks offered pro-rata to all stockholders.",
                },
                {
                  key: "authshares", group: "economics",
                  title: "Authorized share class increase (Delaware)",
                  active: state.rounds.a.enabled,
                  market: "us",
                  demand: "Any increase in the number of authorized shares in the Certificate of Incorporation requires preferred stockholder approval — VCs use this to control future dilution.",
                  push: "Negotiate a pre-approved 'authorized headroom' in the initial Certificate: authorize 2–3× the current issued shares so routine ESOP grants and bridge rounds don't trigger this veto. Future increases beyond headroom require approval.",
                  clause: "Certificate of Incorporation to authorize [X] shares initially, representing approximately 3× current issued shares. Subsequent amendments to increase authorization require approval of holders of ≥60% of preferred stock, voting as a separate class.",
                },
              ] as VetoItem[]).filter((it) => it.market === "both" || (isUS ? it.market === "us" : it.market === "india"));

              const renderVetoItem = (it: VetoItem) => (
                <AccordionItem
                  key={it.key}
                  value={it.key}
                  className={cn(
                    "px-3 rounded-md border mb-1.5 last:mb-0",
                    it.active ? "border-red-500/60 bg-red-500/5" : "border-border",
                  )}
                >
                  <AccordionTrigger className="hover:no-underline py-3">
                    <div className="flex items-center justify-between w-full pr-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={cn("h-2.5 w-2.5 rounded-full flex-shrink-0", it.active ? "bg-red-500" : "bg-emerald-400")} />
                        <span className="text-sm font-semibold text-left leading-snug">{it.title}</span>
                      </div>
                      <Badge className={cn("text-xs ml-2 flex-shrink-0", it.active ? "bg-red-500/15 text-red-600 border border-red-500/30" : "bg-emerald-500/15 text-emerald-700 border border-emerald-500/30")}>
                        {it.active ? "ACTIVE" : "INACTIVE"}
                      </Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pt-2">
                    <div className="space-y-3">
                      <div>
                        <div className="text-xs font-bold">⚠️ What VCs demand</div>
                        <div className="text-xs text-muted-foreground mt-1">{it.demand}</div>
                      </div>
                      <div>
                        <div className="text-xs font-bold">✅ Push back to</div>
                        <div className="text-xs text-muted-foreground mt-1">{it.push}</div>
                      </div>
                      <div>
                        <div className="text-xs font-bold">📄 Exact clause to negotiate</div>
                        <div className="text-xs text-muted-foreground mt-1">{it.clause}</div>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              );
              const vetoSections: Array<{ key: VetoItem["group"]; label: string; icon: string }> = [
                { key: "board",      label: "Board & Control",       icon: "🏛️" },
                { key: "economics",  label: "Economics & Cap Table",  icon: "💰" },
                { key: "founder",    label: "Founder Protections",    icon: "🛡️" },
                { key: "governance", label: "Governance & Documents", icon: "📋" },
              ];
              const defaultOpenSections = vetoSections
                .filter(({ key: gk }) => vetoItems.filter((it) => it.group === gk && it.active).length > 0)
                .map(({ key: gk }) => gk);
              return (
                <div className="mt-4">
                  <Accordion
                    type="multiple"
                    defaultValue={defaultOpenSections}
                    className="w-full space-y-2"
                  >
                    {vetoSections.map(({ key: gk, label, icon }) => {
                      const groupItems = vetoItems.filter((it) => it.group === gk);
                      if (groupItems.length === 0) return null;
                      const activeCount = groupItems.filter((it) => it.active).length;
                      return (
                        <AccordionItem
                          key={gk}
                          value={gk}
                          className="border rounded-xl px-3 py-0 overflow-hidden"
                        >
                          <AccordionTrigger className="hover:no-underline py-3">
                            <div className="flex items-center gap-2 w-full pr-2">
                              <span className="text-sm">{icon}</span>
                              <span className="text-xs font-bold uppercase tracking-wide">{label}</span>
                              {activeCount > 0 && (
                                <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">{activeCount} active</span>
                              )}
                              <span className="ml-auto text-xs text-muted-foreground font-normal mr-1">{groupItems.length} items</span>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="pb-3 pt-1">
                            <Accordion type="single" collapsible className="w-full">
                              {groupItems.map(renderVetoItem)}
                            </Accordion>
                          </AccordionContent>
                        </AccordionItem>
                      );
                    })}
                  </Accordion>
                </div>
              );
            })()}
          </Card>
          )}

          <Card className="p-4">
            <div className="font-semibold text-sm mb-1 text-foreground">Key Ownership Thresholds</div>
            <div className="text-xs text-muted-foreground mb-4">Tap any threshold to see exactly what powers change hands when it is crossed.</div>
            {(() => {
              const thresholds = [
                {
                  key: "t75",
                  label: "Founders supermajority",
                  threshold: "75%",
                  ok: founderPct > 75,
                  current: founderPct,
                  who: "founders",
                  meaning: isUS
                    ? "Under DGCL and most VCs' Voting Agreements, a 75% supermajority is required for major structural changes — Charter amendments, mergers, dissolution, and new share class creation all fall here."
                    : "Under the Companies Act 2013, special resolutions require 75% of votes cast. These cover: AoA amendments, mergers, change of company name, capital reduction, winding up, and any new share class with different rights.",
                  whenSafe: "Founders can pass special resolutions unilaterally — including AoA/Charter amendments, structural changes, and major transactions — without requiring VC support.",
                  whenBreached: isUS
                    ? "VCs holding >25% can block any Charter amendment, merger, dissolution, or new share class. You cannot restructure the company, set up dual-class shares, or wind up without their consent."
                    : "Any VC holding >25% can single-handedly block all special resolutions. This means no AoA amendments, no mergers, no capital restructuring, no winding up — without their blessing. This is the most powerful blocking right in Indian company law.",
                  marketNote: isUS ? null : "India-specific: the 75%/25% threshold is hard-coded into the Companies Act. Unlike contractual rights, it cannot be waived by SHA — it is always in effect regardless of what the SHA says.",
                },
                {
                  key: "t51",
                  label: "Founders simple majority",
                  threshold: "51%",
                  ok: founderPct > 51,
                  current: founderPct,
                  who: "founders",
                  meaning: isUS
                    ? "Ordinary resolutions in the US require a simple majority of votes cast. These cover day-to-day governance: approving financial statements, electing directors at shareholder meetings, and approving most standard transactions."
                    : "Ordinary resolutions under Companies Act 2013 need >50% of votes cast. They cover: approval of financial accounts, appointment / removal of non-executive directors, related-party transactions above certain thresholds, and routine approvals.",
                  whenSafe: "Founders can independently pass all ordinary resolutions — routine approvals, financial accounts, director appointments — without needing VC votes. Company governance runs on founder terms.",
                  whenBreached: isUS
                    ? "VCs can combine to pass ordinary resolutions without founders. They can approve related-party transactions, remove non-executive directors, and block annual accounts. They cannot yet run the company but can create significant friction in day-to-day governance."
                    : "VCs can pass ordinary resolutions without founders — approving accounts, appointing auditors, approving transactions with VC-affiliated entities, removing directors at the shareholder level. Founders lose the ability to approve anything without VC support.",
                  marketNote: null,
                },
                {
                  key: "t26",
                  label: "VC blocking minority",
                  threshold: "26%",
                  ok: vcPct < 26,
                  current: vcPct,
                  who: "vcs",
                  meaning: isUS
                    ? "Once VCs hold >25% of voting shares (or have contractual protective provisions), they can block most major structural changes under the SHA and Voting Agreement even without holding a majority."
                    : "This is the most important threshold in Indian company law. Once any investor (or group acting in concert) crosses 26%, they can block ALL special resolutions — permanently — regardless of what the SHA says, because the Companies Act is a statutory right that overrides contracts.",
                  whenSafe: "VCs cannot unilaterally block special resolutions. You can pass major structural changes, AoA amendments, and mergers with the support of other shareholders — VCs cannot single-handedly stop you.",
                  whenBreached: isUS
                    ? "VCs can block Charter amendments, new share classes, mergers, and dissolution. Their consent is needed for any major structural change — effectively a permanent veto on company structure, regardless of board dynamics."
                    : "This is a CODE RED: VCs can now block every special resolution under the Companies Act. You cannot change the AoA, merge, reduce capital, wind up, or issue new share classes without their consent. This right exists in law — no SHA clause can take it away. The only way out is buying back their shares.",
                  marketNote: isUS ? null : "India only: the 26% blocking threshold is a statutory right under Companies Act s.114. It is not a contractual right — it cannot be modified by the SHA. Once crossed, it is permanent unless you buy back sufficient shares.",
                },
                {
                  key: "t50vc",
                  label: "VC combined majority",
                  threshold: "50%",
                  ok: vcPct < 50,
                  current: vcPct,
                  who: "vcs",
                  meaning: "Once VCs combined hold >50% of total equity (and therefore voting rights, assuming single-class shares), they can pass ordinary resolutions without founders. Combined with their board seats, this gives VCs effective operational control of the company.",
                  whenSafe: "No single VC combination can pass ordinary resolutions without at least one founder's vote. Day-to-day governance, financial approvals, and director appointments all require founder participation.",
                  whenBreached: isUS
                    ? "VCs can pass ordinary resolutions without founders — elect new directors at shareholder level, approve accounts, approve VC-affiliated transactions, and block resolutions founders bring. Combined with board control, they can effectively run the company without you."
                    : "VCs can pass all ordinary resolutions without founder votes. They can appoint and remove non-executive directors, approve related-party transactions (even with VC-affiliated entities), and approve financial accounts — all without you. This is effective shareholder-level control.",
                  marketNote: null,
                },
                {
                  key: "t10",
                  label: "VC requisition right",
                  threshold: "10%",
                  ok: vcPct < 10,
                  current: vcPct,
                  who: "vcs",
                  meaning: isUS
                    ? "Under most state laws and Voting Agreements, shareholders holding ≥10% of voting shares can demand a special shareholder meeting for any purpose. VCs use this to put hostile resolutions to a shareholder vote outside the normal AGM cycle."
                    : "Under Companies Act 2013 s.100, shareholders holding ≥10% of paid-up share capital can requisition an Extraordinary General Meeting (EGM). This right activates for virtually any VC after Seed round and is used to put resolutions directly to shareholders — bypassing the board.",
                  whenSafe: "No investor can force an extraordinary shareholder meeting. You control the meeting calendar and agenda. VCs can only raise issues through the board, which you control.",
                  whenBreached: isUS
                    ? "Any VC holding ≥10% can call a special shareholder meeting at any time to put resolutions to a vote — including resolutions to remove directors, approve transactions, or amend governance documents. The board cannot block this."
                    : "Any VC with ≥10% can requisition an EGM within 21 days. They set the agenda. The board must hold the EGM within 45 days or the requisitionists can convene it themselves. VCs use this to escalate governance disputes outside normal channels.",
                  marketNote: null,
                },
              ];
              return (
                <Accordion type="single" collapsible className="w-full space-y-1">
                  {thresholds.map((t) => (
                    <AccordionItem
                      key={t.key}
                      value={t.key}
                      className={cn(
                        "rounded-md border px-3",
                        t.ok ? "border-emerald-300/60 bg-emerald-500/5" : "border-red-400/60 bg-red-500/5",
                      )}
                    >
                      <AccordionTrigger className="hover:no-underline py-3">
                        <div className="flex items-center justify-between w-full pr-2">
                          <div className="flex items-center gap-2">
                            <span className={cn("h-2.5 w-2.5 rounded-full flex-shrink-0", t.ok ? "bg-emerald-500" : "bg-red-500")} />
                            <span className="text-sm font-semibold text-left">{t.label}</span>
                            <span className="text-xs text-muted-foreground hidden sm:inline">({t.who === "founders" ? `founders at ${t.current.toFixed(1)}%` : `VCs at ${t.current.toFixed(1)}%`})</span>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-xs font-bold text-muted-foreground">{t.threshold}</span>
                            <Badge className={cn("text-xs", t.ok ? "bg-emerald-500/15 text-emerald-700 border border-emerald-500/30" : "bg-red-500/15 text-red-600 border border-red-500/30")}>
                              {t.ok ? "SAFE" : "BREACHED"}
                            </Badge>
                          </div>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="pt-1 pb-3">
                        <div className="space-y-3">
                          <div>
                            <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">Why this threshold matters</div>
                            <div className="text-xs leading-relaxed">{t.meaning}</div>
                          </div>
                          <div className={cn("rounded-lg p-2.5 border", t.ok ? "bg-emerald-50/80 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800" : "bg-muted border-border")}>
                            <div className="text-xs font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400 mb-1">✅ While SAFE ({t.threshold} not yet crossed)</div>
                            <div className="text-xs leading-relaxed">{t.whenSafe}</div>
                          </div>
                          <div className={cn("rounded-lg p-2.5 border", !t.ok ? "bg-red-50/80 border-red-200 dark:bg-red-950/20 dark:border-red-800" : "bg-muted border-border")}>
                            <div className="text-xs font-bold uppercase tracking-wide text-red-600 dark:text-red-400 mb-1">🚨 Once BREACHED ({t.threshold} crossed)</div>
                            <div className="text-xs leading-relaxed">{t.whenBreached}</div>
                          </div>
                          {t.marketNote && (
                            <div className="rounded-lg bg-blue-50 border border-blue-200 px-2.5 py-2 dark:bg-blue-950/20 dark:border-blue-800">
                              <div className="text-xs font-bold uppercase tracking-wide text-blue-600 dark:text-blue-400 mb-1">📍 {isUS ? "US" : "India"} specific</div>
                              <div className="text-xs leading-relaxed text-blue-800 dark:text-blue-200">{t.marketNote}</div>
                            </div>
                          )}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              );
            })()}
          </Card>
        </TabsContent>

        {/* ── PROTECT ── */}
        <TabsContent value="negotiate" className="space-y-3 mt-4 border-t border-border pt-6">
          <Card className="p-4">
            <div className="font-semibold text-sm mb-3 text-foreground">Founder Control vs. Danger Zones</div>
            <div className="h-64">
              <ResponsiveContainer>
                <LineChart data={protectData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="round" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} tickFormatter={(v) => v + "%"} />
                  <RechartsTooltip formatter={(v: number) => v.toFixed(2) + "%"} />
                  <Legend wrapperStyle={{ fontSize: "10px" }} />
                  <Line type="monotone" dataKey="founders" name="Founders %" stroke="#3b82f6" strokeWidth={3} dot={{ r: 3 }} />
                  <ReferenceLine y={51} stroke="#22c55e" strokeDasharray="6 4" label={{ value: "Safe", position: "insideTopLeft", fill: "#22c55e", fontSize: 10 }} />
                  <ReferenceLine y={35} stroke="#ef4444" strokeDasharray="6 4" label={{ value: "Danger", position: "insideTopLeft", fill: "#ef4444", fontSize: 10 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="p-4">
            <div className="font-semibold text-sm mb-3 text-foreground">Anti-Takeover Scenarios</div>
            {(() => {
              const items = [
                {
                  title: "VCs accumulate >50% combined",
                  risk: "Multiple VCs bloc-vote to override founders.",
                  defense: "Cap combined VC voting rights at 40% in SHA. Require 30-day notice before VCs coordinate a bloc vote.",
                  badge: "HIGH RISK",
                },
                {
                  title: "Forced down-round dilution",
                  risk: "Full-ratchet anti-dilution wipes out founder stakes.",
                  defense: "Weighted-average only. ESOP issuances and bridge loans excluded.",
                  badge: "HIGH RISK",
                },
                {
                  title: "Founder squeeze-out",
                  risk: "VC pressures a founder out, triggers drag-along for cheap sale.",
                  defense: "'For Cause' requires 4/5 board votes. Full unvested acceleration on unjust termination + 6-month salary.",
                  badge: "MED RISK",
                },
                {
                  title: "Strategic acquirer + VC alliance",
                  risk: "VC sells to hostile strategic who allies with other VCs.",
                  defense: "VC transfers restricted to approved buyer list. Any VC transfer triggers founders' ROFR.",
                  badge: "MED RISK",
                },
              ];
              return (
                <div className="space-y-3">
                  {items.map((it) => (
                    <div key={it.title} className="p-3 rounded-md border border-border">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-semibold text-sm text-foreground">{it.title}</div>
                        <Badge className={cn("text-xs", it.badge === "HIGH RISK" ? "bg-red-500/15 text-red-600 border border-red-500/30" : "bg-orange-500/15 text-orange-700 border border-orange-500/30")}>
                          {it.badge}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1"><span className="font-semibold text-foreground">Risk:</span> {it.risk}</div>
                      <div className="text-xs text-muted-foreground mt-1"><span className="font-semibold text-foreground">Defense:</span> {it.defense}</div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </Card>

          <Card className="p-4">
            <div className="font-semibold text-sm mb-3 text-foreground">Structural Protections Checklist</div>
            {(() => {
              const items = [
                { title: "Dual-class structure in AoA", note: "DO BEFORE SEED", tone: "red", detail: "AoA amendments need 75% approval — hard for VCs to strip." },
                { title: "Accelerated vesting for founders", note: "NEGOTIATE HARD", tone: "orange", detail: "25% vests immediately on VC close, remaining 75% over 3 years." },
                { title: "Mutual ROFR among founders", note: "MUST HAVE", tone: "red", detail: "Any founder selling must first offer shares to co-founders at same price." },
              ] as const;
              const badgeCls = (tone: (typeof items)[number]["tone"]) =>
                tone === "red"
                  ? "bg-red-500/15 text-red-600 border border-red-500/30"
                  : "bg-orange-500/15 text-orange-700 border border-orange-500/30";
              return (
                <div className="space-y-2">
                  {items.map((it) => (
                    <div key={it.title} className="flex items-start justify-between gap-3 bg-muted rounded-md px-3 py-2">
                      <div>
                        <div className="text-sm font-bold">{it.title}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{it.detail}</div>
                      </div>
                      <Badge className={cn("text-xs shrink-0", badgeCls(it.tone))}>{it.note}</Badge>
                    </div>
                  ))}
                </div>
              );
            })()}
          </Card>
        </TabsContent>

        {/* ── COMPARE ── */}
        <TabsContent value="compare" className="space-y-3 mt-4">
          {/* Save UI */}
          <Card className="p-4">
            <div className="flex items-center justify-between mb-1">
              <div className="font-semibold text-sm text-foreground">Scenario Comparison</div>
              <div className="text-xs text-muted-foreground">{savedScenarios.length}/3 saved</div>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Save your current setup as a named scenario, then tweak round terms and save again. Compare side-by-side to find the best deal structure for your founders.
            </p>
            {!savingMode ? (
              <button
                className="px-3 py-2 rounded-md bg-foreground text-background text-xs font-bold disabled:opacity-40"
                disabled={!anyRoundsEnabled || savedScenarios.length >= 3}
                onClick={() => { setSavingMode(true); setNewScenarioName(""); }}
              >
                📸 Save Current as Scenario
              </button>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <Input
                  autoFocus
                  value={newScenarioName}
                  onChange={(e) => setNewScenarioName(e.target.value)}
                  placeholder='e.g. "Aggressive Seed" or "Negotiated Series A"'
                  className="h-8 text-xs flex-1 min-w-[180px]"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newScenarioName.trim()) saveScenario();
                    if (e.key === "Escape") setSavingMode(false);
                  }}
                />
                <button
                  className="px-3 py-1.5 rounded-md bg-foreground text-background text-xs font-bold disabled:opacity-40"
                  disabled={!newScenarioName.trim()}
                  onClick={saveScenario}
                >
                  Save
                </button>
                <button
                  className="px-3 py-1.5 rounded-md border text-xs"
                  onClick={() => setSavingMode(false)}
                >
                  Cancel
                </button>
              </div>
            )}
            {savedScenarios.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {savedScenarios.map((s, i) => (
                  <div key={i} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted text-xs font-medium border">
                    <span>{s.name}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-primary font-semibold">{s.founderPct.toFixed(1)}%</span>
                    <button
                      className="text-muted-foreground hover:text-foreground ml-0.5 leading-none"
                      onClick={() => setSavedScenarios((prev) => prev.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  className="px-2.5 py-1 text-xs text-muted-foreground border border-dashed rounded-full hover:border-foreground/40"
                  onClick={() => setSavedScenarios([])}
                >
                  Clear all
                </button>
              </div>
            )}
            {!anyRoundsEnabled && (
              <p className="mt-3 text-xs text-muted-foreground">Enable funding rounds in the Rounds tab first, then save a scenario here.</p>
            )}
          </Card>

          {savedScenarios.length > 0 && (() => {
            const minPayoutAt = (ev: number) => {
              const s2 = computeSnaps({ ...state, exitValue: ev });
              const l2 = latestSnap(s2);
              const fp2 = founderPayouts(l2, ev, state.usePref);
              if (!fp2.length) return 0;
              return fp2.reduce((m, f) => (f.payout < m ? f.payout : m), fp2[0].payout);
            };
            const liveBoardStatus =
              latest.vcSeats > founderSeats ? "VC-controlled"
              : latest.vcSeats === founderSeats && latest.vcSeats > 0 ? "Tied"
              : "Founder-ctrl";
            const live = {
              name: "Current ★",
              founderPct, vcPct,
              vcSeats: latest.vcSeats,
              boardStatus: liveBoardStatus,
              totalRaise: totalInvested,
              totalPref,
              founderPayout50:  minPayoutAt(50),
              founderPayout100: minPayoutAt(100),
              founderPayout200: minPayoutAt(200),
            };
            const cols = [...savedScenarios, live];
            const COMPARE_COLORS = ["#4361ee", "#7209b7", "#f72585", "#4cc9f0"];

            const barData = [
              { label: "$50M exit",  ...Object.fromEntries(cols.map((c) => [c.name, parseFloat(c.founderPayout50.toFixed(2))])) },
              { label: "$100M exit", ...Object.fromEntries(cols.map((c) => [c.name, parseFloat(c.founderPayout100.toFixed(2))])) },
              { label: "$200M exit", ...Object.fromEntries(cols.map((c) => [c.name, parseFloat(c.founderPayout200.toFixed(2))])) },
            ];

            type ColKey = "founderPct" | "vcPct" | "vcSeats" | "totalRaise" | "totalPref" | "founderPayout50" | "founderPayout100" | "founderPayout200";
            const maxOf = (k: ColKey) => Math.max(...cols.map((c) => Number(c[k])));
            const minOf = (k: ColKey) => Math.min(...cols.map((c) => Number(c[k])));
            const cellCls = (val: number, best: number, worst: number, hib: boolean) => {
              if (cols.length < 2) return "";
              const isBest  = hib ? val === best  && val !== worst : val === worst && val !== best;
              const isWorst = hib ? val === worst && val !== best  : val === best  && val !== worst;
              return cn(isBest && "bg-emerald-500/10 text-emerald-700 font-bold", isWorst && "bg-red-500/10 text-red-700");
            };

            const rows: Array<{ label: string; key: ColKey; fmt: (v: number) => string; hib: boolean | null }> = [
              { label: "Founder Equity",       key: "founderPct",      fmt: (v) => v.toFixed(1) + "%",  hib: true  },
              { label: "VC Stake",              key: "vcPct",           fmt: (v) => v.toFixed(1) + "%",  hib: false },
              { label: "VC Board Seats",        key: "vcSeats",         fmt: (v) => String(v),           hib: false },
              { label: "Total Raised",          key: "totalRaise",      fmt: (v) => fmtM(v),             hib: null  },
              { label: "Pref Overhang",         key: "totalPref",       fmt: (v) => fmtM(v),             hib: false },
              { label: "Founder take-home @$50M",  key: "founderPayout50",  fmt: (v) => fmtM(v), hib: true },
              { label: "Founder take-home @$100M", key: "founderPayout100", fmt: (v) => fmtM(v), hib: true },
              { label: "Founder take-home @$200M", key: "founderPayout200", fmt: (v) => fmtM(v), hib: true },
            ];

            return (
              <>
                {/* Payout bar chart */}
                <Card className="p-4">
                  <div className="font-semibold text-sm mb-1">Founder Take-Home by Exit Size</div>
                  <p className="text-xs text-muted-foreground mb-4">
                    Lowest individual founder payout across scenarios — the floor, not the average.
                  </p>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={barData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => "$" + v + "M"} />
                        <RechartsTooltip formatter={(v: number) => ["$" + v + "M", ""]} />
                        <Legend wrapperStyle={{ fontSize: "10px" }} />
                        {cols.map((c, i) => (
                          <Bar
                            key={c.name}
                            dataKey={c.name}
                            fill={COMPARE_COLORS[i % COMPARE_COLORS.length]}
                            radius={[3, 3, 0, 0]}
                            opacity={c.name === live.name ? 1 : 0.75}
                          />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                {/* Delta summary row */}
                {cols.length >= 2 && (
                  <Card className="p-4">
                    <div className="font-semibold text-sm mb-3">How Scenarios Differ from Current</div>
                    <div className="space-y-2">
                      {savedScenarios.map((s) => {
                        const dEq    = (s.founderPct - founderPct).toFixed(1);
                        const dPref  = (s.totalPref  - totalPref).toFixed(1);
                        const dP100  = (s.founderPayout100 - live.founderPayout100).toFixed(1);
                        const dSeats = s.vcSeats - live.vcSeats;
                        const fmt = (n: string, unit: string) => {
                          const v = parseFloat(n);
                          const sign = v > 0 ? "+" : "";
                          const cls = v > 0 ? "text-emerald-600" : v < 0 ? "text-red-600" : "text-muted-foreground";
                          return <span className={cls}>{sign}{n}{unit}</span>;
                        };
                        return (
                          <div key={s.name} className="flex items-start gap-3 text-xs border-b pb-2 last:border-0 last:pb-0">
                            <span className="font-semibold w-28 shrink-0 mt-0.5">{s.name}</span>
                            <div className="flex flex-wrap gap-x-4 gap-y-1">
                              <span>Founder equity {fmt(dEq, "pp")}</span>
                              <span>Pref overhang {fmt(dPref, "M")}</span>
                              <span>VC seats {fmt(String(dSeats), "")}</span>
                              <span>Take-home @$100M {fmt(dP100, "M")}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                )}

                {/* Comparison table */}
                <Card className="p-4">
                  <div className="font-semibold text-sm mb-3">Side-by-Side Metrics</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="border-b text-xs uppercase text-muted-foreground">
                          <th className="text-left py-2 pr-3">Metric</th>
                          {cols.map((c, i) => (
                            <th
                              key={c.name}
                              className={cn(
                                "text-right py-2 px-2 whitespace-nowrap",
                                i === cols.length - 1 && "text-primary",
                              )}
                            >
                              {c.name}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => {
                          const best  = r.hib !== null ? (r.hib  ? maxOf(r.key) : minOf(r.key)) : -1;
                          const worst = r.hib !== null ? (!r.hib ? maxOf(r.key) : minOf(r.key)) : -1;
                          return (
                            <tr key={r.label} className="border-b last:border-0 hover:bg-muted/30">
                              <td className="py-2 pr-3 font-semibold whitespace-nowrap text-xs">{r.label}</td>
                              {cols.map((c, i) => {
                                const val = Number(c[r.key]);
                                return (
                                  <td
                                    key={c.name + r.label}
                                    className={cn(
                                      "py-2 px-2 text-right",
                                      r.hib !== null && cellCls(val, best, worst, r.hib!),
                                      i === cols.length - 1 && "border-l border-primary/20",
                                    )}
                                  >
                                    {r.fmt(val)}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                        <tr className="border-b last:border-0 hover:bg-muted/30">
                          <td className="py-2 pr-3 font-semibold whitespace-nowrap text-xs">Board Control</td>
                          {cols.map((c, i) => (
                            <td
                              key={c.name + "board"}
                              className={cn(
                                "py-2 px-2 text-right text-xs",
                                c.boardStatus === "Founder-ctrl" ? "text-emerald-700 font-bold"
                                  : c.boardStatus === "Tied" ? "text-amber-700 font-bold"
                                  : "text-red-700 font-bold",
                                i === cols.length - 1 && "border-l border-primary/20",
                              )}
                            >
                              {c.boardStatus}
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                    <span><span className="text-emerald-600 font-bold">Green</span> = best value across scenarios</span>
                    <span><span className="text-red-600 font-bold">Red</span> = worst value</span>
                    <span><span className="text-primary font-bold">★ Current</span> = live (unsaved) scenario</span>
                  </div>
                </Card>
              </>
            );
          })()}
        </TabsContent>

        {/* ── EXIT ── */}
        <TabsContent value="outcomes" className="space-y-3 mt-4 border-t border-border pt-6">

          {/* Controls */}
          <Card className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold text-sm text-foreground">Exit Waterfall Modeller</div>
              <div className="text-xs text-muted-foreground">{isUS ? "Delaware waterfall" : "India SHA waterfall"}</div>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Drag the slider to model any exit. Toggle preferences to see the real vs. naive payout split.
            </p>
            <div className="flex items-center gap-1.5 mb-1">
              <Label className="text-xs font-semibold">Exit / Acquisition Value</Label>
            </div>
            <div className="flex items-center gap-3 mt-1">
              <Slider
                min={1} max={500} step={1}
                value={[state.exitValue]}
                disabled={readOnly}
                onValueChange={(v) => onChange({ ...state, exitValue: v[0] })}
                className="flex-1"
              />
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">$</span>
                <Input
                  type="number"
                  value={state.exitValue}
                  disabled={readOnly}
                  onChange={(e) => onChange({ ...state, exitValue: parseFloat(e.target.value) || 0 })}
                  className="w-20 h-8 text-sm"
                />
                <span className="text-xs text-muted-foreground">M</span>
              </div>
            </div>
            <div className="flex items-center gap-3 mt-3 p-2.5 bg-muted/50 rounded-md">
              <Switch checked={state.usePref} disabled={readOnly} onCheckedChange={(v) => onChange({ ...state, usePref: v })} />
              <div>
                <Label className="text-xs font-semibold">Apply liquidation preferences</Label>
                <p className="text-xs text-muted-foreground">Off = naive pro-rata split. On = VCs paid first per SHA waterfall.</p>
              </div>
            </div>
            {state.exitValue <= totalPref && state.usePref && totalPref > 0 && (
              <div className="mt-3 p-2.5 rounded-md bg-red-500/10 border border-red-500/30 text-xs text-red-700 font-semibold">
                ⚠️ Exit {fmtM(state.exitValue)} is below the {fmtM(totalPref)} liquidation preference stack — founders receive $0. Need at least {fmtM(totalPref + 0.1)} for any founder payout.
              </div>
            )}
          </Card>

          {/* Key metrics row */}
          {(() => {
            const noPrefs = founderPayouts(latest, state.exitValue, false, false, {}, true);
            const withPrefs = founderPayouts(latest, state.exitValue, true, false, {}, true);
            const noPrefsTotal = noPrefs.reduce((s, f) => s + f.payout, 0);
            const withPrefsTotal = withPrefs.reduce((s, f) => s + f.payout, 0);
            const prefCost = noPrefsTotal - withPrefsTotal;
            const vcReturnMult = totalInvested > 0 ? (vcTotal / totalInvested).toFixed(2) + "×" : "—";
            return (
              <div className="grid grid-cols-2 gap-3">
                <Card className="p-3">
                  <div className="text-xs uppercase text-muted-foreground font-semibold">Founders Take-Home</div>
                  <div className="text-xl font-extrabold mt-1 text-primary">{fmtM(founderTotal)}</div>
                  <div className="text-xs text-muted-foreground">at {fmtM(state.exitValue)} exit · {founderTotal > 0 ? ((founderTotal / state.exitValue) * 100).toFixed(0) + "% of proceeds" : "below pref floor"}</div>
                </Card>
                <Card className="p-3">
                  <div className="text-xs uppercase text-muted-foreground font-semibold">VC Return</div>
                  <div className="text-xl font-extrabold mt-1">{vcReturnMult}</div>
                  <div className="text-xs text-muted-foreground">{fmtM(totalInvested)} invested · {fmtM(vcTotal)} returned</div>
                </Card>
                <Card className="p-3">
                  <div className="text-xs uppercase text-muted-foreground font-semibold">Pref Overhang</div>
                  <div className="text-xl font-extrabold mt-1">{fmtM(state.usePref ? totalPref : 0)}</div>
                  <div className="text-xs text-muted-foreground">{state.usePref ? "paid before any founder dollar" : "preferences off"}</div>
                </Card>
                <Card className="p-3">
                  <div className="text-xs uppercase text-muted-foreground font-semibold">Pref Cost to Founders</div>
                  <div className={cn("text-xl font-extrabold mt-1", prefCost > 0 ? "text-red-600" : "text-emerald-600")}>
                    {prefCost > 0 ? "-" : ""}{fmtM(prefCost)}
                  </div>
                  <div className="text-xs text-muted-foreground">vs. no-preference scenario</div>
                </Card>
              </div>
            );
          })()}

          {/* Exit scenarios at a glance */}
          {anyRoundsEnabled && (() => {
            const presets = [25, 50, 100, 200, 500];
            return (
              <Card className="p-4">
                <div className="font-semibold text-sm mb-1">Exit Scenarios at a Glance</div>
                <p className="text-xs text-muted-foreground mb-3">Founder total and VC return multiple at five benchmark exit values. {state.usePref ? "Liquidation preferences applied." : "No preferences applied."}</p>
                <div className="grid grid-cols-5 gap-2">
                  {presets.map((ev) => {
                    const ap = calcPayouts(latest, ev, state.usePref);
                    const fp2 = founderPayouts(latest, ev, state.usePref, state.vestingEnabled ?? false, state.vesting ?? {}, state.accelerationAtExit ?? true);
                    const fTot = fp2.reduce((s, f) => s + f.payout, 0);
                    const vcTot = latest.holders.filter((h) => h.type === "vc" || h.type === "safe").reduce((s, h) => s + (ap[h.name] || 0), 0);
                    const mult = totalInvested > 0 ? (vcTot / totalInvested).toFixed(1) + "×" : "—";
                    const isCurrent = ev === state.exitValue;
                    const belowPref = state.usePref && ev <= totalPref && totalPref > 0;
                    return (
                      <button
                        key={ev}
                        onClick={() => onChange({ ...state, exitValue: ev })}
                        className={cn(
                          "flex flex-col items-center p-2.5 rounded-lg border text-center transition-colors",
                          isCurrent ? "border-primary bg-primary/8" : "border-border hover:border-primary/40",
                        )}
                      >
                        <div className={cn("text-xs font-bold", isCurrent ? "text-primary" : "text-foreground")}>${ev}M</div>
                        <div className={cn("text-base font-extrabold mt-1", belowPref ? "text-red-500" : "text-foreground")}>
                          {belowPref ? "$0" : fmtM(fTot)}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">founders</div>
                        <div className="text-xs font-semibold text-muted-foreground mt-1">{mult}</div>
                        <div className="text-xs text-muted-foreground">VC return</div>
                      </button>
                    );
                  })}
                </div>
              </Card>
            );
          })()}

          {/* Payout waterfall line chart */}
          {anyRoundsEnabled && (() => {
            const exitPoints = [0, 10, 20, 30, 40, 50, 75, 100, 125, 150, 200, 300, 500].filter((v) => v <= Math.max(state.exitValue * 2, 200));
            if (exitPoints[exitPoints.length - 1] < state.exitValue) exitPoints.push(state.exitValue);
            const wfData = exitPoints.map((ev) => {
              const ap = calcPayouts(latest, ev, state.usePref);
              const fp2 = founderPayouts(latest, ev, state.usePref, state.vestingEnabled ?? false, state.vesting ?? {}, state.accelerationAtExit ?? true);
              const fTot = parseFloat(fp2.reduce((s, f) => s + f.payout, 0).toFixed(2));
              const vcTot = parseFloat(latest.holders.filter((h) => h.type === "vc" || h.type === "safe").reduce((s, h) => s + (ap[h.name] || 0), 0).toFixed(2));
              const apNoPref = calcPayouts(latest, ev, false);
              const fp2NP = founderPayouts(latest, ev, false, false, {}, true);
              const fNoPref = parseFloat(fp2NP.reduce((s, f) => s + f.payout, 0).toFixed(2));
              return { exit: ev, Founders: fTot, VCs: vcTot, "No-pref (founders)": fNoPref };
            });
            return (
              <Card className="p-4">
                <div className="font-semibold text-sm mb-1">Payout Curve</div>
                <p className="text-xs text-muted-foreground mb-4">
                  How founder and VC payouts grow with exit size.
                  {state.usePref && totalPref > 0 && ` Founders receive $0 until exit exceeds the ${fmtM(totalPref)} preference stack.`}
                </p>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={wfData} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="exit" tick={{ fontSize: 10 }} tickFormatter={(v) => "$" + v + "M"} />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => "$" + v + "M"} />
                      <RechartsTooltip formatter={(v: number) => "$" + v + "M"} labelFormatter={(v) => "Exit: $" + v + "M"} />
                      <Legend wrapperStyle={{ fontSize: "10px" }} />
                      <ReferenceLine x={state.exitValue} stroke="#94a3b8" strokeDasharray="4 2" label={{ value: "Now", position: "top", fontSize: 9, fill: "#64748b" }} />
                      {state.usePref && totalPref > 0 && (
                        <ReferenceLine x={totalPref} stroke="#ef4444" strokeDasharray="3 2" label={{ value: "Pref floor", position: "insideTopLeft", fontSize: 9, fill: "#ef4444" }} />
                      )}
                      <Line type="monotone" dataKey="Founders" stroke="#4361ee" strokeWidth={2.5} dot={false} />
                      <Line type="monotone" dataKey="VCs" stroke="#e17055" strokeWidth={2} dot={false} />
                      {state.usePref && totalPref > 0 && (
                        <Line type="monotone" dataKey="No-pref (founders)" stroke="#4361ee" strokeWidth={1.5} strokeDasharray="5 3" dot={false} opacity={0.4} />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                {state.usePref && totalPref > 0 && (
                  <div className="mt-2 text-xs text-muted-foreground">Dashed blue = founders without preferences. Gap between solid and dashed = what VCs' liquidation preferences cost you.</div>
                )}
              </Card>
            );
          })()}

          {/* Individual payouts */}
          <Card className="p-4">
            <div className="font-semibold text-sm mb-3">Individual Payouts at {fmtM(state.exitValue)}</div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-xs uppercase text-muted-foreground">
                  <th className="text-left py-1.5 pr-2">Name</th>
                  <th className="text-left py-1.5 pr-2">Role</th>
                  <th className="text-right py-1.5 pr-2">Equity</th>
                  <th className="text-right py-1.5">Payout</th>
                  {state.vestingEnabled && <th className="text-right py-1.5 pl-2">Vesting</th>}
                </tr>
              </thead>
              <tbody>
                {fPayouts.map((f) => {
                  const vestedPct = Math.round(f.vestedFraction * 100);
                  const accelerated = state.accelerationAtExit ?? true;
                  const h = latest.holders.find((x) => x.name === f.name);
                  return (
                    <tr key={f.name} className="border-b last:border-0">
                      <td className="py-2 pr-2 font-semibold" style={{ color: HOLDER_COLORS[f.name] }}>{f.name}</td>
                      <td className="py-2 pr-2 text-muted-foreground">{f.role}</td>
                      <td className="py-2 pr-2 text-right">{h ? h.pct.toFixed(1) + "%" : "—"}</td>
                      <td className="py-2 text-right font-bold">{fmtM(f.payout)}</td>
                      {state.vestingEnabled && (
                        <td className="py-2 pl-2 text-right">
                          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold"
                            style={{ backgroundColor: accelerated ? "#dcfce7" : vestedPct < 50 ? "#fee2e2" : "#fef9c3", color: accelerated ? "#16a34a" : vestedPct < 50 ? "#dc2626" : "#92400e" }}>
                            {accelerated ? "⚡ Accel." : `${vestedPct}%`}
                          </span>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {latest.holders.filter((h) => h.type === "vc" || h.type === "safe").map((h) => {
                  const payout = allPayouts[h.name] || 0;
                  if (payout === 0 && !anyRoundsEnabled) return null;
                  const rd = latest.roundData.find((r) => r.vcName === h.name);
                  const mult = rd && rd.investment > 0 ? (payout / rd.investment).toFixed(1) + "×" : "—";
                  return (
                    <tr key={h.name} className="border-b last:border-0 bg-muted/20">
                      <td className="py-2 pr-2 font-semibold text-muted-foreground">{h.name}</td>
                      <td className="py-2 pr-2 text-muted-foreground text-xs">Investor</td>
                      <td className="py-2 pr-2 text-right text-muted-foreground">{h.pct.toFixed(1)}%</td>
                      <td className="py-2 text-right font-bold text-muted-foreground">{fmtM(payout)}</td>
                      {state.vestingEnabled && <td className="py-2 pl-2 text-right text-muted-foreground">{mult}</td>}
                    </tr>
                  );
                }).filter(Boolean)}
              </tbody>
            </table>
          </Card>

          {/* Per-round VC return breakdown */}
          {latest.roundData.filter((r) => r.type === "vc").length > 0 && (
            <Card className="p-4">
              <div className="font-semibold text-sm mb-3">VC Round Returns at {fmtM(state.exitValue)}</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-xs uppercase text-muted-foreground">
                      <th className="text-left py-1.5 pr-3">Investor</th>
                      <th className="text-right py-1.5 px-2">Invested</th>
                      <th className="text-right py-1.5 px-2">Pref (1st dollar)</th>
                      <th className="text-right py-1.5 px-2">Payout</th>
                      <th className="text-right py-1.5 pl-2">Return</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latest.roundData.filter((r) => r.type === "vc").map((r) => {
                      const payout = allPayouts[r.vcName] || 0;
                      const mult = r.investment > 0 ? payout / r.investment : 0;
                      const pref = r.investment * r.prefMult;
                      return (
                        <tr key={r.vcName} className="border-b last:border-0">
                          <td className="py-2 pr-3 font-semibold">{r.vcName}</td>
                          <td className="py-2 px-2 text-right">{fmtM(r.investment)}</td>
                          <td className="py-2 px-2 text-right text-muted-foreground">
                            {r.prefMult > 1 ? <span className="text-red-600 font-semibold">{fmtM(pref)} ({r.prefMult}×)</span> : fmtM(pref)}
                          </td>
                          <td className="py-2 px-2 text-right font-bold">{fmtM(payout)}</td>
                          <td className={cn("py-2 pl-2 text-right font-bold", mult >= 3 ? "text-emerald-600" : mult >= 1 ? "text-foreground" : "text-red-600")}>
                            {mult.toFixed(1)}×
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {isUS ? "Return = payout ÷ investment. VCs targeting 3× fund-level returns need individual deals at 5–10×." : "Return = payout ÷ investment. India VCs typically target 5–8× on individual investments to hit 3× fund-level returns."}
              </div>
            </Card>
          )}

          {/* Redemption Risk Timeline */}
          {hasRedemption && (
            <Card className="p-4">
              <div className="font-semibold text-sm mb-1">Redemption Risk Timeline</div>
              <p className="text-xs text-muted-foreground mb-3">
                Investors with redemption rights can force the company to buy back their shares after the trigger period — regardless of exit readiness.
              </p>
              <div className="space-y-2 mb-4">
                {redemptionItems.map((item) => (
                  <div key={item.roundKey} className="flex items-center justify-between p-2.5 rounded-md border border-orange-300/60 bg-orange-50/50 dark:bg-orange-950/20">
                    <div>
                      <div className="text-xs font-semibold">{item.label} VC</div>
                      <div className="text-xs text-muted-foreground">Triggers {item.years} years post-close · {item.mult}× cost</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold text-orange-700 dark:text-orange-400">{fmtM(item.liability)}</div>
                      <div className="text-xs text-muted-foreground">cash demand</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="p-2.5 rounded-md bg-muted/60">
                  <div className="text-xs uppercase text-muted-foreground font-semibold">Total Cash Demand</div>
                  <div className="text-lg font-extrabold text-orange-700 dark:text-orange-400">{fmtM(totalRedemptionLiability)}</div>
                  <div className="text-xs text-muted-foreground">if all redemptions triggered</div>
                </div>
                <div className="p-2.5 rounded-md bg-muted/60">
                  <div className="text-xs uppercase text-muted-foreground font-semibold">vs. Modelled Exit</div>
                  <div className={cn("text-lg font-extrabold", totalRedemptionLiability > state.exitValue * 0.5 ? "text-red-600" : "text-foreground")}>
                    {state.exitValue > 0 ? ((totalRedemptionLiability / state.exitValue) * 100).toFixed(0) + "% of exit" : "—"}
                  </div>
                  <div className="text-xs text-muted-foreground">at {fmtM(state.exitValue)}</div>
                </div>
              </div>
              <div className="p-2.5 rounded-md bg-orange-500/8 border border-orange-500/20 text-xs text-orange-900 dark:text-orange-300 space-y-1">
                <div className="font-semibold">Negotiation lever:</div>
                <div>
                  {isUS
                    ? "NVCA Model Documents (post-2015) omit redemption rights entirely. If a VC insists, counter with: 1× cost cap, 75% preferred approval to trigger, 3-year installment buyout, and automatic expiry on IPO filing. Most US VCs will accept."
                    : "Companies Act 2013 §68 restricts repurchases to companies with distributable profits and free reserves. Contractual redemption rights don't override statutory constraints — use this as leverage. Counter: 1× cost cap, board + majority preferred approval, triggered only on IPO failure after year 7, payable in installments over 3 years."}
                </div>
              </div>
            </Card>
          )}

        </TabsContent>
      </Tabs>

      {/* ── Mobile bottom tab bar (md:hidden) ────────────────────────────── */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 md:hidden border-t"
        style={{ background: "oklch(0.22 0.04 265)", borderColor: "oklch(0.76 0.15 285 / 0.25)" }}>
        <div className="flex overflow-x-auto scrollbar-none">
          {([
            { value: "setup",     Icon: Users,        label: "Setup" },
            { value: "rounds",    Icon: Settings2,    label: "Rounds" },
            { value: "outcomes",  Icon: PieChartIcon, label: "Outcomes" },
            { value: "negotiate", Icon: Shield,       label: "Negotiate" },
            { value: "compare",   Icon: BarChart3,    label: "Compare" },
          ] as const).map((tab) => {
            const isActive = activeTab === tab.value;
            return (
              <button
                key={tab.value}
                onClick={() => setActiveTab(tab.value)}
                className="flex-1 min-w-[60px] flex flex-col items-center justify-center gap-0.5 py-2.5 px-1 transition-all"
                style={{
                  color: isActive ? "oklch(0.76 0.15 285)" : "rgba(255,255,255,0.45)",
                  borderTop: isActive ? "2px solid oklch(0.76 0.15 285)" : "2px solid transparent",
                }}
              >
                <tab.Icon className="h-[18px] w-[18px]" />
                <span className="text-xs font-medium tracking-tight whitespace-nowrap">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* ── Export Modal ─────────────────────────────────────────────── */}
      {showExport && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setShowExport(false)}>
          <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-background border shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <div className="font-semibold text-sm text-foreground">Export Report</div>
              <button onClick={() => setShowExport(false)} className="text-muted-foreground hover:text-foreground text-lg font-bold leading-none">×</button>
            </div>
            <div className="p-5 space-y-4">
              {/* Preview card */}
              <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-bold text-base" style={{ color: "oklch(0.22 0.04 265)" }}>{state.companyName || "Your Company"}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Equity Scenario Report · {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</div>
                  </div>
                  <div className="text-xs font-semibold px-2 py-1 rounded-full" style={{ background: "oklch(0.22 0.04 265)", color: "white" }}>
                    {isUS ? "🇺🇸 US" : "🇮🇳 India"}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-1">
                  <div className="rounded-lg bg-white border p-2 text-center">
                    <div className="text-lg font-extrabold" style={{ color: "oklch(0.22 0.04 265)" }}>{founderPct.toFixed(1)}%</div>
                    <div className="text-xs text-muted-foreground">Founder equity</div>
                  </div>
                  <div className="rounded-lg bg-white border p-2 text-center">
                    <div className="text-lg font-extrabold" style={{ color: "oklch(0.22 0.04 265)" }}>{fmtM(perFounderAmt)}</div>
                    <div className="text-xs text-muted-foreground">Per founder @exit</div>
                  </div>
                  <div className="rounded-lg bg-white border p-2 text-center">
                    <div className="text-lg font-extrabold" style={{ color: "oklch(0.22 0.04 265)" }}>{roundsEnabledCount}</div>
                    <div className="text-xs text-muted-foreground">Rounds modelled</div>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">Includes: cap table · round terms · exit waterfall · playbook actions</div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const co = state.companyName || "YourCompany";
                    const dateStr = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
                    const holderColors: Record<string, string> = {
                      founder: "#4361ee", esop: "#4cc9f0", advisory: "#90be6d", vc: "#e17055", safe: "#f59e0b"
                    };
                    const navyHex = "#1e2235";

                    let capRows = founders.map(h =>
                      `<tr><td>${h.name}</td><td style="color:#666">${h.role}</td><td style="text-align:right;font-weight:700">${h.pct.toFixed(1)}%</td><td style="text-align:right"><div style="height:6px;background:#4361ee;border-radius:3px;width:${Math.max(4, h.pct * 2)}px;margin-left:auto"></div></td></tr>`
                    ).join("");

                    let roundRows = enabledRounds.map(k => {
                      const r = state.rounds[k as RoundKey];
                      const snap = snaps[k];
                      const vcHolder = snap?.holders.find(h => h.type === "vc");
                      const dilPct = vcHolder ? vcHolder.pct.toFixed(1) + "%" : "—";
                      return `<tr>
                        <td style="font-weight:600">${ROUND_LABELS[k as RoundKey]}</td>
                        <td>$${r.raise}M @ $${r.preMoney}M pre</td>
                        <td style="text-align:right">${dilPct} VC stake</td>
                        <td style="text-align:right">${r.prefMult}× ${r.prefType === "part" ? "part." : "non-part."}</td>
                        <td style="text-align:right;color:${r.antiDilution === "full-ratchet" ? "#e74c3c" : "#27ae60"}">${r.antiDilution}</td>
                      </tr>`;
                    }).join("");

                    let postRows = anyRoundsEnabled ? latest.holders.map(h =>
                      `<tr><td>${h.name}</td><td style="text-align:right;font-weight:700">${h.pct.toFixed(1)}%</td><td><div style="height:8px;background:${holderColors[h.type] || "#999"};border-radius:4px;width:${Math.max(4, h.pct * 3)}px"></div></td></tr>`
                    ).join("") : "";

                    let playbookRows = recommendations.map(r => {
                      const bg = r.priority === "critical" ? "#fff5f5" : r.priority === "high" ? "#fffbeb" : "#f0fdf4";
                      const border = r.priority === "critical" ? "#e74c3c" : r.priority === "high" ? "#f59e0b" : "#27ae60";
                      return `<div style="border-left:3px solid ${border};background:${bg};border-radius:0 8px 8px 0;padding:10px 12px;margin-bottom:8px">
                        <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">
                          <span style="font-size:10px;font-weight:700;text-transform:uppercase;color:${border}">${r.priority}</span>
                          <span style="font-size:10px;color:#888">· ${r.timing}</span>
                        </div>
                        <div style="font-weight:600;font-size:12px;margin-bottom:4px">${r.action}</div>
                        <div style="font-size:11px;color:#555;line-height:1.5">${r.why}</div>
                        <div style="font-size:11px;color:#333;margin-top:6px"><strong>Next step:</strong> ${r.nextStep}</div>
                      </div>`;
                    }).join("");

                    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
                      <title>${co} — EquiCompass Report</title>
                      <style>
                        * { box-sizing: border-box; margin: 0; padding: 0; }
                        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a2e; background: #fff; padding: 32px; }
                        @media print { body { padding: 0; } .no-print { display: none; } }
                        .cover { background: linear-gradient(135deg, ${navyHex} 0%, #2d3561 100%); color: white; border-radius: 12px; padding: 32px; margin-bottom: 24px; }
                        .cover h1 { font-size: 28px; font-weight: 800; }
                        .cover .sub { font-size: 13px; opacity: 0.65; margin-top: 4px; }
                        .cover .pills { display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; }
                        .cover .pill { background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.2); border-radius: 20px; padding: 4px 12px; font-size: 12px; font-weight: 600; }
                        .stats { display: grid; grid-template-columns: repeat(3,1fr); gap: 12px; margin-bottom: 24px; }
                        .stat { background: #f8f9ff; border: 1px solid #e8ecff; border-radius: 10px; padding: 16px; text-align: center; }
                        .stat .val { font-size: 26px; font-weight: 800; color: ${navyHex}; }
                        .stat .lbl { font-size: 11px; color: #888; margin-top: 2px; }
                        h2 { font-size: 15px; font-weight: 700; color: ${navyHex}; margin: 20px 0 10px; padding-bottom: 6px; border-bottom: 2px solid #eef0ff; }
                        table { width: 100%; border-collapse: collapse; font-size: 12px; }
                        th { text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase; color: #888; padding: 6px 8px; border-bottom: 1px solid #eee; }
                        td { padding: 7px 8px; border-bottom: 1px solid #f4f4f4; }
                        tr:last-child td { border-bottom: none; }
                        .badge { display: inline-block; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 20px; }
                        .footer { margin-top: 32px; font-size: 10px; color: #aaa; text-align: center; border-top: 1px solid #eee; padding-top: 12px; }
                        .section { background: #fafbff; border: 1px solid #e8ecff; border-radius: 10px; padding: 16px; margin-bottom: 16px; }
                      </style></head><body>
                      <div class="cover">
                        <h1>${co}</h1>
                        <div class="sub">EquiCompass Equity Scenario Report · ${dateStr}</div>
                        <div class="pills">
                          <span class="pill">${isUS ? "🇺🇸 United States" : "🇮🇳 India"}</span>
                          ${anyRoundsEnabled ? `<span class="pill">${roundsEnabledCount} round${roundsEnabledCount === 1 ? "" : "s"} modelled</span>` : ""}
                          ${state.safe.enabled ? '<span class="pill">SAFE included</span>' : ""}
                          <span class="pill">Exit @ ${fmtM(state.exitValue)}</span>
                        </div>
                      </div>
                      <div class="stats">
                        <div class="stat"><div class="val">${founderPct.toFixed(1)}%</div><div class="lbl">Founder equity (post-funding)</div></div>
                        <div class="stat"><div class="val">${fmtM(perFounderAmt)}</div><div class="lbl">Per-founder take-home @ exit</div></div>
                        <div class="stat"><div class="val">${totalInvested > 0 ? (vcTotal / totalInvested).toFixed(1) + "×" : "—"}</div><div class="lbl">VC return multiple</div></div>
                      </div>
                      <div class="section">
                        <h2>Pre-funding Cap Table</h2>
                        <table><thead><tr><th>Name</th><th>Role</th><th style="text-align:right">Equity</th><th></th></tr></thead>
                        <tbody>${capRows}</tbody></table>
                      </div>
                      ${anyRoundsEnabled ? `
                      <div class="section">
                        <h2>Funding Rounds</h2>
                        <table><thead><tr><th>Round</th><th>Terms</th><th style="text-align:right">VC Stake</th><th style="text-align:right">Preference</th><th style="text-align:right">Anti-dil</th></tr></thead>
                        <tbody>${roundRows}</tbody></table>
                      </div>
                      <div class="section">
                        <h2>Post-funding Cap Table</h2>
                        <table><thead><tr><th>Holder</th><th style="text-align:right">Equity</th><th></th></tr></thead>
                        <tbody>${postRows}</tbody></table>
                      </div>
                      <div class="section">
                        <h2>Exit Analysis @ ${fmtM(state.exitValue)}</h2>
                        <table><tbody>
                          <tr><td>Total founder proceeds</td><td style="text-align:right;font-weight:700">${fmtM(founderTotal)}</td></tr>
                          <tr><td>Per-founder payout (equal split)</td><td style="text-align:right;font-weight:700">${fmtM(perFounderAmt)}</td></tr>
                          <tr><td>VC proceeds</td><td style="text-align:right">${fmtM(vcTotal)}</td></tr>
                          <tr><td>Total invested by VCs</td><td style="text-align:right">${fmtM(totalInvested)}</td></tr>
                          <tr><td>VC return multiple</td><td style="text-align:right;font-weight:700">${totalInvested > 0 ? (vcTotal / totalInvested).toFixed(2) + "×" : "—"}</td></tr>
                          <tr><td>Liquidation overhang</td><td style="text-align:right;color:${totalPref > state.exitValue * 0.3 ? "#e74c3c" : "#27ae60"}">${fmtM(totalPref)}</td></tr>
                          ${hasRedemption ? `<tr><td>Redemption liability</td><td style="text-align:right;color:#e74c3c">${fmtM(totalRedemptionLiability)}</td></tr>` : ""}
                        </tbody></table>
                      </div>` : ""}
                      ${recommendations.length > 0 ? `
                      <h2>Playbook — Priority Actions</h2>
                      ${playbookRows}` : ""}
                      <div class="footer">Generated by EquiCompass · equicompass.capstack.workers.dev · For planning purposes only — not legal advice.</div>
                      <button class="no-print" onclick="window.print()" style="position:fixed;bottom:20px;right:20px;background:${navyHex};color:white;border:none;border-radius:8px;padding:10px 20px;font-weight:700;cursor:pointer;font-size:13px">🖨 Print / Save PDF</button>
                    </body></html>`;

                    const win = window.open("", "_blank");
                    if (win) { win.document.write(html); win.document.close(); }
                  }}
                  className="flex-1 rounded-lg text-white px-3 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity"
                  style={{ background: "oklch(0.22 0.04 265)" }}
                >
                  📄 Open PDF Report
                </button>
              </div>
              <p className="text-xs text-muted-foreground text-center">Opens in a new tab · Print → Save as PDF</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
