import { describe, expect, it } from 'vitest';
import { recognizePlan } from './index';
import { planInBox } from './testing';

describe('階段の認識', () => {
  it('自作 1 階: 直階段 1 つ、flight 1 本、踏面 9、Y 方向に上る', () => {
    const m = recognizePlan(planInBox('fixtures/sample-house.dxf', [-2000, -2000, 9500, 9500]));
    expect(m.stairs).toHaveLength(1);
    expect(m.stairs[0].flights).toHaveLength(1);
    const f = m.stairs[0].flights[0];
    expect(f.treads).toBe(9);
    expect(f.axis).toBe('y');
    expect(f.ascendPositive).toBe(true);
  });
  it('自作 2 階: DN の階段は下り（ascendPositive が偽）', () => {
    const m = recognizePlan(planInBox('fixtures/sample-house.dxf', [10000, -2000, 21500, 9500]));
    expect(m.stairs).toHaveLength(1);
    expect(m.stairs[0].flights[0].ascendPositive).toBe(false);
  });
  it('forest-s 1 階: 階段が 1 つ以上あり、タイル目地は階段にならない（flight は 3 本以下）', () => {
    const m = recognizePlan(planInBox('fixtures/forest-s/平面立面図.dxf', [5500, 28800, 19800, 39800]));
    expect(m.stairs.length).toBeGreaterThanOrEqual(1);
    expect(m.stairs.every((s) => s.flights.length <= 3)).toBe(true);
  });
});
