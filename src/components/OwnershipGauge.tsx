/**
 * OwnershipGauge — the EquiCompass signature element.
 * A radial dial showing founder ownership, with the statutory control
 * thresholds (51% majority, 26% blocking) marked on the ring.
 */
interface Props {
  /** Founder ownership percentage, 0–100 */
  pct: number;
  size?: number;
  label?: string;
}

const R = 62;
const CIRC = 2 * Math.PI * R;

function tick(angleDeg: number, inner: number, outer: number) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x1: 75 + inner * Math.cos(a),
    y1: 75 + inner * Math.sin(a),
    x2: 75 + outer * Math.cos(a),
    y2: 75 + outer * Math.sin(a),
  };
}

export function OwnershipGauge({ pct, size = 150, label = "FOUNDERS HOLD" }: Props) {
  const clamped = Math.max(0, Math.min(100, pct));
  const offset = CIRC * (1 - clamped / 100);
  const t51 = tick(360 * 0.51, 52, 72);
  const t26 = tick(360 * 0.26, 52, 72);
  const tone = clamped >= 51 ? "var(--success)" : clamped >= 26 ? "var(--warning)" : "var(--danger)";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 150 150"
      role="img"
      aria-label={`Founders hold ${clamped.toFixed(1)} percent`}
      style={{ filter: "drop-shadow(0 0 12px oklch(0.76 0.15 285 / 0.35))", flexShrink: 0 }}
    >
      <defs>
        <linearGradient id="eq-gauge-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="oklch(0.82 0.1 280)" />
          <stop offset="100%" stopColor="oklch(0.85 0.19 160)" />
        </linearGradient>
      </defs>
      {/* track */}
      <circle cx="75" cy="75" r={R} fill="none" stroke="oklch(1 0 0 / 0.08)" strokeWidth="11" />
      {/* value arc */}
      <circle
        cx="75" cy="75" r={R}
        fill="none"
        stroke="url(#eq-gauge-grad)"
        strokeWidth="11"
        strokeLinecap="round"
        strokeDasharray={CIRC}
        strokeDashoffset={offset}
        transform="rotate(-90 75 75)"
        style={{ transition: "stroke-dashoffset 0.6s ease" }}
      />
      {/* control thresholds */}
      <line {...t51} stroke="var(--danger)" strokeWidth="2" opacity="0.75" />
      <line {...t26} stroke="var(--warning)" strokeWidth="2" opacity="0.6" />
      <text x="75" y="70" textAnchor="middle" fill="currentColor" fontFamily="'Space Grotesk', sans-serif" fontSize="25" fontWeight="700">
        {clamped.toFixed(1)}%
      </text>
      <text x="75" y="89" textAnchor="middle" fill="var(--muted-foreground)" fontSize="9" letterSpacing="0.1em">
        {label}
      </text>
      <text x="75" y="103" textAnchor="middle" fill={tone} fontSize="8.5" fontWeight="600">
        {clamped >= 51 ? "MAJORITY HELD" : clamped >= 26 ? "BLOCKING RIGHTS ONLY" : "BELOW 26% — EXPOSED"}
      </text>
    </svg>
  );
}
