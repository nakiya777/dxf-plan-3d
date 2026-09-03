import type { Box2, Flight, PlanEntity, Stair, Vec2 } from '../model/types';
import { CFG } from './config';
import { overlapLen, type Seg } from './geom';
import { bboxOfPoints } from './walls';

type Text = Extract<PlanEntity, { kind: 'text' }>;

/** 等間隔に並ぶ平行線の組（踏面）。向きと外接矩形を持つ */
interface Run {
  theta: number;
  segs: Seg[];
  bbox: Box2;
}

const length = (s: Seg) => s.s1 - s.s0;
const midOf = (s: Seg): Vec2 => ({ x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 });
const expand = (b: Box2, d: number): Box2 => ({ minX: b.minX - d, minY: b.minY - d, maxX: b.maxX + d, maxY: b.maxY + d });
const inBox = (p: Vec2, b: Box2) => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
const boxesOverlap = (a: Box2, b: Box2) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

/**
 * 等間隔（200–350 mm、ばらつき 10% 以内）の平行線 4 本以上の組を探す（設計書 §7.2 手順 6）。
 * 同じレイヤー・同じ向きの線を ρ 昇順に並べ、長さがほぼ同じで向き方向に重なり、間隔が揃う限り伸ばす。
 * 組に入った線は他の組に使わない。組にならなかった線は次の起点になれる
 * （手すりの帯で 40 mm に切られた踏面線が本体と同じ ρ に並ぶ図面があり、起点を飛ばすと本体を取りこぼす）
 */
export function findRuns(segs: Seg[]): Run[] {
  const { minLines, minPitch, maxPitch, pitchTol, lengthTol, overlapRatio, minTreadLength } = CFG.stair;
  // 同じレイヤー・同じ向きの線だけが組になる（帯の抽出と同じ「同じレイヤーの線は同じ種類」の手掛かり）
  const groups = new Map<string, Seg[]>();
  for (const s of segs) {
    if (length(s) < minTreadLength) continue;
    const key = `${s.layer}|${s.theta}`;
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  }
  const runs: Run[] = [];
  const used = new Set<Seg>();
  for (const group of groups.values()) {
    group.sort((p, q) => p.rho - q.rho);
    for (let i = 0; i < group.length; i++) {
      if (used.has(group[i])) continue;
      const run = [group[i]];
      let pitch = 0;
      for (let j = i + 1; j < group.length; j++) {
        const prev = run[run.length - 1];
        const cand = group[j];
        const d = cand.rho - prev.rho;
        if (d > maxPitch) break; // ρ 昇順なので、これ以降は間隔が開きすぎる
        // 使用済み・同じ位置の重複線・向き方向に重ならない線（別の場所にあるもの）は組を壊さず飛ばす
        if (used.has(cand) || d < 1 || overlapLen(cand, prev) < overlapRatio * Math.min(length(cand), length(prev))) continue;
        const lenOk = Math.abs(length(cand) - length(prev)) <= lengthTol * Math.max(length(cand), length(prev));
        const pitchOk = d >= minPitch && (pitch === 0 || Math.abs(d - pitch) <= pitchTol * pitch);
        if (!(lenOk && pitchOk)) break;
        pitch = d;
        run.push(cand);
      }
      if (run.length >= minLines) {
        for (const s of run) used.add(s);
        runs.push({ theta: run[0].theta, segs: run, bbox: bboxOfPoints(run.flatMap((s) => [s.a, s.b])) });
      }
    }
  }
  return runs;
}

/**
 * 直交する方向にも等間隔の線の組が重なっていれば格子（タイル目地）。
 * 組の bbox に交差する直交線だけを取り出して `findRuns` にかける。側桁 2 本と矢印の軸線は
 * 本数・長さ・間隔のどれかで組にならないので、階段は格子と見なされない
 */
function isGrid(run: Run, segs: Seg[]): boolean {
  const perp = (run.theta + 90) % 180;
  const crossing = segs.filter((s) => s.theta === perp && boxesOverlap(bboxOfPoints([s.a, s.b]), run.bbox));
  return findRuns(crossing).length > 0;
}

/**
 * 矢印: 軸線の端に短い線が 2 本付いたもの。軸線の中点が `within` にあるものを探し、矢先の座標を返す
 */
function arrowTip(segs: Seg[], within: Box2): Vec2 | null {
  const { arrowHeadMax, arrowShaftMin, arrowJoinTol } = CFG.stair;
  const heads = segs.filter((s) => length(s) <= arrowHeadMax);
  const near = (p: Vec2, q: Vec2) => Math.hypot(p.x - q.x, p.y - q.y) <= arrowJoinTol;
  for (const shaft of segs) {
    if (length(shaft) < arrowShaftMin || !inBox(midOf(shaft), within)) continue;
    for (const tip of [shaft.a, shaft.b]) {
      const joined = heads.filter((h) => h !== shaft && (near(h.a, tip) || near(h.b, tip)));
      if (joined.length >= 2) return tip;
    }
  }
  return null;
}

