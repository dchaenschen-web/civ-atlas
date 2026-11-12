/**
 * 星球系设计层:恒星、本星系各行星、卫星、大气成分、磁场、星表、地质活跃度。
 *
 * 定位:这一层只做**纯计算和类型**,不碰 DOM、不碰名字库(名字在 astro.ts 起,那里才拉进 12 语感词库)。
 * 所有物理量从 WorldParams 里的设计参数 + 种子派生,不写死(第 3 条要求):
 *   - 恒星光度 → 宜居带半径、各行星的辐照度 → 平衡温度
 *   - 轨道半长轴 → 公转周期(开普勒,只用 sqrt,不做 N 体积分)→ 一年多少天
 *   - 自转周期 → 昼夜温差、降水倍率、磁场
 *   - 倾角 → 年较差(季节)
 *   - 卫星质量 ÷ 轨道距离³ → 潮差
 *   - 大气成分:质量 / 半径(逃逸速度)× 温度 × 地质出气 × 水圈 × 磁场 × 星风 → 各气体库存 → 逃逸筛选 → 归一化;
 *     成分再反过来算温室增量、天空颜色、可呼吸性;温度与成分做 3 次不动点迭代
 *   - 磁场、自转、核大小 → 大气保有与极光、磁暴
 *   - 板块数 × 汇聚强度 × 地质活跃度 → 地震/火山频率(P4 用)
 *
 * 兼容约定:WorldParams.astro = 0(默认)时这些量一律不参与生成,世界逐字节和以前一样;
 * 只有在 astro = 1 时才用这里派生出来的东西。
 */
import { subSeed, clamp } from './util';
import { stableSepFor } from './orbitConstraints';
import { MS_MASS_SAFE, SPECTRAL_CLASSES, starAt, starFromMassHR, starIdOf, starLabelOf, type SpectralClass, type StarAt } from './stellar';
import { round24 } from './civ/engine/rand';

/** 恒星类型(顺序 = WorldParams.system 的 1..N;0 = 按种子自动挑) */
export interface StarType {
  id: 'f' | 'g' | 'k' | 'm' | 'bin' | 'a' | 'b' | 'o';
  label: string;
  /** 相对太阳的光度 */
  lum: number;
  /** 有效温度 K */
  temp: number;
  /** 相对太阳的质量 */
  mass: number;
  /** 按种子自动挑时的权重 */
  w: number;
  /** 屏幕上画的颜色 */
  color: [number, number, number];
  /** 星风 / 耀斑强度(地球 = 1) */
  wind: number;
  /** 相对太阳的半径(主序星;老数据没有这一项) */
  radius?: number;
}

export const STAR_TYPES: readonly StarType[] = [
  { id: 'f', label: '白黄矮星', lum: 2.2, temp: 6600, mass: 1.3, w: 1, color: [244, 246, 255], wind: 1.2 },
  { id: 'g', label: '黄矮星', lum: 1.0, temp: 5772, mass: 1.0, w: 4, color: [255, 246, 224], wind: 1 },
  { id: 'k', label: '橙矮星', lum: 0.4, temp: 4800, mass: 0.8, w: 3, color: [255, 226, 190], wind: 1.1 },
  { id: 'm', label: '红矮星', lum: 0.05, temp: 3300, mass: 0.45, w: 3, color: [255, 186, 150], wind: 2.2 },
  { id: 'bin', label: '双星', lum: 1.5, temp: 5900, mass: 1.6, w: 1, color: [255, 240, 226], wind: 1.6 },
];

/** 行星类型(气态 / 冰巨行星只参与轨道、天象、磁场,不做地表) */
export type BodyKind = 'rocky' | 'gas';

/**
 * 行星类型(生成层;比 kind 细):
 *   rocky 岩石行星(地球型/超级地球/铁核/无核)、dwarf 矮行星、
 *   subNeptune 亚海王星、gasGiant 气态巨行星(含热木星)、iceGiant 冰巨行星。
 * kind 仍是粗分(rocky/gas),用于地表预算/渲染分支;type 决定物理参数与地貌。
 */
export type PlanetType = 'rocky' | 'dwarf' | 'subNeptune' | 'gasGiant' | 'iceGiant';

export const PLANET_TYPES: readonly PlanetType[] = ['rocky', 'dwarf', 'subNeptune', 'gasGiant', 'iceGiant'];

export const PLANET_TYPE_NAME: Record<PlanetType, string> = {
  rocky: '岩石行星',
  dwarf: '矮行星',
  subNeptune: '亚海王星',
  gasGiant: '气态巨行星',
  iceGiant: '冰巨行星',
};

/** 这颗行星属于哪一类(按 kind + 半径;热木星是 gasGiant 的轨道子类) */
export function planetTypeOf(p: Pick<PlanetDesign, 'kind' | 'radius'> & { type?: PlanetType }): PlanetType {
  if (p.type) return p.type;
  if (p.kind === 'gas') return p.radius >= 6 ? 'gasGiant' : p.radius >= 3.2 ? 'iceGiant' : 'subNeptune';
  return p.radius < 0.35 ? 'dwarf' : 'rocky';
}

/** 热木星:气态巨行星且贴着恒星(显示用) */
export function isHotJupiter(p: Pick<PlanetDesign, 'kind' | 'a' | 'radius'> & { type?: PlanetType }): boolean {
  const t = planetTypeOf(p);
  return t === 'gasGiant' && p.a < 0.15;
}

/** 手动改类型:按类型给定半径/质量/大气/水圈/生物圈/反照率/环,再按新质量重算温度 */
export function retypePlanet(p: PlanetDesign, type: PlanetType, star: StarType, seed: number): PlanetDesign {
  const u = (tag: string) => (subSeed(seed, `retype:${p.index}:${tag}`) % 1000) / 1000;
  if (type === 'rocky' || type === 'dwarf') {
    const radius = type === 'dwarf' ? 0.08 + 0.22 * u('r') : 0.55 + 1.1 * u('r');
    const mass = radius * radius * radius * (type === 'dwarf' ? 0.55 : 0.9 + 0.4 * u('m'));
    const albedo = 0.12 + 0.3 * u('a');
    const rm = modelRocky({ star, a: p.a, radius, mass, albedo, geo: p.geoActivity, magnetic: p.magnetic, seed, tag: p.index, ecc: p.ecc });
    return { ...p, kind: 'rocky', type, radius, mass, albedo, hydro: rm.hydro, biotic: rm.biotic, atmos: rm.air, tempK: rm.tempK, ring: false };
  }
  const radius = type === 'gasGiant' ? 6 + 5.2 * u('r') : type === 'iceGiant' ? 3.2 + 2.8 * u('r') : 1.6 + 1.6 * u('r');
  const mass = radius * radius * radius * (type === 'gasGiant' ? 0.25 : type === 'iceGiant' ? 0.3 : 0.55);
  const albedo = type === 'gasGiant' ? 0.4 + 0.2 * u('a') : 0.5 + 0.2 * u('a');
  return {
    ...p,
    kind: 'gas',
    type,
    radius,
    mass,
    albedo,
    geoActivity: 0,
    magnetic: Math.max(p.magnetic, type === 'gasGiant' ? 1.5 : 1),
    hydro: false,
    biotic: false,
    atmos: gasGiantAtmosphere(mass),
    tempK: equilibriumTempK(insolationOf(star.lum, p.a), albedo),
    ring: type === 'gasGiant' ? true : p.ring,
  };
}

/** 卫星类型(比行星简单):岩石卫星 / 冰卫星 / 矮卫星 */
export type MoonType = 'rocky' | 'ice' | 'dwarf';

export const MOON_TYPES: readonly MoonType[] = ['rocky', 'ice', 'dwarf'];

export const MOON_TYPE_NAME: Record<MoonType, string> = {
  rocky: '岩石卫星',
  ice: '冰卫星',
  dwarf: '矮卫星',
};

export interface MoonDesign {
  /** 相对地球质量 */
  mass: number;
  /** 轨道半径(行星半径的倍数) */
  distance: number;
  /** 相对地球半径 */
  radius: number;
  /** 潮汐锁定 */
  locked: boolean;
  /** 卫星类型(不写 = 按母行星温度与自身质量派生) */
  type?: MoonType;
}

/** 大气里认得的气体 */
export type GasId = 'n2' | 'o2' | 'co2' | 'h2o' | 'ch4' | 'nh3' | 'h2' | 'he' | 'so2' | 'ar';

/** 摩尔质量(g/mol),逃逸筛选和气压都按它算 */
export const GAS_MOLAR: Readonly<Record<GasId, number>> = {
  h2: 2,
  he: 4,
  h2o: 18,
  ch4: 16,
  nh3: 17,
  n2: 28,
  o2: 32,
  ar: 40,
  co2: 44,
  so2: 64,
};

export const GAS_NAMES: Readonly<Record<GasId, string>> = {
  n2: '氮',
  o2: '氧',
  co2: '二氧化碳',
  h2o: '水汽',
  ch4: '甲烷',
  nh3: '氨',
  h2: '氢',
  he: '氦',
  so2: '二氧化硫',
  ar: '氩',
};

export interface AtmosGas {
  id: GasId;
  /** 体积混合比(全部加起来 = 1) */
  frac: number;
  /** 分压(atm) */
  partial: number;
}

