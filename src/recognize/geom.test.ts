import { describe, expect, it } from 'vitest';
import { groupByRho } from './geom';

describe('groupByRho', () => {
  it('グループ先頭との差がちょうど許容値なら同じグループ、少しでも超えたら別グループ', () => {
    expect(groupByRho([0, 20, 20.1], (v) => v, 20)).toEqual([[0, 20], [20.1]]);
  });

  it('15 ずつ 4 段ずれた列は数珠つなぎで 1 グループに融合しない', () => {
    // 直前の要素と比べる実装だと 0〜45 が 1 グループになり、壁厚が 150 → 195 mm に太る（walls.ts の joinCollinear）
    expect(groupByRho([0, 15, 30, 45], (v) => v, 20)).toEqual([[0, 15], [30, 45]]);
  });
});
