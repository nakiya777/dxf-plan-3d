import type { Box2, Plan2D, PlanEntity } from '../model/types';
import { bboxOf } from '../dxf';

const entityBox = (e: PlanEntity): Box2 => bboxOf([e]);
const intersects = (a: Box2, b: Box2) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

/**
 * ドラッグ矩形から 1 枚の平面図を切り出す（設計書 §6.2 手順 3）。
 * ドラッグ矩形に交差するエンティティを集め、その集合の外接矩形を新しい範囲にする。
 * 範囲が広がったぶん新たに交差するものがあれば取り込み、増えなくなるまで繰り返す
 * （長い通り芯が交差すれば平面図全体に広がり、通り芯の端の円とラベルまで入る。動画で青塗りがドラッグ矩形より広かった根拠）。
 * 交差判定は各エンティティの bbox 同士。弧は全円として数える近似（`bboxOf` の規則）
 */
export function selectRegion(plan: Plan2D, rect: Box2): Plan2D {
  const boxes = plan.entities.map(entityBox);
  let region = rect;
  let entities: PlanEntity[] = [];
  for (;;) {
    const grown = plan.entities.filter((_, i) => intersects(boxes[i], region));
    if (grown.length === entities.length) break;
    entities = grown;
    region = bboxOf(entities);
  }
  return { entities, bbox: bboxOf(entities), sourceName: plan.sourceName };
}
