import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { addFloor } from '../model/building';
import type { Box2, PlanEntity, PlanModel, Vec2 } from '../model/types';
import { recognizePlan, selectRegion } from '../recognize';
import { store, useAppState } from '../state/store';

/** 青塗りを見せてから認識に入るまでの時間（設計書 §6.2 手順 4） */
const HIGHLIGHT_MS = 300;
/** 壁の帯がこれ以上離れた 2 群に分かれていれば、平面図が 2 枚入った疑い（§10） */
const TWO_PLANS_GAP_MM = 3000;

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
      store.set({ notice: '範囲に図形がありません。囲み直してください' });
      return;
    }
    setSelected(region.bbox);
    store.set({ busy: '読み込み中…' });
    timer.current = setTimeout(() => {
      timer.current = null;
      const planModel = recognizePlan(region);
      // 壁 0 本の注意と 2 枚混入の疑い（壁が 2 群）は両立しないので、先頭 1 件を出せば足りる
      const notices = [...planModel.warnings, ...(twoPlansSuspected(planModel) ? ['平面図が 2 枚入っている可能性があります'] : [])];
      store.set((st) => ({ model: addFloor(st.model, planModel), mode: 'idle', plan2d: undefined, busy: undefined, notice: notices[0] }));
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

/**
 * 平面図が 2 枚入った疑い（§10）: 壁の占める区間を X・Y それぞれで合併し、
 * 3 m 以上の空白を挟んで 2 群に分かれていれば真。端点の間隔で見ると 1 部屋の幅（3.6 m など）で誤検出するため、区間の合併で見る
 */
function twoPlansSuspected(m: PlanModel): boolean {
  return (['x', 'y'] as const).some((axis) => {
    const intervals = m.walls
      .map((w) => [Math.min(w.a[axis], w.b[axis]), Math.max(w.a[axis], w.b[axis])] as [number, number])
      .sort((p, q) => p[0] - q[0]);
    let reach = -Infinity;
    for (const [lo, hi] of intervals) {
      if (reach !== -Infinity && lo - reach > TWO_PLANS_GAP_MM) return true;
      reach = Math.max(reach, hi);
    }
    return false;
  });
}
