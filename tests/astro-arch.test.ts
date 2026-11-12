/**
 * 星系构型(arch = 0/1/2/3):设计层的结构不变量。
 * 只跑 generateAstro(不生成地形/历史),几十毫秒级;结构上的事都在这儿卡住。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, type WorldParams } from '../src/gen/params';
import { generateAstro } from '../src/gen/astro';
import { breathReason } from '../src/gen/astroDesign';

const P = (o: Partial<WorldParams> = {}): WorldParams => ({ ...DEFAULT_PARAMS, seed: 4242, astro: 1, ...o });

describe('星系构型', () => {
  it('arch = 0:没有伴星、没有双恒星、没有宜居卫星', () => {
    const sys = generateAstro(P());
    expect(sys.design.arch).toBe(0);
    expect(sys.design.binary).toBeUndefined();
    expect(sys.design.binaryStar).toBeUndefined();
    expect(sys.design.habitableMoon).toBeUndefined();
    expect(sys.design.star.id).not.toBe('bin');
  });

  it('arch = 1:双固态行星同轨道,伴星给潮汐', () => {
    const sys = generateAstro(P({ arch: 1, planets: 3, life: 1 }));
    const bin = sys.design.binary;
    expect(bin).toBeTruthy();
    const home = sys.design.planets[sys.home.index];
    const comp = sys.design.planets[bin!.index];
    expect(home.a).toBeCloseTo(comp.a, 12);
    expect(bin!.separationAU).toBeGreaterThan(0);
    expect(bin!.periodDays).toBeGreaterThan(0);
    expect(sys.home.tide).toBeGreaterThan(0.2);
    expect(sys.home.air.breathable).toBe(true);
  });

  it('arch = 2:双恒星合成等效星,行星在稳定距离外', () => {
    const sys = generateAstro(P({ arch: 2, planets: 3, life: 1 }));
    const bs = sys.design.binaryStar;
    expect(bs).toBeTruthy();
    expect(sys.design.star.id).toBe('bin');
    expect(sys.design.star.lum).toBeGreaterThan(bs!.companion.lum);
    expect(bs!.lumRatio).toBeGreaterThan(0);
    expect(bs!.lumRatio).toBeLessThan(1);
    const aMin = Math.min(...sys.design.planets.filter((p) => p.kind === 'rocky').map((p) => p.a));
    expect(aMin).toBeGreaterThan(2.5 * bs!.sepAU);
    expect(sys.home.air.breathable).toBe(true);
  });

  it('arch = 3:主行星是气态巨星的卫星,潮汐锁定、潮汐加热、潮差大', () => {
    const sys = generateAstro(P({ arch: 3, planets: 3, gas: 1, life: 1 }));
    const hm = sys.design.habitableMoon;
    expect(hm).toBeTruthy();
    expect(sys.design.planets[hm!.parent].kind).toBe('gas');
    expect(hm!.index).toBe(sys.home.index);
    const parent = sys.design.planets[hm!.parent];
    const moon = sys.design.planets[hm!.index];
    expect(parent.a).toBeCloseTo(moon.a, 12);
    expect(moon.rotation).toBeLessThanOrEqual(200);
    expect(hm!.tidalHeatK).toBeGreaterThan(0);
    expect(sys.home.tide).toBeGreaterThan(5);
    expect(sys.home.air.breathable).toBe(true);
  });

  it('life = 2 时三种构型都没有生物圈(不可呼吸)', () => {
    for (const arch of [0, 1, 2, 3]) {
      const sys = generateAstro(P({ arch, life: 2, planets: 3, gas: 1 }));
      expect(sys.home.air.breathable, `arch=${arch}`).toBe(false);
      expect(breathReason(sys.home.air), `arch=${arch}`).not.toBeNull();
    }
  });

  it('home / salt 生效,且同样的参数两次生成逐字段一致', () => {
    const a = generateAstro(P({ arch: 1, planets: 4, home: 2 }));
    const b = generateAstro(P({ arch: 1, planets: 4, home: 2 }));
    expect(JSON.stringify(a.design)).toBe(JSON.stringify(b.design));
    expect(a.home.index).toBe(generateAstro(P({ arch: 1, planets: 4, home: 2 })).home.index);
    const c = generateAstro(P({ arch: 1, salt: 7 }));
    const d = generateAstro(P({ arch: 1 }));
    expect(JSON.stringify(c.design)).not.toBe(JSON.stringify(d.design));
  });

  it('默认参数(astro = 0)的设计层不动:star 是原来那颗、没有新结构', () => {
    const sys = generateAstro({ ...DEFAULT_PARAMS, seed: 9 });
    // astro = 0 时 generateAstro 仍能给一份"地球基线"设计,但没有任何新构型
    expect(sys.design.arch).toBe(0);
    expect(sys.design.binary).toBeUndefined();
    expect(sys.design.binaryStar).toBeUndefined();
    expect(sys.design.habitableMoon).toBeUndefined();
  });
});