export interface Atmosphere {
  /** 按混合比从大到小 */
  gases: AtmosGas[];
  /** 表面气压(atm,地球 = 1) */
  pressure: number;
  /** 温室增量(K) */
  greenhouseK: number;
  /** 天空颜色(线性 0–255,画地球仪、天穹用) */
  sky: [number, number, number];
  /** 地表逃逸速度(km/s,地球 11.2) */
  escapeVel: number;
  /** 可呼吸(氧 12–32%、二氧化碳 < 2%、气压 0.4–3 atm) */
  breathable: boolean;
  /** 有生物圈(产氧的那一套;这里只记结论,供设定和推演用) */
  biotic: boolean;
}

export interface PlanetDesign {
  /** 在本星系里的次序(0 = 最靠恒星,排序后重排) */
  index: number;
  kind: BodyKind;
  /** 细分类型(岩石/矮行星/亚海王星/气态巨行星/冰巨行星;不写 = 按 kind+半径派生) */
  type?: PlanetType;
  /** 轨道半长轴(AU) */
  a: number;
  /** 偏心率(0–0.15) */
  ecc: number;
  /** 轨道相对黄道的倾角(度,0–8):3D 示意图与凌日概率用 */
  incDeg: number;
  /** 升交点经度(度,0–360):3D 示意图用 */
  nodeDeg: number;
  /** 相对地球半径(气态行星可到 11) */
  radius: number;
  /** 相对地球质量 */
  mass: number;
  /** 自转周期(小时;气态行星记云顶) */
  rotation: number;
  /** 自转轴倾角(度) */
  tilt: number;
  /** 反照率 */
  albedo: number;
  /** 0–1:地质活跃度(板块 / 火山 / 内核还在散热) */
  geoActivity: number;
  /** 0–1.5:磁场强度(相对地球;气态行星是磁层尺度) */
  magnetic: number;
  /** 是否有液态水圈 */
  hydro: boolean;
  /** 有没有生物圈(产氧的那一套;生物圈的星球才可能"可呼吸") */
  biotic: boolean;
  /** 大气成分与派生量 */
  atmos: Atmosphere;
  /** 层平均表面温度(K);气态行星记 1 bar 处 */
  tempK: number;
  /** 卫星 */
  moons: MoonDesign[];
  /** 有没有环 */
  ring: boolean;
}

/** 主行星(游戏里的那颗)的派生数据 —— 气候、季节、潮汐、文明都用这份 */
export interface HomeWorld {
  /** 在 planets 里的下标 */
  index: number;
  /** 宜居卫星系:主行星是这颗母行星的第几颗卫星(0 起;不写 = 主行星是行星) */
  moon?: number;
  /** 主天体有没有生物圈(行星用行星自己的;卫星用卫星的) */
  biotic: boolean;
  /** 一年多少天(开普勒:公转周期 × 一年的天数) */
  yearDays: number;
  /** 一天多少小时 */
  dayHours: number;
  /** 倾角(度) */
  tilt: number;
  /** 相对地球的辐照度 */
  insolation: number;
  /** 层平均表面温度(K),地球 288 K */
  meanTempK: number;
  /** 相对地球的平均潮差(地球 = 1) */
  tide: number;
  /** 大气保有系数(磁场 × 质量 × 温度,0–1.3;1 = 地球) */
  atmosphere: number;
  /** 磁极点纬度(度,0 = 地理极) */
  magneticPole: number;
  /** 磁暴频率(相对地球,1 = 地球) */
  storms: number;
  /** 母行星辐射带剂量(相对地球轨道,1 = 地球;0 = 没有母行星辐射带) */
  radDose: number;
  /** 大气(和 planets[index].atmos 是同一份) */
  air: Atmosphere;
}

/** 双恒星/三合星的一个成员(A/B/C) */
export interface StarMember {
  role: 'A' | 'B' | 'C';
  star: StarType;
}

/** 双恒星构型:密近 / 分离 / 三合(南门二式) */
export type BinaryTier = 'close' | 'wide' | 'triple';

export interface AstroDesign {
  star: StarType;
  /** 星系构型(0 单星、1 双固态行星、2 双恒星、3 气态巨星的宜居卫星) */
  arch: number;
  /** 双固态行星(arch = 1):伴星下标、两颗的间距(AU)、互绕周期(天) */
  binary?: {
    index: number;
    /** 两颗之间真实间距(AU) */
    separationAU: number;
    periodDays: number;
    /** 间距换成公里数(界面显示用) */
    sepKm?: number;
    /** 伴星质量 / 主行星质量 */
    massRatio?: number;
    /** 主行星离质心多远(AU)、伴星离质心多远(AU):两者之和 = separationAU */
    aHomeAU?: number;
    aCompanionAU?: number;
  };
  /** 双恒星(arch = 2):AB 间距、互绕周期、伴星光度占比、伴星(兼容字段);tier/members 是三档新模型 */
  binaryStar?: {
    /** 构型:密近双星 / 分离双星 / 三合星(南门二式) */
    tier: BinaryTier;
    /** 成员星:A、B(三合星再带 C) */
    members: StarMember[];
    /** AB 间距(AU) */
    sepAU: number;
    /** AB 互绕周期(天) */
    periodDays: number;
    /** B 的光度占 AB 之和的比例 */
    lumRatio: number;
    /** = B(兼容旧字段) */
    companion: StarType;
    /** 三合星:C 与 AB 质心的间距(AU) */
    outerSepAU?: number;
    /** 三合星:C 的公转周期(年) */
    outerPeriodYears?: number;
  };
  /** 气态巨星的宜居卫星(arch = 3):母行星下标、卫星绕母行星的距离(母行星半径数)、公转周期(天)、潮汐加热(K) */
  habitableMoon?: { parent: number; index: number; sepR: number; periodDays: number; tidalHeatK: number };
  /** 本星系所有行星,按轨道由内到外 */
  planets: PlanetDesign[];
  home: HomeWorld;
  /** 每颗行星地表该生成多少地块(-1 = 主行星全精度;0 = 不生成地表;正数 = 该精度的迷你星球) */
  budget: number[];
  /** 星图:天球上的星(单位向量 + 星等 + 颜色) */
  stars: { dir: [number, number, number]; mag: number; color: [number, number, number] }[];
  /** 邻近恒星(只做星图关系,不做航行物理) */
  nearby: { distance: number; color: [number, number, number]; mag: number }[];
}

/** 地表精度档:主行星全精度,活跃的固态行星中精度,死星低精度,气态行星 0 */
export const BUDGET = {
  activeRocky: 9000,
  deadRocky: 4000,
  gas: 0,
} as const;

/** 地球基线:层平均温度、一年天数、逃逸速度、气温表基准 */
const EARTH_MEAN_K = 288;
const EARTH_YEAR_DAYS = 365.25;
const EARTH_ESCAPE = 11.2;

/** 主序星光度级 → 星风强度(粗略:越亮越大,红矮星反而耀斑更凶) */
function windOf(cls: SpectralClass, lum: number): number {
  if (cls === 'M') return 2.2;
  if (cls === 'K') return 1.1;
  if (cls === 'G') return 1;
  if (cls === 'F') return 1.2;
  return clamp(1.2 + 0.35 * Math.log10(1 + lum), 1.2, 3);
}

/** 赫罗模型算出来的恒星 → StarType(默认生成里用不到,只有"手选光谱型/改质量"才走这里) */
function starTypeOf(at: StarAt): StarType {
  return {
    id: starIdOf(at.cls),
    label: starLabelOf(at.cls),
    lum: at.lum,
    temp: at.temp,
    mass: at.mass,
    w: 1,
    color: at.color,
    wind: windOf(at.cls, at.lum),
    radius: Math.round(at.radius * 1000) / 1000,
  };
}

/**
 * 恒星类型:按参数直取。
 *   system 1..5 = 老的白黄/黄/橙/红/双星(数值一个不动,默认世界不能变)
 *   system 6..12 = 新的赫罗档位(M K G F A B O),子型用 sub(不写 = 5)
 *   spectral 给了就直接按光谱型(0 M … 6 O)+ sub 走赫罗模型
 *   0 / 不写 = 按种子按权重挑(和老版本一样)
 */
export function pickStar(system: number, seed: number, spectral?: number, sub?: number): StarType {
  if (spectral !== undefined && Number.isFinite(spectral)) {
    const cls = SPECTRAL_CLASSES[clamp(Math.round(spectral), 0, SPECTRAL_CLASSES.length - 1)];
    return starTypeOf(starAt(cls, sub ?? 2));
  }
  if (system >= 6 && system <= 6 + SPECTRAL_CLASSES.length - 1) {
    return starTypeOf(starAt(SPECTRAL_CLASSES[system - 6], sub ?? 2));
  }
  if (system >= 1 && system <= STAR_TYPES.length) return STAR_TYPES[system - 1];
  const total = STAR_TYPES.reduce((a, s) => a + s.w, 0);
  let r = (subSeed(seed, 'astro:star') % 1_000_000) / 1_000_000;
  if (!(r >= 0 && r < 1)) r = 0.5;
  let left = r * total;
  for (const s of STAR_TYPES) {
    left -= s.w;
    if (left < 0) return s;
  }
  return STAR_TYPES[1];
}

/** 开普勒第三定律:半长轴(AU)→ 公转周期(年)。只用 sqrt,IEEE 精确、跨 CPU 一致 */
export function orbitYears(a: number): number {
  return a * Math.sqrt(a);
}

/** 辐照度(相对地球):L / a² */
export function insolationOf(lum: number, a: number): number {
  return lum / (a * a);
}

/**
 * 平衡温度(K):0.3 反照率、1 倍辐照时约 255 K(和地球一致)。
 * 四分之一次方拆成两次 sqrt(IEEE 精确),不用 Math.pow。
 */
export function equilibriumTempK(insolation: number, albedo: number): number {
  return 278.6 * Math.sqrt(Math.sqrt(insolation)) * Math.sqrt(Math.sqrt(1 - albedo));
}

