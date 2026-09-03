import {
  AmbientLight, Box3, Color, DirectionalLight, GridHelper, Group, Mesh, MeshLambertMaterial, MOUSE, PerspectiveCamera, Scene, Spherical, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { buildBuilding, disposeBuilding, MATERIALS, type BuiltBuilding, type WallUserData } from '../geometry/build';
import { wallFacesCamera } from '../geometry/facing';
import type { BuildingModel, Vec2 } from '../model/types';

// 座標変換は viewer の窓口として出す。ui/ は geometry/ を直接掴まず、ここから取る（層: ui → viewer → geometry）
export { ndcFromPointer, pxFromNdc, toModel, toScene } from '../geometry/coords';

/** 格子の一辺（m）。住宅規模なら十分に収まる */
const GRID_SIZE = 60;
/** 初期カメラ位置（シーン座標 m）。建物を左手前上から見下ろす（設計書 §6.7） */
const INITIAL_CAMERA = new Vector3(-12, 9, 14);
/** `fitToBuilding` の視線方向（左手前上）と、外接球に対する距離の倍率 */
const FIT_DIRECTION = new Vector3(-0.9, 0.7, 1).normalize();
const FIT_DISTANCE_FACTOR = 1.3;
/** カメラが地面の下に潜らない上限（天頂からの角度）。ほぼ真上までは許す */
const MAX_POLAR_ANGLE = Math.PI / 2 - 0.05;
/** 照明の強さ（従来単位）。環境光を主にし、平行光は面の向きが分かる程度に留める */
const AMBIENT_INTENSITY = 1.0;
const SUN_INTENSITY = 0.25;
/** 「正面の壁を透かす」の不透明度。稜線は残るので、輪郭で位置は分かる */
const SEE_THROUGH_OPACITY = 0.15;

/**
 * three.js のシーン一式（設計書 §2.3・§6.7）。
 * モデルが変わるたびに `buildBuilding` で建物の Group を作り直す。ハンドルは `handles` に Task 14 が載せる
 */
export class Viewer {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(45, 1, 0.05, 500);
  readonly renderer = new WebGLRenderer({ antialias: true });
  readonly labelRenderer = new CSS2DRenderer();
  readonly controls: OrbitControls;
  /** ハンドル置き場。ピッキングの対象はこの中だけ */
  readonly handles = new Group();
  built?: BuiltBuilding;
  /** 直前に描画したモデルの参照。同じ参照なら作り直さない（モデルは不変なので参照比較で足りる） */
  private model?: BuildingModel;
  private frame = 0;
  private readonly onFrame: (() => void)[] = [];
  private readonly onBuilt: ((built: BuiltBuilding, model: BuildingModel) => void)[] = [];
  private readonly resizeObserver: ResizeObserver;
  /** 「正面の壁を透かす」の状態。ON の間は毎フレーム、カメラに向いている外壁の材質を差し替える */
  private seeThrough = false;
  /** 半透明の壁の材質。本体と同じ色で不透明度だけ 0.15。1 つ作って共有し、`dispose` で捨てる（`disposeBuilding` は共有材質を触らない） */
  private readonly seeThroughMaterial = new MeshLambertMaterial({ color: MATERIALS.body.color, transparent: true, opacity: SEE_THROUGH_OPACITY, depthWrite: false });
  /** 現在の建物の外壁 Mesh と、外壁芯の外接矩形の中心（建物座標 mm）。`setModel` のたびに取り直す */
  private exteriorWalls: Mesh[] = [];
  private buildingCenter: Vec2 = { x: 0, y: 0 };

  constructor(private readonly container: HTMLElement) {
    this.scene.background = new Color(0xfafafa);
    // 環境光 1.0・平行光 0.25 の比で、影側の面が落ち込まないようにする（参考動画の壁はほぼ白のまま）。
    // three r155 以降は光の強さが物理単位（Lambert で 1/π が掛かる）なので、π を掛けて従来の 1.0・0.25 相当にする
    const sun = new DirectionalLight(0xffffff, SUN_INTENSITY * Math.PI);
    sun.position.set(5, 10, 7);
    this.scene.add(new AmbientLight(0xffffff, AMBIENT_INTENSITY * Math.PI), sun);

    // 1 m 格子と 0.1 m の補助格子。補助格子は僅かに沈めて主格子とのちらつきを避ける
    const coarse = new GridHelper(GRID_SIZE, GRID_SIZE, 0xc8c8c8, 0xdedede);
    const fine = new GridHelper(GRID_SIZE, GRID_SIZE * 10, 0xeeeeee, 0xeeeeee);
    fine.position.y = -0.001;
    this.scene.add(coarse, fine, this.handles);

    this.camera.position.copy(INITIAL_CAMERA);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.domElement.style.display = 'block';
    this.labelRenderer.domElement.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none';
    container.append(this.renderer.domElement, this.labelRenderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    // 左: 回転、中・右: 平行移動、ホイール: ズーム（§6.7）
    this.controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.PAN };
    // 地面の下に潜らせない。ほぼ真上（天頂付近）までは許可する
    this.controls.maxPolarAngle = MAX_POLAR_ANGLE;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    const loop = () => {
      this.frame = requestAnimationFrame(loop);
      this.controls.update();
      this.onFrame.forEach((fn) => fn());
      this.updateSeeThrough();
      this.renderer.render(this.scene, this.camera);
      this.labelRenderer.render(this.scene, this.camera);
    };
    loop();
  }

  resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
  }

  /** モデル → 建物の Group を差し替える。古いジオメトリは `disposeBuilding` で捨てる（§4.2 の全再生成） */
  setModel(model: BuildingModel): void {
    if (model === this.model) return;   // 不変モデルなので参照が同じなら描き直さない
    this.model = model;
    if (this.built) {
      this.scene.remove(this.built.group);
      disposeBuilding(this.built.group);
    }
    this.built = buildBuilding(model);
    this.scene.add(this.built.group);
    this.exteriorWalls = this.built.group.children.filter((o): o is Mesh => o instanceof Mesh && o.name === 'wall' && (o.userData as WallUserData).exterior);
    const points = this.exteriorWalls.flatMap((m) => { const d = m.userData as WallUserData; return [d.a, d.b]; });
    if (points.length > 0) {
      const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
      this.buildingCenter = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    }
    this.onBuilt.forEach((fn) => fn(this.built!, model));
  }

  /** 「正面の壁を透かす」の ON/OFF。OFF にした瞬間に全部の壁を共有材質へ戻す */
  setSeeThrough(on: boolean): void {
    if (on === this.seeThrough) return;
    this.seeThrough = on;
    if (!on) for (const m of this.exteriorWalls) m.material = MATERIALS.body;
  }

  /** いま半透明になっている壁の id（E2E の確認用） */
  seeThroughWalls(): string[] {
    return this.exteriorWalls.filter((m) => m.material === this.seeThroughMaterial).map((m) => (m.userData as WallUserData).wallId);
  }

  /** カメラの方位角（度）を注視点まわりで指定する。距離と仰角はそのまま（E2E がカメラを回すのに使う） */
  setCameraAzimuth(deg: number): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const spherical = new Spherical().setFromVector3(offset);
    spherical.theta = (deg * Math.PI) / 180;
    this.camera.position.copy(this.controls.target).add(offset.setFromSpherical(spherical));
    this.controls.update();
  }

  /**
   * 毎フレーム: ON なら外壁ごとに「外向き法線 · (カメラ − 壁の中点) > 0」で正面かを判定し、材質を切り替える。
   * 材質の参照を差し替えるだけなので、ジオメトリは触らない
   */
  private updateSeeThrough(): void {
    if (!this.seeThrough) return;
    for (const m of this.exteriorWalls) {
      const d = m.userData as WallUserData;
      m.material = wallFacesCamera(d.a, d.b, this.buildingCenter, this.camera.position) ? this.seeThroughMaterial : MATERIALS.body;
    }
  }

  /** 建物全体が収まるようにカメラを寄せる。ブロック追加時に呼ぶ（§6.7） */
  fitToBuilding(): void {
    if (!this.built) return;
    const box = new Box3().setFromObject(this.built.group);
    if (box.isEmpty()) return;
    const center = box.getCenter(new Vector3());
    const radius = box.getSize(new Vector3()).length() / 2;
    this.controls.target.copy(center);
    // 縦長ビュー（aspect < 1）では横方向の FOV がさらに狭いので、その分だけ余計に下がる。
    // コンテナのレイアウト確定前（ResizeObserver 発火前）は aspect が 0 になりうるので、その間は 1 として扱う
    const verticalHalfFov = Math.tan((this.camera.fov / 2) * Math.PI / 180);
    const aspectFactor = this.camera.aspect > 0 ? Math.min(1, this.camera.aspect) : 1;
    const distance = radius * FIT_DISTANCE_FACTOR / (verticalHalfFov * aspectFactor);
    this.camera.position.copy(center).addScaledVector(FIT_DIRECTION, Math.max(distance, 3));
    this.controls.update();
  }

  /** 毎フレーム描画前に呼ぶ処理を登録する（ハンドルの見かけ寸法の更新など）。返り値で解除できる */
  everyFrame(fn: () => void): () => void {
    this.onFrame.push(fn);
    return () => { const i = this.onFrame.indexOf(fn); if (i >= 0) this.onFrame.splice(i, 1); };
  }

  /** `setModel` で建物を作り直した直後に呼ぶ処理を登録する。返り値で解除できる */
  afterBuild(fn: (built: BuiltBuilding, model: BuildingModel) => void): () => void {
    this.onBuilt.push(fn);
    return () => { const i = this.onBuilt.indexOf(fn); if (i >= 0) this.onBuilt.splice(i, 1); };
  }

  /** StrictMode の二重マウントで WebGL コンテキストが残らないよう、必ず cleanup から呼ぶ */
  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    if (this.built) disposeBuilding(this.built.group);
    this.seeThroughMaterial.dispose();
    this.renderer.forceContextLoss();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelRenderer.domElement.remove();
  }
}
