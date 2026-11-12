/**
 * 星球系:把设计层(astroDesign.ts)的结果配上**天象周期**,挂到 World 上。
 *
 * 名字不在这里起:名字库(12 语感)很大,只有星系页和编年史要,放在 astroNames.ts,
 * 这样生成流程和主线程都不会因为这一层多带一份词库。
 *
 * 约定:
 *   - WorldParams.astro = 0(默认)时不生成世界里的星球系,World.astro 不写,世界和加这一层以前逐字节一样;
 *   - World.astro 是**派生数据**:世界文件不存它(worldFile.ts 存的时候去掉),读回来按 params 重算(astroOf),
 *     所以不用改世界文件格式、也不用加校验;
 *   - 全部随机数来自 subSeed(seed, 'astro:…'),和推演、地形用的随机流互不影响。
 */
import { clamp, subSeed } from './util';
import { round24 } from './civ/engine/rand';
import { designOf, orbitYears, rebuildDesign, type AstroDesign, type HomeWorld, type MoonDesign, type PlanetDesign, type StarType, type SystemOverrides } from './astroDesign';
import type { WorldParams } from './params';
import type { World } from './world';

/** 一颗行星的天象:公转周期、起始相位;卫星同理 */
export interface AstroBody {
  design: PlanetDesign;
  /** 公转周期(天) */
  periodDays: number;
  /** 第 0 年在轨道上的相位(弧度) */
  phase: number;
  moons: { design: MoonDesign; periodDays: number; phase: number }[];
}

export interface AstroSystem {
  design: AstroDesign;
  star: StarType;
  /** 和 design.planets 一一对应(按轨道由内到外) */
  bodies: AstroBody[];
  home: HomeWorld;
  /** 一年多少天、一天多少小时(design.home 的镜像,界面直接用) */
  yearDays: number;
  dayHours: number;
}

/** 按种子取 [0,1) 的数(不用 Math.random) */
function unit(seed: number, tag: string): number {
  return (subSeed(seed, 'astro:' + tag) % 1_000_000) / 1_000_000;
}

/** 卫星的公转周期(天):开普勒,距离按行星半径倍数算;潮汐锁定的卫星自转 = 公转 */
function moonPeriodDays(distance: number): number {
  const r = distance / 60; // 以地球-月球(60 个地球半径、27.3 天)为基准
  return 27.3 * r * Math.sqrt(r);
}

/** 生成整份星球系(和推演、地形互不影响的随机流) */
export function generateAstro(params: WorldParams, overrides?: SystemOverrides | null): AstroSystem {
  const seed = params.seed;
  const baseDesign = designOf(seed, {
    system: params.system,
    planets: params.planets,
    gas: params.gas,
    moons: params.moons,
    tilt: params.tilt,
    rotation: params.rotation,
    geo: params.geo,
    mag: params.mag,
    arch: params.arch,
    life: params.life,
    home: params.home,
    homeMoon: params.homeMoon,
    binaryTier: params.binaryTier,
    salt: params.salt,
    // 恒星与子星系(可选:不写 = 老行为)
    starCount: params.starCount,
    subSystem: params.subSystem,
    spectral: params.spectral,
    sub: params.sub,
    lumClass: params.lumClass,
  });
  // 逐行星/卫星的覆盖表(新建世界的星系结构编辑):套上去并重算受影响的量;没有 = 原样
  const design = rebuildDesign(baseDesign, overrides ?? null, params);
  const bodies: AstroBody[] = design.planets.map((p, i) => ({
    design: p,
    periodDays: orbitYears(p.a) * 365.25,
    phase: unit(seed, `phase${i}`) * Math.PI * 2,
    moons: p.moons.map((m, k) => ({
      design: m,
      periodDays: moonPeriodDays(m.distance),
      phase: unit(seed, `mphase${i}-${k}`) * Math.PI * 2,
    })),
  }));
  return {
    design,
    star: design.star,
    bodies,
    home: design.home,
    yearDays: design.home.yearDays,
    dayHours: design.home.dayHours,
  };
}

const cache = new WeakMap<World, AstroSystem | null>();

/**
 * 这个世界自己的星球系:生成时挂了就用挂上的;没挂(老存档、从世界文件读回来的、别的线程传来的)就按 params 现算。
 * params.astro = 0 → null(这个世界没有星球系,气候用地球基线)。
 */
export function astroOf(world: World): AstroSystem | null {
  const hit = cache.get(world);
  if (hit !== undefined) return hit;
  const sys = world.astro ?? (world.params.astro === 1 ? generateAstro(world.params, world.system) : null);
  cache.set(world, sys);
  return sys;
}

/** 主行星的大气成分(没有星球系的世界 = null;气候层按地球基线走) */
export function homeAir(world: World): AstroSystem['home']['air'] | null {
  const sys = astroOf(world);
  if (!sys) return null;
  return sys.home.air;
}

/**
 * 星球系对气候的修正。astro = 0(默认)时是 null:气候层一条都不改,世界和以前逐字节一样。
 *
 * 每一项在"地球基线设计"下都恰好等于 1 或 0(倾角 23.5°、自转 24 小时、气压 1 atm),
 * 所以新世界只要没改设计参数,气候也不会漂:
 *   - tempOffset:层平均温度差(℃),来自辐照 + 反照率 + 大气温室的不动点结果
 *   - polarWarm:倾角带来的极地增温(0 = 地球基线;倾角大 → 极地夏季日照多)
 *   - rainScale:降水倍率:自转快慢(环流强弱)+ 表面气压(水汽总量)
 *   - tide:平均潮差(相对地球 = 1),给海岸宜居度用
 */
export interface ClimateMods {
  tempOffset: number;
  polarWarm: number;
  rainScale: number;
  tide: number;
  /** 昼夜温差(±K):自转越慢越大,潮汐锁定的世界能到十几度;地球 24 小时 = 0(不改基线) */
  diurnalK: number;
}

/** 从星球系算出气候修正(没有星球系 = null) */
export function climateModsOf(sys: AstroSystem | null): ClimateMods | null {
  if (!sys) return null;
  const tilt = sys.home.tilt;
  const polarWarm = clamp((tilt - 23.5) / 23.5, -0.8, 2) * 0.35;
  const day = Math.max(2, sys.home.dayHours);
  // (1)^0.15 = 1,地球基线时降水倍率恰好 1
  const spin = round24(Math.pow(24 / day, 0.15));
  const pressure = clamp(sys.home.air.pressure, 0.002, 80);
  const rainScale = round24(spin * clamp(0.45 + 0.55 * pressure, 0.2, 1.4));
  // 自转越慢,昼夜温差越大(向阳面烤得久、背阴面冻得久);24 小时恰好 0
  const diurnalK = round24(18 * clamp(1 - 24 / day, 0, 0.97));
  return { tempOffset: sys.home.meanTempK - 288, polarWarm, rainScale, tide: sys.home.tide, diurnalK };
}
