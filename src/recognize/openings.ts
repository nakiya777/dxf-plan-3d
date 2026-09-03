import type { Opening, PlanEntity, Vec2, Wall } from '../model/types';
import type { Band } from './bands';
import { CFG } from './config';
import { dirOf, dot, normalOf, toSeg, type Seg } from './geom';

type Arc = Extract<PlanEntity, { kind: 'arc' }>;

/** 壁を (θ, ρ, s0, s1) に直したもの。`toSeg` と同じ正規化なので帯・記号の θ と直接比べられる */
interface WallRun {
  wall: Wall;
  theta: number;
  rho: number;
  s0: number;
  s1: number;
}

/** 同じ向き・同じ壁芯に乗る壁の列（s 昇順） */
interface Chain {
  theta: number;
  rho: number;
  runs: WallRun[];
}

/**
 * 共線の壁を鎖にまとめる。壁芯のまとめ方は `walls.ts` の `joinCollinear` と同じで、
 * ρ 昇順に並べて「グループ先頭との差が許容内なら同じ壁芯」とする（丸めたキーだと境界で割れる）
 */
function chainsOf(walls: Wall[]): Chain[] {
  const byTheta = new Map<number, WallRun[]>();
  for (const w of walls) {
    const seg = toSeg({ kind: 'line', layer: '', a: w.a, b: w.b }, 0);
    const run: WallRun = { wall: w, theta: seg.theta, rho: seg.rho, s0: seg.s0, s1: seg.s1 };
    const list = byTheta.get(seg.theta);
    if (list) list.push(run);
    else byTheta.set(seg.theta, [run]);
  }
  const chains: Chain[] = [];
  for (const [theta, runs] of byTheta) {
    const sorted = [...runs].sort((p, q) => p.rho - q.rho);
    let current: Chain | null = null;
    for (const r of sorted) {
      if (current && r.rho - current.rho <= CFG.collinearRhoTol) current.runs.push(r);
      else chains.push((current = { theta, rho: r.rho, runs: [r] }));
    }
  }
  for (const c of chains) c.runs.sort((p, q) => p.s0 - q.s0);
  return chains;
}

const sweepOf = (a: Arc) => ((((a.endDeg - a.startDeg) % 360) + 360) % 360) || 360;
/** 弧の両端。開き戸なら一方が閉じた戸の先端、もう一方が開いた戸の先端 */
const arcEnds = (a: Arc): Vec2[] =>
  [a.startDeg, a.endDeg].map((deg) => ({
    x: a.center.x + a.radius * Math.cos((deg * Math.PI) / 180),
    y: a.center.y + a.radius * Math.sin((deg * Math.PI) / 180),
  }));

/**
 * 壁の隙間を開口にする（設計書 §7.2 手順 4）。判定は上から順に当てる
 * 1. 隙間の中に 60–100°（または 180° 前後）の弧の中心が壁芯の近くにある → 開き戸（外壁でも）。幅 = 半径、両開きは直径
 * 2. 中央線付きの帯（`symbols`）か、壁レイヤー以外の線が隙間を埋めている → 外壁なら窓、内壁ならドア（引き戸・折れ戸）
 * 3. 何も無い → 開口なしの欠き。壁は分けたまま残す
 *
 * 開口を挟む 2 本の壁は 1 本につなぎ、`offset` はつないだ壁の始点（`a`）からの距離で表す。
 * `walls` は入力の壁から開口で置き換わった分だけ本数が減る。`exterior` はどちらかが外壁なら外壁
 */
