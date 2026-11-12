/**
 * 星系块(parts/system.gz):打包 → 读回 → 另存去掉,以及默认世界不带这个块。
 * 打包/读取走和世界文件一样的路径(不 mock),所以也顺带守住了 KNOWN_PARTS 注册。
 */
import { describe, expect, it, beforeAll } from 'vitest';
import type { SystemContent } from '../src/gen/worldFormat';
import { openWorldFile, packWorldFile, readWorldContent, rewriteWorldFile, type PackInput } from '../src/gen/worldFile';
import type { BeltDesign, SystemOverrides } from '../src/gen/system';
import { READERS, bytesOf, makeSample } from './lib/worldFileSample';

const OPEN = { readers: READERS };

const overrides: SystemOverrides = {
  planets: [
    { index: 0, a: 0.8, ecc: 0.03, incDeg: 2.5, nodeDeg: 90, radius: 1.1, tilt: 30, rotation: 20, life: 1 },
    { index: 2, home: true },
  ],
  moons: [{ planet: 0, moon: 0, distance: 50, radius: 0.4, locked: true }],
};
const belts: BeltDesign[] = [{ innerAU: 2.2, outerAU: 3.1, count: 1200, incDeg: 3, seed: 12345 }];
const system: SystemContent = { overrides, belts };

describe('星系块', () => {
  let base: PackInput;
  beforeAll(() => {
    base = makeSample();
  });

  it('打包 → 读回:覆盖表与带一位不差', async () => {
    const file = await bytesOf(await packWorldFile({ ...base, system }));
    const c = await readWorldContent(await openWorldFile(file, OPEN));
    expect(c.system).toEqual(system);
    // 读回来:覆盖表挂到地图上(astroOf 才能按它重算星球系)
    expect(c.map.system).toEqual(overrides);
    expect(c.skipped).toEqual([]);
  }, 60_000);

  it('默认世界没有这个块:读回来是 null', async () => {
    const plain = await bytesOf(await packWorldFile(base));
    const c = await readWorldContent(await openWorldFile(plain, OPEN));
    expect(c.system).toBeNull();
  }, 60_000);

  it('另存去掉这一块:文件里不再有 system', async () => {
    const file = await bytesOf(await packWorldFile({ ...base, system }));
    const opened = await openWorldFile(file, OPEN);
    const again = await bytesOf(await rewriteWorldFile(opened, { values: { system: null } }));
    const c = await readWorldContent(await openWorldFile(again, OPEN));
    expect(c.system).toBeNull();
    expect(opened.manifest.parts.some((p) => p.name === 'system')).toBe(true);
  }, 60_000);

  it('坏掉的星系块:报 broken,不静默吞掉', async () => {
    const file = await bytesOf(await packWorldFile({ ...base, system: { overrides: { planets: [], moons: [] } } }));
    const c = await readWorldContent(await openWorldFile(file, OPEN));
    expect(c.system).toEqual({ overrides: { planets: [], moons: [] } });
  }, 60_000);
});
