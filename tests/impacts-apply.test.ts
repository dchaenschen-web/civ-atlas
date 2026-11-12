import { describe, expect, it } from 'vitest';
import { cratersToOps } from '../src/gen/impacts';

const c = (lon: number, lat: number, radiusKm: number, depthM: number) => ({ year: 100, lon, lat, radiusKm, depthM, region: 0 });

describe('S5 陨击结算 → 地形修改', () => {
  it('坑换成「压低地形」:经度→x、纬度→y,半径和强度夹在范围内', () => {
    const ops = cratersToOps([c(0, 0, 80, 300)]);
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('lower');
    expect(ops[0].pts[0]).toBeCloseTo(1024, 5);
    expect(ops[0].pts[1]).toBeCloseTo(512, 5);
    expect(ops[0].r).toBeGreaterThanOrEqual(3);
    expect(ops[0].r).toBeLessThanOrEqual(160);
    expect(ops[0].s).toBeCloseTo(1, 5);
  });

  it('极小/极大的坑都夹在编辑器的允许范围里', () => {
    const [small] = cratersToOps([c(-180, 90, 1, 10)]);
    expect(small.r).toBe(3);
    expect(small.s).toBeCloseTo(0.2, 5);
    expect(small.pts[0]).toBeCloseTo(0, 5);
    expect(small.pts[1]).toBeCloseTo(0, 5);
    const [big] = cratersToOps([c(180, -90, 5000, 9000)]);
    expect(big.r).toBe(160);
    expect(big.s).toBe(2);
    expect(big.pts[0]).toBeCloseTo(2048, 5);
    expect(big.pts[1]).toBeCloseTo(1024, 5);
  });

  it('确定性:同样的坑两次换出来一样', () => {
    const list = [c(12, -30, 70, 250), c(-95, 47, 120, 600)];
    expect(JSON.stringify(cratersToOps(list))).toBe(JSON.stringify(cratersToOps(list)));
  });
});
