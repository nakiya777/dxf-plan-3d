import { Vector3 } from 'three';
import { addFloor, addRoof, removeRoof, rotateRidge, setInset, setRoofParam, setTopZ } from '../model/building';
import type { RoofSliderParams } from '../model/building';
import type { Box2 } from '../model/types';
import { recognizePlan, selectRegion } from '../recognize';
import { store } from '../state/store';
import type { Viewer } from '../viewer/scene';

/**
 * E2E（Playwright）専用のフック。`window.__app` に置く。**UI からは使わない**。
 * 青ハンドルのドラッグ量と高さの対応はカメラに依存するので、値の試験はここを通して状態を直接読み書きする（設計書 §11.3）
 */
export function installTestHooks(viewer: Viewer): void {
  (window as unknown as { __app: unknown }).__app = {
    getModel: () => store.get().model,
    /** 2D 選択ビューの矩形ドラッグに相当。先に DXF を読ませて `plan2d` が入っている必要がある */
    selectRegion: (rect: Box2) => {
      const plan = store.get().plan2d;
      if (!plan) throw new Error('plan2d がありません。先に DXF を読み込んでください');
      const planModel = recognizePlan(selectRegion(plan, rect));
      store.set((s) => ({ model: addFloor(s.model, planModel), mode: 'idle', plan2d: undefined, busy: undefined, notice: planModel.warnings[0] }));
    },
    setTopZ: (floorId: string, z: number) => store.updateModel((m) => setTopZ(m, floorId, z)),
    addRoof: () => store.updateModel(addRoof),
    removeRoof: () => store.updateModel(removeRoof),
    setInset: (end: 0 | 1, v: number) => store.updateModel((m) => setInset(m, end, v)),
    rotateRidge: () => store.updateModel(rotateRidge),
    setRoof: (p: RoofSliderParams) => store.updateModel((m) => setRoofParam(m, p)),
    /** 直前の描画で解いた屋根形状（`ridgeZ` `planes` `ridge` `edges`）。屋根が無ければ undefined */
    roofGeom: () => viewer.built?.roofGeom,
    /** 青ハンドルの画面位置（キャンバス左上からの px）。ドラッグの起点探しに使う */
    handleScreen: (floorId: string) => {
      const handle = viewer.handles.children.find((h) => (h.userData as { floorId?: string }).floorId === floorId);
      if (!handle) return undefined;
      const p = handle.getWorldPosition(new Vector3()).project(viewer.camera);
      const el = viewer.renderer.domElement;
      return { x: ((p.x + 1) / 2) * el.clientWidth, y: ((1 - p.y) / 2) * el.clientHeight };
    },
  };
}
