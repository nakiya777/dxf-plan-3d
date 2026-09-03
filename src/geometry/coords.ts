import { Matrix4, Vector3 } from 'three';

/**
 * モデル (x, y, z)[mm] → シーン (x, z, −y)[m]。設計書 §4.3 の唯一の変換。
 * ジオメトリはモデル座標で組み立ててから、最後にこの行列を 1 回だけ掛ける
 */
export const MODEL_TO_SCENE = new Matrix4().set(
  0.001, 0, 0, 0,
  0, 0, 0.001, 0,
  0, -0.001, 0, 0,
  0, 0, 0, 1,
);

/** モデル座標の 1 点をシーン座標にする */
export const toScene = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z).applyMatrix4(MODEL_TO_SCENE);

/** シーン → モデル（ハンドルのドラッグで使う） */
export const SCENE_TO_MODEL = MODEL_TO_SCENE.clone().invert();
