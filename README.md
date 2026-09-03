# dxf-plan-3d

DXF の平面図を読み込み、壁（開口部・階段付き）を立ち上げ、屋根を載せて簡易な建物 3D モデルを作るブラウザアプリ。

## 状態

- **2026-09-03:** 設計書ドラフト作成。実装は未着手
- 参考動画（`specs/001-dxf-massing-mvp/reference/reference.mp4`）に映るデモと機能を同一にすることがゴール

## 文書

| 文書 | 内容 |
|---|---|
| [`specs/001-dxf-massing-mvp/design.md`](specs/001-dxf-massing-mvp/design.md) | 設計書（正本）。要件・データモデル・認識ロジック・3D 生成・テスト・未確定事項 |
| `specs/001-dxf-massing-mvp/design.html` | 設計書の HTML 版。突き合わせ表を付録に含み、画像を埋め込んだ単一ファイル。`build-html.py` で MD から生成する（HTML を直接編集しない）。同じ内容を Claude の Artifact にも公開済み（非公開リンク、2026-09-03）: https://claude.ai/code/artifact/dcfa11dd-1c68-4fe3-8061-7bbd248d226f |
| [`specs/001-dxf-massing-mvp/video-parity.md`](specs/001-dxf-massing-mvp/video-parity.md) | 動画の各秒と設計書の対応表。受け入れ試験の台本を兼ねる |
| [`specs/001-dxf-massing-mvp/implementation-plan.md`](specs/001-dxf-massing-mvp/implementation-plan.md) | 実装計画。17 タスクをテスト先行の手順に分解。タスクごとに実装・仕様適合レビュー・品質レビューを回して進める。**着手時の下書きなので、コードが実装と食い違う節がある。実装済みの箇所は常にコミット済みのファイルが正** |
| `specs/001-dxf-massing-mvp/reference/` | 参考動画と読み取り済みフレーム（1 秒刻みのタイル画像、UI パネル拡大など） |
| `specs/001-dxf-massing-mvp/prototype/` | 壁認識ルールの否定実験（Python + ezdxf）。設計書 §7.0 の根拠。実装には使わない |
| `fixtures/forest-s/` | マスター提供の実図面 DXF 一式（2×4 キットハウス「フォレスト S」、Jw_cad 形式 R12・Shift_JIS）。主フィクスチャは `平面立面図.dxf` |
| `fixtures/sample-house*.dxf` | 自作フィクスチャ（動画相当のサンプル住宅。1 階と 2 階を X 方向に 12,000 mm 離して横並び）。通り芯バブルと直階段を含む。UTF-8 版・Shift_JIS 版（AC1015 + ANSI_932）・壁芯レイヤー付き版の 3 変種。`npm run make-fixtures` で `scripts/make-sample-dxf.ts` から再生成する生成物だが、テストの再現性のためコミットしている。生成ロジックを変えたら再生成してコミットすること（`src/dxf/fixtures.test.ts` が両者の一致を検査する） |

## 参考動画について

- 別の PC で録画されたもの。アプリ本体と動画内のサンプル DXF（`サンプル住宅.dxf` ほか）は手元に無い。代わりに `fixtures/forest-s/` の実図面で認識ルールを校正した
- 音声トラックは無音（−91 dB）。字幕だけが説明
- 動画から確定できない点は設計書 §13 に質問として残してある。すべて暫定値で実装に入れる
