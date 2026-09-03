import {
  BoxGeometry, BufferGeometry, ConeGeometry, Group, Mesh, MeshBasicMaterial, Object3D, OctahedronGeometry, Plane, Raycaster,
  SphereGeometry, TorusGeometry, Vector2, Vector3,
} from 'three';
import { toModel, toScene } from '../geometry/coords';
import { centerlineRect, moveFloor, rotateRidge, setInset, setRidgeOffset, setTopZ, topFloorRect } from '../model/building';
import type { BuildingModel, FloorBlock } from '../model/types';
import { store } from '../state/store';
import { makeLabel } from './labels';
import type { Viewer } from './scene';

type Kind = 'floor' | 'ridgeEnd' | 'ridgeMid' | 'rotate';
interface HandleData { kind: Kind; floorId?: string; end?: 0 | 1 }

/** ハンドルの色（設計書 §2.3）: 青立方体・橙球・緑菱形・紫回転矢印 */
const COLORS: Record<Kind, number> = { floor: 0x1e88e5, ridgeEnd: 0xf5a623, ridgeMid: 0x2eaf5c, rotate: 0x6b4de6 };
/** 高さ／横移動モードを確定するまでのドラッグ量（§6.3: 6 px） */
const DRAG_THRESHOLD_PX = 6;
/** 画面上の見かけの大きさ。カメラ距離 1 m あたりの倍率 */
const SCREEN_SCALE = 0.018;
/** 紫回転矢印を棟中点から浮かせる高さ（ハンドル 1 単位系） */
const ROTATE_LIFT = 1.2;
/** 鉛直 1 m を画面に投影した長さ（px）がこれ未満なら高さドラッグを無視する。天頂付近での発散を防ぐ */
const MIN_VERTICAL_PX = 2;
const HOVER_TEXT: Record<Kind, string> = { floor: '建物の高さ / 横へ移動', rotate: '棟の向きを変える', ridgeEnd: '', ridgeMid: '' };

/** ジオメトリと材質は共有し、再構築のたびに作らない */
const GEOMETRY = {
  floor: new BoxGeometry(1, 1, 1),
  ridgeEnd: new SphereGeometry(0.5, 16, 12),
  ridgeMid: new OctahedronGeometry(0.6),
  rotateArc: new TorusGeometry(0.6, 0.1, 8, 24, Math.PI * 1.5),
  rotateTip: new ConeGeometry(0.22, 0.5, 12),
};
const MATERIAL: Record<Kind, MeshBasicMaterial> = Object.fromEntries(
  (Object.keys(COLORS) as Kind[]).map((k) => [k, new MeshBasicMaterial({ color: COLORS[k], depthTest: false })]),
) as Record<Kind, MeshBasicMaterial>;

interface Drag {
  data: HandleData;
  start: Vector2;
  /** 青ハンドルの操作モード。最初の 6 px で決めて固定する */
  mode?: 'height' | 'move';
  startModel: BuildingModel;
  /** 掴んだ点（シーン座標）。横移動モードで水平面の高さとして使う */
  grabXY: Vector3;
  moved: boolean;
}

/**
 * ハンドルの生成・ホバー・ドラッグ（設計書 §6.3・§6.5）。
 * ドラッグは `model/` の純粋関数に変換してストアへ書き戻し、描画は Viewer の全再生成に任せる
 */
export class HandleController {
  private readonly ray = new Raycaster();
  private readonly label = makeLabel();
  private drag?: Drag;
  private hoverText = '';
  private readonly el: HTMLCanvasElement;
  private readonly onDown = (e: PointerEvent) => this.down(e);
  private readonly onMove = (e: PointerEvent) => this.move(e);
  private readonly onUp = (e: PointerEvent) => this.up(e);
  private readonly unsubscribeBuild: () => void;
  private readonly unsubscribeFrame: () => void;

  constructor(private readonly viewer: Viewer) {
    viewer.scene.add(this.label);
    this.unsubscribeBuild = viewer.afterBuild((_, model) => this.rebuild(model));
    this.unsubscribeFrame = viewer.everyFrame(() => this.scaleToScreen());
    this.el = viewer.renderer.domElement;
    // capture 段階で先に拾い、ハンドル上なら OrbitControls に渡さない（§6.7）
    this.el.addEventListener('pointerdown', this.onDown, { capture: true });
    this.el.addEventListener('pointermove', this.onMove);
    this.el.addEventListener('pointerup', this.onUp);
    this.el.addEventListener('pointercancel', this.onUp);
    // `afterBuild` は今後の再構築時にしか呼ばれないため、既に構築済みなら初回分をここで作る
    if (viewer.built) this.rebuild(store.get().model);
  }

  dispose(): void {
    this.el.removeEventListener('pointerdown', this.onDown, { capture: true });
    this.el.removeEventListener('pointermove', this.onMove);
    this.el.removeEventListener('pointerup', this.onUp);
    this.el.removeEventListener('pointercancel', this.onUp);
    this.unsubscribeBuild();
    this.unsubscribeFrame();
    this.viewer.handles.clear();
    this.viewer.scene.remove(this.label);
  }

