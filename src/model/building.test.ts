import { describe, expect, it } from 'vitest';
import {
  addFloor, addRoof, alignToBelow, centerlineRect, createBuilding, moveFloor, removeRoof, rotateRidge,
  setFloor1Level, setInset, setRidgeOffset, setRoofParam, setTopZ, topFloorRect,
} from './building';
import type { PlanModel, Wall } from './types';

const wall = (id: string, x1: number, y1: number, x2: number, y2: number, exterior = true): Wall =>
  ({ id, a: { x: x1, y: y1 }, b: { x: x2, y: y2 }, thickness: 150, exterior });

/** 外壁だけの矩形平面。`walls` は左下 (0, 0) 基準で、`ox, oy` にずらして描く */
const rectWalls = (ox: number, oy: number, w: number, h: number): Wall[] => [
  wall('a', ox, oy, ox + w, oy),
  wall('b', ox + w, oy, ox + w, oy + h),
  wall('c', ox + w, oy + h, ox, oy + h),
  wall('d', ox, oy + h, ox, oy),
];

/** 基準平面の寸法（棟に直交する幅 W = 5,915、棟方向 L = 9,100） */
const L = 9100;
const W = 5915;

/** 9,100 × 5,915 の矩形平面。origin だけずらして 2 階を作る。`axes: false` で通り芯の無い図面 */
const plan = (ox = 0, oy = 0, opts: { axes?: boolean } = {}): PlanModel => ({
  walls: [
    ...rectWalls(ox, oy, L, W),
    // 内壁は外接矩形に効かない
    wall('i', ox - 3000, oy + 2000, ox + 4000, oy + 2000, false),
  ],
  openings: [], stairs: [], decorLines: [], warnings: [],
  axes: opts.axes === false
    ? []
    : [
        { label: 'X1', a: { x: ox, y: oy - 500 }, b: { x: ox, y: oy + 6500 }, bubble: { x: ox, y: oy - 800 } },
        { label: 'Y1', a: { x: ox - 500, y: oy }, b: { x: ox + 9600, y: oy }, bubble: { x: ox - 800, y: oy } },
      ],
  outline: [
    { x: ox - 75, y: oy - 75 }, { x: ox + L + 75, y: oy - 75 },
    { x: ox + L + 75, y: oy + W + 75 }, { x: ox - 75, y: oy + W + 75 },
  ],
});
/** 通り芯の無い基準平面（外壁の重ね合わせを試すとき） */
const bare = (ox = 0, oy = 0) => plan(ox, oy, { axes: false });
/** 1 階を原点に置いたときの offset */
const origin = { x: -L / 2, y: -W / 2 };

describe('centerlineRect', () => {
  it('外壁芯の端点だけで外接矩形を取る', () => {
    expect(centerlineRect(plan(100, 200))).toEqual({ minX: 100, minY: 200, maxX: 100 + L, maxY: 200 + W });
  });
  it('壁 0 本なら 0 の矩形', () => {
    expect(centerlineRect({ ...plan(), walls: [] })).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });
});

