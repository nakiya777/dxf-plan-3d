/**
 * 動画のサンプル住宅に相当する平面図 DXF を組み立てる（生成ロジックのみ）。
 * 1 階と 2 階を X 方向に 12,000 mm 離して横並びに置く。単位 mm。
 * レイヤー: 壁 / 建具 / 階段 / 通り芯 / 文字 / 図枠（壁芯版は 壁芯 を追加）
 *
 * ファイルへの書き出しは scripts/make-sample-dxf.ts が行う。
 * ここに副作用を置かないこと（src/dxf/fixtures.test.ts が import して
 * コミット済みの生成物と突き合わせるため）。
 */
import { DxfWriter, point3d } from '@tarikjabiri/dxf';

/** レイヤー名の唯一の定義。生リテラルを各所に散らさない */
const LAYER = {
  wall: '壁',
  fitting: '建具',
  stair: '階段',
  axis: '通り芯',
  text: '文字',
  frame: '図枠',
  core: '壁芯',
} as const;

/** 壁に開ける開口。offset は壁始点からの距離、swing はドアの開く向き */
type Opening = { offset: number; width: number } & ({ type: 'door'; swing?: 1 | -1 } | { type: 'window' });
/** 壁の定義。a→b が壁芯、t が壁厚 */
type WallDef = { a: [number, number]; b: [number, number]; t: number; openings?: Opening[] };

const MOD = 910;
const GRID = [0, 4 * MOD, 8 * MOD]; // 0 / 3,640 / 7,280
const STAIR_TREADS = 9;             // 踏面の段数（踏面線はこれ + 1 本引く）
const STAIR_PITCH = 300;            // 踏面の間隔

