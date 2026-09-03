import { readFileSync } from 'node:fs';
import { loadDxf } from '../dxf';
import type { Plan2D, PlanEntity } from '../model/types';

/** テスト用の線分エンティティ */
export const line = (layer: string, x1: number, y1: number, x2: number, y2: number): PlanEntity => ({
  kind: 'line',
  layer,
  a: { x: x1, y: y1 },
  b: { x: x2, y: y2 },
});

/**
 * forest-s の 1 階平面図の範囲にある線分。設計書 §7.0 の実測とプロトタイプが使ったのと同じ範囲。
 * 始点だけで範囲判定しているのは Task 5 のテストがそう書かれたためで、Python 試作（両端で判定）と
 * 帯の数・総延長が一致することを確認済み
 */
export const forest1F = (): PlanEntity[] => {
  const plan = loadDxf(new Uint8Array(readFileSync('fixtures/forest-s/平面立面図.dxf')).buffer, 'forest');
  return plan.entities.filter(
    (e) => e.kind === 'line' && e.a.x >= 5500 && e.a.x <= 19800 && e.a.y >= 28800 && e.a.y <= 39800,
  );
};

/**
 * DXF を読み、矩形の中に始点（線は a・文字は挿入点・弧と円は中心）があるエンティティだけを残した Plan2D。
 * Task 7〜9 のテストが 1 階・2 階を切り分けるのに使う
 */
export const planInBox = (file: string, box: [number, number, number, number]): Plan2D => {
  const plan = loadDxf(new Uint8Array(readFileSync(file)).buffer, file);
  const inBox = (x: number, y: number) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3];
  const entities = plan.entities.filter((e) =>
    e.kind === 'line' ? inBox(e.a.x, e.a.y) : e.kind === 'text' ? inBox(e.at.x, e.at.y) : inBox(e.center.x, e.center.y),
  );
  return { ...plan, entities };
};
