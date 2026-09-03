# DXF 平面図 → 3D 建物モデル生成アプリ 実装計画

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 設計書 [`design.md`](design.md) v0.1.0 の MVP（R1〜R13）を、ブラウザ完結の Web アプリとして動かす。

**Architecture:** 不変の `BuildingModel` を中心に、`dxf/`（読み込み）→ `recognize/`（認識）→ `model/`（操作）→ `geometry/`（three.js ジオメトリ）→ `viewer/`（シーンとハンドル）→ `ui/`（React）の一方向依存で組む。`dxf/` `recognize/` `model/` `geometry/` は three.js の DOM 非依存部分だけを使い、vitest（Node）で網羅する。操作は Playwright で試す。

**Tech Stack:** Vite + React 19 + TypeScript / three.js 0.185 / dxf-parser 1.1 / polygon-clipping 0.15 / vitest / Playwright。テスト用 DXF の生成に @tarikjabiri/dxf と iconv-lite。

**作成日:** 2026-09-03　**根拠:** 設計書 v0.1.0（Q4・Q7・Q9 回答反映済み）

---

## 進め方の約束

- **設計書が正**。この計画は設計書の節番号で参照し、規定を繰り返さない。矛盾したら設計書を直してから進める
- 各タスクは「失敗するテストを書く → 落ちるのを見る → 最小実装 → 通るのを見る → コミット」の順。テストが無いタスク（viewer / ui）は「動かして見る」を代わりに置く
- コミットは 1 タスク 1 回以上。メッセージは `feat|test|chore: 日本語の要約` とし、末尾に次のトレーラーを付ける

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

- コード内のコメントと docstring は日本語。変数名は英語
- 依存を足したら **`supply-chain-check` スキル**を呼ぶ（Task 1 と Task 17）
- 座標は設計書 §4.3 の不変条件に従う。モデルは mm・Z 上、シーンは m・Y 上。変換は `src/geometry/coords.ts` の 1 か所だけ

## タスク一覧（設計書 §15 のフェーズ対応）

| Task | 内容 | フェーズ | 受け入れ条件 |
|---|---|---|---|
| 1 | 雛形・依存・テスト基盤 | 0 | – |
| 2 | 自作フィクスチャ生成スクリプト | 0 | – |
| 3 | `dxf/decode.ts` 文字コードと単位 | 0 | – |
| 4 | `dxf/parse.ts` dxf-parser ラッパー（R12 確認） | 0 | – |
| 5 | `recognize/geom.ts` `bands.ts` 帯の抽出 | 2 | – |
| 6 | `recognize/walls.ts` 壁・外形・外壁判定 | 2 | – |
| 7 | `recognize/openings.ts` 開口 | 2 | – |
| 8 | `recognize/stairs.ts` 階段 | 2 | – |
| 9 | `recognize/axes.ts` `region.ts` `index.ts` 通り芯・範囲選択・合成 | 1–2 | A1 A10 |
| 10 | `model/` 建物モデルの操作と位置合わせ | 1–3 | – |
| 11 | `model/roof.ts` 屋根の幾何 | 4 | – |
| 12 | `geometry/` メッシュ生成 | 1–4 | – |
| 13 | `viewer/` シーン・カメラ・再生成・ラベル | 1 | A2 |
| 14 | `viewer/handles.ts` 青・橙・紫・緑ハンドル | 2–4 | A3 A4 A6 A7 A8 |
| 15 | `ui/` パネル・2D 選択ビュー・長方形を描く | 1–5 | A5 A9 |
| 16 | E2E（Playwright）とテスト用フック | 5 | A1〜A10 |
| 17 | 性能計測・README・監査 | 5 | A11 |

---

### Task 1: 雛形・依存・テスト基盤

**Files:**
- Create: `package.json` `vite.config.ts` `vitest.config.ts` `tsconfig.json` `index.html` `src/main.tsx` `src/ui/App.tsx` `.gitignore` `.nvmrc`
- Create: `src/model/types.ts`

**Step 1: git 初期化と Vite 雛形**

```bash
cd D:/PROJECT/dxf-plan-3d
git init
npm create vite@latest . -- --template react-ts
```

雛形が既存ファイル（README.md・specs/・fixtures/）を上書きしようとしたら **上書きしない**。`README.md` は既存を残す。

**Step 2: 依存を exact 固定で入れる**

```bash
npm install -E react react-dom three dxf-parser polygon-clipping
npm install -E -D typescript vite @vitejs/plugin-react vitest @types/node @types/react @types/react-dom @types/three @tarikjabiri/dxf iconv-lite @playwright/test tsx
```

`supply-chain-check` スキルを呼んで監査する。`.nvmrc` に `22` を書く。

`iconv-lite` と `@tarikjabiri/dxf` は `scripts/make-sample-dxf.ts` でしか使わないので **devDependencies** に置く（実行時の Shift_JIS 判定はブラウザ標準の `TextDecoder`）。取り違えると 200 KB 級の不要コードがバンドルに入る。

**`@types/node` を入れた副作用:** Node のグローバル型が `src/ui` `src/viewer` にも及び、`setTimeout` の戻り値が `number` ではなく `NodeJS.Timeout` になる。タイマー ID を保持する場面では `ReturnType<typeof setTimeout>` と書く（Task 15 で該当）。

**Step 3: 設定ファイル**

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

// 純粋モジュール（dxf / recognize / model / geometry）は Node で試す
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
```

`tsconfig.json` は雛形のまま `"strict": true` を確認する。`.gitignore` に `node_modules dist playwright-report test-results` を入れる。

**Step 4: 型定義（設計書 §5 をそのまま写す）**

`src/model/types.ts`:

```ts
/** 2D ベクトル（mm） */
export interface Vec2 { x: number; y: number }
/** 軸平行の矩形（mm） */
export interface Box2 { minX: number; minY: number; maxX: number; maxY: number }
/** 多角形。閉じない（末尾と先頭を結ぶ） */
export type Polygon = Vec2[];

/** DXF から取り出した 2D エンティティ（mm、モデル空間のみ） */
export type PlanEntity =
  | { kind: 'line'; layer: string; a: Vec2; b: Vec2 }
  | { kind: 'arc'; layer: string; center: Vec2; radius: number; startDeg: number; endDeg: number }
  | { kind: 'circle'; layer: string; center: Vec2; radius: number }
  | { kind: 'text'; layer: string; at: Vec2; text: string; height: number };

/** 範囲選択で切り出した 1 枚の平面図 */
export interface Plan2D { entities: PlanEntity[]; bbox: Box2; sourceName: string }

export interface Wall { id: string; a: Vec2; b: Vec2; thickness: number; exterior: boolean }
export interface Opening {
  wallId: string; offset: number; width: number; type: 'door' | 'window';
  sill: number; head: number;   // 床からの高さ mm
}
export interface Flight { rect: Box2; axis: 'x' | 'y'; ascendPositive: boolean; treads: number }
export interface Stair { flights: Flight[]; landings: Box2[] }
export interface GridAxis { label: string; a: Vec2; b: Vec2; bubble: Vec2 }
export interface PlanModel {
  walls: Wall[]; openings: Opening[]; stairs: Stair[]; axes: GridAxis[];
  outline: Polygon;            // 外壁帯の和集合の外周
  decorLines: PlanEntity[];    // 認識外の線・弧
  warnings: string[];          // 「壁を認識できませんでした」など。パネルに 1 行出す
}

export interface FloorBlock {
  id: string; level: number; plan: PlanModel;
  offset: Vec2; baseZ: number; topZ: number;
}
export interface Roof {
  axis: 'x' | 'y'; ridgeOffset: number; inset: [number, number];
  pitchSun: number; eave: number; verge: number; thickness: number;
}
export interface BuildingModel {
  floor1Level: number; slabThickness: number; floors: FloorBlock[]; roof?: Roof;
}
```

**Step 5: 空の App が動くことを確認**

```bash
npm run dev
```

ブラウザで `http://localhost:5173` が開き、雛形の画面が出る。`npx vitest run` が「No test files found」で終わる。

**Step 6: Commit**

```bash
git add -A
git commit -m "chore: Vite + React + three.js の雛形と型定義

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: 自作フィクスチャ生成スクリプト（設計書 §11.1）

**Files:**
- Create: `scripts/make-sample-dxf.ts`
- Create: `fixtures/sample-house.dxf` `fixtures/sample-house-sjis.dxf` `fixtures/sample-house-with-centerline.dxf`（生成物。コミットする）
- Test: `src/dxf/fixtures.test.ts`

**Step 0: Task 1 からの申し送りを片付ける**

`package.json` の `"test"` から `--passWithNoTests` を外す。Task 1 ではテストが 1 件も無いために必要だったが、このタスクで最初のテストが入る。**このフラグを残すと、テストファイル名を打ち間違えて vitest が 0 件しか収集できなかったときに、赤くなるべき手順が緑で通る**（`vitest.config.ts` の `include` は `src/**/*.test.ts` に絞ってあるので、`.test.tsx` にした瞬間や `src/` の外に置いた瞬間に無言で 0 件になる）。Step 1 のテストと同じコミットで外す。

**Step 1: 失敗するテスト**

`src/dxf/fixtures.test.ts`:

```ts
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
```

**Step 2: 落ちることを確認**

Run: `npx vitest run src/dxf/fixtures.test.ts`
Expected: FAIL（ファイルが無い）

**Step 3: 生成スクリプト**

`scripts/make-sample-dxf.ts`（`npx tsx scripts/make-sample-dxf.ts` で実行）:

> **この節のコードは着手時の下書きである。** 実装後のレビューを経て、生成ロジックは `scripts/sample-dxf.ts`（副作用なし・`buildDxf()` と `buildSjisText()` を export）と `scripts/make-sample-dxf.ts`（書き出すだけの実行部）に分かれ、レイヤー名は `LAYER` 定数に集約され、階段の深さは踏面数 × 間隔から導く形になった。**現在の正はコミット済みのファイルであり、この下書きではない。** 実行は `npm run make-fixtures`。

```ts
/**
 * 動画のサンプル住宅に相当する平面図 DXF を生成する。
 * 1 階と 2 階を X 方向に 12,000 mm 離して横並びに置く。単位 mm。
 * レイヤー: 壁 / 建具 / 階段 / 通り芯 / 文字 / 図枠（壁芯版は 壁芯 を追加）
 */
import { DxfWriter, point3d } from '@tarikjabiri/dxf';
import iconv from 'iconv-lite';
import { writeFileSync } from 'node:fs';

type Opening = { offset: number; width: number; type: 'door' | 'window'; swing?: 1 | -1 };
type WallDef = { a: [number, number]; b: [number, number]; t: number; openings?: Opening[] };

const MOD = 910;
const GRID = [0, 4 * MOD, 8 * MOD]; // 0 / 3,640 / 7,280

function makePlan(dxf: DxfWriter, ox: number, floor: 1 | 2, withCenterline: boolean) {
  const P = (x: number, y: number) => point3d(ox + x, y, 0);
  const line = (layer: string, x1: number, y1: number, x2: number, y2: number) => dxf.addLine(P(x1, y1), P(x2, y2), { layerName: layer });
  const text = (layer: string, x: number, y: number, h: number, s: string) => dxf.addText(P(x, y), h, s, { layerName: layer });

  // 壁: 壁芯 a→b、厚さ t。開口の位置で二重線を切る。窓は帯の内側に細線 2 本、ドアは弧 + 戸の線
  const wall = (w: WallDef) => {
    const [ax, ay] = w.a, [bx, by] = w.b;
    const len = Math.hypot(bx - ax, by - ay);
    const ux = (bx - ax) / len, uy = (by - ay) / len;   // 壁方向
    const nx = -uy, ny = ux;                             // 法線
    const at = (s: number, off: number): [number, number] => [ax + ux * s + nx * off, ay + uy * s + ny * off];
    const cuts = [...(w.openings ?? [])].sort((p, q) => p.offset - q.offset);
    let s = 0;
    for (const o of [...cuts, { offset: len, width: 0, type: 'window' as const }]) {
      for (const side of [w.t / 2, -w.t / 2]) {
        const [x1, y1] = at(s, side), [x2, y2] = at(o.offset, side);
        if (o.offset - s > 1) line('壁', x1, y1, x2, y2);
      }
      s = o.offset + o.width;
    }
    if (withCenterline) { const [x1, y1] = at(0, 0), [x2, y2] = at(len, 0); line('壁芯', x1, y1, x2, y2); }
    for (const o of cuts) {
      if (o.type === 'window') {
        for (const off of [w.t / 6, -w.t / 6]) {
          const [x1, y1] = at(o.offset, off), [x2, y2] = at(o.offset + o.width, off);
          line('建具', x1, y1, x2, y2);
        }
      } else {
        const swing = o.swing ?? 1;
        const [cx, cy] = at(o.offset, 0);                 // 吊元
        const [lx, ly] = at(o.offset, swing * o.width);   // 戸の先端（壁に直交して開いた状態）
        line('建具', cx, cy, lx, ly);
        const base = Math.atan2(uy, ux) * 180 / Math.PI;
        const start = swing === 1 ? base : base - 90, end = swing === 1 ? base + 90 : base;
        dxf.addArc(P(cx, cy), o.width, start, end, { layerName: '建具' });
      }
    }
  };

  const EXT = 150, INT = 120;
  const [x0, x1, x2] = GRID, [y0, y1, y2] = GRID;
  if (floor === 1) {
    wall({ a: [x0, y0], b: [x2, y0], t: EXT, openings: [{ offset: 1000, width: 1820, type: 'window' }, { offset: 5000, width: 900, type: 'door' }] }); // 南: 掃き出し窓・玄関
    wall({ a: [x2, y0], b: [x2, y2], t: EXT, openings: [{ offset: 1200, width: 1200, type: 'window' }, { offset: 5000, width: 1200, type: 'window' }] });
    wall({ a: [x2, y2], b: [x0, y2], t: EXT, openings: [{ offset: 1500, width: 1650, type: 'window' }, { offset: 5000, width: 1200, type: 'window' }] });
    wall({ a: [x0, y2], b: [x0, y0], t: EXT, openings: [{ offset: 2000, width: 1650, type: 'window' }] });
    wall({ a: [x1, y0], b: [x1, y2], t: INT, openings: [{ offset: 1000, width: 780, type: 'door', swing: -1 }, { offset: 5200, width: 780, type: 'door' }] }); // LDK と右側の間
    wall({ a: [x1, y1], b: [x2, y1], t: INT, openings: [{ offset: 2500, width: 780, type: 'door' }] });              // 右側の中仕切り
    wall({ a: [x1 + 910, y0], b: [x1 + 910, y1], t: INT, openings: [{ offset: 2000, width: 780, type: 'door' }] });  // 階段室と玄関の間
    stair(x1 + 60, y1 + 200, 910 - 120, 2730, 'y', 'UP');
    for (const [x, y, s] of [[1200, 3600, 'LDK'], [4500, 5500, '和室'], [6000, 5500, '浴室'], [6000, 4200, '洗面'], [5000, 1500, '廊下'], [6200, 600, '玄関']] as const) text('文字', x, y, 250, s);
  } else {
    wall({ a: [x0, y0], b: [x2, y0], t: EXT, openings: [{ offset: 1000, width: 1650, type: 'window' }, { offset: 5000, width: 1650, type: 'window' }] });
    wall({ a: [x2, y0], b: [x2, y2], t: EXT, openings: [{ offset: 1200, width: 1200, type: 'window' }, { offset: 5000, width: 1200, type: 'window' }] });
    wall({ a: [x2, y2], b: [x0, y2], t: EXT, openings: [{ offset: 1500, width: 1650, type: 'window' }, { offset: 5000, width: 1650, type: 'window' }] });
    wall({ a: [x0, y2], b: [x0, y0], t: EXT, openings: [{ offset: 1200, width: 1200, type: 'window' }, { offset: 5000, width: 1200, type: 'window' }] });
    wall({ a: [x1, y0], b: [x1, y2], t: INT, openings: [{ offset: 1000, width: 780, type: 'door', swing: -1 }, { offset: 5200, width: 780, type: 'door' }] });
    wall({ a: [x0, y1], b: [x2, y1], t: INT, openings: [{ offset: 1500, width: 780, type: 'door' }, { offset: 5500, width: 780, type: 'door' }] });
    stair(x1 + 60, y1 + 200, 910 - 120, 2730, 'y', 'DN');
    for (const [x, y, s] of [[1200, 5500, '洋室A'], [5500, 5500, '洋室B'], [1200, 1500, '洋室C'], [5500, 1500, '洋室D'], [4200, 1500, '廊下']] as const) text('文字', x, y, 250, s);
  }

  // 階段: 踏面線 10 本（間隔 300、踏面は 9 段）+ 側線 2 本 + 矢印線 3 本 + UP/DN 文字
  function stair(sx: number, sy: number, w: number, d: number, _axis: 'y', label: 'UP' | 'DN') {
    for (let i = 0; i <= 9; i++) line('階段', sx, sy + i * 300, sx + w, sy + i * 300);
    line('階段', sx, sy, sx, sy + d); line('階段', sx + w, sy, sx + w, sy + d);
    const cx = sx + w / 2, tipY = label === 'UP' ? sy + d - 100 : sy + 100, tailY = label === 'UP' ? sy + 100 : sy + d - 100;
    line('階段', cx, tailY, cx, tipY);
    const dir = label === 'UP' ? -1 : 1;
    line('階段', cx, tipY, cx - 80, tipY + dir * 150); line('階段', cx, tipY, cx + 80, tipY + dir * 150);
    text('文字', cx - 120, tailY + (label === 'UP' ? -350 : 150), 200, label);
  }

  // 通り芯: 壁より 1,000 外まで延ばし、両端に円 r=250 とラベル
  GRID.forEach((gx, i) => {
    line('通り芯', gx, y0 - 1000, gx, y2 + 1000);
    for (const yy of [y0 - 1250, y2 + 1250]) { dxf.addCircle(P(gx, yy), 250, { layerName: '通り芯' }); text('通り芯', gx - 120, yy - 100, 200, `X${i + 1}`); }
  });
  GRID.forEach((gy, i) => {
    line('通り芯', x0 - 1000, gy, x2 + 1000, gy);
    for (const xx of [x0 - 1250, x2 + 1250]) { dxf.addCircle(P(xx, gy), 250, { layerName: '通り芯' }); text('通り芯', xx - 120, gy - 100, 200, `Y${i + 1}`); }
  });
  text('図枠', 2500, y2 + 1800, 350, floor === 1 ? '1階平面図' : '2階平面図');
}

function build(withCenterline: boolean): string {
  const dxf = new DxfWriter();
  for (const name of ['壁', '建具', '階段', '通り芯', '文字', '図枠', ...(withCenterline ? ['壁芯'] : [])]) dxf.addLayer(name, 7);
  makePlan(dxf, 0, 1, withCenterline);
  makePlan(dxf, 12000, 2, withCenterline);
  return dxf.stringify();
}

