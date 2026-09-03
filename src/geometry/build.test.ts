import { Box3, LineBasicMaterial, LineSegments, Mesh, MeshLambertMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { addFloor, addRoof, createBuilding, rotateRidge, setTopZ } from '../model/building';
import { recognizePlan } from '../recognize';
import { planInBox } from '../recognize/testing';
import type { BuildingModel, PlanModel, Stair, Wall } from '../model/types';
import { buildBuilding, prismGeometry, roofGeometry, stairwellHoles, wallGeometry } from './build';
import { MODEL_TO_SCENE, SCENE_TO_MODEL, toScene } from './coords';

const wall = (id: string, x1: number, y1: number, x2: number, y2: number, exterior = true, thickness = 150): Wall =>
  ({ id, a: { x: x1, y: y1 }, b: { x: x2, y: y2 }, thickness, exterior });
const emptyPlan = (): PlanModel => ({ walls: [], openings: [], stairs: [], axes: [], decorLines: [], warnings: [], outline: [] });
const plan: PlanModel = {
  ...emptyPlan(),
  walls: [wall('a', 0, 0, 9100, 0), wall('b', 9100, 0, 9100, 5915), wall('c', 9100, 5915, 0, 5915), wall('d', 0, 5915, 0, 0)],
  openings: [{ wallId: 'a', offset: 1000, width: 1820, type: 'window', sill: 0, head: 2000 }],
  outline: [{ x: -75, y: -75 }, { x: 9175, y: -75 }, { x: 9175, y: 5990 }, { x: -75, y: 5990 }],
};
const straightStair: Stair = { flights: [{ rect: { minX: 1000, minY: 1000, maxX: 4640, maxY: 1910 }, axis: 'x', ascendPositive: true, treads: 12 }], landings: [] };

const box = (o: Parameters<Box3['setFromObject']>[0]) => new Box3().setFromObject(o);
const children = (m: BuildingModel, name: string) => buildBuilding(m).group.children.filter((c) => c.name === name);
const oneFloor = (p: PlanModel = plan, topZ = 3350) => setTopZ(addFloor(createBuilding(), p), 'f1', topZ);

describe('coords', () => {
  it('モデル (9100, 5915, 3350) mm → シーン (9.1, 3.35, −5.915)', () => {
    const v = toScene(9100, 5915, 3350);
    expect([v.x, v.y, v.z]).toEqual([9.1, 3.35, -5.915]);
  });
  it('逆行列で戻る', () => {
    const v = new Vector3(9.1, 3.35, -5.915).applyMatrix4(SCENE_TO_MODEL);
    expect(v.x).toBeCloseTo(9100, 6);
    expect(v.y).toBeCloseTo(5915, 6);
    expect(v.z).toBeCloseTo(3350, 6);
    expect(MODEL_TO_SCENE.determinant()).toBeGreaterThan(0); // 鏡映ではない（面の向きを保つ）
  });
});

describe('buildBuilding', () => {
  it('1 階だけ: 基礎 + 板 + 壁 4 本のメッシュができ、全体の高さはシーンで 0 〜 3.35 m', () => {
    const g = buildBuilding(oneFloor());
    const b = box(g.group);
    expect(b.min.y).toBeCloseTo(0, 3);
    expect(b.max.y).toBeCloseTo(3.35, 3);
    expect(g.group.children.filter((c) => c.name === 'wall')).toHaveLength(4);
    expect(g.group.children.filter((c) => c.name === 'foundation')).toHaveLength(1);
    expect(g.group.children.filter((c) => c.name === 'slab')).toHaveLength(1);
    expect(g.roofGeom).toBeUndefined();
  });
  it('基礎は GL から板の下面（baseZ − 100）まで、板は baseZ の上面に来る', () => {
    const m = oneFloor();
    const foundation = box(children(m, 'foundation')[0]);
    expect(foundation.min.y).toBeCloseTo(0, 6);
    expect(foundation.max.y).toBeCloseTo(0.45, 6);
    const slab = box(children(m, 'slab')[0]);
    expect(slab.min.y).toBeCloseTo(0.45, 6);
    expect(slab.max.y).toBeCloseTo(0.55, 6);
    // 外形は外壁芯の中心を原点に置く（addFloor の offset）
    expect(slab.min.x).toBeCloseTo(-4.625, 6);
    expect(slab.max.x).toBeCloseTo(4.625, 6);
  });
  it('壁は床上面（baseZ）から topZ まで。壁 id を userData に持つ', () => {
    const m = oneFloor();
    const walls = children(m, 'wall') as Mesh[];
    expect(walls.map((w) => w.userData.wallId).sort()).toEqual(['a', 'b', 'c', 'd']);
    const b = box(walls[0]);
    expect(b.min.y).toBeCloseTo(0.55, 6);
    expect(b.max.y).toBeCloseTo(3.35, 6);
  });
  it('壁の高さが 0 のときはメッシュはできるが高さは 0', () => {
    const m = addFloor(createBuilding(), plan);
    const b = box(children(m, 'wall')[0]);
    expect(b.max.y - b.min.y).toBeCloseTo(0, 6);
  });
  it('壁が無い平面図（outline 空）では板も基礎も作らず、飾り線だけ描く', () => {
    const p = { ...emptyPlan(), decorLines: [{ kind: 'line' as const, layer: 'x', a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } }] };
    const m = addFloor(createBuilding(), p);
    const g = buildBuilding(m);
    expect(g.group.children.filter((c) => c.name === 'slab' || c.name === 'foundation')).toHaveLength(0);
    expect(g.group.children.filter((c) => c.name === 'decor')).toHaveLength(2);
  });
  it('飾り線と通り芯バブルは床面 + 2 mm の高さ（各階）に青線で描く', () => {
    const p: PlanModel = {
      ...plan,
      axes: [{ label: 'X1', a: { x: 0, y: -1000 }, b: { x: 0, y: 7000 }, bubble: { x: 0, y: -1500 } }],
      decorLines: [
        { kind: 'line', layer: 'x', a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } },
        { kind: 'arc', layer: 'x', center: { x: 2000, y: 2000 }, radius: 500, startDeg: 0, endDeg: 90 },
        { kind: 'circle', layer: 'x', center: { x: 3000, y: 3000 }, radius: 300 },
      ],
    };
    let m = oneFloor(p);
    m = setTopZ(addFloor(m, p), 'f2', 6000);
    const decor = buildBuilding(m).group.children.filter((c) => c.name === 'decor') as LineSegments[];
    expect(decor).toHaveLength(4);
    const heights = decor.map((d) => box(d).min.y);
    expect(heights.filter((h) => Math.abs(h - 0.552) < 1e-6)).toHaveLength(2);
    expect(heights.filter((h) => Math.abs(h - (3.35 + 0.1 + 0.002)) < 1e-6)).toHaveLength(2);
    // 線 1 本 + 弧 16 分割 + 円 16 分割 = 33 線分 = 66 頂点
    expect(decor[0].geometry.getAttribute('position').count).toBe(66);
    // バブルの半径は 250 mm
    const bubble = box(decor[1]);
    expect(bubble.max.x - bubble.min.x).toBeCloseTo(0.5, 6);
    expect((decor[0].material as LineBasicMaterial).color.getHex()).toBe(0x3b7dd8);
  });
  it('2 階は 1 階の板の上（topZ + 100）から始まり、2 階の板に基礎は付かない', () => {
    let m = oneFloor();
    m = setTopZ(addFloor(m, plan), 'f2', 6000);
    const g = buildBuilding(m);
    expect(g.group.children.filter((c) => c.name === 'foundation')).toHaveLength(1);
    const slabs = g.group.children.filter((c) => c.name === 'slab');
    expect(slabs).toHaveLength(2);
    expect(box(slabs[1]).min.y).toBeCloseTo(3.35, 6);
    expect(box(slabs[1]).max.y).toBeCloseTo(3.45, 6);
    expect(box(g.group).max.y).toBeCloseTo(6.0, 6);
  });
});

