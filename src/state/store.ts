import { useSyncExternalStore } from 'react';
import { createBuilding } from '../model/building';
import type { BuildingModel, Plan2D } from '../model/types';

export type Mode = 'idle' | 'select2d' | 'drawRect';

/**
 * アプリ全体の状態。`model` は不変の BuildingModel 1 つ（設計書 §4.2）。
 * `seeThrough` はカメラに向いている外壁を半透明にする表示切替（モデルには含めない）
 */
export interface AppState { model: BuildingModel; mode: Mode; seeThrough: boolean; plan2d?: Plan2D; notice?: string; busy?: string }

let state: AppState = { model: createBuilding(), mode: 'idle', seeThrough: false };
const listeners = new Set<() => void>();

/** React と viewer が共有する外部ストア。React 側は `useAppState`、viewer 側は `subscribe` で読む */
export const store = {
  get: () => state,
  /** 状態は不変。必ず新しいオブジェクトを返す */
  set: (patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => {
    state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
    listeners.forEach((l) => l());
  },
  /** `model/` の純粋関数を当てて新しいモデルに差し替える */
  updateModel: (fn: (m: BuildingModel) => BuildingModel) => store.set((s) => ({ model: fn(s.model) })),
  subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
};

export const useAppState = () => useSyncExternalStore(store.subscribe, store.get);
