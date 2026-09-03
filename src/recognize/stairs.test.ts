import { describe, expect, it } from 'vitest';
import type { PlanEntity } from '../model/types';
import { toSegments } from './geom';
import { recognizePlan } from './index';
import { detectStairs } from './stairs';
import { FOREST_S_PATH, hasForestS, line, planInBox } from './testing';

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
  it('自作 2 階: DN の矢印は −Y を指すので、物理的に上る向きは +Y（ascendPositive が真）', () => {
    const m = recognizePlan(planInBox('fixtures/sample-house.dxf', [10000, -2000, 21500, 9500]));
    expect(m.stairs).toHaveLength(1);
    expect(m.stairs[0].flights[0].ascendPositive).toBe(true);
  });
  // 実図面は権利上の配慮で公開リポジトリに含めない。ローカルにあるときだけ走る
  it.skipIf(!hasForestS())('forest-s 1 階: 階段が 1 つ以上あり、タイル目地は階段にならない（flight は 3 本以下）', () => {
    const m = recognizePlan(planInBox(FOREST_S_PATH, [5500, 28800, 19800, 39800]));
    expect(m.stairs.length).toBeGreaterThanOrEqual(1);
    expect(m.stairs.every((s) => s.flights.length <= 3)).toBe(true);
    // 直進部 4 段（踏面線 5 本・幅 680・間隔 228）だけが flight になる。回り段と上部 2 段は組にならない（設計書 §7.2 手順 6）。
    // 手すりの帯で 40 mm に切られた切れ端が 2 本目の flight にならないこと
    expect(m.stairs[0].flights).toHaveLength(1);
    expect(m.stairs[0].flights[0]).toMatchObject({ axis: 'y', ascendPositive: true, treads: 4 });
    expect(m.stairs[0].flights[0].rect.maxX - m.stairs[0].flights[0].rect.minX).toBeGreaterThan(600);
  });
});

/** 踏面線 `count` 本（間隔 300、幅 800）を (x, y) から +Y に並べる */
const treads = (layer: string, x: number, y: number, count: number): PlanEntity[] =>
  Array.from({ length: count }, (_, i) => line(layer, x, y + i * 300, x + 800, y + i * 300));
/** UP / DN の文字 */
const label = (text: string, x: number, y: number): PlanEntity => ({ kind: 'text', layer: '文字', at: { x, y }, text, height: 200 });
/** 矢印: 軸線 (x, y0)→(x, y1) と、矢先 (x, y1) に付く短線 2 本 */
const arrow = (x: number, y0: number, y1: number): PlanEntity[] => {
  const back = y1 > y0 ? -150 : 150;
  return [line('階段', x, y0, x, y1), line('階段', x, y1, x - 80, y1 + back), line('階段', x, y1, x + 80, y1 + back)];
};
const run = (entities: PlanEntity[]) =>
  detectStairs(toSegments(entities), entities.filter((e): e is Extract<PlanEntity, { kind: 'text' }> => e.kind === 'text'));

