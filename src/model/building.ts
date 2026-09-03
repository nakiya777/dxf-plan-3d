import type { Box2, BuildingModel, FloorBlock, PlanModel, Roof, Vec2, Wall } from './types';

/** 高さのスナップ（設計書 §6.3） */
const SNAP_Z = 50;
/** 横移動・棟の平行移動のスナップ（§6.3、§6.5） */
const SNAP_XY = 10;
/** 橙球の 0（切妻）・既定の寄棟位置へのスナップ幅（§6.5） */
const INSET_SNAP = 100;
/** 緑菱形の可動範囲を W/2 から縮める余白（§6.5） */
const RIDGE_OFFSET_MARGIN = 300;
/** 通り芯ラベルが無いときの外壁重ね合わせで「同じ位置」とみなす許容差 */
const OVERLAY_TOLERANCE = 20;

const snap = (value: number, step: number) => Math.round(value / step) * step;

/** 空の建物。1 階の床高さは GL + 550（§4.3、Q4 回答） */
export function createBuilding(): BuildingModel {
  return { floor1Level: 550, slabThickness: 100, floors: [] };
}

/**
 * 外壁芯の外接矩形（平面図座標）。屋根・位置合わせの基準（Q9 回答: 軒の出は壁芯から測る）。
 * 外壁が 1 本も無いときは 0 の矩形を返し、扱いは呼び出し側に任せる
 */
