import type { PlanEntity, Vec2 } from '../model/types';
import { CFG } from './config';

/**
 * 線分を「向き θ・法線方向の位置 ρ・向き方向の区間 [s0, s1]」で表す。
 * 平行判定と帯の抽出が θ でのグループ分けと ρ・s の 1 次元比較だけで済む。
 *
 * `id` は `toSegments` に渡した配列の添字。呼び出し側が同じ配列を持っている前提の識別子で、
 * DXF のハンドルとは無関係（設計書 §7.1-4）。
 */
export interface Seg {
  id: number;
  layer: string;
  theta: number;
  rho: number;
  s0: number;
  s1: number;
  a: Vec2;
  b: Vec2;
}

export const dirOf = (thetaDeg: number): Vec2 => ({
  x: Math.cos((thetaDeg * Math.PI) / 180),
  y: Math.sin((thetaDeg * Math.PI) / 180),
});

export const normalOf = (thetaDeg: number): Vec2 => {
  const u = dirOf(thetaDeg);
  return { x: -u.y, y: u.x };
};

export const dot = (p: Vec2, q: Vec2) => p.x * q.x + p.y * q.y;

/**
 * 角度を [0, 180) に折り畳み、刻みに丸める。
 * 線分に向きの区別は要らないので 180° 周期にする。丸めた結果が 180 になったら 0 に戻す
 * （右向きの水平線と左向きの水平線を同じグループに入れるため）
 */
export function foldTheta(deg: number): number {
  const step = CFG.thetaStepDeg;
  const folded = ((deg % 180) + 180) % 180;
  const snapped = Math.round(folded / step) * step;
  return snapped >= 180 ? 0 : snapped;
}

export function toSeg(e: Extract<PlanEntity, { kind: 'line' }>, id: number): Seg {
  const theta = foldTheta((Math.atan2(e.b.y - e.a.y, e.b.x - e.a.x) * 180) / Math.PI);
  const u = dirOf(theta);
  const n = normalOf(theta);
  const sa = dot(e.a, u);
  const sb = dot(e.b, u);
  // θ を刻みに丸めた分だけ両端の ρ がずれるので、中点の値を線分の ρ とする
  return {
    id,
    layer: e.layer,
    theta,
    rho: (dot(e.a, n) + dot(e.b, n)) / 2,
    s0: Math.min(sa, sb),
    s1: Math.max(sa, sb),
    a: e.a,
    b: e.b,
  };
}

/** 線分だけを Seg にする。`id` は渡した配列の添字なので、線以外を含んでいても添字は保たれる */
export function toSegments(entities: PlanEntity[]): Seg[] {
  const out: Seg[] = [];
  entities.forEach((e, i) => {
    if (e.kind === 'line') out.push(toSeg(e, i));
  });
  return out;
}

/** (θ, ρ, s) → 平面座標 */
export const fromRhoS = (theta: number, rho: number, s: number): Vec2 => {
  const u = dirOf(theta);
  const n = normalOf(theta);
  return { x: u.x * s + n.x * rho, y: u.y * s + n.y * rho };
};

/** 向き方向の重なり長。離れていれば負になる */
export const overlapLen = (p: { s0: number; s1: number }, q: { s0: number; s1: number }) =>
  Math.min(p.s1, q.s1) - Math.max(p.s0, q.s0);

export const length = (s: Seg) => s.s1 - s.s0;
