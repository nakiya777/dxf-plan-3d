// polygon-clipping は CJS で、この名前付き import は素の Node ESM（tsx の直実行など）では解決できない。
// vitest と Vite の解決器を前提とする（どちらでも動くことは確認済み）
import { union, type MultiPolygon, type Ring } from 'polygon-clipping';
import type { Box2, Polygon, Vec2, Wall } from '../model/types';
import { totalLengthByLayer, type Band, type BandResult } from './bands';
import { CFG } from './config';
import { fromRhoS, toSeg } from './geom';

/**
 * 壁レイヤーを決める（設計書 §7.2 手順 2）。
 * 総延長が最大のレイヤーと、その 30% 以上あるレイヤーを採る（外壁と内壁がレイヤー分けされた図面のため）。
 * 名前が「壁」に当たるレイヤーは総延長を問わず加える。
 *
 * 総延長を測るのは入れ子をまとめる**前**の帯（`candidates`）。設計書 §7.0 の実測表
 * （壁 142.8 m / 建具 33.0 m / 設備 4.7 m）がその状態の値で、30% はそれに合わせた閾値。
 * まとめた後の `walls` で測ると、仕上げ線 4 本の壁だけが 6 分の 1 に圧縮されて建具が 61% に上がり、
 * 建具レイヤーが壁になる。`Band[]` ではなく `BandResult` を受けるのは、この取り違えを型で止めるため
 */
export function decideWallLayers(result: BandResult): Set<string> {
  const total = totalLengthByLayer(result.candidates);
  const max = Math.max(0, ...total.values());
  const wallLayers = new Set<string>();
  for (const [layer, len] of total) {
    if (len >= max * CFG.wallLayerRatio || CFG.layerNames.wall.test(layer)) wallLayers.add(layer);
  }
  return wallLayers;
}

/** 向き θ・法線位置の範囲 [rhoLo, rhoHi]・向き方向の区間 [s0, s1] で表した帯状の領域 */
interface Run {
  theta: number;
  rhoLo: number;
  rhoHi: number;
  s0: number;
  s1: number;
}

const rhoCenter = (r: Run) => (r.rhoLo + r.rhoHi) / 2;

/**
 * 同じ向き・同じ壁芯に乗る Run を、隙間 `maxGap` 以内でつなぐ。
 *
 * 壁芯のまとめ方は、丸めた値をキーにすると境界でグループが割れるので、ρ の昇順に並べて
 * 「前との差が許容内なら同じ壁芯」と数珠つなぎにする
 */
function joinCollinear(runs: Run[], maxGap: number): Run[] {
  const byTheta = new Map<number, Run[]>();
  for (const r of runs) {
    const list = byTheta.get(r.theta);
    if (list) list.push(r);
    else byTheta.set(r.theta, [r]);
  }

  const joined: Run[] = [];
  for (const theta of [...byTheta.keys()].sort((p, q) => p - q)) {
    const sorted = [...byTheta.get(theta)!].sort((p, q) => rhoCenter(p) - rhoCenter(q));
    const lines: Run[][] = [];
    for (const r of sorted) {
      const last = lines[lines.length - 1];
      if (last && rhoCenter(r) - rhoCenter(last[last.length - 1]) <= CFG.collinearRhoTol) last.push(r);
      else lines.push([r]);
    }

    for (const line of lines) {
      const bySpan = [...line].sort((p, q) => p.s0 - q.s0);
      let current = { ...bySpan[0] };
      for (const r of bySpan.slice(1)) {
        if (r.s0 - current.s1 <= maxGap) {
          current.s1 = Math.max(current.s1, r.s1);
          current.rhoLo = Math.min(current.rhoLo, r.rhoLo);
          current.rhoHi = Math.max(current.rhoHi, r.rhoHi);
        } else {
          joined.push(current);
          current = { ...r };
        }
      }
      joined.push(current);
    }
  }
  return joined;
}

/** Wall を Run に戻す。線分の正規化は `toSeg` と同じ規則を使う */
const wallToRun = (w: Wall): Run => {
  const seg = toSeg({ kind: 'line', layer: '', a: w.a, b: w.b }, 0);
  const half = w.thickness / 2;
  return { theta: seg.theta, rhoLo: seg.rho - half, rhoHi: seg.rho + half, s0: seg.s0, s1: seg.s1 };
};

const runToWall = (r: Run, id: string): Wall => ({
  id,
  a: fromRhoS(r.theta, rhoCenter(r), r.s0),
  b: fromRhoS(r.theta, rhoCenter(r), r.s1),
  thickness: r.rhoHi - r.rhoLo,
  exterior: false,
});

/**
 * 帯 → 壁（設計書 §7.2 手順 3）。共線の帯を隙間 50 mm 以内でつなぐ。
 * それより広い隙間は開口なので分けたまま残す（手順 4 がその隙間を読む）
 */
export function bandsToWalls(bands: Band[], wallLayers: Set<string>): Wall[] {
  const runs: Run[] = bands
    .filter((b) => wallLayers.has(b.layer))
    .map((b) => ({ theta: b.theta, rhoLo: b.rhoLo, rhoHi: b.rhoHi, s0: b.s0, s1: b.s1 }));
  return joinCollinear(runs, CFG.wallMergeGap).map((r, i) => runToWall(r, `w${i}`));
}

