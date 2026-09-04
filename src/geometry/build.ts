import {
  BufferGeometry, EdgesGeometry, ExtrudeGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments,
  Matrix4, Mesh, MeshLambertMaterial, Path, Shape, ShapeUtils, Vector2, Vector3,
} from 'three';
import { topFloorRect } from '../model/building';
import { solveRoof, type RoofGeom } from '../model/roof';
import type { Box2, BuildingModel, FloorBlock, Opening, PlanEntity, Polygon, Stair, Vec2, Wall } from '../model/types';
import { MODEL_TO_SCENE } from './coords';
import { buildWallProfile } from './wallShape';

/**
 * 材質（設計書 §8.2・§8.4・§8.1）。本体（壁・板・基礎・階段）はほぼ白、稜線は濃灰、飾り線は青、屋根は濃灰、屋根編集線は赤。
 * 既定は通常表示（本体は不透明、線は深度検査あり）。「壁を透かす」ON では `viewer/seeThroughStyle` の
 * `applySeeThroughStyle` がこの共有材質の `transparent` `opacity` `depthTest` を一括で書き換える（材質の実体は差し替えない）
 */
export const MATERIALS = {
  body: new MeshLambertMaterial({ color: 0xf4f4f4 }),
  roof: new MeshLambertMaterial({ color: 0x3a3a3a }),
  edge: new LineBasicMaterial({ color: 0x1a1a1a }),
  decor: new LineBasicMaterial({ color: 0x3b7dd8 }),
  roofEdge: new LineBasicMaterial({ color: 0xe53935 }),
};

/**
 * 描画順。本体 → 線 → 屋根 → 屋根の赤線。通常表示（全部が不透明パス・深度検査あり）では効かず、「壁を透かす」ON のときだけ意味を持つ。
 * 本体は `depthWrite` を残したまま three.js の既定（奥から手前）で並べ、線はその後に `depthTest` 無しで重ねる。
 * 屋根は線の後に深度検査ありで描くので、屋根に隠れる壁の稜線は屋根が塗り潰し、屋根の上に線が浮かない。
 * 赤線は屋根の後。屋根の裏側の隅棟が透けて浮かないよう、赤線だけは `depthTest` を残す（上面から 5 mm 浮かせてあるので屋根には隠れない）
 */
export const RENDER_ORDER = { body: 0, line: 10, roof: 20, roofEdge: 30 } as const;

/** `EdgesGeometry` のしきい値（§8.2: 20°） */
const EDGE_THRESHOLD_DEG = 20;
/** 飾り線を床面から浮かせる高さ（§8.1: baseZ + 2 mm）。板の上面と重なってちらつくのを避ける */
const DECOR_LIFT = 2;
/** 屋根の赤線を上面から浮かせる高さ。同上 */
const ROOF_EDGE_LIFT = 5;
/** 通り芯バブルの半径（§2.3 の動画の見た目に合わせた値）[推定] */
const AXIS_BUBBLE_RADIUS = 250;
/** 弧・円を折れ線にするときの分割数 */
const ARC_SEGMENTS = 16;
/** 吹き抜けとみなす階段矩形の重なり率（§8.3: 50%） */
const STAIRWELL_OVERLAP = 0.5;
/** 壁端が別の壁に接続しているとみなす許容差（mm） */
const WALL_JOIN_TOLERANCE = 1;
/**
 * 壁の天端を屋根で切るとき、壁厚方向（壁芯 ±厚さ/2 の帯）をサンプルする点数（§8.6）。
 * 両端（外面・内面）と壁芯を必ず含むよう奇数にする
 */
const WALL_BAND_SAMPLES = 5;

export interface BuiltBuilding { group: Group; roofGeom?: RoofGeom }

/** 壁 Mesh の `userData`。壁芯は建物座標（mm、階の offset 込み） */
export interface WallUserData { wallId: string; a: Vec2; b: Vec2; exterior: boolean }

/**
 * BuildingModel → three.js の Group。毎回すべて作り直す（設計書 §4.2）。
 * 子の `name` は foundation / slab / wall / stair / decor / roof / roofEdge。
 * 壁は `userData` に `wallId`・壁芯の両端 `a` `b`（建物座標 mm、階の offset 込み）・`exterior` を持つ（`WallUserData`）。
 * viewer 側の「壁を透かす」がこれで外向き法線を出す
 */
