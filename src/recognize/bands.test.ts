import { describe, expect, it } from 'vitest';
import { extractBands, totalLengthByLayer } from './bands';
import { toSegments } from './geom';
import { forest1F, hasForestS, line } from './testing';

describe('extractBands', () => {
  it('平行な 2 本（距離 120・重なり 3000）は 1 帯になる', () => {
    const r = extractBands(toSegments([line('壁', 0, 0, 3000, 0), line('壁', 0, 120, 3000, 120)]));
    expect(r.wallBands).toHaveLength(1);
    expect(r.wallBands[0].rhoHi - r.wallBands[0].rhoLo).toBeCloseTo(120);
  });

  it('等間隔 150 で 5 本並ぶタイル目地は周期性で除外される', () => {
    const lines = [0, 150, 300, 450, 600].map((y) => line('床', 0, y, 2000, y));
    const r = extractBands(toSegments(lines));
    expect(r.wallBands).toHaveLength(0);
    expect(r.periodic.length).toBeGreaterThan(0);
  });

  it('帯の中央に同じ長さの線がある窓記号は symbols に回る', () => {
    const r = extractBands(
      toSegments([line('建具', 0, 0, 1650, 0), line('建具', 0, 150, 1650, 150), line('建具', 0, 75, 1650, 75)]),
    );
    expect(r.wallBands).toHaveLength(0);
    expect(r.symbols).toHaveLength(1);
  });

  it('入れ子の 4 本（0 / 25 / 125 / 150）は外側 1 帯にまとまる', () => {
    const r = extractBands(toSegments([0, 25, 125, 150].map((y) => line('壁', 0, y, 4000, y))));
    expect(r.wallBands).toHaveLength(1);
    expect(r.wallBands[0].rhoLo).toBeCloseTo(0);
    expect(r.wallBands[0].rhoHi).toBeCloseTo(150);
  });

  it('斜め 45° の平行 2 本も帯になる', () => {
    const r = extractBands(toSegments([line('壁', 0, 0, 2000, 2000), line('壁', -85, 85, 1915, 2085)]));
    expect(r.wallBands).toHaveLength(1);
  });

  // 実図面は権利上の配慮で公開リポジトリに含めない。ローカルにあるときだけ走る
  it.skipIf(!hasForestS())('forest-s 1 階: 壁レイヤー _0-1_1 の総延長が最大で、タイル目地 40 帯以上が周期性で落ちる', () => {
    const r = extractBands(toSegments(forest1F()));
    const total = totalLengthByLayer(r.wallBands);
    const top = [...total.entries()].sort((p, q) => q[1] - p[1])[0];
    expect(top[0]).toBe('_0-1_1');
    expect(r.periodic.length).toBeGreaterThanOrEqual(40);
  });

  it.skipIf(!hasForestS())('forest-s 1 階: 入れ子をまとめる前の帯が設計書 §7.0 の実測表と一致する', () => {
    // Python 試作（prototype/proto_walls.py）が同じ範囲で出した 187 帯・レイヤー別総延長そのもの
    const r = extractBands(toSegments(forest1F()));
    expect(r.candidates).toHaveLength(187);
    const total = totalLengthByLayer(r.candidates);
    expect(total.get('_0-1_1')).toBeCloseTo(142779, -1); // 142.8 m（壁）
    expect(total.get('_0-3_3')).toBeCloseTo(33029, -1); //  33.0 m（建具・最大の 23%）
    expect(total.get('_0-b_11')).toBeCloseTo(4705, -1); //   4.7 m（設備）
  });
});