describe('wallGeometry', () => {
  const floor = oneFloor().floors[0];
  it('壁芯を中心に厚さ分の幅を持ち、接続先の壁厚/2 だけ端を延ばす', () => {
    const g = wallGeometry(plan.walls[0], plan.walls, [], 2800, floor);
    g.computeBoundingBox();
    const b = g.boundingBox!;
    // 壁 a は y = 0（建物座標では y = −2957.5）。厚さ 150 → シーン z は 2.8825 〜 3.0325
    expect(b.min.z).toBeCloseTo(2.9575 - 0.075, 6);
    expect(b.max.z).toBeCloseTo(2.9575 + 0.075, 6);
    // 両端は壁 d・b（厚さ 150）に接続 → 75 mm ずつ延長
    expect(b.min.x).toBeCloseTo(-4.55 - 0.075, 6);
    expect(b.max.x).toBeCloseTo(4.55 + 0.075, 6);
  });
  it('接続先の厚さで延長量が決まり、接続先が無い端は延ばさない', () => {
    const walls = [wall('a', 0, 0, 5000, 0, false, 120), wall('t', 5000, -2000, 5000, 2000, true, 200)];
    const g = wallGeometry(walls[0], walls, [], 2800, floor);
    g.computeBoundingBox();
    const b = g.boundingBox!;
    expect(b.max.x - b.min.x).toBeCloseTo(5.1, 6); // 端 a は 0、端 b は 200/2
  });
  it('開口は穴になり、頂点数が増える。H が低いと切り欠き', () => {
    const solid = wallGeometry(plan.walls[0], plan.walls, [], 2800, floor).getAttribute('position').count;
    const withHole = wallGeometry(plan.walls[0], plan.walls, plan.openings, 2800, floor).getAttribute('position').count;
    const notched = wallGeometry(plan.walls[0], plan.walls, plan.openings, 1500, floor).getAttribute('position').count;
    expect(withHole).toBeGreaterThan(solid);
    expect(notched).toBeGreaterThan(solid);
    expect(withHole).toBeGreaterThan(notched);
  });
  it('穴は壁の a 端から offset の位置にある（端の延長分だけずれない）', () => {
    const g = wallGeometry(plan.walls[0], plan.walls, plan.openings, 2800, floor);
    const pos = g.getAttribute('position');
    const xs = new Set<number>();
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0.55 + 1e-6 && pos.getY(i) < 3.35 - 1e-6) xs.add(Number(pos.getX(i).toFixed(4)));
    // 開口 offset 1000・幅 1820 → 建物座標 x = −4550 + 1000 / +2820
    expect(xs.has(-3.55)).toBe(true);
    expect(xs.has(-1.73)).toBe(true);
  });
  it('本体は薄灰、稜線は濃灰の線', () => {
    const w = children(oneFloor(), 'wall')[0] as Mesh;
    expect((w.material as MeshLambertMaterial).color.getHex()).toBe(0xe6e6e6);
    const edge = w.children[0] as LineSegments;
    expect((edge.material as LineBasicMaterial).color.getHex()).toBe(0x333333);
  });
  it('面が外向き: 壁の外側の面の法線は建物の外を向く', () => {
    const g = wallGeometry(plan.walls[0], plan.walls, [], 2800, floor);
    g.computeVertexNormals();
    const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
    // 壁 a はシーン z ≈ 2.9575（南面）。z が最大の面の法線は +z（外向き）
    let outward = 0, inward = 0;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(nor.getZ(i)) > 0.99 && pos.getZ(i) > 3.0) (nor.getZ(i) > 0 ? outward++ : inward++);
    }
    expect(outward).toBeGreaterThan(0);
    expect(inward).toBe(0);
  });
});

