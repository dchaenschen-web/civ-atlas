/**
 * 世界的生成参数(滑条上的那些数)和默认值。生成总流程在 world.ts(那边照旧导出这两样);
 * 存档、网址、新建弹窗只用到参数本身,从这里拿,不用带上整套生成代码。
 */
import { clamp } from './util';

/**
 * 生成参数(滑条上的那些数)。世界是一整颗星球:东西无缝、有南北极,主图是等距圆柱投影
 */
export interface WorldParams {
  seed: number;
  /** 大约多少个地块(越多越细,越慢):整颗球的地块数 */
  cells: number;
  landFraction: number;
  /** 板块一共几块(有大有小:几块巨大的 + 许多小的;越多陆地越碎、岛越多) */
  plates: number;
  mountains: number;
  temperature: number;
  rainfall: number;
  // ---- 大陆参数(新建时可调;默认值 = 加这几样之前的生成方式,老世界、老链接没有这几样时按默认值生成) ----
  /** 主要大陆几块(0 = 自动,按种子 2~5 块;另外的大岛、群岛照旧) */
  continents: number;
  /** 大陆聚在一起的程度(0 = 彼此尽量远,1 = 挤在一起,留出大片大洋) */
  gather: number;
  /** 破碎度(1 = 原样;小 = 大陆完整、海岸平直;大 = 支离破碎、岛多) */
  rugged: number;
  /** 板块硬度(1 = 原样;硬 = 内陆平坦、山脉窄;软 = 丘陵多、山脉宽) */
  hardness: number;
  /** 陆地偏向哪个半球(-1 南 … 0 均匀 … 1 北) */
  north: number;
  // ---- 星球系(天文)与地质:astro = 0 时下面这些一律不参与生成,世界和加这一层以前逐字节一样 ----
  /** 启用星球系设计(0 = 关闭,沿用地球基线;1 = 按下面这些设计生成恒星、行星、卫星与星图) */
  astro: number;
  /** 恒星类型(0 = 按种子自动;1 白黄矮星、2 黄矮星、3 橙矮星、4 红矮星、5 双星,见 gen/astroDesign.ts) */
  system: number;
  /** 本星系的固态行星数(1–6;0 = 按种子自动) */
  planets: number;
  /** 气态 / 冰巨行星数(0–4;只参与轨道、天象、磁场相互作用,不做地表) */
  gas: number;
  /** 主行星的卫星数(0–4;有卫星才有像样的潮汐) */
  moons: number;
  /** 主行星自转轴倾角(度;决定季节强弱与极昼极夜) */
  tilt: number;
  /** 主行星自转周期(小时;决定昼夜与降水倍率) */
  rotation: number;
  /** 地质活跃度倍数(0.4 平静 … 1 地球基线 … 3 暴烈;管火山 / 地震 / 地热与成矿) */
  geo: number;
  /** 磁场强度倍数(0 无磁场 … 1 地球基线 … 2 强磁场;管大气保有、极光、磁暴) */
  mag: number;
  /** 技术路线:0 现实、1 魔法、2 修真(见 gen/techPack.ts;只换时代链的名字与门槛,不换推演骨架) */
  tech: number;
  /** 星系构型:0 单星(默认)、1 双固态行星互绕、2 双恒星、3 气态巨星的宜居卫星(见 docs/astro-geology-tech.md) */
  arch: number;
  /** 主行星的生命:0 按种子自动、1 有生物圈(默认给新世界,保证可呼吸)、2 无生命 */
  life: number;
  /** 主行星取第几颗(1 起;0 = 按种子自动;arch = 3 时选的是第几颗卫星) */
  home: number;
  /** 宜居卫星系:主行星是母行星的第几颗卫星(0 起;不写 = 主行星是行星) */
  homeMoon?: number;
  /** 双恒星的构型:0 密近双星、1 分离双星、2 三合星(南门二式);不写 = 按种子挑 */
  binaryTier?: number;
  /** 整个星球系重新掷一次(0 = 不掷;1–999 换一套行星/卫星,轨道与大气都跟着变) */
  salt: number;
  /** 小行星带与陨击:0 关(默认,和以前逐字节一样)、1 自然频率、2 频繁(灾变世界) */
  impact: number;
  // ---- 恒星与子星系(可选的细化字段;都不写 = 老行为,默认世界逐字节不变) ----
  /** 恒星数量:1 单星(默认)、2 双恒星 */
  starCount?: number;
  /** 子星系类型:0 单行星系(默认)、1 双固态行星系、3 气态巨星宜居卫星系 */
  subSystem?: number;
  /** 光谱型:0 M、1 K、2 G、3 F、4 A、5 B、6 O(不写 = 按 system / 种子) */
  spectral?: number;
  /** 子型 0–9(0 最热);不写 = 5 */
  sub?: number;
  /** 光度级:0 = 主序 V(现在只有这一档);不写 = 主序 */
  lumClass?: number;
}

/**
 * 「老参数」的键:PARAM_RANGE / PARAM_NAME / 滑条这些只认这一批(都是必填的 number)。
 * 后来加的可选字段(starCount / subSystem / spectral / sub / lumClass)不走这些表,另有一套范围与清洗。
 */
export type BaseParamKey = Exclude<keyof WorldParams, 'starCount' | 'subSystem' | 'spectral' | 'sub' | 'lumClass' | 'homeMoon' | 'binaryTier' | 'homeMoon'>;

export const DEFAULT_PARAMS: WorldParams = {
  seed: 1,
  cells: 36000,
  landFraction: 0.33,
  plates: 30,
  mountains: 1,
  temperature: 0,
  rainfall: 1,
  continents: 0,
  gather: 0,
  rugged: 1,
  hardness: 1,
  north: 0,
  astro: 0,
  system: 0,
  planets: 0,
  gas: 2,
  moons: 1,
  tilt: 23.5,
  rotation: 24,
  geo: 1,
  mag: 1,
  tech: 0,
  arch: 0,
  life: 0,
  home: 0,
  salt: 0,
  impact: 0,
};

/**
 * 指定大陆块数时最多能长出几块(和 tectonics.ts 里定块数时的上限一样):板块太少、陆地太少时分不出那么多块。
 * 新建弹窗的大陆数量按钮按它变灰,所以放在这里,不放在生成代码里
 */
export function continentCap(plates: number, landFraction: number): number {
  return Math.max(1, Math.min(Math.floor(plates / 3), Math.floor((plates * clamp(landFraction * 1.3, 0.08, 0.92)) / 0.7)));
}
