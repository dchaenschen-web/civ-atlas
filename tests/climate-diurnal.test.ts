/**
 * S5 气候两项:潮汐锁定(自转慢)昼夜温差、气态巨星宜居卫星的辐射带剂量。
 * 关键约束:默认参数下两项都恰好 0(旧世界逐字节不变)。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/gen/params';
import { astroOf, climateModsOf, generateAstro } from '../src/gen/astro';
import { composeAtmosphere } from '../src/gen/astroDesign';
import { generateWorld } from '../src/gen/world';

describe('S5 气候:昼夜温差与辐射带剂量', () => {
  it('默认参数(24 小时自转、单星):昼夜温差与辐射带都是 0(基线不变)', () => {
    const sys = generateAstro({ ...DEFAULT_PARAMS, seed: 7, astro: 1 });
    expect(sys.home.dayHours).toBeCloseTo(24, 6);
    expect(climateModsOf(sys)!.diurnalK).toBe(0);
    expect(sys.home.radDose).toBe(0);
  });

  it('自转越慢昼夜温差越大:向阳经度比背阴经度暖,温差方向与量级对', () => {
    const p = { ...DEFAULT_PARAMS, seed: 9, cells: 2000, astro: 1, rotation: 200 };
    const w = generateWorld(p);
    const sys = astroOf(w)!;
    const mods = climateModsOf(sys)!;
    expect(mods.diurnalK).toBeGreaterThan(10);
    const mesh = w.mesh;
    let warm = 0;
    let nw = 0;
    let cold = 0;
    let nc = 0;
    for (let i = 0; i < mesh.n; i++) {
      const lon = (mesh.x[i] / mesh.width) * 360 - 180;
      if (Math.abs(lon) < 8) {
        warm += w.temperature[i];
        nw++;
      }
      if (Math.abs(lon) > 172) {
        cold += w.temperature[i];
        nc++;
      }
    }
    expect(nw).toBeGreaterThan(20);
    expect(nc).toBeGreaterThan(20);
    const diff = warm / nw - cold / nc;
    // 地形/海陆会拉低一点,但方向必须对、量级要接近 2×diurnalK
    expect(diff).toBeGreaterThan(mods.diurnalK * 1.2);
    expect(diff).toBeLessThan(mods.diurnalK * 2.8);
  });

  it('气态巨星的宜居卫星:有辐射带剂量(0 < dose ≤ 3)', () => {
    const sys = generateAstro({ ...DEFAULT_PARAMS, seed: 11, astro: 1, arch: 3, gas: 1 });
    expect(sys.design.habitableMoon).toBeTruthy();
    expect(sys.home.radDose).toBeGreaterThan(0);
    expect(sys.home.radDose).toBeLessThanOrEqual(3);
  });

  it('辐射带剂量越大,同样的大气被剥得越薄(压力和成分一起变)', () => {
    const base = { mass: 1, radius: 1, tempK: 288, geo: 0.5, magnetic: 0.8, hydro: false, biotic: false, star: generateAstro({ ...DEFAULT_PARAMS, seed: 7, astro: 1 }).design.star };
    const clean = composeAtmosphere({ ...base, radDose: 0 });
    const radiated = composeAtmosphere({ ...base, radDose: 2 });
    expect(radiated.pressure).toBeLessThan(clean.pressure);
    expect(radiated.greenhouseK).toBeLessThanOrEqual(clean.greenhouseK);
  });
});
