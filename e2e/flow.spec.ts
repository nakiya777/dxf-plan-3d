import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
// window.__app の型（declare global）だけを取り込む。実行時には消える（アプリ本体を Node に読ませない）
import type { FloorBlock, Wall } from '../src/model/types';
import type { AppHooks } from '../src/ui/testHooks';
export type { AppHooks };

/**
 * 動画の流れを再現する E2E（設計書 §11.3、受け入れ条件 §12）。
 * 値の試験は `window.__app`（src/ui/testHooks.ts）で行い、ドラッグはラベル書式の確認 1 件だけにする
 * （ドラッグ量と高さの対応はカメラ依存なので、画面操作で正確な値は狙えない）
 */

const FIXTURE = 'fixtures/sample-house.dxf';
const FOREST_S = 'fixtures/forest-s/平面立面図.dxf';
/** 自作 DXF: 1 階は X ≤ 9,000、2 階は X ≥ 9,000。どちらも通り芯を跨ぐ矩形 */
const F1 = { minX: 3000, minY: 3000, maxX: 4000, maxY: 4000 };
const F2 = { minX: 15000, minY: 3000, maxX: 16000, maxY: 4000 };
/** forest-s: 1 階 [5500, 28800, 19800, 39800]・2 階 [5500, 15000, 19800, 26000] の範囲内で壁線を跨ぐ小矩形 */
const FS1 = { minX: 9000, minY: 31000, maxX: 12000, maxY: 34000 };
const FS2 = { minX: 9000, minY: 18000, maxX: 12000, maxY: 21000 };

type Rect = typeof F1;

/** DXF を読み込ませ、2D 選択ビューが出たらフックで矩形選択する（青塗り→認識の流れを 1 手にまとめる） */
async function loadAndSelect(page: Page, file: string, rect: Rect): Promise<void> {
  const before = await page.evaluate(() => window.__app.getModel().floors.length);
  await page.setInputFiles('input[type=file]', file);
  await expect(page.getByText('平面図を囲んでください')).toBeVisible();
  await page.evaluate((r) => window.__app.selectRegion(r), rect);
  await expect.poll(() => page.evaluate(() => window.__app.getModel().floors.length)).toBe(before + 1);
  await expect(page.locator('.select-view')).toHaveCount(0);
}

/** 描画ループを 2 フレーム待つ（fitToBuilding 後のカメラで投影させるため） */
const waitFrames = (page: Page) => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

/** 2 階建てを組んだ状態で 1 秒間 setTopZ を毎フレーム当て、描けたフレーム数を返す */
async function measureFps(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const app = window.__app;
    const id = app.getModel().floors[1].id;
    let frames = 0;
    const t0 = performance.now();
    await new Promise<void>((done) => {
      const tick = () => {
        frames++;
        app.setTopZ(id, 4000 + (frames % 40) * 50);
        if (performance.now() - t0 < 1000) requestAnimationFrame(tick); else done();
      };
      requestAnimationFrame(tick);
    });
    return frames;
  });
}

/**
 * 1 回の setTopZ の同期コスト（store.set → sync → buildBuilding → ハンドル再構築）を rAF を挟まず測る。
 * fps は vsync（60）で頭打ちになるので、余裕はこちらで見る。初回はウォームアップとして除く
 */
async function measureUpdateMs(page: Page, runs = 60): Promise<number> {
  return page.evaluate((n) => {
    const app = window.__app;
    const id = app.getModel().floors[1].id;
    app.setTopZ(id, 4000);
    const t0 = performance.now();
    for (let i = 1; i <= n; i++) app.setTopZ(id, 4000 + (i % 40) * 50);
    return (performance.now() - t0) / n;
  }, runs);
}

/** A6・A9・A10 は動画に無いが受け入れ条件にある操作 */