export function buildBuilding(model: BuildingModel): BuiltBuilding {
  const group = new Group();
  const top = model.floors[model.floors.length - 1];
  const roofGeom = model.roof && top ? solveRoof(model.roof, topFloorRect(model), top.topZ) : undefined;

  model.floors.forEach((floor, i) => buildFloor(group, model, floor, i, top, roofGeom));

  if (roofGeom && model.roof) buildRoof(group, roofGeom, model.roof.thickness);
  return { group, roofGeom };
}

/** 1 階分の基礎・スラブ・壁・階段・飾り線・通り芯バブルを組み立てる */
function buildFloor(group: Group, model: BuildingModel, floor: FloorBlock, index: number, top: FloorBlock | undefined, roofGeom?: RoofGeom): void {
  const outline = floor.plan.outline.map((p) => shiftPoint(p, floor.offset));
  const slabHoles = index > 0 ? stairwellHoles(model.floors[index - 1], floor) : [];
  if (outline.length > 0) {
    const slabBottom = floor.baseZ - model.slabThickness;
    // 1 階は板の下に GL から基礎を描く（§8.1）
    if (index === 0 && slabBottom > 0) group.add(named(solidMesh(prismGeometry(outline, 0, slabBottom)), 'foundation'));
    group.add(named(solidMesh(prismGeometry(outline, slabBottom, floor.baseZ, slabHoles.map((h) => h.poly))), 'slab'));
  }
  const H = floor.topZ - floor.baseZ;
  for (const w of floor.plan.walls) {
    const useRoof = roofGeom !== undefined && floor === top && w.exterior;
    const mesh = solidMesh(wallGeometry(w, floor.plan.walls, floor.plan.openings.filter((o) => o.wallId === w.id), H, floor, useRoof ? roofGeom : undefined));
    const wallData: WallUserData = { wallId: w.id, a: shiftPoint(w.a, floor.offset), b: shiftPoint(w.b, floor.offset), exterior: w.exterior };
    mesh.userData = wallData;
    group.add(named(mesh, 'wall'));
  }
  const holeSet = new Set(slabHoles.map((h) => h.stairIndex));
  floor.plan.stairs.forEach((st, k) => {
    if (!holeSet.has(k)) group.add(named(solidMesh(stairGeometry(st, floor, H)), 'stair'));
  });
  group.add(named(decorLines(floor.plan.decorLines, floor, floor.baseZ + DECOR_LIFT), 'decor'));
  group.add(named(axisBubbles(floor), 'decor'));
}

/** 屋根本体と屋根の赤い編集線を組み立てる */
function buildRoof(group: Group, roofGeom: RoofGeom, thickness: number): void {
  const roofMesh = named(new Mesh(roofGeometry(roofGeom, thickness), MATERIALS.roof), 'roof');
  roofMesh.renderOrder = RENDER_ORDER.roof;
  group.add(roofMesh);
  const lifted = roofGeom.edges.map(([a, b]): [number[], number[]] => [[a.x, a.y, a.z + ROOF_EDGE_LIFT], [b.x, b.y, b.z + ROOF_EDGE_LIFT]]);
  const roofLines = named(segmentsToLines(lifted, MATERIALS.roofEdge), 'roofEdge');
  roofLines.renderOrder = RENDER_ORDER.roofEdge;
  group.add(roofLines);
}

/**
 * `buildBuilding` が作った Group を捨てる。ジオメトリだけ捨て、`MATERIALS` は共有なので触らない。
 * 稜線の `LineSegments` は Mesh の子なので `traverse` で辿る
 */
export function disposeBuilding(group: Group): void {
  group.traverse((o) => { if (o instanceof Mesh || o instanceof LineSegments) o.geometry.dispose(); });
}

const named = <T extends { name: string }>(o: T, name: string): T => { o.name = name; return o; };
const shiftPoint = (p: Vec2, o: Vec2): Vec2 => ({ x: p.x + o.x, y: p.y + o.y });
const wallLength = (w: Wall) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
const boxPolygon = (b: Box2): Polygon => [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY }, { x: b.maxX, y: b.maxY }, { x: b.minX, y: b.maxY }];

/** 本体メッシュ + 稜線（§8.2） */
function solidMesh(geometry: BufferGeometry, material = MATERIALS.body): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.renderOrder = RENDER_ORDER.body;
  const edges = new LineSegments(new EdgesGeometry(geometry, EDGE_THRESHOLD_DEG), MATERIALS.edge);
  edges.renderOrder = RENDER_ORDER.line;
  mesh.add(edges);
  return mesh;
}

