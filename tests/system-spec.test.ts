import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, type WorldParams } from '../src/gen/params';
import { generateAstro } from '../src/gen/astro';
import { systemSpecOf } from '../src/gen/systemSpec';
import { beltsOf } from '../src/gen/system';
import type { SystemOverrides } from '../src/gen/astroDesign';

const P = (o: Partial<WorldParams> = {}): WorldParams => ({ ...DEFAULT_PARAMS, seed: 861, astro: 1, planets: 5, gas: 2, moons: 1, impact: 1, ...o });

describe('SystemSpec 分层视图', () => {
  it('星系层:恒星/构型/带/主行星下标', () => {
    const p = P();
    const sys = generateAstro(p);
    const spec = systemSpecOf(sys, p, null);
    expect(spec.star).toEqual(sys.design.star);
    expect(spec.arch).toBe(sys.design.arch);
    expect(spec.home).toBe(sys.design.home.index);
    expect(spec.impact).toBe(1);
    expect(spec.belts).toEqual(beltsOf(sys.design, p.seed, p.impact));
    expect(spec.planets).toHaveLength(sys.design.planets.length);
    expect(spec.planets[spec.home].role).toBe('home');
  });

  it('行星层:轨道/物理字段与设计层一致;主行星有卫星', () => {
    const p = P();
    const sys = generateAstro(p);
    const spec = systemSpecOf(sys, p, null);
    const b = spec.planets[1];
    const d = sys.design.planets[1];
    expect(b.orbit).toMatchObject({ a: d.a, ecc: d.ecc, incDeg: d.incDeg, nodeDeg: d.nodeDeg });
    expect(b.orbit.periodDays).toBeGreaterThan(0);
    expect(b.physical.radius).toBe(d.radius);
    expect(b.physical.tilt).toBe(d.tilt);
    expect(spec.planets[spec.home].moons).toHaveLength(sys.design.planets[sys.home.index].moons.length);
  });

  it('覆盖表:地表参数/地形透传到对应天体', () => {
    const p = P();
    const sys = generateAstro(p);
    const ov: SystemOverrides = {
      planets: [{ index: 1, surface: { landFraction: 0.4 }, terrain: [{ kind: 'volcano', pts: [10, 20], r: 18, s: 1 }] }],
      moons: [{ planet: sys.home.index, moon: 0, surface: { landFraction: 0.9 } }],
    };
    const spec = systemSpecOf(sys, p, ov);
    expect(spec.planets[1].surface).toEqual({ landFraction: 0.4 });
    expect(spec.planets[1].terrain).toHaveLength(1);
    expect(spec.planets[spec.home].moons[0].surface).toEqual({ landFraction: 0.9 });
  });

  it('角色随构型:宜居卫星构型里主行星就是那颗卫星', () => {
    const p = P({ arch: 3, gas: 1 });
    const sys = generateAstro(p);
    const spec = systemSpecOf(sys, p, null);
    expect(spec.habitableMoon).toBeTruthy();
    expect(spec.planets[spec.habitableMoon!.index].role).toBe('home');
  });
});
