import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('自作フィクスチャ', () => {
  it('3 変種が存在し、UTF-8 版に通り芯ラベルと部屋名がある', () => {
    for (const f of ['sample-house.dxf', 'sample-house-sjis.dxf', 'sample-house-with-centerline.dxf']) {
      expect(existsSync(`fixtures/${f}`), f).toBe(true);
    }
    const text = readFileSync('fixtures/sample-house.dxf', 'utf-8');
    for (const label of ['X1', 'X2', 'X3', 'Y1', 'Y2', 'Y3', 'LDK', '和室', 'UP', 'DN']) expect(text).toContain(label);
  });
  it('Shift_JIS 版は UTF-8 として不正なバイト列を含む', () => {
    const bytes = readFileSync('fixtures/sample-house-sjis.dxf');
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes)).toThrow();
  });
});
