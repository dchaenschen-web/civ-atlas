/**
 * 世界生成总流程。纯函数:同样的参数 → 同样的世界。
 *
 *   网格 → 板块 → 地壳抬升 → 河流侵蚀(中途按新地形重算一次降雨)
 *   → 换算成米(加上高原底座,底座顺水系让路)→ 湖泊 → 最终气候 → 水系 / 河流 → 生物群落
 *
 * 作者改过地形(阶段 4,terrain = WorldEdits.terrain)时,修改在对应的那一步套上(gen/terrainEdits.ts):
 * 火山、山脉、抬起 / 沉下在侵蚀之前改抬升场和海陆,湖在"随机洼地"那一步挖;之后照常侵蚀、排水、算气候。
 * 作者画过草图(新建世界时「画大陆和海」,sketch = gen/sketch.ts 的 sketchGrid 涂成的格子图)时,在板块定海陆那一步照草图改
 * (tectonics.ts 的 4b 步),山地格加抬升;草图里改过板块(plates)的,在板块那一步套上(tectonics.ts 的 2b 步);地形修改再套在草图长出来的星球上。
 * 改过地形的世界换算成米时远处照没改地形的同一颗星球(planetOf),改一处不把别处的山压矮。
 * 没有地形修改、没有草图时结果逐字节不变。
 */
import type { ReaderVersions } from './readers/versions';
import { blurField, buildMesh, type Mesh } from './mesh';
import { buildTectonics, type Tectonics } from './tectonics';
import { erodeSteps, drainage, accumulate } from './erosion';
import { computeClimate, type ClimateParams } from './climate';
import { Biome, classifyBiome } from './biomes';
import { WETLAND_CUT, wetlandSuitability } from './wetland';
import { computeSeaIce } from './seaice';
import { mulberry32, subSeed, clamp, keyed, smoothstep } from './util';
import { geometryOf, sphereSpacing } from './geometry';
import type { TerrainOp } from './edits';
import { computeCurrents, type Currents } from './currents';
import { generateAstro, climateModsOf, type AstroSystem } from './astro';
import type { SystemOverrides } from './astroDesign';
import {
  DEL_WATER_FLUX,
  TERRAIN_MAX_OPS,
  UPHEAVALS_MAX,
  UPHEAVAL_OPS_MAX,
  applyClimatePens,
  applyHeightPens,
  applyTerrainTectonics,
  carveLakes,
  carveRivers,
  cleanTerrainOps,
  isHeightKind,
  lakeAt,
  riverCells,
  riversAt,
  volcanoPeaks,
} from './terrainEdits';
import { applyIceSheets, carveRifts, smoothRelief, stampCraters } from './surfaceShapes';
import type { SurfaceSkin } from './surfaceKinds';
import { sketchUsed, type Sketch } from './sketch';
import { samePlates } from './plateEdits';
import { DEFAULT_PARAMS, type WorldParams } from './params';

// 生成参数和默认值在 params.ts(存档、网址只用到它们,不用带上整套生成代码)
export { DEFAULT_PARAMS, type WorldParams } from './params';

/** 海拔 60 米以上的陆地块成为小洼地(小湖)中心的机会(大陆内部平缓以后天然的洼地少了,机会和大小都比以前大一些) */
const DENT_P = 1 / 600;

/** 湖中心不超过这么多块(36000 块时;按地块数比例换算)、周围全是湖水的陆地,淹成湖 */
const LAKE_ISLET = 6;

/** 草图只补细节 / 完全照画时"最高峰"下限里普通世界高山的抬升:REF_FLOOR_U + REF_FLOOR_MTN_U × 山地参数(和 tectonics.ts 里碰撞带的山同一量级) */
const REF_FLOOR_U = 0.13;
const REF_FLOOR_MTN_U = 1.65;
/** 草图涂过的地方换算成米的比例往外过渡几圈(growTerrain 的 blend):几圈以外和没画草图的同一颗星球一样 */
const BLEND_PASSES = 4;

/** 年均温低于这个(°C)的陆地是冰盖(和 biomes.ts 的冰原同一条线):雪不化成河 */
export const ICE_SHEET_T = -9;
/** 冰盖每块的径流(米/年):只有一点融水,整片冰盖汇起来也成不了大河 */
const ICE_RUNOFF = 0.004;

export const MAP_W = 2048;
export const MAP_H = 1024;

export interface River {
  /** 顶点坐标与该点流量(交错存:x,y,flux,...) */
  pts: Float32Array;
  /**
   * 河道经过的地块链,和 pts 的点一一对应(从源头到入海 / 入湖处)。
   * 链的头 / 尾是湖 / 海地块时,那个点是它和链上相邻地块的中点(入湖口 / 入海口),其余点是地块中心。
   * 画在任何投影上都按这条链取点(主图上的 x、y 跨 180° 经线时会跳到另一边)
   */
  cells: Int32Array;
  /**
   * 作者画的河(改地形的 `river`)经过的点:画笔的半宽(世界坐标,取整),0 = 这一点不是画的;没有画的河经过 = 不给。
   * 只给地图显示用(画的河全图也画得出来,见 render/common.ts 的 shownRivers),不进推演
   */
  drawn?: Uint8Array;
}