// ここから下は閾値そのものを固定するテスト。CFG の値を動かすと落ちる
describe('帯の閾値', () => {
  it('厚さ 50 は薄すぎ、厚さ 300 は厚すぎて帯にならない', () => {
    const thin = extractBands(toSegments([line('壁', 0, 0, 3000, 0), line('壁', 0, 50, 3000, 50)]));
    expect(thin.wallBands).toHaveLength(0);
    const thick = extractBands(toSegments([line('壁', 0, 0, 3000, 0), line('壁', 0, 300, 3000, 300)]));
    expect(thick.wallBands).toHaveLength(0);
  });

  it('重なりが 200 mm しかない対は帯にならない', () => {
    const r = extractBands(toSegments([line('壁', 0, 0, 1000, 0), line('壁', 800, 120, 3000, 120)]));
    expect(r.wallBands).toHaveLength(0);
  });

  it('向きが 0.8° 違う 2 本は平行と見なさない', () => {
    // 3,000 mm で 41.9 mm の傾き = 0.8°。角度の刻みが粗いと平行と誤認して帯を作ってしまう
    const r = extractBands(toSegments([line('壁', 0, 0, 3000, 0), line('壁', 0, 120, 3000, 161.9)]));
    expect(r.wallBands).toHaveLength(0);
  });

  it('ρ の重なりが狭い方の厚さの 1/6 しかない 2 帯は、別の壁として残る', () => {
    const r = extractBands(toSegments([0, 100, 120, 260].map((y) => line('壁', 0, y, 4000, y))));
    expect(r.wallBands).toHaveLength(2);
  });

  it('間隔が 10% ばらついて並ぶ 5 本も周期性で除外される', () => {
    const lines = [0, 150, 315, 465, 630].map((y) => line('床', 0, y, 2000, y));
    const r = extractBands(toSegments(lines));
    expect(r.wallBands).toHaveLength(0);
    expect(r.periodic.length).toBeGreaterThan(0);
  });

  it('細線が中央から厚さの 1/6 ずれた窓（自作フィクスチャと同じ配置）も窓記号になる', () => {
    // 厚さ 150 の帯の中に、壁芯から ±25 mm 離して細線を 2 本引いた形
    const r = extractBands(toSegments([0, 50, 100, 150].map((y) => line('建具', 0, y, 1650, y))));
    expect(r.wallBands).toHaveLength(0);
    expect(r.symbols.length).toBeGreaterThan(0);
  });

  it('中央の線が帯の半分しか重ならないなら窓記号ではなく壁', () => {
    const r = extractBands(
      toSegments([line('壁', 0, 0, 1650, 0), line('壁', 0, 150, 1650, 150), line('壁', 0, 75, 800, 75)]),
    );
    expect(r.wallBands).toHaveLength(1);
    expect(r.symbols).toHaveLength(0);
  });

  it('窓記号に使った線も usedLineIds に入る（階段の探索が拾い直さないため）', () => {
    const r = extractBands(
      toSegments([line('建具', 0, 0, 1650, 0), line('建具', 0, 150, 1650, 150), line('建具', 0, 75, 1650, 75)]),
    );
    expect(r.wallBands).toHaveLength(0);
    expect(r.symbols).toHaveLength(1);
    expect([...r.usedLineIds].sort((p, q) => p - q)).toEqual([0, 1]);
  });

  it('わずかに傾いた線の ρ は中点で取る（始点だと厚さを取り違える）', () => {
    // 0.24° の傾きは θ=0 に丸められる。長さの違う 2 本を始点の ρ で測ると距離 265 mm で
    // 上限 250 mm を超え、中点で測ると 246 mm になる。中点でだけ帯になる
    const r = extractBands(toSegments([line('壁', 0, 0, 10000, 41.9), line('壁', 0, 265, 1000, 269.19)]));
    expect(r.wallBands).toHaveLength(1);
    expect(r.wallBands[0].rhoHi - r.wallBands[0].rhoLo).toBeCloseTo(246.1, 0);
  });

  it('刻みの境界をまたぐ 2 本は平行と見なさない（0.2° と 0.3°、−0.1° と −0.3°）', () => {
    // foldTheta の制限をそのまま固定する。差は 0.1° / 0.2° しかないが、丸めると 0 と 0.5、0 と 179.5 に分かれる
    const across = extractBands(toSegments([line('壁', 0, 0, 3000, 10.47), line('壁', 0, 120, 3000, 135.71)]));
    expect(across.wallBands).toHaveLength(0);
    const seam = extractBands(toSegments([line('壁', 0, 0, 3000, -5.24), line('壁', 0, 120, 3000, 104.29)]));
    expect(seam.wallBands).toHaveLength(0);
  });

  it('入れ子をまとめた帯の lineIds は重複しない', () => {
    const r = extractBands(toSegments([0, 25, 125, 150].map((y) => line('壁', 0, y, 4000, y))));
    expect([...r.wallBands[0].lineIds].sort((p, q) => p - q)).toEqual([0, 1, 2, 3]);
  });

  it('右から左へ引かれたほぼ水平な線も、水平線と同じ向きとして扱う', () => {
    // 179.90° は刻みに丸めると 180 になる。0 に折り返さないと水平線と別グループに落ちる
    const r = extractBands(toSegments([line('壁', 3000, 0, 0, 5), line('壁', 0, 150, 3000, 150)]));
    expect(r.wallBands).toHaveLength(1);
  });

  it('採用した帯の線は usedLineIds に入り、周期性で落ちた線は入らない', () => {
    const r = extractBands(toSegments([line('壁', 0, 0, 3000, 0), line('壁', 0, 120, 3000, 120)]));
    expect([...r.usedLineIds].sort((p, q) => p - q)).toEqual([0, 1]);
    const tiles = extractBands(toSegments([0, 150, 300, 450, 600].map((y) => line('床', 0, y, 2000, y))));
    expect(tiles.usedLineIds.size).toBe(0);
  });
});
