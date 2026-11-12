import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/gen/params';
import { generateAstro } from '../src/gen/astro';
import { planetSurface, planetWorldParams } from '../src/gen/astroWorlds';
import { moonWorldParams } from '../src/gen/system';
import { subSeed } from '../src/gen/util';
import { EMPTY_EDITS } from '../src/gen/edits';
import { makeSave, parseSave, saveText } from '../src/gen/savefile';
import { layersOfOverrides, overridesOfLayers } from '../src/gen/systemLayers';
import { BODY_TEMPLATES, applyBodyTemplate, bodyTemplateOf } from '../src/gen/surfaceTemplates';
import type { BodyGen, SystemOverrides } from '../src/gen/astroDesign';

const P = { ...DEFAULT_PARAMS, seed: 555, astro: 1, planets: 5, gas: 2, moons: 1 };
const sys = generateAstro(P);
const rocky = sys.design.planets.findIndex((p) => p.kind === 'rocky');
const withMoon = sys.design.planets.findIndex((p) => p.moons.length > 0);

describe('每颗行星独立的生成参数', () => {
  const gen: BodyGen = { plates: 50, mountains: 4.5, cells: 2000, landFraction: 0.9, temperature: 20, rainfall: 4, seed: 777 };

  it('板块/造山/气候/精度/种子全部按行星生效', () => {
    const wp = planetWorldParams(sys, rocky, P, undefined, gen);
    expect(wp.plates).toBe(50);
    expect(wp.mountains).toBe(4.5);
    expect(wp.cells).toBe(2000);
    expect(wp.landFraction).toBe(0.9);
    expect(wp.temperature).toBe(20);
    expect(wp.rainfall).toBe(4);
    expect(wp.seed).toBe(777);
  });

  it('不写 gen 时按种子回退(默认世界不变)', () => {
    const wp = planetWorldParams(sys, rocky, P);
    expect(wp.seed).toBe((subSeed(P.seed, `astro-planet:${rocky}`) >>> 0) || 1);
    expect(wp.cells).toBeGreaterThan(0);
    expect(wp.mountains).toBeGreaterThanOrEqual(0);
  });

  it('不同 gen 是不同的世界;同一 gen 命中缓存', () => {
    const a = planetSurface(sys, rocky, P, [], undefined, { plates: 10, cells: 1200 });
    const b = planetSurface(sys, rocky, P, [], undefined, { plates: 50, cells: 1200 });
    const a2 = planetSurface(sys, rocky, P, [], undefined, { plates: 10, cells: 1200 });
    expect(a).not.toBe(b);
    expect(a2).toBe(a);
  });

  it('卫星也有独立生成参数', () => {
    if (withMoon < 0) return;
    const wp = moonWorldParams(sys.design, withMoon, 0, P, undefined, { plates: 40, mountains: 3, cells: 1500, seed: 999 });
    expect(wp.plates).toBe(40);
    expect(wp.mountains).toBe(3);
    expect(wp.cells).toBe(1500);
    expect(wp.seed).toBe(999);
  });
});

describe('生成参数进存档(分层 + 兼容)', () => {
  const ov: SystemOverrides = {
    planets: [{ index: rocky, gen: { plates: 12, mountains: 2.5, cells: 3000, seed: 4242, mode: 'random' } }],
    moons: withMoon >= 0 ? [{ planet: withMoon, moon: 0, gen: { cells: 800, landFraction: 0.7 } }] : [],
  };
  it('分层存档往返不丢 gen', () => {
    const back = overridesOfLayers(layersOfOverrides(ov))!;
    expect(back.planets[0].gen).toEqual(ov.planets[0].gen);
    if (withMoon >= 0) expect(back.moons[0].gen).toEqual(ov.moons[0].gen);
  });
  it('存档写两份读回来一致(gen 被清洗并保留)', () => {
    const save = makeSave(P, EMPTY_EDITS, 'c', '生成参数', undefined, null, null, ov);
    const r = parseSave(saveText(save));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.save.system?.planets[0].gen).toEqual(ov.planets[0].gen);
      if (withMoon >= 0) expect(r.save.system?.moons[0].gen).toEqual(ov.moons[0].gen);
    }
  });
  it('越界的 gen 值被丢掉,不挡打开', () => {
    const bad = { planets: [{ index: rocky, gen: { plates: 9999, mountains: 99, cells: 5, seed: -1 } }], moons: [] } as unknown as SystemOverrides;
    const save = makeSave(P, EMPTY_EDITS, 'c', '坏值', undefined, null, null, bad);
    const r = parseSave(saveText(save));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const gen = r.save.system?.planets?.[0]?.gen;
      expect(gen?.plates).toBeUndefined();
      expect(gen?.cells).toBeUndefined();
      expect(gen?.seed).toBeUndefined();
    }
  });
});

describe('模板一键套用全部数据', () => {
  it('7 个模板都带生成参数与物理/生命', () => {
    expect(BODY_TEMPLATES.length).toBe(7);
    for (const t of BODY_TEMPLATES) {
      expect(t.gen.plates).toBeGreaterThanOrEqual(2);
      expect(t.physical.life).toBeGreaterThan(0);
    }
  });
  it('套用冰封模板:地表 + 板块/造山 + 生命一起写', () => {
    const r = applyBodyTemplate('ice')!;
    expect(r.surface.temperature).toBe(-32);
    expect(r.gen.plates).toBe(18);
    expect(r.gen.mountains).toBe(1.2);
    expect(r.physical.life).toBe(2);
    expect(bodyTemplateOf('ice')?.surface.label).toBe('冰封型');
  });
});