/** 表面温度 = 平衡温度 + 温室增量(K) */
export function meanTempK(equilibrium: number, greenhouseK: number): number {
  return equilibrium + greenhouseK;
}

/** 逃逸温度(K):这种气体在这个逃逸速度下"留得住"的温度尺度 */
export function escapeTempK(molar: number, escapeKmS: number): number {
  const v = escapeKmS * 1000;
  return molar * v * v * 6.014e-5;
}

/**
 * 温室增量(K):按分压算,水汽、二氧化碳为主,甲烷封顶(地球基线约 33 K)。
 * 地球基线:COâ‚‚ 400 ppm、水汽 1%、甲烷 1.9 ppm。
 */
export function greenhouseOf(pressure: number, gases: readonly AtmosGas[]): number {
  const p = (id: GasId) => (gases.find((g) => g.id === id)?.frac ?? 0) * pressure;
  const co2 = p('co2');
  const h2o = p('h2o');
  const ch4 = p('ch4');
  const g = 3 + Math.min(45, 10 * Math.sqrt(co2 / 0.0004)) + Math.min(30, 16 * Math.sqrt(h2o / 0.01)) + Math.min(4, 8 * Math.sqrt(ch4 / 1e-4));
  return clamp(g, 2, 120);
}

/** 天空颜色:按主成分和气压定(不做散射方程的数值解,只取像样的色调) */
export function skyOf(gases: readonly AtmosGas[], pressure: number): [number, number, number] {
  const f = (id: GasId) => gases.find((g) => g.id === id)?.frac ?? 0;
  const o2 = f('o2');
  const n2 = f('n2');
  const co2 = f('co2');
  const ch4 = f('ch4');
  const h2 = f('h2');
  if (pressure < 0.05) return [24, 26, 34]; // 几乎没有大气:天是黑的
  if (h2 > 0.3) return [228, 168, 96]; // 氢氦大气:琥珀色
  if (co2 > 0.5) return pressure > 2 ? [212, 196, 150] : [188, 196, 206]; // 厚 COâ‚‚:黄褐 / 薄 COâ‚‚:灰白
  if (o2 > 0.06 && o2 + n2 > 0.6) return [118, 168, 232]; // 氮氧大气:地球那样的蓝
  if (ch4 > 0.02) return [196, 174, 130]; // 甲烷雾:土黄
  if (n2 > 0.6) return [126, 158, 214];
  return [150, 166, 196];
}

/** 组成大气:库存(地质出气 + 水圈 + 引力留气)→ 逐种气体逃逸筛选 → 归一化 → 派生量 */
export function composeAtmosphere(x: {
  mass: number;
  radius: number;
  tempK: number;
  geo: number;
  magnetic: number;
  hydro: boolean;
  biotic: boolean;
  star: StarType;
  /** 母行星辐射带剂量(相对地球轨道 1;0 = 没有,默认整份大气公式不变) */
  radDose?: number;
}): Atmosphere {
  const escapeVel = EARTH_ESCAPE * Math.sqrt(clamp(x.mass, 0.01, 400) / Math.max(0.3, x.radius));
  const mag = clamp(x.magnetic, 0.02, 1.5);
  const geo = clamp(x.geo, 0, 1);
  // 挥发物库存(以地球的量为 1):引力越大留得越多,地质越活跃出气越多
  const inv: Partial<Record<GasId, number>> = {
    n2: 0.5 * x.mass * (0.35 + 0.65 * clamp(x.mass, 0.05, 3)),
    co2: 0.22 * x.mass * (0.35 + 0.65 * geo),
    h2o: (x.hydro ? 0.6 : 0.006) * x.mass,
    ar: 0.02 * x.mass,
    so2: 0.02 * x.mass * geo,
    ch4: 0.0006 * x.mass * (0.3 + 0.7 * geo) * (x.biotic ? 0.4 : 1),
    o2: 0,
  };
  // 逐种气体逃逸:温度相对这种气体的逃逸温度太高就被剥掉(辐射带剂量大 = 带电粒子把大气也刮走一层)
  const radLoss = 1 + 0.5 * (x.radDose ?? 0);
  for (const id of Object.keys(inv) as GasId[]) {
    const keep = clamp(1 - x.tempK / (0.18 * escapeTempK(GAS_MOLAR[id], escapeVel)), 0.01, 1) / radLoss;
    inv[id] = (inv[id] ?? 0) * keep;
  }
  // 水额外丢:离恒星近 + 引力小 + 磁场弱 + 星风强 → 光解、被剥走
  const windLoss = clamp(0.06 * (x.tempK / 280) * (1 / clamp(x.mass, 0.05, 8)) * (1 / mag) * x.star.wind, 0, 0.98);
  inv.h2o = (inv.h2o ?? 0) * (1 - windLoss);
  if (x.hydro) {
    // 水大多在海洋里:大气里的水汽只到饱和水汽压那么多(288 K 约 0.0068 atm)
    const sat = clamp(0.004 + 0.02 * clamp((x.tempK - 250) / 60, 0, 2), 0.001, 0.3);
    inv.h2o = Math.min(inv.h2o ?? 0, sat / 0.73);
    // 海洋与碳酸盐把 COâ‚‚ 收走:有液态水循环的世界,大气里只剩很少的 COâ‚‚(地球 400 ppm)
    inv.co2 = (inv.co2 ?? 0) * 0.002;
  }
  // 生物圈产氧:有水、温度合适、地质活动给养分 → 氧攒到 12–30%
  if (x.biotic && x.hydro && x.tempK > 245 && x.tempK < 335) {
    const richness = clamp((1 - Math.abs(x.tempK - 288) / 60) * (0.6 + 0.4 * geo), 0.25, 1);
    // 按氮池的比例攒氧(地球约 21%):富饶的世界 30% 左右,荒一点也有 22% 以上,不会掉到"不可呼吸"
    inv.o2 = (inv.n2 ?? 0) * (0.22 + 0.1 * richness);
  }
  let total = Object.values(inv).reduce((a, v) => a + (v ?? 0), 0);
  // 有生物圈的世界:出气/逸散把气压调回"能住人"的窗口(0.3–4 atm,目标 0.8),
  // 免得因为母星质量偏小或偏大就整颗星不可呼吸
  if (x.biotic && x.hydro && (total * 0.73 < 0.3 || total * 0.73 > 4)) {
    const scale = 0.8 / Math.max(1e-9, total * 0.73);
    for (const id of Object.keys(inv) as GasId[]) inv[id] = (inv[id] ?? 0) * scale;
    total = Object.values(inv).reduce((a, v) => a + (v ?? 0), 0);
  }
  const gases: AtmosGas[] = (Object.keys(inv) as GasId[])
    .map((id) => ({ id, frac: (inv[id] ?? 0) / Math.max(1e-9, total), partial: 0 }))
    .filter((g) => g.frac > 1e-6)
    .sort((a, b) => b.frac - a.frac);
  // 气压:地球库存总量约 1.37 → 1 atm
  const pressure = clamp(total * 0.73, 0.002, 80);
  for (const g of gases) g.partial = g.frac * pressure;
  const greenhouseK = greenhouseOf(pressure, gases);
  const f = (id: GasId) => gases.find((g) => g.id === id)?.frac ?? 0;
  // 可呼吸:氧 10–35%、二氧化碳 < 2%、气压 0.3–4 atm(低气压高原也能活,高气压不适)
  const breathable = f('o2') >= 0.1 && f('o2') <= 0.35 && f('co2') < 0.02 && pressure > 0.3 && pressure < 4;
  return {
    gases,
    pressure,
    greenhouseK,
    sky: skyOf(gases, pressure),
    escapeVel,
    breathable,
    biotic: x.biotic && f('o2') >= 0.05,
  };
}

/** 不可呼吸时,一句话说清缺什么(界面用);能呼吸就是 null */
export function breathReason(a: Atmosphere): string | null {
  if (a.breathable) return null;
  const frac = (id: GasId) => a.gases.find((g) => g.id === id)?.frac ?? 0;
  if (frac('o2') < 0.1) return frac('o2') < 0.02 ? '没有氧气(没有生物圈)' : '氧气太少';
  if (frac('o2') > 0.35) return '氧气太多';
  if (a.pressure < 0.3) return '气压太低,像高原顶上的真空';
  if (a.pressure > 4) return '气压太高,喘不动';
  if (frac('co2') >= 0.02) return '二氧化碳太多';
  return '成分不合适';
}

/** 气态行星的大气(没有地表,只给成分和磁场相互作用的量) */
export function gasGiantAtmosphere(mass: number): Atmosphere {
  const gases: AtmosGas[] = [
    { id: 'h2', frac: 0.88, partial: 0 },
    { id: 'he', frac: 0.1, partial: 0 },
    { id: 'ch4', frac: 0.015, partial: 0 },
    { id: 'nh3', frac: 0.005, partial: 0 },
  ];
  const pressure = clamp(0.5 + Math.sqrt(clamp(mass, 0, 32768) / 300), 0.5, 3);
  for (const g of gases) g.partial = g.frac * pressure;
  return { gases, pressure, greenhouseK: 0, sky: skyOf(gases, pressure), escapeVel: 60, breathable: false, biotic: false };
}

/** 卫星公转周期(天):和 gen/astro.ts 同一公式(地球-月球 = 60 个地球半径 / 27.3 天) */
export function moonOrbitDays(distance: number): number {
  const r = distance / 60;
  return 27.3 * r * Math.sqrt(r);
}

