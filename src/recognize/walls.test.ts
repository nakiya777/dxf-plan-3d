import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadDxf } from '../dxf';
import { extractBands } from './bands';
import { toSegments } from './geom';
import {
  bandsToWalls,
  bboxOfPoints,
  centerlineBBox,
  computeOutline,
  decideWallLayers,
  markExterior,
} from './walls';
import type { PlanEntity, Wall } from '../model/types';

const forest1F = () => {
  const plan = loadDxf(new Uint8Array(readFileSync('fixtures/forest-s/平面立面図.dxf')).buffer, 'forest');
  return plan.entities.filter(
    (e) => e.kind === 'line' && e.a.x >= 5500 && e.a.x <= 19800 && e.a.y >= 28800 && e.a.y <= 39800,
  );
};

const line = (layer: string, x1: number, y1: number, x2: number, y2: number): PlanEntity => ({
  kind: 'line',
  layer,
  a: { x: x1, y: y1 },
  b: { x: x2, y: y2 },
});

/** 9,100 × 5,915 の壁芯・厚さ 150 の閉じた矩形。polygon-clipping の実測に使った形 */
const closedRect = (): Wall[] => {
  const corner = [
    [0, 0, 9100, 0],
    [9100, 0, 9100, 5915],
    [9100, 5915, 0, 5915],
    [0, 5915, 0, 0],
  ];
  return corner.map(([ax, ay, bx, by], i) => ({
    id: `r${i}`,
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
    thickness: 150,
    exterior: false,
  }));
};

/** 上辺に 3,000 mm の凹みがある U 字の閉じた壁 8 本。壁芯・厚さ 150 */
const uShape = (): Wall[] => {
  const path: number[][] = [
    [0, 0, 9000, 0],
    [9000, 0, 9000, 6000],
    [9000, 6000, 7000, 6000],
    [7000, 6000, 7000, 3000],
    [7000, 3000, 4000, 3000],
    [4000, 3000, 4000, 6000],
    [4000, 6000, 0, 6000],
    [0, 6000, 0, 0],
  ];
  return path.map(([ax, ay, bx, by], i) => ({
    id: `u${i}`,
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
    thickness: 150,
    exterior: false,
  }));
};

describe('壁の組み立て', () => {
  it('forest-s 1 階: 壁レイヤーは _0-1_1 だけ', () => {
    const r = extractBands(toSegments(forest1F()));
    expect([...decideWallLayers(r.candidates)]).toEqual(['_0-1_1']);
  });

  it('forest-s 1 階: 外壁芯の外接矩形が 9,100 × 5,915（±30）', () => {
    const r = extractBands(toSegments(forest1F()));
    const walls = bandsToWalls(r.walls, decideWallLayers(r.candidates));
    const box = centerlineBBox(markExterior(walls, computeOutline(walls)).filter((w) => w.exterior));
    expect(box.maxX - box.minX).toBeCloseTo(9100, -1.5);
    expect(box.maxY - box.minY).toBeCloseTo(5915, -1.5);
  });

  it('forest-s 1 階: 外周が閉じないので外形は bbox に落ち、内壁は外壁にしない', () => {
    // この図面は外周が閉じない。左外壁の窓脇の壁片は内側の線が 252 mm しか無く重なり 300 mm に届かず、
    // テラス出入口の上の壁は外側の線が枠の刻みだけで、残る 2 本は間隔 25 mm で帯にならない。
    // 和集合の最大の環は面積 8.35e6 mm²（全壁矩形 bbox の 15%）の細い帯にしかならないので、
    // これを外形に採ると内壁までほぼ全部が外壁になる（34 本中 31 本）
    const r = extractBands(toSegments(forest1F()));
    const walls = bandsToWalls(r.walls, decideWallLayers(r.candidates));
    const outline = computeOutline(walls);
    expect(outline).toHaveLength(4);
    const exterior = markExterior(walls, outline).filter((w) => w.exterior);
    expect(exterior.length).toBeGreaterThanOrEqual(6);
    expect(exterior.length).toBeLessThan(walls.length / 2); // 実測 13 / 34
  });

  it('forest-s 1 階: 壁は 34 本で、厚さはほぼ 150 mm', () => {
    const r = extractBands(toSegments(forest1F()));
    const walls = bandsToWalls(r.walls, decideWallLayers(r.candidates));
    expect(walls).toHaveLength(34);
    expect(walls.filter((w) => Math.abs(w.thickness - 150) < 1)).toHaveLength(32);
  });
});