export interface World {
  /**
   * 读这个世界用第几版读取代码(gen/readers/)。只有存下来再读出来的世界带,跟着世界送到各个后台线程,线程按它取代码;
   * 没有 = 这一版软件刚算的,用当前版本。不进存档、世界文件
   */
  readers?: ReaderVersions;
  params: WorldParams;
  /**
   * 这颗星球所在的星球系(恒星、各行星、卫星、大气、星图):只在 params.astro = 1 时有。
   * **派生数据**:世界文件不存它(存的时候去掉),读回来按 params 重算(gen/astro.ts 的 astroOf)。
   * 纯计算、确定性,和地形 / 历史的随机流互不影响
   */
  astro?: AstroSystem;
  /** 逐行星/卫星覆盖表(星系结构编辑的结果):派生来源;世界文件不存它(存进 system 块),读回来挂上 */
  system?: SystemOverrides;
  width: number;
  height: number;
  climate: ClimateParams;
  mesh: Mesh;
  tect: Tectonics;
  /** 海拔(米)。陆地正,海洋负 */
  elevation: Float32Array;
  /** 0 陆地 / 1 海洋 / 2 湖泊 */
  water: Uint8Array;
  /** 湖面高度(米),仅湖泊 cell 有意义 */
  waterLevel: Float32Array;
  temperature: Float32Array;
  precipitation: Float32Array;
  /** 海冰程度(每个地块 0–1):0 开阔水面,1 整片冰盖;陆地、湖泊为 0 */
  seaIce: Float32Array;
  /** 洋流:水温偏差和表层流向(见 currents.ts) */
  currents: Currents;
  biome: Uint8Array;
  /** 径流量(累计,单位 ≈ 地块 × 米/年) */
  flux: Float32Array;
  riverThreshold: number;
  rivers: River[];
  /** 侵蚀过程快照(米),用于"看世界长出来"回放 */
  history: Float32Array[];
  /**
   * 最高海拔(米),山名、山峰符号的门槛按它定:陆地的最高处;改过地形、画了草图的世界(草图改了板块的除外)
   * 照没改地形的同一颗星球的,在一处堆高、把最高的山压平都不改别处的门槛
   */
  maxElevation: number;
  /** 作者放的火山(阶段 4 改地形):每座的峰顶地块,手绘风画火山符号;没有 = 空 */
  volcanoes: number[];
  /**
   * 生成时套上的地形修改(清理过,按先后);没改地形 = 不给。
   * 推文明时看它:改过地形的世界,扩张节拍按没改地形时的同一颗星球定(gen/civ/index.ts 的 planetTempo)
   */
  terrain?: TerrainOp[];
  /** 生成时照着的草图格子图(gen/sketch.ts 的 sketchGrid);没画 = 不给。草图算星球的一部分:planetTempo 也照它生成 */
  sketch?: Sketch;
}

export type Progress = (stage: string, pct: number) => void;

/**
 * 生成到"随机洼地"为止的那一半(网格、板块、造山侵蚀,最慢的一段)。只由参数、草图、侵蚀之前套上的几种地形修改
 * (火山、山脉、抬起陆地、沉成海)定:编辑地形时只加了湖、河、气候笔、高度笔,这一半一点不变。
 * BaseCache 记着上一次的这一半,键对得上就直接接着算后一半(结果和从头生成逐位相同;后一半只在副本上改)
 */
export interface TerrainBase {
  /** 参数 + 侵蚀之前套上的地形修改 */
  key: string;
  /** 草图(格子图复制一份比内容) */
  sketch: Sketch | null;
  mesh: Mesh;
  tect: Tectonics;
  /** 随机洼地挖完的海拔(米);后一半在副本上接着改 */
  elevation: Float32Array;
  history: Float32Array[];
  /** 侵蚀之前改过的地块(applyTerrainTectonics 的 touched) */
  touched: Uint8Array | null;
  /**
   * 陆地最高处(米):改过地形的世界(侵蚀之前的地形修改、草图;草图改了板块的除外)= 没改地形的同一颗星球的(planetOf),
   * 不然 = 这一半自己的。改过地形、只用了高度笔的世界的最高海拔(World.maxElevation)照它
   */
  peak: number;
  /** 海拔 60 米以上的陆地块数(太大的湖按它定) */
  highLand: number;
  /** 侵蚀高度换算成米时每一次用的"最高峰"(按先后;没改地形的世界记下的给改过地形的同一颗星球用,见 planetOf) */
  refs: number[];
}
/** 记着上一次生成的前一半(worker 里一个世界一份) */
export interface BaseCache {
  base: TerrainBase | null;
}

/** 侵蚀之前套上的几种地形修改(火山、山脉、抬起陆地、沉成海):前一半只看它们 */
const isShapeOp = (o: TerrainOp) => o.kind === 'volcano' || o.kind === 'range' || o.kind === 'raise' || o.kind === 'sink';
const baseKeyOf = (p: WorldParams, shapes: readonly TerrainOp[]) => JSON.stringify([Object.entries(p).sort(([a], [b]) => (a < b ? -1 : 1)), shapes]);
const sameSketchGrid = (a: Sketch | null, b: Sketch | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.coast === b.coast &&
    a.fill === b.fill &&
    a.noNewLand === b.noNewLand &&
    samePlates(a.plates, b.plates) &&
    a.grid.length === b.grid.length &&
    a.grid.every((v, i) => v === b.grid[i]));

/** 没改地形的星球:换算成米用的"最高峰"(TerrainBase.refs)、陆地最高处(TerrainBase.peak) */
interface Planet {
  refs: number[];
  peak: number;
}
/** 按参数记最近几颗(planetOf) */
const planetMemo = new Map<string, Planet>();
const PLANET_MEMO = 4;

/** 陆地最高处(米;没有陆地 = 0) */
function landPeak(land: Uint8Array, elevation: Float32Array): number {
  let m = 0;
  for (let i = 0; i < land.length; i++) if (land[i] && elevation[i] > m) m = elevation[i];
  return m;
}

