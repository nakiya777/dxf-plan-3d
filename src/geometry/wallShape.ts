import type { Opening } from '../model/types';

/** 壁面の局所座標。s = 壁芯に沿う距離、z = 床からの高さ（mm） */
export interface SZ { s: number; z: number }
/** 壁面の輪郭（反時計回り）と穴 */
export interface WallProfile { outline: SZ[]; holes: SZ[][] }

/** 天端プロファイルのサンプル間隔（設計書 §8.6: 壁芯に沿って 100 mm 刻み） */
const SAMPLE = 100;

/**
 * 壁面の輪郭と穴を作る（設計書 §8.2）。
 * `head ≥ H` の開口は天端に抜ける切り欠きとして輪郭に含め、`head < H` の開口は穴にする
 * （`ExtrudeGeometry` は穴が外形と交わると崩れるので、この振り分けが要る）。
 * `topProfile` を渡すと天端が `max(H, topProfile(s))` になる（妻壁、§8.6）。
 * `sampleAt` は 100 mm 刻みに加えてサンプルする s（屋根面の折れ目との交点）
 */
export function buildWallProfile(
  L: number,
  H: number,
  openings: Opening[],
  topProfile?: (s: number) => number,
  sampleAt: number[] = [],
): WallProfile {
  const top = (s: number) => (topProfile ? Math.max(H, topProfile(s)) : H);
  const notches = openings.filter((o) => o.sill < H && o.head >= H).sort((a, b) => a.offset - b.offset);
  // head < H なら sill < head < H なので、穴の条件は head だけで決まる
  const holes = openings
    .filter((o) => o.head < H)
    .map((o) => [
      { s: o.offset, z: o.sill },
      { s: o.offset + o.width, z: o.sill },
      { s: o.offset + o.width, z: o.head },
      { s: o.offset, z: o.head },
    ]);

  // 天端を s の昇順に辿り、切り欠きの区間は sill まで下げる。天端が平らなら中間点は要らない
  const topEdge: SZ[] = [];
  const push = (s: number, z: number) => {
    const last = topEdge[topEdge.length - 1];
    if (!last || last.s !== s || last.z !== z) topEdge.push({ s, z });
  };
  const extra = sampleAt.filter((s) => s > 0 && s < L).sort((a, b) => a - b);
  const insideNotch = (x: number) => notches.find((n) => x > n.offset && x < n.offset + n.width);
  let s = 0;
  while (s < L) {
    // s は切り欠きの境界かその手前で止まるので、0.5 mm 先を覗けば切り欠きの区間に入ったかが決まる
    const notch = insideNotch(s + 0.5);
    if (notch) {
      push(notch.offset, top(notch.offset));
      push(notch.offset, notch.sill);
      push(notch.offset + notch.width, notch.sill);
      push(notch.offset + notch.width, top(notch.offset + notch.width));
      s = notch.offset + notch.width;
      continue;
    }
    push(s, top(s));
    if (!topProfile) {
      // 平らな天端は次の切り欠きまで飛ぶ
      const next = notches.find((n) => n.offset > s);
      s = next ? next.offset : L;
      continue;
    }
    const nextNotch = notches.find((n) => n.offset > s);
    const nextExtra = extra.find((x) => x > s);
    s = Math.min(L, s + SAMPLE, nextNotch ? nextNotch.offset : L, nextExtra ?? L);
  }
  push(L, top(L));
  const outline: SZ[] = [{ s: 0, z: 0 }, { s: L, z: 0 }, ...topEdge.reverse()];
  return { outline, holes };
}
