/**
 * 官方规则包(src/gen/civ/modules.ts):同一刻的事件按装的先后排,清单的次序就是历史的一部分。
 * 这里把次序钉死:要改次序(同一种子的历史会变),得同时改这张表,并照规矩升生成器版本。
 * 总流程(src/gen/civ/run.ts)只照包里的清单走:换一份清单,叫到的就是那份里的模块。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { CIV_FINISH, CIV_MODULES, CIV_PARTIAL, CIV_TABLES, OFFICIAL_PACK, type CivModule } from '../src/gen/civ/modules';
import { CIV_ANNALS, CIV_EVENTS } from '../src/gen/civ/events';
import { CIV_KNOBS } from '../src/gen/civ/knobs';
import { OFFICIAL_KNOBS } from '../src/gen/civ/engine/knobs';
import { continuePack, runPack } from '../src/gen/civ/run';

describe('官方推演的子系统清单', () => {
  it('装、接着推的次序', () => {
    expect(CIV_MODULES.map((m) => m.id)).toEqual([
      'cultures',
      'polities',
      'wars',
      'politics',
      'dynasty',
      'assimilation',
      'cities',
      'diplomacy',
      'development',
      'ideology',
      'trade',
      'unrest',
      'control',
      'council',
      'regency',
      'marriage',
      'plague',
      'pandemic',
      'treaties',
      'migration',
      'religion',
      'interventions',
      'geoEvents',
      'impactEvents',
    ]);
  });

  it('名字不重复,每个模块至少会装或会接着推', () => {
    const ids = CIV_MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of CIV_MODULES) expect(m.install || m.resume, m.id).toBeTruthy();
  });

  it('推完往结果上补东西的次序;有 finish 的都在 CIV_FINISH 里,CIV_FINISH 里的都在清单里', () => {
    expect(CIV_FINISH.map((m) => m.id)).toEqual(['religion', 'development', 'ideology', 'trade']);
    const withFinish = CIV_MODULES.filter((m) => m.finish).map((m) => m.id).sort();
    expect([...CIV_FINISH.map((m) => m.id)].sort()).toEqual(withFinish);
    for (const m of CIV_FINISH) expect(CIV_MODULES).toContain(m);
  });

  it('推到一半拼结果时往上补的次序;有 partial 的都在 CIV_PARTIAL 里,CIV_PARTIAL 里的都在清单里', () => {
    expect(CIV_PARTIAL.map((m) => m.id)).toEqual(['development', 'ideology', 'trade']);
    const withPartial = CIV_MODULES.filter((m) => m.partial).map((m) => m.id).sort();
    expect([...CIV_PARTIAL.map((m) => m.id)].sort()).toEqual(withPartial);
    for (const m of CIV_PARTIAL) expect(CIV_MODULES).toContain(m);
  });

  it('官方规则包装着事件、史事、旋钮、数表和三份清单', () => {
    expect(OFFICIAL_PACK.id).toBe('official');
    expect(OFFICIAL_PACK.events).toBe(CIV_EVENTS);
    expect(OFFICIAL_PACK.annals).toBe(CIV_ANNALS);
    expect(OFFICIAL_PACK.knobs).toBe(CIV_KNOBS);
    expect(OFFICIAL_PACK.tables).toBe(CIV_TABLES);
    expect(OFFICIAL_PACK.modules).toBe(CIV_MODULES);
    expect(OFFICIAL_PACK.partial).toBe(CIV_PARTIAL);
    expect(OFFICIAL_PACK.finish).toBe(CIV_FINISH);
    expect(CIV_TABLES.map((t) => t.id)).toEqual(['state', 'dev', 'ideology']);
    for (const t of CIV_TABLES) {
      const ids = t.cards(OFFICIAL_KNOBS).map((c) => c.id);
      expect(ids.length, t.id).toBeGreaterThan(0);
      expect(new Set(ids).size, t.id).toBe(ids.length);
    }
  });

  it('总流程照包里的清单走:一口气推装上、推完补上,接着推接上、推到一半补上;只记账的模块不改历史', () => {
    const calls: string[] = [];
    let groups: string[] = [];
    const cards = new Map<string, string[]>();
    const spy: CivModule = {
      id: 'spy',
      install: () => void calls.push('install'),
      resume: () => void calls.push('resume'),
      partial: (c) => void calls.push(`partial ${c.civ.endYear}`),
      finish: (c) => {
        calls.push(`finish ${c.civ.endYear}`);
        groups = c.sim.tables.groupNames();
        for (const g of groups) cards.set(g, c.sim.tables.engine(g)!.cards.map((x) => x.id));
      },
    };
    const pack = { ...OFFICIAL_PACK, modules: [...CIV_MODULES, spy], partial: [...CIV_PARTIAL, spy], finish: [...CIV_FINISH, spy] };
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 7, cells: 4000 });
    const same = (a: Civ, b: Civ) => {
      expect(a.log.size).toBe(b.log.size);
      expect(Buffer.from(a.log.region.buffer).equals(Buffer.from(b.log.region.buffer))).toBe(true);
      expect(a.annals).toEqual(b.annals);
    };

    same(runPack(pack, world, { endYear: 800 }), generateCiv(world, { endYear: 800 }));
    expect(calls).toEqual(['install', 'finish 800']);
    // 目录里的三组数表就是推演里登记进总登记的那三组,卡也一样
    expect([...groups].sort()).toEqual(CIV_TABLES.map((t) => t.id).sort());
    for (const t of CIV_TABLES) expect(cards.get(t.id), t.id).toEqual(t.cards(OFFICIAL_KNOBS).map((c) => c.id));

    calls.length = 0;
    const head = generateCiv(world, { endYear: 400 });
    const run = continuePack(pack, world, head, { endYear: 600 })!;
    run.advance(500);
    same(run.partial(), generateCiv(world, { endYear: 600 }));
    expect(calls).toEqual(['resume', 'partial 600']);
  });
});