const utf8 = build(false);
writeFileSync('fixtures/sample-house.dxf', utf8, 'utf-8');
writeFileSync('fixtures/sample-house-with-centerline.dxf', build(true), 'utf-8');
// Shift_JIS 版: 版を AC1015 に下げ、$DWGCODEPAGE を明示して cp932 で書く
const sjis = utf8.replace('AC1021', 'AC1015').replace(/(\$ACADVER\r?\n\s*1\r?\n\s*AC1015)/, '$1\n  9\n$DWGCODEPAGE\n  3\nANSI_932');
writeFileSync('fixtures/sample-house-sjis.dxf', iconv.encode(sjis, 'cp932'));
console.log('fixtures written');
```

`@tarikjabiri/dxf` の API 名（`addLine` / `addArc` / `addCircle` / `addText` / `addLayer` / `stringify`）と `$ACADVER` の既定値は、実行前に `node_modules/@tarikjabiri/dxf/README.md` で確認し、違えば合わせる。弧の角度は度。

**Step 4: 実行して通す**

```bash
npx tsx scripts/make-sample-dxf.ts
npx vitest run src/dxf/fixtures.test.ts
```

Expected: `fixtures written`、テスト 2 件 PASS。

**Step 5: 目で確認**

`python -c "import ezdxf; ..."` は使わず、Task 4 の 2D ビューで見るまで待ってよい。ただし Shift_JIS 版のヘッダに `$DWGCODEPAGE` が入ったことだけ `head -c 400 fixtures/sample-house-sjis.dxf` で確認する。

**生成物の実測値（2026-09-03。後続タスクの期待値はこれに合わせる）**

`sample-house.dxf` は 223 エンティティ。通り芯の円の半径まで含めた範囲は 1 階が X −1,500〜8,780、2 階が X 10,500〜20,780（間隔 12,000 mm）なので、**階の切り分けは X = 9,000 を境にすれば安全**。

| レイヤー | 内訳 |
|---|---|
| 壁 | LINE 72 |
| 建具 | LINE 37（窓 14×2）/ ARC 9（ドア） |
| 階段 | LINE 30（踏面 10 + 側線 2 + 矢印 3 の 15 × 2 階分） |
| 通り芯 | LINE 12 / CIRCLE 24（半径 250、1 階 12・2 階 12）/ TEXT 24 |
| 文字 | TEXT 13（部屋名と `UP` `DN`） |
| 図枠 | TEXT 2 |

- **ドアの弧は 1 階 5 個・2 階 4 個**（合計 9）。すべて掃引 90°、半径 = 開口幅。吊元は壁芯上ちょうど
- **窓は 1 階 6 個・2 階 8 個**（合計 14。建具 LINE 37 = 窓 14 × 2 + ドア 9）。2 階は四周すべてに窓 2 個ずつ入る
- 窓の細線は法線オフセット `±厚さ/6`（外壁 ±25、内壁 ±20）で帯の半幅の内側にあり、長さは開口幅と厳密に一致する。§7.2 手順 1 の「中央線」判定が効く形になっている
- **`UP` / `DN` は `階段` レイヤーではなく `文字` レイヤーにある。** 階段認識で「階段レイヤーの文字」を探すと見つからない（§7.2 手順 6 は全レイヤーの文字を見る規定なので問題ない）
- 通り芯のラベル文字は円の中心から `(−120, −100)` ずれた位置が挿入点。バブルとの対応付けは「円の中心から半径 250 以内に挿入点がある文字」で拾える
- `sample-house-with-centerline.dxf` は `通り芯`（グリッド）と `壁芯`（各壁の芯線 13 本）を**両方**持つ。壁芯だけを見るならレイヤーで絞る
- Shift_JIS 版は `$ACADVER = AC1015`、UTF-8 版 2 つは `AC1021`
- 再実行しても 3 ファイルとも md5 が一致する（生成は決定的）

**Step 6: Commit**

```bash
git add scripts fixtures src/dxf/fixtures.test.ts
git commit -m "test: 動画相当のサンプル住宅 DXF を生成するスクリプトと 3 変種"
```

---

### Task 3: `dxf/decode.ts` 文字コードと単位（設計書 §7.1 手順 1・2）

**Files:**
- Create: `src/dxf/decode.ts`
- Test: `src/dxf/decode.test.ts`

**Step 1: 失敗するテスト**

```ts
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
  // 宣言より厳密デコードを優先することを守る。この 1 件が無いと、
  // 宣言を先に見る実装（v0.1.0 の下書き）に戻しても全件通ってしまう
  it('$DWGCODEPAGE=ANSI_932 が付いた UTF-8 ファイルも文字化けしない', () => {
    // sample-house.dxf のヘッダに宣言を注入して読ませる
  });
});

describe('unitScaleFromHeader', () => {
  it('$INSUNITS 4 は 1、6 は 1000、1 は 25.4', () => {
    expect(unitScaleFromHeader({ $INSUNITS: 4 }, 50000)).toBe(1);
    expect(unitScaleFromHeader({ $INSUNITS: 6 }, 50)).toBe(1000);
    expect(unitScaleFromHeader({ $INSUNITS: 1 }, 2000)).toBeCloseTo(25.4);
  });
  it('無指定は範囲の長辺で推定する', () => {
    expect(unitScaleFromHeader({}, 58870)).toBe(1);     // forest-s は mm
    expect(unitScaleFromHeader({}, 58.87)).toBe(1000);  // m で描かれた図面
  });
});
```

**Step 2: 落ちることを確認**

Run: `npx vitest run src/dxf/decode.test.ts` → FAIL（モジュールが無い）

**Step 3: 実装**

> **この下書きは誤っている。** `$DWGCODEPAGE` を先に見ると、R2007 以降の UTF-8 ファイル（宣言に `ANSI_932` が残る組み合わせは日本語版 CAD で普通に起こる）が文字化けする。2026-09-03 に実機で再現したため、設計書 §7.1 手順 1 ごと下の形に改めた。

```ts
/** DXF のバイト列を文字列にする。設計書 §7.1 手順 1 */
export function decodeDxfBytes(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  try {
    // 宣言より厳密デコードの成否を優先する。AC1021 以降は $DWGCODEPAGE が残っていても本文は UTF-8
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Shift_JIS の日本語は UTF-8 として不正なバイト列になるので、ここに落ちる
    return new TextDecoder('shift_jis').decode(bytes);
  }
}

/** 図面単位 → mm の倍率。設計書 §7.1 手順 2 */
export function unitScaleFromHeader(header: Record<string, unknown>, extentLongSide: number): number {
  const units = header.$INSUNITS as number | undefined;
  if (units === 4) return 1;
  if (units === 6) return 1000;
  if (units === 1) return 25.4;
  if (units === 5) return 10;      // cm
  return extentLongSide < 200 ? 1000 : 1;
}
```

**Step 4: 通ることを確認**

Run: `npx vitest run src/dxf/decode.test.ts` → 5 件 PASS。Node の `TextDecoder('shift_jis')` が `RangeError` を出す場合は Node が small-icu ビルドなので、`node -p "process.versions.icu"` を確認して公式ビルドの Node 22 に替える。

**Step 5: Commit**

```bash
git add src/dxf/decode.ts src/dxf/decode.test.ts
git commit -m "feat: DXF の文字コード判定と単位推定"
```

---

### Task 4: `dxf/parse.ts` dxf-parser ラッパー（設計書 §7.1 手順 3〜5）

**Files:**
- Create: `src/dxf/parse.ts` `src/dxf/index.ts`
- Test: `src/dxf/parse.test.ts`

**先行検証の結果（2026-09-03 に実機で確認済み。推測ではなく実測）**

dxf-parser 1.1.2 に `fixtures/forest-s/平面立面図.dxf` を通した結果、次が確定した。**自前パーサーへの切り替えは不要。**

| 項目 | 実測値 | 実装への影響 |
|---|---|---|
| R12（AC1009）の読み込み | 成功。LINE 8,211 / TEXT 171 / CIRCLE 94 / ARC 11 で ezdxf の実測と完全一致 | 代替案は不要 |
| 弧の角度 | **ラジアン**（`startAngle: 4.712…` = 270°、`endAngle: 0`） | `deg()` による度への変換は**必要**。恒等にしない |
| 弧の掃引角 | `angleLength` は `end − start` の生値で**負になりうる**（−4.712） | `angleLength` は使わず、`((end − start) mod 360 + 360) mod 360` で求める |
| `$INSUNITS` | `undefined` | 図面範囲からの推定経路が実際に働く |
| TEXT の座標・字高 | `startPoint` と `textHeight` | 計画のコードのとおり |
| ハンドル | 数値で重複あり（0 / 1 / 485…） | 読み込み順の連番を使う（計画どおり） |
| レイヤー表 | 13 件（ezdxf は 15 件）。各要素に `frozen` `visible` あり | 非表示判定は使える。件数の差は未使用レイヤーなので影響なし |

**注意（つまずきやすい点）:** dxf-parser の ESM エントリ（`dist/index.js`）は相対 import に拡張子が無く、Node 素の ESM 解決では読めない。vitest は Vite の解決器を使うので通るが、もし `ERR_MODULE_NOT_FOUND` が出たら `vitest.config.ts` に `resolve: { alias: { 'dxf-parser': 'dxf-parser/dist/dxf-parser.js' } }`（CJS ビルド）を足して回避する。

**Step 1: 失敗するテスト**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadDxf } from './index';

const load = (p: string) => loadDxf(new Uint8Array(readFileSync(p)).buffer, p);

describe('loadDxf', () => {
  // 2 本に割る理由: 「R12 を取りこぼしていない」ことと「1 mm ルールが効いている」ことは別の性質で、
  // 1 つの数字に両方を背負わせられない（2026-09-03 の実装で判明）
  it('forest-s: 生の解析結果が ezdxf の実測（LINE 8211 / TEXT 171 / CIRCLE 94 / ARC 11）と一致する', () => {
    // 解析だけを行い、正規化前の本数を数える
  });
  it('forest-s: 正規化後は LINE が 8125 になる（86 本が 1 mm 未満で捨てられる）', () => {
    const plan = load('fixtures/forest-s/平面立面図.dxf');
    const count = (k: string) => plan.entities.filter((e) => e.kind === k).length;
    expect(count('line')).toBe(8125);   // 生 8,211 − 1 mm 未満 86（_f-e_254 に 80・_0-3_3 に 6）
    expect(count('text')).toBe(171);
    expect(count('circle')).toBe(94);
    expect(count('arc')).toBe(11);
    // bbox はエンティティの外接矩形。$EXTMAX の 58,870 は用紙の限界であって描画範囲ではない
    expect(plan.bbox.maxX).toBeCloseTo(58162.5, 0);
  });
  it('forest-s: 弧の角度は度で、玄関ドアの弧が 270→0 になっている', () => {
    const plan = load('fixtures/forest-s/平面立面図.dxf');
    const arc = plan.entities.find((e) => e.kind === 'arc' && Math.abs(e.center.x - 9792) < 2);
    expect(arc && arc.kind === 'arc' && arc.startDeg).toBeCloseTo(270, 0);
  });
  it('自作版: レイヤー名が保たれ、通り芯の円が 12 個ある', () => {
    const plan = load('fixtures/sample-house.dxf');
    expect(plan.entities.filter((e) => e.kind === 'circle' && e.layer === '通り芯').length).toBe(24); // 1 階 12 + 2 階 12
    expect(new Set(plan.entities.map((e) => e.layer))).toContain('壁');
  });
});
```

**Step 2: 落ちることを確認**

Run: `npx vitest run src/dxf/parse.test.ts` → FAIL

**Step 3: 実装**

`src/dxf/parse.ts`:

```ts
import DxfParser from 'dxf-parser';
import type { Box2, PlanEntity, Plan2D, Vec2 } from '../model/types';
import { unitScaleFromHeader } from './decode';

type Xf = { ox: number; oy: number; sx: number; sy: number; rotDeg: number };
const IDENTITY: Xf = { ox: 0, oy: 0, sx: 1, sy: 1, rotDeg: 0 };

/** INSERT の変換（拡大 → 回転 → 平行移動）を点に掛ける */
function apply(p: { x: number; y: number }, xf: Xf): Vec2 {
  const r = (xf.rotDeg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const x = p.x * xf.sx, y = p.y * xf.sy;
  return { x: xf.ox + x * c - y * s, y: xf.oy + x * s + y * c };
}

/** バルジ付きポリラインの 1 区間を線分列にする（バルジは 8 分割） */
function bulgeSegments(a: Vec2, b: Vec2, bulge: number): [Vec2, Vec2][] {
  if (!bulge) return [[a, b]];
  const theta = 4 * Math.atan(bulge);
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  const r = chord / (2 * Math.sin(theta / 2));
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const d = Math.sqrt(Math.max(r * r - (chord / 2) ** 2, 0)) * Math.sign(bulge);
  const nx = -(b.y - a.y) / chord, ny = (b.x - a.x) / chord;
  const cx = mx - nx * d, cy = my - ny * d;
  const a0 = Math.atan2(a.y - cy, a.x - cx);
  const out: [Vec2, Vec2][] = [];
  let prev = a;
  for (let i = 1; i <= 8; i++) {
    const t = a0 + (theta * i) / 8;
    const p = { x: cx + Math.abs(r) * Math.cos(t), y: cy + Math.abs(r) * Math.sin(t) };
    out.push([prev, p]); prev = p;
  }
  return out;
}

/** dxf-parser の出力を Plan2D に正規化する。設計書 §7.1 手順 3〜5 */
export function parseDxfText(text: string, sourceName: string): Plan2D {
  const dxf = new DxfParser().parseSync(text);
  if (!dxf) throw new Error('DXF を解析できませんでした');
  const layers = (dxf.tables?.layer?.layers ?? {}) as Record<string, { visible?: boolean; frozen?: boolean }>;
  const hidden = (name: string) => { const l = layers[name]; return !!l && (l.visible === false || l.frozen === true); };
  const raw: PlanEntity[] = [];

  const visit = (entities: any[], xf: Xf, depth: number) => {
    for (const e of entities) {
      if (e.inPaperSpace || hidden(e.layer)) continue;
      const layer = String(e.layer ?? '0');
      switch (e.type) {
        case 'LINE':
          raw.push({ kind: 'line', layer, a: apply(e.vertices[0], xf), b: apply(e.vertices[1], xf) });
          break;
        case 'LWPOLYLINE':
        case 'POLYLINE': {
          const vs = e.vertices as { x: number; y: number; bulge?: number }[];
          const n = e.shape ? vs.length : vs.length - 1;   // shape = 閉じている
          for (let i = 0; i < n; i++) {
            const a = vs[i], b = vs[(i + 1) % vs.length];
            for (const [p, q] of bulgeSegments(a, b, a.bulge ?? 0)) raw.push({ kind: 'line', layer, a: apply(p, xf), b: apply(q, xf) });
          }
          break;
        }
        case 'ARC': {
          // dxf-parser は角度をラジアンで返す。度に戻す（Task 4 のテストで確認）
          const deg = (v: number) => ((v * 180) / Math.PI + 360) % 360;
          raw.push({ kind: 'arc', layer, center: apply(e.center, xf), radius: e.radius * xf.sx, startDeg: deg(e.startAngle) + xf.rotDeg, endDeg: deg(e.endAngle) + xf.rotDeg });
          break;
        }
        case 'CIRCLE':
          raw.push({ kind: 'circle', layer, center: apply(e.center, xf), radius: e.radius * xf.sx });
          break;
        case 'TEXT':
        case 'MTEXT':
          raw.push({ kind: 'text', layer, at: apply(e.startPoint ?? e.position, xf), text: String(e.text ?? '').replace(/\\P|\{|\}|\\[A-Za-z][^;]*;/g, '').trim(), height: (e.textHeight ?? e.height ?? 0) * xf.sy });
          break;
        case 'SPLINE': {
          const pts = (e.controlPoints ?? []) as { x: number; y: number }[];
          for (let i = 0; i + 1 < pts.length; i++) raw.push({ kind: 'line', layer, a: apply(pts[i], xf), b: apply(pts[i + 1], xf) });
          break;
        }
        case 'INSERT': {
          if (depth >= 3) break;
          const block = dxf.blocks?.[e.name];
          if (!block?.entities) break;
          const child: Xf = { ox: apply(e.position ?? { x: 0, y: 0 }, xf).x, oy: apply(e.position ?? { x: 0, y: 0 }, xf).y, sx: (e.xScale ?? 1) * xf.sx, sy: (e.yScale ?? 1) * xf.sy, rotDeg: (e.rotation ?? 0) + xf.rotDeg };
          visit(block.entities, child, depth + 1);
          break;
        }
        default: break; // DIMENSION / HATCH などは無視
      }
    }
  };
  visit(dxf.entities ?? [], IDENTITY, 0);

  // 単位を mm に揃える
  const bboxRaw = bboxOf(raw);
  const scale = unitScaleFromHeader(dxf.header ?? {}, Math.max(bboxRaw.maxX - bboxRaw.minX, bboxRaw.maxY - bboxRaw.minY));
  const scaled = scale === 1 ? raw : raw.map((e) => scaleEntity(e, scale));
  // 1 mm 未満の線は捨てる
  const entities = scaled.filter((e) => e.kind !== 'line' || Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y) >= 1);
  return { entities, bbox: bboxOf(entities), sourceName };
}

function scaleEntity(e: PlanEntity, s: number): PlanEntity {
  const v = (p: Vec2) => ({ x: p.x * s, y: p.y * s });
  switch (e.kind) {
    case 'line': return { ...e, a: v(e.a), b: v(e.b) };
    case 'arc': return { ...e, center: v(e.center), radius: e.radius * s };
    case 'circle': return { ...e, center: v(e.center), radius: e.radius * s };
    case 'text': return { ...e, at: v(e.at), height: e.height * s };
  }
}

export function bboxOf(entities: PlanEntity[]): Box2 {
  const b: Box2 = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (p: Vec2, r = 0) => { b.minX = Math.min(b.minX, p.x - r); b.minY = Math.min(b.minY, p.y - r); b.maxX = Math.max(b.maxX, p.x + r); b.maxY = Math.max(b.maxY, p.y + r); };
  for (const e of entities) {
    if (e.kind === 'line') { add(e.a); add(e.b); }
    else if (e.kind === 'text') add(e.at);
    else add(e.center, e.radius);
  }
  return Number.isFinite(b.minX) ? b : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}
```

`src/dxf/index.ts`:

```ts
import { decodeDxfBytes } from './decode';
import { parseDxfText } from './parse';
import type { Plan2D } from '../model/types';

/** ArrayBuffer → Plan2D。UI とテストの唯一の入口 */
export function loadDxf(buf: ArrayBuffer, sourceName: string): Plan2D {
  return parseDxfText(decodeDxfBytes(buf), sourceName);
}
```

**Step 4: 通ることを確認**

Run: `npx vitest run src/dxf/parse.test.ts`

- 弧の角度テストが `270` でなく `4.71` 付近で落ちたら、dxf-parser がラジアンに変換していないので `deg()` を恒等にする（設計書の注記どおり実測で決める）
- LINE 数が 0 なら dxf-parser が R12 を読めていない。`npx tsx -e "..."` で `dxf.entities.length` を出して切り分け、読めないと分かったら設計書 §4.1 の代替（自前パーサー）に切り替える。自前パーサーは「0 番コードで区切り、必要なコードだけ拾う」100 行程度で、`parseDxfText` の入口を差し替えるだけにする

**Step 5: Commit**

```bash
git add src/dxf
git commit -m "feat: dxf-parser で DXF を Plan2D に正規化（R12・ブロック展開・単位）"
```

---
### Task 5: `recognize/geom.ts` と `recognize/bands.ts` 帯の抽出（設計書 §7.2 手順 1）

**Files:**
- Create: `src/recognize/config.ts` `src/recognize/geom.ts` `src/recognize/bands.ts`
- Test: `src/recognize/bands.test.ts`

**Step 1: 閾値を 1 か所に置く**

`src/recognize/config.ts`:

```ts
/** 認識の閾値。設計書 §7.2 の数値をここに集める。単位 mm・度 */
export const CFG = {
  thetaStepDeg: 0.5,          // 平行判定の角度刻み
  band: { minThickness: 60, maxThickness: 250, minOverlap: 300, periodicTol: 0.15, centerTol: 0.25, centerMinOverlap: 0.8 },
  wallLayerRatio: 0.3,        // 壁レイヤーに数える総延長の下限（最大に対する比）
  wallMergeGap: 50,           // 共線の壁をつなぐ隙間
  collinearRhoTol: 20,        // 共線と見なす壁芯のずれ
  opening: { maxGap: 2500, doorArc: { minDeg: 60, maxDeg: 100, minR: 500, maxR: 1200 }, doubleArc: { minDeg: 170, maxDeg: 190 },
             door: { sill: 0, head: 2000 }, window: { sill: 900, head: 2000 }, slidingWindowMinWidth: 1600 },
  stair: { minLines: 4, minPitch: 200, maxPitch: 350, pitchTol: 0.1, lengthTol: 0.1, textDistance: 1000, arrowHeadMax: 300, flightJoin: 1500 },
  axis: { minR: 150, maxR: 400, label: /^([XY]\d+|[A-Z]\d*)$/ },
  layerNames: { wall: /壁|WALL|カベ/i, centerline: /壁芯|^芯$|CENTER/i, fixture: /建具|ドア|DOOR|窓|WINDOW|サッシ/i, stair: /階段|STAIR/i, axis: /通り芯|GRID|AXIS/i },
} as const;
```

