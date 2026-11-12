/**
 * S5 地球仪的「天空层」:这一刻太阳在哪、昼半球与晨昏线在哪、卫星和伴星在哪个方位。
 *
 * 纯计算,不碰 DOM(画在 ui/SkyLayer.tsx 里)。
 * 太阳方位与行星公转位置用 gen/orbitTime.ts 的 positionAtAU(和系统视图同一个年);
 * 昼夜按自转周期推时角;卫星/伴星按各自公转周期推相位。
 * 这是「看天空长什么样」的近似:不做光行时、不做轨道倾角的精细投影。
 */
import { positionAtAU } from './orbitTime';
import type { AstroDesign } from './astroDesign';

/** 度 → 夹到 [-180, 180) */
export function wrap180(deg: number): number {
  const d = ((deg % 360) + 540) % 360 - 180;
  return d === -180 ? 180 : d;
}

export interface SkyMoon {
  /** 在第几颗行星的卫星表里的下标 */
  index: number;
  /** 相对观测者的方位(度;0 = 正东,90 = 正北) */
  azDeg: number;
  /** 公转相位 0–1(0 = 合,0.5 = 冲) */
  phase: number;
  /** 离母行星多少个母行星半径(说明里用) */
  sepR: number;
}

export interface SkyLayer {
  /** 这一层的年份 */
  year: number;
  /** 太阳直射经度(-180–180):这一度正午 */
  subsolarLonDeg: number;
  /** 晨昏线离直射点的经度差(90;给画图用) */
  terminatorDeg: number;
  /** 太阳在天空里的方位(0 = 正东,90 = 正北) */
  sunAzDeg: number;
  /** 一天多少小时(自转) */
  dayHours: number;
  /** 一轮昼夜过了多少(0–1;0 = 正午) */
  dayPhase: number;
  /** 卫星(没有 = 空) */
  moons: SkyMoon[];
  /** N8:本子星系里的其他星体(同组行星/卫星)在天空的方位 */
  siblings: { name: string; azDeg: number; kind: 'planet' | 'moon' }[];
  /** 伴星:双恒星 / 双固态行星的伴(没有 = 不给) */
  companion?: { azDeg: number; phase: number; name: string; lumRatio?: number };
}

/** 一年多少天(主行星) */
const YEAR_DAYS = 365.25;
/** 一个地球半径是多少 AU(6371 km / 1.496e8 km) */
const R_EARTH_AU = 6371 / 1.496e8;
/** 一个太阳质量是几个地球质量 */
const M_SUN_IN_EARTH = 332_946;

/**
 * 卫星的公转周期(天):半长轴 = 离母行星多少个母行星半径 × 母行星半径(R⊕) → AU,
 * 再按开普勒第三定律绕母行星质量算。月亮约 27 天,拿它当量纲检查。
 */
export function moonPeriodDays(sepR: number, planetRadiusEarth: number, planetMassEarth: number): number {
  const a = Math.max(1e-9, sepR * planetRadiusEarth * R_EARTH_AU);
  const massSolar = Math.max(1e-9, planetMassEarth / M_SUN_IN_EARTH);
  return YEAR_DAYS * Math.sqrt((a * a * a) / massSolar);
}

/**
 * 算某颗行星在 year 这一年的天空层。
 * index = 行星下标(默认主行星);design 来自 astroOf(world).design(已套覆盖表)。
 */
/** 本子星系的成员(下标 + 名字):给了就一起算方位 */
export interface SkySiblingInput { index: number; name: string; kind: 'planet' | 'moon'; parent?: number }

export function skyLayerOf(design: AstroDesign, year: number, index = design.home.index, siblingsIn: SkySiblingInput[] = []): SkyLayer {
  const p = design.planets[index] ?? design.planets[design.home.index];
  const y = Number.isFinite(year) ? year : 0;
  const hours = y * YEAR_DAYS * 24;

  // 太阳方位:行星在轨道上的位置反过来就是太阳的方向
  const st = positionAtAU({ a: p.a, ecc: p.ecc, incDeg: p.incDeg, nodeDeg: p.nodeDeg, phase0: 0 }, y, design.star.mass);
  const sunAzDeg = wrap180((Math.atan2(st.y, st.x) * 180) / Math.PI + 180);

  // 昼夜:按自转周期推时角;太阳方位跟着公转挪,所以直射经度 = 太阳方位 − 自转角
  const dayHours = Math.max(0.5, p.rotation);
  const spinDeg = wrap180(((hours % dayHours) / dayHours) * 360);
  const subsolarLonDeg = wrap180(sunAzDeg - spinDeg);
  const dayPhase = ((spinDeg + 180) % 360) / 360;

  const moons: SkyMoon[] = (p.moons ?? []).map((m, i) => {
    const P = moonPeriodDays(m.distance, p.radius, p.mass);
    const phase = P > 0 ? (((hours / (P * 24)) % 1) + 1) % 1 : 0;
    return { index: i, azDeg: phase * 360, phase, sepR: m.distance };
  });

  // 伴星:双恒星(两星互绕)/ 双固态行星(伴星和主行星互绕)
  const bs = design.binaryStar;
  const bin = design.binary;
  let companion: SkyLayer['companion'];
  if (bs && bs.periodDays > 0) {
    const phase = ((hours / (bs.periodDays * 24)) % 1 + 1) % 1;
    companion = { azDeg: phase * 360, phase, name: '伴星', lumRatio: bs.lumRatio };
  } else if (bin && bin.periodDays > 0) {
    const phase = ((hours / (bin.periodDays * 24)) % 1 + 1) % 1;
    companion = { azDeg: phase * 360, phase, name: '伴星(双固态)' };
  }

  // N8:同子星系的其他星体相对观测者的方位(用它们自己绕母体的相位/公转位置近似)
  const siblings = siblingsIn.map((s) => {
    if (s.kind === 'moon') {
      const mm = p.moons[s.parent ?? 0];
      const P2 = mm ? moonPeriodDays(mm.distance, p.radius, p.mass) : 0;
      const ph2 = P2 > 0 ? (((hours / (P2 * 24)) % 1) + 1) % 1 : 0;
      return { name: s.name, azDeg: ph2 * 360, kind: 'moon' as const };
    }
    const other = design.planets[s.index];
    if (!other) return { name: s.name, azDeg: 0, kind: 'planet' as const };
    const st2 = positionAtAU({ a: other.a, ecc: other.ecc, incDeg: other.incDeg, nodeDeg: other.nodeDeg, phase0: 0 }, y, design.star.mass);
    const az2 = wrap180((Math.atan2(st2.y, st2.x) * 180) / Math.PI + 180);
    return { name: s.name, azDeg: wrap180(az2 - sunAzDeg) + 180, kind: 'planet' as const };
  });
  return { year: y, subsolarLonDeg, terminatorDeg: 90, sunAzDeg, dayHours, dayPhase, moons, siblings, ...(companion ? { companion } : {}) };
}
