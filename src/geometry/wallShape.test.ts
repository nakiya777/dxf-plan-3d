import { describe, expect, it } from 'vitest';
import { buildWallProfile } from './wallShape';
import type { Opening } from '../model/types';

const door: Opening = { wallId: 'w', offset: 1000, width: 800, type: 'door', sill: 0, head: 2000 };
const win: Opening = { wallId: 'w', offset: 2500, width: 1200, type: 'window', sill: 900, head: 2000 };

/** 輪郭の符号付き面積（反時計回りなら正） */
const signedArea = (pts: { s: number; z: number }[]) =>
  pts.reduce((sum, p, i) => { const q = pts[(i + 1) % pts.length]; return sum + p.s * q.z - q.s * p.z; }, 0) / 2;

describe('buildWallProfile', () => {
  it('壁が低い（H=1000）とドアは天端まで抜けた切り欠きになり、穴は無い', () => {
    const p = buildWallProfile(5000, 1000, [door, win]);
    expect(p.holes).toHaveLength(0);
    // 切り欠きの底: (1000, 0)–(1800, 0)
    expect(p.outline.some((q) => q.z === 0 && q.s === 1000)).toBe(true);
    expect(p.outline.some((q) => q.z === 0 && q.s === 1800)).toBe(true);
  });
  it('H=1500 では窓は sill 900 から天端までの切り欠き', () => {
    const p = buildWallProfile(5000, 1500, [win]);
    expect(p.holes).toHaveLength(0);
    expect(p.outline.filter((q) => q.z === 900).map((q) => q.s).sort((a, b) => a - b)).toEqual([2500, 3700]);
  });
  it('H=3000 ではドアも窓も穴になる', () => {
    const p = buildWallProfile(5000, 3000, [door, win]);
    expect(p.holes).toEqual([
      [{ s: 1000, z: 0 }, { s: 1800, z: 0 }, { s: 1800, z: 2000 }, { s: 1000, z: 2000 }],
      [{ s: 2500, z: 900 }, { s: 3700, z: 900 }, { s: 3700, z: 2000 }, { s: 2500, z: 2000 }],
    ]);
    expect(p.outline).toEqual([{ s: 0, z: 0 }, { s: 5000, z: 0 }, { s: 5000, z: 3000 }, { s: 0, z: 3000 }]);
  });
  it('head = H の開口は切り欠き（穴が外形に触れると ExtrudeGeometry が崩れる）', () => {
    const p = buildWallProfile(5000, 2000, [door]);
    expect(p.holes).toHaveLength(0);
    expect(p.outline.some((q) => q.s === 1000 && q.z === 0)).toBe(true);
  });
  it('sill ≥ H の開口は無視する', () => {
    const p = buildWallProfile(5000, 800, [win]);
    expect(p.holes).toHaveLength(0);
    expect(p.outline).toHaveLength(4);
  });
  it('輪郭は反時計回りで、穴も同じ向き', () => {
    const p = buildWallProfile(5000, 1000, [door, win]);
    expect(signedArea(p.outline)).toBeGreaterThan(0);
    const q = buildWallProfile(5000, 3000, [door]);
    expect(signedArea(q.holes[0])).toBeGreaterThan(0);
  });
  it('天端プロファイルを与えると上辺がそれに従う（妻壁）', () => {
    const p = buildWallProfile(5000, 3000, [], (s) => 3000 + (s < 2500 ? s : 5000 - s) * 0.4);
    const apex = Math.max(...p.outline.map((q) => q.z));
    expect(apex).toBeCloseTo(4000, 0);
  });
  it('天端プロファイルは 100 mm 刻みでサンプルし、H を下回る区間は H のまま', () => {
    const p = buildWallProfile(1000, 3000, [], (s) => 2000 + s);
    const topSamples = p.outline.filter((q) => q.z > 0).map((q) => q.s).sort((a, b) => a - b);
    expect(topSamples).toEqual([0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
    expect(p.outline.find((q) => q.s === 500 && q.z > 0)?.z).toBe(3000);
    expect(p.outline.find((q) => q.s === 1000 && q.z > 0)?.z).toBe(3000);
    expect(Math.min(...p.outline.filter((q) => q.z > 0).map((q) => q.z))).toBe(3000);
  });
  it('sampleAt で与えた位置（棟との交点）でもサンプルする', () => {
    const p = buildWallProfile(1000, 3000, [], (s) => 3000 + 400 - Math.abs(s - 550) * 0.4, [550]);
    expect(p.outline.some((q) => q.s === 550 && q.z === 3400)).toBe(true);
  });
  it('妻壁の天端と切り欠きが共存する', () => {
    const p = buildWallProfile(5000, 1000, [door], (s) => 1000 + s * 0.2);
    expect(p.holes).toHaveLength(0);
    expect(p.outline.some((q) => q.s === 1000 && q.z === 0)).toBe(true);
    expect(p.outline.some((q) => q.s === 1800 && q.z === 0)).toBe(true);
    expect(p.outline.some((q) => q.s === 1800 && q.z === 1360)).toBe(true);
    expect(Math.max(...p.outline.map((q) => q.z))).toBe(2000);
  });
});
