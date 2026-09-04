import { Vector3 } from 'three';
import { addRoof, moveFloor, removeRoof, rotateRidge, setInset, setRoofParam, setTopZ } from '../model/building';
import type { RoofSliderParams } from '../model/building';
import type { RoofGeom } from '../model/roof';
import type { Box2, BuildingModel } from '../model/types';
import { selectRegion } from '../recognize';
import { store } from '../state/store';
import { pxFromNdc, type Viewer } from '../viewer/scene';
import { commitRegion, EMPTY_REGION_NOTICE } from './commitRegion';

/** `window.__app` の型。spec 側もこれで参照する */
export interface AppHooks {
  getModel: () => BuildingModel;
  /** 2D 選択ビューの矩形ドラッグに相当。先に DXF を読ませて `plan2d` が入っている必要がある */
  selectRegion: (rect: Box2) => void;
  setTopZ: (floorId: string, z: number) => void;
  moveFloor: (floorId: string, dx: number, dy: number) => void;
  addRoof: () => void;
  removeRoof: () => void;
  setInset: (end: 0 | 1, v: number) => void;
  rotateRidge: () => void;
  setRoof: (p: RoofSliderParams) => void;
  /** 直前の描画で解いた屋根形状（`ridgeZ` `planes` `ridge` `edges`）。屋根が無ければ undefined */
  roofGeom: () => RoofGeom | undefined;
  /** 青ハンドルの画面位置（キャンバス左上からの px）。ドラッグの起点探しに使う。ハンドルは最上階にしか無いので、下の階は undefined */
  handleScreen: (floorId: string) => { x: number; y: number } | undefined;
  /** 「壁を透かす」の切替（パネルのボタンと同じ） */
  setSeeThrough: (on: boolean) => void;
  /** 直前の描画で 0.15 の正面壁用材質になっている壁 id の一覧。切替やカメラ移動の後は 1 フレーム待ってから読む */
  seeThroughWalls: () => string[];
  /** 共有材質（本体・稜線・青線）と正面壁用材質の状態。OFF で不透明・depthTest あり、ON で 0.85/0.15・depthTest 無しになる */
  materialState: () => ReturnType<Viewer['materialState']>;
  /** カメラの方位角（度）を注視点まわりで変える。距離と仰角は変えない */
  setCameraAzimuth: (deg: number) => void;
}

declare global {
  interface Window { __app: AppHooks }
}

/**
 * E2E（Playwright）専用のフック。`window.__app` に置く。**UI からは使わない**。
 * 本番ビルドにも入れる。UI から到達できる操作しか無く、preview ビルドに対する E2E でも使うため。
 * 青ハンドルのドラッグ量と高さの対応はカメラに依存するので、値の試験はここを通して状態を直接読み書きする（設計書 §11.3）
 */
export function installTestHooks(viewer: Viewer): void {
  window.__app = {
    getModel: () => store.get().model,
    selectRegion: (rect) => {
      const plan = store.get().plan2d;
      if (!plan) throw new Error('plan2d がありません。先に DXF を読み込んでください');
      const region = selectRegion(plan, rect);
      if (region.entities.length === 0) { store.set({ notice: EMPTY_REGION_NOTICE }); return; }
      commitRegion(region);
    },
    setTopZ: (floorId, z) => store.updateModel((m) => setTopZ(m, floorId, z)),
    moveFloor: (floorId, dx, dy) => store.updateModel((m) => moveFloor(m, floorId, dx, dy)),
    addRoof: () => store.updateModel(addRoof),
    removeRoof: () => store.updateModel(removeRoof),
    setInset: (end, v) => store.updateModel((m) => setInset(m, end, v)),
    rotateRidge: () => store.updateModel(rotateRidge),
    setRoof: (p) => store.updateModel((m) => setRoofParam(m, p)),
    roofGeom: () => viewer.built?.roofGeom,
    handleScreen: (floorId) => {
      const handle = viewer.handles.children.find((h) => (h.userData as { floorId?: string }).floorId === floorId);
      if (!handle) return undefined;
      const p = handle.getWorldPosition(new Vector3()).project(viewer.camera);
      const el = viewer.renderer.domElement;
      const px = pxFromNdc(p, { width: el.clientWidth, height: el.clientHeight });
      return { x: px.x, y: px.y };
    },
    setSeeThrough: (on) => store.set({ seeThrough: on }),
    seeThroughWalls: () => viewer.seeThroughWalls(),
    materialState: () => viewer.materialState(),
    setCameraAzimuth: (deg) => viewer.setCameraAzimuth(deg),
  };
}
