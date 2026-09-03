import { useRef } from 'react';
import { loadDxf } from '../dxf';
import { addRoof, removeRoof, setFloor1Level, setRoofParam } from '../model/building';
import type { BuildingModel } from '../model/types';
import { store, useAppState } from '../state/store';

/** 屋根の既定値（設計書 §6.4）。`roof` が無いときのスライダー表示に使う */
const ROOF_DEFAULTS = { pitchSun: 4, eave: 600, verge: 600 };

/**
 * 「屋根をかける」を押せるか。階ゼロでは無効（§10）。「屋根を外す」は常に押せる（退化した屋根を外せなくなるのを避ける）。
 * 加えて最上階に外壁が 1 本も無ければ無効にする（外壁芯の矩形が 0 になり、退化した屋根ができるため。Task 12 の申し送り）
 */
function canToggleRoof(model: BuildingModel): boolean {
  const top = model.floors[model.floors.length - 1];
  return !!top && top.plan.walls.some((w) => w.exterior);
}

/** 右上に浮くパネル。文言・順序は設計書 §2.2 と同じ */
export function Panel() {
  const s = useAppState();
  const fileInput = useRef<HTMLInputElement>(null);
  const roof = s.model.roof;

  /** DXF を解析して 2D 選択ビューへ。読めなければ赤字 1 行を出し、状態は変えない（§10） */
  const onFile = async (file: File) => {
    store.set({ busy: '読み込み中…', notice: undefined });
    try {
      const plan = loadDxf(await file.arrayBuffer(), file.name);
      store.set({ plan2d: plan, mode: 'select2d', busy: undefined });
    } catch (err) {
      store.set({ busy: undefined, notice: `DXF を読み込めませんでした（${(err as Error).message}）` });
    }
  };

  return (
    <aside className="panel">
      <section>
        <h3>作図</h3>
        <div className="row">
          <button onClick={() => store.set({ mode: 'drawRect', notice: undefined })}>長方形を描く</button>
          <button onClick={() => fileInput.current?.click()}>DXF 平面を描く</button>
          <input
            ref={fileInput}
            type="file"
            accept=".dxf"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
              e.target.value = '';   // 同じファイルをもう一度選んでも change が飛ぶようにする
            }}
          />
        </div>
        <p className="hint">描いた形は厚さ 100mm の板になります。上面を持ち上げてください。</p>
        <label className="field">
          1階の床高さ
          <input type="number" step={10} min={0} value={s.model.floor1Level} onChange={(e) => { if (e.target.value !== '') store.updateModel((m) => setFloor1Level(m, Number(e.target.value))); }} />
          mm
        </label>
      </section>
      <section>
        <h3>屋根</h3>
        <div className="row">
          <button disabled={!roof && !canToggleRoof(s.model)} onClick={() => store.updateModel((m) => (m.roof ? removeRoof(m) : addRoof(m)))}>
            {roof ? '屋根を外す' : '屋根をかける'}
          </button>
          <button disabled title="Phase 2">切り欠き</button>
        </div>
        <Slider label="勾配（すべての屋根で共通）" value={roof?.pitchSun ?? ROOF_DEFAULTS.pitchSun} min={0.5} max={10} step={0.5} unit="寸" format={(v) => v.toFixed(1)} disabled={!roof} onChange={(v) => store.updateModel((m) => setRoofParam(m, { pitchSun: v }))} />
        <Slider label="軒の出（軒先）" value={roof?.eave ?? ROOF_DEFAULTS.eave} min={0} max={1500} step={50} unit="mm" disabled={!roof} onChange={(v) => store.updateModel((m) => setRoofParam(m, { eave: v }))} />
        <Slider label="ケラバの出（妻側）" value={roof?.verge ?? ROOF_DEFAULTS.verge} min={0} max={1500} step={50} unit="mm" disabled={!roof} onChange={(v) => store.updateModel((m) => setRoofParam(m, { verge: v }))} />
      </section>
      {s.notice && <p className="notice">{s.notice}</p>}
      {s.busy && <p className="busy">{s.busy}</p>}
    </aside>
  );
}

interface SliderProps {
  label: string; value: number; min: number; max: number; step: number; unit: string;
  disabled?: boolean; format?: (v: number) => string; onChange: (v: number) => void;
}

/** ラベル・レンジ・現在値を 1 行に並べたスライダー */
function Slider(p: SliderProps) {
  return (
    <label className="slider">
      <span>{p.label}</span>
      <input type="range" min={p.min} max={p.max} step={p.step} value={p.value} disabled={p.disabled} onChange={(e) => p.onChange(Number(e.target.value))} />
      <strong>{(p.format ?? String)(p.value)} {p.unit}</strong>
    </label>
  );
}
