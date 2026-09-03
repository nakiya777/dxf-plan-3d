/**
 * 認識の閾値。設計書 §7.2 の数値をここに集める。単位は mm と度。
 *
 * アルゴリズム側にマジックナンバーを置かないための唯一の置き場。実図面が増えて
 * 調整が要るときは、ここだけを触れば足りる状態を保つ。
 */
export const CFG = {
  /** 平行判定の角度刻み（度）。線分の向きをこの刻みに丸め、同じ値どうしを平行と見なす */
  thetaStepDeg: 0.5,

  band: {
    /** 壁の帯と認める厚さの下限。これ未満は仕上げ線・記号の細い対 */
    minThickness: 60,
    /** 壁の帯と認める厚さの上限。これを超える対は部屋や家具の輪郭 */
    maxThickness: 250,
    /** 対になる 2 線が向き方向に重なる長さの下限 */
    minOverlap: 300,
    /** 周期性の許容（間隔に対する比）。タイル目地・ハッチ・階段踏面を落とす */
    periodicTol: 0.15,
    /** 中央線と認めるずれ（厚さに対する比）。窓・引き戸の記号を分離する */
    centerTol: 0.25,
    /** 中央線と認める重なり長（帯の重なり長に対する比） */
    centerMinOverlap: 0.8,
    /** 入れ子の帯を 1 本にまとめる ρ の重なり（狭い方の厚さに対する比） */
    nestedRhoRatio: 0.5,
  },

  /** 壁レイヤーに数える総延長の下限（最大のレイヤーに対する比） */
  wallLayerRatio: 0.3,
  /** 共線の帯をつなぐ隙間の上限 */
  wallMergeGap: 50,
  /** 共線と見なす壁芯のずれ */
  collinearRhoTol: 20,
  /** 外形と認める最小の面積比（全壁矩形の外接矩形に対する比）。下回れば bbox に落とす */
  outlineMinBboxRatio: 0.3,
  /** 外壁判定で壁面から外へ踏み出す距離。外形の縁との数値誤差を避けるための余白 */
  exteriorProbeMargin: 5,

  opening: {
    maxGap: 2500,
    doorArc: { minDeg: 60, maxDeg: 100, minR: 500, maxR: 1200 },
    doubleArc: { minDeg: 170, maxDeg: 190 },
    door: { sill: 0, head: 2000 },
    window: { sill: 900, head: 2000 },
    slidingWindowMinWidth: 1600,
  },
  stair: {
    minLines: 4,
    minPitch: 200,
    maxPitch: 350,
    pitchTol: 0.1,
    lengthTol: 0.1,
    textDistance: 1000,
    arrowHeadMax: 300,
    flightJoin: 1500,
  },
  axis: { minR: 150, maxR: 400, label: /^([XY]\d+|[A-Z]\d*)$/ },

  /**
   * レイヤー名による短絡判定。Jw_cad 形式では名前に意味が無い（設計書 §7.0）ので、
   * 名前が当たったときだけ形状判定を飛ばす手掛かりとして使う
   */
  layerNames: {
    wall: /壁|WALL|カベ/i,
    centerline: /壁芯|^芯$|CENTER/i,
    fixture: /建具|ドア|DOOR|窓|WINDOW|サッシ/i,
    stair: /階段|STAIR/i,
    axis: /通り芯|GRID|AXIS/i,
  },
} as const;
