import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadDxf } from '../dxf';
import { recognizePlan } from './index';
import { selectRegion } from './region';

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
