/**
 * 多行星/卫星星系:设计层之上的聚合与覆盖表。
 *
 * 这一层不碰 `World`(一颗行星一个 World):它只说"这个星系长什么样、每颗行星/卫星被改过什么"。
 * 覆盖表(overrides)只记和种子派生值不一样的地方;不填 = 现在的世界(默认逐字节不变)。
 *
 * 约定:
 *   - 所有派生量都是纯函数(种子 + 覆盖表),同一输入永远同一输出;
 *   - 3D 示意图、行星/卫星卡片、地形生成、撞击率,全都吃这里的 `effective` 设计。
 */
import { generateAstro } from './astro';
import { BUDGET, type AstroDesign, type MoonDesign, type PlanetDesign } from './astroDesign';
import { planetSurfaceStats, type SurfaceStats } from './astroWorlds';
import { DEFAULT_PARAMS, type WorldParams } from './params';
import { clamp, subSeed } from './util';
import { generateWorld, type World } from './world';
import type { Sketch } from './sketch';
import type { TerrainOp } from './edits';
import { phasesOf, surfaceHints } from './materials';

/** 轨道覆盖:只写改过的项(半长轴 AU / 偏心率 / 黄道角 / 升交点,单位同设计层) */
export interface OrbitOverride {
  a?: number;
  ecc?: number;
  incDeg?: number;
  nodeDeg?: number;
}

/** 一颗行星的覆盖(索引 + 改过的项) */
export interface PlanetOverride extends OrbitOverride {
  index: number;
  radius?: number;
  tilt?: number;
  rotation?: number;
  /** 0 自动、1 有生物圈(可呼吸)、2 无生命 */
  life?: number;
  /** 只重掷这一颗(0 = 不掷) */
  reroll?: number;
  /** 地形编辑记录(复用原版 edits.terrain 的形状;这里只做透传与存档) */
  terrain?: readonly unknown[];
  /** 是不是文明起点(不写 = 按设计层的主行星) */
  home?: boolean;
}

/** 一颗卫星的覆盖 */
export interface MoonOverride extends OrbitOverride {
  planet: number;
  moon: number;
  /** 绕母行星的距离(母行星半径数) */
  distance?: number;
  radius?: number;
  locked?: boolean;
  life?: number;
  reroll?: number;
  terrain?: readonly unknown[];
}

/** 小行星带(默认没有;impact ≥ 1 才生成) */
export interface BeltDesign {
  innerAU: number;
  outerAU: number;
  /** 画 3D 粒子用的数量(千颗量级) */
  count: number;
  /** 带的倾角(度) */
  incDeg: number;
  /** 打散粒子用的种子 */
  seed: number;
}

export interface SystemOverrides {
  planets: readonly PlanetOverride[];
  moons: readonly MoonOverride[];
  /** 用户指定的带(不写 = 按种子生成) */
  belts?: readonly BeltDesign[];
}

export function emptyOverrides(): SystemOverrides {
  return { planets: [], moons: [] };
}

/** 覆盖表是不是空的(空 = 和种子派生的一模一样) */
export function overridesEmpty(o: SystemOverrides | null | undefined): boolean {
  return !o || (o.planets.length === 0 && o.moons.length === 0 && !(o.belts && o.belts.length));
}

/** 覆盖里没写的项保留原值 */
function withOrbit<T extends OrbitOverride>(p: PlanetDesign, o: T): PlanetDesign {
  return {
    ...p,
    a: o.a ?? p.a,
    ecc: o.ecc ?? p.ecc,
    incDeg: o.incDeg ?? p.incDeg,
    nodeDeg: o.nodeDeg ?? p.nodeDeg,
  };
}

/** 把覆盖表套到设计层上(纯函数;空覆盖表 = 原样)。life 要重算大气,放在 S2 的模型里处理 */
export function applyOverrides(design: AstroDesign, overrides: SystemOverrides): AstroDesign {
  const byIndex = new Map(overrides.planets.map((o) => [o.index, o]));
  const planets = design.planets.map((p) => {
    const o = byIndex.get(p.index);
    if (!o) return p;
    const q = withOrbit(p, o);
    return {
      ...q,
      radius: o.radius ?? q.radius,
      tilt: o.tilt ?? q.tilt,
      rotation: o.rotation ?? q.rotation,
    };
  });
  const homeIdx = overrides.planets.find((o) => o.home)?.index ?? design.home.index;
  return { ...design, planets, home: { ...design.home, index: homeIdx } };
}

/**
 * 小行星带:impact = 0 时一条也没有(默认世界不进生成流程);
 * impact ≥ 1 时在宜居带外的"冻线"附近长 1–2 条主带,参数全由种子派生。
 */
