/**
 * 地貌风格(步 6):同一套地形生成器,按行星类型换"地貌配方"。
 *
 * 真正独立的地形算法(坑场/冰盖/裂谷)接在 gen/world.ts 里做是更大的改动;
 * 这里先把「按类型生成」落到配方层:海陆比、气温、降水、板块/造山、河流与冰盖倾向,
 * 让海洋行星、干旱行星、冰封行星、熔岩行星、无大气岩石、矮行星第一眼就不一样。
 * 气态行星没有地表(只贴图),skin = 'gas' 只是标记,调用方不要拿它去生成世界。
 */
import type { PlanetType } from './astroDesign';
import type { WorldParams } from './params';

export type SurfaceSkin = 'earth' | 'ocean' | 'desert' | 'frozen' | 'lava' | 'airless' | 'dwarf' | 'gas';

export const SKIN_NAME: Record<SurfaceSkin, string> = {
  earth: '大陆与海洋',
  ocean: '多洋少陆',
  desert: '干旱沙海',
  frozen: '冰封',
  lava: '熔岩',
  airless: '无大气岩石',
  dwarf: '矮行星坑原',
  gas: '气态(无地表)',
};

export interface SkinInput {
  type: PlanetType;
  /** 该天体表面温度(K) */
  tempK: number;
  /** 有没有液态水(由 materials.phasesOf 判) */
  liquidWater: boolean;
  /** 有没有水圈 */
  hydro: boolean;
}

/** 这颗天体该用哪套地貌配方 */
export function skinOf(input: SkinInput): SurfaceSkin {
  const { type, tempK, liquidWater, hydro } = input;
  if (type === 'gasGiant' || type === 'iceGiant' || type === 'subNeptune') return 'gas';
  if (type === 'dwarf') return 'dwarf';
  if (tempK > 700) return 'lava';
  if (!hydro) return tempK < 160 ? 'frozen' : 'airless';
  if (liquidWater) return 'earth'; // 具体多洋少陆由调用方按 waterFraction 细化成 ocean
  return tempK <= 250 ? 'frozen' : 'desert';
}

/** 配方:对生成参数的偏移(只改这几个,其余照原样) */
export interface SkinRecipe {
  /** 陆地比例(0–1) */
  landFraction: number;
  /** 气温偏移(K;加在原有 km 偏移上) */
  dTempK: number;
  /** 降水倍率 */
  rainScale: number;
  /** 造山倍率 */
  mountainScale: number;
  /** 板块数倍率 */
  plateScale: number;
  /** 起伏倍率(rugged) */
  ruggedScale: number;
}

export const SKIN_RECIPE: Record<Exclude<SurfaceSkin, 'gas' | 'earth'>, SkinRecipe> = {
  ocean: { landFraction: 0.18, dTempK: 2, rainScale: 1.3, mountainScale: 1, plateScale: 1, ruggedScale: 1 },
  desert: { landFraction: 0.9, dTempK: 4, rainScale: 0.18, mountainScale: 0.9, plateScale: 1, ruggedScale: 0.9 },
  frozen: { landFraction: 0.86, dTempK: -14, rainScale: 0.35, mountainScale: 1, plateScale: 1, ruggedScale: 1.05 },
  lava: { landFraction: 0.96, dTempK: 26, rainScale: 0.03, mountainScale: 1.5, plateScale: 1.4, ruggedScale: 1.3 },
  airless: { landFraction: 0.98, dTempK: 0, rainScale: 0.02, mountainScale: 0.55, plateScale: 1, ruggedScale: 0.7 },
  dwarf: { landFraction: 0.95, dTempK: -8, rainScale: 0.05, mountainScale: 0.25, plateScale: 0.8, ruggedScale: 0.55 },
};

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** 按配方改一份 WorldParams(不改 seed/astro 这些) */
/** 按配方改一份 WorldParams(不改 seed/astro 这些);fixed = 用户显式改过的字段,配方不动它们 */
export function applySkin(p: WorldParams, skin: SurfaceSkin, fixed?: ReadonlySet<keyof WorldParams>): WorldParams {
  if (skin === 'earth' || skin === 'gas') return p;
  const r = SKIN_RECIPE[skin];
  const keep = (k: keyof WorldParams) => (fixed ? fixed.has(k) : false);
  return {
    ...p,
    landFraction: keep('landFraction')
      ? p.landFraction
      : clamp(Math.round(r.landFraction * 1000) / 1000, 0.02, 0.98),
    temperature: keep('temperature') ? p.temperature : clamp(Math.round((p.temperature + r.dTempK) * 10) / 10, -40, 40),
    rainfall: keep('rainfall') ? p.rainfall : clamp(Math.round(p.rainfall * r.rainScale * 100) / 100, 0, 5),
    mountains: keep('mountains') ? p.mountains : clamp(Math.round(p.mountains * r.mountainScale * 100) / 100, 0, 5),
    plates: keep('plates') ? p.plates : clamp(Math.round(p.plates * r.plateScale), 2, 64),
    rugged: keep('rugged') ? p.rugged : clamp(Math.round(p.rugged * r.ruggedScale * 100) / 100, 0.2, 2.5),
  };
}

/** 这套配方下要不要画河(干旱/熔岩/无大气没有河;冰封只有冰) */
export function riversAllowed(skin: SurfaceSkin): boolean {
  return skin === 'earth' || skin === 'ocean' || skin === 'frozen';
}
