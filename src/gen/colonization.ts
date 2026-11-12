/**
 * 殖民 / 地球化改造:留给「科技树大改」那一轮,现在只有接口和原因,一律返回不可行。
 *
 * 设计意图(用户定):
 *   - 没有生物圈的行星不能「创建文明」,但以后可以「殖民」;
 *   - 气态行星不生成地形,只出程序化带纹贴图;将来「太空殖民」会在它的地表标「采气站」。
 * 接线点时不要在这里写玩法逻辑,只把原因传给界面。
 */

export interface ColonyCheck {
  ok: false;
  reason: string;
}

/** 现在还不能殖民(科技树 / 航行都没做) */
export function canColonize(): ColonyCheck {
  return { ok: false, reason: '殖民未开放:等科技树大改(航行、补给、殖民船)那一轮' };
}

/** 地球化改造同理:只有接口 */
export function terraform(): ColonyCheck {
  return { ok: false, reason: '地球化改造未开放:等科技树大改那一轮' };
}

/** 气态行星「采气站」:现在只登记接口,不生成站点 */
export function gasMineSite(): ColonyCheck {
  return { ok: false, reason: '采气站未开放:等太空殖民那一轮(气态行星先只有贴图)' };
}
