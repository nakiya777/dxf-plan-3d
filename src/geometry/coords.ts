import { Matrix4, Vector2, Vector3 } from 'three';

/**
 * モデル (x, y, z)[mm] → シーン (x, z, −y)[m]。設計書 §4.3 の唯一の変換。
 * ジオメトリはモデル座標で組み立ててから、最後にこの行列を 1 回だけ掛ける。
 * 共有の定数なので、利用側は `clone()` してから触る
 */
export const MODEL_TO_SCENE = new Matrix4().set(
  0.001, 0, 0, 0,
  0, 0, 0.001, 0,
  0, -0.001, 0, 0,
  0, 0, 0, 1,
);

/** モデル座標の 1 点をシーン座標にする */
export const toScene = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z).applyMatrix4(MODEL_TO_SCENE);

/** シーン → モデル（ハンドルのドラッグで使う）。共有の定数なので、利用側は `clone()` してから触る */
export const SCENE_TO_MODEL = MODEL_TO_SCENE.clone().invert();

/** シーン座標の 1 点（または差分ベクトル）をモデル座標にする。変換はここ 1 か所に集約する */
export const toModel = (v: Vector3): Vector3 => v.clone().applyMatrix4(SCENE_TO_MODEL);

/** 要素の矩形（`getBoundingClientRect()`）のうち NDC 変換に要る分 */
export type ClientRect = { left: number; top: number; width: number; height: number };

/** ポインタ位置（clientX/Y）→ NDC（−1〜1、上が +）。レイキャストの入口はここ 1 か所 */
export const ndcFromPointer = (e: { clientX: number; clientY: number }, rect: ClientRect): Vector2 =>
  new Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);

/** NDC → 要素左上からの px。`ndcFromPointer` の逆変換 */
export const pxFromNdc = (ndc: { x: number; y: number }, rect: { width: number; height: number }): Vector2 =>
  new Vector2(((ndc.x + 1) / 2) * rect.width, ((1 - ndc.y) / 2) * rect.height);
