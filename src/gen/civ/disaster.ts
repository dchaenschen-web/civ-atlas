/**
 * 天灾(干预 disaster,字段见 gen/edits.ts 文件头的表):作者让某一年闹瘟疫、饥荒、地震水旱。**不改地形**,只让受灾的城人口掉一截
 * (Settlement.sacks:城里死 IV_LOSS[轻重] —— 轻 / 中 / 重约一成半 / 三成 / 五成),之后几十年慢慢长回来(growth.ts 的折损那一套,
 * 乡下跟着折损),其间国内更动荡(unrest.ts 照饥荒算:一国一条史事 famine)。
 *   瘟疫:从那座城起疫,照瘟疫的规矩往外传(plague.ts 的 PlagueModel.strike;那年已有一场在传 = 并进那一场)
 *   饥荒:一国(那一刻的国土)或选的几州里有城的(折损 cause = famine)
 *   地震水旱:那一处连同陆上接壤的一圈州(calamity.ts 的 quakeRing;折损 cause = quake)。叫"地震""大水"还是"大旱"只管说法,看那一处的地形(quakeWord)
 *   全球大疫:从那座城起一场全球大疫(pandemic.ts 的 startPandemic;轻重是死几成,slump = 疫后无人收拾几年,不给 = SLUMP_DEFAULT),
 *     是第 PLAGUE_IV + 干预下标 场;那年已有一场在传 = 并进全球大疫(那一场到此为止)
 *
 * 史事:先记一条 intervene(a = 受灾的国家:饥荒选的那国;别的 = 起疫那城 / 受灾那一带此刻的主人,部落地带 = −1;
 *   b = 受灾的州数(瘟疫:1 = 起了一场新的,2 = 并进了正在传的那一场;全球大疫:1 = 起了);0 = 没生效(那座城不在了 / 那一带没人住 / 那国已亡);
 *   region、settlement = 起疫的城 / 地震水旱那一处 / 饥荒里城最大的那一州,和它的城),
 *   紧跟着记它引起的:瘟疫的 plague(plague.ts);饥荒、地震水旱的 famine(一国一条,部落地带不记;地震水旱的 cause = quake)。
 * 不存内存状态:折损在城镇表里、动荡由史事 famine / plague 重建(unrest.ts、plague.ts 的 resume),接着推和一口气推完一样。纯计算,不碰 DOM。
 */
import { regionOfKey, type Intervention } from '../edits';
import { Layer, type Year } from './types';
import type { CivSim } from './engine/sim';
import type { InterventionModel } from './interventions';
import type { PolityModel } from './polities';
import { plagueModelOf } from './plague';
import { IV_LOSS, PLAGUE_IV, SLUMP_DEFAULT, quakeRing } from './calamity';
import { unrestModelOf } from './unrest';
import { populationAt } from './growth';
import { startPandemic } from './pandemic';

export type DisasterIv = Extract<Intervention, { kind: 'disaster' }>;

