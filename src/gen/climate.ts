/**
 * 气候:温度 + 盛行风 + 水汽输送 → 降水。
 *
 * - 温度:按纬度查表,再按海拔递减(每千米 -6.5°C)
 * - 风带:信风(0-30°,吹向西)、西风带(30-60°,吹向东)、极地东风(60°+);交界 ±5° 内平滑转向,
 *         交界线上风弱(副热带无风带 / 副极地低压带),水汽更多由本地决定
 * - 水汽:顺风一路搬运。海面蒸发补水;上陆后逐步下雨;
 *         遇山抬升猛下雨(迎风坡湿),翻过山水汽所剩无几(背风坡干 = 雨影)
 * - 纬度带修正:赤道辐合带多雨,副热带高压(~25°)干,中纬度锋面多雨,极地干
 * - 洋流(给了 currents 时,见 currents.ts):海面温度加上洋流的冷暖偏差;海风把这份冷暖顺风带上岸,
 *   越往内陆越淡,翻山再减;贴岸的地方不管风向都沾一点(海雾、海风)。寒流岸边空气稳定、不爱下雨
 *   (海边的沙漠),暖流岸边湿热
 */
import { blurField, type Mesh } from './mesh';
import { piecewise, subSeed, clamp, smoothstep, orderByKey } from './util';
import { geometryOf } from './geometry';
import type { Currents } from './currents';
import { round24 } from './civ/engine/rand';

export interface ClimateParams {
  seed: number;
  /** 全局温度偏移 °C */
  temperature: number;
  /** 全局降水倍率 */
  rainfall: number;
}

export interface Climate {
  /** 年均温 °C */
  temperature: Float32Array;
  /** 年降水 mm */
  precipitation: Float32Array;
  windX: Float32Array;
  windY: Float32Array;
}

const TEMP_BY_LAT = [0, 27, 15, 26, 30, 20, 45, 11, 60, 1, 75, -11, 90, -24];
const RAIN_BY_LAT = [0, 1.25, 8, 1.1, 16, 0.7, 24, 0.38, 32, 0.5, 42, 0.85, 55, 0.9, 65, 0.6, 78, 0.35, 90, 0.2];

/** 主图上 y 处的纬度(等距圆柱:上边北极 90°、下边南极 −90°;界面、图层用。生成时每个地块的纬度走 geometry 的 latitude) */
export function latitudeAt(y: number, height: number) {
  return 90 - (180 * y) / height;
}

/** 信风 / 极地东风的风向角(北半球,屏幕坐标:0 = 向东,+90° = 向南即朝赤道):吹向西、略偏赤道 */
const EASTERLY_ANGLE = Math.atan2(0.4, -1);
/** 风带交界(30°、60°)两侧各 BLEND 度内平滑转向 */
const BLEND = 5;

/**
 * 盛行风方向(屏幕坐标,y 向下 = 向南),返回单位向量。
 *
 * 西风带正好是信风掉头 180°。交界处不直接混合两个向量(正中间会抵消成零),
 * 而是让风向角度按 smoothstep 转过去:30° 处转半圈、60° 处再转回来,
 * 两次都从"朝赤道"那一侧转,所以过渡带中间的风偏向赤道吹,南北分量不为零。
 */
export function windAt(lat: number): [number, number] {
  const a = Math.abs(lat);
  const toEq = lat >= 0 ? 1 : -1; // 北半球"朝赤道" = y 增大;南半球上下镜像
  const ang =
    EASTERLY_ANGLE -
    Math.PI * smoothstep(30 - BLEND, 30 + BLEND, a) +
    Math.PI * smoothstep(60 - BLEND, 60 + BLEND, a);
  return [Math.cos(ang), Math.sin(ang) * toEq];
}

/**
 * 风力(0-1):风带内部为 1,交界线(30°、60°)上为 0,±BLEND 度内平滑变化。
 * 交界处两股风相互抵消、风弱且乱(副热带无风带 / 副极地低压带),
 * 那里的空气主要来自本地(高空下沉或就地蒸发),不是从远处顺风搬来的。
 */