test('動画の流れ: 1 階 → 2 階 → 屋根 → 切妻 → 向き → 勾配', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '屋根をかける' })).toBeDisabled();

  // 1 階（A1 A2）
  await loadAndSelect(page, FIXTURE, F1);
  const f1 = await page.evaluate(() => window.__app.getModel().floors[0]);
  expect(f1.baseZ).toBe(550);
  expect(f1.topZ).toBe(550);
  expect(f1.plan.axes.length).toBe(6);
  expect(f1.plan.walls.length).toBeGreaterThan(0);
  expect(f1.plan.openings.length).toBeGreaterThan(0);
  expect(f1.plan.stairs.length).toBe(1);
  await page.evaluate((id) => window.__app.setTopZ(id, 3100 + 550), f1.id);
  expect((await page.evaluate(() => window.__app.getModel().floors[0].topZ)) - 550).toBe(3100);
  await expect(page.getByRole('button', { name: '屋根をかける' })).toBeEnabled();

  // 2 階（A5）: 通り芯一致で 1 階に重なる。自作 DXF は 2 階が X 方向に +12,000 離れている
  await loadAndSelect(page, FIXTURE, F2);
  const [a, b] = await page.evaluate(() => window.__app.getModel().floors);
  expect(b.baseZ).toBe(a.topZ + 100);
  // 2 階の図面は 1 階から +12,000 の位置にあるので、offset は 1 階より −12,000 で重なる
  expect(Math.abs(b.offset.x - (a.offset.x - 12000))).toBeLessThan(1);
  expect(Math.abs(b.offset.y - a.offset.y)).toBeLessThan(1);
  await page.evaluate((id) => window.__app.setTopZ(id, 7150 + 550), b.id);
  expect(await page.evaluate(() => window.__app.getModel().floors[1].topZ)).toBe(7700);

  // 屋根（A7）: 既定は寄棟 4 面
  await page.evaluate(() => window.__app.addRoof());
  expect(await page.evaluate(() => window.__app.roofGeom()!.planes.length)).toBe(4);
  const roof0 = (await page.evaluate(() => window.__app.getModel().roof))!;
  expect(roof0.pitchSun).toBe(4);
  expect(roof0.inset).toEqual([3640, 3640]);   // 既定 inset は W/2

  // 橙端点を端まで → 切妻 2 面（A8）
  await page.evaluate(() => { window.__app.setInset(0, 0); window.__app.setInset(1, 0); });
  expect(await page.evaluate(() => window.__app.roofGeom()!.planes.length)).toBe(2);

  // 紫で向きを変える → inset は既定に戻り寄棟 4 面（A8）
  await page.evaluate(() => window.__app.rotateRidge());
  const roof1 = (await page.evaluate(() => window.__app.getModel().roof))!;
  expect(roof1.axis).not.toBe(roof0.axis);
  expect(await page.evaluate(() => window.__app.roofGeom()!.planes.length)).toBe(4);

  // 勾配 6 寸で棟高が Hr = He + p·W/2（W = 7,280）
  await page.evaluate(() => window.__app.setRoof({ pitchSun: 6 }));
  const g = (await page.evaluate(() => window.__app.roofGeom()))!;
  expect(g.ridgeZ).toBeCloseTo(550 + 7150 + 0.6 * (7280 / 2), 0);

  // 屋根を外す → roofGeom が消える
  await page.evaluate(() => window.__app.removeRoof());
  expect(await page.evaluate(() => window.__app.roofGeom())).toBeUndefined();
  await page.evaluate(() => window.__app.addRoof());
  await waitFrames(page);
  // 目視確認用。assert はしない
  await page.screenshot({ path: 'test-results/final.png' });
});

