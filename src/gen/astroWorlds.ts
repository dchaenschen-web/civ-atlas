/**
 * 本星系其他固态行星的地表:同一套生成管线(generateWorld)、按预算档降精度。
 *
 * 分配原则(WorldParams 里的设计参数派生,不写死):
 *   - 有地质活动(geoActivity ≥ 0.35)的固态行星:9000 地块,像颗有板块的行星;
 *   - 死星(没有地质活动):4000 地块,只会是一颗满是陨击、没有海洋的石头;
 *   - 气态行星:0,不做地表(只参与轨道、天象、磁场);
 *   - 主行星:-1,用主世界的精细度(不在这里生成)。
 *
 * 全部**懒生成**:只有打开星系页 / 导出设定集时才跑;总预算超了就按"先砍死星、再砍最远的"降级。
 * 每颗行星的种子从主世界种子里派生,地形/气候和历史无关,同一世界永远长出同一批行星。
 */
import { clamp, subSeed } from './util';
import { DEFAULT_PARAMS, type WorldParams } from './params';
import { generateWorld, type World } from './world';
import type { AstroSystem } from './astro';
import { GAS_NAMES, type AstroDesign, type BodyGen, type PlanetDesign, type SurfaceOverride } from './astroDesign';
import { applySkin, skinOf, type SurfaceSkin } from './surfaceKinds';
import { planetTypeOf } from './astroDesign';
import { BIOMES } from './biomes';
import { geometryOf } from './geometry';
import { geologyOf } from './geology';
import type { TerrainOp } from './edits';
import { phasesOf, surfaceHints } from './materials';
import type { Sketch } from './sketch';

/** 其他行星地表一共最多生成多少地块(保护内存和等待时间) */
export const MAX_EXTRA_CELLS = 36000;

/** 按种子取 [0,1) 的数 */
function unit(seed: number, tag: string): number {
  return (subSeed(seed, 'astro-world:' + tag) % 1_000_000) / 1_000_000;
}

/** 一颗行星的生成参数(从设计层派生;seed 由主世界种子和行星下标派生) */
/** 这颗行星的地貌风格(离线预览、地形编辑器、生成塑形共用同一个判定) */
export function planetSkin(sys: AstroSystem, index: number, base: WorldParams, surf?: SurfaceOverride, gen?: BodyGen): SurfaceSkin {
  const p = sys.design.planets[index];
  if (!p) return 'earth';
  const surfTempK = p.tempK + (gen?.temperature ?? surf?.temperature ?? 0);
  const phase = phasesOf(surfTempK, p.atmos.pressure, { hasWater: gen?.water ?? p.hydro });
  return skinOf({ type: planetTypeOf(p), tempK: surfTempK, liquidWater: phase.water === 'liquid', hydro: gen?.water ?? p.hydro });
}

