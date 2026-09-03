import { readFileSync } from 'node:fs';
import DxfParser from 'dxf-parser';
import { describe, expect, it } from 'vitest';
import type { PlanEntity } from '../model/types';
import { decodeDxfBytes } from './decode';
import { loadDxf } from './index';
import { parseDxfText } from './parse';

const FOREST_S = 'fixtures/forest-s/平面立面図.dxf';
const readBuffer = (p: string) => new Uint8Array(readFileSync(p)).buffer;
const load = (p: string) => loadDxf(readBuffer(p), p);

/**
 * 設計書 §7.1 手順 5 で捨てられる 1 mm 未満の線の本数。
 * 内訳はレイヤー `_f-e_254` に 80 本・`_0-3_3`（建具）に 6 本で、長さは 0.0027〜0.9999 mm。
 * この図面に非表示レイヤーとペーパー空間のエンティティは無いので、減るのはこの分だけ。
 */
const FOREST_S_SUB_MM_LINES = 86;

describe('loadDxf', () => {
  it('forest-s: R12 を取りこぼさず読める（LINE 8211 / TEXT 171 / CIRCLE 94 / ARC 11）', () => {
    // 正規化で本数が変わるので、読み込みの完全性は生の解析結果で確かめる
    const parsed = new DxfParser().parseSync(decodeDxfBytes(readBuffer(FOREST_S)));
    const rawCount = (type: string) => parsed!.entities.filter((e) => e.type === type).length;
    expect(rawCount('LINE')).toBe(8211);
    expect(rawCount('TEXT')).toBe(171);
    expect(rawCount('CIRCLE')).toBe(94);
    expect(rawCount('ARC')).toBe(11);
  });
  it('forest-s: 正規化後は 1 mm 未満の線だけが減り、図面範囲が保たれる', () => {
    const plan = load(FOREST_S);
    const count = (k: string) => plan.entities.filter((e) => e.kind === k).length;
    expect(count('line')).toBe(8211 - FOREST_S_SUB_MM_LINES);
    expect(count('text')).toBe(171);
    expect(count('circle')).toBe(94);
    expect(count('arc')).toBe(11);
    // 58,870 × 41,580 は $EXTMAX（A1 判 1:100 の用紙の限界）で、図枠はそこから 707.5 mm 内側にある。
    // Plan2D.bbox はエンティティの外接矩形なので、最右の図枠線 x = 58162.5 が上端になる
    expect(plan.bbox.maxX).toBeCloseTo(58162.5, 1);
    expect(plan.bbox.minX).toBeCloseTo(707.5, 1);
  });
  it('forest-s: 弧の角度は度で、玄関ドアの弧が 270→0 になっている', () => {
    const plan = load(FOREST_S);
    const arc = plan.entities.find((e) => e.kind === 'arc' && Math.abs(e.center.x - 9792) < 2);
    expect(arc && arc.kind === 'arc' && arc.startDeg).toBeCloseTo(270, 0);
  });
  it('自作版: レイヤー名が保たれ、通り芯の円が 12 個ある', () => {
    const plan = load('fixtures/sample-house.dxf');
    expect(plan.entities.filter((e) => e.kind === 'circle' && e.layer === '通り芯').length).toBe(24); // 1 階 12 + 2 階 12
    expect(new Set(plan.entities.map((e) => e.layer))).toContain('壁');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 実フィクスチャに無い経路（ブロック展開・バルジ・MTEXT・非表示レイヤー・m 単位）は
// 最小の DXF を組み立てて確かめる。設計書 §7.1 手順 2・3、§11.2「ブロック展開」
// ───────────────────────────────────────────────────────────────────────────

/** 群コードと値の並びを DXF の本文にする */
const dxfText = (...pairs: (string | number)[]) => pairs.join('\n') + '\n';

/** 90 度の弧に相当するバルジ（バルジ = tan(掃引角 / 4)） */
const BULGE_90 = Math.tan(Math.PI / 8);

const SYNTHETIC = dxfText(
  0, 'SECTION', 2, 'HEADER',
  9, '$INSUNITS', 70, 4,
  0, 'ENDSEC',
  0, 'SECTION', 2, 'TABLES',
  0, 'TABLE', 2, 'LAYER',
  0, 'LAYER', 2, 'ブロック', 70, 0, 62, 7,
  0, 'LAYER', 2, 'ポリ', 70, 0, 62, 7,
  0, 'LAYER', 2, '文字', 70, 0, 62, 7,
  0, 'LAYER', 2, 'スプライン', 70, 0, 62, 7,
  0, 'LAYER', 2, '非表示', 70, 0, 62, -7,
  0, 'LAYER', 2, '凍結', 70, 1, 62, 7,
  0, 'ENDTAB',
  0, 'ENDSEC',
  0, 'SECTION', 2, 'BLOCKS',
  // 子ブロック: 基点 (10, 0)、そこから見て X 方向に 100 の線と、原点の半径 10 の円
  0, 'BLOCK', 2, 'CHILD', 10, 10, 20, 0,
  0, 'LINE', 8, 'ブロック', 10, 0, 20, 0, 11, 100, 21, 0,
  0, 'CIRCLE', 8, 'ブロック', 10, 0, 20, 0, 40, 10,
  0, 'ENDBLK',
  // 親ブロック: 子を (0, 50) に置くだけ（入れ子 2 段）
  0, 'BLOCK', 2, 'PARENT', 10, 0, 20, 0,
  0, 'INSERT', 8, 'ブロック', 2, 'CHILD', 10, 0, 20, 50,
  0, 'ENDBLK',
  0, 'ENDSEC',
  0, 'SECTION', 2, 'ENTITIES',
  // 親を (1000, 2000)・2 倍・90 度回転で配置
  0, 'INSERT', 8, 'ブロック', 2, 'PARENT', 10, 1000, 20, 2000, 41, 2, 42, 2, 50, 90,
  0, 'LINE', 8, '非表示', 10, 0, 20, 0, 11, 5000, 21, 0,
  0, 'LINE', 8, '凍結', 10, 0, 20, 0, 11, 5000, 21, 5000,
  // (0,0) から (1000,0) へ、反時計回りに 90 度膨らむ弧
  0, 'LWPOLYLINE', 8, 'ポリ', 90, 2, 70, 0, 10, 0, 20, 0, 42, BULGE_90, 10, 1000, 20, 0,
  0, 'MTEXT', 8, '文字', 10, 200, 20, 300, 40, 250, 1, '{\\fMS Gothic|b0|i0|c128|p49;和室}\\P8畳',
  0, 'SPLINE', 8, 'スプライン', 10, 0, 20, 0, 10, 100, 20, 200, 10, 300, 20, 200, 10, 400, 20, 0,
  0, 'ENDSEC',
  0, 'EOF',
);

/** m で描かれた図面（$INSUNITS 無し・図面範囲の長辺 10） */
const METER_DRAWING = dxfText(
  0, 'SECTION', 2, 'HEADER',
  9, '$EXTMIN', 10, 0, 20, 0,
  9, '$EXTMAX', 10, 10, 20, 8,
  0, 'ENDSEC',
  0, 'SECTION', 2, 'ENTITIES',
  0, 'LINE', 8, '0', 10, 0, 20, 0, 11, 10, 21, 0,
  0, 'CIRCLE', 8, '0', 10, 5, 20, 4, 40, 1,
  0, 'TEXT', 8, '0', 10, 2, 20, 3, 40, 0.3, 1, '寝室',
  0, 'ENDSEC',
  0, 'EOF',
);

const onLayer = (entities: PlanEntity[], layer: string) => entities.filter((e) => e.layer === layer);

describe('parseDxfText: ブロック展開', () => {
  const plan = parseDxfText(SYNTHETIC, 'synthetic');

  // CHILD の点 p は、内側の INSERT で p − 基点(10,0) + (0,50)、
  // 外側の INSERT で (1000,2000) + R(90°) S(2) を受ける。
  // (0,0) → (−10,50) → (900,1980)、(100,0) → (90,50) → (900,2180)
  it('入れ子の INSERT に平行移動・回転・スケール・ブロック基点が正しく合成される', () => {
    const [line] = onLayer(plan.entities, 'ブロック').filter((e) => e.kind === 'line');
    if (line?.kind !== 'line') throw new Error('線ではない');
    expect(line.a.x).toBeCloseTo(900, 6);
    expect(line.a.y).toBeCloseTo(1980, 6);
    expect(line.b.x).toBeCloseTo(900, 6);
    expect(line.b.y).toBeCloseTo(2180, 6);
  });

  it('ブロック内の円は中心が変換され、半径がスケール倍になる', () => {
    const [circle] = onLayer(plan.entities, 'ブロック').filter((e) => e.kind === 'circle');
    if (circle?.kind !== 'circle') throw new Error('円ではない');
    expect(circle.center.x).toBeCloseTo(900, 6);
    expect(circle.center.y).toBeCloseTo(1980, 6);
    expect(circle.radius).toBeCloseTo(20, 6);
  });

  it('OFF・フリーズのレイヤーは取り込まない', () => {
    expect(onLayer(plan.entities, '非表示')).toHaveLength(0);
    expect(onLayer(plan.entities, '凍結')).toHaveLength(0);
  });
});

describe('parseDxfText: バルジ付きポリライン', () => {
  const plan = parseDxfText(SYNTHETIC, 'synthetic');
  const segments = onLayer(plan.entities, 'ポリ').filter((e) => e.kind === 'line');

  it('1 区間が 8 本の線分になり、端点がつながって終点に着く', () => {
    expect(segments).toHaveLength(8);
    const first = segments[0]!;
    if (first.kind !== 'line') throw new Error('線分ではない');
    expect(first.a.x).toBeCloseTo(0, 6);
    expect(first.a.y).toBeCloseTo(0, 6);
    const last = segments[7]!;
    if (last.kind !== 'line') throw new Error('線分ではない');
    expect(last.b.x).toBeCloseTo(1000, 6);
    expect(last.b.y).toBeCloseTo(0, 6);
    for (let i = 1; i < segments.length; i++) {
      const prev = segments[i - 1]!, cur = segments[i]!;
      if (prev.kind !== 'line' || cur.kind !== 'line') throw new Error('線分ではない');
      expect(cur.a).toEqual(prev.b);
    }
  });

  it('正のバルジは反時計回り、つまり弦の下側に膨らむ', () => {
    // 弦 (0,0)–(1000,0) を 90 度反時計回りに回る弧の中心は (500, 500)、半径 707.1
    const points = segments.flatMap((e) => (e.kind === 'line' ? [e.a, e.b] : []));
    for (const p of points) expect(Math.hypot(p.x - 500, p.y - 500)).toBeCloseTo(500 * Math.SQRT2, 6);
    expect(Math.min(...points.map((p) => p.y))).toBeCloseTo(500 - 500 * Math.SQRT2, 6);
  });
});

describe('parseDxfText: MTEXT とスプライン', () => {
  const plan = parseDxfText(SYNTHETIC, 'synthetic');

  it('MTEXT の書式コードと括弧を落として素の文字列にする', () => {
    const [text] = onLayer(plan.entities, '文字');
    if (text?.kind !== 'text') throw new Error('文字ではない');
    expect(text.text).toBe('和室 8畳');
    expect(text.at).toEqual({ x: 200, y: 300 });
    expect(text.height).toBe(250);
  });

  it('SPLINE は制御点を結ぶ折れ線にする', () => {
    expect(onLayer(plan.entities, 'スプライン')).toHaveLength(3);
  });
});

describe('parseDxfText: 単位の正規化', () => {
  it('$INSUNITS が無く図面範囲が小さければ m と見なして 1000 倍する', () => {
    const plan = parseDxfText(METER_DRAWING, 'meter');
    const line = plan.entities.find((e) => e.kind === 'line');
    const circle = plan.entities.find((e) => e.kind === 'circle');
    const text = plan.entities.find((e) => e.kind === 'text');
    expect(line?.kind === 'line' && line.b.x).toBeCloseTo(10000, 6);
    expect(circle?.kind === 'circle' && circle.center.x).toBeCloseTo(5000, 6);
    expect(circle?.kind === 'circle' && circle.radius).toBeCloseTo(1000, 6);
    expect(text?.kind === 'text' && text.height).toBeCloseTo(300, 6);
    expect(plan.bbox).toEqual({ minX: 0, minY: 0, maxX: 10000, maxY: 5000 });
  });
});
