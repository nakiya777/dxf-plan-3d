/**
 * 自作フィクスチャ DXF を fixtures/ に書き出す実行部。生成ロジックは ./sample-dxf.ts。
 *
 * 実行: `npm run make-fixtures`（= tsx scripts/make-sample-dxf.ts）。リポジトリのルートで実行する
 * 出力: fixtures/sample-house.dxf
 *       fixtures/sample-house-with-centerline.dxf
 *       fixtures/sample-house-sjis.dxf（cp932。$ACADVER を AC1015 に下げ $DWGCODEPAGE を明示）
 *
 * この 3 ファイルは生成物だがリポジトリにコミットする（テストの再現性のため）。
 * 生成ロジックを変えたら必ず再生成してコミットすること。
 * src/dxf/fixtures.test.ts がコミット済みの内容と buildDxf() の出力の一致を検査するので、
 * 再生成を忘れるとテストが落ちる。
 */
import iconv from 'iconv-lite';
import { writeFileSync } from 'node:fs';
import { buildDxf, buildSjisText } from './sample-dxf';

const utf8 = buildDxf(false);
writeFileSync('fixtures/sample-house.dxf', utf8, 'utf-8');
writeFileSync('fixtures/sample-house-with-centerline.dxf', buildDxf(true), 'utf-8');
writeFileSync('fixtures/sample-house-sjis.dxf', iconv.encode(buildSjisText(utf8), 'cp932'));
console.log('fixtures written');
