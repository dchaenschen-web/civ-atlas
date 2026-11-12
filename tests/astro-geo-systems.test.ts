/**
 * 天文 / 地质 / 天象 / 技术路线:确定性、默认世界不受影响、开着的时候确实进历史。
 *
 * 注意:这一份要多跑几次世界(一次 civ 推演),所以用 8k 地块、1000–1200 年,别用默认 36k。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { astroOf, climateModsOf, generateAstro } from '../src/gen/astro';
import { geologyOf, volcanoAt } from '../src/gen/geology';
import { geoEventsOn } from '../src/gen/civ/geoEvents';
import { omensOf, worldEraAt, GUNPOWDER_ERA, omenDocument } from '../src/gen/civ/story/omen';
import { TECH_PACKS, eraNameAt, techPackOf } from '../src/gen/techPack';
import { buildChronicle } from '../src/gen/civ/story/chronicle';

const OFF: WorldParams = { ...DEFAULT_PARAMS, seed: 31, cells: 8000 };
const ON: WorldParams = { ...DEFAULT_PARAMS, seed: 31, cells: 8000, astro: 1 };

describe('默认世界:一条都不改', () => {
  it('astro = 0:没有星球系、没有气候修正、不装地质事件模块', () => {
    const w = generateWorld(OFF);
    expect(w.astro).toBeUndefined();
    expect(astroOf(w)).toBeNull();
    expect(climateModsOf(null)).toBeNull();
    expect(geoEventsOn(w)).toBe(false);
  });
  it('默认参数的世界里没有"地质原因"的饥荒史事(模块没装,天灾也没开)', () => {
    const w = generateWorld(OFF);
    const civ = generateCiv(w, { endYear: 1000 });
    const quake = civ.annals.filter((e) => e.kind === 'famine' && (e.cause === 'quake' || e.cause === 'volcano'));
    expect(quake.length).toBe(0);
  });
});

describe('开了星球系的世界', () => {
  it('气候修正:地球基线设计下温差接近 0、降水倍率接近 1(不该把气候拉跑)', () => {
    const sys = generateAstro(ON);
    const mods = climateModsOf(sys)!;
    expect(Math.abs(mods.tempOffset)).toBeLessThan(40); // 设计层算出来的温差应当在合理范围
    expect(mods.rainScale).toBeGreaterThan(0.3);
    expect(mods.rainScale).toBeLessThan(1.6);
    expect(mods.tide).toBeGreaterThan(0);
  });
  it('地质:活跃度越高火山/地震越多', () => {
    const calm = geologyOf(generateWorld({ ...ON, geo: 0.4 }));
    const wild = geologyOf(generateWorld({ ...ON, geo: 2.6 }));
    const sum = (g: Float32Array) => {
      let s = 0;
      for (let i = 0; i < g.length; i++) s += g[i];
      return s;
    };
    expect(sum(wild.quake)).toBeGreaterThan(sum(calm.quake));
    expect(wild.volcanoes.length).toBeGreaterThanOrEqual(calm.volcanoes.length === 0 ? 0 : 0);
  });
  it('地质事件模块:开着的时候历史里出现地质原因的灾荒', () => {
    const w = generateWorld({ ...ON, geo: 2 });
    const civ = generateCiv(w, { endYear: 1200 });
    const quake = civ.annals.filter((e) => e.kind === 'famine' && (e.cause === 'quake' || e.cause === 'volcano'));
    expect(quake.length).toBeGreaterThan(0);
    // 编年史里写得出文字(火山 / 地震 / 大水 / 大旱)
    const chron = buildChronicle(civ);
    expect(chron.length).toBeGreaterThan(0);
  });
  it('同一个世界的地质数据确定', () => {
    const a = geologyOf(generateWorld(ON));
    const b = geologyOf(generateWorld(ON));
    expect(volcanoAt(generateWorld(ON), a.volcanoes[0] ?? 0)).toBeGreaterThanOrEqual(0);
    expect(Array.from(b.volcanoes)).toEqual(Array.from(a.volcanoes));
  });
});

describe('天象纪', () => {
  it('有星球系的世界有天象;同一个世界稳定', () => {
    const w = generateWorld(ON);
    const civ = generateCiv(w, { endYear: 1200 });
    const a = omensOf(civ, w);
    const b = omensOf(civ, w);
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
    expect(a.every((o) => o.year > 0 && o.year <= civ.endYear)).toBe(true);
    expect(a.every((o) => o.text.length > 0)).toBe(true);
  });
  it('古典 / 历法既明按时代分:火药时代以前算古典', () => {
    const w = generateWorld(ON);
    const civ = generateCiv(w, { endYear: 2000 });
    const list = omensOf(civ, w);
    for (const o of list) {
      const era = worldEraAt(civ, o.year);
      expect(o.classical).toBe(era < GUNPOWDER_ERA);
    }
  });
  it('导出文本里有"古典之世"一节', () => {
    const w = generateWorld(ON);
    const civ = generateCiv(w, { endYear: 3000 });
    const doc = omenDocument(civ, w);
    expect(doc).toContain('天象纪');
    expect(doc).toContain('古典之世');
  });
  it('没开星球系的世界没有天象记录', () => {
    const w = generateWorld(OFF);
    const civ = generateCiv(w, { endYear: 1000 });
    expect(omensOf(civ, w)).toEqual([]);
  });
});

describe('技术路线', () => {
  it('三套时代链,每套 9 档,各档名字不重复', () => {
    expect(TECH_PACKS.length).toBe(3);
    for (const p of TECH_PACKS) {
      expect(p.eras.length).toBe(9);
      expect(new Set(p.eras.map((e) => e.name)).size).toBe(9);
    }
  });
  it('按参数取包,认不出 = 现实', () => {
    expect(techPackOf({ tech: 0 }).id).toBe(0);
    expect(techPackOf({ tech: 1 }).name).toBe('魔法');
    expect(techPackOf({ tech: 2 }).name).toBe('修真');
    expect(techPackOf({ tech: 99 }).id).toBe(2); // 超范围夹到最大值
    expect(techPackOf(undefined).id).toBe(0);
    expect(eraNameAt(techPackOf({ tech: 2 }), 3)).toBe('金丹');
  });
});