function windStrength(lat: number) {
  const a = Math.abs(lat);
  const s30 = smoothstep(30 - BLEND, 30 + BLEND, a);
  const s60 = smoothstep(60 - BLEND, 60 + BLEND, a);
  // 平方:交界线附近风力降得更快,且在交界线上平滑过零(没有尖角)
  return (1 - 2 * s30) ** 2 * (1 - 2 * s60) ** 2;
}

export function seaLevelTemp(lat: number) {
  return piecewise(TEMP_BY_LAT, Math.abs(lat));
}

/** 洋流的冷暖顺风上岸:每走一个地块间距(世界单位)保留多少(内陆约 1500 公里淡到三分之一) */
const HEAT_KEEP_PER_UNIT = round24(Math.exp(-1 / (1500 / (40000 / 2048))));
/** 翻山时洋流的冷暖再减:每抬升 1000 米剩 exp(−1/1.5) */
const HEAT_RISE = 1500;
/** 贴岸的地方(不管风向)最多沾多少附近海面的冷暖;"附近"是几圈邻居 */
const COAST_PULL = 0.85;
const COAST_PASSES = 5;

/**
 * 季节:夏半年风带随太阳往北(北半球的夏天)或往南挪 SEASON_WIND 度,信风伸到 35° 上下,
 * 把大洋的水汽从大陆东岸送进去(季风:长江、珠江那样的东岸不再是一直通到海边的沙漠)。
 * 冬半年风带按全年平均的位置算。年降水 = 夏半年、冬半年各算一遍取平均;
 * 气温、风向(给图层画的盛行风)仍按全年平均的风带算
 */
const SEASON_WIND = 6;
/**
 * 副热带(纬度带降水修正 < 1 的地方)看空气从哪种洋流上吹来:
 * 暖流那边湿热不稳定,纬度带的干减轻最多 WARM_LIFT(暖 4°C 起算满);
 * 寒流那边又冷又稳,再干最多 COLD_SINK(冷 5°C 起算满)
 */
const WARM_LIFT = 0.6;
const COLD_SINK = 0.8;
/** 夏半年比年均暖、冬半年比年均冷多少(°C,纬度越高越大、陆地比海面大):只用来定空气能含多少水汽 */
const SEASON_TEMP_LAND = 0.22;
const SEASON_TEMP_SEA = 0.08;

/** 风带(按挪动的度数):风向、风力、每条邻接边的上风权重;只和网格有关,按网格记住 */
interface WindBase {
  /** 风向(windAt 原样的 64 位数,排顺风先后用)和存进结果的 32 位风向、风力 */
  wx: Float64Array;
  wy: Float64Array;
  windX: Float32Array;
  windY: Float32Array;
  strength: Float32Array;
  /** 每条邻接边的上风权重(0 = 不是上风;互为上风的已去掉)、每个地块有几个上风邻居 */
  upW: Float32Array;
  upCount: Int32Array;
  /** 邻接边 k(从 j 指向 i):j 是不是 i 的上风(拓扑排序时用,省得回头在 i 的邻居里找 j) */
  downstream: Uint8Array;
  /** 挪过的风带:每个地块按挪之前的位置属于哪条风带(主图 y;排顺风先后时按它找切口);没挪 = null */
  bandY: Float64Array | null;
}

/**
 * 只和网格(纬度)、种子有关的部分:造山侵蚀时算两次粗略降水、最后再算一次,这部分每次都一样,按网格记住
 * (种子换了只重算噪声)。存的都是和现算逐位相同的数
 */
interface ClimateBase {
  seed: number;
  /** 风带:0 = 全年平均,SEASON_WIND = 北半球的夏半年,−SEASON_WIND = 南半球的夏半年 */
  winds: Map<number, WindBase>;
  /** 海平面气温、纬度带降水修正(按纬度查表) */
  seaTemp: Float64Array;
  zonal: Float64Array;
  /** 气温、降水的噪声(按种子) */
  tNoise: Float64Array;
  pNoise: Float64Array;
}
const baseCache = new WeakMap<Mesh, ClimateBase>();