export function planetWorldParams(sys: AstroSystem, index: number, base: WorldParams, surf?: SurfaceOverride, gen?: BodyGen): WorldParams {
  const p = sys.design.planets[index];
  const seed = gen?.seed ?? (subSeed(base.seed, `astro-planet:${index}`) >>> 0 || 1);
  const geo = p.geoActivity;
  // 有液态水的行星:海陆比例按水圈和温度派生;没有水圈的死星几乎全是陆地
  const baseLand = (gen?.water ?? p.hydro) ? Math.min(0.45, Math.max(0.15, 0.3 + 0.12 * (1 - Math.abs(p.tempK - 288) / 60))) : 0.98;
  // 再看这颗行星自己的温度/气压下,水是液、冰还是汽,以及二氧化碳/氨/甲烷的状态(gen/materials.ts)
  const surfTempK = p.tempK + (gen?.temperature ?? surf?.temperature ?? 0);
  const phases = phasesOf(surfTempK, p.atmos.pressure, { hasWater: gen?.water ?? p.hydro });
  const hint = surfaceHints(phases);
  const landFraction = clamp(gen?.landFraction ?? surf?.landFraction ?? Math.min(0.96, Math.max(baseLand, hint.minLand)), 0.02, 0.98);
  const plates = Math.round(gen?.plates ?? 4 + 40 * geo);
  const cells = clamp(Math.round(gen?.cells ?? surf?.cells ?? (sys.design.budget[index] > 0 ? sys.design.budget[index] : 6400)), 200, 200000);
  const params: WorldParams = {
    ...DEFAULT_PARAMS,
    seed,
    // 主行星用主世界的精细度,别的按预算(0 = 不做地表;这里不生成气态行星)
    cells,
    landFraction,
    plates: Math.max(2, Math.min(64, plates)),
    continents: Math.max(1, Math.min(6, Math.round(1 + 4 * geo))),
    gather: Math.round(unit(seed, 'gather') * 10) / 10,
    rugged: Math.max(0.2, Math.min(2.5, 0.6 + 0.8 * geo + unit(seed, 'rugged') * 0.4)),
    hardness: Math.max(0.3, Math.min(3, 0.5 + 1.2 * geo)),
    north: unit(seed, 'north') * 0.4 - 0.2,
    mountains: Math.max(0, Math.min(5, gen?.mountains ?? 0.2 + 1.6 * geo)),
    // 气温偏移按层平均温度折算(地球 288 K = 0),范围照 PARAM_RANGE
    temperature: clamp(Math.round((gen?.temperature ?? surf?.temperature ?? p.tempK - 288) * 10) / 10, -40, 40),
    // 降水:辐照越强、自转越慢(环流越强)越多;死星几乎没有
    rainfall: clamp(Math.round((gen?.rainfall ?? surf?.rainfall ?? (p.hydro ? 0.3 + 0.7 * Math.sqrt(Math.max(0.05, p.mass)) : 0.08) * hint.rainScale) * 100) / 100, 0, 5),
    // 其他行星不套自己的星球系(避免递归)
    astro: 0,
    system: 0,
    planets: 0,
    gas: 0,
    moons: 0,
    tilt: Math.round(p.tilt * 10) / 10,
    rotation: Math.round(p.rotation * 10) / 10,
    geo: Math.max(0.4, Math.min(3, p.geoActivity * 3)),
    mag: Math.max(0, Math.min(2, p.magnetic)),
  };
  // 步6:按行星类型换地貌配方(海洋/干旱/冰封/熔岩/无大气/矮行星);用户显式改过的参数优先
  const skin = skinOf({ type: planetTypeOf(p), tempK: surfTempK, liquidWater: phases.water === 'liquid', hydro: gen?.water ?? p.hydro });
  const fixed = new Set<keyof WorldParams>();
  if (gen?.landFraction !== undefined || surf?.landFraction !== undefined) fixed.add('landFraction');
  if (gen?.temperature !== undefined || surf?.temperature !== undefined) fixed.add('temperature');
  if (gen?.rainfall !== undefined || surf?.rainfall !== undefined) fixed.add('rainfall');
  if (gen?.mountains !== undefined) fixed.add('mountains');
  if (gen?.plates !== undefined) fixed.add('plates');
  if (gen?.cells !== undefined) fixed.add('cells');
  return applySkin(params, skin, fixed);
  return applySkin(params, skin);
}

/** 哪些行星要做地表(气态行星不做;主行星在别处) */
export function surfacePlanets(sys: AstroSystem): number[] {
  return sys.design.planets.map((p, i) => (p.kind === 'rocky' && i !== sys.home.index ? i : -1)).filter((i) => i >= 0);
}

/** 按总预算挑出这次要生成的行星(先保活跃的、近的;砍掉死星和后头的) */
export function planSurfaces(sys: AstroSystem): { index: number; cells: number }[] {
  const want = surfacePlanets(sys)
    .map((index) => ({ index, cells: sys.design.budget[index], geo: sys.design.planets[index].geoActivity }))
    .sort((a, b) => b.geo - a.geo || a.index - b.index);
  const out: { index: number; cells: number }[] = [];
  let used = 0;
  for (const w of want) {
    if (used + w.cells > MAX_EXTRA_CELLS) continue;
    used += w.cells;
    out.push({ index: w.index, cells: w.cells });
  }
  return out.sort((a, b) => a.index - b.index);
}

/** 懒生成器:同一颗行星只生成一次(按世界对象缓存) */
const cache = new WeakMap<AstroSystem, Map<string, World>>();

/** 生成(或取缓存)某颗行星的地表;sketch 给了就照那张手绘图长(不走缓存,草图对象没有稳定指纹) */
export function planetSurface(
  sys: AstroSystem,
  index: number,
  base: WorldParams,
  ops: readonly TerrainOp[] = [],
  surf?: SurfaceOverride,
  gen?: BodyGen,
  sketch?: Sketch | null,
): World {
  // 步6:气态行星不生成地表(只出程序化带纹贴图;见 render/planetViz 与 ui/studio/bodyGlobe)
  if (sys.design.planets[index] && planetTypeOf(sys.design.planets[index]) !== 'rocky' && planetTypeOf(sys.design.planets[index]) !== 'dwarf') {
    throw new Error('气态行星没有地表:只用程序化贴图');
  }
  const params = planetWorldParams(sys, index, base, surf, gen);
  const skin = planetSkin(sys, index, base, surf, gen);
  if (sketch) return generateWorld(params, undefined, ops.length ? (ops as TerrainOp[]) : undefined, sketch, undefined, undefined, skin);
  let m = cache.get(sys);
  if (!m) {
    m = new Map();
    cache.set(sys, m);
  }
  // 缓存键要带上这颗行星自己的地形修改、地表参数与生成参数(改了任何一样就换一份世界)
  const key = `${index}|${ops.length ? JSON.stringify(ops) : ''}|${surf ? JSON.stringify(surf) : ''}|${gen ? JSON.stringify(gen) : ''}`;
  const hit = m.get(key);
  if (hit) return hit;
  const w = generateWorld(params, undefined, ops.length ? (ops as TerrainOp[]) : undefined, undefined, undefined, undefined, skin);
  m.set(key, w);
  return w;
}

