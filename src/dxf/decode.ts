/**
 * DXF のバイト列を文字列にする。設計書 §7.1 手順 1
 *
 * `$DWGCODEPAGE` があればそれに従い、無ければ UTF-8 として厳密に読んでみて
 * 失敗したら Shift_JIS と見なす。Shift_JIS の日本語は UTF-8 として不正な
 * バイト列になるので、この二段構えで確実に判別できる。
 */
export function decodeDxfBytes(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  // ヘッダ部は ASCII なので、先頭だけ latin1 で覗いてコードページを探す
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
  const codepage = /\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*(\S+)/i.exec(head)?.[1];
  if (codepage) {
    const isShiftJis = /932|shift|sjis|dos932/i.test(codepage);
    return new TextDecoder(isShiftJis ? 'shift_jis' : 'utf-8').decode(bytes);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Shift_JIS の日本語は UTF-8 として不正なので、ここに落ちる
    return new TextDecoder('shift_jis').decode(bytes);
  }
}

/**
 * 図面単位 → mm の倍率。設計書 §7.1 手順 2
 *
 * `$INSUNITS` があればそれに従う。無い（または 0 = 単位なし）場合は、
 * 図面範囲の長辺が 200 未満なら m で描かれたものと見なす `[推定]`。
 *
 * @param header dxf-parser が返すヘッダ変数の連想配列
 * @param extentLongSide 図面範囲の長辺（図面単位のまま）
 */
export function unitScaleFromHeader(header: Record<string, unknown>, extentLongSide: number): number {
  const units = header.$INSUNITS as number | undefined;
  if (units === 4) return 1; // mm
  if (units === 6) return 1000; // m
  if (units === 1) return 25.4; // inch
  if (units === 5) return 10; // cm
  return extentLongSide < 200 ? 1000 : 1;
}
