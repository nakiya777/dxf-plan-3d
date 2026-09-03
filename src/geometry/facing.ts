import { Vector3 } from 'three';
import type { Vec2 } from '../model/types';
import { toScene } from './coords';

/**
 * 壁芯 a→b の外向き法線（建物座標、単位ベクトル）。
 * a→b に直交する 2 方向のうち、壁芯の中点から見て `center`（建物の外接矩形の中心）と反対側を選ぶ。
 * 壁芯が中心を通る（内積 0）ときは a→b を右に 90° 回した側を返す
 */
export function outwardNormal(a: Vec2, b: Vec2, center: Vec2): Vec2 {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (L === 0) return { x: 0, y: 0 };
  const n = { x: (b.y - a.y) / L, y: -(b.x - a.x) / L };
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const toCenter = { x: center.x - mid.x, y: center.y - mid.y };
  return n.x * toCenter.x + n.y * toCenter.y > 0 ? { x: -n.x, y: -n.y } : n;
}

/**
 * 壁がカメラに向いているか。外向き法線 n とカメラへ向かうベクトル toCamera の内積が正なら正面。
 * どちらもシーン座標。真横（内積 0）は正面ではない
 */
export const facesCamera = (n: Vector3, toCamera: Vector3): boolean => n.dot(toCamera) > 0;

/**
 * 建物座標の壁芯 a, b と外接矩形の中心、カメラ位置（シーン座標）から、その壁がカメラに向いているかを返す。
 * 法線は水平なので、カメラへのベクトルの高さ成分は結果に効かない（壁の中点の高さは 0 とする）
 */
export function wallFacesCamera(a: Vec2, b: Vec2, center: Vec2, cameraPos: Vector3): boolean {
  const n = outwardNormal(a, b, center);
  const mid = toScene((a.x + b.x) / 2, (a.y + b.y) / 2, 0);
  return facesCamera(toScene(n.x, n.y, 0), cameraPos.clone().sub(mid));
}