function windBase(mesh: Mesh, b: ClimateBase, shift: number): WindBase {
  const got = b.winds.get(shift);
  if (got) return got;
  const { n, adjStart, adj } = mesh;
  const geo = geometryOf(mesh);
  const wx = new Float64Array(n);
  const wy = new Float64Array(n);
  const windX = new Float32Array(n);
  const windY = new Float32Array(n);
  const strength = new Float32Array(n);
  const bandY = shift !== 0 ? new Float64Array(n) : null;
  for (let i = 0; i < n; i++) {
    // 只挪过夏天的那个半球(shift > 0 北半球,< 0 南半球):赤道辐合带跟着挪到夏半球那边 |shift| 度;
    // 另一个半球按全年平均的位置。两边在赤道上接得上(赤道两侧吹的都是冬半球那边的信风)
    const lat0 = geo.latitude(i);
    const lat = shift !== 0 && lat0 >= 0 === shift > 0 ? lat0 - shift : lat0;
    if (bandY) bandY[i] = ((90 - lat) * mesh.height) / 180;
    const [x, y] = windAt(lat);
    wx[i] = x;
    wy[i] = y;
    windX[i] = x;
    windY[i] = y;
    strength[i] = windStrength(lat);
  }
  // 每条邻接边:邻居 j 是否在 i 的上风向,以及权重(与风向越一致越大;0 = 不是上风)
  const upW = new Float32Array(adj.length);
  for (let i = 0; i < n; i++) {
    for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
      // 风从 j 那边吹来:从 i 看 j 的方向和"逆风"一致
      const dot = geo.edgeDot(i, adj[k], -windX[i], -windY[i]);
      if (dot > 0.1) upW[k] = dot;
    }
  }
  // 辐散带(副热带高压,风从这里向南北两边分开)两侧的 cell 会互相把对方当上风。
  // 其实空气是从它俩中间分开的,谁也不给谁送水汽,这种"互为上风"两边都不算。
  // 风带内部风向一致,不会出现这种情况。
  for (let i = 0; i < n; i++) {
    for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
      const j = adj[k];
      if (j <= i || upW[k] === 0) continue;
      for (let m = adjStart[j]; m < adjStart[j + 1]; m++) {
        if (adj[m] !== i) continue;
        if (upW[m] > 0) upW[k] = upW[m] = 0;
        break;
      }
    }
  }
  const upCount = new Int32Array(n);
  for (let i = 0; i < n; i++) for (let k = adjStart[i]; k < adjStart[i + 1]; k++) if (upW[k] > 0) upCount[i]++;
  const downstream = new Uint8Array(adj.length);
  for (let j = 0; j < n; j++) {
    for (let k = adjStart[j]; k < adjStart[j + 1]; k++) {
      const i = adj[k];
      for (let m = adjStart[i]; m < adjStart[i + 1]; m++) {
        if (adj[m] !== j) continue;
        if (upW[m] > 0) downstream[k] = 1;
        break;
      }
    }
  }
  const w = { wx, wy, windX, windY, strength, upW, upCount, downstream, bandY };
  b.winds.set(shift, w);
  return w;
}

function climateBase(mesh: Mesh, seed: number): ClimateBase {
  const { n, width: W } = mesh;
  const geo = geometryOf(mesh);
  const fs = 4 / W;
  let b = baseCache.get(mesh);
  if (b && b.seed === seed) return b;
  if (!b) {
    const seaTemp = new Float64Array(n);
    const zonal = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const lat = geo.latitude(i);
      seaTemp[i] = seaLevelTemp(lat);
      zonal[i] = piecewise(RAIN_BY_LAT, Math.abs(lat));
    }
    b = { seed: NaN, winds: new Map(), seaTemp, zonal, tNoise: new Float64Array(n), pNoise: new Float64Array(n) };
    baseCache.set(mesh, b);
  }
  const tNoise = geo.fbm(subSeed(seed, 'temp'), 4);
  const pNoise = geo.fbm(subSeed(seed, 'rain'), 4);
  for (let i = 0; i < n; i++) {
    b.tNoise[i] = tNoise.at(i, fs);
    b.pNoise[i] = pNoise.at(i, fs);
  }
  b.seed = seed;
  return b;
}