/** 天灾此刻落下(interventions.ts 在生效那一刻调用;t = 此刻;第 i 条干预)。史事见文件头 */
export function strikeDisaster(sim: CivSim, iv: InterventionModel, v: DisasterIv, i: number, t: Year): void {
  const pm = iv.pm!;
  const owner = sim.owners[Layer.Polity];
  const culture = sim.owners[Layer.Culture];
  const reg = pm.terrain.regions;
  const R = pm.terrain.R;
  const S = pm.settlements;
  /** 州 r 此刻有人烟的城(没有 = −1) */
  const cityNow = (r: number): number => {
    const sid = pm.cityOf[r];
    if (sid < 0 || culture[r] < 0) return -1;
    const s = S[sid];
    return s.ended === undefined && t >= s.founded ? sid : -1;
  };

  if (v.type === 'pandemic') {
    // 全球大疫(pandemic.ts):从那座城起,正在传的那一场并进来;第 PLAGUE_IV + i 场
    const sid = iv.resolveCity(v.city ?? '');
    const r = sid >= 0 ? S[sid].region : -1;
    const pl = plagueModelOf(sim);
    if (r < 0 || cityNow(r) !== sid || !pl?.pandemic) {
      sim.record('intervene', { a: r >= 0 ? owner[r] : -1, b: 0, region: r, settlement: sid, war: i });
      return;
    }
    sim.record('intervene', { a: owner[r], b: 1, region: r, settlement: sid, war: i });
    startPandemic(sim, r, v.level, PLAGUE_IV + i, v.slump ?? SLUMP_DEFAULT, t);
    return;
  }

  if (v.type === 'plague') {
    const sid = iv.resolveCity(v.city ?? '');
    const r = sid >= 0 ? S[sid].region : -1;
    const pl = plagueModelOf(sim);
    if (r < 0 || cityNow(r) !== sid || !pl?.strike) {
      sim.record('intervene', { a: r >= 0 ? owner[r] : -1, b: 0, region: r, settlement: sid, war: i });
      return;
    }
    // 先记干预,再记疫情(strike 里记 plague)
    sim.record('intervene', { a: owner[r], b: pl.now ? 2 : 1, region: r, settlement: sid, war: i });
    pl.strike(r, v.level, i, t);
    return;
  }

  // 受灾的州
  let a = -1;
  let regions: number[];
  let center = -1;
  if (v.type === 'famine') {
    if (v.a !== undefined) {
      a = iv.resolve(v.a);
      if (a < 0) return; // 键指不到:这条干预在新历史里没有对象(和别的干预一样不记)
      regions = pm.polities[a].ended === undefined ? pm.lands[a].slice() : [];
    } else {
      const of = iv.of;
      regions = [...new Set((v.regions ?? []).map((k) => regionOfKey(k, of)).filter((r) => r >= 0 && r < R))].sort((x, y) => x - y);
    }
  } else {
    center = regionOfKey(v.region ?? '', iv.of);
    regions = center >= 0 && center < R ? quakeRing(reg, center) : [];
  }
  // 有城、有人烟的才受灾;城最大的那一州记在史事里
  const hit: number[] = [];
  const pop = new Map<number, number>();
  let worst = -1;
  let most = -1;
  for (const r of regions) {
    const sid = cityNow(r);
    if (sid < 0) continue;
    hit.push(r);
    const p = populationAt(S[sid], t);
    pop.set(r, p);
    if (p > most) {
      most = p;
      worst = r;
    }
  }
  const at = v.type === 'quake' ? (center < R ? center : -1) : worst;
  const who = a >= 0 ? a : at >= 0 ? owner[at] : worst >= 0 ? owner[worst] : -1;
  sim.record('intervene', { a: who, b: hit.length, region: at, settlement: at >= 0 ? pm.cityOf[at] : -1, war: i });
  if (!hit.length) return;
  afflict(sim, pm, hit, pop, t, IV_LOSS[v.level], v.type === 'quake' ? 'quake' : 'famine', center);
}

/**
 * 受灾的几州(有城、有人烟,州号升序;pop = 各州城的人口)城里死 loss:记进城镇表(地震水旱记下震中 center),
 * 一国一条 famine(地震水旱 cause = quake;部落地带不记),国内更动荡(unrest.ts 照饥荒算)。
 * 作者下的饥荒、地震水旱和「天灾」多 / 很多时自己发生的地震水旱(pandemic.ts)共用
 */
export function afflict(sim: CivSim, pm: PolityModel, hit: readonly number[], pop: ReadonlyMap<number, number>, t: Year, loss: number, cause: 'quake' | 'volcano' | 'famine' | 'impact', center: number): void {
  const owner = sim.owners[Layer.Polity];
  const S = pm.settlements;
  /** 国家 → 受灾的州(城最大的在前) */
  const per = new Map<number, number[]>();
  for (const r of hit) {
    const sid = pm.cityOf[r];
    // 地震一类的记下震中:是大水、大旱还是地震按震中那州定,波及的邻州一样;火山另记一种
    (S[sid].sacks ??= []).push(cause === 'famine' ? { year: t, loss, cause } : { year: t, loss, cause, from: center });
    const p = owner[r];
    if (p < 0) continue;
    let l = per.get(p);
    if (!l) per.set(p, (l = []));
    l.push(r);
  }
  // 一国一条 famine(国内更动荡,unrest.ts 照饥荒算;部落地带不记),按国家号
  const um = unrestModelOf(sim);
  for (const p of [...per.keys()].sort((x, y) => x - y)) {
    const l = per.get(p)!;
    let top = l[0];
    let tp = -1;
    for (const r of l) {
      const x = pop.get(r)!;
      if (x > tp) {
        tp = x;
        top = r;
      }
    }
    sim.record('famine', {
      a: p,
      b: l.length,
      region: top,
      settlement: pm.cityOf[top],
      ...(cause === 'quake' ? { cause: 'quake' as const } : cause === 'volcano' ? { cause: 'volcano' as const } : cause === 'impact' ? { cause: 'impact' as const } : {}),
    });
    if (um) {
      let fl = um.famines.get(p);
      if (!fl) um.famines.set(p, (fl = []));
      fl.push({ year: t, n: l.length });
    }
  }
}
