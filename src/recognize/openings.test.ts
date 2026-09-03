import { describe, expect, it } from 'vitest';
import { recognizePlan } from './index';
import { planInBox } from './testing';

describe('開口の認識', () => {
  /**
   * 弧は 6 個あるが、両側の壁が認識されている（= 隙間になる）のは 3 個だけ。残り 3 個は隣の壁片が
   * 252 mm / 227 mm / 192 mm と短く帯にならない（設計書 §7.2 手順 5 の実測と同じ原因）ので、隙間が無く開口にできない。
   * 窓も同じ理由で左外壁の 2 つが落ち、外壁の隙間にある 5 つが取れる（2026-09-03 実測）
   */
  it('forest-s 1 階: 開き戸 3（両側に壁がある弧）、窓 5 は外壁だけ、記号線の無い隙間は開口にしない', () => {
    const m = recognizePlan(planInBox('fixtures/forest-s/平面立面図.dxf', [5500, 28800, 19800, 39800]));
    const doors = m.openings.filter((o) => o.type === 'door' && o.width >= 500);
    expect(doors.map((o) => Math.round(o.width)).sort((p, q) => p - q)).toEqual([694, 706, 885]);
    const wallById = new Map(m.walls.map((w) => [w.id, w]));
    const windows = m.openings.filter((o) => o.type === 'window');
    expect(windows).toHaveLength(5);
    expect(windows.every((o) => wallById.get(o.wallId)?.exterior)).toBe(true);
    // 開き戸は戸が付いている壁にだけ付く。壁の交差部で直交する壁の隙間に同じ弧を数えない（w10 と w30 の角）
    expect(m.openings.filter((o) => Math.round(o.width) === 694)).toHaveLength(1);
  });
  it('自作 1 階: 掃き出し窓（幅 1,820）は sill 0、腰窓は sill 900、ドアは head 2,000', () => {
    const m = recognizePlan(planInBox('fixtures/sample-house.dxf', [-2000, -2000, 9500, 9500]));
    const wide = m.openings.find((o) => o.type === 'window' && Math.abs(o.width - 1820) < 60);
    expect(wide?.sill).toBe(0);
    expect(m.openings.some((o) => o.type === 'window' && o.sill === 900)).toBe(true);
    expect(m.openings.filter((o) => o.type === 'door').every((o) => o.head === 2000)).toBe(true);
    expect(m.openings.filter((o) => o.type === 'door').length).toBe(5);
    expect(m.openings.filter((o) => o.type === 'window').length).toBe(6);
  });
  it('自作 2 階: ドア 4・窓 8', () => {
    const m = recognizePlan(planInBox('fixtures/sample-house.dxf', [10000, -2000, 21500, 9500]));
    expect(m.openings.filter((o) => o.type === 'door').length).toBe(4);
    expect(m.openings.filter((o) => o.type === 'window').length).toBe(8);
  });
  it('開口の wallId は必ず存在する壁を指し、offset + width は壁の長さに収まる', () => {
    const m = recognizePlan(planInBox('fixtures/sample-house.dxf', [-2000, -2000, 9500, 9500]));
    const wallById = new Map(m.walls.map((w) => [w.id, w]));
    for (const o of m.openings) {
      const w = wallById.get(o.wallId)!;
      expect(w).toBeDefined();
      expect(o.offset).toBeGreaterThanOrEqual(0);
      expect(o.offset + o.width).toBeLessThanOrEqual(Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) + 1);
    }
  });
});