function makePlan(dxf: DxfWriter, ox: number, floor: 1 | 2, withCenterline: boolean) {
  const P = (x: number, y: number) => point3d(ox + x, y, 0);
  const line = (layer: string, x1: number, y1: number, x2: number, y2: number) => dxf.addLine(P(x1, y1), P(x2, y2), { layerName: layer });
  const text = (layer: string, x: number, y: number, h: number, s: string) => dxf.addText(P(x, y), h, s, { layerName: layer });

  const WALL_T_EXT = 150, WALL_T_INT = 120; // 外壁厚 / 内壁厚
  const [x0, x1, x2] = GRID, [y0, y1, y2] = GRID;

  // 壁: 壁芯 a→b、厚さ t。開口の位置で二重線を切る。窓は帯の内側に細線 2 本、ドアは弧 + 戸の線
  const wall = (w: WallDef) => {
    const [ax, ay] = w.a, [bx, by] = w.b;
    const len = Math.hypot(bx - ax, by - ay);
    const ux = (bx - ax) / len, uy = (by - ay) / len;   // 壁方向
    const nx = -uy, ny = ux;                             // 法線
    const at = (s: number, off: number): [number, number] => [ax + ux * s + nx * off, ay + uy * s + ny * off];
    const cuts = [...(w.openings ?? [])].sort((p, q) => p.offset - q.offset);
    let s = 0;
    for (const o of [...cuts, { offset: len, width: 0, type: 'window' as const }]) {
      for (const side of [w.t / 2, -w.t / 2]) {
        const [x1, y1] = at(s, side), [x2, y2] = at(o.offset, side);
        // 開口が壁端に接するとゼロ長の線ができるので、1 mm 未満の区間は捨てる
        if (o.offset - s > 1) line(LAYER.wall, x1, y1, x2, y2);
      }
      s = o.offset + o.width;
    }
    if (withCenterline) { const [x1, y1] = at(0, 0), [x2, y2] = at(len, 0); line(LAYER.core, x1, y1, x2, y2); }
    for (const o of cuts) {
      if (o.type === 'window') {
        for (const off of [w.t / 6, -w.t / 6]) {
          const [x1, y1] = at(o.offset, off), [x2, y2] = at(o.offset + o.width, off);
          line(LAYER.fitting, x1, y1, x2, y2);
        }
      } else {
        const swing = o.swing ?? 1;
        const [cx, cy] = at(o.offset, 0);                 // 吊元
        const [lx, ly] = at(o.offset, swing * o.width);   // 戸の先端（壁に直交して開いた状態）
        line(LAYER.fitting, cx, cy, lx, ly);
        const base = Math.atan2(uy, ux) * 180 / Math.PI;
        const start = swing === 1 ? base : base - 90, end = swing === 1 ? base + 90 : base;
        dxf.addArc(P(cx, cy), o.width, start, end, { layerName: LAYER.fitting });
      }
    }
  };

  // 階段: 踏面線 10 本（踏面 9 段、間隔 300）+ 側桁 2 本 + 矢印線 + UP/DN 文字
  const stair = (sx: number, sy: number, w: number, label: 'UP' | 'DN') => {
    const depth = STAIR_TREADS * STAIR_PITCH;
    for (let i = 0; i <= STAIR_TREADS; i++) {
      line(LAYER.stair, sx, sy + i * STAIR_PITCH, sx + w, sy + i * STAIR_PITCH);
    }
    line(LAYER.stair, sx, sy, sx, sy + depth);
    line(LAYER.stair, sx + w, sy, sx + w, sy + depth);
    // 昇り方向の矢印。UP は奥（+Y）へ、DN は手前（−Y）へ向ける
    const cx = sx + w / 2;
    const tipY = label === 'UP' ? sy + depth - 100 : sy + 100;
    const tailY = label === 'UP' ? sy + 100 : sy + depth - 100;
    line(LAYER.stair, cx, tailY, cx, tipY);
    const dir = label === 'UP' ? -1 : 1; // 矢じりは進行方向と逆側に開く
    line(LAYER.stair, cx, tipY, cx - 80, tipY + dir * 150);
    line(LAYER.stair, cx, tipY, cx + 80, tipY + dir * 150);
    text(LAYER.text, cx - 120, tailY + (label === 'UP' ? -350 : 150), 200, label);
  };

  if (floor === 1) {
    wall({ a: [x0, y0], b: [x2, y0], t: WALL_T_EXT, openings: [{ offset: 1000, width: 1820, type: 'window' }, { offset: 5000, width: 900, type: 'door' }] }); // 南: 掃き出し窓・玄関
    wall({ a: [x2, y0], b: [x2, y2], t: WALL_T_EXT, openings: [{ offset: 1200, width: 1200, type: 'window' }, { offset: 5000, width: 1200, type: 'window' }] });
    wall({ a: [x2, y2], b: [x0, y2], t: WALL_T_EXT, openings: [{ offset: 1500, width: 1650, type: 'window' }, { offset: 5000, width: 1200, type: 'window' }] });
    wall({ a: [x0, y2], b: [x0, y0], t: WALL_T_EXT, openings: [{ offset: 2000, width: 1650, type: 'window' }] });
    wall({ a: [x1, y0], b: [x1, y2], t: WALL_T_INT, openings: [{ offset: 1000, width: 780, type: 'door', swing: -1 }, { offset: 5200, width: 780, type: 'door' }] }); // LDK と右側の間
    wall({ a: [x1, y1], b: [x2, y1], t: WALL_T_INT, openings: [{ offset: 2500, width: 780, type: 'door' }] });              // 右側の中仕切り
    wall({ a: [x1 + MOD, y0], b: [x1 + MOD, y1], t: WALL_T_INT, openings: [{ offset: 2000, width: 780, type: 'door' }] });  // 階段室と玄関の間
    stair(x1 + WALL_T_INT / 2, y1 + 200, MOD - WALL_T_INT, 'UP');
    for (const [x, y, s] of [[1200, 3600, 'LDK'], [4500, 5500, '和室'], [6000, 5500, '浴室'], [6000, 4200, '洗面'], [5000, 1500, '廊下'], [6200, 600, '玄関']] as const) text(LAYER.text, x, y, 250, s);
  } else {
    wall({ a: [x0, y0], b: [x2, y0], t: WALL_T_EXT, openings: [{ offset: 1000, width: 1650, type: 'window' }, { offset: 5000, width: 1650, type: 'window' }] });
    wall({ a: [x2, y0], b: [x2, y2], t: WALL_T_EXT, openings: [{ offset: 1200, width: 1200, type: 'window' }, { offset: 5000, width: 1200, type: 'window' }] });
    wall({ a: [x2, y2], b: [x0, y2], t: WALL_T_EXT, openings: [{ offset: 1500, width: 1650, type: 'window' }, { offset: 5000, width: 1650, type: 'window' }] });
    wall({ a: [x0, y2], b: [x0, y0], t: WALL_T_EXT, openings: [{ offset: 1200, width: 1200, type: 'window' }, { offset: 5000, width: 1200, type: 'window' }] });
    wall({ a: [x1, y0], b: [x1, y2], t: WALL_T_INT, openings: [{ offset: 1000, width: 780, type: 'door', swing: -1 }, { offset: 5200, width: 780, type: 'door' }] });
    wall({ a: [x0, y1], b: [x2, y1], t: WALL_T_INT, openings: [{ offset: 1500, width: 780, type: 'door' }, { offset: 5500, width: 780, type: 'door' }] });
    stair(x1 + WALL_T_INT / 2, y1 + 200, MOD - WALL_T_INT, 'DN');
    for (const [x, y, s] of [[1200, 5500, '洋室A'], [5500, 5500, '洋室B'], [1200, 1500, '洋室C'], [5500, 1500, '洋室D'], [4200, 1500, '廊下']] as const) text(LAYER.text, x, y, 250, s);
  }

  // 通り芯: 壁より 1,000 外まで延ばし、両端に円 r=250 とラベル
  GRID.forEach((gx, i) => {
    line(LAYER.axis, gx, y0 - 1000, gx, y2 + 1000);
    for (const yy of [y0 - 1250, y2 + 1250]) {
      dxf.addCircle(P(gx, yy), 250, { layerName: LAYER.axis });
      text(LAYER.axis, gx - 120, yy - 100, 200, `X${i + 1}`);
    }
  });
  GRID.forEach((gy, i) => {
    line(LAYER.axis, x0 - 1000, gy, x2 + 1000, gy);
    for (const xx of [x0 - 1250, x2 + 1250]) {
      dxf.addCircle(P(xx, gy), 250, { layerName: LAYER.axis });
      text(LAYER.axis, xx - 120, gy - 100, 200, `Y${i + 1}`);
    }
  });
  text(LAYER.frame, 2500, y2 + 1800, 350, floor === 1 ? '1階平面図' : '2階平面図');
}

/** 1 階と 2 階を横並びに置いた DXF 文字列を返す。withCenterline なら壁芯レイヤーも足す */
export function buildDxf(withCenterline: boolean): string {
  const dxf = new DxfWriter();
  for (const name of Object.values(LAYER)) {
    if (name === LAYER.core && !withCenterline) continue; // 壁芯は壁芯版だけに置く
    dxf.addLayer(name, 7);
  }
  makePlan(dxf, 0, 1, withCenterline);
  makePlan(dxf, 12000, 2, withCenterline);
  return dxf.stringify();
}

/**
 * Shift_JIS 版の元になる文字列を作る。版を AC1015 に下げ、$DWGCODEPAGE を明示する。
 * cp932 への符号化は呼び出し側で行う。
 * 置換が空振りしていないことは src/dxf/fixtures.test.ts が生成物のヘッダで検査する。
 */
export function buildSjisText(utf8: string): string {
  return utf8
    .replace('AC1021', 'AC1015')
    .replace(/(\$ACADVER\n\s*1\n\s*AC1015)/, '$1\n9\n$DWGCODEPAGE\n3\nANSI_932');
}