**Step 2: 失敗するテスト**

`src/recognize/bands.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadDxf } from '../dxf';
import { extractBands, totalLengthByLayer } from './bands';
import { toSegments } from './geom';
import type { PlanEntity } from '../model/types';

const line = (layer: string, x1: number, y1: number, x2: number, y2: number): PlanEntity => ({ kind: 'line', layer, a: { x: x1, y: y1 }, b: { x: x2, y: y2 } });

describe('extractBands', () => {
  it('平行な 2 本（距離 120・重なり 3000）は 1 帯になる', () => {
    const r = extractBands(toSegments([line('壁', 0, 0, 3000, 0), line('壁', 0, 120, 3000, 120)]));
    expect(r.walls).toHaveLength(1);
    expect(r.walls[0].rhoHi - r.walls[0].rhoLo).toBeCloseTo(120);
  });
  it('等間隔 150 で 5 本並ぶタイル目地は周期性で除外される', () => {
    const lines = [0, 150, 300, 450, 600].map((y) => line('床', 0, y, 2000, y));
    const r = extractBands(toSegments(lines));
    expect(r.walls).toHaveLength(0);
    expect(r.periodic.length).toBeGreaterThan(0);
  });
  it('帯の中央に同じ長さの線がある窓記号は symbols に回る', () => {
    const r = extractBands(toSegments([line('建具', 0, 0, 1650, 0), line('建具', 0, 150, 1650, 150), line('建具', 0, 75, 1650, 75)]));
    expect(r.walls).toHaveLength(0);
    expect(r.symbols).toHaveLength(1);
  });
  it('入れ子の 4 本（0 / 25 / 125 / 150）は外側 1 帯にまとまる', () => {
    const r = extractBands(toSegments([0, 25, 125, 150].map((y) => line('壁', 0, y, 4000, y))));
    expect(r.walls).toHaveLength(1);
    expect(r.walls[0].rhoLo).toBeCloseTo(0);
    expect(r.walls[0].rhoHi).toBeCloseTo(150);
  });
  it('斜め 45° の平行 2 本も帯になる', () => {
    const r = extractBands(toSegments([line('壁', 0, 0, 2000, 2000), line('壁', -85, 85, 1915, 2085)]));
    expect(r.walls).toHaveLength(1);
  });
  it('forest-s 1 階: 壁レイヤー _0-1_1 の総延長が最大で、タイル目地 40 帯以上が周期性で落ちる', () => {
    const plan = loadDxf(new Uint8Array(readFileSync('fixtures/forest-s/平面立面図.dxf')).buffer, 'forest');
    const region = plan.entities.filter((e) => e.kind === 'line' && e.a.x >= 5500 && e.a.x <= 19800 && e.a.y >= 28800 && e.a.y <= 39800);
    const r = extractBands(toSegments(region));
    const total = totalLengthByLayer(r.walls);
    const top = [...total.entries()].sort((p, q) => q[1] - p[1])[0];
    expect(top[0]).toBe('_0-1_1');
    expect(r.periodic.length).toBeGreaterThanOrEqual(40);
  });
});
```

**Step 3: 落ちることを確認**

Run: `npx vitest run src/recognize/bands.test.ts` → FAIL

**Step 4: 実装**

`src/recognize/geom.ts`:

```ts
import type { PlanEntity, Vec2 } from '../model/types';
import { CFG } from './config';

/** 線分を「向き θ・法線方向の位置 ρ・向き方向の区間 [s0, s1]」で表す。平行判定と帯の抽出が 1 次元の比較になる */
export interface Seg { id: number; layer: string; theta: number; rho: number; s0: number; s1: number; a: Vec2; b: Vec2 }

export const dirOf = (thetaDeg: number): Vec2 => ({ x: Math.cos((thetaDeg * Math.PI) / 180), y: Math.sin((thetaDeg * Math.PI) / 180) });
export const normalOf = (thetaDeg: number): Vec2 => { const u = dirOf(thetaDeg); return { x: -u.y, y: u.x }; };
export const dot = (p: Vec2, q: Vec2) => p.x * q.x + p.y * q.y;

/** 角度を [0, 180) に折り畳み、刻みに丸める */
export function foldTheta(deg: number): number {
  const step = CFG.thetaStepDeg;
  let t = ((deg % 180) + 180) % 180;
  t = Math.round(t / step) * step;
  return t >= 180 ? 0 : t;
}

export function toSeg(e: Extract<PlanEntity, { kind: 'line' }>, id: number): Seg {
  const theta = foldTheta((Math.atan2(e.b.y - e.a.y, e.b.x - e.a.x) * 180) / Math.PI);
  const u = dirOf(theta), n = normalOf(theta);
  const sa = dot(e.a, u), sb = dot(e.b, u);
  return { id, layer: e.layer, theta, rho: (dot(e.a, n) + dot(e.b, n)) / 2, s0: Math.min(sa, sb), s1: Math.max(sa, sb), a: e.a, b: e.b };
}

export function toSegments(entities: PlanEntity[]): Seg[] {
  const out: Seg[] = [];
  entities.forEach((e, i) => { if (e.kind === 'line') out.push(toSeg(e, i)); });
  return out;
}

/** (θ, ρ, s) → 平面座標 */
export const fromRhoS = (theta: number, rho: number, s: number): Vec2 => {
  const u = dirOf(theta), n = normalOf(theta);
  return { x: u.x * s + n.x * rho, y: u.y * s + n.y * rho };
};

export const overlapLen = (p: { s0: number; s1: number }, q: { s0: number; s1: number }) => Math.min(p.s1, q.s1) - Math.max(p.s0, q.s0);
export const length = (s: Seg) => s.s1 - s.s0;
```

`src/recognize/bands.ts`:

```ts
import { CFG } from './config';
import { overlapLen, type Seg } from './geom';

/** 平行な線分の対が作る帯。ρ の範囲と s の範囲で表す */
export interface Band { layer: string; theta: number; rhoLo: number; rhoHi: number; s0: number; s1: number; lineIds: number[] }
export interface BandResult { walls: Band[]; symbols: Band[]; periodic: Band[]; usedLineIds: Set<number> }

export function extractBands(segs: Seg[]): BandResult {
  const groups = new Map<string, Seg[]>();
  for (const s of segs) { const k = `${s.layer}|${s.theta}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(s); }
  const walls: Band[] = [], symbols: Band[] = [], periodic: Band[] = [];
  const { minThickness, maxThickness, minOverlap, periodicTol, centerTol, centerMinOverlap } = CFG.band;

  for (const group of groups.values()) {
    group.sort((p, q) => p.rho - q.rho);
    const candidates: Band[] = [];
    for (let i = 0; i < group.length; i++) {
      const p = group[i];
      for (let j = i + 1; j < group.length; j++) {
        const q = group[j];
        const d = q.rho - p.rho;
        if (d > maxThickness) break;
        if (d < minThickness) continue;
        const ov = overlapLen(p, q);
        if (ov < minOverlap) continue;
        const band: Band = { layer: p.layer, theta: p.theta, rhoLo: p.rho, rhoHi: q.rho, s0: Math.max(p.s0, q.s0), s1: Math.min(p.s1, q.s1), lineIds: [p.id, q.id] };
        // 周期性: 帯の外側に同じ間隔で平行線が続く → タイル目地・ハッチ・階段踏面
        const isPeriodic = group.some((r) => r !== p && r !== q && (
          (Math.abs(r.rho - q.rho - d) <= d * periodicTol && overlapLen(q, r) >= minOverlap) ||
          (Math.abs(p.rho - r.rho - d) <= d * periodicTol && overlapLen(p, r) >= minOverlap)));
        if (isPeriodic) { periodic.push(band); continue; }
        // 中央線: 帯の中央に帯とほぼ同じ長さの線 → 窓・引き戸の記号
        const mid = (p.rho + q.rho) / 2;
        const hasCenter = group.some((r) => r !== p && r !== q && Math.abs(r.rho - mid) <= d * centerTol && overlapLen(r, band) >= centerMinOverlap * ov);
        if (hasCenter) { symbols.push(band); continue; }
        candidates.push(band);
      }
    }
    walls.push(...mergeNested(candidates));
  }
  const usedLineIds = new Set<number>();
  for (const b of [...walls, ...symbols]) b.lineIds.forEach((id) => usedLineIds.add(id));
  return { walls, symbols, periodic, usedLineIds };
}

/** 同じ向きで ρ の範囲が半分以上重なり、s も重なる帯は外側の対にまとめる（外壁の仕上げ線 4 本 → 1 帯） */
function mergeNested(bands: Band[]): Band[] {
  const out: Band[] = [];
  for (const b of bands.sort((p, q) => (q.rhoHi - q.rhoLo) - (p.rhoHi - p.rhoLo))) {
    const host = out.find((o) => {
      const rhoOv = Math.min(o.rhoHi, b.rhoHi) - Math.max(o.rhoLo, b.rhoLo);
      return rhoOv >= 0.5 * Math.min(o.rhoHi - o.rhoLo, b.rhoHi - b.rhoLo) && overlapLen(o, b) >= CFG.band.minOverlap;
    });
    if (host) {
      host.rhoLo = Math.min(host.rhoLo, b.rhoLo); host.rhoHi = Math.max(host.rhoHi, b.rhoHi);
      host.s0 = Math.min(host.s0, b.s0); host.s1 = Math.max(host.s1, b.s1);
      host.lineIds.push(...b.lineIds);
    } else out.push({ ...b, lineIds: [...b.lineIds] });
  }
  return out;
}

export function totalLengthByLayer(bands: Band[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of bands) m.set(b.layer, (m.get(b.layer) ?? 0) + (b.s1 - b.s0));
  return m;
}
```

**Step 5: 通ることを確認**

Run: `npx vitest run src/recognize/bands.test.ts` → 6 件 PASS。forest-s の件が落ちたら、`prototype/proto_walls.py` の結果（`_0-1_1` 142.8 m、周期除外 54 帯）と数値を突き合わせて閾値を見直す。

**Step 6: Commit**

```bash
git add src/recognize
git commit -m "feat: 平行線対からの帯抽出（周期性・中央線・入れ子）"
```

---

### Task 6: `recognize/walls.ts` 壁・外形・外壁判定（設計書 §7.2 手順 2・3・5）

**Files:**
- Create: `src/recognize/walls.ts`
- Test: `src/recognize/walls.test.ts`

**Step 1: 失敗するテスト**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadDxf } from '../dxf';
import { extractBands } from './bands';
import { toSegments } from './geom';
import { bandsToWalls, computeOutline, decideWallLayers, markExterior, centerlineBBox } from './walls';

const forest1F = () => {
  const plan = loadDxf(new Uint8Array(readFileSync('fixtures/forest-s/平面立面図.dxf')).buffer, 'forest');
  return plan.entities.filter((e) => e.kind === 'line' && e.a.x >= 5500 && e.a.x <= 19800 && e.a.y >= 28800 && e.a.y <= 39800);
};

describe('壁の組み立て', () => {
  it('forest-s 1 階: 壁レイヤーは _0-1_1 だけ', () => {
    const r = extractBands(toSegments(forest1F()));
    expect([...decideWallLayers(r.walls)]).toEqual(['_0-1_1']);
  });
  it('forest-s 1 階: 外壁芯の外接矩形が 9,100 × 5,915（±30）', () => {
    const r = extractBands(toSegments(forest1F()));
    const walls = markExterior(bandsToWalls(r.walls, decideWallLayers(r.walls)), computeOutline(bandsToWalls(r.walls, decideWallLayers(r.walls))));
    const box = centerlineBBox(walls.filter((w) => w.exterior));
    expect(box.maxX - box.minX).toBeCloseTo(9100, -1.5);
    expect(box.maxY - box.minY).toBeCloseTo(5915, -1.5);
  });
  it('forest-s 1 階: 外形は U 字（頂点 6 個以上）で、外壁は 6 本以上', () => {
    const r = extractBands(toSegments(forest1F()));
    const walls = bandsToWalls(r.walls, decideWallLayers(r.walls));
    const outline = computeOutline(walls);
    expect(outline.length).toBeGreaterThanOrEqual(6);
    expect(markExterior(walls, outline).filter((w) => w.exterior).length).toBeGreaterThanOrEqual(6);
  });
});
```

**Step 2: 落ちることを確認** → `npx vitest run src/recognize/walls.test.ts` FAIL

**Step 3: 実装**

```ts
import polygonClipping, { type MultiPolygon, type Ring } from 'polygon-clipping';
import type { Box2, Polygon, Vec2, Wall } from '../model/types';
import { CFG } from './config';
import { fromRhoS, normalOf, type Seg } from './geom';
import { totalLengthByLayer, type Band } from './bands';

/** 総延長が最大のレイヤーと、その 30% 以上のレイヤーを壁レイヤーにする。名前が「壁」に当たるレイヤーは無条件で加える */
export function decideWallLayers(bands: Band[]): Set<string> {
  const total = totalLengthByLayer(bands);
  const max = Math.max(0, ...total.values());
  const out = new Set<string>();
  for (const [layer, len] of total) if (len >= max * CFG.wallLayerRatio || CFG.layerNames.wall.test(layer)) out.add(layer);
  return out;
}

let wallSeq = 0;
/** 帯 → 壁。共線で隙間 50 mm 以内のものをつなぐ */
export function bandsToWalls(bands: Band[], wallLayers: Set<string>): Wall[] {
  const walls: Wall[] = [];
  const byLine = new Map<string, Band[]>();
  for (const b of bands) {
    if (!wallLayers.has(b.layer)) continue;
    const rhoC = (b.rhoLo + b.rhoHi) / 2;
    const key = `${b.theta}|${Math.round(rhoC / CFG.collinearRhoTol)}`;
    (byLine.get(key) ?? byLine.set(key, []).get(key)!).push(b);
  }
  for (const group of byLine.values()) {
    group.sort((p, q) => p.s0 - q.s0);
    let cur = { ...group[0] };
    const flush = () => {
      const rho = (cur.rhoLo + cur.rhoHi) / 2;
      walls.push({ id: `w${wallSeq++}`, a: fromRhoS(cur.theta, rho, cur.s0), b: fromRhoS(cur.theta, rho, cur.s1), thickness: cur.rhoHi - cur.rhoLo, exterior: false });
    };
    for (const b of group.slice(1)) {
      if (b.s0 - cur.s1 <= CFG.wallMergeGap) { cur.s1 = Math.max(cur.s1, b.s1); cur.rhoLo = Math.min(cur.rhoLo, b.rhoLo); cur.rhoHi = Math.max(cur.rhoHi, b.rhoHi); }
      else { flush(); cur = { ...b }; }
    }
    flush();
  }
  return walls;
}

/** 壁の矩形（4 隅）。角を閉じるため両端を厚さ/2 だけ延ばす */
export function wallRect(w: Wall, extend = w.thickness / 2): Vec2[] {
  const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y, L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L, nx = -uy * (w.thickness / 2), ny = ux * (w.thickness / 2);
  const ax = w.a.x - ux * extend, ay = w.a.y - uy * extend, bx = w.b.x + ux * extend, by = w.b.y + uy * extend;
  return [{ x: ax + nx, y: ay + ny }, { x: bx + nx, y: by + ny }, { x: bx - nx, y: by - ny }, { x: ax - nx, y: ay - ny }];
}

const ringArea = (r: Ring) => Math.abs(r.reduce((s, [x, y], i) => { const [x2, y2] = r[(i + 1) % r.length]; return s + x * y2 - x2 * y; }, 0)) / 2;

/** 壁帯の和集合の外周。最大面積の外周を返す。閉じなければ全壁の bbox */
export function computeOutline(walls: Wall[]): Polygon {
  if (walls.length === 0) return [];
  const polys = walls.map((w) => [wallRect(w).map((p) => [p.x, p.y] as [number, number])]);
  let union: MultiPolygon = [];
  try { union = polygonClipping.union(...(polys as [Ring[]][])); } catch { union = []; }
  const outer = union.map((poly) => poly[0]).sort((p, q) => ringArea(q) - ringArea(p))[0];
  if (!outer || ringArea(outer) < 1e6) {
    const b = bboxOfPoints(walls.flatMap(wallRect));
    return [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY }, { x: b.maxX, y: b.maxY }, { x: b.minX, y: b.maxY }];
  }
  return outer.slice(0, -1).map(([x, y]) => ({ x, y }));
}

export function pointInPolygon(p: Vec2, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** 壁芯の中点から法線方向に (厚さ/2 + 5) 離れた点のどちらかが外形の外なら外壁 */
export function markExterior(walls: Wall[], outline: Polygon): Wall[] {
  return walls.map((w) => {
    const mx = (w.a.x + w.b.x) / 2, my = (w.a.y + w.b.y) / 2;
    const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y, L = Math.hypot(dx, dy) || 1;
    const n = { x: -dy / L, y: dx / L }, d = w.thickness / 2 + 5;
    const outside = !pointInPolygon({ x: mx + n.x * d, y: my + n.y * d }, outline) || !pointInPolygon({ x: mx - n.x * d, y: my - n.y * d }, outline);
    return { ...w, exterior: outside };
  });
}

export function bboxOfPoints(pts: Vec2[]): Box2 {
  return pts.reduce((b, p) => ({ minX: Math.min(b.minX, p.x), minY: Math.min(b.minY, p.y), maxX: Math.max(b.maxX, p.x), maxY: Math.max(b.maxY, p.y) }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

/** 外壁芯の外接矩形（屋根の基準。設計書 §8.4、Q9 回答） */
export const centerlineBBox = (walls: Wall[]): Box2 => bboxOfPoints(walls.flatMap((w) => [w.a, w.b]));
export { normalOf, type Seg };
```

**Step 4: 通ることを確認** → `npx vitest run src/recognize/walls.test.ts` PASS

**polygon-clipping の実測（2026-09-03 に確認済み）**

- 型定義は同梱されている（`dist/polygon-clipping.d.ts` に `declare module "polygon-clipping"`）。**自前の `.d.ts` は不要**
- **default export は無い。** 上のコードの `import polygonClipping from 'polygon-clipping'` は型検査を通らないので、`import { union } from 'polygon-clipping'` に書き換えて `union(...)` を直接呼ぶ
- 公開型は `Pair = [number, number]` / `Ring = Pair[]` / `Polygon = Ring[]` / `MultiPolygon = Polygon[]`。`union(geom, ...geoms): MultiPolygon`
- 矩形 9,100 × 5,915・厚さ 150 の壁帯 4 本を和集合すると、`MultiPolygon` 1 件・外周 5 頂点・**穴 1 個**（内側の空間）が返る。`poly[0]` が外周、`poly[1]` 以降が穴
- 返る環は**閉じている**（先頭と末尾が同一点）。`outer.slice(0, -1)` で閉じる点を落とすのは正しい
- 外周の範囲は x −75〜9,175 / y −75〜5,990。壁芯の外接矩形から各辺に厚さの半分だけ外へ出た値になる

**Step 5: Commit** → `git commit -m "feat: 帯から壁・外形・外壁判定を組み立てる"`

---

### Task 7: `recognize/openings.ts` 開口（設計書 §7.2 手順 4）

**Files:**
- Create: `src/recognize/openings.ts`
- Test: `src/recognize/openings.test.ts`

**Step 1: 失敗するテスト**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadDxf } from '../dxf';
import { recognizePlan } from './index';   // Task 9 で作る合成関数。ここでは壁と開口だけ見る

const region = (file: string, box: [number, number, number, number]) => {
  const plan = loadDxf(new Uint8Array(readFileSync(file)).buffer, file);
  const inBox = (x: number, y: number) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3];
  return { ...plan, entities: plan.entities.filter((e) => e.kind === 'line' ? inBox(e.a.x, e.a.y) : e.kind === 'text' ? inBox(e.at.x, e.at.y) : inBox(e.center.x, e.center.y)) };
};

