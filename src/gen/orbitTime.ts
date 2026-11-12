/**
 * 轨道时间模型（只读、纯函数）：公转周期与任意年份的位置。
 *
 * 单位约定：轨道半径 AU、母体质量 M☉、时间 天/年。
 * 行星（绕恒星）：parentMassSolar = 恒星质量。
 * 卫星（绕母行星）：用 moonOrbitDaysOf()，母体质量从 M⊕ 换算成 M☉。
 *
 * 这是「时间轴动画 / 天象 / 行星际接口」的共同底座：位置只由设计值算，
 * 不写存档、不影响生成，默认世界不经过这里。
 */

export const DAYS_PER_YEAR = 365.25;
/** 地球质量 → 太阳质量 */
export const EARTH_MASS_IN_SOLAR = 1 / 332946.0487;
/** 1 AU = 149 597 870.7 km */
export const KM_PER_AU = 149_597_870.7;
/** 地球半径 km */
export const EARTH_RADIUS_KM = 6371;

/** 开普勒第三定律：P(天) = 365.25 · √(a³ / M母) */
export function periodDaysOf(aAU: number, parentMassSolar: number): number {
  const a = Math.max(1e-6, aAU);
  const m = Math.max(1e-9, parentMassSolar);
  return DAYS_PER_YEAR * Math.sqrt((a * a * a) / m);
}

/** 卫星周期：distance 以母行星半径为单位，母行星半径以 R⊕ 为单位、质量以 M⊕ 为单位 */
export function moonPeriodDaysOf(distanceInPlanetRadii: number, planetRadiusEarth: number, planetMassEarth: number): number {
  const aAU = (distanceInPlanetRadii * Math.max(0.01, planetRadiusEarth) * EARTH_RADIUS_KM) / KM_PER_AU;
  return periodDaysOf(aAU, Math.max(1e-9, planetMassEarth) * EARTH_MASS_IN_SOLAR);
}

/** 解开普勒方程 E - e·sinE = M（牛顿迭代，e<0.95 时够用） */
export function keplerEccentricAnomaly(meanAnomaly: number, ecc: number): number {
  const e = Math.min(0.95, Math.max(0, ecc));
  let E = meanAnomaly;
  for (let i = 0; i < 8; i++) {
    const f = E - e * Math.sin(E) - meanAnomaly;
    const d = 1 - e * Math.cos(E);
    if (Math.abs(d) < 1e-9) break;
    E -= f / d;
  }
  return E;
}

export interface OrbitLike {
  a: number;
  ecc: number;
  /** 初相位（弧度，year 0 时的平近点角；不写 = 0） */
  phase0?: number;
  incDeg?: number;
  nodeDeg?: number;
  /** 覆盖周期（天）；不写 = 开普勒导出 */
  periodDays?: number;
}

export interface OrbitalState {
  /** 轨道平面内坐标（AU） */
  x: number;
  y: number;
  z: number;
  /** 距母体距离（AU） */
  r: number;
  /** 周期（天） */
  periodDays: number;
  /** 平近点角（度，0–360，方便 UI 直接显示） */
  meanAnomalyDeg: number;
}

/**
 * 某一年的位置。默认圆轨道近似用椭圆（开普勒解），给了 incDeg/nodeDeg 时做轨道面旋转。
 * 只用于展示/动画，不参与生成与存档。
 */
export function positionAtAU(o: OrbitLike, year: number, parentMassSolar = 1): OrbitalState {
  const a = Math.max(1e-6, o.a);
  const e = Math.min(0.95, Math.max(0, o.ecc));
  const P = o.periodDays && o.periodDays > 0 ? o.periodDays : periodDaysOf(a, parentMassSolar);
  const phase0 = o.phase0 ?? 0;
  const M = phase0 + ((Math.max(0, year) * DAYS_PER_YEAR) / P) * Math.PI * 2;
  let Mn = M % (Math.PI * 2);
  if (Mn < 0) Mn += Math.PI * 2;
  const E = keplerEccentricAnomaly(Mn, e);
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const inc = ((o.incDeg ?? 0) * Math.PI) / 180;
  const node = ((o.nodeDeg ?? 0) * Math.PI) / 180;
  // 轨道平面绕升交点旋转，再按倾角抬出黄道面
  const x = (xp * Math.cos(node) - yp * Math.sin(node) * Math.cos(inc)) || 0;
  const y = (xp * Math.sin(node) + yp * Math.cos(node) * Math.cos(inc)) || 0;
  const z = yp * Math.sin(inc);
  const r = Math.sqrt(x * x + y * y + z * z);
  return { x, y, z, r, periodDays: P, meanAnomalyDeg: (Mn * 180) / Math.PI };
}