/** 顺风搬水汽要的、和风带无关的东西 */
interface Air {
  water: Uint8Array;
  /** 空气能含多少水汽按这个气温算 */
  temperature: Float32Array;
  smoothElev: Float32Array;
  cuts: ReturnType<ReturnType<typeof geometryOf>['windCuts']>;
  sst?: Float32Array;
  coastSst: Float32Array | null;
  coastW: Float32Array | null;
}

const BASE = 0.01; // 平地每个 cell 降掉的水汽比例

/**
 * 顺着一套风带把水汽从海上搬进内陆,一路下雨。返回每个地块降掉的水汽(rain,沿海平地 ≈ BASE)
 * 和陆地上顺风带来的洋流冷暖(landHeat,°C;没给洋流 = 全 0)
 */
function carryMoisture(mesh: Mesh, wind: WindBase, air: Air) {
  const { n, adjStart, adj } = mesh;
  const geo = geometryOf(mesh);
  const { wx, wy, strength, upW, downstream, bandY } = wind;
  const { water, temperature, smoothElev, cuts, sst, coastSst, coastW } = air;

  const key = new Float32Array(n);
  for (let i = 0; i < n; i++) key[i] = geo.downwind(i, wx[i], wy[i], cuts, bandY ? bandY[i] : undefined);
  const waiting = wind.upCount.slice(); // 还没算完的上风邻居个数

  // 计算顺序:每个 cell 等它的上风邻居都算完再算(拓扑排序)。
  // 风向在风带交界处随纬度转弯,"位置在风向上的投影"就不再是处处一致的先后顺序,
  // 所以投影只用来在万一遇到环路时挑一个先算的。
  const byKey = orderByKey(key);
  const order = new Int32Array(n);
  const queued = new Uint8Array(n);
  let head = 0;
  let tail = 0;
  let nextKey = 0;
  let cycles = 0;
  for (let a = 0; a < n; a++) {
    const i = byKey[a];
    if (waiting[i] === 0) {
      order[tail++] = i;
      queued[i] = 1;
    }
  }
  while (tail < n) {
    if (head === tail) {
      cycles++;
      while (queued[byKey[nextKey]]) nextKey++;
      const i = byKey[nextKey];
      order[tail++] = i;
      queued[i] = 1;
    }
    const j = order[head++];
    for (let k = adjStart[j]; k < adjStart[j + 1]; k++) {
      const i = adj[k];
      if (queued[i]) continue;
      if (downstream[k] && --waiting[i] === 0) {
        order[tail++] = i;
        queued[i] = 1;
      }
    }
  }

  const hum = new Float32Array(n);
  const rain = new Float32Array(n);
  /** 空气里带着的洋流冷暖(°C);陆地上就是这里的气温偏差 */
  const heat = new Float32Array(n);
  const landHeat = new Float32Array(n);
  const heatKeep = round24(HEAT_KEEP_PER_UNIT ** mesh.spacing);
  const ORO = 0.00018; // 每米抬升额外降水比例
  const RECYCLE = 0.7; // 陆地降水被植被 / 土壤再蒸发回空气的比例
  const satOf = (i: number) => clamp((temperature[i] + 12) / 38, 0.12, 1);
  /** 没有风送来水汽时的本地湿度:海面接近饱和,陆地偏干 */
  const localHum = (i: number) => (water[i] !== 0 ? satOf(i) : 0.3);
  // 按上风先算的顺序扫一遍就是准确解。万一有环路,环路里先算的那个 cell 只能用初值,
  // 再扫第二遍用上一遍的结果补救
  for (let i = 0; i < n; i++) hum[i] = localHum(i);
  for (let sweep = 0; sweep < (cycles > 0 ? 2 : 1); sweep++) {
    for (let a = 0; a < n; a++) {
      const i = order[a];
      let sw = 0;
      let sh = 0;
      let se = 0;
      let sq = 0;
      for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
        const dot = upW[k];
        if (dot === 0) continue;
        const j = adj[k];
        sw += dot;
        sh += dot * hum[j];
        se += dot * smoothElev[j];
        sq += dot * heat[j];
      }
      const isSea = water[i] !== 0;
      const sat = satOf(i);
      // 风越弱,顺风搬来的水汽占比越小,越接近本地湿度
      const local = localHum(i);
      let hm = sw > 0 ? local + (sh / sw - local) * strength[i] : local;
      const ue = sw > 0 ? se / sw : 0;
      if (isSea) {
        hm += (sat - hm) * 0.22;
        rain[i] = hm * BASE * 1.2;
      } else {
        const rise = Math.max(0, smoothElev[i] - ue);
        let frac = clamp(BASE + ORO * rise, 0, 0.6);
        if (sst) {
          // 顺风带来的冷暖(风越弱越少),贴岸再往附近海面的冷暖拉一把
          let q = sw > 0 ? (sq / sw) * Math.sqrt(strength[i]) : 0;
          q += (coastSst![i] - q) * coastW![i];
          // 寒流岸边空气稳定,不爱下雨;暖流岸边湿热,多下一点
          frac *= q < 0 ? Math.max(0.2, 1 + 0.2 * q) : 1 + 0.04 * Math.min(q, 5);
          heat[i] = q * heatKeep * round24(Math.exp(-rise / HEAT_RISE));
          landHeat[i] = q;
        }
        const r = hm * frac;
        hm = hm - r + r * RECYCLE * clamp(sat, 0.3, 1);
        rain[i] = r;
      }
      if (sst && isSea) {
        // 海面上的空气很快染上海水的冷暖
        const up = sw > 0 ? (sq / sw) * strength[i] : 0;
        heat[i] = up + (sst[i] - up) * 0.35;
      }
      hum[i] = hm;
    }
  }
  return { rain, landHeat };
}

