import { describe, expect, it } from "vitest";
import { calcPayouts, computeSnaps, founderPayouts, latestSnap, vestedFraction } from "./calc";
import {
  DEFAULT_STATE,
  INDIA_DEFAULT_ROUNDS,
  type SimulatorState,
} from "./types";

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

/** Default-ish state with chosen rounds enabled. */
function makeState(enable: Array<"preseed" | "seed" | "a" | "b" | "c">, patch?: Partial<SimulatorState>): SimulatorState {
  const s = clone(DEFAULT_STATE);
  s.rounds = clone(INDIA_DEFAULT_ROUNDS);
  for (const k of enable) s.rounds[k].enabled = true;
  return { ...s, ...patch };
}

const totalPct = (s: SimulatorState) =>
  latestSnap(computeSnaps(s)).holders.reduce((sum, h) => sum + h.pct, 0);

const payoutSum = (p: Record<string, number>) => Object.values(p).reduce((s, v) => s + v, 0);

describe("computeSnaps — cap table integrity", () => {
  it("sums to 100% with seed only", () => {
    expect(totalPct(makeState(["seed"]))).toBeCloseTo(100, 6);
  });

  it("sums to 100% with all five rounds", () => {
    expect(totalPct(makeState(["preseed", "seed", "a", "b", "c"]))).toBeCloseTo(100, 6);
  });

  it("sums to 100% with a SAFE converting at seed", () => {
    const s = makeState(["seed", "a"]);
    s.safe = { enabled: true, amount: 0.5, cap: 3, discount: 20, mfn: false };
    expect(totalPct(s)).toBeCloseTo(100, 6);
  });

  it("gives the VC exactly raise/post of the round it invests in", () => {
    const s = makeState(["seed"]); // 1.25 on 5 pre → 20% of 6.25 post
    const snap = latestSnap(computeSnaps(s));
    const vc = snap.holders.find((h) => h.name === "Seed VC")!;
    expect(vc.pct).toBeCloseTo(20, 6);
  });

  it("tops the ESOP pool up to the round target (post-money %)", () => {
    const s = makeState(["seed", "a"]); // A round targets 12%
    const snap = latestSnap(computeSnaps(s));
    const esop = snap.holders.find((h) => h.name === "ESOP Pool")!;
    expect(esop.pct).toBeCloseTo(12, 6);
  });

  it("ESOP top-up dilutes existing holders, not the incoming VC", () => {
    const sNoEsop = makeState(["a"]);
    sNoEsop.rounds.a.esop = 0;
    const sEsop = makeState(["a"]); // esop target 12
    const vcWithout = latestSnap(computeSnaps(sNoEsop)).holders.find((h) => h.name === "Series A VC")!;
    const vcWith = latestSnap(computeSnaps(sEsop)).holders.find((h) => h.name === "Series A VC")!;
    expect(vcWith.pct).toBeCloseTo(vcWithout.pct, 6);
  });

  it("detects a down round and applies BBWA boost to the protected VC", () => {
    const s = makeState(["seed", "a", "b"]);
    // A post = 24; make B a down round
    s.rounds.b.preMoney = 12;
    s.rounds.b.raise = 5;
    const snaps = computeSnaps(s);
    expect(snaps["b"].isDownRound).toBe(true);
    // BBWA-protected Series A VC must end up with MORE than it would without protection
    const sNoAd = clone(s);
    sNoAd.rounds.a.antiDilution = "none";
    const withAd = snaps["b"].holders.find((h) => h.name === "Series A VC")!.pct;
    const withoutAd = latestSnap(computeSnaps(sNoAd)).holders.find((h) => h.name === "Series A VC")!.pct;
    expect(withAd).toBeGreaterThan(withoutAd);
    expect(snaps["b"].holders.reduce((sum, h) => sum + h.pct, 0)).toBeCloseTo(100, 4);
  });

  it("full ratchet boosts the VC more than BBWA in the same down round", () => {
    const base = makeState(["seed", "a", "b"]);
    base.rounds.b.preMoney = 12;
    base.rounds.b.raise = 5;
    const bbwa = clone(base);
    bbwa.rounds.a.antiDilution = "bbwa";
    const ratchet = clone(base);
    ratchet.rounds.a.antiDilution = "full-ratchet";
    const vcPct = (s: SimulatorState) =>
      latestSnap(computeSnaps(s)).holders.find((h) => h.name === "Series A VC")!.pct;
    expect(vcPct(ratchet)).toBeGreaterThan(vcPct(bbwa));
  });

  it("never produces a negative holding, even in an extreme full-ratchet down round", () => {
    const s = makeState(["seed", "a", "b"]);
    s.rounds.a.antiDilution = "full-ratchet";
    s.rounds.b.preMoney = 1; // 96% down round vs A post of 24
    s.rounds.b.raise = 2;
    const snap = latestSnap(computeSnaps(s));
    for (const h of snap.holders) expect(h.pct).toBeGreaterThanOrEqual(0);
  });

  it("founder secondary moves pct from founders to the round VC", () => {
    const s = makeState(["a"]);
    s.rounds.a.secondary = 2; // $2M secondary out of $24M post
    const withSec = latestSnap(computeSnaps(s));
    const noSec = latestSnap(computeSnaps(makeState(["a"])));
    const fdr = (snap: typeof withSec) => snap.holders.filter((h) => h.type === "founder").reduce((x, h) => x + h.pct, 0);
    expect(fdr(withSec)).toBeLessThan(fdr(noSec));
    expect(withSec.holders.reduce((x, h) => x + h.pct, 0)).toBeCloseTo(100, 4);
  });
});

