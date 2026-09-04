import type { LineBasicMaterial, MeshLambertMaterial } from 'three';

/** `applySeeThroughStyle` が切り替える材質の組（`MATERIALS` と同じ形。DOM に依存しないので vitest で固定する） */
export interface StyledMaterials {
  body: MeshLambertMaterial;
  roof: MeshLambertMaterial;
  edge: LineBasicMaterial;
  decor: LineBasicMaterial;
  roofEdge: LineBasicMaterial;
}

/** 「壁を透かす」ON のときの本体（壁・板・基礎・階段）の不透明度。参考動画の見え方 */
export const TRANSLUCENT_BODY_OPACITY = 0.85;

/**
 * 「壁を透かす」の ON/OFF で共有材質の描き方を一括で切り替える（設計書 §8.2）。
 *
 * OFF（既定）= 通常表示: 本体は不透明、線は深度検査あり。描画順は three.js の既定に任せる。
 * ON = 透過表示: 本体を 0.85 の透過面にし、稜線と青線を `depthTest` 無しで壁越しに描く。
 * 線と屋根に `transparent: true` を付けるのは色のためではなく、three.js の透過パス（本体の後）で描かせて
 * `RENDER_ORDER` の順序を効かせるため（不透明パスは透過パスより常に先に描かれる）。
 * 屋根は線の後に不透明・深度検査ありで描くので、屋根の下の稜線は屋根に隠れる。赤線は裏側の隅棟が透けて浮かないよう `depthTest` を残す。
 *
 * 材質は共有のまま、プロパティだけを書き換える。`needsUpdate` を立てて次の描画から効かせる
 */
export function applySeeThroughStyle(materials: StyledMaterials, on: boolean): void {
  const { body, roof, edge, decor, roofEdge } = materials;
  body.transparent = on;
  body.opacity = on ? TRANSLUCENT_BODY_OPACITY : 1;
  body.depthWrite = true;
  roof.transparent = on;
  for (const line of [edge, decor]) {
    line.transparent = on;
    line.depthTest = !on;
  }
  roofEdge.transparent = on;
  roofEdge.depthTest = true;
  for (const m of [body, roof, edge, decor, roofEdge]) m.needsUpdate = true;
}