/** 壁の矩形（4 隅）。角を閉じるため両端を厚さの半分だけ延ばす */
export function wallRect(w: Wall): Vec2[] {
  const dx = w.b.x - w.a.x;
  const dy = w.b.y - w.a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const half = w.thickness / 2;
  const nx = -uy * half;
  const ny = ux * half;
  const ax = w.a.x - ux * half;
  const ay = w.a.y - uy * half;
  const bx = w.b.x + ux * half;
  const by = w.b.y + uy * half;
  return [
    { x: ax + nx, y: ay + ny },
    { x: bx + nx, y: by + ny },
    { x: bx - nx, y: by - ny },
    { x: ax - nx, y: ay - ny },
  ];
}

/** 環の面積（符号なし）。polygon-clipping が返す環は閉じているが、始点の重複は面積に効かない */
const ringArea = (r: Ring) =>
  Math.abs(
    r.reduce((sum, [x, y], i) => {
      const [nextX, nextY] = r[(i + 1) % r.length];
      return sum + x * nextY - nextX * y;
    }, 0),
  ) / 2;

/**
 * 壁帯の和集合の外周（設計書 §7.2 手順 5）。
 *
 * 壁は開口の位置で途切れているので、そのまま和集合を取っても輪にならない。外形を取るときだけ
 * 共線の壁を開口の最大幅（2,500 mm）までつなぎ直してから union する。これを超える隙間は
 * 開口ではなく建物の凹み（サンプルのテラス側の U 字は 2,830 mm）なので、つながずに残す。
 *
 * それでも輪にならない図面では、和集合は壁の材料分の細い環にしかならない。その場合は
 * 全壁矩形の外接矩形に落とす（外形が無いと屋根も外壁判定も作れないので、落とさず代用する）
 */
export function computeOutline(walls: Wall[]): Polygon {
  if (walls.length === 0) return [];
  const bridged = joinCollinear(walls.map(wallToRun), CFG.opening.maxGap).map((r, i) => runToWall(r, `o${i}`));
  const rects = bridged.map(wallRect);
  const polys = rects.map((r) => [r.map((p) => [p.x, p.y] as [number, number])]);

  // 例外は握り潰さない。同一矩形の重なり・面積 0 の帯・自己交差・1e-9 のずれを 600 本、
  // いずれも union は投げないことを確認済み。投げるのは環が空か座標が NaN のときだけで、
  // `wallRect` は必ず 4 点を返し、NaN の線は dxf 側の「1 mm 未満は捨てる」で落ちるので到達しない
  const merged: MultiPolygon = union(polys[0], ...polys.slice(1));
  const outer = merged.map((poly) => poly[0]).sort((p, q) => ringArea(q) - ringArea(p))[0];

  const box = bboxOfPoints(rects.flat());
  const boxArea = (box.maxX - box.minX) * (box.maxY - box.minY);
  if (!outer || ringArea(outer) < CFG.outlineMinBboxRatio * boxArea) {
    return [
      { x: box.minX, y: box.minY },
      { x: box.maxX, y: box.minY },
      { x: box.maxX, y: box.maxY },
      { x: box.minX, y: box.maxY },
    ];
  }
  return outer.slice(0, -1).map(([x, y]) => ({ x, y }));
}

/** 点が多角形の内側か（交差数判定） */
export function pointInPolygon(p: Vec2, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * 外壁の判定（設計書 §7.2 手順 5）。
 * 壁芯の中点から法線方向に「厚さ/2 + 余白」だけ離した 2 点のどちらかが外形の外なら外壁。
 * 外形は壁面から厚さの半分だけ外にあるので、外壁ならその外側の点がちょうど縁を越える
 */
export function markExterior(walls: Wall[], outline: Polygon): Wall[] {
  return walls.map((w) => {
    const mx = (w.a.x + w.b.x) / 2;
    const my = (w.a.y + w.b.y) / 2;
    const dx = w.b.x - w.a.x;
    const dy = w.b.y - w.a.y;
    const len = Math.hypot(dx, dy) || 1;
    const n = { x: -dy / len, y: dx / len };
    const d = w.thickness / 2 + CFG.exteriorProbeMargin;
    const exterior =
      !pointInPolygon({ x: mx + n.x * d, y: my + n.y * d }, outline) ||
      !pointInPolygon({ x: mx - n.x * d, y: my - n.y * d }, outline);
    return { ...w, exterior };
  });
}

export function bboxOfPoints(points: Vec2[]): Box2 {
  return points.reduce(
    (b, p) => ({
      minX: Math.min(b.minX, p.x),
      minY: Math.min(b.minY, p.y),
      maxX: Math.max(b.maxX, p.x),
      maxY: Math.max(b.maxY, p.y),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}

/** 外壁芯の外接矩形（屋根の基準。設計書 §8.4） */
export const centerlineBBox = (walls: Wall[]): Box2 => bboxOfPoints(walls.flatMap((w) => [w.a, w.b]));
