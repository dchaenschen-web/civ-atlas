/**
 * 陨星撞击(效果层,不改地形)。
 *
 * 频率来自星系结构:`impact` 参数 + 小行星带是否穿过主行星轨道 + 巨行星/大卫星的引力清扫 +
 * 大气厚度(gen/system.ts 的 impactRateOf)。每年看一次由确定性随机数掷,不写死。
 *
 * C 方案:推演里只记"哪年、落在哪州、多重、死了多少人",既不改地形,也不自己生成坑;
 * 推演结束后由 `gen/impacts.ts` 的 settleImpacts 把这些点算成待结算的坑,由作者预览/应用。
 *
 * 默认不装:只有 `params.astro = 1` 且 `impact >= 1` 的世界才装 —— 老世界历史逐字节不变。
 */
import type { CivModule, InstallCtx, ResumeCtx } from './modules';
import type { CivSim } from './engine/sim';
import type { PolityModel } from './polities';
import { polityModelOf } from './polities';
import type { World } from '../world';
import { Ev } from './events';
import { IV_LOSS, quakeRing } from './calamity';
import { afflict } from './disaster';
import { scheduleRebuild } from './cities';
import { populationAt } from './growth';
import { keyed, subSeed } from './engine/rand';
import { Layer } from './types';
import { astroOf } from '../astro';
import { beltsOf, impactRateOf } from '../system';

/** 每多少年看一次 */
const IMPACT_CHECK = 40;
/** 随机流用途编号(和别的模块错开) */
const U_T = 21;
const U_AT = 22;
const U_ODDS = 23;
const U_LV = 24;

/** 这个世界的陨星撞击开不开(默认关:老世界历史不变) */
export function impactEventsOn(world: World): boolean {
  const p = world.params;
  return p.astro === 1 && (p.impact ?? 0) >= 1;
}

/** 主行星的陨击率(相对地球 = 1;带穿透/巨行星挡/大气都算进去了) */
export function impactRate(world: World): number {
  const sys = astroOf(world);
  if (!sys) return 0;
  const belts = beltsOf(sys.design, world.params.seed, world.params.impact);
  return impactRateOf(sys.design, belts, sys.home.index);
}

/** 每次查看出事的概率:频率 1 时约 1.5%/40 年,频繁(rate 高)时明显更多 */
export function impactOdds(world: World): number {
  const rate = impactRate(world);
  return Math.min(0.2, Math.max(0, 0.015 * rate));
}

/** 第 k 次查看的年份(和平行模块同一种写法) */
function impactTime(base: number, k: number): number {
  const u = keyed(base, k, U_T, 0);
  return Math.round(IMPACT_CHECK * (k + 0.3 + 0.7 * u) * 256) / 256;
}

/** 一次撞击:挑一个有人烟的国家,落点取它国土里随机一州 */
function impactAt(sim: CivSim, pm: PolityModel, world: World, base: number, k: number, t: number): void {
  const owner = sim.owners[Layer.Polity];
  const reg = pm.terrain.regions;
  const S = pm.settlements;
  const cityNow = (r: number): number => {
    const sid = pm.cityOf[r];
    if (sid < 0) return -1;
    const s = S[sid];
    return s && s.ended === undefined && t >= s.founded ? sid : -1;
  };
  const odds = impactOdds(world);
  if (odds <= 0) return;
  // 每个国家一条候选(落在国境内有人烟的州)
  const cand = new Map<number, number[]>();
  for (let r = 0; r < reg.count; r++) {
    const p = owner[r];
    if (p < 0 || cityNow(r) < 0) continue;
    let l = cand.get(p);
    if (!l) cand.set(p, (l = []));
    l.push(r);
  }
  for (const p of [...cand.keys()].sort((x, y) => x - y)) {
    if (keyed(base, k, p, U_ODDS) >= odds) continue;
    const list = cand.get(p)!;
    const center = list[Math.floor(keyed(base, k, p, U_AT) * list.length) % list.length] as number;
    const u = keyed(base, k, p, U_LV);
    const level = u < 0.55 ? 1 : u < 0.85 ? 2 : 3;
    const hit: number[] = [];
    const pop = new Map<number, number>();
    for (const r of quakeRing(reg, center)) {
      const sid = cityNow(r);
      if (sid < 0) continue;
      hit.push(r);
      pop.set(r, populationAt(S[sid], t));
    }
    if (hit.length) afflict(sim, pm, hit, pop, t, IV_LOSS[level], 'impact', center);
    // 三档 = 直击州城:城整座毁于撞击(过些年可能重建);地形仍不改(C 方案,结算在推演后)
    if (level === 3) {
      const sid = cityNow(center);
      if (sid >= 0) {
        const s = S[sid];
        s.ended = t;
        pm.cityOf[center] = -1;
        sim.record('sunk', { a: owner[center], b: 0, region: center, settlement: sid, war: -1 });
        scheduleRebuild(sim, sid);
      }
    }
  }
}

function installImpact(ctx: InstallCtx): void {
  const { sim, world, pm, seed } = ctx;
  if (!pm || !impactEventsOn(world)) return;
  const base = subSeed(seed, 'impact-events');
  sim.on(Ev.ImpactCheck, (k, _b, t) => {
    sim.schedule(impactTime(base, k + 1), Ev.ImpactCheck, k + 1, 0);
    impactAt(sim, pm, world, base, k, t);
  });
  sim.schedule(impactTime(base, 0), Ev.ImpactCheck, 0, 0);
}

function resumeImpact(ctx: ResumeCtx): void {
  const { sim, world } = ctx;
  const pm = polityModelOf(sim);
  if (!pm || !impactEventsOn(world)) return;
  const base = subSeed(world.params.seed, 'impact-events');
  let k = 0;
  while (impactTime(base, k) <= sim.now) k++;
  sim.on(Ev.ImpactCheck, (kk, _b, t) => {
    sim.schedule(impactTime(base, kk + 1), Ev.ImpactCheck, kk + 1, 0);
    impactAt(sim, pm, world, base, kk, t);
  });
  sim.schedule(impactTime(base, k), Ev.ImpactCheck, k, 0);
}

/** 模块:陨星撞击(默认不装;见文件头) */
export const impactEventsModule: CivModule = {
  id: 'impactEvents',
  install: installImpact,
  resume: resumeImpact,
};
