import { LineBasicMaterial, MeshLambertMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { MATERIALS } from '../geometry/build';
import { applySeeThroughStyle, type StyledMaterials } from './seeThroughStyle';

const fresh = (): StyledMaterials => ({
  body: new MeshLambertMaterial({ color: 0xf4f4f4 }),
  roof: new MeshLambertMaterial({ color: 0x3a3a3a }),
  edge: new LineBasicMaterial({ color: 0x1a1a1a }),
  decor: new LineBasicMaterial({ color: 0x3b7dd8 }),
  roofEdge: new LineBasicMaterial({ color: 0xe53935 }),
});

describe('applySeeThroughStyle', () => {
  it('ON: 本体は 0.85 の透過面（depthWrite あり）、稜線と青線は depthTest 無しの透過パス、屋根は不透明のまま透過パス、赤線は depthTest あり', () => {
    const m = fresh();
    applySeeThroughStyle(m, true);
    expect(m.body.transparent).toBe(true);
    expect(m.body.opacity).toBe(0.85);
    expect(m.body.depthWrite).toBe(true);
    expect(m.roof.transparent).toBe(true);
    expect(m.roof.opacity).toBe(1);
    for (const line of [m.edge, m.decor]) {
      expect(line.transparent).toBe(true);
      expect(line.depthTest).toBe(false);
    }
    expect(m.roofEdge.transparent).toBe(true);
    expect(m.roofEdge.depthTest).toBe(true);
  });
  it('OFF: ON から戻すと全部が不透明・深度検査ありの通常表示に戻る', () => {
    const m = fresh();
    applySeeThroughStyle(m, true);
    applySeeThroughStyle(m, false);
    for (const mat of [m.body, m.roof, m.edge, m.decor, m.roofEdge]) expect(mat.transparent).toBe(false);
    expect(m.body.opacity).toBe(1);
    expect(m.body.depthWrite).toBe(true);
    for (const line of [m.edge, m.decor, m.roofEdge]) expect(line.depthTest).toBe(true);
  });
  it('MATERIALS の初期状態は OFF を適用した状態と一致する（既定は通常表示）', () => {
    const m = fresh();
    applySeeThroughStyle(m, false);
    const keys = ['body', 'roof', 'edge', 'decor', 'roofEdge'] as const;
    for (const k of keys) {
      expect(MATERIALS[k].transparent).toBe(m[k].transparent);
      expect(MATERIALS[k].opacity).toBe(m[k].opacity);
      expect(MATERIALS[k].depthTest).toBe(m[k].depthTest);
    }
  });
});