  /** モデルからハンドルを作り直す */
  private rebuild(model: BuildingModel): void {
    this.viewer.handles.clear();
    for (const floor of model.floors) {
      const corner = southWestCorner(floor);
      if (corner) this.add(GEOMETRY.floor, 'floor', toScene(corner.x, corner.y, floor.topZ), { kind: 'floor', floorId: floor.id });
    }
    const roofGeom = this.viewer.built?.roofGeom;
    if (model.roof && roofGeom) {
      const [a, b] = roofGeom.ridge;
      this.add(GEOMETRY.ridgeEnd, 'ridgeEnd', toScene(a.x, a.y, a.z), { kind: 'ridgeEnd', end: 0 });
      this.add(GEOMETRY.ridgeEnd, 'ridgeEnd', toScene(b.x, b.y, b.z), { kind: 'ridgeEnd', end: 1 });
      const mid = toScene((a.x + b.x) / 2, (a.y + b.y) / 2, a.z);
      this.add(GEOMETRY.ridgeMid, 'ridgeMid', mid, { kind: 'ridgeMid' });
      this.viewer.handles.add(rotateArrow(mid));
    }
  }

  private add(geometry: BufferGeometry, kind: Kind, pos: Vector3, data: HandleData): Mesh {
    const mesh = new Mesh(geometry, MATERIAL[kind]);
    mesh.position.copy(pos);
    mesh.userData = data;
    mesh.renderOrder = 10;
    this.viewer.handles.add(mesh);
    return mesh;
  }

  /** 画面上の大きさを一定にする（カメラ距離に比例して拡大） */
  private scaleToScreen(): void {
    for (const h of this.viewer.handles.children) h.scale.setScalar(h.position.distanceTo(this.viewer.camera.position) * SCREEN_SCALE);
  }

  /** カーソル位置からレイを張る（NDC 変換はここ 1 か所） */
  private setRay(e: PointerEvent): void {
    const r = this.el.getBoundingClientRect();
    this.ray.setFromCamera(new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.viewer.camera);
  }

  /** カーソル位置にレイを張り、当たったハンドル（グループならその親）を返す */
  private pick(e: PointerEvent): Object3D | undefined {
    this.setRay(e);
    const hit = this.ray.intersectObjects(this.viewer.handles.children, true)[0]?.object;
    if (!hit) return undefined;
    return hit.parent === this.viewer.handles ? hit : hit.parent!;
  }