export function beltsOf(design: AstroDesign, seed: number, impact: number): BeltDesign[] {
  if (impact < 1) return [];
  const aHz = Math.sqrt(design.star.lum);
  const n = impact >= 2 ? 2 : 1 + (unit(seed, 'beltN') > 0.6 ? 1 : 0);
  const out: BeltDesign[] = [];
  for (let i = 0; i < n; i++) {
    const mid = aHz * ranged(seed, `beltM${i}`, 1.8, 3.4);
    const half = aHz * ranged(seed, `beltH${i}`, 0.25, 0.7);
    out.push({
      innerAU: Math.max(0.02, mid - half),
      outerAU: mid + half,
      count: Math.round(ranged(seed, `beltC${i}`, 600, 2400)),
      incDeg: ranged(seed, `beltI${i}`, 0.5, 6),
      seed: subSeed(seed, `belt:${i}`) >>> 0,
    });
  }
  return out;
}

/** 按种子取 [0,1) 的数 */
function unit(seed: number, tag: string): number {
  return (subSeed(seed, 'system:' + tag) % 1_000_000) / 1_000_000;
}

function ranged(seed: number, tag: string, lo: number, hi: number): number {
  return lo + unit(seed, tag) * (hi - lo);
}

/**
 * 某颗行星的陨击率系数(相对"没有带的普通行星" = 1)。
 * 全是设计层的数:穿不穿带、带多密、有没有巨行星挡、有没有大卫星挡、大气厚不厚。
 */
export function impactRateOf(design: AstroDesign, belts: readonly BeltDesign[], planetIndex: number): number {
  const p = design.planets[planetIndex];
  if (!p) return 1;
  let rate = 1;
  // 穿带:轨道(含偏心率摆幅)和带的范围有交叠就算穿越
  const swing = p.a * p.ecc;
  for (const b of belts) {
    const lo = b.innerAU;
    const hi = b.outerAU;
    if (p.a + swing > lo && p.a - swing < hi) {
      const density = b.count / 1500;
      rate += 2.5 + 3 * density;
    }
  }
  // 巨行星的引力清扫:比它靠里的行星更安全(木星盾)
  const giantsInside = design.planets.some((q) => q.kind === 'gas' && q.a < p.a);
  if (giantsInside) rate /= 2.5;
  // 大卫星也挡一部分
  const bigMoons = p.moons.filter((m) => m.radius >= 0.5).length;
  if (bigMoons) rate /= 1 + 0.4 * bigMoons;
  // 大气太薄,小陨石烧不掉
  const pressure = p.atmos?.pressure ?? 1;
  if (pressure < 0.3) rate *= 1.6;
  return Math.max(0.05, rate);
}

/** 卫星的地表生成参数:同一套生成管线,预算档更低(大卫星 4000 / 小卫星 2000) */
export function moonWorldParams(design: AstroDesign, planetIndex: number, moonIndex: number, base: WorldParams, surf?: import('./astroDesign').SurfaceOverride, gen?: import('./astroDesign').BodyGen): WorldParams {
  const planet = design.planets[planetIndex];
  const moon = planet?.moons[moonIndex];
  if (!planet || !moon) throw new Error(`没有这颗卫星: ${planetIndex}/${moonIndex}`);
  const seed = gen?.seed ?? (subSeed(base.seed, `astro-moon:${planetIndex}:${moonIndex}`) >>> 0 || 1);
  // 卫星以岩石/冰为主,几乎没有水圈(锁定的更干),陆地比例高;
  // 具体是冰壳还是干岩,按母行星的温度/气压估一下(gen/materials.ts;卫星自己的温度没单独建模)
  const moonTempK = planet.tempK - (moon.locked ? 25 : 10);
  const hint = surfaceHints(phasesOf(moonTempK, planet.atmos.pressure, { hasWater: gen?.water ?? false }));
  const landFraction = clamp(gen?.landFraction ?? surf?.landFraction ?? Math.min(0.98, Math.max(moon.locked ? 0.96 : 0.88, hint.minLand)), 0.02, 0.98);
  return {
    ...DEFAULT_PARAMS,
    seed,
    cells: clamp(Math.round(gen?.cells ?? surf?.cells ?? (moon.radius >= 0.5 ? BUDGET.activeRocky : BUDGET.deadRocky / 2)), 200, 200000),
    landFraction,
    // 气温偏移、降水按母行星的温度与物质状态给(冰壳卫星几乎不降水)
    temperature: clamp(Math.round((gen?.temperature ?? surf?.temperature ?? moonTempK - 288) * 10) / 10, -40, 40),
    rainfall: clamp(Math.round((gen?.rainfall ?? surf?.rainfall ?? 0.3 * hint.rainScale) * 100) / 100, 0, 5),
    plates: Math.max(2, Math.min(64, Math.round(gen?.plates ?? 3 + 12 * (moon.radius >= 0.5 ? 0.6 : 0.2)))),
    mountains: Math.max(0, Math.min(5, gen?.mountains ?? 0.2 + 0.8 * Math.min(1, moon.radius / 0.6))),
    // 卫星的地质活动按半径给:大的像类地行星,小的基本是死石头
    geo: 0.5 + 0.8 * Math.min(1, moon.radius / 0.6),
    astro: 0,
  };
}

