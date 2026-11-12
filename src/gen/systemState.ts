/**
 * 当前世界的逐行星/卫星覆盖表(星系结构)。
 *
 * 为什么放在一个模块里:生成、重推、铺像素这些请求散在十几处(useWorldLoad / useEditRecompute /
 * useSimRunners / directorPlan / App / drawMap),每一处都要带上它;而它又是"当前这个世界"的属性,
 * 不适合塞进 WorldParams(参数要能进网址、身份要能对齐)。所以:
 *   - 读存档 / 生成 / 造档(makeSave)时由 savefile 统一发布一份;
 *   - 各处请求用 systemOpt() 把它带上;没有 = 单行星世界(和以前一样,请求里连字段都不出现)。
 */
import type { SystemOverrides } from './astroDesign';

let current: SystemOverrides | null = null;

/** 覆盖表是不是空的(空 = 和种子派生的一模一样) */
export function systemEmpty(s: SystemOverrides | null | undefined): boolean {
  return !s || (s.planets.length === 0 && s.moons.length === 0);
}

/** 发布当前世界的覆盖表(传 null/空 = 单行星世界) */
export function setCurrentSystem(s: SystemOverrides | null | undefined): void {
  current = systemEmpty(s) ? null : (s as SystemOverrides);
}

export function currentSystem(): SystemOverrides | null {
  return current;
}

/** 请求里带覆盖表(没有就不带字段,和以前逐字节一样) */
export function systemOpt(): { system?: SystemOverrides } {
  return current ? { system: current } : {};
}
