import type { Plan2D } from '../model/types';
import { decodeDxfBytes } from './decode';
import { parseDxfText } from './parse';

/** ArrayBuffer → Plan2D。UI とテストの唯一の入口 */
export function loadDxf(buf: ArrayBuffer, sourceName: string): Plan2D {
  return parseDxfText(decodeDxfBytes(buf), sourceName);
}
