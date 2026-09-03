import { useEffect, useRef } from 'react';
import { addFloor, addRoof, createBuilding } from '../model/building';
import type { PlanModel } from '../model/types';
import { store } from '../state/store';
import { Viewer } from '../viewer/scene';

/**
 * 【Task 15 で消す】動作確認用の手作り平面図。8 m × 6 m の外壁 4 本（厚さ 150）、ドア 1・窓 1。
 * DXF 読み込み（Task 15）が入るまでの仮データ
 */
function samplePlan(): PlanModel {
  const W = 8000;
  const D = 6000;
  const corners = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: D }, { x: 0, y: D }];
  const walls = corners.map((a, i) => ({ id: `w${i + 1}`, a, b: corners[(i + 1) % 4], thickness: 150, exterior: true }));
  return {
    walls,
    openings: [
      { wallId: 'w1', offset: 1500, width: 900, type: 'door', sill: 0, head: 2000 },
      { wallId: 'w2', offset: 2000, width: 1650, type: 'window', sill: 900, head: 2000 },
    ],
    stairs: [],
    axes: [],
    outline: [{ x: -75, y: -75 }, { x: W + 75, y: -75 }, { x: W + 75, y: D + 75 }, { x: -75, y: D + 75 }],
    decorLines: [],
    warnings: [],
  };
}

/** 【Task 15 で消す】初期状態に仮の 1 階と屋根を入れておく */
store.set({ model: addRoof(addFloor(createBuilding(), samplePlan())) });

/** 3D ビュー。パネル等の本実装は Task 15。ここでは Viewer とストアの仮の配線だけ */
export function App() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current!;
    const viewer = new Viewer(el);
    const unsubscribe = store.subscribe(() => viewer.setModel(store.get().model));
    viewer.setModel(store.get().model);
    viewer.fitToBuilding();
    // StrictMode の二重マウントに備え、必ず WebGL コンテキストを捨てる
    return () => { unsubscribe(); viewer.dispose(); };
  }, []);

  return <div ref={containerRef} style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }} />;
}
