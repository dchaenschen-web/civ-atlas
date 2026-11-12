import { describe, expect, it } from 'vitest';
import { keplerEccentricAnomaly, moonPeriodDaysOf, periodDaysOf, positionAtAU } from '../src/gen/orbitTime';
import { NEIGHBOR_COUNT, NEIGHBOR_MAX_LY, nearbyStarsOf, nearbyWithin } from '../src/gen/neighbors';
import { SURFACE_TEMPLATES, applySurfaceTemplate, surfaceTemplateOf, templateFits } from '../src/gen/surfaceTemplates';

describe('轨道时间模型', () => {
  it('开普勒第三定律:地球 365.25 天,木星约 4331 天', () => {
    expect(periodDaysOf(1, 1)).toBeCloseTo(365.25, 1);
    expect(periodDaysOf(5.2, 1)).toBeGreaterThan(4200);
    expect(periodDaysOf(5.2, 1)).toBeLessThan(4450);
  });

  it('月球周期约 27 天(60.3 R⊕,母星 1 R⊕/1 M⊕)', () => {
    const p = moonPeriodDaysOf(60.3, 1, 1);
    expect(p).toBeGreaterThan(26);
    expect(p).toBeLessThan(29);
  });

  it('任意年份的位置是确定性的,半周期后到对面', () => {
    const o = { a: 1, ecc: 0, phase0: 0, incDeg: 0, nodeDeg: 0 };
    const y0 = positionAtAU(o, 0);
    const half = positionAtAU(o, 0.5);
    const full = positionAtAU(o, 1);
    expect(y0.x).toBeCloseTo(1, 6);
    expect(half.x).toBeCloseTo(-1, 3);
    expect(full.x).toBeCloseTo(1, 3);
    expect(positionAtAU(o, 12).x).toBeCloseTo(positionAtAU(o, 12).x, 12);
  });

  it('开普勒方程在 e=0 时 E=M', () => {
    expect(keplerEccentricAnomaly(1.2, 0)).toBeCloseTo(1.2, 6);
  });
});

describe('100 光年邻近恒星', () => {
  it('确定性:同种子两次完全一样,颗数固定', () => {
    const a = nearbyStarsOf(12345);
    const b = nearbyStarsOf(12345);
    expect(a.length).toBe(NEIGHBOR_COUNT);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(nearbyStarsOf(12346))).not.toBe(JSON.stringify(a));
  });

  it('距离 3–100 ly,方向是单位向量,坐标 = 方向 × 距离', () => {
    for (const s of nearbyStarsOf(777)) {
      expect(s.distanceLy).toBeGreaterThanOrEqual(3);
      expect(s.distanceLy).toBeLessThanOrEqual(NEIGHBOR_MAX_LY);
      const len = Math.hypot(...s.dir);
      expect(len).toBeCloseTo(1, 6);
      expect(s.xyz[0]).toBeCloseTo(s.dir[0] * s.distanceLy, 6);
      expect(s.xyz[1]).toBeCloseTo(s.dir[1] * s.distanceLy, 6);
      expect(s.xyz[2]).toBeCloseTo(s.dir[2] * s.distanceLy, 6);
      expect(s.mass).toBeGreaterThan(0);
      expect(s.tempK).toBeGreaterThan(2000);
      expect(s.lum).toBeGreaterThan(0);
    }
  });

  it('按距离筛选取最近的,升序', () => {
    const near = nearbyWithin(777, 40);
    expect(near.every((s) => s.distanceLy <= 40)).toBe(true);
    for (let i = 1; i < near.length; i++) expect(near[i].distanceLy).toBeGreaterThanOrEqual(near[i - 1].distanceLy);
  });
});

describe('地表模板(含无大气)', () => {
  it('7 个模板,含无大气;每个都给了地表参数和物质状态说明', () => {
    expect(SURFACE_TEMPLATES.length).toBe(7);
    expect(surfaceTemplateOf('airless')?.label).toBe('无大气型');
    for (const t of SURFACE_TEMPLATES) {
      expect(t.surface.landFraction).toBeGreaterThan(0);
      expect(t.materialNote.length).toBeGreaterThan(4);
    }
  });

  it('套用模板只覆盖模板给的值,没给的保持', () => {
    const base = { landFraction: 0.5, temperature: 3, rainfall: 2, cells: 12000 };
    const s = applySurfaceTemplate(base, 'airless');
    expect(s.landFraction).toBe(1);
    expect(s.rainfall).toBe(0);
    expect(s.temperature).toBe(-20);
    expect(s.cells).toBe(24000);
  });

  it('按天体实际温度/气压判断相容(物质状态)', () => {
    expect(templateFits('earth', 288, 1).fits).toBe(true);
    const iceOnHot = templateFits('ice', 288, 1);
    expect(iceOnHot.fits).toBe(false);
    expect(iceOnHot.phases.water).toBe('liquid');
    const oceanNoAir = templateFits('ocean', 288, 0.001);
    expect(oceanNoAir.fits).toBe(false);
    expect(templateFits('airless', 200, 0.001).fits).toBe(true);
    expect(templateFits('volcanic', 700, 1).fits).toBe(true);
  });
});
