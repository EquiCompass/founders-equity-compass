import { useState } from "react";
import type { PdfData } from "./PdfReport";
import { Button } from "@/components/ui/button";
import {
  computeSnaps,
  calcPayouts,
  founderPayouts,
  fmtM,
  fmtVal,
  latestSnap,
} from "@/lib/equity/calc";
import { type SimulatorState, ROUND_KEYS, ROUND_LABELS } from "@/lib/equity/types";

interface Props {
  state: SimulatorState;
  scenarioName: string;
}

export function ExportButton({ state, scenarioName }: Props) {
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    setLoading(true);
    try {
      // Lazy-load the PDF stack (~1.5MB) only when the user actually exports.
      const [{ pdf }, { PdfReport }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("./PdfReport"),
      ]);
      const snaps = computeSnaps(state);
      const latest = latestSnap(snaps);
      const snapKeys = Object.keys(snaps);

      const founderPct = latest.holders.filter((h) => h.type === "founder").reduce((s, h) => s + h.pct, 0);
      const vcPct = latest.holders.filter((h) => h.type === "vc" || h.type === "safe").reduce((s, h) => s + h.pct, 0);
      const founderSeats = state.founderSeats;
      const totalPref = (latest.roundData || []).filter((r) => r.type === "vc").reduce((s, r) => s + r.investment * r.prefMult, 0);

      // Risk signals
      const riskSignals: PdfData["riskSignals"] = [];
      if (latest.vcSeats >= founderSeats) {
        riskSignals.push({ tone: "red", text: `VCs hold ${latest.vcSeats} board seats — independent director decides all key votes` });
      } else {
        riskSignals.push({ tone: "green", text: `Founder-controlled board: ${founderSeats} vs ${latest.vcSeats} VC seats` });
      }
      if (founderPct < 26) riskSignals.push({ tone: "red", text: `Founders at ${founderPct.toFixed(1)}% — below 26%, VCs can block ALL major decisions` });
      else if (founderPct < 51) riskSignals.push({ tone: "orange", text: `Founders at ${founderPct.toFixed(1)}% — lost simple majority` });
      else if (founderPct < 75) riskSignals.push({ tone: "yellow", text: `Founders at ${founderPct.toFixed(1)}% — VCs have special resolution blocking power` });
      if (vcPct > 50) riskSignals.push({ tone: "red", text: `VCs combined at ${vcPct.toFixed(1)}% — can override founders on ordinary resolutions` });
      else if (vcPct > 26) riskSignals.push({ tone: "orange", text: `VCs at ${vcPct.toFixed(1)}% — can veto M&A, SHA changes, new share issuances` });
      if (totalPref > 0) {
        const ratio = state.exitValue > 0 ? totalPref / state.exitValue : 0;
        riskSignals.push({ tone: ratio > 0.5 ? "red" : ratio > 0.25 ? "orange" : "yellow", text: `${fmtM(totalPref)} liquidation overhang — founders receive $0 in any exit below this amount` });
      }

      // Recommendations
      const recs: PdfData["recommendations"] = [];
      if (latest.vcSeats >= founderSeats + 1) recs.push({ action: `CRITICAL: You have lost board control — VCs hold ${latest.vcSeats} seats vs your ${founderSeats}`, impact: "VCs can now remove the CEO, block acquisitions, and override strategy without founder consent", detail: "Push every round to observer-only except the lead investor. Negotiate founders nominate the independent director. Add unanimous board consent for CEO removal to the SHA." });
      if (latest.vcSeats === founderSeats && latest.vcSeats > 0) recs.push({ action: `Board is tied ${founderSeats}-${latest.vcSeats}: the independent director decides everything`, impact: "Whoever nominates the independent director effectively controls your company", detail: "Push for: founders have the right to nominate the independent director in the SHA." });
      recs.push({ action: "Protect control through board composition, not share classes", impact: "Institutional VCs won't accept founder super-voting shares pre-IPO — board math is the winnable battle", detail: "Keep co-investors to observer seats, nominate the independent director, and grow founder/independent seats whenever an investor seat is added." });
      if (state.rounds.a.enabled && state.rounds.a.board === "2") recs.push({ action: "Reduce Series A VC board seats from 2 to 1", impact: "Preserves founder board majority through Series B", detail: "2 VC seats at Series A plus 1 at Series B = founders tied with VCs." });
      const hasParticipating = ROUND_KEYS.some((k) => state.rounds[k].enabled && state.rounds[k].prefType === "part");
      if (hasParticipating) recs.push({ action: "Remove participating preferred — negotiate non-participating across all rounds", impact: "Participating preferred means VCs get money back AND share the remaining exit", detail: "Standard market rate is non-participating at every stage." });

      // Exit payouts
      const allPayouts = calcPayouts(latest, state.exitValue, state.usePref);
      const fPayouts = founderPayouts(
        latest,
        state.exitValue,
        state.usePref,
        state.vestingEnabled ?? false,
        state.vesting ?? {},
        state.accelerationAtExit ?? true,
      );
      const founderTotal = fPayouts.reduce((s, f) => s + f.payout, 0);
      const vcTotal = latest.holders.filter((h) => h.type === "vc" || h.type === "safe").reduce((s, h) => s + (allPayouts[h.name] || 0), 0);
      const rData = (latest.roundData || []).filter((r) => r.type === "vc");

      const payoutRows: PdfData["payouts"] = [...latest.holders]
        .sort((a, b) => b.pct - a.pct)
        .map((h) => {
          const payout = allPayouts[h.name] || 0;
          const pref = rData.find((r) => r.vcName === h.name);
          let note = "";
          if (pref) {
            const proRata = state.exitValue * h.pct / 100;
            note = pref.prefType === "non" ? (proRata > pref.investment * pref.prefMult ? "Converted to common" : "Kept preference") : "Participating pref";
          } else if (h.type === "safe") note = "Converted at Seed";
          return { name: h.name, role: h.role, payout: fmtM(payout), pctOfExit: (payout / state.exitValue * 100).toFixed(1) + "%", note };
        });

      // Board summary
      const boardRows: PdfData["boardRows"] = snapKeys.map((k) => {
        const snap = snaps[k];
        const total = founderSeats + 1 + snap.vcSeats;
        const fp = Math.round(founderSeats / total * 100);
        const vp = Math.round(snap.vcSeats / total * 100);
        const ip = 100 - fp - vp;
        const status = snap.vcSeats > founderSeats ? "VC-controlled" : snap.vcSeats === founderSeats && snap.vcSeats > 0 ? "Tied" : "Founder-controlled";
        return { round: snap.label, founderPct: fp, vcPct: vp, indPct: ip, status };
      });

      const boardStatusText = latest.vcSeats === 0 ? "Safe" : latest.vcSeats < founderSeats ? "Safe" : latest.vcSeats === founderSeats ? "Tied" : "Lost";
      const isUS = state.market === "us";
      const marketLabel = isUS ? "United States" : "India";

      const data: PdfData = {
        scenarioName,
        market: marketLabel,
        generatedAt: new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }),
        founderPct,
        vcPct,
        valuation: fmtVal(latest.valuation) || "—",
        boardStatus: boardStatusText,
        insightSummary: `Founders end with ${founderPct.toFixed(1)}% equity across ${snapKeys.filter(k => k !== "pre").length} round(s). At a ${fmtM(state.exitValue)} exit, founder total take-home is ${fmtM(founderTotal)}.`,
        riskSignals: riskSignals.slice(0, 6),
        capTable: [...latest.holders].sort((a, b) => b.pct - a.pct),
        boardRows,
        recommendations: recs,
        exitValue: fmtM(state.exitValue),
        payouts: payoutRows,
        founderTotal: fmtM(founderTotal),
        vcOverhang: fmtM(state.usePref ? totalPref : 0),
        disclaimer: isUS
          ? "For negotiation planning only. Not legal or financial advice. Consult a US startup attorney before signing any SHA or investment documents."
          : "For negotiation planning only. Not legal or financial advice. Consult a startup lawyer before signing any SHA.",
      };

      const blob = await pdf(<PdfReport data={data} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${scenarioName.replace(/\s+/g, "-").toLowerCase()}-equicompass.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("PDF export failed:", err);
      alert("PDF export failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      onClick={handleExport}
      disabled={loading}
      variant="outline"
      size="sm"
      className="gap-2"
    >
      {loading ? (
        <>
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Generating…
        </>
      ) : (
        <>📄 Export PDF</>
      )}
    </Button>
  );
}