/**
 * 同样的参数、没改地形(没有地形修改、没画草图)的那颗星球:侵蚀高度换算成米时每一次用的"最高峰"(TerrainBase.refs)、
 * 陆地最高处。改过地形的世界远处照它换算(growTerrain),和这颗星球逐位一样高,最高海拔也照它;
 * 按参数记着,编辑地形时涂第二笔起不再重算。mesh = 改过地形的世界已经撒好的地块(同样的参数撒出来的一样,省得再撒一遍)
 */
function* planetOf(p: WorldParams, mesh: Mesh, climateP: ClimateParams): Generator<void, Planet> {
  const key = baseKeyOf(p, []);
  let planet = planetMemo.get(key);
  if (planet) {
    planetMemo.delete(key);
  } else {
    const b = yield* growTerrain(p, null, [], climateP, () => {}, key, undefined, mesh);
    planet = { refs: b.refs, peak: b.peak };
    if (planetMemo.size >= PLANET_MEMO) planetMemo.delete(planetMemo.keys().next().value!);
  }
  planetMemo.set(key, planet);
  return planet;
}

/**
 * 上一次撒的地块(网格只由地图大小、地块间距、种子定):编辑地形时每涂一笔草图都要从网格起重新生成,
 * 同一张网格接着用(连同按网格记着的几何、气候、铺像素的缓存),不再每笔重撒一遍。网格建好以后只读不写
 */
let meshMemo: { key: string; mesh: Mesh } | null = null;
function meshOf(W: number, H: number, spacing: number, seed: number): Mesh {
  const key = `${W}|${H}|${spacing}|${seed}`;
  if (meshMemo?.key === key) return meshMemo.mesh;
  meshMemo = null;
  const mesh = buildMesh(W, H, spacing, mulberry32(subSeed(seed, 'mesh')));
  meshMemo = { key, mesh };
  return mesh;
}