describe("calcPayouts — exit waterfall", () => {
  const snap = latestSnap(computeSnaps(makeState(["seed", "a"])));

  it("conserves the full exit value (pref on)", () => {
    for (const ev of [1, 3, 7, 30, 100, 1000]) {
      expect(payoutSum(calcPayouts(snap, ev, true))).toBeCloseTo(ev, 6);
    }
  });

  it("is a simple pro-rata split with pref off", () => {
    const p = calcPayouts(snap, 100, false);
    for (const h of snap.holders) expect(p[h.name]).toBeCloseTo(h.pct, 6);
  });

  it("VCs absorb everything when exit < total preference", () => {
    // total pref = 1.25 + 6 = 7.25
    const p = calcPayouts(snap, 5, true);
    expect(p["Founder 1"]).toBe(0);
    expect(p["Seed VC"] + p["Series A VC"]).toBeCloseTo(5, 6);
  });

  it("1x non-participating VC converts to common at a high exit", () => {
    const p = calcPayouts(snap, 200, true);
    const vc = snap.holders.find((h) => h.name === "Series A VC")!;
    expect(p["Series A VC"]).toBeCloseTo((200 * vc.pct) / 100, 4);
  });

  it("1x non-participating VC takes the preference at a low (but above-pref) exit", () => {
    // exit 8: A VC as-converted = 25% × 8 = 2 < 6 → takes pref 6
    const p = calcPayouts(snap, 8, true);
    expect(p["Series A VC"]).toBeCloseTo(6, 4);
  });

  it("participating preferred takes pref AND a share of the remainder", () => {
    const s = makeState(["a"]);
    s.rounds.a.prefType = "part";
    const sn = latestSnap(computeSnaps(s));
    const pPart = calcPayouts(sn, 50, true);
    const sNon = makeState(["a"]);
    const pNon = calcPayouts(latestSnap(computeSnaps(sNon)), 50, true);
    expect(pPart["Series A VC"]).toBeGreaterThan(pNon["Series A VC"]);
    expect(pPart["Founder 1"]).toBeLessThan(pNon["Founder 1"]);
    expect(payoutSum(pPart)).toBeCloseTo(50, 6);
  });

  it("a 2x multiple doubles the preference taken at a low exit", () => {
    const s = makeState(["a"]);
    s.rounds.a.prefMult = 2; // pref = 12
    const sn = latestSnap(computeSnaps(s));
    const p = calcPayouts(sn, 14, true);
    expect(p["Series A VC"]).toBeCloseTo(12, 4);
  });
});

describe("vesting", () => {
  it("vests nothing before the cliff", () => {
    expect(vestedFraction({ cliffMonths: 12, vestMonths: 48, elapsedMonths: 11 })).toBe(0);
  });

  it("vests the full cliff fraction at the cliff", () => {
    expect(vestedFraction({ cliffMonths: 12, vestMonths: 48, elapsedMonths: 12 })).toBeCloseTo(0.25, 6);
  });

  it("caps at 100%", () => {
    expect(vestedFraction({ cliffMonths: 12, vestMonths: 48, elapsedMonths: 60 })).toBe(1);
  });

  it("founderPayouts scales by vested fraction when acceleration is off", () => {
    const s = makeState(["a"]);
    const sn = latestSnap(computeSnaps(s));
    const vesting = { "Founder 1": { cliffMonths: 12, vestMonths: 48, elapsedMonths: 24 } };
    const accel = founderPayouts(sn, 100, true, true, vesting, true);
    const noAccel = founderPayouts(sn, 100, true, true, vesting, false);
    const f1a = accel.find((f) => f.name === "Founder 1")!;
    const f1n = noAccel.find((f) => f.name === "Founder 1")!;
    expect(f1n.payout).toBeCloseTo(f1a.payout * 0.5, 6);
  });
});