/** 多角形を z0 〜 z1 に押し出す。穴（吹き抜け）も掛けられる。返すジオメトリはシーン座標 */
export function prismGeometry(outline: Polygon, z0: number, z1: number, holes: Polygon[] = []): BufferGeometry {
  const shape = new Shape(outline.map((p) => new Vector2(p.x, p.y)));
  for (const h of holes) shape.holes.push(new Path(h.map((p) => new Vector2(p.x, p.y))));
  const g = new ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false });
  g.applyMatrix4(MODEL_TO_SCENE.clone().multiply(new Matrix4().makeTranslation(0, 0, z0)));
  return g;
}

/** 点から線分までの距離 */
function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** 壁端の延長量: 端点が乗っている接続先の壁の厚さ / 2（§8.2）。接続先が無ければ 0 */
function endExtension(end: Vec2, self: Wall, walls: Wall[]): number {
  let ext = 0;
  for (const other of walls) {
    if (other === self) continue;
    if (distanceToSegment(end, other.a, other.b) <= other.thickness / 2 + WALL_JOIN_TOLERANCE) ext = Math.max(ext, other.thickness / 2);
  }
  return ext;
}

/** 壁が占める帯を刻む、壁芯からのオフセット（−厚さ/2 〜 +厚さ/2、両端を含む） */
function bandOffsets(thickness: number): number[] {
  const n = WALL_BAND_SAMPLES - 1;
  return Array.from({ length: WALL_BAND_SAMPLES }, (_, i) => thickness * (i / n - 0.5));
}

/** 線分 a→b と線分 c→d の交点のパラメータ t（a→b 上、0〜1）。平行なら undefined */
function segmentIntersectionParam(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number | undefined {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-9) return undefined;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denom;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : undefined;
}

/**
 * 壁: 局所 (s, z) の輪郭を法線方向に厚さ分押し出し、壁芯が中心に来るよう置く。
 * 壁端は接続先の壁厚 / 2 だけ延長し、開口の offset もその分ずらす。
 *
 * `roofGeom` を渡すと天端を屋根面で切る（§8.6）。壁には厚みがあるので壁芯 1 点では足りず、
 * その s で壁が占める帯（壁芯 ±厚さ/2）にわたる屋根上面の最小値を天端にする。
 * 帯を 1 点で近似すると、軒側では壁の外面のほうが屋根が低いぶんだけ壁が屋根を突き抜ける
 * （勾配 4 寸・壁厚 150 で 30 mm）。妻壁が三角に伸びるのも同じ式（帯の最小値が H を超える）で出る。
 *
 * `heightAt` は屋根面の min なので (x, y) について凹関数。帯の最小値は端（外面・内面）で取り、
 * サンプル間を直線で結んでも屋根を越えない。s 方向は 100 mm 刻みに加えて棟・隅棟の投影との交点を打つ。
 * 面が切り替わる s は帯の縁ごとに違うので、交点は帯の各縁で求める（打たないと勾配が変わる箇所で天端が直線で結ばれて食い込む）
 */
