import { describe, expect, it } from 'vitest';
import { phasesOf, surfaceHints } from '../src/gen/materials';
import { DEFAULT_PARAMS, type WorldParams } from '../src/gen/params';
import { generateAstro } from '../src/gen/astro';
import { moonWorldParams } from '../src/gen/system';
import { planetWorldParams } from '../src/gen/astroWorlds';

const P = (o: Partial<WorldParams> = {}): WorldParams => ({ ...DEFAULT_PARAMS, seed: 861, astro: 1, planets: 5, gas: 2, life: 0, ...o });

describe('S2 物质状态(相图)', () => {
  it('水:冷 = 冰、常温 = 液、热 = 汽;没有水圈 = none', () => {
    expect(phasesOf(250, 1).water).toBe('ice');
    expect(phasesOf(288, 1).water).toBe('liquid');
    expect(phasesOf(400, 1).water).toBe('vapor');
    expect(phasesOf(288, 1, { hasWater: false }).water).toBe('none');
    // 低压(火星级 0.01 atm)下水只在冰/汽之间
    expect(phasesOf(300, 0.01).water).toBe('vapor');
    expect(phasesOf(250, 0.01).water).toBe('ice');
  });

  it('二氧化碳/氨/甲烷也跟着温度走', () => {
    expect(phasesOf(150, 1).co2).toBe('ice');
    expect(phasesOf(300, 1).co2).toBe('gas');
    expect(phasesOf(200, 1).ammonia).toBe('liquid');
    expect(phasesOf(250, 1).ammonia).toBe('gas');
    expect(phasesOf(100, 1).methane).toBe('liquid');
  });

  it('地表提示:冰盖/干地/正常三种口径', () => {
    expect(surfaceHints(phasesOf(250, 1)).minLand).toBeGreaterThanOrEqual(0.8);
    expect(surfaceHints(phasesOf(250, 1)).rainScale).toBeLessThan(0.2);
    expect(surfaceHints(phasesOf(400, 1)).minLand).toBeGreaterThanOrEqual(0.9);
    expect(surfaceHints(phasesOf(288, 1)).rainScale).toBe(1);
  });
});

describe('S2 地表生成按每颗行星自己的物质状态', () => {
  it('每颗有水的行星:陆地比例不低于"冰盖/干地"下限,和它的相态一致', () => {
    let checked = 0;
    for (const seed of [1, 2, 7, 21, 861]) {
      const sys = generateAstro(P({ seed }));
      sys.design.planets.forEach((p, i) => {
        if (p.kind !== 'rocky' || !p.hydro) return;
        const ph = phasesOf(p.tempK, p.atmos.pressure, { hasWater: true });
        const wp = planetWorldParams(sys, i, P({ seed }));
        expect(wp.landFraction).toBeGreaterThanOrEqual(surfaceHints(ph).minLand);
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('卫星地表:温度偏移按母行星温度、冰壳卫星降水很低', () => {
    const p = P({ moons: 2 });
    const sys = generateAstro(p);
    const home = sys.design.planets[sys.home.index];
    for (let m = 0; m < home.moons.length; m++) {
      const mp = moonWorldParams(sys.design, sys.home.index, m, p);
      const expectT = Math.max(-40, Math.min(40, Math.round((home.tempK - (home.moons[m].locked ? 25 : 10) - 288) * 10) / 10));
      expect(mp.temperature).toBe(expectT);
      expect(mp.rainfall).toBeLessThanOrEqual(0.3);
      expect(mp.landFraction).toBeGreaterThanOrEqual(0.88);
    }
  });
});
