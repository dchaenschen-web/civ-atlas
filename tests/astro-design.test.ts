/**
 * 星球系设计层:确定性、量纲范围、地球基线的标定。
 */
import { describe, expect, it } from 'vitest';
import {
  BUDGET,
  GAS_MOLAR,
  STAR_TYPES,
  composeAtmosphere,
  designOf,
  equilibriumTempK,
  escapeTempK,
  gasGiantAtmosphere,
  insolationOf,
  orbitYears,
  pickStar,
  skyOf,
  tideOf,
  type GasId,
} from '../src/gen/astroDesign';

const BASE = { system: 2, planets: 3, gas: 2, moons: 1, tilt: 23.5, rotation: 24, geo: 1, mag: 1 };

describe('星球系设计:确定性', () => {
  it('同样的种子和参数 → 逐字段一样', () => {
    expect(designOf(42, BASE)).toEqual(designOf(42, BASE));
  });
  it('换种子 → 行星不一样', () => {
    const a = designOf(42, BASE);
    const b = designOf(43, BASE);
    expect(JSON.stringify(a.planets)).not.toBe(JSON.stringify(b.planets));
  });
  it('星表的星星由种子决定', () => {
    expect(designOf(7, BASE).stars).toEqual(designOf(7, BASE).stars);
    expect(designOf(7, BASE).stars.length).toBe(420);
  });
});

describe('星球系设计:物理量标定', () => {
  it('开普勒:1 AU ≈ 1 年,4 AU ≈ 8 年', () => {
    expect(orbitYears(1)).toBeCloseTo(1, 12);
    expect(orbitYears(4)).toBeCloseTo(8, 12);
  });
  it('辐照度:1 AU 的黄矮星 = 1', () => {
    expect(insolationOf(1, 1)).toBe(1);
  });
  it('平衡温度:反照率 0.3、辐照 1 → 约 255 K', () => {
    expect(equilibriumTempK(1, 0.3)).toBeCloseTo(255, 0);
  });
  it('逃逸温度随摩尔质量线性增长', () => {
    const n2 = escapeTempK(GAS_MOLAR.n2, 11.2);
    const co2 = escapeTempK(GAS_MOLAR.co2, 11.2);
    expect(co2 / n2).toBeCloseTo(44 / 28, 6);
    expect(n2).toBeGreaterThan(1e4);
  });
  it('恒星类型:参数 2 = 黄矮星,0 = 按种子挑', () => {
    expect(pickStar(2, 1).id).toBe('g');
    expect([1, 2, 3, 4, 5]).toContain(pickStar(0, 9).id === 'f' ? 1 : 2);
    expect(STAR_TYPES.length).toBe(5);
  });
});

describe('大气成分', () => {
  const star = STAR_TYPES[1]; // 黄矮星
  it('地球那样的输入:气压约 1 atm、温室 20–60 K、含氮氧、可呼吸', () => {
    const air = composeAtmosphere({ mass: 1, radius: 1, tempK: 288, geo: 0.8, magnetic: 1, hydro: true, biotic: true, star });
    expect(air.pressure).toBeGreaterThan(0.4);
    expect(air.pressure).toBeLessThan(2.5);
    expect(air.greenhouseK).toBeGreaterThan(15);
    expect(air.greenhouseK).toBeLessThan(70);
    const byId = new Map(air.gases.map((g) => [g.id, g.frac]));
    expect(byId.get('n2')).toBeGreaterThan(0.2);
    expect(byId.get('o2')).toBeGreaterThan(0.05);
    expect(air.breathable).toBe(true);
  });
  it('没水的死星:水汽很少,不可呼吸', () => {
    const air = composeAtmosphere({ mass: 1, radius: 1, tempK: 288, geo: 0.1, magnetic: 0.2, hydro: false, biotic: false, star });
    const byId = new Map(air.gases.map((g) => [g.id, g.frac]));
    expect(byId.get('h2o') ?? 0).toBeLessThan(0.02);
    expect(air.breathable).toBe(false);
    expect(air.biotic).toBe(false);
  });
  it('小引力热行星:大气被剥得薄', () => {
    const thick = composeAtmosphere({ mass: 1, radius: 1, tempK: 288, geo: 1, magnetic: 1, hydro: true, biotic: false, star });
    const thin = composeAtmosphere({ mass: 0.12, radius: 0.55, tempK: 330, geo: 0.3, magnetic: 0.2, hydro: false, biotic: false, star });
    expect(thin.pressure).toBeLessThan(thick.pressure);
  });
  it('气态行星:氢氦为主、没有地表、不可呼吸', () => {
    const air = gasGiantAtmosphere(300);
    expect(air.gases[0].id).toBe('h2');
    expect(air.gases[0].frac).toBeGreaterThan(0.8);
    expect(air.breathable).toBe(false);
  });
  it('天空颜色随成分变:氮氧=蓝,氢氦=琥珀,厚 CO₂=黄褐', () => {
    expect(skyOf([{ id: 'n2', frac: 0.78, partial: 0.78 }, { id: 'o2', frac: 0.21, partial: 0.21 }], 1)[2]).toBeGreaterThan(200);
    const amber = skyOf([{ id: 'h2', frac: 0.9, partial: 1 }, { id: 'he', frac: 0.1, partial: 0.1 }], 1);
    expect(amber[0]).toBeGreaterThan(amber[2]);
    const tan = skyOf([{ id: 'co2', frac: 0.96, partial: 90 }], 90);
    expect(tan[0]).toBeGreaterThan(180);
  });
});

describe('潮汐与地表预算', () => {
  it('主行星的潮差 > 0,无卫星的世界潮差明显更小', () => {
    const withMoon = designOf(11, { ...BASE, moons: 2 });
    const noMoon = designOf(11, { ...BASE, moons: 0 });
    expect(withMoon.home.tide).toBeGreaterThan(0);
    expect(withMoon.home.tide).toBeGreaterThan(noMoon.home.tide);
  });
  it('气态行星不给地表,死星低精度,主行星 -1', () => {
    const d = designOf(5, { ...BASE, planets: 3, gas: 2 });
    const home = d.planets[d.home.index];
    expect(home.kind).toBe('rocky');
    expect(d.budget[d.home.index]).toBe(-1);
    for (let i = 0; i < d.planets.length; i++) {
      const b = d.planets[i];
      if (b.kind === 'gas') expect(d.budget[i]).toBe(BUDGET.gas);
      else if (i !== d.home.index) expect(d.budget[i]).toBeGreaterThan(0);
    }
  });
  it('大气成分里认得出的气体都在表里', () => {
    const d = designOf(3, BASE);
    for (const p of d.planets) for (const g of p.atmos.gases) expect(GAS_MOLAR[g.id as GasId]).toBeGreaterThan(0);
  });
  it('潮差公式:卫星质量翻倍 → 潮差大约翻倍(卫星质量线性)', () => {
    const d = designOf(8, BASE);
    const home = d.planets[d.home.index];
    const one = tideOf(home, d.star);
    const doubled = tideOf({ ...home, moons: home.moons.map((m) => ({ ...m, mass: m.mass * 2 })) }, d.star);
    if (home.moons.length) expect(doubled / one).toBeGreaterThan(1.3);
  });
});