describe('屋根と妻壁', () => {
  const gabled = () => {
    let m = addRoof(oneFloor());
    m = { ...m, roof: { ...m.roof!, inset: [0, 0] } };
    return m;
  };
  const ridgeZ = 3350 + 0.4 * (5915 / 2);
  it('屋根をかけると最高点は棟高、切妻側の壁は棟高まで伸びる', () => {
    const g = buildBuilding(gabled());
    const roof = g.group.children.find((c) => c.name === 'roof') as Mesh;
    expect(box(roof).max.y).toBeCloseTo(ridgeZ / 1000, 3);
    const gableWall = g.group.children.find((c) => c.name === 'wall' && c.userData.wallId === 'd') as Mesh;
    expect(box(gableWall).max.y).toBeCloseTo(ridgeZ / 1000, 3);
    // 平側（壁 a）は He のまま
    const eaveWall = g.group.children.find((c) => c.name === 'wall' && c.userData.wallId === 'a') as Mesh;
    expect(box(eaveWall).max.y).toBeCloseTo(3.35, 6);
  });
  it('妻壁の天端は屋根の上面 h と 1 mm 以内で一致し、切妻側の壁は棟の位置に頂点を持つ', () => {
    const g = buildBuilding(gabled());
    const gableWall = g.group.children.find((c) => c.name === 'wall' && c.userData.wallId === 'd') as Mesh;
    const pos = gableWall.geometry.getAttribute('position');
    let maxErr = 0, apexCount = 0;
    for (let i = 0; i < pos.count; i++) {
      const p = new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(SCENE_TO_MODEL);
      if (p.z <= 3350 + 1e-6) continue;
      maxErr = Math.max(maxErr, Math.abs(p.z - g.roofGeom!.heightAt(p.x, p.y)));
      if (Math.abs(p.z - ridgeZ) < 1e-3) apexCount++;
    }
    expect(maxErr).toBeLessThan(1);
    expect(apexCount).toBeGreaterThan(0);
    // 稜線: 頂点の折れ（2 × 21.8°）は 20° のしきい値で線になる。両端が棟高の線分が 1 本ある
    const edge = gableWall.children[0] as LineSegments;
    const ep = edge.geometry.getAttribute('position');
    let apexEdges = 0;
    for (let i = 0; i < ep.count; i += 2) if (Math.abs(ep.getY(i) - ridgeZ / 1000) < 1e-6 && Math.abs(ep.getY(i + 1) - ridgeZ / 1000) < 1e-6) apexEdges++;
    expect(apexEdges).toBe(1);
  });
  it('寄棟（既定）では外壁の天端は He のまま', () => {
    const m = addRoof(oneFloor());
    const g = buildBuilding(m);
    for (const w of g.group.children.filter((c) => c.name === 'wall')) expect(box(w).max.y).toBeCloseTo(3.35, 6);
    expect(box(g.group.children.find((c) => c.name === 'roof')!).max.y).toBeCloseTo(g.roofGeom!.ridgeZ / 1000, 6);
  });
  it('内壁は屋根があっても H のまま', () => {
    const p = { ...plan, walls: [...plan.walls, wall('i', 0, 2957.5, 9100, 2957.5, false, 120)] };
    let m = addRoof(oneFloor(p));
    m = { ...m, roof: { ...m.roof!, inset: [0, 0] } };
    const inner = buildBuilding(m).group.children.find((c) => c.name === 'wall' && c.userData.wallId === 'i')!;
    expect(box(inner).max.y).toBeCloseTo(3.35, 6);
  });
  it('屋根は厚さ 150 の分だけ下面が下がり、赤線は棟 1 本（切妻）', () => {
    const m = gabled();
    const g = buildBuilding(m);
    const roof = g.group.children.find((c) => c.name === 'roof') as Mesh;
    const eaveBottom = (3350 - 0.4 * 600 - 150) / 1000; // 軒先の裏面
    expect(box(roof).min.y).toBeCloseTo(eaveBottom, 6);
    const lines = g.group.children.find((c) => c.name === 'roofEdge') as LineSegments;
    expect(lines.geometry.getAttribute('position').count).toBe(2);
    expect(box(lines).max.y).toBeCloseTo((ridgeZ + 5) / 1000, 6); // 上面から 5 mm 浮かせる
    expect((lines.material as LineBasicMaterial).color.getHex()).toBe(0xe53935);
    expect((roof.material as MeshLambertMaterial).color.getHex()).toBe(0x3a3a3a);
  });
  it.each(['x', 'y'] as const)('屋根の面は上面が外向き（上面の法線は +y）: 棟 %s 方向', (axis) => {
    let m = addRoof(oneFloor());
    if (m.roof!.axis !== axis) m = rotateRidge(m);
    const g = roofGeometry(buildBuilding(m).roofGeom!, 150);
    const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
    let up = 0, down = 0;
    for (let i = 0; i < pos.count; i++) if (Math.abs(nor.getY(i)) > 0.5) (nor.getY(i) > 0 ? up++ : down++);
    expect(up).toBe(down); // 上面は +y、裏面は −y で同数
    expect(up).toBeGreaterThan(0);
    // 上面（+y）の頂点は裏面（−y）より高い
    const ys = (sign: number) => { const a: number[] = []; for (let i = 0; i < pos.count; i++) if (nor.getY(i) * sign > 0.5) a.push(pos.getY(i)); return a; };
    expect(Math.max(...ys(1))).toBeGreaterThan(Math.max(...ys(-1)));
  });
});