/** 前一半(见 TerrainBase):ops 只给侵蚀之前套的那几种。一段一段算,段与段之间停一下(见 generateWorldSteps) */
function* growTerrain(p: WorldParams, sk: Sketch | null, ops: readonly TerrainOp[], climateP: ClimateParams, progress: Progress, key: string, skin?: SurfaceSkin, meshIn?: Mesh) {
  const W = MAP_W;
  const H = MAP_H;

  progress('撒下地块', 0.02);
  const spacing = sphereSpacing(W, p.cells);
  const mesh = meshIn ?? meshOf(W, H, spacing, p.seed);
  const { n } = mesh;
  /** 改过地形(侵蚀之前的地形修改、草图;草图改了板块的不算 —— 整颗星球都变了,照它自己的换算) */
  const edited = (ops.length > 0 || !!sk) && !sk?.plates;
  const geo = geometryOf(mesh);
  yield;

  progress('板块漂移', 0.12);
  const tect = buildTectonics(mesh, p, sk);
  yield;
  // 改地形:火山、山脉、抬起 / 沉下 —— 侵蚀之前改抬升场和海陆(touched = 改过的地块)
  const land0 = ops.length ? tect.land.slice() : null;
  const touched = ops.length ? applyTerrainTectonics(mesh, tect, ops, p.seed) : null;
  const { land, uplift, oceanDepth, plateau } = tect;
  /** 改过的地块里原来是陆地的有几块(换算成米时当作排在最低处,见 toMeters) */
  let touchedLand = 0;
  if (touched && land0) for (let i = 0; i < n; i++) if (touched[i] && land0[i]) touchedLand++;
  // 草图改过的地块(tect.sketchTouched)
  const skTouched = tect.sketchTouched;
  // 改过地形的世界换算成米:远处照没改地形的同一颗星球的"最高峰"(planet),草图涂过的地方照这个世界自己的(和以前一样,
  // 涂的高山不会高得离谱),中间几圈平滑过渡(blend:涂过的 1,往外几圈降到 0)。涂一道山,远处的山不跟着变矮
  const planet = edited ? yield* planetOf(p, mesh, climateP) : null;
  let blend: Float32Array | null = null;
  if (planet && skTouched) {
    const f = new Float32Array(n);
    for (let i = 0; i < n; i++) if (skTouched[i]) f[i] = 1;
    const b = blurField(mesh, f, BLEND_PASSES);
    blend = new Float32Array(n);
    for (let i = 0; i < n; i++) blend[i] = f[i] ? 1 : smoothstep(0, 0.5, b[i]);
  }

  // ---- 侵蚀 ----
  const h = new Float32Array(n);
  const hn = geo.fbm(subSeed(p.seed, 'h0'), 4);
  for (let i = 0; i < n; i++) if (land[i]) h[i] = 0.05 + 0.05 * (hn.atScale(i, 300) + 1);

  const waterOf = (i: number) => (land[i] ? 0 : 1);
  const water0 = new Uint8Array(n);
  for (let i = 0; i < n; i++) water0[i] = waterOf(i);

  const rainWeight = (elevM: Float32Array) => {
    const c = computeClimate(mesh, elevM, water0, climateP);
    const w = new Float32Array(n);
    for (let i = 0; i < n; i++) w[i] = land[i] ? clamp(c.precipitation[i] / 1200, 0.1, 2.5) : 0;
    return w;
  };
  /** 侵蚀高度里"最高峰"取哪个值(换算成米时它对应 peak) */
  const refVals = new Float32Array(n);
  const refOf = (hh: Float32Array) => {
    let m = 0;
    // "最高峰"取样跳过改过的地块:一座大火山不会把全世界的山都压矮(改过的地块太多时照旧全取)。
    // 改过的地块里原来是陆地的,当作排在最低处照样算进名次(skip 块):取第几名和不改地形时一样,
    // 远处的山的海拔和不改时逐位相同(不然少了几块,"第 99.7% 那一名"挪一位,全世界的海拔都跟着差千分之一,别处的州、民族就会变)
    let skip = touchedLand;
    for (let i = 0; i < n; i++) if (land[i] && !touched?.[i]) refVals[m++] = hh[i];
    if (touched && m < 200) {
      m = 0;
      skip = 0;
      for (let i = 0; i < n; i++) if (land[i]) refVals[m++] = hh[i];
    }
    // 取第几小的值:hh 本来就是 32 位数,存进 Float32Array 原样不变,用类型化数组自带的数值排序(比带比较函数的快得多)
    const vals = refVals.subarray(0, m).sort();
    const ref = vals[Math.max(0, Math.min(m - 1, Math.floor((m + skip) * 0.997) - skip))] || 1;
    return tect.sketched || tect.noOrogeny ? Math.max(ref, reliefFloor(hh)) : ref;
  };
  /** 每一次换算用的"最高峰"(按先后记下;没改地形的世界记下的就是这颗星球的,改过地形的世界远处照它换算,见 planetOf) */
  const refs: number[] = [];
  /**
   * 第几次换算的比例(侵蚀高度 × 它 = 米):own = 照这个世界自己的"最高峰",far = 远处的(没改地形 = own;改过地形 = 没改地形的同一颗星球那一次的)。
   * 每个地块的比例 = far 往 own 按 blend 过渡(scaleAt)
   */
  const scaleOf = (hh: Float32Array, pk: number) => {
    const ref = refOf(hh);
    const c = refs.length;
    refs.push(ref);
    const own = pk / ref;
    return { own, far: planet && c < planet.refs.length ? pk / planet.refs[c] : own };
  };
  const scaleAt = (s: { own: number; far: number }, i: number) => (blend ? s.far + (s.own - s.far) * blend[i] : s.far);
  /**
   * 草图只补细节 / 完全照画、或者关掉了板块相撞时造山时"最高峰"的下限:涂过的地方抬升很低,涂满了陆地、别处没有程序的山时,
   * 第 99.7% 那一名就是平地,换算会把平地拉成几千米的高山。下限 = 有山的世界里最高峰大约有多高:
   * 这颗星球上侵蚀高度和抬升之比的中位数 × 普通世界里高山的抬升(山地参数越大越高),网格疏密也随这个比值一起算进去
   */
  const ratio = new Float32Array(n);
  const reliefFloor = (hh: Float32Array) => {
    let m = 0;
    for (let i = 0; i < n; i++) if (land[i] && uplift[i] > 0) ratio[m++] = hh[i] / uplift[i];
    if (!m) return 0;
    const vals = ratio.subarray(0, m).sort();
    return vals[m >> 1] * (REF_FLOOR_U + REF_FLOOR_MTN_U * clamp(p.mountains, 0, 2));
  };
  /**
   * 侵蚀高度 → 米。pk = 这一刻的"最高峰"(回放时从矮到高长);高原底座(base,米)按同样的进度一起长高
   */
  const toMeters = (hh: Float32Array, pk: number, base: Float32Array = plateau) => {
    const sc = scaleOf(hh, pk);
    const knee = pk * 0.85;
    const grow = pk / peak;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (!land[i]) {
        out[i] = oceanDepth[i];
        continue;
      }
      // 超过"膝点"的极高峰压缩一半:避免出现离谱的万米高峰
      const e = hh[i] * scaleAt(sc, i) + base[i] * grow;
      out[i] = e > knee ? knee + (e - knee) * 0.45 : e;
    }
    return out;
  };
  const peak = 3600 + 1700 * clamp(p.mountains, 0, 2);

  const proxy = new Float32Array(n);
  for (let i = 0; i < n; i++) proxy[i] = land[i] ? uplift[i] * 2500 + plateau[i] : oceanDepth[i];
  let rain = rainWeight(proxy);
  yield;

  const STEPS = 36;
  const history: Float32Array[] = [];
  const histGrow: number[] = [];
  const erosionP = { steps: STEPS / 2, dt: 0.9, K: 1, m: 0.5 };
  progress('造山与侵蚀', 0.2);
  yield* erodeSteps(mesh, land, h, uplift, rain, erosionP, (s) => {
    progress('造山与侵蚀', 0.2 + (0.35 * s) / STEPS);
    if (s % 3 === 0) {
      const g = ((s + 1) / STEPS) ** 0.5;
      history.push(toMeters(h, peak * g));
      histGrow.push(g);
    }
  });
  rain = rainWeight(toMeters(h, peak));
  yield;
  yield* erodeSteps(mesh, land, h, uplift, rain, erosionP, (s) => {
    progress('造山与侵蚀', 0.2 + (0.35 * (s + STEPS / 2)) / STEPS);
    if (s % 3 === 0) {
      const g = ((s + 1 + STEPS / 2) / STEPS) ** 0.5;
      history.push(toMeters(h, peak * g));
      histGrow.push(g);
    }
  });

  // 高原底座是侵蚀之后直接加上的(平坦的高原,不被切成山地)。让它顺着侵蚀出来的水系"让路":
  // 沿水流往下游,底座不高于上游(加上地形本身的落差)—— 底座不会把河堵成一串湖;
  // 从低地流进高原的河在高原上切出一道峡谷。只看上游,改地形时远处不受影响
  const flow = drainage(mesh, land, h, 1e-5);
  const sFinal = scaleOf(h, peak);
  const base = plateau.slice();
  for (let a = flow.orderLen - 1; a >= 0; a--) {
    const i = flow.order[a];
    const r = flow.receiver[i];
    if (r < 0 || !land[r]) continue;
    // 草图涂过的地方往外过渡的那几圈,上下游换算成米的比例不一样:各按各的(比例一样时照原来的算法,逐位不变)
    const si = scaleAt(sFinal, i);
    const sr = scaleAt(sFinal, r);
    const lim = si === sr ? base[i] + (flow.filled[i] - flow.filled[r]) * si : base[i] + flow.filled[i] * si - flow.filled[r] * sr;
    if (base[r] > lim) base[r] = lim;
  }
  // 回放帧补上同样的峡谷(每帧的底座长到了那一刻的比例 histGrow)
  const cut: number[] = [];
  for (let i = 0; i < n; i++) if (base[i] !== plateau[i]) cut.push(i);
  for (let f = 0; f < history.length; f++) {
    const fr = history[f];
    const g = histGrow[f];
    for (const i of cut) fr[i] += (base[i] - plateau[i]) * g;
  }
  const elevation = toMeters(h, peak, base);
  history.push(elevation.slice());

  // 步6b:按行星类型塑形 —— 陨击坑场 / 裂谷 / 极区冰盖(改过地形或草图的世界不塑形,免得破坏作者的改动)
  if (!edited && skin && skin !== 'earth') {
    if (skin === 'airless' || skin === 'dwarf') {
      // 先把大起伏抹平(没有大气/水的世界,山不该这么新),再按大/中/小三档砸坑
      smoothRelief(mesh, elevation, skin === 'airless' ? 0.72 : 0.55, spacing * 2.6);
      const big = skin === 'airless' ? 45 : 28;
      const mid = skin === 'airless' ? 200 : 120;
      const small = skin === 'airless' ? 560 : 320;
      const seedC = subSeed(p.seed, 'crater-field');
      // 大坑:直径几十个地块,坑缘宽、坑底深
      stampCraters(mesh, elevation, seedC, { count: big, minR: spacing * 3, maxR: spacing * 8, depthK: 0.6 });
      // 中坑
      stampCraters(mesh, elevation, subSeed(seedC, 'mid'), { count: mid, minR: spacing * 1.2, maxR: spacing * 3.4, depthK: 0.52 });
      // 小坑:让地面有麻点
      stampCraters(mesh, elevation, subSeed(seedC, 'small'), { count: small, minR: spacing * 0.5, maxR: spacing * 1.4, depthK: 0.42 });
      yield;
      progress('陨击坑场', 0.6);
      history.push(elevation.slice());
    } else if (skin === 'lava') {
      carveRifts(mesh, elevation, subSeed(p.seed, 'rift-field'), { count: 8, minLen: 0.2, maxLen: 0.55, minWidth: spacing * 0.9, maxWidth: spacing * 2.6, depth: 1900 });
      progress('裂谷', 0.6);
      history.push(elevation.slice());
    } else if (skin === 'frozen') {
      applyIceSheets(mesh, elevation, subSeed(p.seed, 'ice-sheets'), { fromLat: 52, fullLat: 78, height: 2200, flatten: 0.82 });
      progress('冰盖', 0.6);
      history.push(elevation.slice());
    }
  }
  yield;

  // ---- 湖泊:裂谷下陷 + 少量冰川 / 构造洼地 ----
  progress('湖泊与水系', 0.62);
  // 草图选了只补细节 / 完全照画:涂过的地方不挖裂谷
  const sketched = tect.sketched;
  for (let i = 0; i < n; i++) {
    if (!land[i] || sketched?.[i]) continue;
    const contF = tect.plateContinental[tect.plate[i]] ? 1 : 0.5;
    // 只在强的张裂带上挖;下挖不超过当地海拔的一半(低平原上的张裂带不会挖到海平面以下,积成一串贴着海的死水湖)
    const rift = 220 * contF * smoothstep(0.2, 0.65, tect.strengthDiv[i]) * Math.exp(-Math.pow(tect.distDiv[i] / 20, 2));
    elevation[i] -= Math.min(rift, 0.7 * Math.max(0, elevation[i]));
  }
  // 小洼地(之后积水成小湖):海拔 60 米以上的陆地块每块有 1/600 的机会是洼地中心,大小、深浅也按这块地取 ——
  // 按地块编号取随机数(和先后无关):改地形(海里冒出一座岛)时别处的洼地位置不变,远处的湖、河、气候、群落照旧
  const dentBase = subSeed(p.seed, 'lakes-at');
  let highLand = 0;
  const dents: number[] = [];
  for (let c = 0; c < n; c++) {
    if (!land[c] || !(elevation[c] > 60)) continue;
    highLand++;
    if (keyed(dentBase, c, 0) < DENT_P) dents.push(c);
  }
  // 完全照画:涂过的地方也不挖小洼地(只补细节的照挖,小湖算细节)
  const noDent = sk?.fill === 'exact' ? sketched : undefined;
  for (const c of dents) {
    if (noDent?.[c]) continue;
    const r = spacing * (1.6 + keyed(dentBase, c, 1) * 2.8);
    const depth = 40 + keyed(dentBase, c, 2) * 160;
    // 只在附近 cell 上挖
    const r3 = r * 3;
    for (const i of geo.cellsNear(c, r3)) {
      if (!land[i] || noDent?.[i]) continue;
      elevation[i] -= depth * Math.exp(-geo.near2(i, c, r3) / (r * r));
    }
  }
  const top = planet ? planet.peak : landPeak(land, elevation);
  return { key, sketch: sk && { ...sk, grid: sk.grid.slice() }, mesh, tect, elevation, history, touched, peak: top, highLand, refs };
}