export function detectOpenings(
  walls: Wall[],
  entities: PlanEntity[],
  symbols: Band[],
  wallLayers: Set<string>,
  nonWallSegs: Seg[],
): { walls: Wall[]; openings: Opening[] } {
  const OC = CFG.opening;
  const arcs = entities.filter((e): e is Arc => e.kind === 'arc');
  const isDoorArc = (a: Arc) => {
    const sweep = sweepOf(a);
    const single = sweep >= OC.doorArc.minDeg && sweep <= OC.doorArc.maxDeg;
    const double = sweep >= OC.doubleArc.minDeg && sweep <= OC.doubleArc.maxDeg;
    return a.radius >= OC.doorArc.minR && a.radius <= OC.doorArc.maxR && (single || double);
  };
  // 記号線は壁レイヤー以外のもの（壁レイヤーの短い線は壁端の見切りなので数えない）
  const symbolSegs = nonWallSegs.filter((s) => !wallLayers.has(s.layer));

  const outWalls: Wall[] = [];
  const openings: Opening[] = [];

  for (const chain of chainsOf(walls)) {
    const u = dirOf(chain.theta);
    const n = normalOf(chain.theta);
    let cur: WallRun = { ...chain.runs[0] };
    let pending: Omit<Opening, 'wallId'>[] = [];
    const flush = () => {
      outWalls.push(cur.wall);
      for (const o of pending) openings.push({ ...o, wallId: cur.wall.id });
      pending = [];
    };

    for (const next of chain.runs.slice(1)) {
      const gapStart = cur.s1;
      const gapEnd = next.s0;
      const gap = gapEnd - gapStart;
      const thickness = Math.max(cur.wall.thickness, next.wall.thickness);
      // 点が隙間の中（向き方向は余白 along、法線方向は壁芯から across 以内）か
      const inGap = (p: Vec2, along: number, across: number) => {
        const s = dot(p, u);
        return s >= gapStart - along && s <= gapEnd + along && Math.abs(dot(p, n) - chain.rho) <= across;
      };

      let opening: Omit<Opening, 'wallId'> | null = null;
      if (gap > CFG.wallMergeGap && gap <= OC.maxGap) {
        const exterior = cur.wall.exterior || next.wall.exterior;
        const across = thickness / 2 + OC.arcCenterAcross;
        // 開き戸: 吊元（弧の中心）と閉じた戸の先端（弧の一端）がどちらも隙間の中にあり、
        // そのどちらかが隙間の端（戸当たり）に乗っている。壁の交差部では直交する 2 本の壁の隙間に同じ弧が当たるが、
        // 戸当たりに乗る条件を満たすのは戸が付いている壁だけ（もう一方では吊元も先端も隙間の途中に浮く）
        const nearJamb = (p: Vec2) => {
          const s = dot(p, u);
          return Math.abs(s - gapStart) <= OC.arcJambTol || Math.abs(s - gapEnd) <= OC.arcJambTol;
        };
        const door = arcs.find((a) => {
          if (!isDoorArc(a) || !inGap(a.center, OC.arcCenterAlong, across)) return false;
          const ends = arcEnds(a).filter((p) => inGap(p, OC.arcCenterAlong, across));
          return ends.length > 0 && (nearJamb(a.center) || ends.some(nearJamb));
        });
        if (door) {
          const leafEnd = arcEnds(door).find((p) => inGap(p, OC.arcCenterAlong, across))!;
          const sHinge = dot(door.center, u);
          const sLeaf = dot(leafEnd, u);
          const doubleLeaf = sweepOf(door) >= OC.doubleArc.minDeg;
          // 戸の範囲 [吊元, 先端] を隙間に収める。両開きは弧の中心が開口の中央なので半径ぶん左右に広げる
          const lo = Math.max(gapStart, doubleLeaf ? sHinge - door.radius : Math.min(sHinge, sLeaf));
          const hi = Math.min(gapEnd, doubleLeaf ? sHinge + door.radius : Math.max(sHinge, sLeaf));
          opening = { offset: lo - cur.s0, width: hi - lo, type: 'door', ...OC.door };
        } else {
          // 記号が隙間を「埋めている」= 壁と平行で、隙間の一定以上の長さを覆っている。
          // 壁端の枠の刻み（建具レイヤーの短い線）は隙間の縁に触れるだけなので数えない
          const covers = (s0: number, s1: number) => Math.min(s1, gapEnd) - Math.max(s0, gapStart) >= OC.symbolMinCover * gap;
          const bandFills = symbols.some(
            (b) => b.theta === chain.theta && Math.abs((b.rhoLo + b.rhoHi) / 2 - chain.rho) <= thickness && covers(b.s0, b.s1),
          );
          const lineFills = symbolSegs.some(
            (s) => s.theta === chain.theta && Math.abs(s.rho - chain.rho) <= thickness / 2 + OC.symbolAcross && covers(s.s0, s.s1),
          );
          if (bandFills || lineFills) {
            opening = exterior
              ? { offset: gapStart - cur.s0, width: gap, type: 'window', sill: gap >= OC.slidingWindowMinWidth ? 0 : OC.window.sill, head: OC.window.head }
              : { offset: gapStart - cur.s0, width: gap, type: 'door', ...OC.door };
          }
        }
      }

      if (opening) {
        pending.push(opening);
        // 隙間をまたいで 1 本の壁にする。厚さは太い方、外壁はどちらかが外壁なら外壁
        cur = {
          ...cur,
          s1: next.s1,
          wall: { ...cur.wall, b: next.wall.b, thickness, exterior: cur.wall.exterior || next.wall.exterior },
        };
      } else {
        flush();
        cur = { ...next };
      }
    }
    flush();
  }
  return { walls: outWalls, openings };
}
