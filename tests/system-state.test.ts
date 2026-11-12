/**
 * 当前星系的覆盖表(systemState):存档/造档发布、请求带上、空表复位。
 * 这是"生成/重推请求怎么知道这颗行星系的结构"的胶水层。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { DEFAULT_PARAMS } from '../src/gen/params';
import { makeSave, parseSave, saveText } from '../src/gen/savefile';
import { EMPTY_EDITS } from '../src/gen/edits';
import { currentSystem, setCurrentSystem, systemEmpty, systemOpt } from '../src/gen/systemState';
import type { SystemOverrides } from '../src/gen/astroDesign';

const sys: SystemOverrides = {
  planets: [{ index: 0, a: 0.8, tilt: 40, life: 1 }],
  moons: [{ planet: 0, moon: 0, distance: 50, locked: true }],
};

describe('当前星系的覆盖表', () => {
  beforeEach(() => setCurrentSystem(null));

  it('默认没有覆盖表,请求里不带 system 字段', () => {
    expect(currentSystem()).toBeNull();
    expect(systemOpt()).toEqual({});
    expect(systemEmpty(null)).toBe(true);
    expect(systemEmpty({ planets: [], moons: [] })).toBe(true);
  });

  it('造档/读档都发布覆盖表,读空档复位', () => {
    makeSave({ ...DEFAULT_PARAMS, seed: 9 }, EMPTY_EDITS, 'c', '星系', undefined, null, null, sys);
    expect(currentSystem()).toEqual(expect.objectContaining({ planets: expect.any(Array) }));
    expect(systemOpt().system?.planets[0].a).toBeCloseTo(0.8, 12);
    const plainSave = makeSave({ ...DEFAULT_PARAMS, seed: 9 }, EMPTY_EDITS, 'c');
    // 顶层的 system 字段不写(params 里本来就有个叫 system 的参数,别用子串判断)
    expect('system' in (JSON.parse(saveText(plainSave)) as Record<string, unknown>)).toBe(false);
    const plain = saveText(plainSave);
    parseSave(plain);
    expect(currentSystem()).toBeNull();
    expect(systemOpt()).toEqual({});
  });

  it('手工设置也能复位(空表 = 单行星世界)', () => {
    setCurrentSystem(sys);
    expect(systemOpt().system?.moons).toHaveLength(1);
    setCurrentSystem({ planets: [], moons: [] });
    expect(currentSystem()).toBeNull();
  });
});