/**
 * terrain:作者的地形修改(WorldEdits.terrain,按先后;不给 / 空 = 不改);sketch:草图涂成的格子图(不给 / null = 没画)。
 * cache:记着上一次的前一半(见 TerrainBase);参数、草图、侵蚀之前的地形修改都没变时跳过网格、板块、侵蚀
 */
export function generateWorld(params: WorldParams, progress: Progress = () => {}, terrain?: readonly TerrainOp[], sketch?: Sketch | null, cache?: BaseCache, system?: SystemOverrides | null, skin?: SurfaceSkin): World {
  const it = generateWorldSteps(params, progress, terrain, sketch, cache, system, skin);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/**
 * 同 generateWorld,一段一段算:每段(板块、侵蚀的每一步、气候……)算完停一下(yield),调用方可以在停下的时候先干别的、
 * 或者不接着算了(后台线程编辑地形时新的一笔来了,上一笔不用算完)。接着算到底和 generateWorld 一模一样;
 * 中途不算了,记着的东西(cache 里的前一半等)要么还是原来的、要么是算完了的一份,不会是算了一半的
 */
export function* generateWorldSteps(params: WorldParams, progress: Progress = () => {}, terrain?: readonly TerrainOp[], sketch?: Sketch | null, cache?: BaseCache, system?: SystemOverrides | null, skin?: SurfaceSkin): Generator<void, World> {
  const p = { ...DEFAULT_PARAMS, ...params };
  // 地形修改 + 地形大事(upheaval.ts 生成大事以后的世界时接在后面)
  const ops = cleanTerrainOps(terrain ?? [], TERRAIN_MAX_OPS + UPHEAVALS_MAX * UPHEAVAL_OPS_MAX);
  const W = MAP_W;
  const H = MAP_H;
  // 星球系:只在 astro = 1 时生成;气候拿它的辐照/倾角/自转/大气修正(astro = 0 时是 null,气候一条不改)。
  // mods 只当参数传给 computeClimate,不放进 ClimateParams/World.climate——那两样要进世界文件、要过校验
  const astro = p.astro === 1 ? generateAstro(p, system) : null;
  const climateMods = climateModsOf(astro);
  const climateP: ClimateParams = {
    seed: p.seed,
    temperature: p.temperature,
    rainfall: p.rainfall,
  };
  const sk = sketchUsed(sketch) ? sketch : null;
  const shapes = ops.filter(isShapeOp);
  const key = baseKeyOf(p, shapes);
  const had = cache?.base;
  let base: TerrainBase;
  if (had && had.key === key && sameSketchGrid(had.sketch, sk)) {
    base = had;
    progress('湖泊与水系', 0.62);
  } else {
base = yield* growTerrain(p, sk, shapes, climateP, progress, key, skin);
    if (cache) cache.base = base;
  }
  // 没改地形的星球:记下它的"最高峰"(planetOf 要的就是这一份),之后编辑地形涂第一笔不用再生成一遍这颗星球
  if (!sk && !shapes.length && !planetMemo.has(key)) {
    if (planetMemo.size >= PLANET_MEMO) planetMemo.delete(planetMemo.keys().next().value!);
    planetMemo.set(key, { refs: base.refs, peak: base.peak });
  }
  const { mesh, touched, highLand } = base;
  const { n } = mesh;
  const elevation = base.elevation.slice();
  // 改地形:高度五种笔(抬高、压低、平滑、抹平、定高)直接改海拔;涂过海平面的地方海陆跟着变(在副本上改,前一半记着的不动)。
  // painted = 涂过的地块:下面填平太大的湖、淹掉湖心小岛时不动它们(和作者挖的湖、堆的地一样)
  let tect = base.tect;
  let history = base.history;
  let painted: Uint8Array | null = null;
  if (ops.some((o) => isHeightKind(o.kind))) {
    tect = { ...tect, land: tect.land.slice() };
    painted = applyHeightPens(mesh, tect.land, elevation, ops);
    // 形成过程的回放帧也加上涂的高低(回放用的是现在的海陆),最后一帧和现在的地形对得上
    const changed: number[] = [];
    for (let i = 0; i < n; i++) if (elevation[i] !== base.elevation[i]) changed.push(i);
    if (changed.length) {
      history = history.map((fr) => {
        const out = fr.slice();
        for (const i of changed) out[i] += elevation[i] - base.elevation[i];
        return out;
      });
    }
  }
  const { land } = tect;

  // 改地形:作者挖的湖(碗形洼地,下面排水时灌满)
  const userLake = ops.length ? carveLakes(mesh, land, elevation, ops, p.seed) : null;
  // 改地形:作者画的河(沿线挖河谷,这一路一定画成河)
  const water0r = new Uint8Array(n);
  for (let i = 0; i < n; i++) water0r[i] = land[i] ? 0 : 1;
  const userRiver = ops.length ? carveRivers(mesh, water0r, elevation, ops) : null;
  let pool = drainage(mesh, land, elevation, 0);
  // 贴着海的洼地(张裂、小洼地挖到了海平面以下):水面就是海平面,积出来的是一个紧挨着海的"湖" —— 其实是海湾。
  // 垫到海平面上当低地(湖在内陆,不会贴着海);水面高度没变,重算一遍排水。作者挖的湖照留(挖在海边的,碗沿就是海平面)
  let lowered = false;
  for (let i = 0; i < n; i++) {
    if (land[i] && pool.filled[i] === 0 && elevation[i] < 0 && !(userLake && userLake[i])) {
      elevation[i] = 0;
      lowered = true;
    }
  }
  if (lowered) pool = drainage(mesh, land, elevation, 0);
  const water = new Uint8Array(n);
  const waterLevel = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!land[i]) water[i] = 1;
    else if (pool.filled[i] - elevation[i] > 3) {
      water[i] = 2;
      waterLevel[i] = pool.filled[i];
    }
  }
  // 太大的湖(平原上的浅洼地被整片灌满)不自然:填成平地
  const maxLake = Math.max(40, Math.round(highLand * 0.004));
  const seen = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (water[i] !== 2 || seen[i]) continue;
    const comp = [i];
    seen[i] = 1;
    for (let q = 0; q < comp.length; q++) {
      const c = comp[q];
      for (let k = mesh.adjStart[c]; k < mesh.adjStart[c + 1]; k++) {
        const j = mesh.adj[k];
        if (water[j] === 2 && !seen[j]) {
          seen[j] = 1;
          comp.push(j);
        }
      }
    }
    if (comp.length > maxLake && !(userLake && comp.some((c) => userLake[c])) && !(painted && comp.some((c) => painted[c]))) {
      for (const c of comp) {
        water[c] = 0;
        elevation[c] = pool.filled[c] - 1;
      }
    }
  }
  // 湖心的小块地(周围全是湖水):不成州,淹成湖(湖面高度取周围湖水的最高处,湖底比水面低一点)。
  // 上面填平的湖也是陆地了,重新走一遍
  seen.fill(0);
  const islet = Math.max(1, Math.round((LAKE_ISLET * n) / 36000));
  for (let i = 0; i < n; i++) {
    if (water[i] !== 0 || seen[i]) continue;
    const comp = [i];
    seen[i] = 1;
    let lake = false;
    let ocean = false;
    let level = -Infinity;
    for (let q = 0; q < comp.length; q++) {
      const c = comp[q];
      for (let k = mesh.adjStart[c]; k < mesh.adjStart[c + 1]; k++) {
        const j = mesh.adj[k];
        if (water[j] === 0 && !seen[j]) {
          seen[j] = 1;
          comp.push(j);
        } else if (water[j] === 2) {
          lake = true;
          level = Math.max(level, waterLevel[j]);
        } else if (water[j] === 1) ocean = true;
      }
    }
    // 作者挖的湖、作者堆的地(火山、抬起陆地)、高度笔涂过的地方不动
    if (
      lake &&
      !ocean &&
      comp.length <= islet &&
      !(userLake && comp.some((c) => userLake[c])) &&
      !(touched && comp.some((c) => touched[c])) &&
      !(painted && comp.some((c) => painted[c]))
    ) {
      for (const c of comp) {
        water[c] = 2;
        waterLevel[c] = level;
        elevation[c] = Math.min(elevation[c], level - 4);
      }
    }
  }

  // 改地形:删河湖 —— 点在湖里的,整片湖填平(湖底垫到湖面下 1 米,排水不再积出湖,流进来的河穿过去);别的留到串河之前删河
  // 指着的是不是湖按删之前的湖算:同一个湖点了两次,第二次还是删这个湖(不会落到填平的地上、改成删附近的河)
  const delRivers: TerrainOp[] = [];
  const lakes0 = ops.some((o) => o.kind === 'delWater') ? water.slice() : water;
  for (const op of ops) {
    if (op.kind !== 'delWater') continue;
    const lake = lakeAt(mesh, lakes0, op.pts[0], op.pts[1], userLake);
    if (!lake) {
      delRivers.push(op);
      continue;
    }
    for (const c of lake) {
      water[c] = 0;
      waterLevel[c] = 0;
      elevation[c] = pool.filled[c] - 1;
    }
  }

  // ---- 最终气候 ----
  yield;
  progress('风与降水', 0.72);
  const currents = computeCurrents(mesh, water);
  const clim = computeClimate(mesh, elevation, water, climateP, currents, true, climateMods);
  // 改地形:作者涂的更湿 / 更干 / 更暖 / 更冷
  if (ops.length) applyClimatePens(mesh, clim.temperature, clim.precipitation, ops);
  const seaIce = computeSeaIce(mesh, elevation, water, clim.temperature, clim.windX, clim.windY, p.seed);

  // ---- 水系 ----
  yield;
  progress('河流', 0.82);
  const route = drainage(mesh, land, elevation, 1e-3);
  const runoff = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (!land[i]) continue;
    // 冰盖上的雪不化成河(冰川慢慢流到边上入海),只算一点点融水
    if (clim.temperature[i] < ICE_SHEET_T) {
      runoff[i] = ICE_RUNOFF;
      continue;
    }
    const pet = 250 + 22 * Math.max(0, clim.temperature[i]); // 粗略蒸散
    runoff[i] = Math.max(0.03, (clim.precipitation[i] - 0.45 * pet) / 1000);
  }
  const flux = accumulate(route, land, runoff, new Float32Array(n));
  const riverThreshold = 10 * (n / 36000);
  // 改地形:删河湖指着的河 —— 按先后一处处删:照现在的流量串一遍河,找指着的那条连同支流,它们的陆地段和上游流域(只沿陆地往上,
  // 不穿过湖)流量压到 DEL_WATER_FLUX 倍门槛以下;下一处按删过的再找
  if (delRivers.length) {
    const gone = new Uint8Array(n);
    const cap = DEL_WATER_FLUX * riverThreshold;
    for (const op of delRivers) {
      const now = traceRivers(mesh, land, water, route.receiver, flux, riverThreshold, userRiver, clim.temperature);
      const hit = riversAt(now, water, op.pts[0], op.pts[1], op.r);
      if (!hit.length) continue;
      gone.fill(0);
      for (const c of riverCells(now, water, hit)) gone[c] = 1;
      // order 从下游往上游排:下游删了,流进它的陆地块也删;作者画的河(连同它的上游)不动,照样是河
      for (let a = 0; a < route.orderLen; a++) {
        const i = route.order[a];
        const r = route.receiver[i];
        if (!gone[i] && r >= 0 && gone[r] && water[i] === 0 && !userRiver?.[i]) gone[i] = 1;
      }
      for (let i = 0; i < n; i++) if (gone[i] && flux[i] > cap) flux[i] = cap;
    }
  }
  const rivers = traceRivers(mesh, land, water, route.receiver, flux, riverThreshold, userRiver, clim.temperature);

  // ---- 生物群落 ----
  progress('生物群落', 0.9);
  const biome = new Uint8Array(n);
  for (let i = 0; i < n; i++) biome[i] = classifyBiome(clim.temperature[i], clim.precipitation[i], water[i], seaIce[i]);
  // 湿地:低平、排水差、有水来(本地的水蒸发不完 / 大河漫滩 / 湖边)的陆地块盖成湿地(见 wetland.ts;冰原上没有)
  const wet = wetlandSuitability({ mesh, elevation, water, temperature: clim.temperature, precipitation: clim.precipitation, flux, riverThreshold });
  for (let i = 0; i < n; i++) if (water[i] === 0 && wet[i] >= WETLAND_CUT) biome[i] = Biome.Wetland;
  // 最高海拔(山名、山峰符号的门槛按它定):改过地形、画了草图的世界(草图改了板块的除外)照没改地形的同一颗星球的
  // (TerrainBase.peak;后一半只挖湖、填洼地、把海平面以下的垫平,陆地最高处不变),涂一道高山、放一座大火山、
  // 用高度笔堆高、把最高的山压平都不改远处山名、山峰符号的门槛
  const maxElevation = (ops.length > 0 || sk) && !sk?.plates ? base.peak : landPeak(land, elevation);

  return {
    params: p,
    width: W,
    height: H,
    climate: climateP,
    mesh,
    tect,
    elevation,
    water,
    waterLevel,
    temperature: clim.temperature,
    precipitation: clim.precipitation,
    seaIce,
    currents,
    biome,
    flux,
    riverThreshold,
    rivers,
    history,
    maxElevation,
    volcanoes: ops.length ? volcanoPeaks(mesh, water, elevation, ops) : [],
    // 星球系:只在 params.astro = 1 时挂上(默认不生成,世界和以前逐字节一样);派生数据,不进世界文件
    ...(astro ? { astro } : {}),
    ...(system ? { system } : {}),
    ...(ops.length ? { terrain: ops.slice() } : {}),
    ...(sk ? { sketch: sk } : {}),
  };
}

