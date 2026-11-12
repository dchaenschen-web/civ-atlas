import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, type WorldParams } from '../src/gen/params';
import { generateWorld } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { impactEventsOn } from '../src/gen/civ/impactEvents';
import { settleImpacts } from '../src/gen/impacts';

const P = (o: Partial<WorldParams> = {}): WorldParams => ({ ...DEFAULT_PARAMS, seed: 21, cells: 2000, astro: 1, impact: 2, planets: 5, gas: 2, life: 1, ...o });

describe('S5 陨星撞击 + 推演后结算(C 方案)', () => {
  it('默认世界不装陨击(老历史逐字节不变)', () => {
    expect(impactEventsOn(generateWorld(DEFAULT_PARAMS))).toBe(false);
  });

  it('频繁陨击:推演里记撞击,结算算出坑与地形改动,世界本身没改', () => {
    const w = generateWorld(P());
    expect(impactEventsOn(w)).toBe(true);
    const civ = generateCiv(w, { endYear: 1200 });
    const s = settleImpacts(w, civ);
    expect(s.craters.length).toBeGreaterThan(0);
    expect(s.touched).toBeGreaterThan(0);
    expect(s.elevation).not.toBe(w.elevation);
    expect(s.elevation.length).toBe(w.elevation.length);
    // 每处坑的年份都在推演范围内、经纬度合法
    for (const c of s.craters) {
      expect(c.year).toBeGreaterThanOrEqual(0);
      expect(c.year).toBeLessThanOrEqual(1200);
      expect(Math.abs(c.lat)).toBeLessThanOrEqual(90);
      expect(c.radiusKm).toBeGreaterThan(0);
    }
  }, 120_000);

  it('没有撞击事件时结算为空,把 elevation 原样复制一份', () => {
    const w = generateWorld(DEFAULT_PARAMS);
    const s = settleImpacts(w, null);
    expect(s.craters).toHaveLength(0);
    expect(s.touched).toBe(0);
    expect(s.elevation).not.toBe(w.elevation);
    expect(Array.from(s.elevation.slice(0, 8))).toEqual(Array.from(w.elevation.slice(0, 8)));
  });
});
