/**
 * 「这颗星球能不能长出文明」的判定(纯函数,可 Node 测)。
 *
 * 规则(用户定):没有生物圈的行星禁止创建文明。
 *   - 星球系世界:看主行星的 biotic(生物圈)与 atmos.breathable(可呼吸);
 *   - 老世界(没开星球系):按 params.life(0/1 可,2 没有生命)。
 * 殖民 / 地球化改造不在这里:那只留接口(见 gen/colonization.ts),等科技树大改那一轮再接。
 */
import type { World } from './world';
import { astroOf } from './astro';
import { breathReason } from './astroDesign';

export interface CivOriginCheck {
  ok: boolean;
  /** 不能创建时的人话原因(界面直接显示) */
  reason?: string;
  /** 主行星名字/序号(提示里用) */
  planet?: string;
  /** 一键修正:把主行星改成有生物圈要写的参数补丁 */
  fix?: { life: number };
}

export function canHostCiv(world: World | null | undefined): CivOriginCheck {
  if (!world) return { ok: true };
  const sys = astroOf(world);
  if (!sys) {
    // 没开星球系(老世界):一直是地球基线,除非世界参数明确写了"无生命"
    if (world.params.life === 2) return { ok: false, reason: '世界参数里主行星设成了「无生命」', fix: { life: 1 } };
    return { ok: true };
  }
  const d = sys.design;
  const planet = d.planets[d.home.index];
  // 宜居卫星系:主天体是卫星,判定看 satellite 自己的温度/大气/生物圈(design.home 已经改写)
  const hw = sys.home;
  if (!planet) return { ok: false, reason: '找不到主行星', fix: { life: 1 } };
  const isMoon = hw.moon !== undefined;
  const name = isMoon ? `第 ${d.home.index + 1} 颗行星的第 ${(hw.moon ?? 0) + 1} 颗卫星` : `第 ${d.home.index + 1} 颗行星`;
  if (!isMoon && planet.kind === 'gas') return { ok: false, reason: `${name}是气态行星,没有地表`, fix: { life: 1 } };
  if (!hw.biotic) return { ok: false, reason: `${name}没有生物圈`, planet: name, fix: { life: 1 } };
  if (!hw.air.breathable) {
    return { ok: false, reason: `${name}的大气不可呼吸(${breathReason(hw.air) ?? '成分不合适'})`, planet: name, fix: { life: 1 } };
  }
  return { ok: true, planet: name };
}
