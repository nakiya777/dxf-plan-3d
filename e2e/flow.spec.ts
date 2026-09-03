import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

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
  const before = await page.evaluate(() => (window as any).__app.getModel().floors.length);
  await page.setInputFiles('input[type=file]', file);
  await expect(page.getByText('平面図を囲んでください')).toBeVisible();
  await page.evaluate((r) => (window as any).__app.selectRegion(r), rect);
  await expect.poll(() => page.evaluate(() => (window as any).__app.getModel().floors.length)).toBe(before + 1);
  await expect(page.locator('.select-view')).toHaveCount(0);
}

/** 描画ループを 2 フレーム待つ（fitToBuilding 後のカメラで投影させるため） */
const waitFrames = (page: Page) => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

/** 2 階建てを組んだ状態で 1 秒間 setTopZ を毎フレーム当て、描けたフレーム数を返す */
async function measureFps(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const app = (window as any).__app;
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

test('動画の流れ: 1 階 → 2 階 → 屋根 → 切妻 → 向き → 勾配', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '屋根をかける' })).toBeDisabled();

  // 1 階（A1 A2）
  await loadAndSelect(page, FIXTURE, F1);
  const f1 = await page.evaluate(() => (window as any).__app.getModel().floors[0]);
  expect(f1.baseZ).toBe(550);
  expect(f1.topZ).toBe(550);
  expect(f1.plan.axes.length).toBe(6);
  expect(f1.plan.walls.length).toBeGreaterThan(0);
  expect(f1.plan.openings.length).toBeGreaterThan(0);
  expect(f1.plan.stairs.length).toBe(1);
  await page.evaluate((id) => (window as any).__app.setTopZ(id, 3100 + 550), f1.id);
  expect((await page.evaluate(() => (window as any).__app.getModel().floors[0].topZ)) - 550).toBe(3100);
  await expect(page.getByRole('button', { name: '屋根をかける' })).toBeEnabled();

  // 2 階（A5）: 通り芯一致で 1 階に重なる。自作 DXF は 2 階が X 方向に +12,000 離れている
  await loadAndSelect(page, FIXTURE, F2);
  const [a, b] = await page.evaluate(() => (window as any).__app.getModel().floors);
  expect(b.baseZ).toBe(a.topZ + 100);
  expect(Math.abs(b.offset.x - (a.offset.x - 12000))).toBeLessThan(1);
  expect(Math.abs(b.offset.y - a.offset.y)).toBeLessThan(1);
  await page.evaluate((id) => (window as any).__app.setTopZ(id, 7150 + 550), b.id);
  expect(await page.evaluate(() => (window as any).__app.getModel().floors[1].topZ)).toBe(7700);

  // 屋根（A7）: 既定は寄棟 4 面
  await page.evaluate(() => (window as any).__app.addRoof());
  expect(await page.evaluate(() => (window as any).__app.roofGeom().planes.length)).toBe(4);
  const roof0 = await page.evaluate(() => (window as any).__app.getModel().roof);
  expect(roof0.pitchSun).toBe(4);
  expect(roof0.inset).toEqual([3640, 3640]);   // 既定 inset は W/2

  // 橙端点を端まで → 切妻 2 面（A8）
  await page.evaluate(() => { (window as any).__app.setInset(0, 0); (window as any).__app.setInset(1, 0); });
  expect(await page.evaluate(() => (window as any).__app.roofGeom().planes.length)).toBe(2);

  // 紫で向きを変える → inset は既定に戻り寄棟 4 面（A8）
  await page.evaluate(() => (window as any).__app.rotateRidge());
  const roof1 = await page.evaluate(() => (window as any).__app.getModel().roof);
  expect(roof1.axis).not.toBe(roof0.axis);
  expect(await page.evaluate(() => (window as any).__app.roofGeom().planes.length)).toBe(4);

  // 勾配 6 寸で棟高が Hr = He + p·W/2（W = 7,280）
  await page.evaluate(() => (window as any).__app.setRoof({ pitchSun: 6 }));
  const g = await page.evaluate(() => (window as any).__app.roofGeom());
  expect(g.ridgeZ).toBeCloseTo(550 + 7150 + 0.6 * (7280 / 2), 0);

  // 屋根を外す → roofGeom が消える
  await page.evaluate(() => (window as any).__app.removeRoof());
  expect(await page.evaluate(() => (window as any).__app.roofGeom())).toBeUndefined();
  await page.evaluate(() => (window as any).__app.addRoof());
  await waitFrames(page);
  await page.screenshot({ path: 'test-results/final.png' });
});

test('青ハンドルの上ドラッグでラベルが「壁の高さ x.xx m」になり、モデルの topZ と一致する（A3）', async ({ page }) => {
  await page.goto('/');
  await loadAndSelect(page, FIXTURE, F1);
  await waitFrames(page);
  const f1 = await page.evaluate(() => (window as any).__app.getModel().floors[0]);
  const canvas = page.locator('canvas');
  const box = (await canvas.boundingBox())!;
  const h = await page.evaluate((id) => (window as any).__app.handleScreen(id), f1.id);
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
  const model = await page.evaluate(() => (window as any).__app.getModel());
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
  const fps = await measureFps(page);
  console.log(`fps(sample-house) = ${fps}`);
  test.info().annotations.push({ type: 'fps', description: `sample-house: ${fps}` });
  expect(fps).toBeGreaterThanOrEqual(30);
});

test('ドラッグ中の描画が 30 fps 以上（forest-s 2 階建て、A11）', async ({ page }) => {
  await page.goto('/');
  await loadAndSelect(page, FOREST_S, FS1);
  await loadAndSelect(page, FOREST_S, FS2);
  // forest-s は通り芯が無いので外壁の重ね合わせで位置が決まる: 外壁芯 bbox の中心が一致する
  const centers = await page.evaluate(() => {
    const floors = (window as any).__app.getModel().floors;
    return floors.map((f: any) => {
      const pts = f.plan.walls.filter((w: any) => w.exterior).flatMap((w: any) => [w.a, w.b]);
      const xs = pts.map((p: any) => p.x), ys = pts.map((p: any) => p.y);
      return { x: (Math.min(...xs) + Math.max(...xs)) / 2 + f.offset.x, y: (Math.min(...ys) + Math.max(...ys)) / 2 + f.offset.y };
    });
  });
  expect(centers).toHaveLength(2);
  expect(Math.abs(centers[1].x - centers[0].x)).toBeLessThan(1);
  expect(Math.abs(centers[1].y - centers[0].y)).toBeLessThan(1);
  const fps = await measureFps(page);
  console.log(`fps(forest-s) = ${fps}`);
  test.info().annotations.push({ type: 'fps', description: `forest-s: ${fps}` });
  expect(fps).toBeGreaterThanOrEqual(30);
});
