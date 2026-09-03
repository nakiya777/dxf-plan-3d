import type { Plan2D, PlanEntity, PlanModel } from '../model/types';
import { detectAxes } from './axes';
import { extractBands } from './bands';
import { toSegments } from './geom';
import { detectOpenings } from './openings';
import { detectStairs } from './stairs';
import { bandsToWalls, computeOutline, decideWallLayers, markExterior } from './walls';

/**
 * Plan2D → PlanModel。設計書 §7.2 の手順を順に呼ぶ合成関数で、認識層の唯一の出口。
 *
 * 壁が 1 本も取れなければ `warnings` に 1 行入れ、`outline` は空にして続行する（§7.2「失敗時の振る舞い」）。
 * 開口・階段・通り芯・飾り線はそのまま取るので、板の上に線を描くことはできる
 */
export function recognizePlan(plan: Plan2D): PlanModel {
  const segs = toSegments(plan.entities);
  const bands = extractBands(segs);
  const wallLayers = decideWallLayers(bands);
  const rawWalls = bandsToWalls(bands.wallBands, wallLayers);
  const outline = computeOutline(rawWalls);
  const exteriorWalls = markExterior(rawWalls, outline);

  // `usedLineIds` の id は `toSegments` に渡した配列の添字なので、`plan.entities[i]` と対応する
  const nonWallSegs = segs.filter((s) => !bands.usedLineIds.has(s.id));
  // 隙間を埋める記号: 中央線付きの帯と、壁レイヤー以外の帯（建具レイヤーの引き戸など。§7.2 手順 4）
  const fillers = [...bands.symbols, ...bands.wallBands.filter((b) => !wallLayers.has(b.layer))];
  // 記号の線: 壁レイヤー以外の、帯にならなかった線（壁レイヤーの短い線は壁端の見切りなので数えない）
  const symbolSegs = nonWallSegs.filter((s) => !wallLayers.has(s.layer));
  const { walls, openings } = detectOpenings(exteriorWalls, plan.entities, fillers, symbolSegs);
  const texts = plan.entities.filter((e): e is Extract<PlanEntity, { kind: 'text' }> => e.kind === 'text');
  const stairs = detectStairs(nonWallSegs, texts);
  const axes = detectAxes(plan.entities);
  // 文字は 3D に描かない（§7.2 手順 8）。壁レイヤーの帯に使った線だけを除き、
  // 設備・家具の帯の線・窓記号の線・弧・円は全部残す（§7.2 手順 9。動画では床面の青線に全部出ている）
  const wallLineIds = new Set(bands.wallBands.filter((b) => wallLayers.has(b.layer)).flatMap((b) => b.lineIds));
  const decorLines = plan.entities.filter((e, i) => e.kind !== 'text' && !(e.kind === 'line' && wallLineIds.has(i)));
  const warnings = walls.length === 0 ? ['壁を認識できませんでした。レイヤー名を確認してください'] : [];
  return { walls, openings, stairs, axes, outline, decorLines, warnings };
}

export { selectRegion } from './region';
