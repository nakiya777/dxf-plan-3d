import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Box2, PlanEntity, Vec2 } from '../model/types';
import { selectRegion } from '../recognize';
import { store, useAppState } from '../state/store';
import { commitRegion, EMPTY_REGION_NOTICE } from './commitRegion';

/** 青塗りを見せてから認識に入るまでの時間（設計書 §6.2 手順 4） */
const HIGHLIGHT_MS = 300;

/** 全画面の 2D ビュー。矩形ドラッグで平面図を囲む（設計書 §6.2） */
export function SelectView() {
  const s = useAppState();
  const plan = s.plan2d!;
  const svgRef = useRef<SVGSVGElement>(null);
  const dragStart = useRef<Vec2 | null>(null);
  /** ドラッグ中の矩形の現在値。`drag` state は描画専用で、`onUp` はこちらを読む（閉包の古い値を掴まないため） */
  const dragRect = useRef<Box2 | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [drag, setDrag] = useState<Box2 | null>(null);
  const [selected, setSelected] = useState<Box2 | null>(null);

  /** 「やめる」または Esc。何も変えずに 3D に戻る。認識待ちのタイマーも止める */
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    store.set({ mode: 'idle', plan2d: undefined, busy: undefined });
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // 図面全体が収まる viewBox。SVG は Y が下向きなので Y を反転して描く
  const b = plan.bbox;
  const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.03;
  const viewBox = `${b.minX - pad} ${-b.maxY - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxY - b.minY + 2 * pad}`;

  /** 画面座標 → 図面座標（mm、Y 上向き） */
  const toPlan = (e: ReactPointerEvent): Vec2 => {
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svgRef.current!.getScreenCTM()!.inverse());
    return { x: pt.x, y: -pt.y };
  };

  const onDown = (e: ReactPointerEvent) => {
    if (s.busy || e.button !== 0) return;
    svgRef.current!.setPointerCapture(e.pointerId);
    dragStart.current = toPlan(e);
    setSelected(null);
    dragRect.current = null;
    setDrag(null);
    store.set({ notice: undefined });
  };
  const onMove = (e: ReactPointerEvent) => {
    const a = dragStart.current;
    if (!a) return;
    const p = toPlan(e);
    dragRect.current = { minX: Math.min(a.x, p.x), minY: Math.min(a.y, p.y), maxX: Math.max(a.x, p.x), maxY: Math.max(a.y, p.y) };
    setDrag(dragRect.current);
  };
  const onUp = () => {
    dragStart.current = null;
    const rect = dragRect.current;
    if (!rect) return;
    dragRect.current = null;
    setDrag(null);
    const region = selectRegion(plan, rect);
    if (region.entities.length === 0) {
      store.set({ notice: EMPTY_REGION_NOTICE });
      return;
    }
    setSelected(region.bbox);
    store.set({ busy: '読み込み中…' });
    timer.current = setTimeout(() => {
      timer.current = null;
      commitRegion(region);
    }, HIGHLIGHT_MS);
  };

  return (
    <div className="select-view">
      <header>
        <span>{s.busy ?? '平面図を囲んでください'}</span>
        {s.notice && <span className="notice">{s.notice}</span>}
        <button onClick={cancel}>やめる</button>
      </header>
      <svg ref={svgRef} viewBox={viewBox} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} style={{ cursor: 'crosshair' }}>
        {plan.entities.map((e, i) => <Entity key={i} e={e} />)}
        {drag && <rect x={drag.minX} y={-drag.maxY} width={drag.maxX - drag.minX} height={drag.maxY - drag.minY} fill="none" stroke="#1e88e5" strokeDasharray="8 4" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
        {selected && <rect x={selected.minX} y={-selected.maxY} width={selected.maxX - selected.minX} height={selected.maxY - selected.minY} fill="#1e88e5" fillOpacity={0.18} />}
      </svg>
    </div>
  );
}

/** エンティティ 1 つを SVG に描く。線は暗灰、文字は緑 */
function Entity({ e }: { e: PlanEntity }) {
  const stroke = { stroke: '#444', fill: 'none', vectorEffect: 'non-scaling-stroke' as const, strokeWidth: 1 };
  if (e.kind === 'line') return <line x1={e.a.x} y1={-e.a.y} x2={e.b.x} y2={-e.b.y} {...stroke} />;
  if (e.kind === 'circle') return <circle cx={e.center.x} cy={-e.center.y} r={e.radius} {...stroke} />;
  if (e.kind === 'arc') {
    // DXF の弧は反時計回り（start → end）。end ≤ start なら 360° を跨ぐ
    const a0 = (e.startDeg * Math.PI) / 180;
    const a1 = ((e.endDeg <= e.startDeg ? e.endDeg + 360 : e.endDeg) * Math.PI) / 180;
    const p0 = { x: e.center.x + e.radius * Math.cos(a0), y: -(e.center.y + e.radius * Math.sin(a0)) };
    const p1 = { x: e.center.x + e.radius * Math.cos(a1), y: -(e.center.y + e.radius * Math.sin(a1)) };
    // Y 反転後は反時計回りが画面上で時計回りになる。sweep-flag は 0（負方向）。180° 超なら大円弧
    const largeArc = a1 - a0 > Math.PI ? 1 : 0;
    return <path d={`M ${p0.x} ${p0.y} A ${e.radius} ${e.radius} 0 ${largeArc} 0 ${p1.x} ${p1.y}`} {...stroke} />;
  }
  return <text x={e.at.x} y={-e.at.y} fontSize={e.height} fill="#2a8f3c">{e.text}</text>;
}

