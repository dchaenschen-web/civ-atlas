import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/gen/params';
import { generateAstro } from '../src/gen/astro';
import { EMPTY_EDITS } from '../src/gen/edits';
import { makeSave, parseSave, saveText } from '../src/gen/savefile';
import { systemSpecOf } from '../src/gen/systemSpec';
import { layersOfOverrides, overridesOfLayers } from '../src/gen/systemLayers';
import { celestialEventsOf, nextCelestialEvent, supernovaImpact } from '../src/gen/astroEvents';
import { hohmannTransfer, interstellarTravelEstimate, transferWindowYears } from '../src/gen/interstellar';
import type { SystemOverrides } from '../src/gen/astroDesign';

const P = { ...DEFAULT_PARAMS, seed: 4321, astro: 1, planets: 5, gas: 2, moons: 1 };
const base = generateAstro(P);
const rockyIdx = base.design.planets.findIndex((p) => p.kind === 'rocky');

describe('星体质量可改', () => {
  it('行星质量覆盖生效,影响半径推导出来的质量', () => {
    const ov: SystemOverrides = { planets: [{ index: rockyIdx, mass: 2.5 }], moons: [] };
    const d = generateAstro(P, ov).design;
    expect(d.planets[rockyIdx].mass).toBe(2.5);
    expect(base.design.planets[rockyIdx].mass).not.toBe(2.5);
  });

  it('卫星质量覆盖生效(和卫星数一起用)', () => {
    const ov: SystemOverrides = { planets: [{ index: rockyIdx, moonCount: 2 }], moons: [{ planet: rockyIdx, moon: 0, mass: 0.05 }] };
    const d = generateAstro(P, ov).design;
    expect(d.planets[rockyIdx].moons.length).toBe(2);
    expect(d.planets[rockyIdx].moons[0].mass).toBe(0.05);
  });

  it('恒星质量覆盖 → 光度/温度/主行星日照跟着重算', () => {
    const ov: SystemOverrides = { planets: [], moons: [], star: { mass: 2 } };
    const sys = generateAstro(P, ov);
    expect(sys.design.star.mass).toBe(2);
    expect(sys.design.star.lum).toBeGreaterThan(base.design.star.lum);
    expect(sys.home.insolation).not.toBe(base.home.insolation);
  });
});

describe('SystemSpec 递归树 / 周期', () => {
  const spec = systemSpecOf(base, P, null);
  it('树根是恒星,行星挂在下面,卫星再挂在行星下面', () => {
    expect(spec.tree.kind).toBe('star');
    expect(spec.tree.children.length).toBe(base.design.planets.length);
    expect(spec.tree.children[0].kind).toBe('planet');
    const withMoon = spec.tree.children.find((c) => c.children.length > 0);
    if (withMoon) {
      expect(withMoon.children[0].kind).toBe('moon');
      expect(withMoon.children[0].orbit?.periodDays).toBeGreaterThan(0);
    }
    expect(spec.tree.children[0].orbit?.periodDays).toBeGreaterThan(0);
  });

  it('周期覆盖生效(行星/卫星)', () => {
    const ov: SystemOverrides = {
      planets: [{ index: rockyIdx, periodDays: 500, moonCount: 1 }],
      moons: [{ planet: rockyIdx, moon: 0, periodDays: 9 }],
    };
    const sys2 = generateAstro(P, ov);
    const spec2 = systemSpecOf(sys2, P, ov);
    expect(spec2.planets[rockyIdx].orbit.periodDays).toBe(500);
    expect(spec2.planets[rockyIdx].moons[0].periodDays).toBe(9);
    expect(spec2.tree.children[rockyIdx].children[0].orbit?.periodDays).toBe(9);
  });
});

describe('质量/周期进存档(分层 + 兼容)', () => {
  const ov: SystemOverrides = {
    planets: [{ index: rockyIdx, mass: 1.7, periodDays: 300 }],
    moons: [{ planet: rockyIdx, moon: 0, mass: 0.03, periodDays: 12 }],
    star: { mass: 1.4, companionMass: 0.9 },
  };
  it('分层存档往返不丢 mass/periodDays/star', () => {
    expect(overridesOfLayers(layersOfOverrides(ov))).toEqual(ov);
  });
  it('存档写两份读回来一致', () => {
    const save = makeSave(P, EMPTY_EDITS, 'c', '质量', undefined, null, null, ov);
    const r = parseSave(saveText(save));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.save.system).toEqual(ov);
  });
  it('默认世界不写星系覆盖(逐字节兼容)', () => {
    const raw = JSON.parse(saveText(makeSave({ ...DEFAULT_PARAMS }, EMPTY_EDITS, 'c'))) as Record<string, unknown>;
    expect('system' in raw).toBe(false);
    expect('systemSpec' in raw).toBe(false);
  });
});

describe('航行接口(只留接口)', () => {
  it('行星际霍曼转移:地球→木星约 2.7 年,窗口约 1.09 年', () => {
    const t = hohmannTransfer(1, 5.2, 1);
    expect(t.days / 365.25).toBeGreaterThan(2.4);
    expect(t.days / 365.25).toBeLessThan(3.0);
    expect(t.dvKms).toBeGreaterThan(5);
    expect(t.dvKms).toBeLessThan(20);
    const w = transferWindowYears(1, 5.2, 1);
    expect(w).toBeGreaterThan(1.0);
    expect(w).toBeLessThan(1.2);
  });
  it('恒星际未开放:返回 null 和原因', () => {
    const e = interstellarTravelEstimate(12, 5);
    expect(e.days).toBeNull();
    expect(e.reason).toMatch(/未开放/);
  });
});

describe('天象事件接口(空实现)', () => {
  it('事件流为空、下一个事件为 null、超新星影响未实现', () => {
    expect(celestialEventsOf({})).toEqual([]);
    expect(nextCelestialEvent({}, 100)).toBeNull();
    expect(supernovaImpact(20, 15)).toBeNull();
  });
});
