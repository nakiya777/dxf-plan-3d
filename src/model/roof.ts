import type { Box2, Roof } from './types';

export interface Vec3 { x: number; y: number; z: number }

/**
 * 屋根の解（設計書 §8.4）。座標は建物座標（mm）。
 * `planes` は上面の多角形（主面 2 枚 + 寄棟端面 0〜2 枚）、`edges` は棟と隅棟（赤線）、
 * `heightAt` は上面の高さ関数 h(x, y)。§8.6 の妻壁と geometry/ の屋根メッシュが使う
 */
export interface RoofGeom {
  ridgeZ: number;
  ridge: [Vec3, Vec3];
  planes: Vec3[][];
  edges: [Vec3, Vec3][];
  heightAt: (x: number, y: number) => number;
}

/**
 * 棟が X 方向の局所系で解き、`axis` が y なら x⇔y を入れ替えて返す。
 * `rect` は最上階の外壁芯の外接矩形（建物座標）、`He` は最上階の topZ。
 * Phase 2 の L 字平面は、矩形ブロックの列を受けてブロックごとの `planes` を連結し `heightAt` を min 合成する形で入る
 */
export function solveRoof(roof: Roof, rect: Box2, He: number): RoofGeom {
  const swap = roof.axis === 'y';
  const local = swap ? { minX: rect.minY, minY: rect.minX, maxX: rect.maxY, maxY: rect.maxX } : rect;
  const p = roof.pitchSun / 10;
  const e = roof.eave;
  const v = roof.verge;
  const [x0, x1, y0, y1] = [local.minX, local.maxX, local.minY, local.maxY];

  // 棟の横位置と棟高。ridgeOffset ≠ 0 のときは遠い側の幅で決め、両主面とも勾配 p のまま
  const yr = (y0 + y1) / 2 + roof.ridgeOffset;
  const ridgeZ = He + p * Math.max(yr - y0, y1 - yr);
  const mainHeight = (y: number) => ridgeZ - p * Math.abs(y - yr);

  // 端の種別と外形の延長（切妻はケラバの出、寄棟は軒の出）
  const gable = [roof.inset[0] <= 0, roof.inset[1] <= 0];
  const xa = x0 - (gable[0] ? v : e);
  const xb = x1 + (gable[1] ? v : e);
  const xr0 = gable[0] ? xa : x0 + roof.inset[0];
  const xr1 = gable[1] ? xb : x1 - roof.inset[1];
  const ya = y0 - e;
  const yb = y1 + e;

  // 寄棟端の面: 軒先の角 2 点 (xEave, ya), (xEave, yb) と棟端点 (xRidge, yr) を通る平面。
  // ridgeOffset ≠ 0 で両軒先の高さが違っても 3 点を通る平面は一意に決まり、planes の三角形と heightAt が一致する
  const endPlane = (xEave: number, xRidge: number) => {
    const za = mainHeight(ya);
    const zb = mainHeight(yb);
    const slopeY = (zb - za) / (yb - ya);
    const slopeX = (za - ridgeZ - slopeY * (ya - yr)) / (xEave - xRidge);
    return (x: number, y: number) => ridgeZ + slopeX * (x - xRidge) + slopeY * (y - yr);
  };
  const endPlanes = [gable[0] ? undefined : endPlane(xa, xr0), gable[1] ? undefined : endPlane(xb, xr1)];
  // 屋根の上面は主面 2 枚と端面の下側の包絡（各面は棟端点を共有し、隅棟の内側では端面が主面より高い）
  const heightLocal = (x: number, y: number) =>
    endPlanes.reduce((h, plane) => (plane ? Math.min(h, plane(x, y)) : h), mainHeight(y));
  const P = (x: number, y: number): Vec3 => ({ x, y, z: heightLocal(x, y) });

  const planes: Vec3[][] = [
    [P(xa, ya), P(xb, ya), P(xr1, yr), P(xr0, yr)], // 主面（y 小の側）
    [P(xr0, yr), P(xr1, yr), P(xb, yb), P(xa, yb)], // 主面（y 大の側）
  ];
  const edges: [Vec3, Vec3][] = [[P(xr0, yr), P(xr1, yr)]];
  if (!gable[0]) {
    planes.push([P(xa, ya), P(xr0, yr), P(xa, yb)]);
    edges.push([P(xr0, yr), P(xa, ya)], [P(xr0, yr), P(xa, yb)]);
  }
  if (!gable[1]) {
    planes.push([P(xb, ya), P(xb, yb), P(xr1, yr)]);
    edges.push([P(xr1, yr), P(xb, ya)], [P(xr1, yr), P(xb, yb)]);
  }

  const toBuilding = (q: Vec3): Vec3 => (swap ? { x: q.y, y: q.x, z: q.z } : q);
  return {
    ridgeZ,
    ridge: [toBuilding(P(xr0, yr)), toBuilding(P(xr1, yr))],
    planes: planes.map((poly) => poly.map(toBuilding)),
    edges: edges.map(([a, b]) => [toBuilding(a), toBuilding(b)]),
    heightAt: (x, y) => (swap ? heightLocal(y, x) : heightLocal(x, y)),
  };
}
