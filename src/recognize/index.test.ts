import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadDxf } from '../dxf';
import type { PlanEntity } from '../model/types';
import { recognizePlan, twoPlansSuspected } from './index';
import { detectAxes } from './axes';
import { selectRegion } from './region';
import { line } from './testing';

const sample = () => loadDxf(new Uint8Array(readFileSync('fixtures/sample-house.dxf')).buffer, 'sample');

describe('selectRegion', () => {
  it('小さな矩形でも、交差する通り芯が入るので 1 階平面図全体が選ばれる', () => {
    const sel = selectRegion(sample(), { minX: 3000, minY: 3000, maxX: 4000, maxY: 4000 });
    expect(sel.bbox.minX).toBeLessThan(-900); // 通り芯の端まで
    expect(sel.bbox.maxX).toBeLessThan(11000); // 2 階（X 12,000〜）は入らない
    expect(sel.entities.length).toBeGreaterThan(50);
  });
  it('何も交差しなければ空', () => {
    expect(selectRegion(sample(), { minX: 30000, minY: 30000, maxX: 31000, maxY: 31000 }).entities).toHaveLength(0);
  });
});

describe('recognizePlan（自作 1 階）', () => {
  const m = recognizePlan(selectRegion(sample(), { minX: 3000, minY: 3000, maxX: 4000, maxY: 4000 }));
  it('通り芯 6 本（X1〜X3・Y1〜Y3）', () => {
    expect(m.axes.map((a) => a.label).sort()).toEqual(['X1', 'X2', 'X3', 'Y1', 'Y2', 'Y3']);
  });
  it('外壁 4 本・外形は矩形', () => {
    expect(m.walls.filter((w) => w.exterior).length).toBe(4);
    expect(m.outline.length).toBe(4);
  });
  it('壁に使った線は decorLines に残らず、通り芯・弧・文字以外は残る', () => {
    expect(m.decorLines.some((e) => e.kind === 'line' && e.layer === '壁')).toBe(false);
    expect(m.decorLines.some((e) => e.kind === 'line' && e.layer === '通り芯')).toBe(true);
    expect(m.decorLines.some((e) => e.kind === 'arc')).toBe(true);
    expect(m.decorLines.some((e) => e.kind === 'text')).toBe(false);
    expect(m.warnings).toHaveLength(0);
  });
  it('壁レイヤー以外の帯（設備・家具の平行線）の線は decorLines に残る', () => {
    const walls = [line('壁', 0, 75, 5000, 75), line('壁', 0, -75, 5000, -75), line('壁', 0, 3075, 5000, 3075), line('壁', 0, 2925, 5000, 2925)];
    const furniture = [line('家具', 1000, 1000, 2000, 1000), line('家具', 1000, 1100, 2000, 1100)];
    const m = recognizePlan({ entities: [...walls, ...furniture], bbox: { minX: 0, minY: -75, maxX: 5000, maxY: 3075 }, sourceName: 't' });
    expect(m.walls).toHaveLength(2);
    expect(m.decorLines.filter((e) => e.kind === 'line' && e.layer === '家具')).toHaveLength(2);
    expect(m.decorLines.some((e) => e.layer === '壁')).toBe(false);
  });
});

describe('recognizePlan（壁が無い図面）', () => {
  it('落ちずに warnings に 1 行入り、外形は空', () => {
    const m = recognizePlan({
      entities: [{ kind: 'text', layer: '0', at: { x: 0, y: 0 }, text: 'メモ', height: 100 }],
      bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      sourceName: 't',
    });
    expect(m.walls).toHaveLength(0);
    expect(m.outline).toHaveLength(0);
    expect(m.warnings).toHaveLength(1);
    expect(m.warnings[0]).toContain('壁を認識できません');
  });
});

describe('detectAxes', () => {
  const circle = (x: number, y: number, r = 250): PlanEntity => ({ kind: 'circle', layer: '通り芯', center: { x, y }, radius: r });
  const text = (x: number, y: number, t: string): PlanEntity => ({ kind: 'text', layer: '通り芯', at: { x, y }, text: t, height: 200 });
  it('円周に端点が乗る線（ずれ 5 mm まで）があれば通り芯。乗っていなければ拾わない', () => {
    const on = [circle(0, -1250), text(-120, -1350, 'X1'), line('通り芯', 0, -1004, 0, 8000)];
    expect(detectAxes(on).map((a) => a.label)).toEqual(['X1']);
    const off = [circle(0, -1250), text(-120, -1350, 'X1'), line('通り芯', 0, -900, 0, 8000)];
    expect(detectAxes(off)).toHaveLength(0);
  });
  it('寸法線端末の小円（半径 5）は通り芯にしない', () => {
    expect(detectAxes([circle(0, 0, 5), text(0, 0, 'A'), line('寸法', 0, -5, 0, 500)])).toHaveLength(0);
  });
});

describe('twoPlansSuspected', () => {
  const wall = (id: string, a: [number, number], b: [number, number]) =>
    ({ id, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thickness: 150, exterior: true });
  const model = (walls: ReturnType<typeof wall>[]) =>
    ({ walls, openings: [], stairs: [], axes: [], outline: [], decorLines: [], warnings: [] });
  it('1 部屋（3.6 m 角）の 4 辺は、端点の間隔が 3 m を超えても誤検出しない', () => {
    const m = model([wall('w1', [0, 0], [3600, 0]), wall('w2', [3600, 0], [3600, 3600]), wall('w3', [3600, 3600], [0, 3600]), wall('w4', [0, 3600], [0, 0])]);
    expect(twoPlansSuspected(m)).toBe(false);
  });
  it('X 方向に 3 m 超の空白を挟んで壁の群が 2 つあれば検出する', () => {
    const m = model([wall('w1', [0, 0], [3600, 0]), wall('w2', [0, 3600], [3600, 3600]), wall('w3', [7000, 0], [10600, 0]), wall('w4', [7000, 3600], [10600, 3600])]);
    expect(twoPlansSuspected(m)).toBe(true);
  });
});