/**
 * 宜居卫星系:把「主天体 = 一颗行星」改写成「主天体 = 它的一颗卫星」。
 * 温度按母行星温度减一档(锁定卫星更冷)、自转 = 潮汐锁定的公转周期、大气按卫星质量与磁场重算、
 * 生物圈要母行星本来有 + 温度合适 + 卫星够大才给。
 */
/**
 * 卫星类型派生:
 *   · 半径 < 0.12 R⊕ 或质量 < 0.005 M⊕ → 矮卫星
 *   · 母行星温度 < 240 K(且不是大质量) → 冰卫星
 *   · 其余 → 岩石卫星
 * 显式写了 type 就直接用。
 */
export function moonTypeOf(moon: Pick<MoonDesign, 'mass' | 'radius'> & { type?: MoonType }, parentTempK: number): MoonType {
  if (moon.type) return moon.type;
  if (moon.radius < 0.12 || moon.mass < 0.005) return 'dwarf';
  if (parentTempK < 240 && moon.mass < 0.6) return 'ice';
  return 'rocky';
}

export function withHomeMoon(home: HomeWorld, planet: PlanetDesign, moonIndex: number): HomeWorld {
  const moon = planet.moons[moonIndex];
  if (!moon) return home;
  const tempK = planet.tempK - (moon.locked ? 25 : 10);
  const periodH = moonOrbitDays(moon.distance) * 24;
  const ratio = clamp(moon.mass / Math.max(0.05, planet.mass), 0.0005, 1);
  const pressure = clamp(planet.atmos.pressure * ratio * 2, 0.001, Math.max(0.001, planet.atmos.pressure));
  const air: Atmosphere = {
    ...planet.atmos,
    pressure,
    breathable: planet.atmos.breathable && tempK >= 250 && tempK <= 320 && moon.radius >= 0.25 && pressure >= 0.5,
  };
  return {
    ...home,
    moon: moonIndex,
    meanTempK: tempK,
    dayHours: moon.locked ? Math.max(6, Math.min(96, periodH)) : Math.max(24, Math.min(96, periodH)),
    atmosphere: clamp(atmosphereOf({ mass: moon.mass, magnetic: 0.1 }, tempK), 0.02, 1.3),
    air,
    biotic: planet.biotic && tempK >= 245 && tempK <= 325 && moon.radius >= 0.25 && pressure >= 0.15,
  };
}

/**
 * 相对地球的潮差(地球 = 1):卫星质量 ÷ 距离³,再叠太阳的潮汐。
 * 太阳项按"质量 ÷ 距离³"算:太阳 33.3 万个地球质量、1 AU ≈ 23481 个地球半径,约合 0.46 个月亮。
 */
export function tideOf(home: PlanetDesign, star: StarType): number {
  let v = 0;
  for (const m of home.moons) v += m.mass / (m.distance * m.distance * m.distance);
  const d = 23481 * home.a;
  v += (333000 * star.mass) / (d * d * d);
  // 地球-月球:0.0123 / 60.3³ ≈ 5.6e-8,折算成"地球 = 1"
  return v / 5.6e-8;
}

/** 大气保有系数:磁场挡恒星风、质量留得住、温度低一点不容易跑。地球 = 1 */
export function atmosphereOf(p: Pick<PlanetDesign, 'mass' | 'magnetic'>, tempK: number): number {
  const grav = clamp(p.mass / 1, 0.05, 4);
  const shield = clamp(p.magnetic, 0.02, 1.5);
  const cold = clamp(EARTH_MEAN_K / tempK, 0.5, 2);
  return clamp(Math.sqrt(grav) * (0.45 + 0.55 * shield) * Math.sqrt(cold), 0.02, 1.3);
}

/** 磁暴频率:星风越强、磁场越弱,磁暴越多;地球 = 1 */
export function stormRate(star: StarType, magnetic: number): number {
  return star.wind / clamp(magnetic, 0.05, 1.5);
}

/** 按种子取 [0,1) 的数(设计用,不用 Math.random) */
function unit(seed: number, tag: string): number {
  return (subSeed(seed, 'astro:' + tag) % 1_000_000) / 1_000_000;
}

/** 按种子取 [lo, hi) 的数 */
function ranged(seed: number, tag: string, lo: number, hi: number): number {
  return lo + unit(seed, tag) * (hi - lo);
}

/**
 * 一颗固态行星的温度与大气(温度 →” 温室 三次不动点;tag 决定"有没有水、有没有生物圈"的随机数)。
 * 主行星在定下落脚轨道以后要重算一次,所以单独拎出来,别在两处写两套。
 */
export function modelRocky(x: {
  star: StarType;
  a: number;
  radius: number;
  mass: number;
  albedo: number;
  geo: number;
  magnetic: number;
  seed: number;
  tag: number;
  /** 偏心率(不给 = 圆):平均辐照按 1/âˆš(1âˆ’e²) 折算 */
  ecc?: number;
  /** 额外的温度补偿(K):气态巨星的宜居卫星会吃母行星潮汐加热 */
  extraK?: number;
  /** 设定可以强制"有水圈 / 有生物圈"(主行星按 life 参数);不给 = 按种子自动 */
  hydro?: boolean;
  biotic?: boolean;
  /** 母行星辐射带剂量(0 = 没有):既洗掉大气,也压低有水/有生命的概率 */
  radDose?: number;
}): {
  ins: number;
  eq: number;
  hydro: boolean;
  biotic: boolean;
  tempK: number;
  air: Atmosphere;
} {
  // 椭圆轨道的平均辐照 = (L/a²)/âˆš(1âˆ’e²);e = 0 时和原来逐位一样
  const e = clamp(x.ecc ?? 0, 0, 0.5);
  const ins = insolationOf(x.star.lum, x.a) / Math.sqrt(1 - e * e);
  const eq = equilibriumTempK(ins, x.albedo);
  const dose = clamp(x.radDose ?? 0, 0, 3);
  const hydro = x.hydro ?? (eq + 12 > 250 && eq + 40 < 340 && unit(x.seed, `hy${x.tag}`) > 0.25 + 0.1 * dose);
  const biotic = x.biotic ?? (hydro && unit(x.seed, `bio${x.tag}`) > 0.55 + 0.12 * dose);
  // 先给个地球尺度的初值,后面三次把温室算进去(extraK = 额外加热,比如母行星潮汐)
  const base = eq + (x.extraK ?? 0);
  let tempK = base + 10;
  let air = composeAtmosphere({ mass: x.mass, radius: x.radius, tempK, geo: x.geo, magnetic: x.magnetic, hydro, biotic, star: x.star, radDose: dose });
  for (let it = 0; it < 3; it++) {
    tempK = meanTempK(base, air.greenhouseK);
    air = composeAtmosphere({ mass: x.mass, radius: x.radius, tempK, geo: x.geo, magnetic: x.magnetic, hydro, biotic, star: x.star, radDose: dose });
  }
  return { ins, eq, hydro, biotic, tempK, air };
}

/**
 * 生成整份星球系设计。
 * astro = 0 时也给出一个"地球基线"的设计(方便界面预览),但生成流程不看它。
 */
