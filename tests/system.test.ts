/**
 * 多天体星系(S1 数据层):聚合、覆盖表、轨道参数、小行星带与陨击率、卫星地表参数。
 * 这些都在 gen 层,不依赖 UI;卡的是"派生必须确定、默认必须不变"。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, type WorldParams } from '../src/gen/params';
import { applyOverrides, beltsOf, emptyOverrides, impactRateOf, moonSurface, moonWorldParams, overridesEmpty, planMoonSurfaces, systemOf } from '../src/gen/system';
import { generateWorld } from '../src/gen/world';

const P = (o: Partial<WorldParams> = {}): WorldParams => ({ ...DEFAULT_PARAMS, seed: 841, cells: 2000, astro: 1, planets: 3, gas: 1, life: 1, ...o });

describe('星系聚合', () => {
  it('astro = 0 时没有星系;开了星系能拿到设计层', () => {
    expect(systemOf(null, { ...DEFAULT_PARAMS, seed: 9 })).toBeNull();
    const w = generateWorld(P());
    const sys = systemOf(w)!;
    expect(sys.design).toBe(w.astro!.design);
    expect(overridesEmpty(sys.overrides)).toBe(true);
  });

  it('覆盖表:空 = 原样;改了轨道/倾角/半径就生效', () => {
    const sys = systemOf(generateWorld(P()))!;
    expect(JSON.stringify(applyOverrides(sys.design, emptyOverrides()))).toBe(JSON.stringify(sys.design));
    const eff = applyOverrides(sys.design, { planets: [{ index: 0, a: 0.5, tilt: 40, radius: 1.2 }], moons: [] });
    expect(eff.planets[0].a).toBeCloseTo(0.5, 12);
    expect(eff.planets[0].tilt).toBeCloseTo(40, 12);
    expect(eff.planets[0].radius).toBeCloseTo(1.2, 12);
    // 别的行星不受影响
    expect(eff.planets[1]).toBe(sys.design.planets[1]);
  });

  it('每颗行星都有黄道角与升交点,且在合理范围', () => {
    const sys = systemOf(generateWorld(P()))!;
    for (const p of sys.design.planets) {
      expect(p.incDeg).toBeGreaterThanOrEqual(0);
      expect(p.incDeg).toBeLessThanOrEqual(8);
      expect(p.nodeDeg).toBeGreaterThanOrEqual(0);
      expect(p.nodeDeg).toBeLessThanOrEqual(360);
    }
  });
});

describe('小行星带与陨击率', () => {
  it('impact = 0 没有带;impact ≥ 1 才有,且参数可复现', () => {
    const design = systemOf(generateWorld(P()))!.design;
    expect(beltsOf(design, 841, 0)).toHaveLength(0);
    const b1 = beltsOf(design, 841, 1);
    const b2 = beltsOf(design, 841, 1);
    expect(b1.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(b1)).toBe(JSON.stringify(b2));
    for (const b of b1) {
      expect(b.innerAU).toBeGreaterThan(0);
      expect(b.outerAU).toBeGreaterThan(b.innerAU);
      expect(b.count).toBeGreaterThan(0);
    }
  });

  it('穿带的行星陨击率更高;没有带就是 1', () => {
    const sys = systemOf(generateWorld(P({ impact: 1 })))!;
    const belt = sys.belts[0];
    const moved = applyOverrides(sys.design, { planets: [{ index: 0, a: (belt.innerAU + belt.outerAU) / 2 }], moons: [] });
    expect(impactRateOf(moved, sys.belts, 0)).toBeGreaterThan(1.2);
    expect(impactRateOf(moved, [], 0)).toBe(1);
  });

  it('同样的带 + 同样的行星,陨击率可复现', () => {
    const sys = systemOf(generateWorld(P({ impact: 2 })))!;
    const r1 = impactRateOf(sys.design, sys.belts, 0);
    const r2 = impactRateOf(sys.design, sys.belts, 0);
    expect(r1).toBe(r2);
  });
});

describe('卫星地表', () => {
  it('参数确定、预算按半径分档', () => {
    const sys = systemOf(generateWorld(P({ moons: 2 })))!;
    const list = planMoonSurfaces(sys);
    expect(list.length).toBeGreaterThan(0);
    for (const m of list) {
      const a = moonWorldParams(sys.effective, m.planet, m.moon, sys.params);
      const b = moonWorldParams(sys.effective, m.planet, m.moon, sys.params);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(a.cells).toBeGreaterThanOrEqual(2000);
      expect(a.astro).toBe(0); // 卫星世界里不再递归带星系
    }
  });

  it('卫星地表能生成,且同一个星系里两次一致', () => {
    const sys = systemOf(generateWorld(P({ moons: 1 })))!;
    const list = planMoonSurfaces(sys);
    if (!list.length) return;
    const s1 = moonSurface(sys, list[0].planet, list[0].moon)!;
    const s2 = moonSurface(sys, list[0].planet, list[0].moon)!;
    expect(s2.world).toBe(s1.world); // 走缓存
    expect(JSON.stringify(s1.stats)).toBe(JSON.stringify(s2.stats));
    expect(s1.stats.landPct).toBeGreaterThan(0);
  });
});
