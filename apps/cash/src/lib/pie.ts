import type { PieSlice } from './types';

const CENTRE = 104;
const RADIUS = 96;
const HOLE = 60;

// An annular sector from angle a0 to a1, clockwise from noon (arcPath of the demo).
export function arcPath(R: number, r: number, a0: number, a1: number): string {
  const point = (radius: number, angle: number) => `${(CENTRE + radius * Math.sin(angle)).toFixed(2)} ${(CENTRE - radius * Math.cos(angle)).toFixed(2)}`;
  if (a1 - a0 >= Math.PI * 2 - 1e-6) return arcPath(R, r, a0, a0 + Math.PI) + arcPath(R, r, a0 + Math.PI, a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${point(R, a0)}A${R} ${R} 0 ${large} 1 ${point(R, a1)}L${point(r, a1)}A${r} ${r} 0 ${large} 0 ${point(r, a0)}Z`;
}

// The ring of the spending per envelope; slices come largest first. A selection that is not among
// them counts as none.
export function pieArcs(slices: PieSlice[], selected: string | null) {
  const total = slices.reduce((sum, slice) => sum + slice.amount, 0);
  const chosen = slices.some((slice) => slice.envelope === selected) ? selected : null;
  let angle = 0;
  const arcs = slices.map((slice) => {
    const start = angle;
    angle += (slice.amount / total) * Math.PI * 2;
    return {
      ...slice,
      path: arcPath(RADIUS, HOLE, start, angle),
      percent: Math.round((slice.amount / total) * 100),
      dimmed: chosen !== null && chosen !== slice.envelope,
    };
  });
  return { total, arcs, selected: arcs.find((arc) => arc.envelope === chosen) ?? null };
}
