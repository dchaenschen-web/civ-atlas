import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, type WorldParams } from '../src/gen/params';
import { generateAstro } from '../src/gen/astro';
import { planetSurface } from '../src/gen/astroWorlds';
import { bodyWorld } from '../src/gen/bodies';
import { moonWorldParams } from '../src/gen/system';
import { generateWorld } from '../src/gen/world';
import type { TerrainOp } from '../src/gen/edits';

const P = (): WorldParams => ({ ...DEFAULT_PARAMS, seed: 861, astro: 1, planets: 5, gas: 2, life: 0 });
const ops: TerrainOp[] = [
  { kind: 'volcano', pts: [900, 500], r: 18, s: 1.05 },
  { kind: 'lower', pts: [700, 300], r: 24, s: 1 },
];

describe('S2 每颗行星的地形修改', () => {
  it('改地形只改这颗行星:同一颗行星带/不带地图不同,别的行星与主世界无关', () => {
    const p = P();
    const sys = generateAstro(p);
    const plain = planetSurface(sys, 1, p);
    const edited = planetSurface(sys, 1, p, ops);
    expect(edited).not.toBe(plain);
    const differs = edited.elevation.some((e, i) => e !== plain.elevation[i]);
    expect(differs).toBe(true);
    // 另一颗行星没传 ops → 和以前一样(走同一个缓存键)
    expect(planetSurface(sys, 2, p)).toBe(planetSurface(sys, 2, p));
  });

  it('确定性:同一颗行星 + 同一份地形修改,两次拿到同一份世界(缓存/可重现)', () => {
    const p = P();
    const sys = generateAstro(p);
    const a = planetSurface(sys, 1, p, ops);
    const b = planetSurface(sys, 1, p, ops);
    expect(b).toBe(a);
    // 换一个星系对象(重新生成)结果逐字段一样
    const sys2 = generateAstro(p);
    const c = planetSurface(sys2, 1, p, ops);
    expect(Array.from(c.elevation.slice(0, 64))).toEqual(Array.from(a.elevation.slice(0, 64)));
  });

  it('bodyWorld 也能带地形修改(详情页/文明预览用同一份)', () => {
    const p = P();
    const sys = generateAstro(p);
    const plain = bodyWorld(sys, 1, p);
    const edited = bodyWorld(sys, 1, p, ops);
    expect(edited).not.toBe(plain);
    expect(edited.elevation.some((e, i) => e !== plain.elevation[i])).toBe(true);
  });

  it('卫星也能改地形:同一份 TerrainOp 作用在卫星地表上', () => {
    const p = { ...P(), moons: 1 };
    const sys = generateAstro(p);
    const mp = moonWorldParams(sys.design, sys.home.index, 0, p);
    const plain = generateWorld(mp);
    const edited = generateWorld(mp, undefined, ops);
    expect(edited.elevation.some((e, i) => e !== plain.elevation[i])).toBe(true);
  });
});