export function designOf(
  seed0: number,
  p: {
    system: number;
    planets: number;
    gas: number;
    moons: number;
    tilt: number;
    rotation: number;
    geo: number;
    mag: number;
    /** 星系构型:0 单星、1 双固态行星、2 双恒星、3 气态巨星的宜居卫星(P5 才用,先定参数位) */
    arch?: number;
    /** 主行星的生命:0 自动、1 有生物圈、2 无生命 */
    life?: number;
    /** 主行星取第几颗(1 起;0 = 自动) */
    home?: number;
    /** 宜居卫星系:主行星是母行星的第几颗卫星(0 起) */
    homeMoon?: number;
    /** 双恒星构型 0 密近 / 1 分离 / 2 三合(不写 = 按种子挑) */
    binaryTier?: number;
    /** 整系重掷(0 = 不掷) */
    salt?: number;
    /** 恒星数量 1 / 2(不写 = 看 arch) */
    starCount?: number;
    /** 子星系类型 0 / 1 / 3(不写 = 看 arch) */
    subSystem?: number;
    /** 光谱型 0–6(M K G F A B O;不写 = 按 system / 种子) */
    spectral?: number;
    /** 子型 0–9(0 最热;不写 = 5) */
    sub?: number;
    /** 光度级(0 = 主序 V;现在只有这一档) */
    lumClass?: number;
  },
): AstroDesign {
  // 整系重掷:salt = 0 时种子原样(和加这一层以前逐字节一样)
  const seed = p.salt && p.salt > 0 ? subSeed(seed0, `astro-salt:${Math.round(p.salt)}`) : seed0;
  // 拆成两个正交维度:恒星数量(1/2) 与 子星系类型(0 单行星 / 1 双固态 / 3 气态巨星宜居卫星);
  // 老数据只写 arch,这里按下面的兼容投影还原;都不写 = 老行为(默认世界逐字节不变)
  const arch0 = clamp(Math.round(p.arch ?? 0), 0, 3);
  const starCount = p.starCount !== undefined ? clamp(Math.round(p.starCount), 1, 2) : arch0 === 2 ? 2 : 1;
  const subRaw = p.subSystem !== undefined ? clamp(Math.round(p.subSystem), 0, 3) : arch0 === 2 ? 0 : arch0;
  const sub = subRaw === 2 ? 0 : subRaw;
  const starBinary = starCount === 2;
  /** 对外报的构型:双恒星优先(标签用),否则就是子星系类型 */
  const arch = starBinary ? 2 : sub;
  const life = clamp(Math.round(p.life ?? 0), 0, 2);
  const primary = pickStar(p.system, seed, p.spectral, p.sub);
  // 双恒星(arch = 2):主星 + 一颗 0.25–0.75 倍质量的伴星;对外合成一颗"总光度 = 两星之和"的等效星,
  // 行星绕的是双星的质心(轨道半径必须远大于两星间距,下面按 0.05–0.12 a_hz 取间距)
  let companionStar: StarType | undefined;
  let thirdStar: StarType | undefined;
  let binaryStar: AstroDesign['binaryStar'];
  /** 双恒星构型:参数给了按参数,没给按种子挑(密近 50% / 分离 30% / 三合 20%) */
  const tierOf = (): BinaryTier => {
    if (p.binaryTier !== undefined) return p.binaryTier === 2 ? 'triple' : p.binaryTier === 1 ? 'wide' : 'close';
    const u = unit(seed, 'bintier');
    return u < 0.5 ? 'close' : u < 0.8 ? 'wide' : 'triple';
  };
  if (starBinary) {
    const tier = tierOf();
    const pool = STAR_TYPES.filter((s) => s.id !== 'bin');
    const nearest = (mass: number) => pool.reduce((best, s) => (Math.abs(s.mass - mass) < Math.abs(best.mass - mass) ? s : best), pool[0]);
    const bRatio = tier === 'triple' ? ranged(seed, 'bstarM', 0.4, 1) : ranged(seed, 'bstarM', 0.25, 0.75);
    companionStar = nearest(primary.mass * bRatio);
    const lumSumAB = primary.lum + companionStar.lum;
    const logU = (lo: number, hi: number, tag: string) => Math.pow(10, ranged(seed, tag, Math.log10(lo), Math.log10(hi)));
    const sepAB =
      tier === 'close'
        ? clamp(Math.sqrt(lumSumAB) * ranged(seed, 'binseps', 0.05, 0.12), 0.02, 0.2)
        : tier === 'wide'
          ? logU(1, 50, 'binsepw')
          : logU(0.2, 20, 'binsept');
    const periodDays = 365.25 * Math.sqrt((sepAB * sepAB * sepAB) / (primary.mass + companionStar.mass));
    const members: StarMember[] = [{ role: 'A', star: primary }, { role: 'B', star: companionStar }];
    let outerSepAU: number | undefined;
    let outerPeriodYears: number | undefined;
    if (tier === 'triple') {
      thirdStar = nearest(primary.mass * ranged(seed, 'cstarM', 0.08, 0.5));
      outerSepAU = logU(500, 15000, 'binsepc');
      outerPeriodYears = Math.sqrt((outerSepAU * outerSepAU * outerSepAU) / (primary.mass + companionStar.mass + thirdStar.mass));
      members.push({ role: 'C', star: thirdStar });
    }
    binaryStar = { tier, members, sepAU: sepAB, periodDays, lumRatio: companionStar.lum / lumSumAB, companion: companionStar, outerSepAU, outerPeriodYears };
  }
  const lumSum = primary.lum + (companionStar?.lum ?? 0) + (thirdStar?.lum ?? 0);
  const star: StarType = companionStar
    ? {
        ...primary,
        id: 'bin',
        label: thirdStar ? '三合星' : '双星',
        lum: round24(lumSum),
        temp: Math.round(
          (primary.temp * primary.lum + companionStar.temp * companionStar.lum + (thirdStar ? thirdStar.temp * thirdStar.lum : 0)) / lumSum,
        ),
        mass: round24(primary.mass + companionStar.mass + (thirdStar?.mass ?? 0)),
        wind: Math.max(primary.wind, companionStar.wind, thirdStar?.wind ?? 0),
      }
    : primary;
  const aHz = Math.sqrt(star.lum); // 宜居带:a_hz = sqrt(L)
  // 双固态行星要两颗岩质行星;别的构型照旧
  const nRocky0 = clamp(Math.round(p.planets > 0 ? p.planets : 2 + Math.floor(unit(seed, 'nrocky') * 3)), 1, 6);
  const nRocky = sub === 1 ? Math.max(2, nRocky0) : nRocky0;
  const nGas = clamp(Math.round(p.gas), sub === 3 ? 1 : 0, 4);

  // 固态行星:从宜居带里侧铺到外侧(里热外冷),其中一颗是主行星
  const rocky: PlanetDesign[] = [];
  for (let i = 0; i < nRocky; i++) {
    const t = nRocky === 1 ? 0.5 : i / (nRocky - 1);
    const a = nRocky === 1 ? aHz * 0.98 : aHz * (0.55 + 1.45 * t) * ranged(seed, `a${i}`, 0.94, 1.06);
    let radius = ranged(seed, `r${i}`, 0.55, 1.6);
    const mass = radius * radius * radius * ranged(seed, `m${i}`, 0.8, 1.3);
    // 行星类型:最外圈固态行星有一定概率是矮行星(冥王星级),其余按半径派生
    const isDwarf = i === nRocky - 1 && nRocky > 2 && unit(seed, `dw${i}`) > 0.62;
    if (isDwarf) radius = ranged(seed, `dwR${i}`, 0.06, 0.28);
    const ptype: PlanetType = isDwarf ? 'dwarf' : 'rocky';
    const albedo = ranged(seed, `alb${i}`, 0.12, 0.42);
    const geo = clamp(ranged(seed, `geo${i}`, 0.15, 1) * clamp(p.geo, 0.4, 3) * 0.6, 0, 1);
    const magnetic = clamp(ranged(seed, `mag${i}`, 0.15, 0.85) * clamp(p.mag, 0, 2) * (0.4 + 0.6 * geo), 0, 1.5);
    const ecc = ranged(seed, `e${i}`, 0, 0.12);
    const m = modelRocky({ star, a, radius, mass, albedo, geo, magnetic, seed, tag: i, ecc });
    rocky.push({
      index: i,
      kind: 'rocky',
      type: ptype,
      a,
      ecc,
      incDeg: ranged(seed, `inc${i}`, 0, 7),
      nodeDeg: ranged(seed, `node${i}`, 0, 360),
      radius,
      mass,
      rotation: ranged(seed, `rot${i}`, 10, 60),
      tilt: ranged(seed, `tilt${i}`, 2, 55),
      albedo,
      geoActivity: geo,
      magnetic,
      hydro: m.hydro,
      biotic: m.biotic,
      atmos: m.air,
      tempK: m.tempK,
      moons: [],
      ring: unit(seed, `ringr${i}`) > 0.8,
    });
  }

  // 主行星:取最靠宜居带中心的那颗(home 指定了就按指定,1 起);自转与倾角由参数覆盖(设定优先)
  let homeIdx = 0;
  let best = Infinity;
  for (let i = 0; i < rocky.length; i++) {
    const d = Math.abs(rocky[i].a - aHz);
    if (d < best) {
      best = d;
      homeIdx = i;
    }
  }
  if (p.home && p.home > 0) homeIdx = clamp(Math.round(p.home) - 1, 0, rocky.length - 1);
  const home0 = rocky[homeIdx];
  home0.tilt = clamp(p.tilt, 0, 80);
  home0.rotation = clamp(p.rotation, 4, 200);
  // 主行星放到宜居带正中(不靠"哪颗离得最近"碰运气):辐照 ≈ 1,气候才是地球量级;
  // 大小也收在地球量级(重力、气压、可呼吸都落在"能住人"的范围);别的行星照旧可以很野。
  // 轨道/大小一变,温度和大气按同一套不动点重算一遍
  home0.a = aHz * (0.96 + 0.08 * unit(seed, 'homeA'));
  home0.radius = 0.92 + 0.28 * unit(seed, 'homeR');
  const hr2 = home0.radius * home0.radius;
  home0.mass = hr2 * home0.radius * (0.85 + 0.3 * unit(seed, 'homeM'));
  {
    const hm = modelRocky({
      star,
      a: home0.a,
      radius: home0.radius,
      mass: home0.mass,
      albedo: home0.albedo,
      geo: home0.geoActivity,
      magnetic: home0.magnetic,
      seed,
      tag: homeIdx,
      // 设定优先:life = 1 有生物圈(顺便把水圈定成有,不然生物圈没处活)、2 无生命;0 按种子自动
      hydro: life === 1 ? true : life === 2 ? undefined : undefined,
      biotic: life === 1 ? true : life === 2 ? false : undefined,
    });
    home0.hydro = hm.hydro;
    home0.biotic = hm.biotic;
    home0.atmos = hm.air;
    home0.tempK = hm.tempK;
  }

  // 卫星:主行星按参数给(有卫星才有像样的潮汐);别的固态行星少量随机
  for (let i = 0; i < rocky.length; i++) {
    const n = i === homeIdx ? clamp(Math.round(p.moons), 0, 12) : unit(seed, `nm${i}`) > 0.72 ? 1 : 0;
    rocky[i].moons = [];
    for (let k = 0; k < n; k++) {
      // 卫星的量和距离都收在"像月球"的范围里:潮差不会夸张到几十倍(地球-月球 = 1)
      rocky[i].moons.push({
        mass: ranged(seed, `mo${i}-${k}`, 0.005, 0.018),
        distance: ranged(seed, `md${i}-${k}`, 45, 72),
        radius: ranged(seed, `mr${i}-${k}`, 0.2, 0.35),
        locked: unit(seed, `ml${i}-${k}`) > 0.4,
      });
    }
  }

  // 双固态行星(arch = 1):两颗岩质行星绕共同质心;主行星取其中一颗,另一颗是"伴星"
  let comp0: PlanetDesign | null = null;
  let binSep = 0;
  let binPeriod = 0;
  if (sub === 1) {
    comp0 = rocky[(homeIdx + 1) % rocky.length];
    // 双固态行星:两颗质量要接近(用户要求)、间距要小(别到公转半径那个量级)
    const massRatio = ranged(seed, 'binmr', 0.75, 1.3);
    const wantMass = home0.mass * massRatio;
    // 保持密度近似,由质量推半径
    comp0.mass = wantMass;
    comp0.radius = Math.max(0.2, home0.radius * Math.cbrt(massRatio));
    // 间距:至少 2.5 倍两星半径和,并且不超过 0.35 倍希尔半径;落在 0.0006–0.003 AU(约 9–45 万 km)
    const radiusSumAU = (home0.radius + comp0.radius) * 6371 / 1.496e8;
    const hill = home0.a * Math.cbrt(Math.max(1e-9, (home0.mass + comp0.mass) / (3 * Math.max(0.05, star.mass) * 333000)));
    binSep = clamp(ranged(seed, 'binsep', 0.0006, 0.003), Math.max(0.0004, 2.5 * radiusSumAU), Math.max(0.0005, 0.35 * hill));
    // 开普勒:互绕周期(年)= sqrt(d³ · Mâ˜‰ / M总);质量单位是地球质量,Mâ˜‰ = 333000 地球
    binPeriod = 365.25 * Math.sqrt((binSep * binSep * binSep * 333000) / Math.max(0.05, home0.mass + comp0.mass));
    comp0.a = home0.a; // 同一轨道,离得极近;示意图里画成挨着的两颗
    const cm = modelRocky({ star, a: home0.a, radius: comp0.radius, mass: comp0.mass, albedo: comp0.albedo, geo: comp0.geoActivity, magnetic: comp0.magnetic, seed, tag: rocky.indexOf(comp0) });
    comp0.hydro = cm.hydro;
    comp0.biotic = cm.biotic;
    comp0.atmos = cm.air;
    comp0.tempK = cm.tempK;
  }

  // 气态行星:在冻线以外,只参与轨道、天象、磁场相互作用(不给地表)
  const frost = 2.7 * aHz;
  const gas: PlanetDesign[] = [];
  for (let i = 0; i < nGas; i++) {
    const radius = ranged(seed, `gr${i}`, 3.2, 11);
    const mass = radius * radius * radius * 0.25;
    gas.push({
      index: nRocky + i,
      kind: 'gas',
      type: radius >= 6 ? 'gasGiant' : radius >= 3.2 ? 'iceGiant' : 'subNeptune',
      a: frost * (1.05 + 0.75 * i) * ranged(seed, `ga${i}`, 0.92, 1.08),
      ecc: ranged(seed, `ge${i}`, 0, 0.08),
      incDeg: ranged(seed, `ginc${i}`, 0, 3),
      nodeDeg: ranged(seed, `gnode${i}`, 0, 360),
      radius,
      mass,
      rotation: ranged(seed, `grot${i}`, 8, 20),
      tilt: ranged(seed, `gt${i}`, 1, 30),
      albedo: ranged(seed, `gal${i}`, 0.4, 0.6),
      geoActivity: 0,
      magnetic: ranged(seed, `gm${i}`, 1.5, 6),
      hydro: false,
      biotic: false,
      atmos: gasGiantAtmosphere(mass),
      tempK: equilibriumTempK(insolationOf(star.lum, frost * (1.05 + 0.75 * i)), 0.5),
      moons: Array.from({ length: Math.round(ranged(seed, `gnm${i}`, 0, 4)) }, (_, k) => ({
        mass: ranged(seed, `gmo${i}-${k}`, 0.001, 0.03),
        distance: ranged(seed, `gmd${i}-${k}`, 8, 40),
        radius: ranged(seed, `gmr${i}-${k}`, 0.1, 0.3),
        locked: true,
      })),
      ring: unit(seed, `ringg${i}`) > 0.45,
    });
  }

  // 气态巨星的宜居卫星(arch = 3):第一颗气态行星是母行星,主行星改成绕它转的类地大卫星
  let habMoon: { parent: PlanetDesign; sepR: number; periodDays: number; tidalHeatK: number } | null = null;
  let homeRadDose = 0;
  if (sub === 3 && gas.length) {
    const parent = gas[0];
    // 母行星挪进宜居带(热木星型):卫星的日照才和地球一个量级
    parent.a = home0.a;
    parent.tempK = equilibriumTempK(insolationOf(star.lum, parent.a), parent.albedo);
    const sepR = ranged(seed, 'moonsep', 30, 80);
    const dR = sepR * parent.radius;
    const aMoonAU = dR / 23481;
    const periodDays = 365.25 * Math.sqrt((aMoonAU * aMoonAU * aMoonAU) / Math.max(0.0001, parent.mass / 333000));
    // 潮汐加热:母行星越大、卫星越近,加热越强(2–14 K)
    const tidalHeatK = ranged(seed, 'tidalheat', 2, 14) * clamp(parent.mass / 300, 0.4, 1.6);
    // 辐射带剂量:母行星磁场越强、卫星离母行星越近,带电粒子剂量越大(相对地球轨道 = 1)
    const q = 50 / sepR;
    const dose = round24(clamp(parent.magnetic * q * q * 0.6, 0, 3));
    homeRadDose = dose;
    const hm = modelRocky({
      star,
      a: home0.a,
      radius: home0.radius,
      mass: home0.mass,
      albedo: home0.albedo,
      geo: home0.geoActivity,
      magnetic: home0.magnetic,
      seed,
      tag: homeIdx,
      extraK: tidalHeatK,
      hydro: life === 1 ? true : undefined,
      biotic: life === 1 ? true : life === 2 ? false : undefined,
      radDose: dose,
    });
    home0.hydro = hm.hydro;
    home0.biotic = hm.biotic;
    home0.atmos = hm.air;
    home0.tempK = hm.tempK;
    // 潮汐锁定:自转 = 绕母行星的公转周期(几十到一百多小时)
    home0.rotation = clamp(periodDays * 24, 4, 200);
    home0.moons = [];
    habMoon = { parent, sepR, periodDays, tidalHeatK };
  }

  // 行星按轨道排好(固态和气态混排),主行星的下标跟着换
  const all = [...rocky, ...gas].sort((x, y) => x.a - y.a);
  // 双恒星/三合星:把 AB 间距抬到「所有行星都在 S 型稳定区」的下限(种子的间距不够大时)
  if (binaryStar && all.length) {
    const needSep = (Math.max(...all.map((p) => p.a)) / 0.3) * 1.05;
    if (binaryStar.tier !== 'close' && binaryStar.sepAU < needSep) {
      const sepAU = Math.round(needSep * 10000) / 10000;
      const mAB = binaryStar.members[0].star.mass + binaryStar.members[1].star.mass;
      const periodDays = 365.25 * Math.sqrt((sepAU * sepAU * sepAU) / mAB);
      binaryStar = { ...binaryStar, sepAU, periodDays };
    }
  }
  all.forEach((b, i) => (b.index = i));
  const home = all.findIndex((b) => b === home0);
  // 双固态行星:伴星下标、以及伴星给主行星加的潮汐(距离用地球半径数:1 AU = 23481 RâŠ•)
  const binMassRatio = comp0 ? Math.round((comp0.mass / Math.max(1e-6, home0.mass)) * 1000) / 1000 : undefined;
  const binAHome = comp0 ? binSep * (comp0.mass / Math.max(1e-6, home0.mass + comp0.mass)) : undefined;
  const binAComp = comp0 ? binSep * (home0.mass / Math.max(1e-6, home0.mass + comp0.mass)) : undefined;
  const binary = comp0
    ? {
        index: all.indexOf(comp0),
        separationAU: binSep,
        periodDays: binPeriod,
        sepKm: Math.round(binSep * 1.496e8),
        massRatio: binMassRatio,
        aHomeAU: binAHome,
        aCompanionAU: binAComp,
      }
    : undefined;
  const bd = 23481 * binSep;
  const compTide = comp0 && bd > 0 ? comp0.mass / (bd * bd * bd) / 5.6e-8 : 0;

  // 宜居卫星:母行星给卫星的潮汐(距离也是地球半径数)
  const moonDR = habMoon ? habMoon.sepR * habMoon.parent.radius : 0;
  const parentTide = habMoon && moonDR > 0 ? habMoon.parent.mass / (moonDR * moonDR * moonDR) / 5.6e-8 : 0;

  const ins = insolationOf(star.lum, home0.a);
  const atmosphere = atmosphereOf(home0, home0.tempK);
  const homeWorld: HomeWorld = {
    index: home,
    yearDays: orbitYears(home0.a) * EARTH_YEAR_DAYS,
    dayHours: home0.rotation,
    tilt: home0.tilt,
    insolation: ins,
    meanTempK: home0.tempK,
    tide: tideOf(home0, star) + compTide + parentTide,
    atmosphere,
    magneticPole: clamp(90 - 12 * clamp(home0.magnetic, 0, 1.5) * (0.6 + 0.4 * unit(seed, 'pole')), 55, 90),
    storms: stormRate(star, home0.magnetic),
    radDose: homeRadDose,
    air: home0.atmos,
    biotic: home0.biotic,
  };

  // 宜居卫星系:主行星是这颗母行星的第 k 颗卫星
  const homeMoonIdx = p.homeMoon != null ? clamp(Math.round(p.homeMoon), 0, Math.max(0, home0.moons.length - 1)) : undefined;

  // 地表预算:有没有地质活动决定精度(主行星 -1 = 用 params.cells;气态行星 0 = 不做地表)
  const budget = all.map((b) =>
    b.kind === 'gas' ? BUDGET.gas : b === home0 ? -1 : b.geoActivity >= 0.35 ? BUDGET.activeRocky : BUDGET.deadRocky,
  );

  return {
    star,
    arch,
    binary,
    binaryStar,
    habitableMoon: habMoon
      ? { parent: all.indexOf(habMoon.parent), index: home, sepR: habMoon.sepR, periodDays: habMoon.periodDays, tidalHeatK: habMoon.tidalHeatK }
      : undefined,
    planets: all,
    home: homeMoonIdx !== undefined && home0.moons[homeMoonIdx] ? withHomeMoon(homeWorld, home0, homeMoonIdx) : homeWorld,
    budget,
    stars: starfield(seed),
    nearby: nearbyStars(seed),
  };
}