describe('開口の認識', () => {
  it('forest-s 1 階: 開き戸 6（弧の数）、窓は外壁だけに 8 以上', () => {
    const m = recognizePlan(region('fixtures/forest-s/平面立面図.dxf', [5500, 28800, 19800, 39800]));
    expect(m.openings.filter((o) => o.type === 'door' && o.width >= 500).length).toBeGreaterThanOrEqual(6);
    const wallById = new Map(m.walls.map((w) => [w.id, w]));
    const windows = m.openings.filter((o) => o.type === 'window');
    expect(windows.length).toBeGreaterThanOrEqual(8);
    expect(windows.every((o) => wallById.get(o.wallId)?.exterior)).toBe(true);
  });
  it('自作 1 階: 掃き出し窓（幅 1,820）は sill 0、腰窓は sill 900、ドアは head 2,000', () => {
    const m = recognizePlan(region('fixtures/sample-house.dxf', [-2000, -2000, 9500, 9500]));
    const wide = m.openings.find((o) => o.type === 'window' && Math.abs(o.width - 1820) < 60);
    expect(wide?.sill).toBe(0);
    expect(m.openings.some((o) => o.type === 'window' && o.sill === 900)).toBe(true);
    expect(m.openings.filter((o) => o.type === 'door').every((o) => o.head === 2000)).toBe(true);
    expect(m.openings.filter((o) => o.type === 'door').length).toBe(5);
    expect(m.openings.filter((o) => o.type === 'window').length).toBe(6);
  });
});
```

このテストは Task 9 の `recognizePlan` に依存するので、Task 7・8・9 は連続して進め、Task 9 の終わりで 3 タスク分のテストをまとめて通す。

**Step 2: 実装**

```ts
import type { Opening, PlanEntity, Wall } from '../model/types';
import { CFG } from './config';
import { dirOf, dot, normalOf, type Seg } from './geom';
import type { Band } from './bands';

interface Chain { theta: number; rho: number; walls: Wall[] }

/** 共線の壁を鎖にまとめる（向きと壁芯位置が同じもの） */
function chains(walls: Wall[]): Chain[] {
  const map = new Map<string, Chain>();
  for (const w of walls) {
    const theta = Math.round((((Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x) * 180) / Math.PI + 180) % 180) / CFG.thetaStepDeg) * CFG.thetaStepDeg % 180;
    const rho = dot(w.a, normalOf(theta));
    const key = `${theta}|${Math.round(rho / CFG.collinearRhoTol)}`;
    (map.get(key) ?? map.set(key, { theta, rho, walls: [] }).get(key)!).walls.push(w);
  }
  return [...map.values()];
}

const sOf = (theta: number, p: { x: number; y: number }) => dot(p, dirOf(theta));

/**
 * 壁の隙間を開口にする。設計書 §7.2 手順 4。
 * 弧 → 開き戸。記号（中央線付きの帯・壁レイヤー以外の線）→ 外壁は窓、内壁はドア。無ければ壁を分けたままにする
 */
export function detectOpenings(walls: Wall[], entities: PlanEntity[], symbols: Band[], wallLayers: Set<string>, nonWallSegs: Seg[]): { walls: Wall[]; openings: Opening[] } {
  const arcs = entities.filter((e): e is Extract<PlanEntity, { kind: 'arc' }> => e.kind === 'arc');
  const out: Wall[] = [], openings: Opening[] = [];
  const { opening: OC } = CFG;

  for (const chain of chains(walls)) {
    const u = dirOf(chain.theta);
    const sorted = [...chain.walls].sort((p, q) => sOf(chain.theta, p.a) - sOf(chain.theta, q.a));
    let cur = { ...sorted[0] }, curOpenings: Opening[] = [];
    const flush = () => { out.push(cur); openings.push(...curOpenings.map((o) => ({ ...o, wallId: cur.id }))); };
    for (const next of sorted.slice(1)) {
      const gapStart = Math.max(sOf(chain.theta, cur.a), sOf(chain.theta, cur.b));
      const gapEnd = Math.min(sOf(chain.theta, next.a), sOf(chain.theta, next.b));
      const gap = gapEnd - gapStart;
      const t = Math.max(cur.thickness, next.thickness);
      const inGap = (p: { x: number; y: number }, along = 100, across = t / 2 + 50) => {
        const s = sOf(chain.theta, p), r = dot(p, normalOf(chain.theta));
        return s >= gapStart - along && s <= gapEnd + along && Math.abs(r - chain.rho) <= across;
      };
      let opening: Opening | null = null;
      if (gap > CFG.wallMergeGap && gap <= OC.maxGap) {
        const sweep = (a: typeof arcs[number]) => ((a.endDeg - a.startDeg) % 360 + 360) % 360;
        const door = arcs.find((a) => inGap(a.center) && a.radius >= OC.doorArc.minR && a.radius <= OC.doorArc.maxR && ((sweep(a) >= OC.doorArc.minDeg && sweep(a) <= OC.doorArc.maxDeg) || (sweep(a) >= OC.doubleArc.minDeg && sweep(a) <= OC.doubleArc.maxDeg)));
        if (door) {
          const width = Math.min(gap, sweep(door) > OC.doubleArc.minDeg ? door.radius * 2 : door.radius);
          opening = { wallId: '', offset: gapStart - sOf(chain.theta, cur.a) + (gap - width) / 2, width, type: 'door', ...OC.door };
        } else {
          const hasSymbol = symbols.some((b) => Math.abs(b.theta - chain.theta) < 1 && Math.abs((b.rhoLo + b.rhoHi) / 2 - chain.rho) <= t && b.s1 > gapStart && b.s0 < gapEnd)
            || nonWallSegs.some((s) => !wallLayers.has(s.layer) && inGap({ x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 }, 0, t / 2 + 20));
          if (hasSymbol) {
            const exterior = cur.exterior || next.exterior;
            const isSliding = exterior && gap >= OC.slidingWindowMinWidth;
            opening = exterior
              ? { wallId: '', offset: gapStart - sOf(chain.theta, cur.a), width: gap, type: 'window', sill: isSliding ? 0 : OC.window.sill, head: OC.window.head }
              : { wallId: '', offset: gapStart - sOf(chain.theta, cur.a), width: gap, type: 'door', ...OC.door };
          }
        }
      }
      if (opening) {
        curOpenings.push(opening);
        cur = { ...cur, b: next.b, thickness: t, exterior: cur.exterior || next.exterior };   // 隙間をまたいで 1 本にする
      } else { flush(); cur = { ...next }; curOpenings = []; }
    }
    flush();
  }
  void u;
  return { walls: out, openings };
}
```

**Step 3: Commit（Task 9 でテストが通ってから）**

---

### Task 8: `recognize/stairs.ts` 階段（設計書 §7.2 手順 6）

**Files:**
- Create: `src/recognize/stairs.ts`
- Test: `src/recognize/stairs.test.ts`

**Step 1: 失敗するテスト**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadDxf } from '../dxf';
import { recognizePlan } from './index';

const region = (file: string, box: [number, number, number, number]) => {
  const plan = loadDxf(new Uint8Array(readFileSync(file)).buffer, file);
  const inBox = (x: number, y: number) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3];
  return { ...plan, entities: plan.entities.filter((e) => e.kind === 'line' ? inBox(e.a.x, e.a.y) : e.kind === 'text' ? inBox(e.at.x, e.at.y) : inBox(e.center.x, e.center.y)) };
};

describe('階段の認識', () => {
  it('自作 1 階: 直階段 1 つ、flight 1 本、踏面 9、Y 方向に上る', () => {
    const m = recognizePlan(region('fixtures/sample-house.dxf', [-2000, -2000, 9500, 9500]));
    expect(m.stairs).toHaveLength(1);
    const f = m.stairs[0].flights[0];
    expect(f.treads).toBe(9);
    expect(f.axis).toBe('y');
    expect(f.ascendPositive).toBe(true);
  });
  it('自作 2 階: DN の階段は下り（ascendPositive が偽）', () => {
    const m = recognizePlan(region('fixtures/sample-house.dxf', [10000, -2000, 21500, 9500]));
    expect(m.stairs[0].flights[0].ascendPositive).toBe(false);
  });
  it('forest-s 1 階: 階段が 1 つ以上あり、タイル目地は階段にならない（flight は 3 本以下）', () => {
    const m = recognizePlan(region('fixtures/forest-s/平面立面図.dxf', [5500, 28800, 19800, 39800]));
    expect(m.stairs.length).toBeGreaterThanOrEqual(1);
    expect(m.stairs.every((s) => s.flights.length <= 3)).toBe(true);
  });
});
```

**Step 2: 実装**

```ts
import type { Box2, Flight, PlanEntity, Stair } from '../model/types';
import { CFG } from './config';
import { dirOf, dot, fromRhoS, length, overlapLen, type Seg } from './geom';
import { bboxOfPoints } from './walls';

type Run = { theta: number; segs: Seg[]; bbox: Box2 };

/** 等間隔の平行線の組（踏面）を探す */
function findRuns(segs: Seg[]): Run[] {
  const { minLines, minPitch, maxPitch, pitchTol, lengthTol } = CFG.stair;
  const byTheta = new Map<number, Seg[]>();
  for (const s of segs) (byTheta.get(s.theta) ?? byTheta.set(s.theta, []).get(s.theta)!).push(s);
  const runs: Run[] = [];
  for (const [theta, group] of byTheta) {
    group.sort((p, q) => p.rho - q.rho);
    let i = 0;
    while (i < group.length) {
      const run = [group[i]];
      let j = i + 1, pitch = 0;
      while (j < group.length) {
        const prev = run[run.length - 1], cand = group[j];
        const d = cand.rho - prev.rho;
        if (d < 1) { j++; continue; }                           // 同じ位置の重複線
        const lenOk = Math.abs(length(cand) - length(prev)) <= lengthTol * Math.max(length(cand), length(prev));
        const ovOk = overlapLen(cand, prev) >= 0.8 * Math.min(length(cand), length(prev));
        const pitchOk = d >= minPitch && d <= maxPitch && (pitch === 0 || Math.abs(d - pitch) <= pitchTol * pitch);
        if (!(lenOk && ovOk && pitchOk)) break;
        pitch = pitch || d; run.push(cand); j++;
      }
      if (run.length >= minLines) runs.push({ theta, segs: run, bbox: bboxOfPoints(run.flatMap((s) => [s.a, s.b])) });
      i = run.length >= minLines ? j : i + 1;
    }
  }
  return runs;
}

/** 直交方向にも等間隔の線が走っていれば格子（タイル目地） */
function isGrid(run: Run, segs: Seg[]): boolean {
  const perp = (run.theta + 90) % 180;
  const crossing = segs.filter((s) => s.theta === perp && s.a.x >= run.bbox.minX - 1 && s.a.x <= run.bbox.maxX + 1 && s.a.y >= run.bbox.minY - 1 && s.a.y <= run.bbox.maxY + 1
    && Math.min(s.a.x, s.b.x) <= run.bbox.maxX && Math.max(s.a.x, s.b.x) >= run.bbox.minX && Math.min(s.a.y, s.b.y) <= run.bbox.maxY && Math.max(s.a.y, s.b.y) >= run.bbox.minY);
  return crossing.length >= 3;
}

const expand = (b: Box2, d: number): Box2 => ({ minX: b.minX - d, minY: b.minY - d, maxX: b.maxX + d, maxY: b.maxY + d });
const inBox = (p: { x: number; y: number }, b: Box2) => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;

/** 矢印: 先端に短い線が 2 本付いた線。矢先の座標を返す */
function arrowTip(segs: Seg[], within: Box2): { x: number; y: number } | null {
  const shorts = segs.filter((s) => length(s) <= CFG.stair.arrowHeadMax);
  for (const s of segs) {
    if (length(s) < 500 || !inBox({ x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 }, within)) continue;
    for (const tip of [s.a, s.b]) {
      const heads = shorts.filter((h) => h !== s && (Math.hypot(h.a.x - tip.x, h.a.y - tip.y) < 5 || Math.hypot(h.b.x - tip.x, h.b.y - tip.y) < 5));
      if (heads.length >= 2) return tip;
    }
  }
  return null;
}

export function detectStairs(nonWallSegs: Seg[], texts: Extract<PlanEntity, { kind: 'text' }>[]): Stair[] {
  const runs = findRuns(nonWallSegs).filter((r) => !isGrid(r, nonWallSegs));
  const flights: { flight: Flight; run: Run; start: { x: number; y: number } | null }[] = [];
  for (const run of runs) {
    const near = expand(run.bbox, CFG.stair.textDistance);
    const label = texts.find((t) => /^(UP|DN|上|下)/i.test(t.text) && inBox(t.at, near));
    const tip = arrowTip(nonWallSegs, expand(run.bbox, 200));
    if (!label && !tip) continue;
    const axis: 'x' | 'y' = run.theta === 0 ? 'y' : run.theta === 90 ? 'x' : (Math.abs(dirOf(run.theta).x) > 0.7 ? 'y' : 'x');   // 踏面の法線方向が上る向き
    const lo = axis === 'x' ? run.bbox.minX : run.bbox.minY, hi = axis === 'x' ? run.bbox.maxX : run.bbox.maxY;
    let ascendPositive: boolean;
    const isDown = !!label && /^(DN|下)/i.test(label.text);
    if (tip) { const c = axis === 'x' ? tip.x : tip.y; ascendPositive = isDown ? c - lo < hi - c : c - lo > hi - c; }
    else { const c = axis === 'x' ? label!.at.x : label!.at.y; ascendPositive = isDown ? c - lo > hi - c : c - lo < hi - c; }   // UP は文字側から上る
    flights.push({ flight: { rect: run.bbox, axis, ascendPositive, treads: run.segs.length - 1 }, run, start: null });
  }
  // 1,500 mm 以内の flight を 1 つの階段にまとめ、間を踊り場にする
  const stairs: Stair[] = [];
  const used = new Set<number>();
  flights.forEach((f, i) => {
    if (used.has(i)) return;
    const group = [f]; used.add(i);
    flights.forEach((g, j) => { if (!used.has(j) && boxDistance(f.flight.rect, g.flight.rect) <= CFG.stair.flightJoin) { group.push(g); used.add(j); } });
    const landings: Box2[] = [];
    for (let k = 0; k + 1 < group.length; k++) landings.push(gapBox(group[k].flight.rect, group[k + 1].flight.rect));
    stairs.push({ flights: group.map((g) => g.flight), landings });
  });
  return stairs;
}

function boxDistance(a: Box2, b: Box2): number {
  const dx = Math.max(0, Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX));
  const dy = Math.max(0, Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY));
  return Math.hypot(dx, dy);
}
function gapBox(a: Box2, b: Box2): Box2 {
  return { minX: Math.min(a.maxX, b.maxX) < Math.max(a.minX, b.minX) ? Math.min(a.maxX, b.maxX) : Math.min(a.minX, b.minX), minY: Math.min(a.maxY, b.maxY) < Math.max(a.minY, b.minY) ? Math.min(a.maxY, b.maxY) : Math.min(a.minY, b.minY), maxX: Math.min(a.maxX, b.maxX) < Math.max(a.minX, b.minX) ? Math.max(a.minX, b.minX) : Math.max(a.maxX, b.maxX), maxY: Math.min(a.maxY, b.maxY) < Math.max(a.minY, b.minY) ? Math.max(a.minY, b.minY) : Math.max(a.maxY, b.maxY) };
}
export { fromRhoS, dot };
```

`gapBox` は「2 つの矩形の間の空き」を返す。読みにくければ `x` `y` それぞれで「離れていれば間、重なっていれば和」に分けて書き直してよい（挙動は同じ）。

**Step 3: Commit（Task 9 でテストが通ってから）**

---
### Task 9: `recognize/axes.ts` `region.ts` `index.ts` 通り芯・範囲選択・合成（設計書 §7.2 手順 7〜9、§6.2 手順 3）

**Files:**
- Create: `src/recognize/axes.ts` `src/recognize/region.ts` `src/recognize/index.ts`
- Test: `src/recognize/index.test.ts`（Task 7・8 のテストもここで通す）

**Step 1: 失敗するテスト**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadDxf } from '../dxf';
import { recognizePlan } from './index';
import { selectRegion } from './region';

const sample = () => loadDxf(new Uint8Array(readFileSync('fixtures/sample-house.dxf')).buffer, 'sample');

describe('selectRegion', () => {
  it('小さな矩形でも、交差する通り芯が入るので 1 階平面図全体が選ばれる', () => {
    const sel = selectRegion(sample(), { minX: 3000, minY: 3000, maxX: 4000, maxY: 4000 });
    expect(sel.bbox.minX).toBeLessThan(-900);      // 通り芯の端まで
    expect(sel.bbox.maxX).toBeLessThan(11000);      // 2 階（X 12,000〜）は入らない
    expect(sel.entities.length).toBeGreaterThan(50);
  });
  it('何も交差しなければ空', () => {
    expect(selectRegion(sample(), { minX: 30000, minY: 30000, maxX: 31000, maxY: 31000 }).entities).toHaveLength(0);
  });
});

describe('recognizePlan（自作 1 階）', () => {
  const m = recognizePlan(selectRegion(sample(), { minX: 3000, minY: 3000, maxX: 4000, maxY: 4000 }));
  it('通り芯 6 本（X1〜X3・Y1〜Y3）', () => {
    expect(m.axes.map((a) => a.label).sort()).toEqual(['X1', 'X2', 'X3', 'Y1', 'Y2', 'Y3']);
  });
  it('外壁 4 本・外形は矩形', () => {
    expect(m.walls.filter((w) => w.exterior).length).toBe(4);
    expect(m.outline.length).toBe(4);
  });
  it('壁に使った線は decorLines に残らず、通り芯と文字は残る', () => {
    expect(m.decorLines.some((e) => e.kind === 'line' && e.layer === '壁')).toBe(false);
    expect(m.decorLines.some((e) => e.kind === 'line' && e.layer === '通り芯')).toBe(true);
    expect(m.warnings).toHaveLength(0);
  });
});

describe('recognizePlan（壁が無い図面）', () => {
  it('落ちずに warnings に 1 行入り、外形は空', () => {
    const m = recognizePlan({ entities: [{ kind: 'text', layer: '0', at: { x: 0, y: 0 }, text: 'メモ', height: 100 }], bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, sourceName: 't' });
    expect(m.walls).toHaveLength(0);
    expect(m.warnings[0]).toContain('壁を認識できません');
  });
});
```

**Step 2: 実装**

`src/recognize/axes.ts`:

```ts
import type { GridAxis, PlanEntity } from '../model/types';
import { CFG } from './config';

/** 円の中にラベル文字があり、円周に線が接している → 通り芯。ラベルごとに 1 本にまとめる */
export function detectAxes(entities: PlanEntity[]): GridAxis[] {
  const circles = entities.filter((e): e is Extract<PlanEntity, { kind: 'circle' }> => e.kind === 'circle' && e.radius >= CFG.axis.minR && e.radius <= CFG.axis.maxR);
  const texts = entities.filter((e): e is Extract<PlanEntity, { kind: 'text' }> => e.kind === 'text' && CFG.axis.label.test(e.text.trim()));
  const lines = entities.filter((e): e is Extract<PlanEntity, { kind: 'line' }> => e.kind === 'line');
  const byLabel = new Map<string, GridAxis>();
  for (const c of circles) {
    const t = texts.find((t) => Math.hypot(t.at.x - c.center.x, t.at.y - c.center.y) <= c.radius);
    if (!t) continue;
    const touching = lines.find((l) => [l.a, l.b].some((p) => Math.abs(Math.hypot(p.x - c.center.x, p.y - c.center.y) - c.radius) <= 5));
    if (!touching) continue;
    const label = t.text.trim();
    if (!byLabel.has(label)) byLabel.set(label, { label, a: touching.a, b: touching.b, bubble: c.center });
  }
  return [...byLabel.values()];
}
```

`src/recognize/region.ts`:

```ts
import type { Box2, PlanEntity, Plan2D } from '../model/types';
import { bboxOf } from '../dxf/parse';

