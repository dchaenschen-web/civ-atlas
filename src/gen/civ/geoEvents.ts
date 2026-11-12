/**
 * 地质事件:这颗行星自己的地震与火山(效果层,不改地形)。
 *
 * 频率与地点都从 `gen/geology.ts` 派生(板块汇聚带 / 离散带 / 热点 + WorldParams.geo 活跃度),不写死:
 *   - 每 GEO_CHECK 年看一次;这年要不要出事,按"国土里最活的地块有多活"和活跃度掷;
 *   - 震中取国土里地震强度 × 随机权重最大的那一州(所以地震总是落在板块边界附近);
 *   - 受灾范围用现成的 quakeRing(城里人口损失、编年史写"地震 / 大水 / 大旱"、国内更动荡)。
 *
 * 默认不启用:只有 `params.astro = 1` 或 `params.geo ≠ 1` 的世界才装这个模块——
 * 默认参数的老世界历史逐字节不变(这是底线)。
 *
 * 后续(极端档):高烈度 + 火山强度高的地方改成"城毁于火山"(sunk),并可选走 upheaval.ts 的地形重生成。
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
import { geologyOf } from '../geology';
import { populationAt } from './growth';
import { keyed, subSeed } from './engine/rand';
import { Layer } from './types';

/** 每多少年看一次 */
const GEO_CHECK = 25;
/** 活跃度 1 时,每国每次看"出事"的机会 */
const GEO_ODDS = 0.1;
/** 极端档的门槛:地质活跃度到这么高,火山带上的三档事件会毁城(默认 geo = 1,永远走不到) */
const EXTREME_GEO = 2.4;
/** 地震烈度表:三档(和作者下的天灾 IV_LOSS 同一套 0–3 档) */
const LEVEL_CUTS = [0.55, 0.3] as const;
/** 随机流用途编号(和别的模块错开) */
const U_T = 11;
const U_AT = 12;
const U_ODDS = 13;
const U_LV = 14;

/** 这个世界的自发地质事件开不开 */
export function geoEventsOn(world: World): boolean {
  const p = world.params;
  return p.astro === 1 || p.geo !== 1;
}

/** 第 k 次查看的年份:和 pandemic.ts 同一种写法(逐步漂移,不用随机数定死) */
function geoTime(base: number, k: number): number {
  const u = keyed(base, k, U_T, 0);
  return Math.round((GEO_CHECK * (k + 0.3 + 0.7 * u)) * 256) / 256;
}

/** 一次地质事件:挑震中、定烈度、受灾 */
function geoAt(sim: CivSim, pm: PolityModel, world: World, base: number, k: number, t: number): void {
  const owner = sim.owners[Layer.Polity];
  const R = pm.terrain.R;
  const reg = pm.terrain.regions;
  const S = pm.settlements;
  const geo = geologyOf(world);
  const activity = Math.min(3, Math.max(0.4, geo.activity));

  /** 州 r 此刻有人烟的城 */
  const cityNow = (r: number): number => {
    const sid = pm.cityOf[r];
    if (sid < 0) return -1;
    const s = S[sid];
    return s && s.ended === undefined && t >= s.founded ? sid : -1;
  };

  // 每国在国土里挑一个"最活"的州当震中:地震 × 0.7 + 火山 × 0.3,再乘一个随机权重
  const at = new Map<number, { r: number; score: number }>();
  // 没国家的部落地带不算(编年史只记国家的事)
  const geoBase = subSeed(world.params.seed, 'geo-events');
  for (let r = 0; r < R; r++) {
    const p = owner[r];
    if (p < 0 || cityNow(r) < 0) continue;
    const seat = reg.seat[r];
    const live = (geo.quake[seat] ?? 0) * 0.7 + (geo.volcano[seat] ?? 0) * 0.3;
    if (!(live > 0)) continue;
    const u = keyed(geoBase, reg.seat[r], k, U_AT);
    const score = live * (0.35 + 0.65 * u);
    const cur = at.get(p);
    if (!cur || score > cur.score) at.set(p, { r, score });
  }
  const odds = GEO_ODDS * activity;
  for (const p of [...at.keys()].sort((x, y) => x - y)) {
    const hit0 = at.get(p)!;
    if (keyed(geoBase, k, p, U_ODDS) >= odds) continue;
    const u = keyed(geoBase, k, p, U_LV);
    const level = u < LEVEL_CUTS[0] ? 1 : u < LEVEL_CUTS[0] + LEVEL_CUTS[1] ? 2 : 3;
    const center = hit0.r;
    const hit: number[] = [];
    const pop = new Map<number, number>();
    for (const r of quakeRing(reg, center)) {
      const sid = cityNow(r);
      if (sid < 0) continue;
      hit.push(r);
      pop.set(r, populationAt(S[sid], t));
    }
    // 震中在火山带上、且这次够重 → 记成火山崩发(编年史写"火山崩发,城郭尽焚");否则还是地震 / 大水 / 大旱
    const volcanic = (geo.volcano[reg.seat[center]] ?? 0) > 0.45 && level >= 2;
    if (hit.length) afflict(sim, pm, hit, pop, t, IV_LOSS[level], volcanic ? 'volcano' : 'quake', center);
    // 极端档:地质活跃度 ≥ EXTREME_GEO(暴烈)时,火山带上的三档事件会让城整座毁于火山(过些年可能重建)。
    // 默认参数(geo = 1)永远走不到这里;地形本身不改(地形重生成留给以后的地形大事)
    if (volcanic && level === 3 && (world.params.geo ?? 1) >= EXTREME_GEO) {
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



/** 装一次(一口气推) */
function installGeo(ctx: InstallCtx): void {
  const { sim, world, pm, seed } = ctx;
  if (!pm || !geoEventsOn(world)) return;
  const base = subSeed(seed, 'geo-events');
  sim.on(Ev.GeoCheck, (k, _b, t) => {
    sim.schedule(geoTime(base, k + 1), Ev.GeoCheck, k + 1, 0);
    geoAt(sim, pm, world, base, k, t);
  });
  sim.schedule(geoTime(base, 0), Ev.GeoCheck, 0, 0);
}

/** 接着推:只补上还没到的查看,不改已经发生的历史 */
function resumeGeo(ctx: ResumeCtx): void {
  const { sim, world } = ctx;
  const pm = polityModelOf(sim);
  if (!pm || !geoEventsOn(world)) return;
  const base = subSeed(world.params.seed, 'geo-events');
  let k = 0;
  while (geoTime(base, k) <= sim.now) k++;
  sim.on(Ev.GeoCheck, (kk, _b, t) => {
    sim.schedule(geoTime(base, kk + 1), Ev.GeoCheck, kk + 1, 0);
    geoAt(sim, pm, world, base, kk, t);
  });
  sim.schedule(geoTime(base, k), Ev.GeoCheck, k, 0);
}

/** 模块:地质事件(默认不装;见文件头) */
export const geoEventsModule: CivModule = {
  id: 'geoEvents',
  install: installGeo,
  resume: resumeGeo,
};