/** 天球上的星:均匀撒在球面上,星等按亮度幂律,颜色按温度取 */
export function starfield(seed: number, n = 420): AstroDesign['stars'] {
  const out: AstroDesign['stars'] = [];
  for (let i = 0; i < n; i++) {
    const u = unit(seed, `sf-u${i}`) * 2 - 1;
    const phi = unit(seed, `sf-p${i}`) * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const b = unit(seed, `sf-b${i}`);
    const t = unit(seed, `sf-c${i}`);
    // 三角函数舍入到 24 位:同一个世界在任何 CPU 上星图逐位一致(和推演同一套约定)
    out.push({
      dir: [round24(r * round24(Math.cos(phi))), u, round24(r * round24(Math.sin(phi)))],
      mag: 1 + 5.5 * b * b,
      color: t < 0.5 ? [255, 190, 150] : t < 0.82 ? [255, 250, 230] : [200, 220, 255],
    });
  }
  return out;
}

/** 邻近恒星:只做星图关系(距离、颜色、星等),不做航行物理 */
export function nearbyStars(seed: number, n = 12): AstroDesign['nearby'] {
  const out: AstroDesign['nearby'] = [];
  for (let i = 0; i < n; i++) {
    const t = unit(seed, `nb-h${i}`);
    out.push({
      distance: ranged(seed, `nb-d${i}`, 3.5, 42),
      color: t < 0.45 ? [255, 200, 160] : t < 0.8 ? [255, 250, 232] : [205, 222, 255],
      mag: ranged(seed, `nb-m${i}`, 0.2, 6),
    });
  }
  return out.sort((x, y) => x.distance - y.distance);
}
// ---- 覆盖表(逐行星/卫星的"和种子不一样的地方"):S2 起由新建世界的星系结构编辑 ----
export interface OrbitOverride {
  a?: number;
  ecc?: number;
  incDeg?: number;
  nodeDeg?: number;
  /** 公转周期(天)覆盖;不写 = 开普勒导出 */
  periodDays?: number;
}
/** 一颗天体的地表生成参数(每颗固态行星/卫星可以不一样;不写 = 按温度和物质状态派生) */
export interface SurfaceOverride {
  /** 陆地比例 0.02–0.98 */
  landFraction?: number;
  /** 气温偏移(°C,-40–40) */
  temperature?: number;
  /** 降水倍率 0–5 */
  rainfall?: number;
  /** 精细度(地块数)200–200000 */
  cells?: number;
}
/**
 * 每颗天体自己的生成参数(不写 = 继承世界级默认)。每颗行星/卫星各一套:
 * 火星和地球可以有不同的板块数、造山强度、陆地比例、气候与精细度。
 */
