/**
 * DXF のバイト列と図面単位を扱う。
 * 設計書 §7.1 の手順 1（文字コード）と手順 2（単位）をこのファイルが担う。
 */

/**
 * DXF のバイト列を文字列にする。設計書 §7.1 手順 1
 *
 * UTF-8 として厳密に読んでみて、失敗したら Shift_JIS と見なす。Shift_JIS の日本語は
 * UTF-8 として不正なバイト列になるので、扱う文字コードが 2 種だけならこれで確実に判別できる。
 *
 * `$DWGCODEPAGE` の宣言はあえて見ない。R2007（AC1021）以降は本文が UTF-8 でも、
 * 日本語版 CAD の書き出しでは宣言に `ANSI_932` が残ることがある。宣言を先に信じると
 * Shift_JIS デコードに落ちてレイヤー名と部屋名が文字化けし、例外も警告も出ないまま
 * 後続の認識が空振りする。宣言より厳密デコードの成否のほうが確実である。
 */
export function decodeDxfBytes(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
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
 * `$INSUNITS` が 1 / 4 / 5 / 6 のときはそれに従う。無い・0（単位なし）・それ以外の値の
 * ときは、図面範囲の長辺が 200 未満なら m で描かれたものと見なす `[推定]`。
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
