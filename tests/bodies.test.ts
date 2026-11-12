/**
 * 多天体详情 / 按需文明(S4):生命判定、World 缓存、只有生命天体才推文明、推一次就记着。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, type WorldParams } from '../src/gen/params';
import { generateWorld } from '../src/gen/world';
import { astroOf } from '../src/gen/astro';
import { bodyCiv, bodyFacts, bodyWorld } from '../src/gen/bodies';

const P = (o: Partial<WorldParams> = {}): WorldParams => ({ ...DEFAULT_PARAMS, seed: 861, cells: 2000, astro: 1, planets: 5, gas: 2, life: 1, ...o });

describe('多天体详情', () => {
  it('每颗行星都有事实;生命判定 = 生物圈或可呼吸', () => {
    const sys = astroOf(generateWorld(P()))!;
    const facts = bodyFacts(sys);
    expect(facts).toHaveLength(sys.design.planets.length);
    for (const f of facts) {
      expect(f.alive).toBe(f.planet.kind === 'rocky' && (f.planet.biotic || f.planet.atmos.breathable));
    }
  });

  it('天体 World 走同一份缓存(同一颗行星两次拿到同一个对象)', () => {
    const p = P();
    const sys = astroOf(generateWorld(p))!;
    const a = bodyWorld(sys, 0, p);
    const b = bodyWorld(sys, 0, p);
    expect(a).toBe(b);
    expect(a.params.astro).toBe(0); // 别的行星的世界不再递归带星系
  });

  it('只有生命天体才推文明:给第二颗行星加生命后能推,且只推一次', () => {
    const p = P();
    const base = astroOf(generateWorld(p))!;
    const target = bodyFacts(base).find((f) => f.planet.kind === 'rocky' && f.index !== base.home.index)!;
    expect(target).toBeTruthy();
    // 用覆盖表把那一颗设成有生命
    const withLife = astroOf(generateWorld(p, undefined, undefined, undefined, undefined, { planets: [{ index: target.index, life: 1 }], moons: [] }))!;
    const aliveSecond = bodyFacts(withLife).filter((f) => f.alive && f.index !== withLife.home.index);
    expect(aliveSecond.length).toBeGreaterThan(0);
    const idx = aliveSecond[0].index;
    const c1 = bodyCiv(withLife, idx, p, 150);
    expect(c1.endYear).toBe(150);
    const c2 = bodyCiv(withLife, idx, p, 150);
    expect(c2).toBe(c1); // 缓存:同一星系同一天体只推一次
  }, 60_000);
});