const entityBox = (e: PlanEntity): Box2 => bboxOf([e]);
const intersects = (a: Box2, b: Box2) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

/** ドラッグ矩形に交差するエンティティを集め、その bbox を選択範囲にする（設計書 §6.2 手順 3） */
export function selectRegion(plan: Plan2D, rect: Box2): Plan2D {
  const entities = plan.entities.filter((e) => intersects(entityBox(e), rect));
  return { entities, bbox: bboxOf(entities), sourceName: plan.sourceName };
}
```

`src/recognize/index.ts`:

```ts
import type { PlanModel, Plan2D } from '../model/types';
import { detectAxes } from './axes';
import { extractBands } from './bands';
import { toSegments } from './geom';
import { detectOpenings } from './openings';
import { detectStairs } from './stairs';
import { bandsToWalls, computeOutline, decideWallLayers, markExterior } from './walls';

/** Plan2D → PlanModel。設計書 §7.2 の手順を順に呼ぶだけの合成関数 */
export function recognizePlan(plan: Plan2D): PlanModel {
  const segs = toSegments(plan.entities);
  const bands = extractBands(segs);
  const wallLayers = decideWallLayers(bands.walls);
  const rawWalls = markExterior(bandsToWalls(bands.walls, wallLayers), computeOutline(bandsToWalls(bands.walls, wallLayers)));
  const outline = computeOutline(rawWalls);
  const nonWallSegs = segs.filter((s) => !bands.usedLineIds.has(s.id));
  const { walls, openings } = detectOpenings(rawWalls, plan.entities, bands.symbols, wallLayers, nonWallSegs);
  const texts = plan.entities.filter((e): e is Extract<typeof e, { kind: 'text' }> => e.kind === 'text');
  const stairs = detectStairs(nonWallSegs, texts);
  const axes = detectAxes(plan.entities);
  const decorLines = plan.entities.filter((e, i) => e.kind !== 'text' && !(e.kind === 'line' && bands.usedLineIds.has(i)));
  const warnings = walls.length === 0 ? ['壁を認識できませんでした。レイヤー名を確認してください'] : [];
  return { walls, openings, stairs, axes, outline, decorLines, warnings };
}
export { selectRegion } from './region';
```

`toSegments` は `entities` の添字を `id` にしているので、`usedLineIds` と `decorLines` の添字が一致する。

**Step 3: Task 7・8・9 のテストをまとめて通す**

Run: `npx vitest run src/recognize` → 全件 PASS。forest-s の件が落ちたら、落ちた数値を `prototype/proto_walls_1f.png` と見比べて閾値（`config.ts`）を直す。閾値を変えたら設計書 §7.2 の数値も直す。

**Step 4: Commit**

```bash
git add src/recognize
git commit -m "feat: 開口・階段・通り芯の認識と PlanModel への合成"
```

---

### Task 10: `model/` 建物モデルの操作と位置合わせ（設計書 §6.2〜§6.5、§8.5）

**Files:**
- Create: `src/model/building.ts`
- Test: `src/model/building.test.ts`

**Step 1: 失敗するテスト**

```ts
import { describe, expect, it } from 'vitest';
import { addFloor, addRoof, alignToBelow, createBuilding, moveFloor, setInset, setTopZ, topFloorRect } from './building';
import type { PlanModel, Wall } from './types';

const wall = (id: string, x1: number, y1: number, x2: number, y2: number, exterior = true): Wall => ({ id, a: { x: x1, y: y1 }, b: { x: x2, y: y2 }, thickness: 150, exterior });
/** 9,100 × 5,915 の矩形平面。origin だけずらして 2 階を作る */
const plan = (ox = 0, oy = 0, labels = true): PlanModel => ({
  walls: [wall('a', ox, oy, ox + 9100, oy), wall('b', ox + 9100, oy, ox + 9100, oy + 5915), wall('c', ox + 9100, oy + 5915, ox, oy + 5915), wall('d', ox, oy + 5915, ox, oy)],
  openings: [], stairs: [], decorLines: [], warnings: [],
  axes: labels ? [{ label: 'X1', a: { x: ox, y: oy - 500 }, b: { x: ox, y: oy + 6500 }, bubble: { x: ox, y: oy - 800 } }, { label: 'Y1', a: { x: ox - 500, y: oy }, b: { x: ox + 9600, y: oy }, bubble: { x: ox - 800, y: oy } }] : [],
  outline: [{ x: ox - 75, y: oy - 75 }, { x: ox + 9175, y: oy - 75 }, { x: ox + 9175, y: oy + 5990 }, { x: ox - 75, y: oy + 5990 }],
});

describe('階の追加と高さ', () => {
  it('1 階は FL1 = 550 に置かれ、外壁芯の中心が原点に来る', () => {
    const m = addFloor(createBuilding(), plan());
    expect(m.floors[0].baseZ).toBe(550);
    expect(m.floors[0].topZ).toBe(550);
    expect(m.floors[0].offset).toEqual({ x: -4550, y: -2957.5 });
  });
  it('setTopZ は 50 mm に丸め、baseZ を下回らず、上の階を押し上げる', () => {
    let m = addFloor(addFloor(createBuilding(), plan()), plan(20000, 0));
    m = setTopZ(m, m.floors[0].id, 3372);
    expect(m.floors[0].topZ).toBe(3350);
    expect(m.floors[1].baseZ).toBe(3450);          // 3,350 + スラブ 100
    m = setTopZ(m, m.floors[0].id, 100);
    expect(m.floors[0].topZ).toBe(550);
  });
  it('moveFloor は 10 mm に丸める', () => {
    let m = addFloor(createBuilding(), plan());
    m = moveFloor(m, m.floors[0].id, 123, -7);
    expect(m.floors[0].offset).toEqual({ x: -4550 + 120, y: -2957.5 - 10 });
  });
});

describe('alignToBelow', () => {
  it('通り芯ラベルが両階にあれば芯を重ねる', () => {
    const m = addFloor(createBuilding(), plan());
    expect(alignToBelow(m.floors[0], plan(20000, 300))).toEqual({ x: -4550 - 20000, y: -2957.5 - 300 });
  });
  it('通り芯が無ければ外壁の重ね合わせで決まる', () => {
    const m = addFloor(createBuilding(), plan(0, 0, false));
    const off = alignToBelow(m.floors[0], plan(20000, 300, false));
    expect(off.x).toBeCloseTo(-4550 - 20000, 0);
    expect(off.y).toBeCloseTo(-2957.5 - 300, 0);
  });
});

describe('屋根', () => {
  it('既定は長手（X）方向の棟で、inset は W/2 + 軒の出', () => {
    const m = addRoof(setTopZ(addFloor(createBuilding(), plan()), 'f1', 3350));
    expect(m.roof?.axis).toBe('x');
    expect(m.roof?.inset).toEqual([5915 / 2 + 600, 5915 / 2 + 600]);
    expect(topFloorRect(m)).toEqual({ minX: -4550, minY: -2957.5, maxX: 4550, maxY: 2957.5 });
  });
  it('setInset は 100 mm 以内なら 0（切妻）に、L/2 を超えない', () => {
    let m = addRoof(addFloor(createBuilding(), plan()));
    m = setInset(m, 0, 80);
    expect(m.roof?.inset[0]).toBe(0);
    m = setInset(m, 1, 99999);
    expect(m.roof?.inset[1]).toBe(4550);
  });
});
```

**Step 2: 落ちることを確認** → FAIL

**Step 3: 実装**

```ts
import type { Box2, BuildingModel, FloorBlock, PlanModel, Roof, Vec2, Wall } from './types';

const SNAP_Z = 50, SNAP_XY = 10, INSET_SNAP = 100;
const snap = (v: number, step: number) => Math.round(v / step) * step;

export function createBuilding(): BuildingModel {
  return { floor1Level: 550, slabThickness: 100, floors: [] };
}

