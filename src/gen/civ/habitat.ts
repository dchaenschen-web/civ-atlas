/**
 * 宜居度(地块级):哪里适合住人。
 *
 * 量级沿用 Azgaar(群落底分 + 淡水 + 海岸 / 良港 − 海拔),换成我们模拟出来的真实物理量:
 * 径流(河)、以米计的海拔和坡度、降水,模拟的气温与降水决定的群落。
 * 宜居度看的是"一片地能养活多少人"(种得出多少粮食),不是草木有多茂盛:
 *
 *   s = 群落底分(见 BIOME_HABITABILITY:温带森林、热带季雨林这类能开成良田的最高;热带雨林土薄多病、远低于它们)
 *     + 淡水 min(40, 12 × log2(1 + 径流 / 河流阈值)) × 灌溉系数
 *            大河、汇流处加分最多;紧挨大河的岸边按那条河的流量打七五折(城市多建在大河岸边,大河本身常是州界)。
 *            灌溉系数按当地降水:≤ IRRIGATE_DRY 毫米为 1(干旱处全靠河,大河边的荒漠绿洲),
 *            往上线性降到 ≥ IRRIGATE_WET 毫米的 IRRIGATE_MIN(雨水本来就足,河多也不多养人)
 *     + 冲积平原 FLOODPLAIN:大河流过或紧挨着、海拔低于 FLOOD_ELEV 米、平均坡度小于 FLOOD_SLOPE 米/公里(大河下游的平原、三角洲)
 *     + 湖岸 30(冰湖 1) · 海岸 5 · 河口 15 · 天然良港 20  (冻住的海不算)
 *     − 海拔 / 150 − 坡度罚分
 *   宜居分 = max(0, s) / 5;群落底分为 0(冰原)的地块直接不可居
 *   人口上限 = 宜居分 × 本块面积 / 默认精细度下的地块面积
 */
import { biomeColumn, biomeTagged } from '../biomes';
import type { World } from '../world';
import type { Habitat } from './types';
import { KM_PER_UNIT, adjLengths, cellAreas, refCellArea } from './geo';
import { flog2 } from './engine/rand';
import { astroOf } from '../astro';

/** 群落宜居底分(按 Biome 编号;见地貌表的 habitability) */
export const BIOME_HABITABILITY = biomeColumn('habitability');

/** 群落通行代价(民族 / 国家扩张用;水面为 0,由各自规则另算;见地貌表的 travelCost) */
export const BIOME_COST = biomeColumn('travelCost');

const FRESHWATER_K = 12;
const FRESHWATER_MAX = 40;
/** 大河岸边的淡水分 = 那条河的淡水分 × 这个比例 */
const RIVER_BANK = 0.75;
/** 流量 ≥ 河流阈值的这么多倍算"大河":不作治所,跨过去代价高,州界多落在它上面(regions.ts 共用) */
export const MAJOR_RIVER = 6;
/** 灌溉系数:降水 ≤ IRRIGATE_DRY 毫米为 1,往上线性降到 ≥ IRRIGATE_WET 毫米的 IRRIGATE_MIN */
const IRRIGATE_DRY = 600;
const IRRIGATE_WET = 2000;
const IRRIGATE_MIN = 0.35;
/** 冲积平原:大河流过或紧挨着、海拔低于 FLOOD_ELEV 米、平均坡度小于 FLOOD_SLOPE 米/公里,加 FLOODPLAIN 分 */
const FLOODPLAIN = 18;
const FLOOD_ELEV = 250;
const FLOOD_SLOPE = 3;
const LAKE_SHORE = 30;
const FROZEN_LAKE_SHORE = 1;
const COAST = 5;
const ESTUARY = 15;
const HARBOR = 20;
/** 海拔每多少米扣 1 分 */
const ELEV_PER_POINT = 150;
/** 坡度罚分:平均坡度每 1 米/公里扣几分,最多扣几分 */
const SLOPE_K = 1.6;
const SLOPE_MAX = 30;

/** 淡水分:f = 径流 / 河流阈值 */
const fresh = (f: number) => Math.min(FRESHWATER_MAX, FRESHWATER_K * flog2(1 + f));

/** 灌溉系数(按年降水,毫米):越干越靠河 */
export function irrigation(precip: number): number {
  if (!(precip > IRRIGATE_DRY)) return 1;
  if (precip >= IRRIGATE_WET) return IRRIGATE_MIN;
  return 1 - ((1 - IRRIGATE_MIN) * (precip - IRRIGATE_DRY)) / (IRRIGATE_WET - IRRIGATE_DRY);
}