/** 这次要做的行星地表(逐颗生成;界面可以按需一颗颗要) */
export function systemSurfaces(sys: AstroSystem, base: WorldParams): { index: number; params: WorldParams; world: World }[] {
  return planSurfaces(sys).map(({ index }) => {
    const params = planetWorldParams(sys, index, base);
    return { index, params, world: planetSurface(sys, index, base) };
  });
}

/** 一颗行星地表的几项概况(界面、设定集用:开一次地表生成以后显示) */
export interface SurfaceStats {
  /** 陆地占表面积 */
  landPct: number;
  /** 陆地平均温度(°C,按面积加权) */
  meanTempC: number;
  rivers: number;
  maxElev: number;
  volcanoes: number;
  /** 占比最大的几种生物群落 */
  biomes: { name: string; pct: number }[];
}

/** 算一颗行星地表的概况(纯读;不打图) */
export function planetSurfaceStats(w: World): SurfaceStats {
  const { mesh, water, temperature, biome, rivers, maxElevation } = w;
  const geo = geometryOf(mesh);
  const area = geo.cellAreas();
  let land = 0;
  let total = 0;
  let tSum = 0;
  let tArea = 0;
  const byBiome = new Map<number, number>();
  for (let i = 0; i < mesh.n; i++) {
    const a = area[i];
    total += a;
    if (water[i] === 1) continue;
    land += a;
    tSum += temperature[i] * a;
    tArea += a;
    byBiome.set(biome[i], (byBiome.get(biome[i]) ?? 0) + a);
  }
  return {
    landPct: total > 0 ? land / total : 0,
    meanTempC: tArea > 0 ? tSum / tArea : 0,
    rivers: rivers.length,
    maxElev: Math.round(maxElevation),
    volcanoes: geologyOf(w).volcanoes.length,
    biomes: [...byBiome]
      .map(([b, a]) => ({ name: BIOMES[b].name, pct: a / total }))
      .sort((x, y) => y.pct - x.pct)
      .slice(0, 5),
  };
}

/** 一颗行星的一句话描述(界面、设定集用) */
export function planetSummary(p: PlanetDesign): string {
  const kind = p.kind === 'gas' ? '气态行星' : p.hydro ? '海洋行星' : p.geoActivity > 0.35 ? '岩石行星' : '死星';
  const air = p.atmos.gases.slice(0, 2).map((g) => `${GAS_NAMES[g.id]} ${(g.frac * 100).toFixed(0)}%`).join('、');
  return `${kind} · 半径 ${p.radius.toFixed(2)} R⊕ · ${air || '几乎没有大气'}`;
}
/** 这颗行星当前温度/气压下各种物质的状态(界面显示用;和地表生成用的是同一个 phasesOf) */
export function planetPhases(sys: AstroSystem, index: number, surf?: SurfaceOverride, gen?: BodyGen) {
  const p = sys.design.planets[index];
  if (!p) return null;
  const tempK = p.tempK + (gen?.temperature ?? surf?.temperature ?? 0);
  return phasesOf(tempK, p.atmos.pressure, { hasWater: gen?.water ?? p.hydro });
}

/** 这颗卫星按母行星的温度/气压估的物质状态(卫星自己的温度在 S4 里没单独建模) */
export function moonPhases(design: AstroDesign, planetIndex: number, moonIndex: number, surf?: SurfaceOverride, gen?: BodyGen) {
  const p = design.planets[planetIndex];
  const m = p?.moons[moonIndex];
  if (!p || !m) return null;
  // 锁定的卫星更冷一点(永远同一面朝母星,热量分布极端,这里取略低)
  const tempK = p.tempK - (m.locked ? 25 : 10);
  return phasesOf(tempK + (gen?.temperature ?? surf?.temperature ?? 0), p.atmos.pressure, { hasWater: gen?.water ?? false });
}