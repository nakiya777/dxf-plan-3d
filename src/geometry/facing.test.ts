import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { toScene } from './coords';
import { facesCamera, outwardNormal, wallFacesCamera } from './facing';

// 8,000 × 6,000 の建物。中心 (4000, 3000)。南壁は y = 0 の壁芯
const center = { x: 4000, y: 3000 };
const south = { a: { x: 0, y: 0 }, b: { x: 8000, y: 0 } };

describe('outwardNormal', () => {
  it('南壁の外向き法線は −Y（中心と反対側）で、a→b の向きに依らない', () => {
    for (const [a, b] of [[south.a, south.b], [south.b, south.a]]) {
      const n = outwardNormal(a, b, center);
      expect(n.x).toBeCloseTo(0);
      expect(n.y).toBeCloseTo(-1);
    }
  });
});

describe('facesCamera', () => {
  const n = new Vector3(1, 0, 0);
  it('正面（法線と同じ側にカメラ）なら true', () => expect(facesCamera(n, new Vector3(5, 3, 2))).toBe(true));
  it('背面なら false', () => expect(facesCamera(n, new Vector3(-5, 3, 2))).toBe(false));
  it('真横（内積 0）は正面ではない', () => expect(facesCamera(n, new Vector3(0, 3, 2))).toBe(false));
});

describe('wallFacesCamera', () => {
  it('南壁は建物の南側（モデル −Y）にあるカメラに向き、北側からは向かない', () => {
    // モデル −Y はシーンでは +Z 側。カメラの高さ成分は結果に効かない
    expect(wallFacesCamera(south.a, south.b, center, toScene(4000, -10000, 5000))).toBe(true);
    expect(wallFacesCamera(south.a, south.b, center, toScene(4000, 20000, 5000))).toBe(false);
  });
});
