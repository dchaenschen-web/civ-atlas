/**
 * 事件种类、史事种类改成登记:引擎按登记的种类定"核对版本号""同一刻里排在哪",自己不认识任何子系统的事件;
 * 官方推演的事件种类在 civ/events.ts(CIV_EVENTS),史事种类的说明在 civ/annals.ts(ANNAL_KINDS)。
 */
import { describe, expect, it } from 'vitest';
import { CivSim, type EventKind } from '../src/gen/civ/engine/sim';
import { CIV_ANNALS, CIV_EVENTS } from '../src/gen/civ/events';
import { ANNAL_KINDS } from '../src/gen/civ/annals';
import { ANNAL_EXTRAS } from '../src/gen/civ/types';

describe('引擎按登记的事件种类排同一刻的先后', () => {
  // 自己编的一套种类(和官方推演无关):编号随便取,只看登记的次序类别
  const KINDS: EventKind[] = [
    { id: 10, name: '普通甲', watch: false },
    { id: 11, name: '普通乙', watch: false },
    { id: 20, name: '最先', watch: false, order: { early: 0 } },
    { id: 21, name: '第二', watch: false, order: { early: 1 } },
    { id: 30, name: '按国家·槽0', watch: false, order: { perPolity: 0 } },
    { id: 31, name: '按国家·槽1', watch: false, order: { perPolity: 1 } },
    { id: 40, name: '段末·倒数第二', watch: false, order: { earlyEnd: 2 } },
    { id: 41, name: '段末·最后', watch: false, order: { earlyEnd: 1 } },
    { id: 50, name: '到达·组0', watch: false, order: { arrival: 0 } },
    { id: 51, name: '到达·组1', watch: false, order: { arrival: 1 } },
  ];
  const nameOf = new Map(KINDS.map((k) => [k.id, k.name]));

  it('同一刻:early → 按国家(国家号,再槽位)→ earlyEnd → 按预约先后 → 到达(组,再州号、编号);和预约先后无关', () => {
    const sim = new CivSim(4, KINDS);
    const seen: string[] = [];
    for (const k of KINDS) sim.on(k.id, (a, b) => seen.push(`${nameOf.get(k.id)}(${a},${b})`));
    // 故意倒着预约
    sim.schedule(3, 51, 0, 0);
    sim.schedule(3, 50, 2, 0);
    sim.schedule(3, 50, 1, 5);
    sim.schedule(3, 11, 0, 0);
    sim.schedule(3, 10, 0, 0);
    sim.schedule(3, 41, 0, 0);
    sim.schedule(3, 40, 0, 0);
    sim.schedule(3, 31, 0, 1);
    sim.schedule(3, 30, 0, 1);
    sim.schedule(3, 31, 0, 0);
    sim.schedule(3, 21, 0, 0);
    sim.schedule(3, 20, 0, 0);
    sim.run(5);
    expect(seen).toEqual([
      '最先(0,0)',
      '第二(0,0)',
      '按国家·槽1(0,0)',
      '按国家·槽0(0,1)',
      '按国家·槽1(0,1)',
      '段末·倒数第二(0,0)',
      '段末·最后(0,0)',
      '普通乙(0,0)',
      '普通甲(0,0)',
      '到达·组0(1,5)',
      '到达·组0(2,0)',
      '到达·组1(0,0)',
    ]);
  });

  it('没登记的种类:不核对版本号、按预约先后;登记了 watch 的:州 a 的归属变过就过期', () => {
    const sim = new CivSim(2, [{ id: 7, name: '核对', watch: true }]);
    const seen: string[] = [];
    sim.on(7, (a, b) => seen.push(`核对${a}-${b}`));
    sim.on(8, (a, b) => seen.push(`不核对${a}-${b}`));
    sim.schedule(2, 7, 0, 1);
    sim.schedule(2, 8, 0, 1);
    sim.setOwner(0, 0, 3, 0);
    sim.run(3);
    expect(seen).toEqual(['不核对0-1']);
  });

  it('登记写错了直接报错:编号重复、超出 0–255、次序超出范围', () => {
    expect(() => new CivSim(1, [{ id: 3, name: 'x', watch: false }, { id: 3, name: 'y', watch: false }])).toThrow(/两次/);
    expect(() => new CivSim(1, [{ id: 300, name: 'x', watch: false }])).toThrow(/0–255/);
    expect(() => new CivSim(1, [{ id: 1, name: 'x', watch: false, order: { early: 4 } }])).toThrow(/early/);
    expect(() => new CivSim(1, [{ id: 1, name: 'x', watch: false, order: { perPolity: 4 } }])).toThrow(/perPolity/);
    expect(() => new CivSim(1, [{ id: 1, name: 'x', watch: false, order: { earlyEnd: 0 } }])).toThrow(/earlyEnd/);
  });
});

describe('官方推演登记的种类', () => {
  it('事件:编号不重复,都有名字;51 种全登记了', () => {
    const ids = CIV_EVENTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(51);
    for (const e of CIV_EVENTS) expect(e.name.length).toBeGreaterThan(0);
    expect(() => new CivSim(1, CIV_EVENTS)).not.toThrow();
  });

  it('史事:49 种每种都写了说明和五列的含义', () => {
    const kinds = Object.keys(ANNAL_KINDS);
    expect(kinds.length).toBe(49);
    for (const k of kinds) {
      const v = ANNAL_KINDS[k as keyof typeof ANNAL_KINDS];
      for (const col of ['desc', 'a', 'b', 'region', 'settlement', 'war'] as const) expect(v[col].length, `${k}.${col}`).toBeGreaterThan(0);
    }
  });

  it('记史事:可有可无的几列照官方登记的次序(ANNAL_EXTRAS)抄进去,数组抄一份', () => {
    const sim = new CivSim(1, CIV_EVENTS, CIV_ANNALS);
    const ps = [3, 4];
    sim.record('treaty', { until: 9, ps, n: 2, a: 1 });
    const e = sim.annal(0);
    expect(Object.keys(e)).toEqual(['year', 'kind', 'a', 'b', 'region', 'settlement', 'war', 'n', 'ps', 'until']);
    expect(e.ps).toEqual([3, 4]);
    expect(e.ps).not.toBe(ps);
    expect(CIV_ANNALS.extras).toBe(ANNAL_EXTRAS);
    expect(ANNAL_EXTRAS).toEqual(['via', 'cause', 'foe', 'n', 'ps', 'by', 'opt', 'until']);
  });

  it('记史事:引擎只抄登记了的列;没登记就只记固定的几列', () => {
    const own = new CivSim(1, [], { extras: ['until', 'n'] });
    own.record('treaty', { n: 2, ps: [3], until: 9 });
    expect(Object.keys(own.annal(0))).toEqual(['year', 'kind', 'a', 'b', 'region', 'settlement', 'war', 'until', 'n']);
    const bare = new CivSim(1);
    bare.record('treaty', { n: 2, ps: [3], a: 1 });
    expect(bare.annal(0)).toEqual({ year: 0, kind: 'treaty', a: 1, b: -1, region: -1, settlement: -1, war: -1 });
  });
});