describe('階の追加と高さ', () => {
  it('1 階は FL1 = 550 に置かれ、外壁芯の中心が原点に来る', () => {
    const m = addFloor(createBuilding(), plan());
    expect(m.floors[0].id).toBe('f1');
    expect(m.floors[0].level).toBe(1);
    expect(m.floors[0].baseZ).toBe(550);
    expect(m.floors[0].topZ).toBe(550);
    expect(m.floors[0].offset).toEqual(origin);
  });
  it('id は既存の最大値 + 1（モデルごとに独立）', () => {
    const a = addFloor(addFloor(createBuilding(), plan()), plan(20000, 0));
    const b = addFloor(createBuilding(), plan());
    expect(a.floors.map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(b.floors[0].id).toBe('f1');
  });
  it('2 階目は直下の topZ + スラブ 100 に載る', () => {
    const m = addFloor(setTopZ(addFloor(createBuilding(), plan()), 'f1', 3000), plan(20000, 0));
    expect(m.floors[1].level).toBe(2);
    expect(m.floors[1].baseZ).toBe(3100);
    expect(m.floors[1].topZ).toBe(3100);
  });
  it('setTopZ は 50 mm に丸め、baseZ を下回らず、上の階を押し上げる', () => {
    let m = addFloor(addFloor(createBuilding(), plan()), plan(20000, 0));
    m = setTopZ(m, m.floors[0].id, 3372);
    expect(m.floors[0].topZ).toBe(3350);
    expect(m.floors[1].baseZ).toBe(3450); // 3,350 + スラブ 100
    m = setTopZ(m, m.floors[0].id, 100);
    expect(m.floors[0].topZ).toBe(550);
    expect(m.floors[1].baseZ).toBe(650);
  });
  it('最上階の setTopZ は下の階の baseZ・topZ を一切変えない', () => {
    let m = addFloor(setTopZ(addFloor(createBuilding(), plan()), 'f1', 3650), plan(20000, 0));
    const lowerBefore = m.floors[0];
    m = setTopZ(m, 'f2', m.floors[1].baseZ + 2800);
    expect(m.floors[1]).toMatchObject({ baseZ: 3750, topZ: 6550 });
    expect(m.floors[0].baseZ).toBe(lowerBefore.baseZ);
    expect(m.floors[0].topZ).toBe(lowerBefore.topZ);
  });
  it('setTopZ は上の階の高さ（top − base）を保つ', () => {
    let m = addFloor(addFloor(createBuilding(), plan()), plan(20000, 0));
    m = setTopZ(m, 'f2', m.floors[1].baseZ + 2800);
    m = setTopZ(m, 'f1', 3000);
    expect(m.floors[1].topZ - m.floors[1].baseZ).toBe(2800);
  });
  it('setFloor1Level は全階を持ち上げ、負にはならない', () => {
    let m = addFloor(addFloor(createBuilding(), plan()), plan(20000, 0));
    m = setFloor1Level(m, 800);
    expect(m.floors[0].baseZ).toBe(800);
    expect(m.floors[1].baseZ).toBe(900);
    expect(setFloor1Level(m, -10).floor1Level).toBe(0);
  });
  it('moveFloor は 10 mm に丸める', () => {
    let m = addFloor(createBuilding(), plan());
    m = moveFloor(m, m.floors[0].id, 123, -7);
    expect(m.floors[0].offset).toEqual({ x: origin.x + 120, y: origin.y - 10 });
  });
  it('moveFloor の −0 は 0 になる（toEqual で区別されるため）', () => {
    // 中心が原点の平面なら offset は (0, 0)。−3 は 10 mm に丸めると −0 になる
    const centered: PlanModel = { ...plan(), walls: rectWalls(-1000, -1000, 2000, 2000) };
    const m = moveFloor(addFloor(createBuilding(), centered), 'f1', -3, -3);
    expect(Object.is(m.floors[0].offset.x, -0)).toBe(false);
    expect(m.floors[0].offset).toEqual({ x: 0, y: 0 });
  });
  it('操作は元のモデルを変えない', () => {
    const m = addFloor(createBuilding(), plan());
    setTopZ(m, 'f1', 3000);
    moveFloor(m, 'f1', 100, 0);
    expect(m.floors[0].topZ).toBe(550);
    expect(m.floors[0].offset).toEqual(origin);
  });
});

describe('alignToBelow', () => {
  it('通り芯ラベルが両階にあれば芯を重ねる', () => {
    const m = addFloor(createBuilding(), plan());
    expect(alignToBelow(m.floors[0], plan(20000, 300))).toEqual({ x: origin.x - 20000, y: origin.y - 300 });
  });
  it('通り芯が無ければ外壁の重ね合わせで決まる', () => {
    const m = addFloor(createBuilding(), bare());
    const off = alignToBelow(m.floors[0], bare(20000, 300));
    expect(off.x).toBeCloseTo(origin.x - 20000, 0);
    expect(off.y).toBeCloseTo(origin.y - 300, 0);
  });
  it('片方向の通り芯しか一致しなければ、残りは外壁の重ね合わせ', () => {
    const m = addFloor(createBuilding(), plan());
    const upper = plan(20000, 300);
    upper.axes = upper.axes.filter((a) => a.label === 'X1');
    expect(alignToBelow(m.floors[0], upper)).toEqual({ x: origin.x - 20000, y: origin.y - 300 });
  });
  /**
   * 1 階の南・西の外壁に揃う 6,000 × 4,000 の 2 階を (ox, oy) に描いたもの。
   * 単純な矩形だと西壁を 1 階の西壁に重ねても東壁に重ねても重なり長が同じで答えが 2 つあるため、
   * 東壁を 2,000・北壁を 3,000 に短くして南・西合わせが一意に勝つようにしてある
   */
  const smallUpper = (ox: number, oy: number): PlanModel => ({
    ...bare(),
    walls: [
      wall('a', ox, oy, ox + 6000, oy),
      wall('b', ox + 6000, oy, ox + 6000, oy + 2000),
      wall('c', ox + 3000, oy + 4000, ox, oy + 4000),
      wall('d', ox, oy + 4000, ox, oy),
    ],
  });
  it('2 階が小さいときは外壁芯の重なりが最大になる位置（中心合わせではない）', () => {
    const m = addFloor(createBuilding(), bare());
    // 南壁 6,000 + 西壁 4,000 の重なりが最大。中心合わせなら x = −3,000 になる
    expect(alignToBelow(m.floors[0], smallUpper(0, 0))).toEqual(origin);
  });
  it('2 階の描画位置が離れていても、重なり長は位置合わせ後の座標で測る', () => {
    const m = addFloor(createBuilding(), bare());
    expect(alignToBelow(m.floors[0], smallUpper(0, 3000))).toEqual({ x: origin.x, y: origin.y - 3000 });
    expect(alignToBelow(m.floors[0], smallUpper(20000, 20000))).toEqual({ x: origin.x - 20000, y: origin.y - 20000 });
    expect(alignToBelow(m.floors[0], smallUpper(-20000, -20000))).toEqual({ x: origin.x + 20000, y: origin.y + 20000 });
  });
  it('通り芯で決まった軸は、外壁の重なりが大きい別の位置があっても覆らない', () => {
    const m = addFloor(createBuilding(), plan());
    // 2 階の X1 だけ壁より 1,000 東にずれている図面。壁を重ねるなら x = −24,550 だが、通り芯が優先される
    const upper = plan(20000, 300);
    upper.axes = [{ label: 'X1', a: { x: 21000, y: -200 }, b: { x: 21000, y: 6800 }, bubble: { x: 21000, y: -500 } }];
    expect(alignToBelow(m.floors[0], upper)).toEqual({ x: origin.x - 21000, y: origin.y - 300 });
  });
  it('重なり長が同点なら中心合わせに近い組を取る [推定]', () => {
    // 1 階の外接矩形を西の短い外壁で −3,000 まで広げる（中心は x = 3,050 → 建物座標で西壁 −3,050、東壁 6,050）
    const lower: PlanModel = { ...bare(), walls: [...bare().walls, wall('stub', -3000, 0, -3000, 100)] };
    const m = addFloor(createBuilding(), lower);
    expect(m.floors[0].offset.x).toBe(-3050);
    // 6,000 × 4,000 の 2 階は西壁合わせ（x = −3,050）と東壁合わせ（x = 50）が同点。
    // 中心合わせ x = −3,000 に近い西壁合わせを取る
    const upper: PlanModel = { ...bare(), walls: rectWalls(0, 0, 6000, 4000) };
    expect(alignToBelow(m.floors[0], upper).x).toBe(-3050);
  });
  it('20 mm 以内のずれは同じ位置とみなして重なり長に数える', () => {
    // 1 階は x = 6,000 にも外壁がある。2 階の東壁は 6,010 で 10 mm ずれているが、西壁合わせ（x = −4,550）で東壁も数えられる
    const lower: PlanModel = { ...bare(), walls: [...bare().walls, wall('step', 6000, 0, 6000, W)] };
    const m = addFloor(createBuilding(), lower);
    const upper: PlanModel = {
      ...bare(),
      walls: [
        wall('a', 0, 0, 6010, 0),
        wall('b', 6010, 0, 6010, 4000),
        wall('c', 3000, 4000, 0, 4000),
        wall('d', 0, 4000, 0, 2000),
      ],
    };
    expect(alignToBelow(m.floors[0], upper)).toEqual(origin);
  });
  it('addFloor は 2 階目を直下に位置合わせする', () => {
    const m = addFloor(addFloor(createBuilding(), plan()), plan(20000, 300));
    expect(m.floors[1].offset).toEqual({ x: origin.x - 20000, y: origin.y - 300 });
  });
});

describe('屋根', () => {
  it('既定は長手（X）方向の棟で、inset は W/2（4 面の勾配が等しい位置）', () => {
    const m = addRoof(setTopZ(addFloor(createBuilding(), plan()), 'f1', 3350));
    expect(m.roof).toEqual({
      axis: 'x', ridgeOffset: 0, inset: [W / 2, W / 2], pitchSun: 4, eave: 600, verge: 600, thickness: 150,
    });
    expect(topFloorRect(m)).toEqual({ minX: -L / 2, minY: -W / 2, maxX: L / 2, maxY: W / 2 });
  });
  it('階が無ければ屋根はかけない', () => {
    expect(addRoof(createBuilding()).roof).toBeUndefined();
  });
  it('正方形に近い縦長の平面では棟は Y 方向、inset は L/2 を超えない', () => {
    const tall: PlanModel = { ...plan(), walls: rectWalls(0, 0, 3000, 8000) };
    const m = addRoof(addFloor(createBuilding(), tall));
    expect(m.roof?.axis).toBe('y');
    expect(m.roof?.inset).toEqual([1500, 1500]);
    const square: PlanModel = { ...plan(), walls: rectWalls(0, 0, 3000, 3000) };
    expect(addRoof(addFloor(createBuilding(), square)).roof).toMatchObject({ axis: 'x', inset: [1500, 1500] }); // 同寸なら X
  });
  it('setInset は 100 mm 以内なら 0（切妻）に、既定位置にも 100 mm で寄せ、L/2 を超えない', () => {
    let m = addRoof(addFloor(createBuilding(), plan()));
    m = setInset(m, 0, 80);
    expect(m.roof?.inset[0]).toBe(0);
    m = setInset(m, 1, 99999);
    expect(m.roof?.inset[1]).toBe(L / 2);
    m = setInset(m, 1, W / 2 + 99);
    expect(m.roof?.inset[1]).toBe(W / 2);
    m = setInset(m, 1, W / 2 + 101);
    expect(m.roof?.inset[1]).toBe(W / 2 + 101);
    m = setInset(m, 0, -50);
    expect(m.roof?.inset[0]).toBe(0);
  });
  it('rotateRidge は軸を入れ替え、inset を新しい寸法の既定に戻し、ridgeOffset を 0 にする', () => {
    let m = addRoof(addFloor(createBuilding(), plan()));
    m = setRidgeOffset(setInset(m, 0, 0), 500);
    m = rotateRidge(m);
    // 棟が Y 方向なら W = 9,100 → 4,550 だが、L/2 = 2,957.5 が上限
    expect(m.roof).toMatchObject({ axis: 'y', inset: [W / 2, W / 2], ridgeOffset: 0 });
    expect(rotateRidge(m).roof?.axis).toBe('x');
  });
  it('setRidgeOffset は 10 mm に丸め、±(W/2 − 300) で止まる', () => {
    const m = addRoof(addFloor(createBuilding(), plan()));
    expect(setRidgeOffset(m, 123).roof?.ridgeOffset).toBe(120);
    expect(setRidgeOffset(m, 99999).roof?.ridgeOffset).toBe(W / 2 - 300);
    expect(setRidgeOffset(m, -99999).roof?.ridgeOffset).toBe(-(W / 2 - 300));
    expect(Object.is(setRidgeOffset(m, -3).roof?.ridgeOffset, -0)).toBe(false);
  });
  it('setRoofParam は部分更新、removeRoof は外す。屋根が無ければ何もしない', () => {
    const m = addRoof(addFloor(createBuilding(), plan()));
    expect(setRoofParam(m, { pitchSun: 5, eave: 900 }).roof).toMatchObject({ pitchSun: 5, eave: 900, verge: 600 });
    expect(removeRoof(m).roof).toBeUndefined();
    const roofless = addFloor(createBuilding(), plan());
    expect(setInset(roofless, 0, 0).roof).toBeUndefined();
    expect(setRoofParam(roofless, { pitchSun: 5 }).roof).toBeUndefined();
  });
});