export interface BodyGen {
  /** 生成方式:随机 / 照手绘图(照图要在 S4 存原图资产) */
  mode?: 'random' | 'image';
  /** 这颗天体自己的种子 */
  seed?: number;
  /** 板块数 2–64 */
  plates?: number;
  /** 造山强度 0–5 */
  mountains?: number;
  /** 陆地比例 0.02–0.98 */
  landFraction?: number;
  /** 气温偏移(°C,-40–40) */
  temperature?: number;
  /** 降水倍率 0–5 */
  rainfall?: number;
  /** 精细度(地块数)200–200000 */
  cells?: number;
  /** 照手绘图资产 id(原图 + 认出的格子图在 IndexedDB;见 gen/sketchAssets.ts、ui/sketchAssetStore.ts) */
  sketchId?: string;
  /** 这颗天体有没有水圈(模板一键套用时写;不写 = 按设计层的 hydro) */
  water?: boolean;
}
export interface PlanetOverride extends OrbitOverride {
  index: number;
  radius?: number;
  /** 质量(MâŠ•)覆盖;不写 = 由半径按密度推出 */
  mass?: number;
  /** 地质活跃度覆盖(0–1) */
  geo?: number;
  /** 磁场强度覆盖(0–1.5) */
  mag?: number;
  tilt?: number;
  rotation?: number;
  life?: number;
  reroll?: number;
  /** 这颗行星的卫星数(0–4;不写 = 按种子,主行星还按「主行星卫星数」参数) */
  moonCount?: number;
  terrain?: readonly unknown[];
  /** 这颗行星自己的地表参数(拱给"地表生成下发") */
  surface?: SurfaceOverride;
  /** 这颗行星自己的生成参数(板块/造山/气候/精度/种子/生成方式) */
  gen?: BodyGen;
  home?: boolean;
  /** N2:这颗行星在子星系里的角色(不写 = 按設計層派生) */
  role?: 'planet' | 'binaryCompanion' | 'gasParent' | 'habitableMoon';
  /** 手动改类型(岩石/矮行星/亚海王星/气态巨行星/冰巨行星);改完按类型重算物理参数 */
  type?: PlanetType;
}
export interface MoonOverride extends OrbitOverride {
  planet: number;
  moon: number;
  distance?: number;
  radius?: number;
  /** 质量(MâŠ•)覆盖 */
  mass?: number;
  locked?: boolean;
  life?: number;
  reroll?: number;
  terrain?: readonly unknown[];
  /** 卫星自己的地表参数 */
  surface?: SurfaceOverride;
  /** 卫星自己的生成参数 */
  gen?: BodyGen;
  /** 手动改的卫星类型 */
  type?: MoonType;
}
/** 手动改的星体名(恒星 / 行星下标 / 「行星:卫星」) */
export interface BodyNames {
  star?: string;
  planets?: Record<string, string>;
  moons?: Record<string, string>;
  /** N2/N13:子星系组名(键 = 组主天体下标;不写 = 默认「{主天体名}系」) */
  groups?: Record<string, string>;
}
/** 恒星这一层的物理覆盖(高级项;不写 = 按谱型) */
export interface StarOverride {
  /** 主星质量 Mâ˜‰;改了会重算光度/温度/风,行星大气与潮汐也按新恒星算 */
  mass?: number;
  /** 双恒星伴星质量 Mâ˜‰ */
  companionMass?: number;
  /** 手动指定 AB 间距(AU;给了会按行星轨道稳定区夹取) */
  sepAU?: number;
  /** 手动指定三合星 C 与 AB 的间距(AU;不会小于 5×AB 间距) */
  outerSepAU?: number;
}
/**
 * 子星系(显式成员):R2 起组归属是存进覆盖表的,不再由生成结果反推。
 * members = 行星下标(按轨道排);role 决定这组怎么生成/显示。
 */
export interface GroupOverride {
  /** 稳定 id(树里排序/改名用;不参与生成) */
  id: number;
  role: 'planet' | 'binaryPair' | 'gasSystem' | 'habitableMoonSystem';
  members: number[];
}

export interface SystemOverrides {
  planets: readonly PlanetOverride[];
  moons: readonly MoonOverride[];
  belts?: readonly unknown[];
  /** 手动改名(不写 = 按种子生成的名字) */
  bodyNames?: BodyNames;
  /** 恒星质量覆盖 */
  star?: StarOverride;
  /** 显式子星系(R2;不写 = 按生成结果派生,旧档/旧世界逐字节不变) */
  groups?: readonly GroupOverride[];
}
export const EMPTY_OVERRIDES: SystemOverrides = { planets: [], moons: [] };

/**
 * 把覆盖表套到设计层上并**重算受影响的量**(轨道/半径/生命变了 → 大气与温度要重算;home 选谁;
 * 卫星的距离/半径/锁定)。空覆盖表原样返回,默认世界不受影响。
 */
const IS_SOLAR_MASS_RANGE: [number, number] = [0.05, 100];

/**
 * 按质量推主序星(手选质量用;不参与默认生成)。
 * 走 gen/stellar.ts 的简化赫罗:质量 → 光谱型/子型 → L/T/R 一整套自洽值,
 * 超出主序范围(0.08–16 Mâ˜‰)只夹到端点并标 offMainSequence,不再按 M^3.5 外推爆到 1e7 L☉。
 */
export function starFromMass(base: StarType, mass: number): StarType {
  const at = starFromMassHR(mass);
  const out = starTypeOf(at);
  return { ...out, w: base.w, wind: windOf(at.cls, at.lum) };
}
/** 上次 starFromMass 的结果是不是"离开主序"(界面提示用) */
export function offMainSequence(mass: number): boolean {
  return mass > MS_MASS_SAFE[1] || mass < MS_MASS_SAFE[0];
}

