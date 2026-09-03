import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeDxfBytes, unitScaleFromHeader } from './decode';

const load = (p: string) => new Uint8Array(readFileSync(p)).buffer;

describe('decodeDxfBytes', () => {
  it('forest-s（R12・コードページ無し）を Shift_JIS として読める', () => {
    const text = decodeDxfBytes(load('fixtures/forest-s/平面立面図.dxf'));
    expect(text).toContain('１階平面図');
    expect(text).toContain('L.D.K.');
  });
  it('$DWGCODEPAGE=ANSI_932 の自作版を読める', () => {
    expect(decodeDxfBytes(load('fixtures/sample-house-sjis.dxf'))).toContain('和室');
  });
  it('UTF-8 版はそのまま読める', () => {
    expect(decodeDxfBytes(load('fixtures/sample-house.dxf'))).toContain('和室');
  });
});

describe('unitScaleFromHeader', () => {
  it('$INSUNITS 4 は 1、6 は 1000、1 は 25.4、5 は 10', () => {
    expect(unitScaleFromHeader({ $INSUNITS: 4 }, 50000)).toBe(1);
    expect(unitScaleFromHeader({ $INSUNITS: 6 }, 50)).toBe(1000);
    expect(unitScaleFromHeader({ $INSUNITS: 1 }, 2000)).toBeCloseTo(25.4);
    // cm の図面は実在する。この分岐が無いと図面範囲からの推定に落ち、建物が 100 倍小さくなる
    expect(unitScaleFromHeader({ $INSUNITS: 5 }, 500)).toBe(10);
  });
  it('無指定は範囲の長辺で推定する', () => {
    expect(unitScaleFromHeader({}, 58870)).toBe(1); // forest-s は mm
    expect(unitScaleFromHeader({}, 58.87)).toBe(1000); // m で描かれた図面
  });
});