/** 卫星地表缓存(按参数键;同一个星系里点开两次不重算) */
const moonCache = new Map<string, { world: World; stats: SurfaceStats }>();
const MOON_CACHE_MAX = 8;

/** 生成(或复用)一颗卫星的地表 */
export function moonSurface(
  system: SolarSystem,
  planetIndex: number,
  moonIndex: number,
  ops: readonly TerrainOp[] = [],
  surf?: import('./astroDesign').SurfaceOverride,
  gen?: import('./astroDesign').BodyGen,
  sketch?: Sketch | null,
): { world: World; stats: SurfaceStats } | null {
  const moon = system.design.planets[planetIndex]?.moons[moonIndex];
  if (!moon) return null;
  const params = moonWorldParams(system.effective, planetIndex, moonIndex, system.params, surf, gen);
  // 手绘图也进缓存键:换了图就是另一颗卫星
  const key = [JSON.stringify(params), ops.length ? JSON.stringify(ops) : '', sketch ? 'sk' : ''].join('|');
  if (sketch) {
    // 带手绘图的卫星不走缓存:草图对象没有稳定指纹,现算一次(卫星精度低,几十毫秒)
    const w = generateWorld(params, undefined, ops.length ? (ops as TerrainOp[]) : undefined, sketch);
    return { world: w, stats: planetSurfaceStats(w) };
  }
  const hit = moonCache.get(key);
  if (hit) return hit;
  // 卫星没有设计层里的一格(planets 里没有它),直接按派生参数生成一个普通世界(astro = 0:不再递归带星系)
  const world = ops.length ? generateWorld(params, undefined, ops as TerrainOp[]) : generateWorld(params);
  const stats = planetSurfaceStats(world);
  moonCache.set(key, { world, stats });
  if (moonCache.size > MOON_CACHE_MAX) moonCache.delete(moonCache.keys().next().value as string);
  return { world, stats };
}

/** 卫星列表(给 S2 的卡片用):绕哪颗行星、下标、预算 */
export function planMoonSurfaces(system: SolarSystem): { planet: number; moon: number; name: string; cells: number; locked: boolean; radius: number }[] {
  const out: { planet: number; moon: number; name: string; cells: number; locked: boolean; radius: number }[] = [];
  system.design.planets.forEach((p, pi) => {
    p.moons.forEach((m, mi) => {
      out.push({ planet: pi, moon: mi, name: `P${pi + 1}-M${mi + 1}`, cells: m.radius >= 0.5 ? BUDGET.activeRocky : BUDGET.deadRocky / 2, locked: m.locked, radius: m.radius });
    });
  });
  return out;
}

/** 星系聚合:S1 里只有"设计 + 覆盖 + 带";行星/卫星的 World 到 S4 再挂进来 */
export interface SolarSystem {
  params: WorldParams;
  /** 种子派生的设计(不含覆盖) */
  design: AstroDesign;
  overrides: SystemOverrides;
  /** 覆盖套上去以后的设计(3D/卡片/地形都用它) */
  effective: AstroDesign;
  belts: BeltDesign[];
  /** 主行星的世界(有就挂上;这是文明起点) */
  world: World | null;
}

/**
 * 从一个世界(或只有参数)拿到星系。
 * astro = 0 时返回 null(没有星系层);world 给的 design 优先用已经生成好的那份,保证和主世界一致。
 */
export function systemOf(world: World | null, params?: WorldParams): SolarSystem | null {
  const p = params ?? world?.params;
  if (!p || p.astro !== 1) return null;
  const design = world?.astro?.design ?? generateAstro(p).design;
  const overrides = emptyOverrides();
  const effective = applyOverrides(design, overrides);
  return {
    params: p,
    design,
    overrides,
    effective,
    belts: beltsOf(design, p.seed, p.impact),
    world: world ?? null,
  };
}