test('青ハンドルの上ドラッグでラベルが「壁の高さ x.xx m」になり、モデルの topZ と一致する（A3）', async ({ page }) => {
  await page.goto('/');
  await loadAndSelect(page, FIXTURE, F1);
  await waitFrames(page);
  const f1 = await page.evaluate(() => window.__app.getModel().floors[0]);
  const canvas = page.locator('canvas');
  const box = (await canvas.boundingBox())!;
  const h = (await page.evaluate((id) => window.__app.handleScreen(id), f1.id))!;
  expect(h).toBeDefined();
  const x = box.x + h.x;
  const y = box.y + h.y;
  // ホバーで説明ラベル、上へドラッグで高さラベル
  await page.mouse.move(x, y);
  await expect(page.locator('.label')).toContainText('建物の高さ');
  await page.mouse.down();
  await page.mouse.move(x, y - 150, { steps: 10 });
  await expect(page.locator('.label')).toContainText(/壁の高さ \d\.\d\d m/);
  const text = await page.locator('.label').textContent();
  const model = await page.evaluate(() => window.__app.getModel());
  const expected = ((model.floors[0].topZ - model.floor1Level) / 1000).toFixed(2);
  expect(text).toBe(`壁の高さ ${expected} m`);
  expect(model.floors[0].topZ).toBeGreaterThan(550);
  expect(model.floors[0].topZ % 50).toBe(0);   // 0.05 m 刻み
  await page.mouse.up();
});

test('ドラッグ中の描画が 30 fps 以上（自作 DXF 2 階建て、A11）', async ({ page }) => {
  await page.goto('/');
  await loadAndSelect(page, FIXTURE, F1);
  await loadAndSelect(page, FIXTURE, F2);
  const ms = await measureUpdateMs(page);
  const fps = await measureFps(page);
  console.log(`sample-house: update ${ms.toFixed(2)} ms/回, fps ${fps}`);
  test.info().annotations.push({ type: 'perf', description: `sample-house: update ${ms.toFixed(2)} ms, fps ${fps}` });
  expect(ms).toBeLessThan(20);   // 30 fps = 33 ms から描画分を残した上限
  expect(fps).toBeGreaterThanOrEqual(30);
});

test('ドラッグ中の描画が 30 fps 以上（forest-s 2 階建て、A11）', async ({ page }) => {
  // 実図面は権利上の配慮で公開リポジトリに含めない。ローカルにあるときだけ走る
  test.skip(!existsSync(FOREST_S), 'fixtures/forest-s が無い（実図面はローカルにだけ置く）');
  await page.goto('/');
  await loadAndSelect(page, FOREST_S, FS1);
  await loadAndSelect(page, FOREST_S, FS2);
  // forest-s は通り芯が無いので外壁の重ね合わせで位置が決まる: 外壁芯 bbox の中心が一致する
  const centers = await page.evaluate(() => {
    const floors = window.__app.getModel().floors;
    return floors.map((f: FloorBlock) => {
      const pts = f.plan.walls.filter((w: Wall) => w.exterior).flatMap((w: Wall) => [w.a, w.b]);
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      return { x: (Math.min(...xs) + Math.max(...xs)) / 2 + f.offset.x, y: (Math.min(...ys) + Math.max(...ys)) / 2 + f.offset.y };
    });
  });
  expect(centers).toHaveLength(2);
  expect(Math.abs(centers[1].x - centers[0].x)).toBeLessThan(1);
  expect(Math.abs(centers[1].y - centers[0].y)).toBeLessThan(1);
  const ms = await measureUpdateMs(page);
  const fps = await measureFps(page);
  console.log(`forest-s: update ${ms.toFixed(2)} ms/回, fps ${fps}`);
  test.info().annotations.push({ type: 'perf', description: `forest-s: update ${ms.toFixed(2)} ms, fps ${fps}` });
  expect(ms).toBeLessThan(20);
  expect(fps).toBeGreaterThanOrEqual(30);
});

