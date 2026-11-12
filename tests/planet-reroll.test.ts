import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, type WorldParams } from '../src/gen/params';
import { generateAstro } from '../src/gen/astro';
import { EMPTY_OVERRIDES } from '../src/gen/astroDesign';

const P = (): WorldParams => ({ ...DEFAULT_PARAMS, seed: 861, astro: 1, planets: 5, gas: 2, life: 0 });

describe('S2 每颗行星「换一颗」', () => {
  it('换一颗只改那颗岩石行星,别的行星与恒星不动', () => {
    const base = generateAstro(P());
    const rerolled = generateAstro(P(), { ...EMPTY_OVERRIDES, planets: [{ index: 1, reroll: 7 }] });
    expect(rerolled.design.star).toEqual(base.design.star);
    expect(rerolled.design.planets).toHaveLength(base.design.planets.length);
    // 其它行星逐字段一样
    for (const i of [0, 2, 3, 4, 5, 6]) {
      if (i >= base.design.planets.length) continue;
      expect(rerolled.design.planets[i]).toEqual(base.design.planets[i]);
    }
    // 第 1 颗至少有一项变了(水圈 / 生物圈 / 平均温度 / 气压)
    const a = base.design.planets[1];
    const b = rerolled.design.planets[1];
    const changed = a.hydro !== b.hydro || a.biotic !== b.biotic || a.tempK !== b.tempK || a.atmos.pressure !== b.atmos.pressure || a.atmos.breathable !== b.atmos.breathable;
    expect(changed).toBe(true);
  });

  it('同一颗换到同一号 = 两次生成完全一致', () => {
    const a = generateAstro(P(), { ...EMPTY_OVERRIDES, planets: [{ index: 1, reroll: 7 }] });
    const b = generateAstro(P(), { ...EMPTY_OVERRIDES, planets: [{ index: 1, reroll: 7 }] });
    expect(a.design).toEqual(b.design);
  });

  it('不写 reroll 时和没改一样(默认世界逐字节不变)', () => {
    const base = generateAstro(P());
    const same = generateAstro(P(), { ...EMPTY_OVERRIDES, planets: [{ index: 1 }] });
    expect(same.design).toEqual(base.design);
  });
});
