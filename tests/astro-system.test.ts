/**
 * 星球系:生成、确定性、名字、世界文件不存它。
 */
import { describe, expect, it } from 'vitest';
import { generateAstro, astroOf, homeAir } from '../src/gen/astro';
import { nameAstro } from '../src/gen/astroNames';
import { generateWorld, DEFAULT_PARAMS, type WorldParams } from '../src/gen/world';

const OFF: WorldParams = { ...DEFAULT_PARAMS, seed: 21 };
const ON: WorldParams = { ...DEFAULT_PARAMS, seed: 21, cells: 6000, astro: 1 };

describe('星球系:生成与确定性', () => {
  it('同一个世界 → 同一个星球系', () => {
    expect(generateAstro(ON)).toEqual(generateAstro(ON));
  });
  it('bodies 和 design.planets 一一对应,公转周期随轨道变长', () => {
    const sys = generateAstro(ON);
    expect(sys.bodies.length).toBe(sys.design.planets.length);
    for (let i = 1; i < sys.bodies.length; i++) {
      expect(sys.bodies[i].design.a).toBeGreaterThan(sys.bodies[i - 1].design.a);
      expect(sys.bodies[i].periodDays).toBeGreaterThan(sys.bodies[i - 1].periodDays);
    }
    expect(sys.yearDays).toBeGreaterThan(0);
    expect(sys.dayHours).toBeGreaterThan(0);
  });
  it('主行星在 planets 里,大气有成分和气压', () => {
    const sys = generateAstro(ON);
    const home = sys.design.planets[sys.home.index];
    expect(home.kind).toBe('rocky');
    expect(home.atmos.gases.length).toBeGreaterThan(0);
    expect(home.atmos.pressure).toBeGreaterThan(0);
    expect(sys.home.air).toBe(home.atmos);
  });
});

describe('星球系:开关与世界文件', () => {
  it('astro = 0 的世界不挂星球系,astroOf 是 null(老世界照旧)', () => {
    const w = generateWorld(OFF);
    expect(w.astro).toBeUndefined();
    expect(astroOf(w)).toBeNull();
    expect(homeAir(w)).toBeNull();
  });
  it('astro = 1 的世界挂上星球系;去掉 astro 字段后 astroOf 还能按参数重算(世界文件不存它)', () => {
    const w = generateWorld(ON);
    expect(w.astro).toBeDefined();
    const copy = { ...w } as typeof w;
    delete copy.astro;
    const again = astroOf(copy as typeof w);
    expect(again).not.toBeNull();
    expect(again!.design.star.id).toBe(w.astro!.design.star.id);
    expect(again!.design.planets.length).toBe(w.astro!.design.planets.length);
  });
});

describe('星球系:名字', () => {
  it('恒星、每颗行星、每颗卫星、每颗邻近恒星都有名字,且同一世界稳定', () => {
    const sys = generateAstro(ON);
    const a = nameAstro(sys, ON.seed);
    const b = nameAstro(sys, ON.seed);
    expect(a).toEqual(b);
    expect(a.star.length).toBeGreaterThanOrEqual(2);
    expect(a.planets.length).toBe(sys.design.planets.length);
    for (const p of sys.design.planets) {
      if (p.moons.length) expect(a.moons[p.index].length).toBe(p.moons.length);
    }
    expect(a.nearby.length).toBe(sys.design.nearby.length);
    for (const n of a.planets) expect(n.length).toBeGreaterThanOrEqual(2);
    // 换种子名字会变
    const other = nameAstro(generateAstro({ ...ON, seed: 22 }), 22);
    expect(other.planets.join('')).not.toBe(a.planets.join(''));
  });
});