export function wallGeometry(w: Wall, walls: Wall[], openings: Opening[], H: number, floor: FloorBlock, roofGeom?: RoofGeom): BufferGeometry {
  const L = wallLength(w);
  const ux = (w.b.x - w.a.x) / L, uy = (w.b.y - w.a.y) / L;
  // 局所 X = 壁方向 u、局所 Y = モデル Z（床上面 baseZ 起点）、局所 Z = 法線 n。右手系になる向きに n を取る（裏返ると面が内向きになる）
  const nx = uy, ny = -ux;
  const ext0 = endExtension(w.a, w, walls), ext1 = endExtension(w.b, w, walls);
  const a = shiftPoint(w.a, floor.offset), b = shiftPoint(w.b, floor.offset);

  let topProfile: ((s: number) => number) | undefined;
  let sampleAt: number[] = [];
  if (roofGeom) {
    const offsets = bandOffsets(w.thickness);
    topProfile = (s) => {
      const cx = a.x + ux * (s - ext0), cy = a.y + uy * (s - ext0);
      let z = Infinity;
      for (const d of offsets) z = Math.min(z, roofGeom.heightAt(cx + nx * d, cy + ny * d));
      return z - floor.baseZ;
    };
    // 交点は延長ぶんも含む壁の全長で取る（角では延長した側が屋根の低いほうに出るため）
    const total = L + ext0 + ext1;
    const from = { x: a.x - ux * ext0, y: a.y - uy * ext0 };
    const to = { x: b.x + ux * ext1, y: b.y + uy * ext1 };
    sampleAt = offsets.flatMap((d) => roofGeom.edges
      .map(([p, q]) => segmentIntersectionParam(
        { x: from.x + nx * d, y: from.y + ny * d }, { x: to.x + nx * d, y: to.y + ny * d },
        { x: p.x, y: p.y }, { x: q.x, y: q.y },
      ))
      .filter((t): t is number => t !== undefined)
      .map((t) => t * total));
  }
  const shifted = openings.map((o) => ({ ...o, offset: o.offset + ext0 }));
  const profile = buildWallProfile(L + ext0 + ext1, H, shifted, topProfile, sampleAt);
  const shape = new Shape(profile.outline.map((q) => new Vector2(q.s, q.z)));
  for (const h of profile.holes) shape.holes.push(new Path(h.map((q) => new Vector2(q.s, q.z))));
  const g = new ExtrudeGeometry(shape, { depth: w.thickness, bevelEnabled: false });
  const half = w.thickness / 2;
  const ox = a.x - ux * ext0 - nx * half, oy = a.y - uy * ext0 - ny * half;
  const local = new Matrix4().set(
    ux, 0, nx, ox,
    uy, 0, ny, oy,
    0, 1, 0, floor.baseZ,
    0, 0, 0, 1,
  );
  g.applyMatrix4(MODEL_TO_SCENE.clone().multiply(local));
  return g;
}

/**
 * 階段（§8.3）: 全 flights の踏面数の合計を N とし、上り順に i 段目を高さ H × i / N の直方体にする。
 * 踊り場は直前の段と同じ高さ。段ごとの直方体を 1 つのジオメトリにまとめる
 */
export function stairGeometry(st: Stair, floor: FloorBlock, H: number): BufferGeometry {
  const N = st.flights.reduce((n, f) => n + f.treads, 0);
  const boxes: Box2[] = [];
  const heights: number[] = [];
  let step = 0;
  st.flights.forEach((f, k) => {
    const { rect, axis, ascendPositive, treads } = f;
    const lo0 = axis === 'x' ? rect.minX : rect.minY;
    const span = (axis === 'x' ? rect.maxX : rect.maxY) - lo0;
    for (let t = 0; t < treads; t++) {
      const index = ascendPositive ? t : treads - 1 - t;
      const lo = lo0 + (span * index) / treads, hi = lo + span / treads;
      boxes.push(axis === 'x' ? { ...rect, minX: lo, maxX: hi } : { ...rect, minY: lo, maxY: hi });
      step++;
      heights.push((H * step) / N);
    }
    const landing = st.landings[k];
    if (landing) { boxes.push(landing); heights.push((H * step) / N); }
  });
  const parts = boxes.map((box, k) => prismGeometry(boxPolygon(box).map((p) => shiftPoint(p, floor.offset)), floor.baseZ, floor.baseZ + heights[k]));
  return mergeGeometries(parts);
}

const unionBox = (bs: Box2[]): Box2 =>
  bs.reduce((a, b) => ({ minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) }));
const shiftBox = (b: Box2, o: Vec2): Box2 => ({ minX: b.minX + o.x, minY: b.minY + o.y, maxX: b.maxX + o.x, maxY: b.maxY + o.y });
const area = (b: Box2) => Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY);
const intersectBox = (a: Box2, b: Box2): Box2 =>
  ({ minX: Math.max(a.minX, b.minX), minY: Math.max(a.minY, b.minY), maxX: Math.min(a.maxX, b.maxX), maxY: Math.min(a.maxY, b.maxY) });

/**
 * 吹き抜け（§8.3）: 直下の階の階段と 50% 以上重なる階段は、段を作らずスラブに穴をあける。
 * 穴の多角形は建物座標
 */
export function stairwellHoles(below: FloorBlock, floor: FloorBlock): { stairIndex: number; poly: Polygon }[] {
  const out: { stairIndex: number; poly: Polygon }[] = [];
  const belowBoxes = below.plan.stairs.map((st) => shiftBox(unionBox(st.flights.map((f) => f.rect)), below.offset));
  floor.plan.stairs.forEach((st, stairIndex) => {
    const box = shiftBox(unionBox(st.flights.map((f) => f.rect)), floor.offset);
    if (belowBoxes.some((b) => area(intersectBox(box, b)) >= STAIRWELL_OVERLAP * area(box))) out.push({ stairIndex, poly: boxPolygon(box) });
  });
  return out;
}

