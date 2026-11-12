/**
 * 「谁能当主行星」的判定(纯函数,界面与生成共用)。
 *
 * 规则:
 *   - 气态行星没有地表 → 不能当主行星;
 *   - 太小的天体(矮行星级、极小卫星)留不住大气与液态水 → 不能当主行星;
 *   - 岩石行星可以;母行星的一颗卫星可以(宜居卫星系,主行星是卫星)。
 * 注意:这里只管"能不能当主行星";有没有生物圈不在这里管,创建文明时另有 WP4 的拦截。
 */
import type { AstroDesign } from './astroDesign';

export interface HomeRule {
  ok: boolean;
  reason?: string;
}

/** 这颗行星能不能当主行星 */
export function canBeHome(design: AstroDesign, index: number): HomeRule {
  const p = design.planets[index];
  if (!p) return { ok: false, reason: '这颗行星不存在' };
  if (p.kind === 'gas') return { ok: false, reason: '气态行星没有地表,不能当主行星' };
  if (p.radius < 0.25) return { ok: false, reason: `半径只有 ${p.radius.toFixed(2)} R⊕,太小留不住大气与液态水` };
  return { ok: true };
}

/** 这颗卫星能不能当主行星(宜居卫星系) */
export function canBeHomeMoon(design: AstroDesign, planetIndex: number, moonIndex: number): HomeRule {
  const p = design.planets[planetIndex];
  if (!p) return { ok: false, reason: '找不到母行星' };
  const m = p.moons[moonIndex];
  if (!m) return { ok: false, reason: '找不到这颗卫星' };
  if (m.radius < 0.15) return { ok: false, reason: `卫星半径只有 ${m.radius.toFixed(2)} R⊕,太小了` };
  if (p.kind === 'gas' && m.distance < 4) return { ok: false, reason: '离气态母行星太近,潮汐/辐射太强' };
  return { ok: true };
}