/** 外壁芯の外接矩形（平面図座標） */
export function centerlineRect(plan: PlanModel): Box2 {
  const pts = plan.walls.filter((w) => w.exterior).flatMap((w) => [w.a, w.b]);
  if (pts.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return pts.reduce((b, p) => ({ minX: Math.min(b.minX, p.x), minY: Math.min(b.minY, p.y), maxX: Math.max(b.maxX, p.x), maxY: Math.max(b.maxY, p.y) }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

const shift = (b: Box2, o: Vec2): Box2 => ({ minX: b.minX + o.x, minY: b.minY + o.y, maxX: b.maxX + o.x, maxY: b.maxY + o.y });

/** 2 階目以降の位置合わせ。設計書 §8.5 の優先順 */
export function alignToBelow(below: FloorBlock, plan: PlanModel): Vec2 {
  // 1. 通り芯ラベルの一致
  const isX = (a: { a: Vec2; b: Vec2 }) => Math.abs(a.a.x - a.b.x) < Math.abs(a.a.y - a.b.y);
  let dx: number | undefined, dy: number | undefined;
  for (const ax of plan.axes) {
    const match = below.plan.axes.find((b) => b.label === ax.label);
    if (!match) continue;
    if (isX(ax) && dx === undefined) dx = match.a.x + below.offset.x - ax.a.x;
    if (!isX(ax) && dy === undefined) dy = match.a.y + below.offset.y - ax.a.y;
  }
  if (dx !== undefined && dy !== undefined) return { x: dx, y: dy };
  // 2. 外壁の重ね合わせ: 候補の平行移動ごとに外壁芯の重なり長を足し、最大を選ぶ
  const ext = (ws: Wall[], o: Vec2) => ws.filter((w) => w.exterior).map((w) => ({ a: { x: w.a.x + o.x, y: w.a.y + o.y }, b: { x: w.b.x + o.x, y: w.b.y + o.y } }));
  const lower = ext(below.plan.walls, below.offset), upper = ext(plan.walls, { x: 0, y: 0 });
  const bestAlong = (axis: 'x' | 'y') => {
    const other = axis === 'x' ? 'y' : 'x';
    const vertical = (w: { a: Vec2; b: Vec2 }) => Math.abs(w.a[axis] - w.b[axis]) < 1;   // その軸に直交する壁（位置が axis 座標で決まる）
    const L = lower.filter(vertical), U = upper.filter(vertical);
    const rb = shift(centerlineRect(below.plan), below.offset), ru = centerlineRect(plan);
    const candidates = new Set<number>([((rb.minX + rb.maxX) / 2 - (ru.minX + ru.maxX) / 2)]);
    if (axis === 'y') { candidates.clear(); candidates.add((rb.minY + rb.maxY) / 2 - (ru.minY + ru.maxY) / 2); }
    for (const l of L) for (const u of U) candidates.add(l.a[axis] - u.a[axis]);
    let best = [...candidates][0], bestScore = -1;
    for (const d of candidates) {
      let score = 0;
      for (const l of L) for (const u of U) {
        if (Math.abs(l.a[axis] - (u.a[axis] + d)) > 20) continue;
        score += Math.max(0, Math.min(Math.max(l.a[other], l.b[other]), Math.max(u.a[other], u.b[other])) - Math.max(Math.min(l.a[other], l.b[other]), Math.min(u.a[other], u.b[other])));
      }
      if (score > bestScore) { bestScore = score; best = d; }
    }
    return best;
  };
  return { x: dx ?? bestAlong('x'), y: dy ?? bestAlong('y') };
}

let floorSeq = 1;
export function addFloor(model: BuildingModel, plan: PlanModel): BuildingModel {
  const level = model.floors.length + 1;
  const below = model.floors[model.floors.length - 1];
  const rect = centerlineRect(plan);
  const offset: Vec2 = below ? alignToBelow(below, plan) : { x: -(rect.minX + rect.maxX) / 2, y: -(rect.minY + rect.maxY) / 2 };
  const baseZ = below ? below.topZ + model.slabThickness : model.floor1Level;
  const floor: FloorBlock = { id: `f${floorSeq++}`, level, plan, offset, baseZ, topZ: baseZ };
  return { ...model, floors: [...model.floors, floor] };
}

/** 積み重ねの不変条件: base_i = top_{i-1} + slab。各階の高さ（top − base）は保つ */
function restack(model: BuildingModel): BuildingModel {
  const floors: FloorBlock[] = [];
  model.floors.forEach((f, i) => {
    const baseZ = i === 0 ? model.floor1Level : floors[i - 1].topZ + model.slabThickness;
    floors.push({ ...f, baseZ, topZ: baseZ + (f.topZ - f.baseZ) });
  });
  return { ...model, floors };
}

export function setTopZ(model: BuildingModel, floorId: string, z: number): BuildingModel {
  return restack({ ...model, floors: model.floors.map((f) => (f.id === floorId ? { ...f, topZ: Math.max(f.baseZ, snap(z, SNAP_Z)) } : f)) });
}
export function setFloor1Level(model: BuildingModel, level: number): BuildingModel {
  return restack({ ...model, floor1Level: Math.max(0, level) });
}
export function moveFloor(model: BuildingModel, floorId: string, dx: number, dy: number): BuildingModel {
  return { ...model, floors: model.floors.map((f) => (f.id === floorId ? { ...f, offset: { x: f.offset.x + snap(dx, SNAP_XY), y: f.offset.y + snap(dy, SNAP_XY) } } : f)) };
}

/** 最上階の外壁芯の外接矩形（建物座標） */
export function topFloorRect(model: BuildingModel): Box2 {
  const top = model.floors[model.floors.length - 1];
  return shift(centerlineRect(top.plan), top.offset);
}

/** 寄棟の既定 inset = W/2 + 軒の出（L/2 を超えない）。設計書 §8.4 */
export function defaultInset(rect: Box2, axis: 'x' | 'y', eave: number): number {
  const W = axis === 'x' ? rect.maxY - rect.minY : rect.maxX - rect.minX;
  const L = axis === 'x' ? rect.maxX - rect.minX : rect.maxY - rect.minY;
  return Math.min(W / 2 + eave, L / 2);
}

export function addRoof(model: BuildingModel): BuildingModel {
  if (model.floors.length === 0) return model;
  const rect = topFloorRect(model);
  const axis: 'x' | 'y' = rect.maxX - rect.minX >= rect.maxY - rect.minY ? 'x' : 'y';
  const eave = 600;
  const inset = defaultInset(rect, axis, eave);
  const roof: Roof = { axis, ridgeOffset: 0, inset: [inset, inset], pitchSun: 4, eave, verge: 600, thickness: 150 };
  return { ...model, roof };
}
export const removeRoof = (model: BuildingModel): BuildingModel => ({ ...model, roof: undefined });
export const setRoofParam = (model: BuildingModel, patch: Partial<Roof>): BuildingModel => (model.roof ? { ...model, roof: { ...model.roof, ...patch } } : model);

export function rotateRidge(model: BuildingModel): BuildingModel {
  if (!model.roof) return model;
  const axis = model.roof.axis === 'x' ? 'y' : 'x';
  const inset = defaultInset(topFloorRect(model), axis, model.roof.eave);
  return { ...model, roof: { ...model.roof, axis, inset: [inset, inset], ridgeOffset: 0 } };
}

/** 端点のドラッグ。0（切妻）と既定の寄棟位置に 100 mm でスナップ */
export function setInset(model: BuildingModel, end: 0 | 1, value: number): BuildingModel {
  if (!model.roof) return model;
  const rect = topFloorRect(model);
  const L = model.roof.axis === 'x' ? rect.maxX - rect.minX : rect.maxY - rect.minY;
  const def = defaultInset(rect, model.roof.axis, model.roof.eave);
  let v = Math.max(0, Math.min(L / 2, value));
  if (v <= INSET_SNAP) v = 0;
  else if (Math.abs(v - def) <= INSET_SNAP) v = def;
  const inset: [number, number] = [...model.roof.inset] as [number, number];
  inset[end] = v;
  return { ...model, roof: { ...model.roof, inset } };
}

export function setRidgeOffset(model: BuildingModel, value: number): BuildingModel {
  if (!model.roof) return model;
  const rect = topFloorRect(model);
  const W = model.roof.axis === 'x' ? rect.maxY - rect.minY : rect.maxX - rect.minX;
  const lim = Math.max(0, W / 2 - 300);
  return { ...model, roof: { ...model.roof, ridgeOffset: Math.max(-lim, Math.min(lim, snap(value, SNAP_XY))) } };
}
```

`floorSeq` はテストの `'f1'` 参照に合わせ、テストファイル内で `createBuilding()` を作るたびに `resetIds()` を呼べるよう `export function resetIds() { floorSeq = 1; }` を足す。

**Step 4: 通ることを確認** → `npx vitest run src/model/building.test.ts` PASS

**Step 5: Commit** → `git commit -m "feat: 建物モデルの操作（階の追加・高さ・横移動・位置合わせ・屋根パラメータ）"`

---

### Task 11: `model/roof.ts` 屋根の幾何（設計書 §8.4）

**Files:**
- Create: `src/model/roof.ts`
- Test: `src/model/roof.test.ts`

**Step 1: 失敗するテスト**

```ts
import { describe, expect, it } from 'vitest';
import { roofHeightAt, solveRoof } from './roof';
import type { Roof } from './types';

const rect = { minX: -4550, minY: -2957.5, maxX: 4550, maxY: 2957.5 };
const base: Roof = { axis: 'x', ridgeOffset: 0, inset: [5915 / 2 + 600, 5915 / 2 + 600], pitchSun: 4, eave: 600, verge: 600, thickness: 150 };
const He = 6500;

describe('solveRoof', () => {
  it('棟高は He + p × W/2', () => {
    const g = solveRoof(base, rect, He);
    expect(g.ridgeZ).toBeCloseTo(He + 0.4 * (5915 / 2));
    expect(g.ridge[0].x).toBeCloseTo(-4550 + base.inset[0]);
  });
  it('既定の寄棟では端面の勾配も 4 寸', () => {
    const g = solveRoof(base, rect, He);
    const eaveCornerZ = roofHeightAt(g, -4550 - 600, -2957.5 - 600);
    const slope = (g.ridgeZ - eaveCornerZ) / (g.ridge[0].x - (-4550 - 600));
    expect(slope).toBeCloseTo(0.4, 5);
    expect(g.planes).toHaveLength(4);
  });
  it('inset 0 は切妻: 面は 2 枚、棟端はケラバ先端まで、妻側の壁芯上で棟高になる', () => {
    const g = solveRoof({ ...base, inset: [0, 0] }, rect, He);
    expect(g.planes).toHaveLength(2);
    expect(g.ridge[0].x).toBeCloseTo(-4550 - 600);
    expect(roofHeightAt(g, -4550, 0)).toBeCloseTo(g.ridgeZ);
    expect(roofHeightAt(g, 0, -2957.5)).toBeCloseTo(He);        // 軒側の壁芯上は He
  });
  it('軸が y でも同じ式（x と y を入れ替えるだけ）', () => {
    const g = solveRoof({ ...base, axis: 'y', inset: [0, 0] }, rect, He);
    expect(g.ridgeZ).toBeCloseTo(He + 0.4 * (9100 / 2));
    expect(roofHeightAt(g, -4550, 0)).toBeCloseTo(He);
  });
});
```

**Step 2: 実装**

```ts
import type { Box2, Roof } from './types';

export interface Vec3 { x: number; y: number; z: number }
/** 屋根の解。座標は建物座標（mm）。planes は上面の多角形、edges は棟・隅棟（赤線） */
export interface RoofGeom { ridgeZ: number; ridge: [Vec3, Vec3]; planes: Vec3[][]; edges: [Vec3, Vec3][]; heightAt: (x: number, y: number) => number }

/** 棟が X 方向の局所系で解き、axis が y なら x⇔y を入れ替えて返す */
export function solveRoof(roof: Roof, rect: Box2, He: number): RoofGeom {
  const swap = roof.axis === 'y';
  const r = swap ? { minX: rect.minY, minY: rect.minX, maxX: rect.maxY, maxY: rect.maxX } : rect;
  const p = roof.pitchSun / 10, e = roof.eave, v = roof.verge;
  const [x0, x1, y0, y1] = [r.minX, r.maxX, r.minY, r.maxY];
  const yr = (y0 + y1) / 2 + roof.ridgeOffset;
  const ridgeZ = He + p * Math.max(yr - y0, y1 - yr);
  const hMain = (y: number) => ridgeZ - p * Math.abs(y - yr);
  const gable = [roof.inset[0] <= 0, roof.inset[1] <= 0];
  const xa = x0 - (gable[0] ? v : e), xb = x1 + (gable[1] ? v : e);
  const xr0 = gable[0] ? xa : x0 + roof.inset[0], xr1 = gable[1] ? xb : x1 - roof.inset[1];
  const ya = y0 - e, yb = y1 + e;
  const eaveZ = hMain(ya), eaveZb = hMain(yb);
  // 寄棟端の面の高さ: 棟端点から軒先の角へ直線的に下がる
  const endHeight = (x: number): number => {
    let h = Infinity;
    if (!gable[0] && x < xr0) h = Math.min(h, ridgeZ - ((ridgeZ - Math.min(eaveZ, eaveZb)) * (xr0 - x)) / (xr0 - xa));
    if (!gable[1] && x > xr1) h = Math.min(h, ridgeZ - ((ridgeZ - Math.min(eaveZ, eaveZb)) * (x - xr1)) / (xb - xr1));
    return h;
  };
  const heightLocal = (x: number, y: number) => Math.min(hMain(y), endHeight(x));
  const P = (x: number, y: number): Vec3 => ({ x, y, z: heightLocal(x, y) });
  const planes: Vec3[][] = [
    [P(xa, ya), P(xb, ya), P(xr1, yr), P(xr0, yr)],          // 軒側（y 小）
    [P(xr0, yr), P(xr1, yr), P(xb, yb), P(xa, yb)],          // 軒側（y 大）
  ];
  const edges: [Vec3, Vec3][] = [[P(xr0, yr), P(xr1, yr)]];
  if (!gable[0]) { planes.push([P(xa, ya), P(xr0, yr), P(xa, yb)]); edges.push([P(xr0, yr), P(xa, ya)], [P(xr0, yr), P(xa, yb)]); }
  if (!gable[1]) { planes.push([P(xb, ya), P(xb, yb), P(xr1, yr)]); edges.push([P(xr1, yr), P(xb, ya)], [P(xr1, yr), P(xb, yb)]); }
  const un = (q: Vec3): Vec3 => (swap ? { x: q.y, y: q.x, z: q.z } : q);
  return {
    ridgeZ,
    ridge: [un(P(xr0, yr)), un(P(xr1, yr))],
    planes: planes.map((poly) => poly.map(un)),
    edges: edges.map(([a, b]) => [un(a), un(b)]),
    heightAt: (x, y) => (swap ? heightLocal(y, x) : heightLocal(x, y)),
  };
}
export const roofHeightAt = (g: RoofGeom, x: number, y: number) => g.heightAt(x, y);
```

`endHeight` の「軒先の角の高さ」は `min(eaveZ, eaveZb)` を使う。`ridgeOffset = 0` なら両者は等しく、設計書 §8.4 の式そのものになる。非対称のときの端面は Q7 の判断待ちで、ここでは低い方に合わせる `[暫定]`。

**Step 3: 通ることを確認** → `npx vitest run src/model/roof.test.ts` PASS

**Step 4: Commit** → `git commit -m "feat: 棟モデルによる屋根の幾何（寄棟・切妻・高さ関数）"`

---
### Task 12: `geometry/` メッシュ生成（設計書 §8.1〜§8.3、§8.6）

**Files:**
- Create: `src/geometry/coords.ts` `src/geometry/wallShape.ts` `src/geometry/build.ts`
- Test: `src/geometry/wallShape.test.ts` `src/geometry/build.test.ts`

設計書 §4.3 の座標変換はここ（`src/geometry/coords.ts`）の 1 か所に置く。ジオメトリはすべて**モデル座標（mm・Z 上）で組み立ててから** `MODEL_TO_SCENE` を 1 回掛ける。設計書 §4.3 も同じ場所を指している（2026-09-03 に同期済み）。

**先行検証の結果（2026-09-03 に Node で実機確認済み）**

| 確かめたこと | 結果 |
|---|---|
| `Shape` + `Path` の穴 2 個を `ExtrudeGeometry` で押し出す | 動く。頂点 144、範囲は x 0〜5,000 / y 0〜3,000 / z 0〜150 で意図どおり。**穴は `new Path(points)` で作る**（`Shape` ではない） |
| 切り欠き（天端まで抜けた開口を外形に含める） | 動く。頂点 72 |
| `MODEL_TO_SCENE` 行列 | (9100, 5915, 3350) mm → (9.1, 3.35, −5.915) で設計書 §4.3 のとおり |
| `ShapeUtils.triangulateShape(contour, holes)` | `[[2,3,0],[0,1,2]]` のように頂点添字の三つ組を返す。屋根の面に使える |
| `EdgesGeometry(g, 20)` | 動く。穴 2 個の壁で線分 40 本 |
| `ExtrudeGeometry` の index | **付かない**（`getIndex()` が null）。`mergeGeometries` は index 有無の両方を扱う必要がある |

**Step 1: 失敗するテスト（壁の輪郭）**

`src/geometry/wallShape.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildWallProfile } from './wallShape';
import type { Opening } from '../model/types';

const door: Opening = { wallId: 'w', offset: 1000, width: 800, type: 'door', sill: 0, head: 2000 };
const win: Opening = { wallId: 'w', offset: 2500, width: 1200, type: 'window', sill: 900, head: 2000 };

describe('buildWallProfile', () => {
  it('壁が低い（H=1000）とドアは天端まで抜けた切り欠きになり、穴は無い', () => {
    const p = buildWallProfile(5000, 1000, [door, win]);
    expect(p.holes).toHaveLength(0);
    expect(p.outline.some((q) => q.z === 0 && q.s > 1000 && q.s < 1800)).toBe(true);   // 切り欠きの底
  });
  it('H=1500 では窓は sill 900 から天端までの切り欠き', () => {
    const p = buildWallProfile(5000, 1500, [win]);
    expect(p.holes).toHaveLength(0);
    expect(p.outline.some((q) => q.z === 900)).toBe(true);
  });
  it('H=3000 ではドアも窓も穴になる', () => {
    const p = buildWallProfile(5000, 3000, [door, win]);
    expect(p.holes).toHaveLength(2);
  });
  it('天端プロファイルを与えると上辺がそれに従う（妻壁）', () => {
    const p = buildWallProfile(5000, 3000, [], (s) => 3000 + (s < 2500 ? s : 5000 - s) * 0.4);
    const apex = Math.max(...p.outline.map((q) => q.z));
    expect(apex).toBeCloseTo(4000, 0);
  });
});
```

**Step 2: 実装（壁の輪郭）**

`src/geometry/wallShape.ts`:

```ts
import type { Opening } from '../model/types';

export interface SZ { s: number; z: number }
export interface WallProfile { outline: SZ[]; holes: SZ[][] }

const SAMPLE = 100;

/**
 * 壁面の輪郭（s = 壁芯に沿う距離, z = 床からの高さ）と穴を作る。設計書 §8.2。
 * head ≥ H の開口は天端に抜ける切り欠きとして輪郭に含め、head < H の開口は穴にする。
 * topProfile を渡すと天端がその高さになる（妻壁、設計書 §8.6）
 */
export function buildWallProfile(L: number, H: number, openings: Opening[], topProfile?: (s: number) => number): WallProfile {
  const top = (s: number) => (topProfile ? Math.max(H, topProfile(s)) : H);
  const notches = openings.filter((o) => o.sill < H && o.head >= H).sort((a, b) => a.offset - b.offset);
  const holes = openings.filter((o) => o.sill < H && o.head < H).map((o) => [
    { s: o.offset, z: o.sill }, { s: o.offset + o.width, z: o.sill }, { s: o.offset + o.width, z: o.head }, { s: o.offset, z: o.head },
  ]);
  // 天端を s の昇順にサンプルし、切り欠きの区間は sill まで下げる
  const topEdge: SZ[] = [];
  const push = (s: number, z: number) => { const last = topEdge[topEdge.length - 1]; if (!last || last.s !== s || last.z !== z) topEdge.push({ s, z }); };
  let s = 0;
  const cutAt = (x: number) => notches.find((n) => x > n.offset && x < n.offset + n.width);
  while (s < L) {
    const n = cutAt(s + 0.5);
    if (n) { push(n.offset, top(n.offset)); push(n.offset, n.sill); push(n.offset + n.width, n.sill); push(n.offset + n.width, top(n.offset + n.width)); s = n.offset + n.width; continue; }
    push(s, top(s));
    const next = notches.find((m) => m.offset > s);
    s = Math.min(L, s + SAMPLE, next ? next.offset : L);
  }
  push(L, top(L));
  const outline: SZ[] = [{ s: 0, z: 0 }, { s: L, z: 0 }, ...topEdge.reverse()];
  return { outline, holes };
}
```

**Step 3: 通ることを確認** → `npx vitest run src/geometry/wallShape.test.ts` PASS

**Step 4: 失敗するテスト（three.js ジオメトリ）**

`src/geometry/build.test.ts`:

```ts
import { Box3, Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { addFloor, addRoof, createBuilding, setTopZ } from '../model/building';
import { buildBuilding } from './build';
import type { PlanModel, Wall } from '../model/types';

const wall = (id: string, x1: number, y1: number, x2: number, y2: number): Wall => ({ id, a: { x: x1, y: y1 }, b: { x: x2, y: y2 }, thickness: 150, exterior: true });
const plan: PlanModel = {
  walls: [wall('a', 0, 0, 9100, 0), wall('b', 9100, 0, 9100, 5915), wall('c', 9100, 5915, 0, 5915), wall('d', 0, 5915, 0, 0)],
  openings: [{ wallId: 'a', offset: 1000, width: 1820, type: 'window', sill: 0, head: 2000 }], stairs: [], axes: [], decorLines: [], warnings: [],
  outline: [{ x: -75, y: -75 }, { x: 9175, y: -75 }, { x: 9175, y: 5990 }, { x: -75, y: 5990 }],
};

describe('buildBuilding', () => {
  it('1 階だけ: 基礎 + 板 + 壁 4 本のメッシュができ、全体の高さはシーンで 0 〜 3.35 m', () => {
    const m = setTopZ(addFloor(createBuilding(), plan), 'f1', 3350);
    const g = buildBuilding(m);
    const box = new Box3().setFromObject(g.group);
    expect(box.min.y).toBeCloseTo(0, 3);
    expect(box.max.y).toBeCloseTo(3.35, 3);
    expect(g.group.children.filter((c) => c.name === 'wall')).toHaveLength(4);
    expect(g.group.children.some((c) => c.name === 'foundation')).toBe(true);
  });
  it('屋根をかけると最高点は棟高、切妻側の壁は棟高まで伸びる', () => {
    let m = setTopZ(addFloor(createBuilding(), plan), 'f1', 3350);
    m = addRoof(m);
    m = { ...m, roof: { ...m.roof!, inset: [0, 0] } };
    const g = buildBuilding(m);
    const roof = g.group.children.find((c) => c.name === 'roof') as Mesh;
    const ridgeZ = 3350 + 0.4 * (5915 / 2);
    expect(new Box3().setFromObject(roof).max.y).toBeCloseTo(ridgeZ / 1000, 3);
    const gableWall = g.group.children.find((c) => c.name === 'wall' && c.userData.wallId === 'd') as Mesh;
    expect(new Box3().setFromObject(gableWall).max.y).toBeCloseTo(ridgeZ / 1000, 2);
  });
});
```

**Step 5: 実装（座標とビルダー）**

`src/geometry/coords.ts`:

```ts
import { Matrix4, Vector3 } from 'three';

/** モデル (x, y, z)[mm] → シーン (x, z, −y)[m]。設計書 §4.3 の唯一の変換 */
export const MODEL_TO_SCENE = new Matrix4().set(
  0.001, 0, 0, 0,
  0, 0, 0.001, 0,
  0, -0.001, 0, 0,
  0, 0, 0, 1,
);
export const toScene = (x: number, y: number, z: number) => new Vector3(x, y, z).applyMatrix4(MODEL_TO_SCENE);
/** シーン → モデル（ハンドルのドラッグで使う） */
export const SCENE_TO_MODEL = MODEL_TO_SCENE.clone().invert();
```

`src/geometry/build.ts`:

```ts
import { BufferGeometry, EdgesGeometry, ExtrudeGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshLambertMaterial, Shape, ShapeUtils, Vector2, Vector3 } from 'three';
import { topFloorRect } from '../model/building';
import { solveRoof, type RoofGeom } from '../model/roof';
import type { BuildingModel, FloorBlock, PlanEntity, Polygon, Stair, Wall } from '../model/types';
import { MODEL_TO_SCENE } from './coords';
import { buildWallProfile } from './wallShape';

export const MATERIALS = {
  body: new MeshLambertMaterial({ color: 0xe6e6e6 }),
  roof: new MeshLambertMaterial({ color: 0x3a3a3a }),
  edge: new LineBasicMaterial({ color: 0x333333 }),
  decor: new LineBasicMaterial({ color: 0x3b7dd8 }),
  roofEdge: new LineBasicMaterial({ color: 0xe53935 }),
};

export interface BuiltBuilding { group: Group; roofGeom?: RoofGeom }

/** BuildingModel → three.js の Group。毎回すべて作り直す（設計書 §4.2） */
export function buildBuilding(model: BuildingModel): BuiltBuilding {
  const group = new Group();
  const top = model.floors[model.floors.length - 1];
  const roofGeom = model.roof && top ? solveRoof(model.roof, topFloorRect(model), top.topZ) : undefined;

  model.floors.forEach((floor, i) => {
    const outline = floor.plan.outline.map((p) => ({ x: p.x + floor.offset.x, y: p.y + floor.offset.y }));
    if (i === 0 && floor.baseZ - model.slabThickness > 0) group.add(named(solidMesh(prismGeometry(outline, 0, floor.baseZ - model.slabThickness)), 'foundation'));
    const slabHoles = i > 0 ? stairwellHoles(model.floors[i - 1], floor) : [];
    group.add(named(solidMesh(prismGeometry(outline, floor.baseZ - model.slabThickness, floor.baseZ, slabHoles)), 'slab'));
    const H = floor.topZ - floor.baseZ;
    for (const w of floor.plan.walls) {
      const profile = roofGeom && floor === top && w.exterior ? (s: number) => roofGeom.heightAt(w.a.x + floor.offset.x + ((w.b.x - w.a.x) * s) / len(w), w.a.y + floor.offset.y + ((w.b.y - w.a.y) * s) / len(w)) - floor.baseZ : undefined;
      const mesh = solidMesh(wallGeometry(w, floor.plan.openings.filter((o) => o.wallId === w.id), H, floor, profile));
      mesh.userData.wallId = w.id;
      group.add(named(mesh, 'wall'));
    }
    const holeSet = new Set(slabHoles.map((h) => h.stairIndex));
    floor.plan.stairs.forEach((st, k) => { if (!holeSet.has(k)) group.add(named(solidMesh(stairGeometry(st, floor, H)), 'stair')); });
    group.add(named(decorLines(floor.plan.decorLines, floor, floor.baseZ + 2), 'decor'));
    group.add(named(axisBubbles(floor), 'decor'));
  });

  if (roofGeom && model.roof) {
    group.add(named(new Mesh(roofGeometry(roofGeom, model.roof.thickness), MATERIALS.roof), 'roof'));
    group.add(named(segmentsToLines(roofGeom.edges.map(([a, b]) => [[a.x, a.y, a.z + 5], [b.x, b.y, b.z + 5]]), MATERIALS.roofEdge), 'roofEdge'));
  }
  return { group, roofGeom };
}

const named = <T extends { name: string }>(o: T, name: string) => { o.name = name; return o; };
const len = (w: Wall) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);

function solidMesh(geometry: BufferGeometry, material = MATERIALS.body): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.add(new LineSegments(new EdgesGeometry(geometry, 20), MATERIALS.edge));
  return mesh;
}

/** 多角形を z0 〜 z1 に押し出す。穴（吹き抜け）も掛けられる */
export function prismGeometry(outline: Polygon, z0: number, z1: number, holes: { poly: Polygon }[] = []): BufferGeometry {
  const shape = new Shape(outline.map((p) => new Vector2(p.x, p.y)));
  for (const h of holes) shape.holes.push(new (Shape as any)(h.poly.map((p) => new Vector2(p.x, p.y))));
  const g = new ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false });
  g.applyMatrix4(new Matrix4().makeTranslation(0, 0, z0)).applyMatrix4(MODEL_TO_SCENE);
  return g;
}

/** 壁: 局所 (s, z) の輪郭を法線方向に厚さ分押し出し、壁芯が中心に来るよう置く */
export function wallGeometry(w: Wall, openings: BuildingModel['floors'][number]['plan']['openings'], H: number, floor: FloorBlock, topProfile?: (s: number) => number): BufferGeometry {
  const L = len(w), ext = w.thickness / 2;
  const profile = buildWallProfile(L + 2 * ext, H, openings.map((o) => ({ ...o, offset: o.offset + ext })), topProfile ? (s) => topProfile(Math.min(L, Math.max(0, s - ext))) : undefined);
  const shape = new Shape(profile.outline.map((q) => new Vector2(q.s, q.z)));
  for (const h of profile.holes) shape.holes.push(new (Shape as any)(h.map((q) => new Vector2(q.s, q.z))));
  const g = new ExtrudeGeometry(shape, { depth: w.thickness, bevelEnabled: false });
  const ux = (w.b.x - w.a.x) / L, uy = (w.b.y - w.a.y) / L, nx = -uy, ny = ux;
  // 局所 X = 壁方向 u、局所 Y = モデル Z、局所 Z = 法線 n。原点は a から −u·ext − n·t/2
  const ox = w.a.x + floor.offset.x - ux * ext - nx * ext, oy = w.a.y + floor.offset.y - uy * ext - ny * ext;
  const local = new Matrix4().set(ux, 0, nx, ox, uy, 0, ny, oy, 0, 1, 0, 0, 0, 0, 0, 1);
  g.applyMatrix4(local).applyMatrix4(MODEL_TO_SCENE);
  return g;
}

/** 階段: 段ごとの直方体を 1 つのジオメトリにまとめる */
export function stairGeometry(st: Stair, floor: FloorBlock, H: number): BufferGeometry {
  const N = st.flights.reduce((n, f) => n + f.treads, 0) || 1;
  const boxes: Polygon[] = [], heights: number[] = [];
  let i = 0;
  st.flights.forEach((f, k) => {
    const { rect, axis, ascendPositive, treads } = f;
    const span = axis === 'x' ? rect.maxX - rect.minX : rect.maxY - rect.minY;
    for (let t = 0; t < treads; t++) {
      const from = ascendPositive ? t : treads - 1 - t, lo = (axis === 'x' ? rect.minX : rect.minY) + (span * from) / treads, hi = lo + span / treads;
      boxes.push(axis === 'x' ? [{ x: lo, y: rect.minY }, { x: hi, y: rect.minY }, { x: hi, y: rect.maxY }, { x: lo, y: rect.maxY }] : [{ x: rect.minX, y: lo }, { x: rect.maxX, y: lo }, { x: rect.maxX, y: hi }, { x: rect.minX, y: hi }]);
      heights.push((H * (i + 1)) / N); i++;
    }
    const landing = st.landings[k];
    if (landing) { boxes.push([{ x: landing.minX, y: landing.minY }, { x: landing.maxX, y: landing.minY }, { x: landing.maxX, y: landing.maxY }, { x: landing.minX, y: landing.maxY }]); heights.push((H * i) / N); }
  });
  const parts = boxes.map((b, k) => prismGeometry(b.map((p) => ({ x: p.x + floor.offset.x, y: p.y + floor.offset.y })), floor.baseZ, floor.baseZ + heights[k]));
  return mergeGeometries(parts);
}

