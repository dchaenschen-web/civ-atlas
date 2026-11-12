/**
 * 行星"类型"的判定(纯函数,可 Node 测):让缩略图一眼能看出这是冰封 / 海洋 / 沙漠 / 熔岩 / 气态…
 *
 * 判定只看设计层 + 该天体自己的覆盖参数(不跑地表生成),所以列表里几十颗天体也能立刻标出类型。
 * 类型同时决定缩略图的调色(每种类型一套色相)和角标文字。
 */
import type { PlanetDesign, BodyGen, SurfaceOverride } from './astroDesign';
import { phasesOf } from './materials';

export type PlanetClass = 'gasGiant' | 'iceGiant' | 'lava' | 'airless' | 'frozen' | 'ocean' | 'desert' | 'temperate' | 'moon';

export interface PlanetClassInfo {
  id: PlanetClass;
  name: string;
  /** 缩略图的主色相(0–255) */
  tint: [number, number, number];
  hint: string;
}

export const PLANET_CLASSES: Record<PlanetClass, PlanetClassInfo> = {
  gasGiant: { id: 'gasGiant', name: '气态巨行星', tint: [214, 186, 140], hint: '厚氢氦大气、条带与风暴；不生成地表，只有贴图（将来在太空殖民里标采气站）' },
  iceGiant: { id: 'iceGiant', name: '冰巨行星', tint: [130, 186, 208], hint: '水/氨/甲烷为主的冰质巨行星；不生成地表' },
  lava: { id: 'lava', name: '熔岩行星', tint: [176, 74, 52], hint: '表面温度极高，水全部汽化，地表是熔岩与火山' },
  airless: { id: 'airless', name: '无大气岩石', tint: [126, 126, 126], hint: '气压近真空，昼夜温差极大，满是陨击坑' },
  frozen: { id: 'frozen', name: '冰封行星', tint: [206, 226, 240], hint: '水以冰/雪存在，海面封冻' },
  ocean: { id: 'ocean', name: '海洋行星', tint: [58, 126, 176], hint: '液态水多、陆地少，海洋连成一片' },
  desert: { id: 'desert', name: '干旱行星', tint: [196, 164, 96], hint: '几乎没有水圈，干燥的沙漠与裸岩' },
  temperate: { id: 'temperate', name: '温带大陆', tint: [104, 148, 100], hint: '有液态水、陆地成片，气候温和' },
  moon: { id: 'moon', name: '卫星', tint: [168, 168, 176], hint: '绕行星转的卫星（不做文明）' },
};

export interface PlanetClassInput {
  design: Pick<PlanetDesign, 'kind' | 'radius' | 'tempK' | 'hydro' | 'atmos'>;
  gen?: BodyGen;
  surface?: SurfaceOverride;
  /** 卫星:直接按卫星类型出 */
  moon?: boolean;
}

/** 判定类型(顺序即优先级:先命中的先返回) */
export function planetClassOf(input: PlanetClassInput): PlanetClassInfo {
  const { design: p, gen, surface } = input;
  if (input.moon) return PLANET_CLASSES.moon;
  if (p.kind === 'gas') return p.radius >= 6 ? PLANET_CLASSES.gasGiant : PLANET_CLASSES.iceGiant;
  const tempK = p.tempK + (gen?.temperature ?? surface?.temperature ?? 0);
  const hasWater = gen?.water ?? p.hydro;
  const phases = phasesOf(tempK, p.atmos.pressure, { hasWater });
  const land = gen?.landFraction ?? surface?.landFraction;
  if (tempK > 700) return PLANET_CLASSES.lava;
  if (p.atmos.pressure < 0.01) return PLANET_CLASSES.airless;
  if (phases.water === 'ice') return PLANET_CLASSES.frozen;
  if (phases.water === 'liquid') return land !== undefined && land <= 0.35 ? PLANET_CLASSES.ocean : PLANET_CLASSES.temperate;
  if (!hasWater && tempK >= 260 && tempK <= 340) return PLANET_CLASSES.desert;
  // 有水但已经全部汽化 / 只剩极少量,按温度分:热→干旱,冷→冰封
  if (hasWater) return tempK > 340 ? PLANET_CLASSES.desert : PLANET_CLASSES.frozen;
  return PLANET_CLASSES.temperate;
}
