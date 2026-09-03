import { BufferGeometry, Line, LineBasicMaterial, Plane, Raycaster, Vector3 } from 'three';
import { addFloor, SNAP_XY } from '../model/building';
import type { Box2, PlanModel, Vec2 } from '../model/types';
import { store } from '../state/store';
import { ndcFromPointer, toModel, toScene, type Viewer } from '../viewer/scene';

/** 描いた矩形の外周に立てる壁の厚さ（設計書 §6.6） */
const WALL_THICKNESS = 150;
/** これより小さい辺の矩形は作らない（クリックだけで離した場合） */
const MIN_SIDE_MM = 100;
/** ドラッグ中の矩形をなぞる線を地面から浮かせる高さ（m）。格子と重なってちらつかないようにする */
const PREVIEW_LIFT = 0.005;

/**
 * 「長方形を描く」（設計書 §6.6）。有効な間だけ canvas の上に透明なオーバーレイを重ねて pointer を取り、
 * 地面（シーン y = 0）にレイキャストして矩形を作る。マウスアップで外周 4 辺の壁を持つ PlanModel を `addFloor` する。
 * オーバーレイで受けるので、OrbitControls やハンドルの pointer 処理と競合しない
 */
export class RectDraw {
  private readonly overlay = document.createElement('div');
  private readonly ray = new Raycaster();
  private readonly ground = new Plane(new Vector3(0, 1, 0), 0);
  private readonly preview = new Line(new BufferGeometry(), new LineBasicMaterial({ color: 0x1e88e5, depthTest: false }));
  private start: Vec2 | null = null;
  private current: Vec2 | null = null;
  private readonly onDown = (e: PointerEvent) => this.down(e);
  private readonly onMove = (e: PointerEvent) => this.move(e);
  private readonly onUp = () => this.up();

  constructor(private readonly viewer: Viewer) {
    this.overlay.className = 'rect-overlay';
    this.overlay.addEventListener('pointerdown', this.onDown);
    this.overlay.addEventListener('pointermove', this.onMove);
    this.overlay.addEventListener('pointerup', this.onUp);
    this.overlay.addEventListener('pointercancel', this.onUp);
    this.preview.renderOrder = 10;
    this.preview.visible = false;
    viewer.scene.add(this.preview);
  }

  /** `mode === 'drawRect'` の間だけオーバーレイを出す */
  setActive(active: boolean): void {
    const container = this.viewer.renderer.domElement.parentElement!;
    if (active && !this.overlay.isConnected) container.append(this.overlay);
    if (!active && this.overlay.isConnected) { this.overlay.remove(); this.reset(); }
  }

  dispose(): void {
    this.setActive(false);
    this.viewer.scene.remove(this.preview);
    this.preview.geometry.dispose();
    (this.preview.material as LineBasicMaterial).dispose();
  }

  /** カーソル位置から地面（シーン y = 0）への交点を建物座標（mm）で返す */
  private hitGround(e: PointerEvent): Vec2 | null {
    const r = this.overlay.getBoundingClientRect();
    this.ray.setFromCamera(ndcFromPointer(e, r), this.viewer.camera);
    const p = new Vector3();
    if (!this.ray.ray.intersectPlane(this.ground, p)) return null;
    const m = toModel(p);
    return { x: Math.round(m.x / SNAP_XY) * SNAP_XY, y: Math.round(m.y / SNAP_XY) * SNAP_XY };
  }

  private down(e: PointerEvent): void {
    if (e.button !== 0) return;
    const p = this.hitGround(e);
    if (!p) return;
    this.overlay.setPointerCapture(e.pointerId);
    this.start = p;
    this.current = p;
  }

  private move(e: PointerEvent): void {
    if (!this.start) return;
    const p = this.hitGround(e);
    if (!p) return;
    this.current = p;
    this.drawPreview(rectOf(this.start, p));
  }

  private up(): void {
    if (!this.start || !this.current) { this.reset(); return; }
    const rect = rectOf(this.start, this.current);
    this.reset();
    if (rect.maxX - rect.minX < MIN_SIDE_MM || rect.maxY - rect.minY < MIN_SIDE_MM) return;
    store.set((s) => ({ model: addFloor(s.model, rectPlan(rect)), mode: 'idle' }));
  }

  private reset(): void {
    this.start = null;
    this.current = null;
    this.preview.visible = false;
  }

  /** ドラッグ中の矩形を地面に青線で描く */
  private drawPreview(rect: Box2): void {
    const corners = rectCorners(rect);
    const points = [...corners, corners[0]].map((c) => toScene(c.x, c.y, 0).setY(PREVIEW_LIFT));
    this.preview.geometry.setFromPoints(points);
    this.preview.visible = true;
  }
}

/** 2 点から軸平行の矩形を作る */
function rectOf(a: Vec2, b: Vec2): Box2 {
  return { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
}

/** 矩形の 4 隅を反時計回りに返す */
function rectCorners(r: Box2): Vec2[] {
  return [{ x: r.minX, y: r.minY }, { x: r.maxX, y: r.minY }, { x: r.maxX, y: r.maxY }, { x: r.minX, y: r.maxY }];
}

/**
 * 矩形 → PlanModel（§6.6）。描いた矩形を外形（板の縁）とし、壁芯はその内側 75 mm に置いて
 * 壁の外面が板の縁と揃うようにする（DXF 由来のモデルと同じ関係）。開口・階段・通り芯は持たない
 */
function rectPlan(rect: Box2): PlanModel {
  const half = WALL_THICKNESS / 2;
  const corners = rectCorners({ minX: rect.minX + half, minY: rect.minY + half, maxX: rect.maxX - half, maxY: rect.maxY - half });
  const walls = corners.map((a, i) => ({ id: `w${i + 1}`, a, b: corners[(i + 1) % 4], thickness: WALL_THICKNESS, exterior: true }));
  return { walls, openings: [], stairs: [], axes: [], outline: rectCorners(rect), decorLines: [], warnings: [] };
}