describe('外形', () => {
  it('閉じた矩形 4 本の外形は和集合の外周（壁芯から厚さの半分だけ外）になる', () => {
    const outline = computeOutline(closedRect());
    const box = bboxOfPoints(outline);
    expect(box.minX).toBeCloseTo(-75);
    expect(box.maxX).toBeCloseTo(9175);
    expect(box.minY).toBeCloseTo(-75);
    expect(box.maxY).toBeCloseTo(5990);
    // polygon-clipping が返す環は閉じている。その重複点は落とす
    expect(outline[0]).not.toEqual(outline[outline.length - 1]);
  });

  it('閉じたコの字（凹み 3,000 mm）の外形は U 字になり、外壁は 8 本すべて', () => {
    // 開口としてつなぐ隙間の上限 2,500 mm を超える凹みなので、外形は矩形に潰れず U 字のまま残る
    const outline = computeOutline(uShape());
    expect(outline.length).toBeGreaterThanOrEqual(6);
    expect(bboxOfPoints(outline)).toMatchObject({ maxX: 9075, maxY: 6075 });
    expect(markExterior(uShape(), outline).filter((w) => w.exterior)).toHaveLength(8);
  });

  it('下辺が 1,000 mm の開口で切れていても、外形は U 字のまま取れる', () => {
    // 外形を取るときだけ共線の壁を開口の幅までつなぐ。つながないと和集合が輪にならず bbox に落ちる
    const walls = uShape().filter((w) => w.id !== 'u0');
    walls.push(
      { id: 'u0a', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 150, exterior: false },
      { id: 'u0b', a: { x: 5000, y: 0 }, b: { x: 9000, y: 0 }, thickness: 150, exterior: false },
    );
    expect(computeOutline(walls).length).toBeGreaterThanOrEqual(6);
  });

  it('U 字の内側にある間仕切りは外壁にしない', () => {
    const inner: Wall = { id: 'in', a: { x: 2000, y: 0 }, b: { x: 2000, y: 6000 }, thickness: 120, exterior: false };
    const walls = [...uShape(), inner];
    const marked = markExterior(walls, computeOutline(walls));
    expect(marked.find((w) => w.id === 'in')?.exterior).toBe(false);
    expect(marked.filter((w) => w.exterior)).toHaveLength(8);
  });

  it('離れた小屋が別に建っていても、外形は面積が最大の輪を採る', () => {
    const shed: Wall[] = [
      [-5000, 7000, -3500, 7000],
      [-3500, 7000, -3500, 8500],
      [-3500, 8500, -5000, 8500],
      [-5000, 8500, -5000, 7000],
    ].map(([ax, ay, bx, by], i) => ({
      id: `s${i}`,
      a: { x: ax, y: ay },
      b: { x: bx, y: by },
      thickness: 150,
      exterior: false,
    }));
    // 小屋のほうが左にあるので、和集合の先頭は小屋になる。面積で選ばないと外形が小屋になる
    const box = bboxOfPoints(computeOutline([...shed, ...uShape()]));
    expect(box.minX).toBeCloseTo(-75);
    expect(box.maxX).toBeCloseTo(9075);
  });

  it('閉じないコの字 3 本は外形にならず、全壁矩形の bbox に落ちる', () => {
    // 和集合の外周はコの字（頂点 8 個）になる。それを外形として採ると屋根も外壁判定も崩れる
    const outline = computeOutline(closedRect().slice(0, 3));
    expect(outline).toHaveLength(4);
    expect(bboxOfPoints(outline)).toEqual({ minX: -75, minY: -75, maxX: 9175, maxY: 5990 });
  });

  it('壁が 1 本も無ければ外形は空', () => {
    expect(computeOutline([])).toEqual([]);
  });
});

describe('外壁の判定', () => {
  it('矩形の 4 辺は外壁、内側の間仕切りは外壁でない', () => {
    const inner: Wall = { id: 'in', a: { x: 4000, y: 0 }, b: { x: 4000, y: 5915 }, thickness: 120, exterior: false };
    const walls = [...closedRect(), inner];
    const marked = markExterior(walls, computeOutline(walls));
    expect(marked.filter((w) => w.exterior).map((w) => w.id)).toEqual(['r0', 'r1', 'r2', 'r3']);
  });

  it('外壁から 400 mm しか離れていない間仕切りも外壁でない', () => {
    // 外へ踏み出す距離が大きすぎると、外壁沿いの間仕切りを外壁と誤判定する
    const inner: Wall = { id: 'in', a: { x: 400, y: 200 }, b: { x: 400, y: 5715 }, thickness: 120, exterior: false };
    const walls = [...closedRect(), inner];
    const marked = markExterior(walls, computeOutline(walls));
    expect(marked.find((w) => w.id === 'in')?.exterior).toBe(false);
  });
});