describe('階段の認識（合成データ）', () => {
  it('文字だけ（矢印なし）: UP は文字側から上り、DN は文字側から下る', () => {
    const up = run([...treads('階段', 0, 0, 5), label('UP', 200, -400)]);
    expect(up[0].flights[0]).toMatchObject({ axis: 'y', ascendPositive: true, treads: 4 });
    const dn = run([...treads('階段', 0, 0, 5), label('DN', 200, -400)]);
    expect(dn[0].flights[0].ascendPositive).toBe(false);
  });
  it('文字が bbox から 1,000 mm を超えて離れていれば拾わない。文字も矢印も無い組は階段にしない', () => {
    expect(run([...treads('階段', 0, 0, 5), label('UP', 200, -1400)])).toHaveLength(0);
    expect(run(treads('階段', 0, 0, 5))).toHaveLength(0);
  });
  it('矢印が踏面の脇（bbox の外 100 mm）にあっても拾い、矢先の側が上り。DN の矢印は下る向きなので反転する', () => {
    const s = run([...treads('階段', 0, 0, 5), ...arrow(900, 1100, 100)]);
    expect(s).toHaveLength(1);
    expect(s[0].flights[0].ascendPositive).toBe(false);
    const dn = run([...treads('階段', 0, 0, 5), ...arrow(900, 1100, 100), label('DN', 200, -400)]);
    expect(dn[0].flights[0].ascendPositive).toBe(true);
  });
  it('直交方向にも等間隔の線がある格子（タイル目地）は階段にしない', () => {
    const grid = [...treads('目地', 0, 0, 5), ...Array.from({ length: 5 }, (_, i) => line('目地', i * 200, -200, i * 200, 1400))];
    expect(run([...grid, label('UP', 200, -400)])).toHaveLength(0);
  });
  it('別レイヤーの線が踏面の間に重なっていても組は切れない', () => {
    const s = run([...treads('階段', 0, 0, 10), line('家具', 0, 1350, 800, 1350), label('UP', 200, -400)]);
    expect(s).toHaveLength(1);
    expect(s[0].flights[0].treads).toBe(9);
  });
  it('幅 600 mm 未満の線は踏面に数えない（手すりの帯で切られた切れ端）', () => {
    const short = Array.from({ length: 5 }, (_, i) => line('階段', -40, i * 300, 0, i * 300));
    const s = run([...treads('階段', 0, 0, 5), ...short, label('UP', 200, -400)]);
    expect(s).toHaveLength(1);
    expect(s[0].flights).toHaveLength(1);
    expect(s[0].flights[0].rect.minX).toBe(0);
  });
  it('1,500 mm 以内の 2 組は 1 つの階段になり、間が踊り場になる。離れていれば別の階段', () => {
    const near = run([...treads('階段', 0, 0, 5), ...treads('階段', 0, 1700, 5), label('UP', 200, -400), label('UP', 200, 1300)]);
    expect(near).toHaveLength(1);
    expect(near[0].flights).toHaveLength(2);
    expect(near[0].landings[0]).toEqual({ minX: 0, minY: 1200, maxX: 800, maxY: 1700 });
    const far = run([...treads('階段', 0, 0, 5), ...treads('階段', 0, 3000, 5), label('UP', 200, -400), label('UP', 200, 2600)]);
    expect(far).toHaveLength(2);
  });
  it('flights は上り順: 先頭は矢印の尾に最も近い組、次は直前の組の上り終端に近い組（折り返し）', () => {
    // 上段（x 1200〜2000、−Y へ上る）を先に置き、下段（x 0〜800、+Y へ上る）に矢印。踊り場を挟んで折り返す。
    // DN は上段の上り終端（y 0 側）の近くに置く
    const upper = Array.from({ length: 5 }, (_, i) => line('階段', 1200, 1200 - i * 300, 2000, 1200 - i * 300));
    const s = run([...upper, ...treads('階段', 0, 0, 5), ...arrow(400, 100, 1100), label('DN', 2500, -300)]);
    expect(s).toHaveLength(1);
    expect(s[0].flights.map((f) => [f.rect.minX, f.ascendPositive])).toEqual([
      [0, true],
      [1200, false],
    ]);
    expect(s[0].landings).toEqual([{ minX: 800, minY: 0, maxX: 1200, maxY: 1200 }]);
    // 起点が UP の文字だけでも同じ順
    const byText = run([...upper, ...treads('階段', 0, 0, 5), label('UP', 200, -400), label('DN', 2500, -300)]);
    expect(byText[0].flights.map((f) => [f.rect.minX, f.ascendPositive])).toEqual([
      [0, true],
      [1200, false],
    ]);
  });
  it('DN の矢印が踊り場を横切って下段に届く折り返し: 尾は上端にあるので、尾から最も遠い下段が先頭', () => {
    // 上段（x 1200〜2000、−Y へ上る）の上端（1600, 100）から下段の下端（600, 1300）へ下る矢印。DN は上段の近く、UP は下段の近く
    const upper = Array.from({ length: 5 }, (_, i) => line('階段', 1200, 1200 - i * 300, 2000, 1200 - i * 300));
    const dnShaft = [line('階段', 1600, 100, 600, 1300), line('階段', 600, 1300, 560, 1180), line('階段', 600, 1300, 680, 1220)];
    const s = run([...upper, ...treads('階段', 0, 0, 5), ...dnShaft, label('UP', 200, -400), label('DN', 2500, -300)]);
    expect(s).toHaveLength(1);
    expect(s[0].flights.map((f) => [f.rect.minX, f.ascendPositive])).toEqual([
      [0, true],
      [1200, false],
    ]);
  });
  it('DN の矢印が上段の矩形に収まる折り返し（上端から下端まで）: 矢先も上段の中にあるが、尾から最も遠い下段が先頭', () => {
    const upper = Array.from({ length: 5 }, (_, i) => line('階段', 1200, 1200 - i * 300, 2000, 1200 - i * 300));
    const s = run([...upper, ...treads('階段', 0, 0, 5), ...arrow(1600, 100, 1100), label('UP', 200, -400), label('DN', 2500, -300)]);
    expect(s).toHaveLength(1);
    expect(s[0].flights.map((f) => [f.rect.minX, f.ascendPositive])).toEqual([
      [0, true],
      [1200, false],
    ]);
  });
  it('踏面の端に触れる短線 2 本（手すりの切れ端）で踏面自身を矢印にしない。向きは文字で決まる', () => {
    const stubs = [line('階段', 800, 0, 830, 25), line('階段', 800, 0, 830, -25)];
    const s = run([...treads('階段', 0, 0, 5), ...stubs, label('UP', 200, -400)]);
    expect(s).toHaveLength(1);
    expect(s[0].flights[0].ascendPositive).toBe(true);
  });
  it('3 組: 直前の組の上り終端に最も近い組が次になる（bbox の距離が近いだけでは選ばない）', () => {
    // A: x 0〜800、+Y へ上る（矢印）。B: A の上端の先で +X へ上る。C: A の下端の脇（bbox は A に最も近い）
    const a = [...treads('階段', 0, 0, 5), ...arrow(400, 100, 1100)];
    const b = [...Array.from({ length: 5 }, (_, i) => line('階段', 1200 + i * 300, 1300, 1200 + i * 300, 2100)), label('UP', 1100, 2300)];
    const c = [...treads('階段', -1200, -300, 5), label('UP', -800, -600)];
    const s = run([...c, ...b, ...a]);
    expect(s).toHaveLength(1);
    expect(s[0].flights.map((f) => f.rect.minX)).toEqual([0, 1200, -1200]);
    expect(s[0].flights[1]).toMatchObject({ axis: 'x', ascendPositive: true });
  });
});
