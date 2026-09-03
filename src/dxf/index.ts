import type { Plan2D } from '../model/types';
import { decodeDxfBytes } from './decode';
import { parseDxfText } from './parse';

// 外接矩形は Task 9 の範囲選択（recognize/region.ts）が使う。
// ここから出しておかないと利用側が ./parse を直接掴み、「唯一の入口」が形骸化する
export { bboxOf } from './parse';

/** ArrayBuffer → Plan2D。UI とテストの唯一の入口 */
export function loadDxf(buf: ArrayBuffer, sourceName: string): Plan2D {
  return parseDxfText(decodeDxfBytes(buf), sourceName);
}