/** 三角形 (a, b, c) を頂点配列に積む */
function pushTriangle(pos: number[], a: Vector3, b: Vector3, c: Vector3): void {
  pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
}

/**
 * 屋根（§8.4）: 各面の上面 + 鉛直に thickness 下げた裏面 + 側面。XY に投影して三角形分割する。
 * 面は上から見て反時計回りに揃え、上面が外向き（+Z）になるようにする
 */
export function roofGeometry(rg: RoofGeom, thickness: number): BufferGeometry {
  const pos: number[] = [];
  for (const plane of rg.planes) {
    const contour = plane.map((p) => new Vector2(p.x, p.y));
    // RoofGeom は面の頂点順を約束しないので、ここで反時計回りに揃える
    const poly = ShapeUtils.isClockWise(contour) ? [...plane].reverse() : plane;
    const top = poly.map((p) => new Vector3(p.x, p.y, p.z));
    const bottom = poly.map((p) => new Vector3(p.x, p.y, p.z - thickness));
    const faces = ShapeUtils.triangulateShape(poly.map((p) => new Vector2(p.x, p.y)), []);
    for (const [a, b, c] of faces) {
      pushTriangle(pos, top[a], top[b], top[c]);
      pushTriangle(pos, bottom[c], bottom[b], bottom[a]);
    }
    for (let i = 0; i < poly.length; i++) {
      const j = (i + 1) % poly.length;
      pushTriangle(pos, top[i], bottom[i], top[j]);
      pushTriangle(pos, top[j], bottom[i], bottom[j]);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  g.applyMatrix4(MODEL_TO_SCENE);
  return g;
}

/** 平面図の線・弧・円を高さ z（モデル座標）に青線で描く（§8.1） */
export function decorLines(entities: PlanEntity[], floor: FloorBlock, z: number): LineSegments {
  const segs: [number[], number[]][] = [];
  const o = floor.offset;
  for (const e of entities) {
    if (e.kind === 'line') {
      segs.push([[e.a.x + o.x, e.a.y + o.y, z], [e.b.x + o.x, e.b.y + o.y, z]]);
    } else if (e.kind === 'arc' || e.kind === 'circle') {
      const startDeg = e.kind === 'arc' ? e.startDeg : 0;
      const endDeg = e.kind === 'arc' ? (e.endDeg <= e.startDeg ? e.endDeg + 360 : e.endDeg) : 360;
      const at = (i: number) => {
        const rad = ((startDeg + ((endDeg - startDeg) * i) / ARC_SEGMENTS) * Math.PI) / 180;
        return [e.center.x + o.x + e.radius * Math.cos(rad), e.center.y + o.y + e.radius * Math.sin(rad), z];
      };
      for (let i = 0; i < ARC_SEGMENTS; i++) segs.push([at(i), at(i + 1)]);
    }
  }
  return segmentsToLines(segs, MATERIALS.decor);
}

/** 通り芯のバブル（円）を床面の高さに描く（§8.1） */
function axisBubbles(floor: FloorBlock): LineSegments {
  const circles: PlanEntity[] = floor.plan.axes.map((a) => ({ kind: 'circle', layer: 'axis', center: a.bubble, radius: AXIS_BUBBLE_RADIUS }));
  return decorLines(circles, floor, floor.baseZ + DECOR_LIFT);
}

/** モデル座標の線分列 → シーン座標の LineSegments */
function segmentsToLines(segs: [number[], number[]][], material: LineBasicMaterial): LineSegments {
  const pos: number[] = [];
  for (const [a, b] of segs) pos.push(...a, ...b);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.applyMatrix4(MODEL_TO_SCENE);
  const lines = new LineSegments(g, material);
  lines.renderOrder = RENDER_ORDER.line;
  return lines;
}

/** 複数の非インデックスジオメトリを 1 つにまとめる。`ExtrudeGeometry` の出力には index が付かないので、それだけを扱う */
function mergeGeometries(parts: BufferGeometry[]): BufferGeometry {
  const pos: number[] = [];
  for (const p of parts) {
    const attr = p.getAttribute('position');
    for (let i = 0; i < attr.count; i++) pos.push(attr.getX(i), attr.getY(i), attr.getZ(i));
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