/** 2 つの矩形の最短距離。重なっていれば 0 */
function boxDistance(a: Box2, b: Box2): number {
  const dx = Math.max(0, Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX));
  const dy = Math.max(0, Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY));
  return Math.hypot(dx, dy);
}

/** 1 次元で「離れていれば間、重なっていれば和」 */
function spanBetween(lo1: number, hi1: number, lo2: number, hi2: number): [number, number] {
  const gapLo = Math.min(hi1, hi2);
  const gapHi = Math.max(lo1, lo2);
  return gapLo < gapHi ? [gapLo, gapHi] : [Math.min(lo1, lo2), Math.max(hi1, hi2)];
}

/** 2 つの矩形の間の空き（踊り場）。x・y それぞれ `spanBetween` で決める */
function gapBox(a: Box2, b: Box2): Box2 {
  const [minX, maxX] = spanBetween(a.minX, a.maxX, b.minX, b.maxX);
  const [minY, maxY] = spanBetween(a.minY, a.maxY, b.minY, b.maxY);
  return { minX, minY, maxX, maxY };
}

/**
 * 階段の認識（設計書 §7.2 手順 6）。
 * `nonWallSegs` は壁の帯にならなかった全レイヤーの線（階段が壁と同じレイヤーにある図面のため）。
 *
 * `ascendPositive` は **図面の矢印（無ければ UP / DN の文字）が指す向き**が軸の正方向かどうか。
 * UP の階段ではそのまま上る向き、DN の階段（最上階の記号）では下る向きになる。
 * DN で「物理的に上る向き」を反転して返さないのは、最上階の DN 記号は §8.3 の吹き抜けにしか使わず、
 * 矢印の向きをそのまま持つ方が図面と突き合わせやすいため。
 * - 矢印があれば矢先が bbox のどちら側にあるか
 * - 無ければ文字の位置。UP は文字側から上る（文字が lo 側なら正方向）。DN は文字側から下る
 *
 * 1,500 mm 以内にある組は 1 つの階段にまとめ、組と組の間の空きを踊り場にする（折り返し階段）。
 * 回り段の扇形の踏面は等間隔の平行線にならないので組に入らず、踊り場側の空きとして残る
 */
export function detectStairs(nonWallSegs: Seg[], texts: Text[]): Stair[] {
  const { textDistance, arrowDistance, flightJoin } = CFG.stair;
  const runs = findRuns(nonWallSegs).filter((r) => !isGrid(r, nonWallSegs));
  const flights: Flight[] = [];
  for (const run of runs) {
    const label = texts.find((t) => /^(UP|DN|上|下)/i.test(t.text.trim()) && inBox(t.at, expand(run.bbox, textDistance)));
    const tip = arrowTip(nonWallSegs, expand(run.bbox, arrowDistance));
    if (!label && !tip) continue;
    // 踏面線が水平（θ = 0）なら Y 方向に上る。斜めなら法線の向きが大きい軸
    const axis: 'x' | 'y' = Math.abs(Math.sin((run.theta * Math.PI) / 180)) > Math.SQRT1_2 ? 'x' : 'y';
    const lo = axis === 'x' ? run.bbox.minX : run.bbox.minY;
    const hi = axis === 'x' ? run.bbox.maxX : run.bbox.maxY;
    const isDown = !!label && /^(DN|下)/i.test(label.text.trim());
    let ascendPositive: boolean;
    if (tip) {
      const c = axis === 'x' ? tip.x : tip.y;
      ascendPositive = c - lo > hi - c;
    } else {
      const c = axis === 'x' ? label!.at.x : label!.at.y;
      const labelAtLow = c - lo < hi - c;
      ascendPositive = isDown ? !labelAtLow : labelAtLow;
    }
    flights.push({ rect: run.bbox, axis, ascendPositive, treads: run.segs.length - 1 });
  }

  const stairs: Stair[] = [];
  const used = new Set<number>();
  flights.forEach((f, i) => {
    if (used.has(i)) return;
    used.add(i);
    const group = [f];
    flights.forEach((g, j) => {
      if (!used.has(j) && boxDistance(f.rect, g.rect) <= flightJoin) {
        group.push(g);
        used.add(j);
      }
    });
    const landings: Box2[] = [];
    for (let k = 0; k + 1 < group.length; k++) landings.push(gapBox(group[k].rect, group[k + 1].rect));
    stairs.push({ flights: group, landings });
  });
  return stairs;
}
