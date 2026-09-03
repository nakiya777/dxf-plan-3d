import { describe, expect, it } from 'vitest';
import { solveRoof } from './roof';
import type { Vec3 } from './roof';
import type { Roof } from './types';

/** 9,100 × 5,915 の外壁芯矩形（建物座標、中心が原点） */
const rect = { minX: -4550, minY: -2957.5, maxX: 4550, maxY: 2957.5 };
const W = 5915;
const base: Roof = { axis: 'x', ridgeOffset: 0, inset: [W / 2, W / 2], pitchSun: 4, eave: 600, verge: 600, thickness: 150 };
const He = 6500;
const midOf = (a: Vec3, b: Vec3): Vec3 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });

describe('solveRoof 寄棟', () => {
  it('棟高は He + p × W/2、棟端点は壁芯から inset の位置', () => {
    const g = solveRoof(base, rect, He);
    expect(g.ridgeZ).toBeCloseTo(He + 0.4 * (W / 2));
    expect(g.ridge[0]).toEqual({ x: -4550 + W / 2, y: 0, z: g.ridgeZ });
    expect(g.ridge[1]).toEqual({ x: 4550 - W / 2, y: 0, z: g.ridgeZ });
  });
  it('主面は壁芯上で He、軒先で He − p e、棟で棟高', () => {
    const g = solveRoof(base, rect, He);
    expect(g.heightAt(0, -2957.5)).toBeCloseTo(He);
    expect(g.heightAt(0, 2957.5)).toBeCloseTo(He);
    expect(g.heightAt(0, -2957.5 - 600)).toBeCloseTo(He - 0.4 * 600);
    expect(g.heightAt(0, 0)).toBeCloseTo(g.ridgeZ);
  });
  it('既定の寄棟では端面の勾配も 4 寸で、面は 4 枚・赤線は棟 1 + 隅棟 4', () => {
    const g = solveRoof(base, rect, He);
    const eaveCornerZ = g.heightAt(-4550 - 600, -2957.5 - 600);
    expect(eaveCornerZ).toBeCloseTo(He - 0.4 * 600);
    const slope = (g.ridgeZ - eaveCornerZ) / (g.ridge[0].x - (-4550 - 600));
    expect(slope).toBeCloseTo(0.4, 5);
    // 端面の上（棟端より外）は主面より低い
    expect(g.heightAt(-4550 - 300, 0)).toBeCloseTo(g.ridgeZ - 0.4 * (W / 2 + 300));
    expect(g.planes).toHaveLength(4);
    expect(g.edges).toHaveLength(5);
  });
  it('inset を外へ引くと端面が急になる（棟が伸びる）', () => {
    const g = solveRoof({ ...base, inset: [1000, W / 2] }, rect, He);
    expect(g.ridge[0].x).toBe(-3550);
    const eaveCornerZ = g.heightAt(-5150, -3557.5);
    expect((g.ridgeZ - eaveCornerZ) / (g.ridge[0].x - -5150)).toBeCloseTo((0.4 * (W / 2 + 600)) / 1600);
  });
  it('面の頂点はすべて heightAt と一致し、軒先線は壁芯から軒の出だけ外にある', () => {
    const g = solveRoof(base, rect, He);
    for (const poly of g.planes) for (const p of poly) expect(p.z).toBeCloseTo(g.heightAt(p.x, p.y));
    const xs = g.planes.flat().map((p) => p.x);
    const ys = g.planes.flat().map((p) => p.y);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([-5150, 5150]);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([-3557.5, 3557.5]);
  });
});

