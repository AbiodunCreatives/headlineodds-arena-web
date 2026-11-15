"use client";
import type { Point } from "@/lib/feed";

export default function Chart({ points, open, start, end, lockAt, now }: {
  points: Point[]; open: number | null; start: number; end: number; lockAt: number; now: number;
}) {
  const W = 340, H = 130, P = 6;
  const ps = points.length ? points.map((p) => p.p) : [open ?? 0];
  if (open) ps.push(open);
  let lo = Math.min(...ps), hi = Math.max(...ps);
  if (hi - lo < 20) { const m = (hi + lo) / 2; lo = m - 10; hi = m + 10; }
  const pad = (hi - lo) * 0.15; lo -= pad; hi += pad;
  const x = (t: number) => P + ((t - start) / (end - start)) * (W - 2 * P);
  const y = (p: number) => P + (1 - (p - lo) / (hi - lo)) * (H - 2 * P);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.p).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  const up = open && last ? last.p >= open : true;
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="BTC price this round">
      <rect x={x(lockAt)} y={0} width={x(end) - x(lockAt)} height={H} className="chart-lock" />
      {open ? (
        <>
          <line x1={P} x2={W - P} y1={y(open)} y2={y(open)} className="chart-open" />
          <text x={W - P - 2} y={y(open) - 4} textAnchor="end" className="chart-label">OPEN</text>
        </>
      ) : null}
      {d && <path d={d} className={up ? "chart-line up" : "chart-line down"} />}
      {last && <circle cx={x(Math.min(last.t, now))} cy={y(last.p)} r={4} className={up ? "dot up" : "dot down"} />}
      <text x={x(lockAt) + 3} y={H - 6} className="chart-label">LOCK</text>
    </svg>
  );
}