/** 直下の階の階段と 50% 以上重なる階段は、段を作らずスラブに穴をあける（設計書 §8.3） */
function stairwellHoles(below: FloorBlock, floor: FloorBlock): { stairIndex: number; poly: Polygon }[] {
  const out: { stairIndex: number; poly: Polygon }[] = [];
  floor.plan.stairs.forEach((st, k) => {
    const r = unionBox(st.flights.map((f) => f.rect)), rx = { minX: r.minX + floor.offset.x, minY: r.minY + floor.offset.y, maxX: r.maxX + floor.offset.x, maxY: r.maxY + floor.offset.y };
    for (const bs of below.plan.stairs) {
      const b = unionBox(bs.flights.map((f) => f.rect)), bx = { minX: b.minX + below.offset.x, minY: b.minY + below.offset.y, maxX: b.maxX + below.offset.x, maxY: b.maxY + below.offset.y };
      const ov = Math.max(0, Math.min(rx.maxX, bx.maxX) - Math.max(rx.minX, bx.minX)) * Math.max(0, Math.min(rx.maxY, bx.maxY) - Math.max(rx.minY, bx.minY));
      if (ov >= 0.5 * (rx.maxX - rx.minX) * (rx.maxY - rx.minY)) {
        out.push({ stairIndex: k, poly: [{ x: rx.minX - floor.offset.x, y: rx.minY - floor.offset.y }, { x: rx.maxX - floor.offset.x, y: rx.minY - floor.offset.y }, { x: rx.maxX - floor.offset.x, y: rx.maxY - floor.offset.y }, { x: rx.minX - floor.offset.x, y: rx.maxY - floor.offset.y }].map((p) => ({ x: p.x + floor.offset.x, y: p.y + floor.offset.y })) });
        break;
      }
    }
  });
  return out;
}
const unionBox = (bs: { minX: number; minY: number; maxX: number; maxY: number }[]) => bs.reduce((a, b) => ({ minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) }));

/** 屋根: 各面の上面 + 鉛直に thickness 下げた裏面 + 側面。XY に投影して三角形分割する */
export function roofGeometry(rg: RoofGeom, thickness: number): BufferGeometry {
  const pos: number[] = [];
  const tri = (a: Vector3, b: Vector3, c: Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (const poly of rg.planes) {
    const top = poly.map((p) => new Vector3(p.x, p.y, p.z)), bottom = poly.map((p) => new Vector3(p.x, p.y, p.z - thickness));
    const faces = ShapeUtils.triangulateShape(poly.map((p) => new Vector2(p.x, p.y)), []);
    for (const [a, b, c] of faces) { tri(top[a], top[b], top[c]); tri(bottom[c], bottom[b], bottom[a]); }
    for (let i = 0; i < poly.length; i++) { const j = (i + 1) % poly.length; tri(top[i], bottom[i], top[j]); tri(top[j], bottom[i], bottom[j]); }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  g.applyMatrix4(MODEL_TO_SCENE);
  return g;
}

/** 平面図の線・弧・円を床面の高さに青線で描く */
export function decorLines(entities: PlanEntity[], floor: FloorBlock, z: number): LineSegments {
  const segs: number[][][] = [];
  const o = floor.offset;
  for (const e of entities) {
    if (e.kind === 'line') segs.push([[e.a.x + o.x, e.a.y + o.y, z], [e.b.x + o.x, e.b.y + o.y, z]]);
    else if (e.kind === 'arc' || e.kind === 'circle') {
      const s0 = e.kind === 'arc' ? e.startDeg : 0, s1 = e.kind === 'arc' ? (e.endDeg <= e.startDeg ? e.endDeg + 360 : e.endDeg) : 360, n = 16;
      for (let i = 0; i < n; i++) {
        const t0 = ((s0 + ((s1 - s0) * i) / n) * Math.PI) / 180, t1 = ((s0 + ((s1 - s0) * (i + 1)) / n) * Math.PI) / 180;
        segs.push([[e.center.x + o.x + e.radius * Math.cos(t0), e.center.y + o.y + e.radius * Math.sin(t0), z], [e.center.x + o.x + e.radius * Math.cos(t1), e.center.y + o.y + e.radius * Math.sin(t1), z]]);
      }
    }
  }
  return segmentsToLines(segs, MATERIALS.decor);
}
function axisBubbles(floor: FloorBlock): LineSegments {
  return decorLines(floor.plan.axes.map((a) => ({ kind: 'circle', layer: 'axis', center: a.bubble, radius: 250 })), floor, floor.baseZ + 2);
}
function segmentsToLines(segs: number[][][], material: LineBasicMaterial): LineSegments {
  const pos: number[] = [];
  for (const [a, b] of segs) pos.push(...a, ...b);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.applyMatrix4(MODEL_TO_SCENE);
  return new LineSegments(g, material);
}
function mergeGeometries(parts: BufferGeometry[]): BufferGeometry {
  const pos: number[] = [];
  for (const p of parts) { const a = p.getAttribute('position'); const idx = p.getIndex(); if (idx) for (let i = 0; i < idx.count; i++) pos.push(a.getX(idx.getX(i)), a.getY(idx.getX(i)), a.getZ(idx.getX(i))); else for (let i = 0; i < a.count; i++) pos.push(a.getX(i), a.getY(i), a.getZ(i)); }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
```

`Shape` の穴は `new Path(points)` が正式なので、`new (Shape as any)(...)` は `Path` に置き換える（`import { Path } from 'three'`）。`ExtrudeGeometry` は穴が外形と交わると崩れるので、`buildWallProfile` が切り欠き（輪郭）と穴を分けているのはそのため。

**Step 6: 通ることを確認**

Run: `npx vitest run src/geometry` → PASS。`Box3.setFromObject` は `EdgesGeometry` の子も含むので、範囲は同じ。妻壁のテストが 1 cm 以上ずれたら、`wallGeometry` の `topProfile` に渡す s の範囲（ext の分だけずらす）を疑う。

**Step 7: Commit** → `git commit -m "feat: スラブ・基礎・壁（穴と切り欠き）・階段・屋根・妻壁のジオメトリ"`

---
### Task 13: `viewer/` シーン・カメラ・再生成・ラベル（設計書 §6.7、§2.3、§8）

**Files:**
- Create: `src/viewer/scene.ts` `src/viewer/labels.ts` `src/state/store.ts`
- Modify: `src/main.tsx` `src/ui/App.tsx`（仮の配線）

viewer と ui は DOM が要るので単体テストを書かない。代わりに各 Step の「動かして見る」を必ず行う。

**Step 1: ストア（React と viewer の共通の状態）**

`src/state/store.ts`:

```ts
import { useSyncExternalStore } from 'react';
import { createBuilding } from '../model/building';
import type { BuildingModel, Plan2D } from '../model/types';

export type Mode = 'idle' | 'select2d' | 'drawRect';
export interface AppState { model: BuildingModel; mode: Mode; plan2d?: Plan2D; notice?: string; busy?: string }

let state: AppState = { model: createBuilding(), mode: 'idle' };
const listeners = new Set<() => void>();

export const store = {
  get: () => state,
  /** 状態は不変。必ず新しいオブジェクトを返す */
  set: (patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => {
    state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
    listeners.forEach((l) => l());
  },
  updateModel: (fn: (m: BuildingModel) => BuildingModel) => store.set((s) => ({ model: fn(s.model) })),
  subscribe: (l: () => void) => { listeners.add(l); return () => listeners.delete(l); },
};
export const useAppState = () => useSyncExternalStore(store.subscribe, store.get);
```

**Step 2: シーン**

`src/viewer/scene.ts`:

```ts
import { AmbientLight, Box3, Color, DirectionalLight, GridHelper, Group, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { buildBuilding, type BuiltBuilding } from '../geometry/build';
import type { BuildingModel } from '../model/types';

/** three.js のシーン一式。モデルが変わるたびに建物の Group を作り直す */
export class Viewer {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(45, 1, 0.05, 500);
  readonly renderer = new WebGLRenderer({ antialias: true });
  readonly labelRenderer = new CSS2DRenderer();
  readonly controls: OrbitControls;
  readonly handles = new Group();       // Task 14 が使う
  built?: BuiltBuilding;
  private frame = 0;
  private onFrame: (() => void)[] = [];

  constructor(private container: HTMLElement) {
    this.scene.background = new Color(0xfafafa);
    this.scene.add(new AmbientLight(0xffffff, 0.9), Object.assign(new DirectionalLight(0xffffff, 0.6), { position: new Vector3(5, 10, 7) }));
    const coarse = new GridHelper(60, 60, 0xc8c8c8, 0xdedede), fine = new GridHelper(60, 600, 0xeeeeee, 0xeeeeee);
    fine.position.y = -0.001;
    this.scene.add(coarse, fine, this.handles);
    this.camera.position.set(-12, 9, 14);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.labelRenderer.domElement.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none';
    container.append(this.renderer.domElement, this.labelRenderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.mouseButtons = { LEFT: 0, MIDDLE: 2, RIGHT: 2 };   // 左: 回転、中・右: 平行移動
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    const loop = () => { this.frame = requestAnimationFrame(loop); this.controls.update(); this.onFrame.forEach((f) => f()); this.renderer.render(this.scene, this.camera); this.labelRenderer.render(this.scene, this.camera); };
    loop();
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    this.camera.aspect = w / Math.max(1, h); this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h); this.labelRenderer.setSize(w, h);
  }

  /** モデル → 建物の Group を差し替える。古いジオメトリは破棄する */
  setModel(model: BuildingModel) {
    if (this.built) { this.scene.remove(this.built.group); this.built.group.traverse((o: any) => o.geometry?.dispose?.()); }
    this.built = buildBuilding(model);
    this.scene.add(this.built.group);
  }

  fitToBuilding() {
    if (!this.built) return;
    const box = new Box3().setFromObject(this.built.group);
    if (box.isEmpty()) return;
    const center = box.getCenter(new Vector3()), size = box.getSize(new Vector3()).length();
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new Vector3(-0.9, 0.7, 1).normalize().multiplyScalar(size * 1.3));
  }

  everyFrame(fn: () => void) { this.onFrame.push(fn); }
  dispose() { cancelAnimationFrame(this.frame); this.renderer.dispose(); }
}
```

`src/viewer/labels.ts`:

```ts
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

/** 黒地・白文字の角丸ピル。ハンドルの直上に出す */
export function makeLabel(): CSS2DObject & { setText: (t: string) => void } {
  const div = document.createElement('div');
  div.className = 'label';
  div.style.cssText = 'background:#222;color:#fff;font:12px/1.4 system-ui,sans-serif;padding:3px 8px;border-radius:5px;white-space:nowrap;transform:translateY(-22px)';
  const obj = new CSS2DObject(div) as CSS2DObject & { setText: (t: string) => void };
  obj.setText = (t) => { div.textContent = t; obj.visible = !!t; };
  obj.visible = false;
  return obj;
}
```

**Step 3: 仮の配線で動かして見る**

**`StrictMode` の二重マウントに注意する。** `src/main.tsx` は `StrictMode` で包んであるので、`useEffect` は開発時に 2 回走る。`Viewer` を作る `useEffect` の cleanup で必ず `viewer.dispose()`（`WebGLRenderer.dispose()` と `cancelAnimationFrame`）を呼ぶこと。忘れると WebGL コンテキストが 2 つ生成され、「なぜか重い」「context lost」という原因の分かりにくい形で出る。

`src/ui/App.tsx` に、コンテナ `div` へ `new Viewer(el)` を作り、`store.subscribe` で `viewer.setModel(state.model)` を呼ぶ `useEffect` を書く。`npm run dev` で白い背景と格子が出て、左ドラッグで回転できることを確認する。設計書 A2 の「板」は Task 15 で DXF が読めてから確認する。

**Step 4: Commit** → `git commit -m "feat: three.js シーン・カメラ・ラベルと状態ストア"`

---

### Task 14: `viewer/handles.ts` 青・橙・紫・緑ハンドル（設計書 §6.3、§6.5）

**Files:**
- Create: `src/viewer/handles.ts`
- Modify: `src/ui/App.tsx`（Viewer 生成後に `new HandleController(viewer)`）

**Step 1: 実装**

```ts
import { BoxGeometry, Mesh, MeshBasicMaterial, OctahedronGeometry, Plane, Raycaster, SphereGeometry, TorusGeometry, Vector2, Vector3 } from 'three';
import { SCENE_TO_MODEL, toScene } from '../geometry/coords';
import { moveFloor, rotateRidge, setInset, setRidgeOffset, setTopZ, topFloorRect } from '../model/building';
import type { BuildingModel } from '../model/types';
import { store } from '../state/store';
import { makeLabel } from './labels';
import type { Viewer } from './scene';

type Kind = 'floor' | 'ridgeEnd' | 'ridgeMid' | 'rotate';
interface HandleData { kind: Kind; floorId?: string; end?: 0 | 1 }
const COLORS = { floor: 0x1e88e5, ridgeEnd: 0xf5a623, ridgeMid: 0x2eaf5c, rotate: 0x6b4de6 };
const DRAG_THRESHOLD_PX = 6;

/** ハンドルの生成・ホバー・ドラッグ。設計書 §6.3・§6.5 の操作をストアの純粋関数に変換する */
export class HandleController {
  private ray = new Raycaster();
  private label = makeLabel();
  private drag?: { data: HandleData; start: Vector2; mode?: 'height' | 'move'; startModel: BuildingModel; grabZ: number; grabXY: Vector3; moved: boolean };

  constructor(private viewer: Viewer) {
    viewer.scene.add(this.label);
    store.subscribe(() => this.rebuild(store.get().model));
    viewer.everyFrame(() => this.scaleToScreen());
    const el = viewer.renderer.domElement;
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', () => this.up());
  }

  /** モデルからハンドルを作り直す */
  rebuild(model: BuildingModel) {
    this.viewer.handles.clear();
    for (const f of model.floors) {
      const rect = f.plan.outline.reduce((b, p) => ({ minX: Math.min(b.minX, p.x), minY: Math.min(b.minY, p.y) }), { minX: Infinity, minY: Infinity });
      this.add(new BoxGeometry(1, 1, 1), 'floor', toScene(rect.minX + f.offset.x, rect.minY + f.offset.y, f.topZ), { kind: 'floor', floorId: f.id });
    }
    const built = this.viewer.built;
    if (model.roof && built?.roofGeom) {
      const [a, b] = built.roofGeom.ridge;
      this.add(new SphereGeometry(0.5, 16, 12), 'ridgeEnd', toScene(a.x, a.y, a.z), { kind: 'ridgeEnd', end: 0 });
      this.add(new SphereGeometry(0.5, 16, 12), 'ridgeEnd', toScene(b.x, b.y, b.z), { kind: 'ridgeEnd', end: 1 });
      const mid = toScene((a.x + b.x) / 2, (a.y + b.y) / 2, a.z);
      this.add(new OctahedronGeometry(0.6), 'ridgeMid', mid, { kind: 'ridgeMid' });
      const rot = this.add(new TorusGeometry(0.6, 0.12, 8, 24, 4.8), 'rotate', mid.clone().add(new Vector3(0, 1.2, 0)), { kind: 'rotate' });
      rot.rotation.x = -Math.PI / 2;
    }
  }
  private add(geometry: Mesh['geometry'], kind: Kind, pos: Vector3, data: HandleData) {
    const m = new Mesh(geometry, new MeshBasicMaterial({ color: COLORS[kind], depthTest: false }));
    m.position.copy(pos); m.userData = data; m.renderOrder = 10;
    this.viewer.handles.add(m);
    return m;
  }
  /** 画面上の大きさを一定にする（カメラ距離に比例して拡大） */
  private scaleToScreen() {
    for (const h of this.viewer.handles.children) { const s = h.position.distanceTo(this.viewer.camera.position) * 0.018; h.scale.setScalar(s); }
  }

  private pick(e: PointerEvent): Mesh | undefined {
    const r = this.viewer.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.viewer.camera);
    return this.ray.intersectObjects(this.viewer.handles.children)[0]?.object as Mesh | undefined;
  }
  /** レイと平面の交点（シーン座標） */
  private hitPlane(e: PointerEvent, plane: Plane): Vector3 | null {
    this.pick(e);
    const p = new Vector3();
    return this.ray.ray.intersectPlane(plane, p) ? p : null;
  }
  private verticalPlaneThrough(p: Vector3): Plane {
    const n = this.viewer.camera.getWorldDirection(new Vector3()); n.y = 0; n.normalize();
    return new Plane().setFromNormalAndCoplanarPoint(n, p);
  }

  private down(e: PointerEvent) {
    const hit = this.pick(e);
    if (!hit) return;
    this.viewer.controls.enabled = false;
    const model = store.get().model;
    const data = hit.userData as HandleData;
    const grab = this.hitPlane(e, this.verticalPlaneThrough(hit.position)) ?? hit.position.clone();
    const grabXY = this.hitPlane(e, new Plane(new Vector3(0, 1, 0), -hit.position.y)) ?? hit.position.clone();
    this.drag = { data, start: new Vector2(e.clientX, e.clientY), startModel: model, grabZ: grab.y, grabXY, moved: false };
  }

  private move(e: PointerEvent) {
    if (!this.drag) { this.hover(e); return; }
    const d = this.drag;
    const delta = new Vector2(e.clientX, e.clientY).sub(d.start);
    if (!d.moved && delta.length() < DRAG_THRESHOLD_PX) return;
    d.moved = true;
    const model = store.get().model;
    if (d.data.kind === 'floor') {
      d.mode ??= Math.abs(delta.y) >= Math.abs(delta.x) ? 'height' : 'move';   // 最初の 6 px で決めて固定
      const floor = d.startModel.floors.find((f) => f.id === d.data.floorId)!;
      if (d.mode === 'height') {
        const p = this.hitPlane(e, this.verticalPlaneThrough(toScene(0, 0, floor.topZ)));
        if (!p) return;
        const next = setTopZ(d.startModel, floor.id, floor.topZ + (p.y - d.grabZ) * 1000);
        store.set({ model: next });
        const f = next.floors.find((x) => x.id === floor.id)!;
        this.showLabel(`壁の高さ ${((f.topZ - next.floor1Level) / 1000).toFixed(2)} m`, toScene(0, 0, f.topZ), f);
      } else {
        const p = this.hitPlane(e, new Plane(new Vector3(0, 1, 0), -d.grabXY.y));
        if (!p) return;
        const m = p.clone().sub(d.grabXY).applyMatrix4(SCENE_TO_MODEL.clone().setPosition(0, 0, 0));
        store.set({ model: moveFloor(d.startModel, floor.id, m.x, m.y) });
      }
      return;
    }
    if (d.data.kind === 'ridgeEnd' || d.data.kind === 'ridgeMid') {
      const roof = model.roof!, rect = topFloorRect(model);
      const p = this.hitPlane(e, new Plane(new Vector3(0, 1, 0), -d.grabXY.y));
      if (!p) return;
      const mp = p.clone().applyMatrix4(SCENE_TO_MODEL);   // モデル座標 mm
      if (d.data.kind === 'ridgeEnd') {
        const along = roof.axis === 'x' ? mp.x : mp.y;
        const inset = d.data.end === 0 ? along - (roof.axis === 'x' ? rect.minX : rect.minY) : (roof.axis === 'x' ? rect.maxX : rect.maxY) - along;
        store.set({ model: setInset(model, d.data.end!, inset) });
      } else {
        const across = roof.axis === 'x' ? mp.y - (rect.minY + rect.maxY) / 2 : mp.x - (rect.minX + rect.maxX) / 2;
        store.set({ model: setRidgeOffset(model, across) });
      }
    }
  }

  private up() {
    const d = this.drag;
    this.drag = undefined;
    this.viewer.controls.enabled = true;
    this.label.setText('');
    if (d && !d.moved && d.data.kind === 'rotate') store.set({ model: rotateRidge(store.get().model) });
  }

  private hover(e: PointerEvent) {
    const hit = this.pick(e);
    const text = hit ? ({ floor: '建物の高さ / 横へ移動', rotate: '棟の向きを変える', ridgeEnd: '', ridgeMid: '' } as Record<Kind, string>)[(hit.userData as HandleData).kind] : '';
    this.viewer.renderer.domElement.style.cursor = hit ? 'pointer' : '';
    if (text && hit) { this.label.position.copy(hit.position); this.label.setText(text); } else this.label.setText('');
  }
  private showLabel(text: string, at: Vector3, floor: { offset: { x: number; y: number }; plan: { outline: { x: number; y: number }[] } }) {
    const h = this.viewer.handles.children.find((c) => (c.userData as HandleData).floorId);
    this.label.position.copy(h ? h.position : at);
    this.label.setText(text);
    void floor;
  }
}
```

**Step 2: 動かして見る**

Task 15 の DXF 読み込みが要るので、ここでは `store.set({ model: addFloor(createBuilding(), 手作りの PlanModel) })` を `App.tsx` に一時的に書いて、青い立方体を上にドラッグすると壁が伸び「壁の高さ x.xx m」が 0.05 刻みで出ることを確認する。横ドラッグで板が水平に動くことも見る。確認したら仮コードを消す。

**Step 3: Commit** → `git commit -m "feat: 高さ・横移動・棟の端点・向き・移動のハンドル"`

---

### Task 15: `ui/` パネル・2D 選択ビュー・長方形を描く（設計書 §6.1〜§6.6、§10）

**Files:**
- Create: `src/ui/Panel.tsx` `src/ui/SelectView.tsx` `src/ui/RectDraw.ts` `src/ui/app.css`
- Modify: `src/ui/App.tsx` `src/main.tsx`

**Step 1: パネル（文言は設計書 §2.2 と一字一句同じ）**

`src/ui/Panel.tsx`:

```tsx
import { useRef } from 'react';
import { loadDxf } from '../dxf';
import { addRoof, removeRoof, setFloor1Level, setRoofParam } from '../model/building';
import { store, useAppState } from '../state/store';

export function Panel() {
  const s = useAppState();
  const file = useRef<HTMLInputElement>(null);
  const roof = s.model.roof;
  const onFile = async (f: File) => {
    store.set({ busy: '読み込み中…', notice: undefined });
    try {
      const plan = loadDxf(await f.arrayBuffer(), f.name);
      store.set({ plan2d: plan, mode: 'select2d', busy: undefined });
    } catch (err) {
      store.set({ busy: undefined, notice: `DXF を読み込めませんでした（${(err as Error).message}）` });
    }
  };
  return (
    <aside className="panel">
      <section>
        <h3>作図</h3>
        <div className="row">
          <button onClick={() => store.set({ mode: 'drawRect' })}>長方形を描く</button>
          <button onClick={() => file.current?.click()}>DXF 平面を描く</button>
          <input ref={file} type="file" accept=".dxf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }} />
        </div>
        <p className="hint">描いた形は厚さ 100mm の板になります。上面を持ち上げてください。</p>
        <label>1階の床高さ <input type="number" step={10} value={s.model.floor1Level} onChange={(e) => store.updateModel((m) => setFloor1Level(m, Number(e.target.value)))} /> mm</label>
      </section>
      <section>
        <h3>屋根</h3>
        <div className="row">
          <button disabled={s.model.floors.length === 0} onClick={() => store.updateModel((m) => (m.roof ? removeRoof(m) : addRoof(m)))}>{roof ? '屋根を外す' : '屋根をかける'}</button>
          <button disabled title="Phase 2">切り欠き</button>
        </div>
        <Slider label="勾配（すべての屋根で共通）" value={roof?.pitchSun ?? 4} min={0.5} max={10} step={0.5} unit="寸" fmt={(v) => v.toFixed(1)} onChange={(v) => store.updateModel((m) => setRoofParam(m, { pitchSun: v }))} />
        <Slider label="軒の出（軒先）" value={roof?.eave ?? 600} min={0} max={1500} step={50} unit="mm" onChange={(v) => store.updateModel((m) => setRoofParam(m, { eave: v }))} />
        <Slider label="ケラバの出（妻側）" value={roof?.verge ?? 600} min={0} max={1500} step={50} unit="mm" onChange={(v) => store.updateModel((m) => setRoofParam(m, { verge: v }))} />
      </section>
      {s.notice && <p className="notice">{s.notice}</p>}
      {s.busy && <p className="busy">{s.busy}</p>}
    </aside>
  );
}

function Slider(p: { label: string; value: number; min: number; max: number; step: number; unit: string; fmt?: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="slider">
      <span>{p.label}</span>
      <input type="range" min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e) => p.onChange(Number(e.target.value))} />
      <strong>{(p.fmt ?? String)(p.value)} {p.unit}</strong>
    </label>
  );
}
```

**Step 2: 2D 選択ビュー**

`src/ui/SelectView.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { addFloor } from '../model/building';
import type { Box2, PlanEntity } from '../model/types';
import { recognizePlan, selectRegion } from '../recognize';
import { store, useAppState } from '../state/store';

/** 全画面の 2D ビュー。矩形ドラッグで平面図を囲む（設計書 §6.2） */
export function SelectView() {
  const s = useAppState();
  const plan = s.plan2d!;
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Box2 | null>(null);
  const [selected, setSelected] = useState<Box2 | null>(null);
  const cancel = () => store.set({ mode: 'idle', plan2d: undefined });
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && cancel(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);

  const b = plan.bbox, pad = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.03;
  const viewBox = `${b.minX - pad} ${-b.maxY - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxY - b.minY + 2 * pad}`;   // Y を反転して表示
  const toPlan = (e: React.PointerEvent) => { const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse()); return { x: pt.x, y: -pt.y }; };
  const start = useRef<{ x: number; y: number } | null>(null);
  const onDown = (e: React.PointerEvent) => { start.current = toPlan(e); setSelected(null); };
  const onMove = (e: React.PointerEvent) => { if (!start.current) return; const p = toPlan(e), a = start.current; setDrag({ minX: Math.min(a.x, p.x), minY: Math.min(a.y, p.y), maxX: Math.max(a.x, p.x), maxY: Math.max(a.y, p.y) }); };
  const onUp = () => {
    if (!drag) { start.current = null; return; }
    const region = selectRegion(plan, drag);
    start.current = null; setDrag(null);
    if (region.entities.length === 0) { store.set({ notice: '範囲に図形がありません。囲み直してください' }); return; }
    setSelected(region.bbox);
    store.set({ busy: '読み込み中…' });
    setTimeout(() => {   // 青塗りを 300 ms 見せてから認識する
      const model = recognizePlan(region);
      store.set((st) => ({ model: addFloor(st.model, model), mode: 'idle', plan2d: undefined, busy: undefined, notice: [...model.warnings, ...(twoPlansSuspected(model) ? ['平面図が 2 枚入っている可能性があります'] : [])][0] }));
    }, 300);
  };
  return (
    <div className="select-view">
      <header><span>{s.busy ?? '平面図を囲んでください'}</span><button onClick={cancel}>やめる</button></header>
      <svg ref={svg} viewBox={viewBox} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} style={{ cursor: 'crosshair' }}>
        {plan.entities.map((e, i) => <Entity key={i} e={e} />)}
        {drag && <rect x={drag.minX} y={-drag.maxY} width={drag.maxX - drag.minX} height={drag.maxY - drag.minY} fill="none" stroke="#1e88e5" strokeDasharray="60 30" strokeWidth={15} vectorEffect="non-scaling-stroke" />}
        {selected && <rect x={selected.minX} y={-selected.maxY} width={selected.maxX - selected.minX} height={selected.maxY - selected.minY} fill="#1e88e5" fillOpacity={0.18} />}
      </svg>
    </div>
  );
}