  /** レイと水平面（シーン y = height）の交点 */
  private hitGround(e: PointerEvent, height: number): Vector3 | null {
    this.setRay(e);
    const p = new Vector3();
    return this.ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -height), p) ? p : null;
  }

  /**
   * 画面 Y を鉛直線に射影する（§6.3）。`through` の鉛直 1 m を画面に投影して「鉛直 1 m が何 px か」を求め、
   * ドラッグの画面移動量（px）をその方向に射影して高さの変化量（m）に直す。
   * Ray と線分の最短距離（distanceSqToSegment）による射影は視線が鉛直に近いと sin^2(theta) で割って発散するため使わない
   */
  private screenDeltaToHeight(delta: Vector2, through: Vector3): number {
    const r = this.el.getBoundingClientRect();
    const toPx = (p: Vector3) => {
      const n = p.clone().project(this.viewer.camera);
      return new Vector2((n.x + 1) / 2 * r.width, (1 - n.y) / 2 * r.height);
    };
    const base = toPx(through);
    const up = toPx(through.clone().setY(through.y + 1)).sub(base);
    const lengthSq = up.lengthSq();
    if (lengthSq < MIN_VERTICAL_PX * MIN_VERTICAL_PX) return 0;   // 天頂付近: 鉛直方向が画面上でほぼ点になり不安定
    return delta.dot(up) / lengthSq;
  }

  private down(e: PointerEvent): void {
    if (e.button !== 0) return;
    const hit = this.pick(e);
    if (!hit) return;
    e.stopImmediatePropagation();
    this.el.setPointerCapture(e.pointerId);
    this.viewer.controls.enabled = false;
    this.drag = {
      data: hit.userData as HandleData,
      start: new Vector2(e.clientX, e.clientY),
      startModel: store.get().model,
      grabXY: this.hitGround(e, hit.position.y) ?? hit.position.clone(),
      moved: false,
    };
  }

  private move(e: PointerEvent): void {
    if (!this.drag) { this.hover(e); return; }
    const d = this.drag;
    const delta = new Vector2(e.clientX, e.clientY).sub(d.start);
    if (!d.moved && delta.length() < DRAG_THRESHOLD_PX) return;
    d.moved = true;
    if (d.data.kind === 'floor') this.dragFloor(e, d, delta);
    else if (d.data.kind === 'ridgeEnd' || d.data.kind === 'ridgeMid') this.dragRidge(e, d);
  }

  /** 青ハンドル: 高さモードは画面 Y を鉛直線に射影して setTopZ、横移動モードは水平面にレイキャストして moveFloor */
  private dragFloor(e: PointerEvent, d: Drag, delta: Vector2): void {
    d.mode ??= Math.abs(delta.y) >= Math.abs(delta.x) ? 'height' : 'move';
    const floor = d.startModel.floors.find((f) => f.id === d.data.floorId)!;
    if (d.mode === 'height') {
      const handle = this.viewer.handles.children.find((h) => (h.userData as HandleData).floorId === floor.id);
      if (!handle) return;
      const dz = toModel(new Vector3(0, this.screenDeltaToHeight(delta, handle.position), 0)).z;
      const next = setTopZ(d.startModel, floor.id, floor.topZ + dz);
      store.set({ model: next });
      const updated = next.floors.find((f) => f.id === floor.id)!;
      const rebuilt = this.viewer.handles.children.find((h) => (h.userData as HandleData).floorId === floor.id);
      if (rebuilt) this.label.position.copy(rebuilt.position);
      this.label.setText(`壁の高さ ${((updated.topZ - next.floor1Level) / 1000).toFixed(2)} m`);
    } else {
      // 水平面の高さは掴んだ点のまま固定する（仕様は Z = baseZ だが、掴んだ点からの差分だけを使うので結果は同じ）
      const p = this.hitGround(e, d.grabXY.y);
      if (!p) return;
      const dm = toModel(p.clone().sub(d.grabXY));
      store.set({ model: moveFloor(d.startModel, floor.id, dm.x, dm.y) });
    }
  }

  /** 橙球: 棟方向の位置から inset を出す。緑菱形: 棟に直交する方向の中心からの距離を ridgeOffset にする */
  private dragRidge(e: PointerEvent, d: Drag): void {
    const model = store.get().model;
    const roof = model.roof;
    if (!roof) return;
    const rect = topFloorRect(model);
    const p = this.hitGround(e, d.grabXY.y);
    if (!p) return;
    const mp = toModel(p);   // 建物座標 mm
    if (d.data.kind === 'ridgeEnd') {
      const along = roof.axis === 'x' ? mp.x : mp.y;
      const [min, max] = roof.axis === 'x' ? [rect.minX, rect.maxX] : [rect.minY, rect.maxY];
      store.set({ model: setInset(model, d.data.end!, d.data.end === 0 ? along - min : max - along) });
    } else {
      const across = roof.axis === 'x' ? mp.y - (rect.minY + rect.maxY) / 2 : mp.x - (rect.minX + rect.maxX) / 2;
      store.set({ model: setRidgeOffset(model, across) });
    }
  }

  private up(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    this.drag = undefined;
    if (this.el.hasPointerCapture(e.pointerId)) this.el.releasePointerCapture(e.pointerId);
    this.viewer.controls.enabled = true;
    this.setHoverText('');
    // 紫はクリック（動かさずに離す）で棟の向きを切り替える
    if (!d.moved && d.data.kind === 'rotate') store.updateModel(rotateRidge);
  }

  private hover(e: PointerEvent): void {
    const hit = this.pick(e);
    this.el.style.cursor = hit ? 'pointer' : '';
    const text = hit ? HOVER_TEXT[(hit.userData as HandleData).kind] : '';
    if (hit && text) this.label.position.copy(hit.position);
    this.setHoverText(text);
  }

  /** 前回と同じ文字列なら DOM を書き換えない */
  private setHoverText(text: string): void {
    if (text === this.hoverText) return;
    this.hoverText = text;
    this.label.setText(text);
  }
}

/**
 * 青ハンドルの位置 = 外形 bbox の南西角（平面図座標 + offset）。
 * 外形が空なら外壁芯の bbox、外壁も無ければハンドルを出さない（undefined）
 */
function southWestCorner(floor: FloorBlock): { x: number; y: number } | undefined {
  const outline = floor.plan.outline;
  if (outline.length === 0 && !floor.plan.walls.some((w) => w.exterior)) return undefined;
  const rect = outline.length > 0
    ? { minX: Math.min(...outline.map((p) => p.x)), minY: Math.min(...outline.map((p) => p.y)) }
    : centerlineRect(floor.plan);
  return { x: rect.minX + floor.offset.x, y: rect.minY + floor.offset.y };
}

/** 紫回転矢印: 3/4 周の弧 + 先端の円錐。水平に寝かせて棟中点の上空に置く */
function rotateArrow(mid: Vector3): Group {
  const data: HandleData = { kind: 'rotate' };
  const group = new Group();
  group.position.copy(mid).add(new Vector3(0, ROTATE_LIFT, 0));
  group.userData = data;
  const arc = new Mesh(GEOMETRY.rotateArc, MATERIAL.rotate);
  arc.rotation.x = -Math.PI / 2;
  const tip = new Mesh(GEOMETRY.rotateTip, MATERIAL.rotate);
  // 弧の終点（角度 1.5π）に接線方向を向けて置く
  tip.position.set(0, 0, 0.6);
  tip.rotation.z = -Math.PI / 2;
  for (const m of [arc, tip]) { m.userData = data; m.renderOrder = 10; }
  group.add(arc, tip);
  return group;
}