/** 海冰、冰原(冻住的湖)群落(地貌表的标签 seaIce、ice) */
const SEA_ICE = biomeTagged('seaIce');
const ICE = biomeTagged('ice');

/** 冻住的海(不能靠港、不能航行):海冰群落,或年均温低于 −8°C 的海面 */
export function frozenSea(world: World, i: number): boolean {
  return world.water[i] === 1 && (SEA_ICE[world.biome[i]] === 1 || world.temperature[i] < -8);
}

export function computeHabitat(world: World): Habitat {
  const { mesh, water, biome, elevation, flux, riverThreshold, precipitation } = world;
  const { n, adjStart, adj } = mesh;
  const len = adjLengths(mesh);
  const area = cellAreas(mesh);
  const refArea = refCellArea(mesh);

  const suitability = new Float32Array(n);
  const capacity = new Float32Array(n);
  const harbor = new Uint8Array(n);
  const coastDist = new Int8Array(n);
  // 潮差对海岸的加成(星球系):地球基线 = 0;大潮差的海岸渔业与造船好,几乎没有潮汐的星海岸差一点。
  // 没有星球系(astro = 0)= 0,世界和加这一层以前逐字节一样
  const sys = astroOf(world);
  const tideBonus = sys ? Math.max(-2, Math.min(6, (sys.home.tide - 1) * 3)) : 0;

  // ---- 离海岸距离:从海岸线两侧同时做 BFS(湖泊算"陆地一侧") ----
  const queue = new Int32Array(n);
  let qh = 0;
  let qt = 0;
  for (let i = 0; i < n; i++) {
    const sea = water[i] === 1;
    for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
      if ((water[adj[k]] === 1) !== sea) {
        coastDist[i] = sea ? -1 : 1;
        queue[qt++] = i;
        break;
      }
    }
  }
  while (qh < qt) {
    const i = queue[qh++];
    const d = coastDist[i];
    const next = d > 0 ? Math.min(127, d + 1) : Math.max(-127, d - 1);
    const sea = d < 0;
    for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
      const j = adj[k];
      if (coastDist[j] !== 0 || (water[j] === 1) !== sea) continue;
      coastDist[j] = next;
      queue[qt++] = j;
    }
  }
  // 没有海岸的连通区(整个世界全是海、或全是陆地时)兜底
  for (let i = 0; i < n; i++) if (coastDist[i] === 0) coastDist[i] = water[i] === 1 ? -127 : 127;

  // ---- 宜居分 ----
  for (let i = 0; i < n; i++) {
    if (water[i] !== 0) continue;
    const base = BIOME_HABITABILITY[biome[i]];
    let seaN = 0;
    let openSea = false;
    let lake = 0;
    let bank = 0;
    let slopeSum = 0;
    let slopeCnt = 0;
    for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
      const j = adj[k];
      const wj = water[j];
      if (wj === 1) {
        seaN++;
        if (!frozenSea(world, j)) openSea = true;
      } else if (wj === 2) {
        lake = Math.max(lake, ICE[biome[j]] ? FROZEN_LAKE_SHORE : LAKE_SHORE);
      } else {
        if (flux[j] >= MAJOR_RIVER * riverThreshold && flux[j] > bank) bank = flux[j];
        const dh = Math.abs(elevation[j] - elevation[i]);
        slopeSum += dh / (len[k] * KM_PER_UNIT);
        slopeCnt++;
      }
    }
    harbor[i] = seaN;
    if (base <= 0) continue;
    const river = flux[i] / riverThreshold;
    const slope = slopeCnt ? slopeSum / slopeCnt : 0; // 米 / 公里
    let s = base;
    s += Math.max(fresh(river), RIVER_BANK * fresh(bank / riverThreshold)) * irrigation(precipitation[i]);
    if ((river >= MAJOR_RIVER || bank > 0) && elevation[i] < FLOOD_ELEV && slope < FLOOD_SLOPE) s += FLOODPLAIN;
    s += lake;
    if (openSea) {
      s += COAST;
      if (river >= 1) s += ESTUARY;
      if (seaN === 1) s += HARBOR;
      if (tideBonus !== 0) s += tideBonus;
    }
    s -= Math.max(0, elevation[i]) / ELEV_PER_POINT;
    s -= Math.min(SLOPE_MAX, SLOPE_K * slope);
    const v = Math.max(0, s) / 5;
    suitability[i] = v;
    capacity[i] = (v * area[i]) / refArea;
  }

  return { suitability, capacity, coastDist, harbor };
}