test('青ハンドルの横ドラッグでブロックが水平移動し、高さは変わらない（A6）', async ({ page }) => {
  await page.goto('/');
  await loadAndSelect(page, FIXTURE, F1);
  await page.evaluate((id) => window.__app.setTopZ(id, 3650), (await page.evaluate(() => window.__app.getModel().floors[0])).id);
  await waitFrames(page);
  const before = await page.evaluate(() => window.__app.getModel().floors[0]);
  const box = (await page.locator('canvas').boundingBox())!;
  const h = (await page.evaluate((id) => window.__app.handleScreen(id), before.id))!;
  const x = box.x + h.x;
  const y = box.y + h.y;
  await page.mouse.move(x, y);
  await expect(page.locator('.label')).toContainText('建物の高さ');
  await page.mouse.down();
  await page.mouse.move(x + 150, y, { steps: 10 });
  await page.mouse.up();
  const after = await page.evaluate(() => window.__app.getModel().floors[0]);
  expect(after.topZ).toBe(before.topZ);
  expect(Math.hypot(after.offset.x - before.offset.x, after.offset.y - before.offset.y)).toBeGreaterThan(0);
  // 値はフックで: 10 mm スナップで offset だけが動く
  await page.evaluate((id) => window.__app.moveFloor(id, 1234, -567), after.id);
  const moved = await page.evaluate(() => window.__app.getModel().floors[0]);
  expect(moved.offset).toEqual({ x: after.offset.x + 1230, y: after.offset.y - 570 });
  expect(moved.topZ).toBe(before.topZ);
});

test('長方形を描くで板ができ、以降 DXF 由来と同じ操作ができる（A9）', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '長方形を描く' }).click();
  await expect(page.locator('.overlay-head')).toBeVisible();
  const box = (await page.locator('canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  // 初期カメラは斜め上から見ているので、画面の対角線ドラッグは建物座標の 1 軸に潰れる（幅 90 mm で MIN_SIDE 未満）。
  // 画面の水平ドラッグは X・Y 両方に広がる（実測: 300 px → 約 4,840 × 4,140 mm）
  await page.mouse.move(cx - 150, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 150, cy, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__app.getModel().floors.length)).toBe(1);
  await expect(page.locator('.overlay-head')).toHaveCount(0);
  const f = await page.evaluate(() => window.__app.getModel().floors[0]);
  expect(f.plan.walls.length).toBe(4);
  expect(f.plan.walls.every((w: { exterior: boolean }) => w.exterior)).toBe(true);
  expect(f.plan.outline.length).toBe(4);
  await page.evaluate((id) => window.__app.setTopZ(id, 3000), f.id);
  expect(await page.evaluate(() => window.__app.getModel().floors[0].topZ)).toBe(3000);
  await expect(page.getByRole('button', { name: '屋根をかける' })).toBeEnabled();
  await page.evaluate(() => window.__app.addRoof());
  expect(await page.evaluate(() => window.__app.roofGeom()?.planes.length)).toBe(4);
});

/** 壁レイヤーの無い最小 DXF（三角形の LINE 3 本）。帯を作らないので壁 0 本になる */
const UNRECOGNIZABLE_DXF = [
  '0', 'SECTION', '2', 'ENTITIES',
  ...[[0, 0, 5000, 0], [5000, 0, 2500, 4000], [2500, 4000, 0, 0]].flatMap(([x1, y1, x2, y2]) =>
    ['0', 'LINE', '8', 'MEMO', '10', String(x1), '20', String(y1), '11', String(x2), '21', String(y2)]),
  '0', 'ENDSEC', '0', 'EOF', '',
].join('\n');

test('認識できない DXF でも落ちず、線だけの板になる（A10）', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.setInputFiles('input[type=file]', { name: 'memo.dxf', mimeType: 'application/dxf', buffer: Buffer.from(UNRECOGNIZABLE_DXF) });
  await expect(page.getByText('平面図を囲んでください')).toBeVisible();
  await page.evaluate((r) => window.__app.selectRegion(r), { minX: 1000, minY: -100, maxX: 2000, maxY: 100 });
  await expect.poll(() => page.evaluate(() => window.__app.getModel().floors.length)).toBe(1);
  const f = await page.evaluate(() => window.__app.getModel().floors[0]);
  expect(f.plan.walls.length).toBe(0);
  await expect(page.locator('.notice')).toContainText('壁を認識できませんでした');
  expect(errors).toEqual([]);
});
