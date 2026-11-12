/**
 * 一颗天体表面的"物质状态"(简化相图)。
 *
 * 地表怎么长,取决于这颗天体上有什么、以什么状态存在:水能不能成海、还是冻成冰盖、还是只剩水汽;
 * 二氧化碳是气还是干冰;氨、甲烷在冷卫星上能不能成液体。这里只做教科书级门槛(不算相平衡),
 * 目的是让每颗行星/卫星的地表生成与它自己的温度、气压对得上,而不是一律套地球。
 *
 * 不改变任何默认世界:默认世界走的是主行星参数(earth 基线),不经过这里。
 */

/** 水的三相点 / 沸点(1 atm) */
const T_TRIPLE = 273.16;
const T_BOIL = 373.15;
/** 二氧化碳(1 atm 升华点 ≈ 194.7 K)、氨(熔 195.4 / 沸 239.8)、甲烷(熔 90.7 / 沸 111.7) */
const T_CO2_FREEZE = 194.7;
const T_NH3_MELT = 195.4;
const T_NH3_BOIL = 239.8;
const T_CH4_MELT = 90.7;
const T_CH4_BOIL = 111.7;

export type WaterPhase = 'liquid' | 'ice' | 'vapor' | 'none';
export type SimplePhase = 'gas' | 'liquid' | 'ice';

export interface MaterialPhases {
  /** 表面温度(K) */
  tempK: number;
  /** 大气压(atm) */
  pressure: number;
  /** 水:液 / 冰 / 汽 / 没有水 */
  water: WaterPhase;
  /** 二氧化碳:气 / 干冰 */
  co2: 'gas' | 'ice';
  ammonia: SimplePhase;
  methane: SimplePhase;
  /** 界面用的一句话 */
  text: string;
}

/** 气压对沸点的影响(粗略:沸点 ∝ P^0.25;P ≤ 0.006 视为没有液相,只升华/凝华) */
function boilAt(boil1atm: number, pressure: number): number {
  return boil1atm * Math.pow(Math.max(0.006, pressure), 0.25);
}

/** 简单物质的状态:低于熔点结冰,高于沸点成气,中间有液体 */
function stateOf(tempK: number, meltK: number, boilK: number, pressure: number): SimplePhase {
  if (tempK <= meltK) return 'ice';
  if (tempK >= boilAt(boilK, pressure)) return 'gas';
  return 'liquid';
}

/**
 * 温度/气压下各种物质的状态。
 * hasWater = 这颗天体有没有水圈(没有 = 'none';有但太冷 = 冰盖,太热 = 只有水汽)。
 */
export function phasesOf(tempK: number, pressure: number, opts: { hasWater?: boolean } = {}): MaterialPhases {
  const p = Math.max(0.0001, pressure);
  const t = Math.max(1, tempK);
  let water: WaterPhase;
  if (opts.hasWater === false) water = 'none';
  else if (p < 0.006) water = t < T_TRIPLE ? 'ice' : 'vapor';
  else {
    const freeze = T_TRIPLE - Math.min(4, Math.max(0, (p - 1) * 0.4)); // 高压略降冰点
    if (t <= freeze) water = 'ice';
    else if (t >= boilAt(T_BOIL, p)) water = 'vapor';
    else water = 'liquid';
  }
  const co2: 'gas' | 'ice' = t <= T_CO2_FREEZE - Math.min(20, Math.max(0, Math.log10((1 / p) * 1) * 8)) ? 'ice' : 'gas';
  const ammonia = stateOf(t, T_NH3_MELT, T_NH3_BOIL, p);
  const methane = stateOf(t, T_CH4_MELT, T_CH4_BOIL, p);
  const w = water === 'liquid' ? '液态水' : water === 'ice' ? '水冰' : water === 'vapor' ? '只有水汽' : '没有水';
  const c = co2 === 'ice' ? '干冰' : '二氧化碳气';
  const a = ammonia === 'gas' ? '氨气' : ammonia === 'liquid' ? '液氨' : '氨冰';
  const m = methane === 'gas' ? '甲烷气' : methane === 'liquid' ? '液态甲烷' : '甲烷冰';
  return { tempK: t, pressure: p, water, co2, ammonia, methane, text: `${w} · ${c} · ${a} · ${m}` };
}

/**
 * 按物质状态给的"地表长什么样"修正:
 * 水冻成冰 → 冰盖占掉大片"陆地",降水几乎没有;水只剩汽 → 没有海,地表干;
 * 液态水 → 保持按水圈比例算出来的海陆。
 */
export function surfaceHints(ph: MaterialPhases): {
  /** 陆地比例下限(冰盖/干地会把海吃掉) */
  minLand: number;
  /** 降水倍率(0–1) */
  rainScale: number;
  /** 给界面的一句话 */
  note: string;
} {
  if (ph.water === 'ice') return { minLand: 0.88, rainScale: 0.06, note: '表面水冻成冰盖,几乎不降水(冰原/冰壳为主)' };
  if (ph.water === 'vapor') return { minLand: 0.95, rainScale: 0.05, note: '太热,水只以水汽存在:没有海,地表干热' };
  if (ph.water === 'none') return { minLand: 0.98, rainScale: 0.05, note: '没有水圈:无水海,只有干地' };
  return { minLand: 0, rainScale: 1, note: ph.co2 === 'ice' ? '液态水能存在,但极区有干冰' : '液态水能存在(有海)' };
}
