/**
 * 航行接口（@experimental）。
 *
 * 本轮范围（已定）：
 *  - 行星际：只留接口（霍曼转移 / 会合窗口 / 到达时间），具体殖民/开发玩法留到「科技路线大改」。
 *  - 恒星际：不做，只保留 100 光年邻近恒星数据（gen/neighbors.ts）与 3D 星图展示。
 *  - 不接 UI、不触发事件、不影响生成与存档。
 */

import { periodDaysOf } from './orbitTime';

/** 2026 决定：恒星际暂不开放 */
export const INTERSTELLAR_ENABLED = false;
/** 星图只收 100 光年内的恒星，更远只做背景 */
export const INTERSTELLAR_MAX_LY = 100;

export interface HohmannTransfer {
  /** 转移轨道半长轴（AU） */
  transferAU: number;
  /** 单程飞行时间（天） */
  days: number;
  /** 需要的 Δv 总量（km/s，圆轨道近似） */
  dvKms: number;
}

/** 行星际霍曼转移：从 a1(AU) 到 a2(AU)，绕质量 massSolar(M☉) 的恒星 */
export function hohmannTransfer(a1AU: number, a2AU: number, massSolar: number): HohmannTransfer {
  const a1 = Math.max(1e-4, a1AU);
  const a2 = Math.max(1e-4, a2AU);
  const m = Math.max(1e-6, massSolar);
  const aT = (a1 + a2) / 2;
  const days = Math.max(1e-4, periodDaysOf(aT, m)) / 2;
  // 圆轨道速度 v = 29.78 km/s · √(M/a)；Hohmann 两段 Δv
  const v1 = 29.78 * Math.sqrt(m / a1);
  const v2 = 29.78 * Math.sqrt(m / a2);
  const vp = 29.78 * Math.sqrt((m * (2 / a1 - 1 / aT)) / 1);
  const va = 29.78 * Math.sqrt((m * (2 / a2 - 1 / aT)) / 1);
  const dvKms = Math.abs(vp - v1) + Math.abs(v2 - va);
  return { transferAU: aT, days, dvKms };
}

/** 两个圆轨道之间的会合窗口间隔（年）= 会合周期 */
export function transferWindowYears(a1AU: number, a2AU: number, massSolar: number): number {
  const p1 = periodDaysOf(a1AU, massSolar) / 365.25;
  const p2 = periodDaysOf(a2AU, massSolar) / 365.25;
  const diff = Math.abs(1 / p1 - 1 / p2);
  return diff > 1e-9 ? 1 / diff : Infinity;
}

export interface TravelEstimate {
  distanceLy: number;
  /** 航行时间（天）；null = 未启用/不可达 */
  days: number | null;
  reason: string;
}

/** 恒星际航行（本轮未启用；接口先定住） */
export function interstellarTravelEstimate(distanceLy: number, _techLevel: number): TravelEstimate {
  if (!INTERSTELLAR_ENABLED) return { distanceLy, days: null, reason: '恒星际航行未开放（行星际优先）' };
  return { distanceLy, days: null, reason: '未实现' };
}