describe('roofGeometry', () => {
  it('時計回りで渡された面でも全ての面の法線が外向き（RoofGeom は面の向きを約束しない）', () => {
    const cw = [{ x: 0, y: 0, z: 3000 }, { x: 0, y: 4000, z: 3000 }, { x: 5000, y: 4000, z: 3000 }, { x: 5000, y: 0, z: 3000 }];
    const rg = { ridgeZ: 3000, ridge: [cw[0], cw[1]] as [typeof cw[0], typeof cw[0]], planes: [cw], edges: [], heightAt: () => 3000 };
    const g = roofGeometry(rg, 150);
    g.computeBoundingBox();
    const center = g.boundingBox!.getCenter(new Vector3());
    const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
    let inward = 0;
    for (let i = 0; i < pos.count; i++) {
      const v = new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).sub(center);
      if (v.dot(new Vector3(nor.getX(i), nor.getY(i), nor.getZ(i))) < 0) inward++;
    }
    expect(inward).toBe(0);
  });
});

describe('階段と吹き抜け', () => {
  const withStair = { ...plan, stairs: [straightStair] };
  it('段は上り順に H × i / N の高さ、最上段は H', () => {
    const g = buildBuilding(oneFloor(withStair));
    const stair = g.group.children.find((c) => c.name === 'stair') as Mesh;
    const b = box(stair);
    expect(b.min.y).toBeCloseTo(0.55, 6);
    expect(b.max.y).toBeCloseTo(3.35, 6);
    // 1 段目（x 小の側）は 2800/12 の高さ
    const pos = stair.geometry.getAttribute('position');
    let firstTop = 0;
    for (let i = 0; i < pos.count; i++) if (pos.getX(i) < -4.55 + 1.0 + 0.3 + 1e-6) firstTop = Math.max(firstTop, pos.getY(i));
    expect(firstTop).toBeCloseTo(0.55 + 2.8 / 12, 6);
  });
  it('ascendPositive = false では x 大の側が 1 段目', () => {
    const st: Stair = { flights: [{ ...straightStair.flights[0], ascendPositive: false }], landings: [] };
    const g = buildBuilding(oneFloor({ ...plan, stairs: [st] }));
    const pos = (g.group.children.find((c) => c.name === 'stair') as Mesh).geometry.getAttribute('position');
    let firstTop = 0;
    for (let i = 0; i < pos.count; i++) if (pos.getX(i) > -4.55 + 4.64 - 0.3 - 1e-6) firstTop = Math.max(firstTop, pos.getY(i));
    expect(firstTop).toBeCloseTo(0.55 + 2.8 / 12, 6);
  });
  it('踊り場は直前の段と同じ高さ、2 本目の flight は続きから上る', () => {
    const st: Stair = {
      flights: [
        { rect: { minX: 1000, minY: 1000, maxX: 2820, maxY: 1910 }, axis: 'x', ascendPositive: true, treads: 6 },
        { rect: { minX: 1000, minY: 1910, maxX: 2820, maxY: 2820 }, axis: 'x', ascendPositive: false, treads: 6 },
      ],
      landings: [{ minX: 2820, minY: 1000, maxX: 3730, maxY: 2820 }],
    };
    const g = buildBuilding(oneFloor({ ...plan, stairs: [st] }));
    const pos = (g.group.children.find((c) => c.name === 'stair') as Mesh).geometry.getAttribute('position');
    let landingTop = 0;
    for (let i = 0; i < pos.count; i++) if (pos.getX(i) > -4.55 + 2.82 + 1e-6) landingTop = Math.max(landingTop, pos.getY(i));
    expect(landingTop).toBeCloseTo(0.55 + 2.8 * 6 / 12, 6);
    expect(box(g.group.children.find((c) => c.name === 'stair')!).max.y).toBeCloseTo(3.35, 6);
  });
  it('2 階の階段が 1 階の階段と 50% 以上重なるとスラブに穴をあけ、段は作らない', () => {
    let m = oneFloor(withStair);
    m = setTopZ(addFloor(m, withStair), 'f2', 6000);
    const g = buildBuilding(m);
    expect(g.group.children.filter((c) => c.name === 'stair')).toHaveLength(1);
    const slabs = g.group.children.filter((c) => c.name === 'slab') as Mesh[];
    expect(slabs[1].geometry.getAttribute('position').count).toBeGreaterThan(slabs[0].geometry.getAttribute('position').count);
    expect(stairwellHoles(m.floors[0], m.floors[1])).toHaveLength(1);
  });
  it('重なりが 50% 未満なら穴をあけず、2 階にも段を作る', () => {
    const shifted: Stair = { flights: [{ ...straightStair.flights[0], rect: { minX: 3000, minY: 1000, maxX: 6640, maxY: 1910 } }], landings: [] };
    let m = oneFloor(withStair);
    m = setTopZ(addFloor(m, { ...plan, stairs: [shifted] }), 'f2', 6000);
    // 重なりは 1640 / 3640 = 45%
    expect(stairwellHoles(m.floors[0], m.floors[1])).toHaveLength(0);
    expect(buildBuilding(m).group.children.filter((c) => c.name === 'stair')).toHaveLength(2);
  });
  it('ちょうど 50% でも穴になる', () => {
    const half: Stair = { flights: [{ ...straightStair.flights[0], rect: { minX: 2820, minY: 1000, maxX: 6460, maxY: 1910 } }], landings: [] };
    let m = oneFloor(withStair);
    m = setTopZ(addFloor(m, { ...plan, stairs: [half] }), 'f2', 6000);
    expect(stairwellHoles(m.floors[0], m.floors[1])).toHaveLength(1);
  });
});