/** 把超过阈值的径流 cell 串成河道折线:从每条支流源头往下游走,遇到干流 / 湖 / 海就停。 */
function traceRivers(
  mesh: Mesh,
  land: Uint8Array,
  water: Uint8Array,
  receiver: Int32Array,
  flux: Float32Array,
  thr: number,
  forced: Uint8Array | null = null,
  temperature: Float32Array | null = null,
): River[] {
  const { n, x, y } = mesh;
  const geo = geometryOf(mesh);
  const m: number[] = [0, 0];
  const isRiver = new Uint8Array(n);
  // 冰盖上不流河(作者画的照画)
  for (let i = 0; i < n; i++) {
    if (water[i] === 0 && (forced?.[i] || (flux[i] >= thr && !(temperature && temperature[i] < ICE_SHEET_T)))) isRiver[i] = 1;
  }
  const hasRiverDonor = new Uint8Array(n);
  const lakeInlet = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const r = receiver[i];
    if (r < 0) continue;
    if (isRiver[i]) hasRiverDonor[r] = 1;
    else if (water[i] === 2 && isRiver[r]) lakeInlet[r] = i;
  }
  const sources: number[] = [];
  for (let i = 0; i < n; i++) if (isRiver[i] && !hasRiverDonor[i]) sources.push(i);
  sources.sort((a, b) => flux[b] - flux[a]);

  const visited = new Uint8Array(n);
  const rivers: River[] = [];
  // 另存地块链(和 pts 的点一一对应)
  const chain: number[] = [];
  for (const s of sources) {
    const pts: number[] = [];
    chain.length = 0;
    const li = lakeInlet[s];
    if (li >= 0) {
      geo.mid(li, s, m);
      pts.push(m[0], m[1], flux[s]);
      chain.push(li);
    }
    let i = s;
    visited[i] = 1;
    pts.push(x[i], y[i], flux[i]);
    chain.push(i);
    for (;;) {
      const r = receiver[i];
      if (r < 0) break;
      if (water[r] !== 0) {
        // 入海 / 入湖:停在两地块之间,大致就是岸线
        geo.mid(i, r, m);
        pts.push(m[0], m[1], flux[i]);
        chain.push(r);
        break;
      }
      // 流进冰盖就停(作者画的照画)
      if (!forced?.[r] && temperature && temperature[r] < ICE_SHEET_T) break;
      pts.push(x[r], y[r], flux[r]);
      chain.push(r);
      if (visited[r]) break;
      visited[r] = 1;
      i = r;
    }
    if (pts.length < 6) continue;
    const river: River = { pts: Float32Array.from(pts), cells: Int32Array.from(chain) };
    // 作者画的河:每个点记下画笔的半宽(入湖口 / 入海口那一点取旁边的陆地块),只给地图显示用
    if (forced && chain.some((c) => forced[c])) {
      const k = chain.length;
      river.drawn = Uint8Array.from(chain, (c, j) => forced[water[c] === 0 ? c : chain[j === 0 ? Math.min(1, k - 1) : j - 1]]);
    }
    rivers.push(river);
  }
  return rivers;
}