export function rebuildDesign(design: AstroDesign, overrides: SystemOverrides | null | undefined, params: { seed: number; homeMoon?: number }): AstroDesign {
  const starOnly = !!(overrides?.star && (overrides.star.mass !== undefined || overrides.star.companionMass !== undefined || overrides.star.sepAU !== undefined || overrides.star.outerSepAU !== undefined));
  const groupsOnly = !!(overrides?.groups && overrides.groups.length > 0);
  if (!overrides || (!overrides.planets.length && !overrides.moons.length && !starOnly && !groupsOnly)) return design;
  const byIndex = new Map(overrides.planets.map((o) => [o.index, o]));
  // 恒星质量覆盖:主星质量变了 → 光度/温度重算;双恒星伴星同理
  const star = overrides.star?.mass !== undefined ? starFromMass(design.star, overrides.star.mass) : design.star;
  let binaryStar = design.binaryStar;
  if (binaryStar && overrides.star?.companionMass !== undefined) {
    binaryStar = { ...binaryStar, companion: starFromMass(binaryStar.companion, overrides.star.companionMass) };
  }
  // 双星间距 / C 间距手输:按行星轨道稳定区夹取,再重算 AB 互绕周期与 C 的公转周期
  if (binaryStar && overrides.star && (overrides.star.sepAU !== undefined || overrides.star.outerSepAU !== undefined)) {
    const mAB = binaryStar.members[0].star.mass + binaryStar.members[1].star.mass;
    const planetAs = design.planets.map((p, i) => {
      const po = overrides.planets.find((x) => x.index === i);
      return po?.a ?? p.a;
    });
    const sep = overrides.star.sepAU !== undefined ? stableSepFor(planetAs, overrides.star.sepAU) : binaryStar.sepAU;
    const periodDays = 365.25 * Math.sqrt((sep * sep * sep) / Math.max(1e-6, mAB));
    let outerSepAU = binaryStar.outerSepAU;
    let outerPeriodYears = binaryStar.outerPeriodYears;
    if (overrides.star.outerSepAU !== undefined && binaryStar.tier === 'triple') {
      outerSepAU = Math.max(overrides.star.outerSepAU, sep * 5);
      const mAll = mAB + (binaryStar.members[2]?.star.mass ?? 0);
      outerPeriodYears = Math.sqrt((outerSepAU * outerSepAU * outerSepAU) / Math.max(1e-6, mAll));
    }
    binaryStar = { ...binaryStar, sepAU: sep, periodDays, outerSepAU, outerPeriodYears };
  }
  let planets = design.planets.map((p, i) => {
    const o = byIndex.get(i);
    if (!o) return p;
    let q: PlanetDesign = {
      ...p,
      a: o.a ?? p.a,
      ecc: o.ecc ?? p.ecc,
      incDeg: o.incDeg ?? p.incDeg,
      nodeDeg: o.nodeDeg ?? p.nodeDeg,
      radius: o.radius ?? p.radius,
      geoActivity: o.geo ?? p.geoActivity,
      magnetic: o.mag ?? p.magnetic,
      tilt: o.tilt ?? p.tilt,
      rotation: o.rotation ?? p.rotation,
    };
    // 手动改过类型:按新类型重算半径/质量/大气/水圈/生物圈/温度(跨岩石↔气态会变 kind)
    if (o.type !== undefined) {
      q = retypePlanet(q, o.type, star, params.seed);
    }
    {
    };
    // 「换一颗」:这颗行星的物理随机量(半径、反照率、地质、磁场、轨道倾角/升交点/自转/倾角)按新种子重掷
    if (o.reroll !== undefined && q.kind === 'rocky') {
      const rseed = subSeed(params.seed, `reroll:p${p.index}:${o.reroll}`);
      const u = (k: string) => unit(rseed, k);
      const nr = clamp(p.radius * (0.78 + 0.44 * u('radius')), 0.05, 20);
      const k = p.radius > 0 ? nr / p.radius : 1;
      q = {
        ...q,
        radius: nr,
        mass: p.mass * k * k * k,
        albedo: clamp(p.albedo * (0.85 + 0.3 * u('albedo')), 0.05, 0.7),
        geoActivity: clamp(p.geoActivity * (0.6 + 0.8 * u('geo')), 0, 1),
        magnetic: clamp(p.magnetic * (0.6 + 0.8 * u('mag')), 0, 1.5),
        ecc: o.ecc ?? clamp(0.02 + 0.14 * u('ecc'), 0, 0.5),
        incDeg: o.incDeg ?? clamp(0.5 + 8 * u('inc'), 0, 90),
        nodeDeg: o.nodeDeg ?? clamp(360 * u('node'), 0, 360),
        rotation: o.rotation ?? clamp(8 + 60 * u('rot'), 4, 2000),
        tilt: o.tilt ?? clamp(1 + 55 * u('tilt'), 0, 90),
      };
    }
    if (o.mass !== undefined) q.mass = Math.max(0.001, Math.min(5000, o.mass));
    if (o.radius !== undefined && p.radius > 0) {
      const k = o.radius / p.radius;
      q.mass = p.mass * k * k * k;
    }
    const remod = o.a !== undefined || o.ecc !== undefined || o.radius !== undefined || o.mass !== undefined || o.life !== undefined || o.reroll !== undefined;
    if (remod && q.kind === 'rocky') {
      // 「换一颗」:只换这颗行星自己的随机种子(水圈 / 生物圈 / 大气细项),别的行星与恒星不动
      const pseed = o.reroll !== undefined ? subSeed(params.seed, `reroll:p${p.index}:${o.reroll}`) : params.seed;
      const m = modelRocky({
        star,
        a: q.a,
        radius: q.radius,
        mass: q.mass,
        albedo: q.albedo,
        geo: q.geoActivity,
        magnetic: q.magnetic,
        seed: pseed,
        tag: p.index,
        ecc: q.ecc,
        hydro: o.life === 1 ? true : undefined,
        biotic: o.life === 1 ? true : o.life === 2 ? false : undefined,
      });
      q = { ...q, hydro: m.hydro, biotic: m.biotic, atmos: m.air, tempK: m.tempK };
    }
    return q;
  });
  planets = planets.map((p, i) => {
    const o = byIndex.get(i);
    let moons = p.moons;
    // 每颗行星自己的卫星数:多了按同一套"像月球"的公式补,少了从末尾裁(岩石与气态行星都做)
    if (o?.moonCount !== undefined) {
      const want = clamp(Math.round(o.moonCount), 0, 12);
      moons = Array.from({ length: want }, (_, k) =>
        p.moons[k] ?? {
          mass: 0.005 + 0.013 * unit(params.seed, `moonset:${i}:${k}:mass`),
          distance: 45 + 27 * unit(params.seed, `moonset:${i}:${k}:dist`),
          radius: 0.2 + 0.15 * unit(params.seed, `moonset:${i}:${k}:rad`),
          locked: unit(params.seed, `moonset:${i}:${k}:lock`) > 0.4,
        },
      );
    }
    const ms = overrides.moons.filter((o) => o.planet === i);
    if (!ms.length) return moons === p.moons ? p : { ...p, moons };
    return {
      ...p,
      moons: moons.map((m, k) => {
        const mo = ms.find((x) => x.moon === k);
        return mo ? { ...m, distance: mo.distance ?? m.distance, radius: mo.radius ?? m.radius, locked: mo.locked ?? m.locked, mass: mo.mass ?? m.mass, type: mo.type ?? m.type } : m;
      }),
    };
  });
  const homeIdx = overrides.planets.find((o) => o.home)?.index ?? design.home.index;
  const hp = planets[homeIdx];
  const home: HomeWorld = hp
    ? {
        ...design.home,
        index: homeIdx,
        tilt: hp.tilt,
        dayHours: hp.rotation,
        yearDays: orbitYears(hp.a) * EARTH_YEAR_DAYS,
        insolation: insolationOf(star.lum, hp.a),
        meanTempK: hp.tempK,
        tide: tideOf(hp, star),
        air: hp.atmos,
      }
    : design.home;
  const homeMoonIdx2 = params.homeMoon != null && hp ? clamp(Math.round(params.homeMoon as number), 0, Math.max(0, hp.moons.length - 1)) : undefined;
  const homeFinal = hp && homeMoonIdx2 !== undefined && hp.moons[homeMoonIdx2] ? withHomeMoon(home, hp, homeMoonIdx2) : home;
  return applyGroups({ ...design, planets, home: homeFinal, star, binaryStar }, overrides);
}

/**
 * R2:把显式子星系套到设计层。目前实现:binaryPair 组 → 组里第二颗成为主行星的互绕伴星(design.binary);
 * gasSystem / habitableMoonSystem 由行星类型与卫星直接决定,不额外改结构。
 * 只动"组里有主行星"的那一组;其它组交给界面展示。
 */
export function applyGroups(design: AstroDesign, overrides: SystemOverrides | null | undefined): AstroDesign {
  const groups = overrides?.groups;
  if (!groups?.length) return design;
  const homeIdx = design.home.index;
  let out = design;
  for (const g of groups) {
    if (g.role !== 'binaryPair') continue;
    const members = g.members.filter((m) => m >= 0 && m < out.planets.length);
    if (members.length < 2) continue;
    if (!members.includes(homeIdx)) continue;
    const comp = members.find((m) => m !== homeIdx)!;
    const home = out.planets[homeIdx];
    const cp = out.planets[comp];
    const prev = out.binary;
    // 间距/周期:沿用已有值;没有就按半径和与开普勒现算
    const radiusSumAU = ((home.radius + cp.radius) * 6371) / 1.496e8;
    const sep = prev?.separationAU ?? Math.max(0.0006, 2.5 * radiusSumAU);
    const mSum = Math.max(0.05, home.mass + cp.mass);
    const periodDays = prev?.periodDays ?? 365.25 * Math.sqrt((sep * sep * sep * 333000) / mSum);
    cp.a = home.a;
    out = { ...out, binary: { index: comp, separationAU: sep, periodDays } };
  }
  return out;
}
