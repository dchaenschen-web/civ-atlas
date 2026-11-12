import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, type WorldParams } from '../src/gen/params';
import { generateAstro } from '../src/gen/astro';
import { planetSurface, planetWorldParams } from '../src/gen/astroWorlds';
import { moonSurface, moonWorldParams, systemOf } from '../src/gen/system';
import { generateWorld } from '../src/gen/world';
import type { SystemOverrides } from '../src/gen/astroDesign';

const P = (o: Partial<WorldParams> = {}): WorldParams => ({ ...DEFAULT_PARAMS, seed: 861, astro: 1, planets: 5, gas: 2, life: 0, ...o });

describe('S2 每颗天体的地表参数(覆盖表)', () => {
  it('行星:陆地比例/气温/降水/精细度按覆盖表生效', () => {
    const p = P();
    const sys = generateAstro(p);
    const surf = { landFraction: 0.62, temperature: 12, rainfall: 0.4, cells: 30000 };
    const wp = planetWorldParams(sys, 1, p, surf);
    expect(wp.landFraction).toBeCloseTo(0.62, 6);
    expect(wp.temperature).toBe(12);
    expect(wp.rainfall).toBeCloseTo(0.4, 6);
    expect(wp.cells).toBe(30000);
    // 不写覆盖 = 按相态派生(不是同一个值)
    const auto = planetWorldParams(sys, 1, p);
    expect(auto.landFraction).not.toBeCloseTo(0.62, 6);
  });

  it('行星:同一个星系 + 同一份地表参数 → 同一份世界(缓存键带上地表参数)', () => {
    const p = P();
    const sys = generateAstro(p);
    const surf = { landFraction: 0.7, cells: 20000 };
    const a = planetSurface(sys, 1, p, [], surf);
    const b = planetSurface(sys, 1, p, [], surf);
    expect(b).toBe(a);
    const c = planetSurface(sys, 1, p, [], { ...surf, landFraction: 0.3 });
    expect(c).not.toBe(a);
  });

  it('卫星:地表参数覆盖生效', () => {
    const p = P({ moons: 1 });
    const sys = generateAstro(p);
    const surf = { landFraction: 0.5, temperature: 5, rainfall: 1.2, cells: 6000 };
    const mp = moonWorldParams(sys.design, sys.home.index, 0, p, surf);
    expect(mp.landFraction).toBeCloseTo(0.5, 6);
    expect(mp.temperature).toBe(5);
    expect(mp.rainfall).toBeCloseTo(1.2, 6);
    expect(mp.cells).toBe(6000);
  });

  it('存档:覆盖表里的地表参数读回来不差,坏值被丢掉', async () => {
    const { makeSave, parseSave, saveText } = await import('../src/gen/savefile');
    const { EMPTY_EDITS } = await import('../src/gen/edits');
    const sys: SystemOverrides = {
      planets: [{ index: 0, surface: { landFraction: 0.42, temperature: -12, rainfall: 2.5, cells: 36000 } }],
      moons: [{ planet: 0, moon: 0, surface: { landFraction: 0.9 } }],
    };
    const save = makeSave(P(), EMPTY_EDITS, 'c', '地表', undefined, null, null, sys);
    const r = parseSave(saveText(save));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.save.system).toEqual(sys);
    // 坏值
    const raw = JSON.parse(saveText(makeSave(P(), EMPTY_EDITS, 'c'))) as Record<string, unknown>;
    raw.system = { planets: [{ index: 0, surface: { landFraction: 9, temperature: -999, rainfall: 2, cells: 1.5 } }], moons: [] };
    const r2 = parseSave(JSON.stringify(raw));
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.save.system?.planets).toEqual([{ index: 0, surface: { rainfall: 2 } }]);
  });
});