export function centerlineRect(plan: PlanModel): Box2 {
  const points = plan.walls.filter((w) => w.exterior).flatMap((w) => [w.a, w.b]);
  if (points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return {
    minX: Math.min(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxX: Math.max(...points.map((p) => p.x)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

const shift = (b: Box2, o: Vec2): Box2 => ({ minX: b.minX + o.x, minY: b.minY + o.y, maxX: b.maxX + o.x, maxY: b.maxY + o.y });
const center = (b: Box2): Vec2 => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });

interface Segment { a: Vec2; b: Vec2 }

/** 通り芯が X 方向（Y 軸に平行で、X 位置を決める）か */
const isXAxis = (axis: Segment) => Math.abs(axis.a.x - axis.b.x) < Math.abs(axis.a.y - axis.b.y);

/** 外壁芯を建物座標へ平行移動したもの */
const exteriorSegments = (walls: Wall[], offset: Vec2): Segment[] =>
  walls.filter((w) => w.exterior).map((w) => ({ a: { x: w.a.x + offset.x, y: w.a.y + offset.y }, b: { x: w.b.x + offset.x, y: w.b.y + offset.y } }));

/** その軸に直交する（軸の座標が一定の）壁 */
const perpendicularTo = (axis: 'x' | 'y') => (s: Segment) => Math.abs(s.a[axis] - s.b[axis]) < 1;

/** 2 本の壁の重なり長。同じ向きで位置が揃っている（許容 20 mm）ときだけ、伸びる方向の共有区間を返す */
function overlapLength(l: Segment, u: Segment, shiftBy: Vec2): number {
  for (const axis of ['x', 'y'] as const) {
    if (!perpendicularTo(axis)(l) || !perpendicularTo(axis)(u)) continue;
    if (Math.abs(l.a[axis] - (u.a[axis] + shiftBy[axis])) > OVERLAY_TOLERANCE) return 0;
    const other = axis === 'x' ? 'y' : 'x';
    const uMin = Math.min(u.a[other], u.b[other]) + shiftBy[other];
    const uMax = Math.max(u.a[other], u.b[other]) + shiftBy[other];
    return Math.max(0, Math.min(Math.max(l.a[other], l.b[other]), uMax) - Math.max(Math.min(l.a[other], l.b[other]), uMin));
  }
  return 0;
}

/**
 * 外壁の重ね合わせ（§8.5 手順 2）。候補の組 (dx, dy) を総当たりで採点し、重なり長の合計が最大の組を返す。
 * 各軸の候補は「外接矩形の中心合わせ」＋「その軸に直交する外壁どうしの位置差」。通り芯で決まった軸は `fixed` の値 1 つに固定する。
 * 重なり長を (dx, dy) 適用後の座標で測るので、両階の描画位置が離れていても採点がずれない。
 * 同点（矩形どうしでは西壁を東壁に重ねても同じ重なり長になる）は中心合わせに近い組を取る [推定]
 */
function overlayFloors(lower: Segment[], upper: Segment[], lowerRect: Box2, upperRect: Box2, fixed: Partial<Vec2>): Vec2 {
  const centered: Vec2 = { x: center(lowerRect).x - center(upperRect).x, y: center(lowerRect).y - center(upperRect).y };
  const candidatesAlong = (axis: 'x' | 'y'): number[] => {
    const fixedValue = fixed[axis];
    if (fixedValue !== undefined) return [fixedValue];
    const set = new Set<number>([centered[axis]]);
    for (const l of lower.filter(perpendicularTo(axis))) for (const u of upper.filter(perpendicularTo(axis))) set.add(l.a[axis] - u.a[axis]);
    return [...set];
  };
  const distance = (d: Vec2) => Math.hypot(d.x - centered.x, d.y - centered.y);
  let best: Vec2 = { x: fixed.x ?? centered.x, y: fixed.y ?? centered.y };
  let bestScore = -1;
  for (const dx of candidatesAlong('x')) for (const dy of candidatesAlong('y')) {
    const d = { x: dx, y: dy };
    let score = 0;
    for (const l of lower) for (const u of upper) score += overlapLength(l, u, d);
    if (score > bestScore || (score === bestScore && distance(d) < distance(best))) { bestScore = score; best = d; }
  }
  return best;
}

/**
 * 2 階目以降の位置合わせ（§8.5）。新しい階の平面図座標 → 建物座標の平行移動を返す。
 * 1. 両階に同じラベルの通り芯があれば、X 方向・Y 方向それぞれ最初に見つかった芯を重ねる
 * 2. 残りは外壁の重ね合わせで決める（片軸だけ通り芯で決まったときは、その軸を固定して重ね合わせる）
 */
export function alignToBelow(below: FloorBlock, plan: PlanModel): Vec2 {
  let dx: number | undefined;
  let dy: number | undefined;
  for (const axis of plan.axes) {
    const match = below.plan.axes.find((b) => b.label === axis.label);
    if (!match) continue;
    if (isXAxis(axis) && dx === undefined) dx = match.a.x + below.offset.x - axis.a.x;
    if (!isXAxis(axis) && dy === undefined) dy = match.a.y + below.offset.y - axis.a.y;
  }
  if (dx !== undefined && dy !== undefined) return { x: dx, y: dy };
  const lower = exteriorSegments(below.plan.walls, below.offset);
  const upper = exteriorSegments(plan.walls, { x: 0, y: 0 });
  const lowerRect = shift(centerlineRect(below.plan), below.offset);
  const upperRect = centerlineRect(plan);
  return overlayFloors(lower, upper, lowerRect, upperRect, { x: dx, y: dy });
}

/** 次の階の id。既存 id の最大番号 + 1 なので、モジュール状態を持たずテスト間で漏れない */
function nextFloorId(floors: FloorBlock[]): string {
  const max = floors.reduce((m, f) => Math.max(m, Number(f.id.slice(1)) || 0), 0);
  return `f${max + 1}`;
}

/**
 * 階を積む（§6.2 手順 4）。1 階目は外壁芯の中心を原点に置き `baseZ = floor1Level`、
 * 2 階目以降は直下に位置合わせして `baseZ = 直下.topZ + slabThickness`。壁はまだ立てない（topZ = baseZ）
 */
export function addFloor(model: BuildingModel, plan: PlanModel): BuildingModel {
  const below = model.floors[model.floors.length - 1];
  const c = center(centerlineRect(plan));
  const offset: Vec2 = below ? alignToBelow(below, plan) : { x: -c.x, y: -c.y };
  const baseZ = below ? below.topZ + model.slabThickness : model.floor1Level;
  const floor: FloorBlock = { id: nextFloorId(model.floors), level: model.floors.length + 1, plan, offset, baseZ, topZ: baseZ };
  return { ...model, floors: [...model.floors, floor] };
}

/** 積み重ねの不変条件を回復する: base_i = top_{i−1} + slab。各階の高さ（top − base）は保つ */
function restack(model: BuildingModel): BuildingModel {
  const floors: FloorBlock[] = [];
  model.floors.forEach((f, i) => {
    const baseZ = i === 0 ? model.floor1Level : floors[i - 1].topZ + model.slabThickness;
    floors.push({ ...f, baseZ, topZ: baseZ + (f.topZ - f.baseZ) });
  });
  return { ...model, floors };
}

/** 壁上端を動かす（青ハンドルの高さモード）。50 mm スナップ、baseZ 未満にはしない。上の階は押し上がる */
export function setTopZ(model: BuildingModel, floorId: string, z: number): BuildingModel {
  return restack({ ...model, floors: model.floors.map((f) => (f.id === floorId ? { ...f, topZ: Math.max(f.baseZ, snap(z, SNAP_Z)) } : f)) });
}

/** 1 階の床高さ（基礎高さ）。全階が一緒に動く */
export function setFloor1Level(model: BuildingModel, level: number): BuildingModel {
  return restack({ ...model, floor1Level: Math.max(0, level) });
}

/** 横移動（青ハンドルの横移動モード）。10 mm スナップ。上の階は一緒に動かさない（§6.3 [暫定]） */
export function moveFloor(model: BuildingModel, floorId: string, dx: number, dy: number): BuildingModel {
  return {
    ...model,
    floors: model.floors.map((f) => (f.id === floorId ? { ...f, offset: { x: f.offset.x + snap(dx, SNAP_XY), y: f.offset.y + snap(dy, SNAP_XY) } } : f)),
  };
}

/** 最上階の外壁芯の外接矩形（建物座標）。屋根の基準 */
export function topFloorRect(model: BuildingModel): Box2 {
  const top = model.floors[model.floors.length - 1];
  return shift(centerlineRect(top.plan), top.offset);
}

/** 棟に直交する幅 W と棟方向の長さ L（§8.4） */
const roofSpan = (rect: Box2, axis: 'x' | 'y') => {
  const dx = rect.maxX - rect.minX;
  const dy = rect.maxY - rect.minY;
  return axis === 'x' ? { W: dy, L: dx } : { W: dx, L: dy };
};

/**
 * 寄棟の既定 inset。4 面の勾配が等しくなる位置は壁芯から W/2（隅棟が平面で 45° になり軒先の角を通る）。
 * L/2 を超えるときは L/2（棟の長さ 0 = 方形）
 */
export function defaultInset(rect: Box2, axis: 'x' | 'y'): number {
  const { W, L } = roofSpan(rect, axis);
  return Math.min(W / 2, L / 2);
}

/** 屋根をかける（§6.4）。棟は長手方向、勾配 4 寸、軒の出・ケラバ 600、屋根厚 150、両端は既定の寄棟 */
export function addRoof(model: BuildingModel): BuildingModel {
  if (model.floors.length === 0) return model;
  const rect = topFloorRect(model);
  const axis: 'x' | 'y' = rect.maxX - rect.minX >= rect.maxY - rect.minY ? 'x' : 'y';
  const inset = defaultInset(rect, axis);
  const roof: Roof = { axis, ridgeOffset: 0, inset: [inset, inset], pitchSun: 4, eave: 600, verge: 600, thickness: 150 };
  return { ...model, roof };
}

export const removeRoof = (model: BuildingModel): BuildingModel => ({ ...model, roof: undefined });

/** スライダーの即時更新（勾配・軒の出・ケラバの出など）。屋根が無ければ何もしない */
export const setRoofParam = (model: BuildingModel, patch: Partial<Roof>): BuildingModel =>
  model.roof ? { ...model, roof: { ...model.roof, ...patch } } : model;

/** 紫回転矢印: 棟を x⇔y に切り替え、inset は新しい寸法の既定に戻す。棟の平行移動も戻す */
export function rotateRidge(model: BuildingModel): BuildingModel {
  if (!model.roof) return model;
  const axis = model.roof.axis === 'x' ? 'y' : 'x';
  const inset = defaultInset(topFloorRect(model), axis);
  return { ...model, roof: { ...model.roof, axis, inset: [inset, inset], ridgeOffset: 0 } };
}

/** 橙球: 端 `end` の inset。0 ≤ inset ≤ L/2。0（切妻）と既定の寄棟位置に 100 mm でスナップ */
export function setInset(model: BuildingModel, end: 0 | 1, value: number): BuildingModel {
  if (!model.roof) return model;
  const rect = topFloorRect(model);
  const { L } = roofSpan(rect, model.roof.axis);
  const preset = defaultInset(rect, model.roof.axis);
  let v = Math.max(0, Math.min(L / 2, value));
  if (v <= INSET_SNAP) v = 0;
  else if (Math.abs(v - preset) <= INSET_SNAP) v = preset;
  const inset: [number, number] = [model.roof.inset[0], model.roof.inset[1]];
  inset[end] = v;
  return { ...model, roof: { ...model.roof, inset } };
}

/** 緑菱形: 棟の平行移動 [暫定機能]。10 mm スナップ、±(W/2 − 300) で止める */
export function setRidgeOffset(model: BuildingModel, value: number): BuildingModel {
  if (!model.roof) return model;
  const { W } = roofSpan(topFloorRect(model), model.roof.axis);
  const limit = Math.max(0, W / 2 - RIDGE_OFFSET_MARGIN);
  return { ...model, roof: { ...model.roof, ridgeOffset: Math.max(-limit, Math.min(limit, snap(value, SNAP_XY))) } };
}