/**
 * elev:海拔(米,海洋为负);water:0 陆地 / 1 海洋 / 2 湖泊。
 * currents:洋流(不给 = 不算洋流;造山侵蚀时用的粗略降水不算,地形和以前一样)。
 * seasons:年降水按夏半年、冬半年两套风带分别算再平均(季风、地中海式冬雨,见 SEASON_WIND);
 * 不给 = 只按全年平均的风带算一遍(造山侵蚀时的粗略降水这样算,地形和以前一样)
 */
export function computeClimate(
  mesh: Mesh,
  elev: Float32Array,
  water: Uint8Array,
  p: ClimateParams,
  currents?: Currents,
  seasons = false,
  // 星球系派生出来的修正(astro = 0 时不传):辐照 + 温室的气温差、倾角带来的极地增温、自转与气压带来的降水倍率。
  // 不进 ClimateParams、也不进 World.climate:那是要存进世界文件、要过校验的东西,只认数
  mods: import('./astro').ClimateMods | null = null,
): Climate {
  const { n } = mesh;
  const geo = geometryOf(mesh);
  const base = climateBase(mesh, p.seed);
  const annual = windBase(mesh, base, 0);

  const temperature = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const e = water[i] === 1 ? 0 : Math.max(0, elev[i]);
    temperature[i] = base.seaTemp[i] + p.temperature - 0.0065 * e + 1.5 * base.tNoise[i];
    if (currents && water[i] === 1) temperature[i] += currents.sst[i];
    // 星球系:辐照 + 温室带来的整体温差;倾角大时极地增温(地球基线时两项都恰好是 0 / 不执行)
    if (mods) {
      temperature[i] += mods.tempOffset;
      if (mods.polarWarm !== 0) {
        const c = round24(Math.cos(round24(geo.latitude(i) * (Math.PI / 180))));
        temperature[i] += mods.polarWarm * (1 - c) * 9;
      }
      // 自转慢(或潮汐锁定):向阳经度热、背阴经度冷,形成一个固定的昼夜温差场
      if (mods.diurnalK !== 0) {
        const lonDeg = round24((mesh.x[i] / mesh.width) * 360 - 180);
        temperature[i] += mods.diurnalK * round24(Math.cos(round24(lonDeg * (Math.PI / 180))));
      }
    }
  }

  // 贴岸的陆地沾附近海面的冷暖(不管风向):附近海面偏差的平均 + 附近有多少是海
  const sst = currents?.sst;
  let coastSst: Float32Array | null = null;
  let coastW: Float32Array | null = null;
  if (sst) {
    const seaF = new Float32Array(n);
    for (let i = 0; i < n; i++) seaF[i] = water[i] === 1 ? 1 : 0;
    const num = blurField(mesh, sst, COAST_PASSES);
    const den = blurField(mesh, seaF, COAST_PASSES);
    coastSst = new Float32Array(n);
    coastW = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (water[i] === 1 || den[i] === 0) continue;
      coastSst[i] = num[i] / den[i];
      coastW[i] = COAST_PULL * clamp(den[i] * 3, 0, 1);
    }
  }

  // 地形抬升按平滑后的海拔算:气流感受的是整片山地,不是单个山头
  const landElev = new Float32Array(n);
  for (let i = 0; i < n; i++) landElev[i] = water[i] === 1 ? 0 : Math.max(0, elev[i]);
  const smoothElev = blurField(mesh, landElev, 3);

  // 球面上风带绕星球一整圈、没有起点:每条风带在最大的那片大洋中间切开
  const air: Air = { water, temperature, smoothElev, cuts: geo.windCuts(water), sst, coastSst, coastW };
  const year = carryMoisture(mesh, annual, air);
  const precipitation = new Float32Array(n);
  /** 降掉的水汽(沿海平地 ≈ BASE)× 纬度带修正 → 年降水(mm),加到 precipitation 上 */
  const addRain = (rain: Float32Array, zonal: (i: number) => number, share: number, heat: Float32Array | null) => {
    const rainS = blurField(mesh, rain, 2);
    for (let i = 0; i < n; i++) {
      const rel = rainS[i] / BASE; // 沿海平地 ≈ 1
      let z = zonal(i);
      // 暖流那边吹来的空气湿热不稳定,副热带高压压不住(大陆东岸:长江、珠江、佛罗里达):纬度带的干减轻
      if (heat && z < 1 && heat[i] > 0) z += (1 - z) * WARM_LIFT * Math.min(1, heat[i] / 4);
      // 寒流那边吹来的空气又冷又稳,副热带更干(大陆西岸的海边沙漠:阿塔卡马、纳米布)
      else if (heat && z < 1 && heat[i] < 0) z *= 1 - COLD_SINK * Math.min(1, -heat[i] / 5);
      const v = rel * z * (1 + 0.18 * base.pNoise[i]);
      precipitation[i] += share * Math.max(0, v * 1500 * p.rainfall);
    }
  };
  if (!seasons) addRain(year.rain, (i) => base.zonal[i], 1, null);
  else {
    for (const s of [1, -1]) {
      // s = 1:北半球夏半年(南半球冬半年);s = −1 反过来
      const tSeason = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const lat = geo.latitude(i);
        const amp = (water[i] === 1 ? SEASON_TEMP_SEA : SEASON_TEMP_LAND) * Math.abs(lat);
        tSeason[i] = temperature[i] + year.landHeat[i] + (lat >= 0 ? s : -s) * amp;
      }
      const half = carryMoisture(mesh, windBase(mesh, base, s * SEASON_WIND), { ...air, temperature: tSeason });
      addRain(half.rain, (i) => base.zonal[i], 0.5, sst ? half.landHeat : null);
    }
  }

  if (sst) for (let i = 0; i < n; i++) temperature[i] += year.landHeat[i];
  // 星球系:降水倍率(自转快慢、表面气压)。地球基线时恰好是 1,不乘
  if (mods && mods.rainScale !== 1) for (let i = 0; i < n; i++) precipitation[i] *= mods.rainScale;
  return { temperature, precipitation, windX: annual.windX.slice(), windY: annual.windY.slice() };
}
