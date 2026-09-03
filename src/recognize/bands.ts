import { CFG } from './config';
import { overlapLen, type Seg } from './geom';

/**
 * 平行な線分の対が作る帯。ρ の範囲（厚さ）と s の範囲（長さ）で表す。
 * 日本の住宅図面では壁が二重線で描かれるので、帯が壁の候補になる（設計書 §7.2 手順 1）
 */
export interface Band {
  layer: string;
  theta: number;
  rhoLo: number;
  rhoHi: number;
  s0: number;
  s1: number;
  lineIds: number[];
}

/**
 * 帯の仕分け。
 * - `walls`: 壁の候補。入れ子をまとめた後の帯。まだレイヤーで絞っていないので設備・家具の平行線も混ざる（絞るのは `decideWallLayers`）
 * - `candidates`: 入れ子をまとめる前の帯。設計書 §7.0 の総延長表（壁 142.8 m / 建具 33.0 m / 設備 4.7 m）
 *   はこの状態で測ったものなので、壁レイヤーの決定（§7.2 手順 2）はこちらの総延長で行う
 * - `symbols`: 中央線を持つ帯。窓・引き戸の記号（開口の判定に使う）
 * - `periodic`: 等間隔に並ぶ帯。タイル目地・ハッチ・階段踏面
 * - `usedLineIds`: `walls` と `symbols` が使った線の id。階段の探索が「壁にならなかった線」を選ぶのに使う
 */
export interface BandResult {
  walls: Band[];
  candidates: Band[];
  symbols: Band[];
  periodic: Band[];
  usedLineIds: Set<number>;
}

/** Map への push。キーが無ければ空配列を作る */
function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function extractBands(segs: Seg[]): BandResult {
  // 同一レイヤー・同じ向きの線だけが対になりうる（設計書 §7.2 の「レイヤーは手掛かりにだけ使う」）
  const groups = new Map<string, Seg[]>();
  for (const s of segs) pushTo(groups, `${s.layer}|${s.theta}`, s);

  const walls: Band[] = [];
  const allCandidates: Band[] = [];
  const symbols: Band[] = [];
  const periodic: Band[] = [];
  const { minThickness, maxThickness, minOverlap, periodicTol, centerTol, centerMinOverlap } = CFG.band;

  for (const group of groups.values()) {
    group.sort((p, q) => p.rho - q.rho);
    const candidates: Band[] = [];
    for (let i = 0; i < group.length; i++) {
      const p = group[i];
      for (let j = i + 1; j < group.length; j++) {
        const q = group[j];
        const d = q.rho - p.rho;
        if (d > maxThickness) break; // ρ 昇順なので、これ以降はすべて厚すぎる
        if (d < minThickness) continue;
        const ov = overlapLen(p, q);
        if (ov < minOverlap) continue;

        const band: Band = {
          layer: p.layer,
          theta: p.theta,
          rhoLo: p.rho,
          rhoHi: q.rho,
          s0: Math.max(p.s0, q.s0),
          s1: Math.min(p.s1, q.s1),
          lineIds: [p.id, q.id],
        };

        // 周期性: 帯の外側に同じ間隔で平行線が続く → タイル目地・ハッチ・階段踏面
        const isPeriodic = group.some(
          (r) =>
            r !== p &&
            r !== q &&
            ((Math.abs(r.rho - q.rho - d) <= d * periodicTol && overlapLen(q, r) >= minOverlap) ||
              (Math.abs(p.rho - r.rho - d) <= d * periodicTol && overlapLen(p, r) >= minOverlap)),
        );
        if (isPeriodic) {
          periodic.push(band);
          continue;
        }

        // 中央線: 帯の中央に帯とほぼ同じ長さの線 → 窓・引き戸の記号
        const mid = (p.rho + q.rho) / 2;
        const hasCenter = group.some(
          (r) =>
            r !== p &&
            r !== q &&
            Math.abs(r.rho - mid) <= d * centerTol &&
            overlapLen(r, band) >= centerMinOverlap * ov,
        );
        if (hasCenter) {
          symbols.push(band);
          continue;
        }

        candidates.push(band);
      }
    }
    allCandidates.push(...candidates);
    walls.push(...mergeNested(candidates));
  }

  const usedLineIds = new Set<number>();
  for (const b of [...walls, ...symbols]) for (const id of b.lineIds) usedLineIds.add(id);
  return { walls, candidates: allCandidates, symbols, periodic, usedLineIds };
}

/**
 * 入れ子の帯を外側の対にまとめる（外壁の仕上げ線 4 本 → 1 帯。設計書 §7.2 手順 1）。
 * 厚い順に見て、ρ が狭い方の厚さの半分以上重なり、s も重なる帯を同じ壁と見なす
 */
function mergeNested(bands: Band[]): Band[] {
  const out: Band[] = [];
  for (const b of [...bands].sort((p, q) => q.rhoHi - q.rhoLo - (p.rhoHi - p.rhoLo))) {
    const host = out.find((o) => {
      const rhoOverlap = Math.min(o.rhoHi, b.rhoHi) - Math.max(o.rhoLo, b.rhoLo);
      const narrower = Math.min(o.rhoHi - o.rhoLo, b.rhoHi - b.rhoLo);
      return rhoOverlap >= CFG.band.nestedRhoRatio * narrower && overlapLen(o, b) >= CFG.band.minOverlap;
    });
    if (host) {
      host.rhoLo = Math.min(host.rhoLo, b.rhoLo);
      host.rhoHi = Math.max(host.rhoHi, b.rhoHi);
      host.s0 = Math.min(host.s0, b.s0);
      host.s1 = Math.max(host.s1, b.s1);
      host.lineIds.push(...b.lineIds);
    } else out.push({ ...b, lineIds: [...b.lineIds] });
  }
  return out;
}

/** レイヤーごとの帯の総延長。壁レイヤーの決定（設計書 §7.2 手順 2）に使う */
export function totalLengthByLayer(bands: Band[]): Map<string, number> {
  const total = new Map<string, number>();
  for (const b of bands) total.set(b.layer, (total.get(b.layer) ?? 0) + (b.s1 - b.s0));
  return total;
}