describe('prismGeometry', () => {
  it('穴付きの板は穴無しより頂点が多く、index は付かない', () => {
    const outer = [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 3000 }, { x: 0, y: 3000 }];
    const solid = prismGeometry(outer, 0, 100);
    const holed = prismGeometry(outer, 0, 100, [[{ x: 1000, y: 1000 }, { x: 2000, y: 1000 }, { x: 2000, y: 2000 }, { x: 1000, y: 2000 }]]);
    expect(solid.getIndex()).toBeNull();
    expect(holed.getAttribute('position').count).toBeGreaterThan(solid.getAttribute('position').count);
  });
});

describe('実図面（forest-s 1 階 + 2 階）', () => {
  it('2 階建て + 屋根が組み立てられ、buildBuilding の所要時間を記録する', () => {
    const f1 = recognizePlan(planInBox('fixtures/forest-s/平面立面図.dxf', [5500, 28800, 19800, 39800]));
    const f2 = recognizePlan(planInBox('fixtures/forest-s/平面立面図.dxf', [5500, 15000, 19800, 26000]));
    expect(f1.walls.length).toBeGreaterThan(0);
    expect(f2.walls.length).toBeGreaterThan(0);
    let m = oneFloor(f1, 3350);
    m = setTopZ(addFloor(m, f2), 'f2', 6250);
    m = addRoof(m);
    const runs = 10;
    let g = buildBuilding(m);
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) g = buildBuilding(m);
    const perBuild = (performance.now() - t0) / runs;
    const walls = g.group.children.filter((c) => c.name === 'wall').length;
    console.log(`forest-s 2 階建て: 壁 ${walls} 本, 開口 ${f1.openings.length + f2.openings.length}, buildBuilding ${perBuild.toFixed(1)} ms/回`);
    expect(walls).toBe(f1.walls.length + f2.walls.length);
    expect(box(g.group.children.find((c) => c.name === 'roof')!).max.y).toBeCloseTo(g.roofGeom!.ridgeZ / 1000, 3);
  });
});
