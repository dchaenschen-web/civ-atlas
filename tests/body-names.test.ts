import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, type WorldParams } from '../src/gen/params';
import { generateAstro } from '../src/gen/astro';
import { cleanBodyName, namedBodies } from '../src/gen/astroNames';
import { EMPTY_EDITS } from '../src/gen/edits';
import { makeSave, parseSave, saveText } from '../src/gen/savefile';
import { layersOfOverrides, overridesOfLayers } from '../src/gen/systemLayers';
import type { SystemOverrides } from '../src/gen/astroDesign';

const P = (o: Partial<WorldParams> = {}): WorldParams => ({ ...DEFAULT_PARAMS, seed: 861, astro: 1, planets: 5, gas: 2, moons: 0, ...o });

describe('每颗行星的卫星数', () => {
  it('加/减卫星都生效,参数落在"像月球"的范围,确定性', () => {
    const p = P();
    const base = generateAstro(p);
    const target = base.design.planets.findIndex((x) => x.kind === 'rocky');
    const ov: SystemOverrides = { planets: [{ index: target, moonCount: 3 }], moons: [] };
    const a = generateAstro(p, ov);
    const moons = a.design.planets[target].moons;
    expect(moons).toHaveLength(3);
    for (const m of moons) {
      expect(m.distance).toBeGreaterThanOrEqual(45);
      expect(m.distance).toBeLessThanOrEqual(72);
      expect(m.radius).toBeGreaterThanOrEqual(0.2);
      expect(m.radius).toBeLessThanOrEqual(0.35);
    }
    expect(generateAstro(p, ov).design).toEqual(a.design);
    expect(generateAstro(p, { planets: [{ index: target, moonCount: 0 }], moons: [] }).design.planets[target].moons).toHaveLength(0);
  });
});

describe('星体手动改名', () => {
  it('namedBodies:恒星/行星/卫星都按覆盖表改名,没改的保持种子名', () => {
    const p = P();
    const base = generateAstro(p);
    const plain = namedBodies(base, p.seed, null);
    const homeMoon = String(base.home.index) + ':0';
    const ov: SystemOverrides = { planets: [], moons: [], bodyNames: { star: '测试星', planets: { 0: '甲' }, moons: { [homeMoon]: '小甲' } } };
    const named = namedBodies(base, p.seed, ov);
    expect(named.star).toBe('测试星');
    expect(named.planets[0]).toBe('甲');
    expect(named.planets[1]).toBe(plain.planets[1]);
    expect(named.moons[base.home.index]?.[0]).toBe('小甲');
  });

  it('名字清洗:控制字符/超长/空', () => {
    expect(cleanBodyName('  a\u0000b  ')).toBe('ab');
    expect(cleanBodyName('')).toBeUndefined();
    expect([...(cleanBodyName('一二三四五六七八九十一二三四五') ?? '')]).toHaveLength(12);
  });

  it('分层存档与存档都带上 bodyNames', () => {
    const p = P();
    const ov: SystemOverrides = { planets: [], moons: [], bodyNames: { star: '星', planets: { 1: '乙' } } };
    expect(overridesOfLayers(layersOfOverrides(ov))).toEqual(ov);
    const save = makeSave(p, EMPTY_EDITS, 'c', '改名', undefined, null, null, ov);
    const r = parseSave(saveText(save));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.save.system).toEqual(ov);
  });
});