function Entity({ e }: { e: PlanEntity }) {
  const st = { stroke: '#444', fill: 'none', vectorEffect: 'non-scaling-stroke' as const, strokeWidth: 1 };
  if (e.kind === 'line') return <line x1={e.a.x} y1={-e.a.y} x2={e.b.x} y2={-e.b.y} {...st} />;
  if (e.kind === 'circle') return <circle cx={e.center.x} cy={-e.center.y} r={e.radius} {...st} />;
  if (e.kind === 'arc') {
    const a0 = (e.startDeg * Math.PI) / 180, a1 = ((e.endDeg <= e.startDeg ? e.endDeg + 360 : e.endDeg) * Math.PI) / 180;
    const p0 = [e.center.x + e.radius * Math.cos(a0), -(e.center.y + e.radius * Math.sin(a0))], p1 = [e.center.x + e.radius * Math.cos(a1), -(e.center.y + e.radius * Math.sin(a1))];
    return <path d={`M ${p0[0]} ${p0[1]} A ${e.radius} ${e.radius} 0 ${a1 - a0 > Math.PI ? 1 : 0} 0 ${p1[0]} ${p1[1]}`} {...st} />;
  }
  return <text x={e.at.x} y={-e.at.y} fontSize={e.height} fill="#2a8f3c">{e.text}</text>;
}

/** 壁の帯が 3 m 以上離れた 2 群に分かれていれば、平面図が 2 枚入った疑い（設計書 §10） */
function twoPlansSuspected(m: ReturnType<typeof recognizePlan>): boolean {
  const xs = m.walls.flatMap((w) => [w.a.x, w.b.x]).sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] > 3000) return true;
  return false;
}
```

**Step 3: 長方形を描く（設計書 §6.6）**

`src/ui/RectDraw.ts` は、`mode === 'drawRect'` の間だけ canvas の pointer イベントを取り、地面（シーン y = 0 の平面）にレイキャストして矩形を作る。マウスアップで `PlanModel`（外形 = 矩形、壁 = 外周 4 辺・厚さ 150・`exterior: true`、他は空）を組み立てて `addFloor` する。ヘッダに「長方形を描いてください」「やめる」を出す小さなオーバーレイは `App.tsx` に置く。Esc で `mode: 'idle'`。

**Step 4: App の配線と CSS**

`src/ui/App.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import { store, useAppState } from '../state/store';
import { HandleController } from '../viewer/handles';
import { Viewer } from '../viewer/scene';
import { Panel } from './Panel';
import { RectDraw } from './RectDraw';
import { SelectView } from './SelectView';
import { installTestHooks } from './testHooks';
import './app.css';

export function App() {
  const s = useAppState();
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewer = new Viewer(el.current!);
    new HandleController(viewer);
    const rect = new RectDraw(viewer);
    let floors = 0;
    const unsub = store.subscribe(() => {
      const st = store.get();
      viewer.setModel(st.model);
      if (st.model.floors.length !== floors) { floors = st.model.floors.length; viewer.fitToBuilding(); }
      rect.setActive(st.mode === 'drawRect');
    });
    installTestHooks(viewer);
    return () => { unsub(); viewer.dispose(); };
  }, []);
  return (
    <>
      <div ref={el} className="canvas" />
      <Panel />
      {s.mode === 'select2d' && s.plan2d && <SelectView />}
      {s.mode === 'drawRect' && <header className="overlay-head"><span>長方形を描いてください</span><button onClick={() => store.set({ mode: 'idle' })}>やめる</button></header>}
    </>
  );
}
```

`app.css` は最小限: `.canvas` 全画面、`.panel` 右上に浮く白いカード（幅 300 px、影、余白 14 px）、`.select-view` 全画面白背景 + ヘッダ、`.notice` 赤字 1 行、`.busy` 灰字。装飾はしない。

**Step 5: 動かして見る（A2・A5・A9 の目視）**

1. `npm run dev` → 「DXF 平面を描く」→ `fixtures/sample-house.dxf` → 2D ビューで 1 階を囲む → 板と青線と通り芯バブルが出る
2. 青ハンドルで 3.10 m まで上げる → ドア・窓・階段が立ち上がる
3. もう一度 DXF を読み、2 階を囲む → 1 階の真上に載る → 7.15 m まで上げる → 2 階床に階段の穴
4. 「屋根をかける」→ 寄棟。橙を端まで引いて切妻、紫で向きを変える、スライダー 3 本
5. `fixtures/forest-s/平面立面図.dxf` でも 1〜4 を通す。認識が外れた箇所は `config.ts` の閾値を直し、設計書 §7.2 も更新する
6. 「長方形を描く」で板ができ、以降同じ操作ができる

**Step 6: Commit** → `git commit -m "feat: パネル・2D 選択ビュー・長方形を描く"`

---

### Task 16: E2E（Playwright）とテスト用フック（設計書 §11.3）

**Files:**
- Create: `src/ui/testHooks.ts` `playwright.config.ts` `e2e/flow.spec.ts`

**Step 1: フック**

`src/ui/testHooks.ts`:

```ts
import { addFloor, addRoof, rotateRidge, setInset, setRoofParam, setTopZ } from '../model/building';
import { recognizePlan, selectRegion } from '../recognize';
import { store } from '../state/store';
import type { Box2 } from '../model/types';
import type { Viewer } from '../viewer/scene';

/** E2E から状態を直接読み書きする。ドラッグ量と高さの対応はカメラ依存なので、値の試験はここを使う */
export function installTestHooks(viewer: Viewer) {
  (window as any).__app = {
    getModel: () => store.get().model,
    selectRegion: (rect: Box2) => { const p = store.get().plan2d!; store.set((s) => ({ model: addFloor(s.model, recognizePlan(selectRegion(p, rect))), mode: 'idle', plan2d: undefined })); },
    setTopZ: (floorId: string, z: number) => store.updateModel((m) => setTopZ(m, floorId, z)),
    addRoof: () => store.updateModel(addRoof),
    setInset: (end: 0 | 1, v: number) => store.updateModel((m) => setInset(m, end, v)),
    rotateRidge: () => store.updateModel(rotateRidge),
    setRoof: (p: Record<string, number>) => store.updateModel((m) => setRoofParam(m, p)),
    roofGeom: () => viewer.built?.roofGeom,
  };
}
```

**Step 2: Playwright 設定**

```ts
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e',
  webServer: { command: 'npm run dev', port: 5173, reuseExistingServer: true },
  use: { baseURL: 'http://localhost:5173', viewport: { width: 1280, height: 800 } },
});
```

併せて `vite.config.ts` に `server: { port: 5173, strictPort: true }` を足す。Vite は 5173 が埋まっていると黙って 5174 に移るので、他の開発サーバーが動いていると E2E が別のアプリに繋がる。

`npx playwright install chromium` を 1 回実行する（外部ダウンロード。⚠️ リスク: 中（外部送信なし・実行ファイル取得）。Microsoft 配布の公式バイナリ）。

**Step 3: 試験**

`e2e/flow.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

const FIXTURE = 'fixtures/sample-house.dxf';
const F1 = { minX: 3000, minY: 3000, maxX: 4000, maxY: 4000 }, F2 = { minX: 15000, minY: 3000, maxX: 16000, maxY: 4000 };

test('動画の流れ: 1 階 → 2 階 → 屋根 → 切妻', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', FIXTURE);
  await expect(page.getByText('平面図を囲んでください')).toBeVisible();
  await page.evaluate((r) => (window as any).__app.selectRegion(r), F1);
  await expect.poll(() => page.evaluate(() => (window as any).__app.getModel().floors.length)).toBe(1);
  const f1 = await page.evaluate(() => (window as any).__app.getModel().floors[0]);
  expect(f1.baseZ).toBe(550);
  expect(f1.plan.axes.length).toBe(6);
  await page.evaluate((id) => (window as any).__app.setTopZ(id, 3100 + 550), f1.id);
  expect((await page.evaluate(() => (window as any).__app.getModel().floors[0].topZ)) - 550).toBe(3100);

  await page.setInputFiles('input[type=file]', FIXTURE);
  await page.evaluate((r) => (window as any).__app.selectRegion(r), F2);
  await expect.poll(() => page.evaluate(() => (window as any).__app.getModel().floors.length)).toBe(2);
  const [a, b] = await page.evaluate(() => (window as any).__app.getModel().floors);
  expect(b.baseZ).toBe(a.topZ + 100);
  expect(Math.abs(b.offset.x - (a.offset.x - 12000))).toBeLessThan(1);   // 通り芯で 2 階が 1 階に重なる
  await page.evaluate((id) => (window as any).__app.setTopZ(id, 7150 + 550), b.id);

  await page.evaluate(() => (window as any).__app.addRoof());
  expect(await page.evaluate(() => (window as any).__app.roofGeom().planes.length)).toBe(4);
  await page.evaluate(() => { (window as any).__app.setInset(0, 0); (window as any).__app.setInset(1, 0); });
  expect(await page.evaluate(() => (window as any).__app.roofGeom().planes.length)).toBe(2);
  await page.evaluate(() => (window as any).__app.setRoof({ pitchSun: 6 }));
  const g = await page.evaluate(() => (window as any).__app.roofGeom());
  expect(g.ridgeZ).toBeCloseTo(550 + 7150 + 0.6 * (7280 / 2), 0);
  await page.screenshot({ path: 'test-results/final.png' });
});

test('青ハンドルの上ドラッグでラベルが「壁の高さ x.xx m」になる', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', FIXTURE);
  await page.evaluate((r) => (window as any).__app.selectRegion(r), F1);
  const canvas = page.locator('canvas');
  const box = (await canvas.boundingBox())!;
  // ハンドルの画面位置は fitToBuilding 後にほぼ一定。まずホバーでラベルを探し、その位置から上へドラッグする
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.62);
  await expect(page.locator('.label')).toContainText('建物の高さ');
  const label = (await page.locator('.label').boundingBox())!;
  await page.mouse.move(label.x + label.width / 2, label.y + 30);
  await page.mouse.down();
  await page.mouse.move(label.x + label.width / 2, label.y - 150, { steps: 10 });
  await expect(page.locator('.label')).toContainText(/壁の高さ \d\.\d\d m/);
  await page.mouse.up();
});

test('ドラッグ中の描画が 30 fps 以上（2 階建て）', async ({ page }) => {
  await page.goto('/');
  for (const r of [F1, F2]) { await page.setInputFiles('input[type=file]', FIXTURE); await page.evaluate((rr) => (window as any).__app.selectRegion(rr), r); }
  const fps = await page.evaluate(async () => {
    const app = (window as any).__app; const id = app.getModel().floors[1].id;
    let frames = 0; const t0 = performance.now();
    await new Promise<void>((done) => { const tick = () => { frames++; app.setTopZ(id, 4000 + (frames % 40) * 50); if (performance.now() - t0 < 1000) requestAnimationFrame(tick); else done(); }; requestAnimationFrame(tick); });
    return frames;
  });
  expect(fps).toBeGreaterThanOrEqual(30);
});
```

**Step 4: 実行**

Run: `npx playwright test` → 3 件 PASS。ラベルの試験はハンドル位置に依存するので、外れたら `page.screenshot` で位置を見て座標を直す（値の試験はフック側で担保済み）。

**Step 5: Commit** → `git commit -m "test: Playwright で動画の流れと fps を試す"`

---

### Task 17: 性能・README・監査・設計書の同期（設計書 §15 Phase 5）

**Step 1: 性能**

Task 16 の fps 試験を `forest-s` の 2 階建てでも走らせる（`FIXTURE` を差し替えた版を 1 件追加）。30 fps を切ったら、`buildBuilding` の中で `EdgesGeometry` の生成が支配的なはずなので、ドラッグ中だけ輪郭線を省く（`store` に `dragging` フラグ）。それでも足りなければ壁ジオメトリのキャッシュ（壁 id + H + 天端プロファイルのハッシュ）を入れる。

**Step 2: 依存の監査**

`supply-chain-check` スキルを呼び、`npm audit` の結果を README に 1 行残す。

**Step 3: README**

`README.md` の「状態」を更新し、次を書く: 起動手順（`npm ci` / `npm run dev` / `npm test` / `npx playwright test`）、フィクスチャの由来、`window.__app` はテスト用で UI からは使わないこと、Phase 2 に回したもの（設計書 §3.3）。

**Step 4: 設計書の同期**

実装中に変えた閾値・既定値・ファイル配置（`coords.ts` の場所、`warnings` フィールドの追加、`Stair.flights` など）を `design.md` に反映し、決定ログに日付付きで追記する。`build-html.py` で `design.html` を作り直す。

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: README と設計書を実装に同期"
```

---

## 実装後に残す記録（CLAUDE.md §5）

- 認識が外れた実図面の箇所と、直した閾値（設計書 §7.2 と `config.ts`）
- fps の実測値（機種・フィクスチャ・ドラッグ中の値）を README に数字で
- 動画の 3 ファイル（Q2）が届いたら `fixtures/` に入れて回帰テストに加える
