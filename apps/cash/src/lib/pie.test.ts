import { describe, expect, it } from 'vitest';
import { pieArcs } from './pie';

const october = [
  { envelope: 'casa', name: 'Casa', slot: 1, amount: 85000 },
  { envelope: 'vacanze', name: 'Vacanze', slot: 4, amount: 64000 },
  { envelope: 'spesa', name: 'Spesa', slot: 2, amount: 5000 },
];

describe('pieArcs', () => {
  it('splits the ring by share, largest first from noon', () => {
    const pie = pieArcs(october, null);
    expect(pie.total).toBe(154000);
    expect(pie.arcs.map((arc) => [arc.envelope, arc.percent])).toEqual([['casa', 55], ['vacanze', 42], ['spesa', 3]]);
    expect(pie.arcs[0].path.startsWith('M104.00 8.00')).toBe(true);
    expect(pie.arcs.every((arc) => !arc.dimmed)).toBe(true);
    expect(pie.selected).toBeNull();
  });

  it('draws one slice as a full ring', () => {
    const [arc] = pieArcs([october[0]], null).arcs;
    expect(arc.percent).toBe(100);
    expect(arc.path.match(/M/g)).toHaveLength(2);
  });

  it('dims every slice but the selected one', () => {
    const pie = pieArcs(october, 'vacanze');
    expect(pie.arcs.map((arc) => arc.dimmed)).toEqual([true, false, true]);
    expect(pie.selected?.envelope).toBe('vacanze');
  });

  it('forgets a selection that is not in the slices', () => {
    expect(pieArcs(october, 'svago').selected).toBeNull();
    expect(pieArcs(october, 'svago').arcs.every((arc) => !arc.dimmed)).toBe(true);
  });
});
