import DxfParser from 'dxf-parser';
import type {
  IArcEntity,
  ICircleEntity,
  IEntity,
  IInsertEntity,
  ILineEntity,
  ILwpolylineEntity,
  IMtextEntity,
  IPoint,
  IPolylineEntity,
  ISplineEntity,
  ITextEntity,
} from 'dxf-parser';
import { bboxOf } from '../model/bbox';
import type { Box2, Plan2D, PlanEntity, Vec2 } from '../model/types';
import { unitScaleFromHeader } from './decode';

/**
 * INSERT の入れ子で積み上がる変換。拡大 → 回転 → 平行移動の順に掛ける。
 *
 * 合成が厳密なのは拡大が一様（sx === sy）のときに限る。非一様な拡大と回転が
 * 混ざると円・弧は楕円になり `PlanEntity` では表現できないので、MVP では扱わない。
 * 非一様スケールに対応するなら、この型を 2x3 行列に置き換え、`apply` と INSERT の
 * 合成をその積にするのが着地点。
 */
interface Xf {
  ox: number;
  oy: number;
  sx: number;
  sy: number;
  rotDeg: number;
}
const IDENTITY: Xf = { ox: 0, oy: 0, sx: 1, sy: 1, rotDeg: 0 };

/** 点に変換を掛ける */
function apply(p: { x: number; y: number }, xf: Xf): Vec2 {
  const rad = (xf.rotDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const x = p.x * xf.sx;
  const y = p.y * xf.sy;
  return { x: xf.ox + x * cos - y * sin, y: xf.oy + x * sin + y * cos };
}

/**
 * 角度を [0, 360) に丸める。
 * 全周の弧（例: 0→360）は 0→0 に潰れて区別が付かなくなるが、実装はこのままとする。
 */
const normalizeDeg = (deg: number): number => ((deg % 360) + 360) % 360;

/** ポリラインの分割数。設計書 §7.1 手順 3「バルジは 8 分割」 */
const BULGE_DIVISIONS = 8;

/**
 * バルジ付きポリラインの 1 区間を線分列にする。設計書 §7.1 手順 3
 *
 * バルジは掃引角の 1/4 の正接で、正なら反時計回り。中心は弦の中点から
 * 左手法線の向きに `(弦長 / 2) / tan(掃引角 / 2)` だけ離れた位置にある。
 * この符号付きの式なら、掃引角が 180 度を超える場合も反時計回りのまま求まる。
 */
function bulgeSegments(a: Vec2, b: Vec2, bulge: number): [Vec2, Vec2][] {
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  if (!bulge || chord === 0) return [[a, b]];
  const sweep = 4 * Math.atan(bulge);
  const offset = chord / 2 / Math.tan(sweep / 2);
  const nx = -(b.y - a.y) / chord;
  const ny = (b.x - a.x) / chord;
  const cx = (a.x + b.x) / 2 + nx * offset;
  const cy = (a.y + b.y) / 2 + ny * offset;
  const radius = Math.hypot(a.x - cx, a.y - cy);
  const startAngle = Math.atan2(a.y - cy, a.x - cx);
  const segments: [Vec2, Vec2][] = [];
  let prev = a;
  for (let i = 1; i <= BULGE_DIVISIONS; i++) {
    // 終端は丸め誤差を残さないよう区間の終点そのものにして、次の区間とつなげる
    const angle = startAngle + (sweep * i) / BULGE_DIVISIONS;
    const next: Vec2 =
      i === BULGE_DIVISIONS ? b : { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
    segments.push([prev, next]);
    prev = next;
  }
  return segments;
}

/**
 * MTEXT の書式コードを落として素の文字列にする。
 * `{\fMS Gothic|b0;和室}\P8畳` → `和室 8畳`
 */
function stripMtextFormat(raw: string): string {
  return raw
    .replace(/\\P/g, ' ') // 段落区切りは空白にする
    .replace(/\\[LlOoKk]/g, '') // 下線・上線・取り消し線の切り替え（引数なし）
    // 引数付きの書式コード（`\fMS Gothic|b0;` など）。`\` を跨がせないのは、
    // 想定外の未終端コードが来たときに巻き込む範囲を狭めるため。ただし有効な MTEXT では
    // 上の 2 つの規則が未終端コードを先に落とすので、`[^;]*` との差は出ない
    .replace(/\\[A-Za-z][^;\\]*;/g, '')
    .replace(/[{}]/g, ''); // 書式をまとめる括弧
}

/**
 * 単位推定に使う図面範囲の長辺。設計書 §7.1 手順 2
 * `$EXTMAX` / `$EXTMIN` があればそれを使い、無い・0 なら全エンティティの外接矩形で代用する。
 * 代用は全件を 1 周するので、そのときだけ評価されるよう関数で受け取る。
 */
function extentLongSide(header: Record<string, IPoint | number>, fallback: () => Box2): number {
  const min = header.$EXTMIN;
  const max = header.$EXTMAX;
  if (typeof min === 'object' && typeof max === 'object') {
    const side = Math.max(max.x - min.x, max.y - min.y);
    if (side > 0) return side;
  }
  const box = fallback();
  return Math.max(box.maxX - box.minX, box.maxY - box.minY);
}

/** dxf-parser の出力を Plan2D に正規化する。設計書 §7.1 手順 3〜5 */
export function parseDxfText(text: string, sourceName: string): Plan2D {
  const dxf = new DxfParser().parseSync(text);
  if (!dxf) throw new Error('DXF を解析できませんでした');
  const layers = dxf.tables?.layer?.layers ?? {};
  /** OFF（色が負）またはフリーズのレイヤーか */
  const isHidden = (name: string | undefined): boolean => {
    const layer = name === undefined ? undefined : layers[name];
    return !!layer && (layer.visible === false || layer.frozen === true);
  };
  const raw: PlanEntity[] = [];

  const visit = (entities: IEntity[], xf: Xf, depth: number): void => {
    for (const e of entities) {
      // エンティティ単位の非表示（群コード 60）はフィクスチャに 1 件も無いため未対応
      if (e.inPaperSpace || isHidden(e.layer)) continue;
      const layer = String(e.layer ?? '0');
      switch (e.type) {
        case 'LINE': {
          const [from, to] = (e as ILineEntity).vertices;
          raw.push({ kind: 'line', layer, a: apply(from, xf), b: apply(to, xf) });
          break;
        }
        case 'LWPOLYLINE':
        case 'POLYLINE': {
          const polyline = e as ILwpolylineEntity | IPolylineEntity;
          const vertices = (polyline.vertices ?? []) as { x: number; y: number; bulge?: number }[];
          // shape = 閉じたポリライン。最後の頂点から先頭へ戻る区間が 1 本増える
          const count = polyline.shape ? vertices.length : vertices.length - 1;
          for (let i = 0; i < count; i++) {
            const from = vertices[i];
            const to = vertices[(i + 1) % vertices.length];
            for (const [p, q] of bulgeSegments(from, to, from.bulge ?? 0)) {
              raw.push({ kind: 'line', layer, a: apply(p, xf), b: apply(q, xf) });
            }
          }
          break;
        }
        case 'ARC': {
          const arc = e as IArcEntity;
          // dxf-parser は弧の角度をラジアンで返すので度に直す（先行検証で実測済み）
          const toDeg = (rad: number) => normalizeDeg((rad * 180) / Math.PI + xf.rotDeg);
          // 半径の絶対値は「負の半径」という無効な値を防ぐための最低限の処置。
          // ミラー配置（負のスケール）では弧の向きが反転して始端と終端が入れ替わるが、
          // フィクスチャに 1 件も無く検証できないため MVP では未対応（弧だけ 180 度ずれる）
          raw.push({
            kind: 'arc',
            layer,
            center: apply(arc.center, xf),
            radius: arc.radius * Math.abs(xf.sx),
            startDeg: toDeg(arc.startAngle),
            endDeg: toDeg(arc.endAngle),
          });
          break;
        }
        case 'CIRCLE': {
          const circle = e as ICircleEntity;
          raw.push({ kind: 'circle', layer, center: apply(circle.center, xf), radius: circle.radius * Math.abs(xf.sx) });
          break;
        }
        case 'TEXT':
        case 'MTEXT': {
          // TEXT と MTEXT は必要な項目（座標・字高・本文）が食い違うだけなので交差型で吸収する。
          // MTEXT の attachmentPoint（文字の基準位置）を扱うことになったら case を分ける
          const entity = e as ITextEntity & IMtextEntity;
          const body = String(entity.text ?? '');
          raw.push({
            kind: 'text',
            layer,
            at: apply(entity.startPoint ?? entity.position, xf),
            text: (e.type === 'MTEXT' ? stripMtextFormat(body) : body).trim(),
            height: (entity.textHeight ?? entity.height ?? 0) * Math.abs(xf.sy),
          });
          break;
        }
        case 'SPLINE': {
          // MVP では制御点を結ぶ折れ線で代用する。SPLINE は装飾線にしか使わない
          const points = (e as ISplineEntity).controlPoints ?? [];
          for (let i = 0; i + 1 < points.length; i++) {
            raw.push({ kind: 'line', layer, a: apply(points[i], xf), b: apply(points[i + 1], xf) });
          }
          break;
        }
        case 'INSERT': {
          if (depth >= 3) break; // 入れ子は 3 段まで
          const insert = e as IInsertEntity;
          const block = dxf.blocks?.[insert.name];
          if (!block?.entities) break;
          const position = insert.position ?? { x: 0, y: 0 };
          const base = block.position ?? { x: 0, y: 0 };
          const sx = insert.xScale ?? 1;
          const sy = insert.yScale ?? 1;
          const rotDeg = insert.rotation ?? 0;
          // ブロックは基点が挿入点に来るように置かれる。基点の分だけ挿入点をずらしておけば、
          // 子の変換は「拡大 → 回転 → 平行移動」の形のまま保てる
          const local = apply(base, { ox: 0, oy: 0, sx, sy, rotDeg });
          const origin = apply({ x: position.x - local.x, y: position.y - local.y }, xf);
          visit(
            block.entities,
            { ox: origin.x, oy: origin.y, sx: sx * xf.sx, sy: sy * xf.sy, rotDeg: rotDeg + xf.rotDeg },
            depth + 1,
          );
          break;
        }
        default:
          break; // DIMENSION / HATCH などは無視する
      }
    }
  };
  visit(dxf.entities ?? [], IDENTITY, 0);

  // 単位を mm に揃える（設計書 §7.1 手順 2）
  const header = dxf.header ?? {};
  const scale = unitScaleFromHeader(header, extentLongSide(header, () => bboxOf(raw)));
  const scaled = scale === 1 ? raw : raw.map((e) => scaleEntity(e, scale));
  // 1 mm 未満の線は捨てる（設計書 §7.1 手順 5）
  const entities = scaled.filter((e) => e.kind !== 'line' || Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y) >= 1);
  return { entities, bbox: bboxOf(entities), sourceName };
}

/** エンティティ全体を原点基準で拡大する */
function scaleEntity(e: PlanEntity, s: number): PlanEntity {
  const v = (p: Vec2): Vec2 => ({ x: p.x * s, y: p.y * s });
  switch (e.kind) {
    case 'line':
      return { ...e, a: v(e.a), b: v(e.b) };
    case 'arc':
      return { ...e, center: v(e.center), radius: e.radius * s };
    case 'circle':
      return { ...e, center: v(e.center), radius: e.radius * s };
    case 'text':
      return { ...e, at: v(e.at), height: e.height * s };
  }
}
