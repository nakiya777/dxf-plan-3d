import type { Box2, PlanEntity, Vec2 } from './types';

/**
 * エンティティ列の外接矩形。空なら原点だけの矩形を返す。
 * `dxf/parse.ts`（Plan2D の bbox）と `recognize/region.ts`（範囲選択）の両方が使う純粋関数なので、
 * どちらにも属さない `model/` に置く。
 *
 * 弧は掃引範囲を見ず全円として数える近似なので、矩形が広めに出る。
 * forest-s の弧は最大半径 706 mm なので、範囲選択では最大 694 mm 程度の過大が乗る。
 */
export function bboxOf(entities: PlanEntity[]): Box2 {
  const box: Box2 = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (p: Vec2, r = 0): void => {
    box.minX = Math.min(box.minX, p.x - r);
    box.minY = Math.min(box.minY, p.y - r);
    box.maxX = Math.max(box.maxX, p.x + r);
    box.maxY = Math.max(box.maxY, p.y + r);
  };
  for (const e of entities) {
    if (e.kind === 'line') {
      add(e.a);
      add(e.b);
    } else if (e.kind === 'text') {
      add(e.at);
    } else {
      add(e.center, e.radius);
    }
  }
  return Number.isFinite(box.minX) ? box : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}
