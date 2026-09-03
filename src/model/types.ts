/** 2D ベクトル（mm） */
export interface Vec2 { x: number; y: number }
/** 軸平行の矩形（mm） */
export interface Box2 { minX: number; minY: number; maxX: number; maxY: number }
/** 多角形。閉じない（末尾と先頭を結ぶ） */
export type Polygon = Vec2[];

/** DXF から取り出した 2D エンティティ（mm、モデル空間のみ） */
export type PlanEntity =
  | { kind: 'line'; layer: string; a: Vec2; b: Vec2 }
  | { kind: 'arc'; layer: string; center: Vec2; radius: number; startDeg: number; endDeg: number }
  | { kind: 'circle'; layer: string; center: Vec2; radius: number }
  | { kind: 'text'; layer: string; at: Vec2; text: string; height: number };

/** 範囲選択で切り出した 1 枚の平面図 */
export interface Plan2D { entities: PlanEntity[]; bbox: Box2; sourceName: string }

export interface Wall { id: string; a: Vec2; b: Vec2; thickness: number; exterior: boolean }
export interface Opening {
  wallId: string; offset: number; width: number; type: 'door' | 'window';
  sill: number; head: number;   // 床からの高さ mm
}
export interface Flight { rect: Box2; axis: 'x' | 'y'; ascendPositive: boolean; treads: number }
export interface Stair { flights: Flight[]; landings: Box2[] }
export interface GridAxis { label: string; a: Vec2; b: Vec2; bubble: Vec2 }
export interface PlanModel {
  walls: Wall[]; openings: Opening[]; stairs: Stair[]; axes: GridAxis[];
  outline: Polygon;            // 外壁帯の和集合の外周
  decorLines: PlanEntity[];    // 認識外の線・弧
  warnings: string[];          // 「壁を認識できませんでした」など。パネルに 1 行出す
}

export interface FloorBlock {
  id: string; level: number; plan: PlanModel;
  offset: Vec2; baseZ: number; topZ: number;
}
export interface Roof {
  axis: 'x' | 'y'; ridgeOffset: number; inset: [number, number];
  pitchSun: number; eave: number; verge: number; thickness: number;
}
export interface BuildingModel {
  floor1Level: number; slabThickness: number; floors: FloorBlock[]; roof?: Roof;
}