describe('帯から壁へ', () => {
  /** 厚さ 150 の帯を 2 本、s 方向に離して置く */
  const twoRuns = (gap: number, rhoShift = 0) =>
    extractBands(
      toSegments([
        line('壁', 0, 0, 3000, 0),
        line('壁', 0, 150, 3000, 150),
        line('壁', 3000 + gap, rhoShift, 6000, rhoShift),
        line('壁', 3000 + gap, 150 + rhoShift, 6000, 150 + rhoShift),
      ]),
    );

  it('隙間 40 mm の共線 2 帯は 1 本の壁につながる', () => {
    const r = twoRuns(40);
    const walls = bandsToWalls(r.walls, decideWallLayers(r.candidates));
    expect(walls).toHaveLength(1);
    expect(walls[0].a.x).toBeCloseTo(0);
    expect(walls[0].b.x).toBeCloseTo(6000);
    expect(walls[0].thickness).toBeCloseTo(150);
  });

  it('隙間 600 mm（開口）なら壁は 2 本のまま', () => {
    const r = twoRuns(600);
    expect(bandsToWalls(r.walls, decideWallLayers(r.candidates))).toHaveLength(2);
  });

  it('壁芯の 10 mm のずれは共線として吸収する', () => {
    const r = twoRuns(40, 10);
    expect(bandsToWalls(r.walls, decideWallLayers(r.candidates))).toHaveLength(1);
  });

  it('壁芯が 100 mm ずれていれば共線と見なさない', () => {
    const r = twoRuns(40, 100);
    expect(bandsToWalls(r.walls, decideWallLayers(r.candidates))).toHaveLength(2);
  });

  it('壁レイヤー以外の帯は壁にしない', () => {
    const r = extractBands(
      toSegments([
        line('壁', 0, 0, 6000, 0),
        line('壁', 0, 150, 6000, 150),
        line('家具', 0, 3000, 1000, 3000),
        line('家具', 0, 3120, 1000, 3120),
      ]),
    );
    const walls = bandsToWalls(r.walls, new Set(['壁']));
    expect(walls).toHaveLength(1);
  });

  it('壁の id は呼び出しごとに w0 から振り直す', () => {
    const r = twoRuns(600);
    const layers = decideWallLayers(r.candidates);
    expect(bandsToWalls(r.walls, layers).map((w) => w.id)).toEqual(['w0', 'w1']);
    expect(bandsToWalls(r.walls, layers).map((w) => w.id)).toEqual(['w0', 'w1']);
  });
});

describe('壁レイヤーの決定', () => {
  const bandsOf = (...entities: PlanEntity[]) => extractBands(toSegments(entities)).candidates;

  it('総延長が最大の 30% 以上あるレイヤーは壁レイヤーに加える', () => {
    // 外壁 6,000 mm と内壁 2,000 mm（33%）が別レイヤーに分かれた図面
    const bands = bandsOf(
      line('L1', 0, 0, 6000, 0),
      line('L1', 0, 150, 6000, 150),
      line('L2', 0, 3000, 2000, 3000),
      line('L2', 0, 3120, 2000, 3120),
    );
    expect([...decideWallLayers(bands)].sort()).toEqual(['L1', 'L2']);
  });

  it('総延長が最大の 30% 未満のレイヤーは落とす', () => {
    const bands = bandsOf(
      line('L1', 0, 0, 6000, 0),
      line('L1', 0, 150, 6000, 150),
      line('L2', 0, 3000, 1000, 3000),
      line('L2', 0, 3120, 1000, 3120),
    );
    expect([...decideWallLayers(bands)]).toEqual(['L1']);
  });

  it('名前が「壁」に当たるレイヤーは総延長が足りなくても壁レイヤーにする', () => {
    const bands = bandsOf(
      line('L1', 0, 0, 6000, 0),
      line('L1', 0, 150, 6000, 150),
      line('間仕切壁', 0, 3000, 1000, 3000),
      line('間仕切壁', 0, 3120, 1000, 3120),
    );
    expect([...decideWallLayers(bands)].sort()).toEqual(['L1', '間仕切壁']);
  });
});
