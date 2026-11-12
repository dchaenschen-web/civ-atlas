/**
 * 年内气温(估算):一年里各地的月温怎么起落。推演里的"冬天""开春""青黄不接"按它算。
 *
 * 世界里只有年均温、年降水,这里只估温度,和地图「气候」图层(koppen.ts)同一套:
 *   年较差(最热月 − 最冷月)= koppen.ts 的 annualRange(纬度, 大陆度),大陆度是同一份 continentalityGrid
 *   (陆地按地块取:1° 一格,落在格子里的地块陆地多于一半算陆地;湖算陆地。图层按像素取,海岸线细一些,
 *   两边的年较差平均差不到 1°C);
 *   月温 = 年均温 − 年较差/2 × cos(2π × (一年里的几成 − 最冷那一刻)),
 *   北半球最冷那一刻在 COLDEST_NORTH(一月中),南半球晚半年。
 * 没有逐月降水,不编雨季、旱季。
 *
 * 都是估算:算法变了 YEAR_CLIMATE_VERSION 加一(推演用到它,同一种子的历史跟着变,gen/edits.ts 的 GENERATOR_VERSION 也要加)。
 * 季节强弱 SEASON_STRENGTH 乘在年较差上(像地球 = 1;以后做成世界参数)。
 * 三角函数舍入到 24 位(civ/rand.ts 的 round24),跨 CPU 一致。纯计算,不碰 DOM;同一个世界只算一次。
 */
import type { World } from './world';
import { annualRange, CONT_GH, CONT_GW, continentalityAt, continentalityGrid } from './koppen';
import { round24 } from './civ/engine/rand';
import { astroOf } from './astro';

/** 年内气温估算的版本:算法变了加一 */
export const YEAR_CLIMATE_VERSION = 1;
/** 季节强弱:乘在年较差上(像地球 = 1) */
export const SEASON_STRENGTH = 1;
/** 北半球最冷那一刻在一年里的几成(一月中);南半球 + 0.5 */
export const COLDEST_NORTH = 0.04;

export interface YearClimate {
  /** 每个地块的年均温(°C;就是 World.temperature) */
  mean: Float32Array;
  /** 每个地块年较差的一半(°C):月温在年均温上下摆这么多 */
  half: Float32Array;
  /** 每个地块最冷那一刻在一年里的几成(北半球 COLDEST_NORTH,南半球 COLDEST_NORTH + 0.5) */
  coldest: Float32Array;
}

const cache = new WeakMap<World, YearClimate>();

/** 这个世界的年内气温(估算;同一个世界只算一次) */
export function yearClimate(world: World): YearClimate {
  const hit = cache.get(world);
  if (hit) return hit;
  const { mesh, temperature } = world;
  const { n, width, height } = mesh;
  const cont = continentalityGrid(landGrid(world));
  const half = new Float32Array(n);
  const coldest = new Float32Array(n);
  // 星球系:倾角越大,年较差越大(地球基线 23.5° → 1,世界和以前逐字节一样)
  const sys = astroOf(world);
  const strength = sys ? sys.home.tilt / 23.5 : SEASON_STRENGTH;
  for (let c = 0; c < n; c++) {
    const lat = 90 - (180 * mesh.y[c]) / height;
    half[c] = (strength * annualRange(lat, continentalityAt(cont, mesh.x[c] / width, mesh.y[c] / height))) / 2;
    coldest[c] = lat < 0 ? COLDEST_NORTH + 0.5 : COLDEST_NORTH;
  }
  const yc: YearClimate = { mean: temperature, half, coldest };
  cache.set(world, yc);
  return yc;
}

/**
 * 1° 一格的陆地(湖算陆地,和气候图层一样):落在这一格里的地块中心,陆地多于一半算陆地;
 * 一个地块中心都没落进来的格子(赤道附近地块比格子略大)取同一行里最近的有地块的格子
 */
function landGrid(world: World): Uint8Array {
  const { mesh, water } = world;
  const G = CONT_GW * CONT_GH;
  const vote = new Int32Array(G);
  const seen = new Int32Array(G);
  for (let c = 0; c < mesh.n; c++) {
    const gx = Math.min(CONT_GW - 1, Math.max(0, Math.floor((mesh.x[c] / mesh.width) * CONT_GW)));
    const gy = Math.min(CONT_GH - 1, Math.max(0, Math.floor((mesh.y[c] / mesh.height) * CONT_GH)));
    const g = gy * CONT_GW + gx;
    seen[g]++;
    vote[g] += water[c] !== 1 ? 1 : -1;
  }
  const land = new Uint8Array(G);
  for (let gy = 0; gy < CONT_GH; gy++) {
    const row = gy * CONT_GW;
    for (let gx = 0; gx < CONT_GW; gx++) {
      let g = row + gx;
      // 往左右(东西相连)交替找最近的有地块的格子,一样近先取西边
      for (let d = 1; !seen[g] && d <= CONT_GW / 2; d++) {
        const w = row + ((gx - d + CONT_GW) % CONT_GW);
        const e = row + ((gx + d) % CONT_GW);
        if (seen[w]) g = w;
        else if (seen[e]) g = e;
      }
      land[row + gx] = vote[g] > 0 ? 1 : 0;
    }
  }
  return land;
}

/** 地块 c 在 t 这一刻(年;小数部分 = 一年里的几成)的月温(°C,估算) */
export function monthTemp(yc: YearClimate, c: number, t: number): number {
  const f = t - Math.floor(t) - yc.coldest[c];
  return yc.mean[c] - yc.half[c] * round24(Math.cos(2 * Math.PI * f));
}

/** 地块 c 一年里月温低于 thr(°C)的几成(0–1) */
export function coldShare(yc: YearClimate, c: number, thr: number): number {
  const h = yc.half[c];
  const x = h > 0 ? (yc.mean[c] - thr) / h : yc.mean[c] < thr ? -Infinity : Infinity;
  if (x >= 1) return 0;
  if (x <= -1) return 1;
  return round24(Math.acos(x)) / Math.PI;
}

/**
 * t 落在地块 c 月温低于 thr 的那段日子(冷季)里:那段冷季结束的时刻;不在冷季里 = t;常年都低于 thr(没有开春)= Infinity。
 * share = coldShare(yc, c, thr)(调用的地方已经算过的话传进来,省一次)
 */
export function coldSpellEnd(yc: YearClimate, c: number, t: number, thr: number, share = coldShare(yc, c, thr)): number {
  if (share <= 0) return t;
  if (share >= 1) return Infinity;
  const f0 = yc.coldest[c];
  const w = share / 2;
  // t 离最近的那个最冷时刻多远
  const y = Math.floor(t - f0 + 0.5);
  const d = t - (y + f0);
  return Math.abs(d) < w ? y + f0 + w : t;
}