describe('solveRoof 切妻', () => {
  it('inset 0 は切妻: 面は 2 枚、棟端はケラバ先端まで、妻側の壁芯上で棟高になる', () => {
    const g = solveRoof({ ...base, inset: [0, 0] }, rect, He);
    expect(g.planes).toHaveLength(2);
    expect(g.edges).toHaveLength(1);
    expect(g.ridge[0].x).toBeCloseTo(-4550 - 600);
    expect(g.ridge[1].x).toBeCloseTo(4550 + 600);
    expect(g.heightAt(-4550, 0)).toBeCloseTo(g.ridgeZ);
    expect(g.heightAt(0, -2957.5)).toBeCloseTo(He); // 軒側の壁芯上は He
  });
  it('片側だけ切妻にできる', () => {
    const g = solveRoof({ ...base, inset: [0, W / 2] }, rect, He);
    expect(g.planes).toHaveLength(3);
    expect(g.edges).toHaveLength(3);
    expect(g.ridge[0].x).toBe(-5150);
    expect(g.ridge[1].x).toBe(4550 - W / 2);
  });
  it('ケラバの出はケラバ側の外形にだけ効く', () => {
    const g = solveRoof({ ...base, inset: [0, 0], verge: 900 }, rect, He);
    const xs = g.planes.flat().map((p) => p.x);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([-5450, 5450]);
  });
});

describe('solveRoof 軸と棟の平行移動', () => {
  it('軸が y でも同じ式（x と y を入れ替えるだけ）', () => {
    const g = solveRoof({ ...base, axis: 'y', inset: [0, 0] }, rect, He);
    expect(g.ridgeZ).toBeCloseTo(He + 0.4 * (9100 / 2));
    expect(g.ridge[0]).toEqual({ x: 0, y: -2957.5 - 600, z: g.ridgeZ });
    expect(g.heightAt(-4550, 0)).toBeCloseTo(He);
    expect(g.heightAt(0, -2957.5)).toBeCloseTo(g.ridgeZ);
    for (const poly of g.planes) for (const p of poly) expect(p.z).toBeCloseTo(g.heightAt(p.x, p.y));
  });
  it('ridgeOffset は棟を平行移動し、棟高は遠い側の幅で決まる', () => {
    const g = solveRoof({ ...base, inset: [0, 0], ridgeOffset: 500 }, rect, He);
    expect(g.ridge[0].y).toBe(500);
    expect(g.ridgeZ).toBeCloseTo(He + 0.4 * (W / 2 + 500));
    expect(g.heightAt(0, 2957.5)).toBeCloseTo(He + 0.4 * 1000); // 近い側の壁芯上は He より高い
    expect(g.heightAt(0, -2957.5)).toBeCloseTo(He);
  });
  it('ridgeOffset ≠ 0 の寄棟端面は軒先の角 2 点と棟端点を通る平面で、両軒先の高さをそのまま受ける', () => {
    const g = solveRoof({ ...base, ridgeOffset: 500 }, rect, He);
    const lowEave = He - 0.4 * 600; // 遠い側（y 小）の軒先
    const highEave = lowEave + 0.4 * 1000; // 近い側（y 大）は棟が 500 寄った分だけ 1,000 高い
    expect(g.heightAt(-5150, -3557.5)).toBeCloseTo(lowEave);
    expect(g.heightAt(-5150, 3557.5)).toBeCloseTo(highEave);
    expect(g.heightAt(5150, 3557.5)).toBeCloseTo(highEave);
    for (const poly of g.planes) for (const p of poly) expect(p.z).toBeCloseTo(g.heightAt(p.x, p.y));
    // 符号を反転すると高い側が y 小に移る
    const h = solveRoof({ ...base, ridgeOffset: -500 }, rect, He);
    expect(h.heightAt(-5150, -3557.5)).toBeCloseTo(highEave);
    expect(h.heightAt(-5150, 3557.5)).toBeCloseTo(lowEave);
    expect(h.heightAt(0, -2957.5)).toBeCloseTo(He + 0.4 * 1000);
  });
  it('ridgeOffset ≠ 0 でも軒先線と隅棟は直線（面の中点が両端の頂点と同一直線上にある）', () => {
    const g = solveRoof({ ...base, ridgeOffset: 500 }, rect, He);
    // 主面（y 大）の軒先線 (xb, yb)–(xa, yb): 端面が x にしか依存しないと中央だけ 400 mm 浮く
    const eave = midOf(g.planes[1][2], g.planes[1][3]);
    expect(g.heightAt(eave.x, eave.y)).toBeCloseTo(eave.z, 6);
    // 棟と隅棟の中点でも上面の高さが線分の高さと一致する
    for (const [a, b] of g.edges) {
      const m = midOf(a, b);
      expect(g.heightAt(m.x, m.y)).toBeCloseTo(m.z, 6);
    }
  });
});
