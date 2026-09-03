import { addFloor } from '../model/building';
import type { Plan2D, PlanModel } from '../model/types';
import { recognizePlan, twoPlansSuspected } from '../recognize';
import { store } from '../state/store';

/** 範囲に図形が無いときの注意文。SelectView とテスト用フックで共通 */
export const EMPTY_REGION_NOTICE = '範囲に図形がありません。囲み直してください';

/**
 * 切り出した範囲を認識して階として積み、3D に戻る（設計書 §6.2 手順 4 の確定処理）。
 * SelectView の青塗り後と E2E フック（testHooks.ts）の両方から呼ぶ。注意文の組み方をここ 1 箇所に置く
 */
export function commitRegion(region: Plan2D): PlanModel {
  const planModel = recognizePlan(region);
  // 壁 0 本の注意と 2 枚混入の疑い（壁が 2 群）は両立しないので、先頭 1 件を出せば足りる
  const notices = [...planModel.warnings, ...(twoPlansSuspected(planModel) ? ['平面図が 2 枚入っている可能性があります'] : [])];
  store.set((st) => ({ model: addFloor(st.model, planModel), mode: 'idle', plan2d: undefined, busy: undefined, notice: notices[0] }));
  return planModel;
}
