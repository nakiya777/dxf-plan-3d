import { useEffect, useRef } from 'react';
import { store, useAppState } from '../state/store';
import { HandleController } from '../viewer/handles';
import { Viewer } from '../viewer/scene';
import { Panel } from './Panel';
import { RectDraw } from './RectDraw';
import { SelectView } from './SelectView';
import './app.css';

/** 全画面の 3D キャンバス、右上のパネル、必要なときだけ重なる 2D 選択ビューと矩形描画のヘッダ（設計書 §6.1） */
export function App() {
  const s = useAppState();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const viewer = new Viewer(containerRef.current!);
    const handles = new HandleController(viewer);
    const rectDraw = new RectDraw(viewer);
    let floorCount = store.get().model.floors.length;
    const sync = () => {
      const st = store.get();
      viewer.setModel(st.model);
      // ブロックが増減したときだけカメラを寄せる（§6.7）。ハンドル操作のたびに動かさない
      if (st.model.floors.length !== floorCount) { floorCount = st.model.floors.length; viewer.fitToBuilding(); }
      rectDraw.setActive(st.mode === 'drawRect');
    };
    const unsubscribe = store.subscribe(sync);
    sync();
    // StrictMode の二重マウントに備え、必ず WebGL コンテキストを捨てる
    return () => { unsubscribe(); rectDraw.dispose(); handles.dispose(); viewer.dispose(); };
  }, []);

  // 矩形描画は Esc で戻る（§6.6）。2D 選択ビューの Esc は SelectView が持つ
  useEffect(() => {
    if (s.mode !== 'drawRect') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') store.set({ mode: 'idle' }); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s.mode]);

  return (
    <>
      <div ref={containerRef} className="canvas" />
      <Panel />
      {s.mode === 'drawRect' && (
        <header className="overlay-head">
          <span>長方形を描いてください</span>
          <button onClick={() => store.set({ mode: 'idle' })}>やめる</button>
        </header>
      )}
      {s.mode === 'select2d' && s.plan2d && <SelectView />}
    </>
  );
}
