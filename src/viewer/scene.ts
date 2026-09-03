import { AmbientLight, Box3, Color, DirectionalLight, GridHelper, Group, MOUSE, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { buildBuilding, disposeBuilding, type BuiltBuilding } from '../geometry/build';
import type { BuildingModel } from '../model/types';

/** 格子の一辺（m）。住宅規模なら十分に収まる */
const GRID_SIZE = 60;
/** 初期カメラ位置（シーン座標 m）。建物を左手前上から見下ろす（設計書 §6.7） */
const INITIAL_CAMERA = new Vector3(-12, 9, 14);
/** `fitToBuilding` の視線方向（左手前上）と、外接球に対する距離の倍率 */
const FIT_DIRECTION = new Vector3(-0.9, 0.7, 1).normalize();
const FIT_DISTANCE_FACTOR = 1.3;

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
  private frame = 0;
  private readonly onFrame: (() => void)[] = [];
  private readonly onBuilt: ((built: BuiltBuilding, model: BuildingModel) => void)[] = [];
  private readonly resizeObserver: ResizeObserver;

  constructor(private readonly container: HTMLElement) {
    this.scene.background = new Color(0xfafafa);
    const sun = new DirectionalLight(0xffffff, 0.6);
    sun.position.set(5, 10, 7);
    this.scene.add(new AmbientLight(0xffffff, 0.9), sun);

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

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    const loop = () => {
      this.frame = requestAnimationFrame(loop);
      this.controls.update();
      this.onFrame.forEach((fn) => fn());
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
    if (this.built) {
      this.scene.remove(this.built.group);
      disposeBuilding(this.built.group);
    }
    this.built = buildBuilding(model);
    this.scene.add(this.built.group);
    this.onBuilt.forEach((fn) => fn(this.built!, model));
  }

  /** 建物全体が収まるようにカメラを寄せる。ブロック追加時に呼ぶ（§6.7） */
  fitToBuilding(): void {
    if (!this.built) return;
    const box = new Box3().setFromObject(this.built.group);
    if (box.isEmpty()) return;
    const center = box.getCenter(new Vector3());
    const radius = box.getSize(new Vector3()).length() / 2;
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(FIT_DIRECTION, Math.max(radius * FIT_DISTANCE_FACTOR / Math.tan((this.camera.fov / 2) * Math.PI / 180), 3));
    this.controls.update();
  }

  /** 毎フレーム描画前に呼ぶ処理を登録する（ハンドルの見かけ寸法の更新など） */
  everyFrame(fn: () => void): void { this.onFrame.push(fn); }

  /** `setModel` で建物を作り直した直後に呼ぶ処理を登録する */
  afterBuild(fn: (built: BuiltBuilding, model: BuildingModel) => void): void { this.onBuilt.push(fn); }

  /** StrictMode の二重マウントで WebGL コンテキストが残らないよう、必ず cleanup から呼ぶ */
  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    if (this.built) disposeBuilding(this.built.group);
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelRenderer.domElement.remove();
  }
}
