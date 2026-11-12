import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/gen/params';
import { EMPTY_EDITS } from '../src/gen/edits';
import { makeSave, parseSave, saveText } from '../src/gen/savefile';
import type { SystemOverrides } from '../src/gen/astroDesign';
import { layersOfOverrides, overridesOfLayers } from '../src/gen/systemLayers';

const SYS: SystemOverrides = {
  planets: [
    { index: 0, a: 0.8, ecc: 0.03, incDeg: 2.5, nodeDeg: 90, radius: 1.1, tilt: 30, rotation: 20, life: 1, reroll: 7, surface: { landFraction: 0.42, temperature: -12 }, terrain: [{ kind: 'volcano', pts: [812, 403], r: 28, s: 1.05 }] },
    { index: 2, home: true },
  ],
  moons: [{ planet: 0, moon: 0, distance: 50, radius: 0.4, locked: true, surface: { landFraction: 0.9 }, terrain: [{ kind: 'lake', pts: [300, 400], r: 16, s: 1 }] }],
};
const P = { ...DEFAULT_PARAMS, seed: 9 };

describe('星系分层存档(systemSpec)', () => {
  it('覆盖表 → 分层 → 覆盖表:往返不丢字段', () => {
    const layers = layersOfOverrides(SYS);
    expect(layers.v).toBe(1);
    const back = overridesOfLayers(layers)!;
    expect(back).toEqual(SYS);
  });

  it('存档写两份(覆盖表 + 分层),读回来以分层为准且逐字段一致', () => {
    const save = makeSave(P, EMPTY_EDITS, 'c', '星系', undefined, null, null, SYS);
    expect(save.systemSpec?.v).toBe(1);
    const r = parseSave(saveText(save));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.save.system).toEqual(SYS);
    expect(r.save.systemSpec).toEqual(layersOfOverrides(SYS));
  });

  it('默认世界:两份都不写(存档逐字节不变)', () => {
    const raw = JSON.parse(saveText(makeSave(P, EMPTY_EDITS, 'c'))) as Record<string, unknown>;
    expect('system' in raw).toBe(false);
    expect('systemSpec' in raw).toBe(false);
  });

  it('老存档只有 system、没有 systemSpec:照旧能读', () => {
    const raw = JSON.parse(saveText(makeSave(P, EMPTY_EDITS, 'c', '星系', undefined, null, null, SYS))) as Record<string, unknown>;
    delete raw.systemSpec;
    const r = parseSave(JSON.stringify(raw));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.save.system).toEqual(SYS);
  });

  it('systemSpec 坏了回落到 system;两份都坏就提示并按种子重建', () => {
    const raw = JSON.parse(saveText(makeSave(P, EMPTY_EDITS, 'c', '星系', undefined, null, null, SYS))) as Record<string, unknown>;
    raw.systemSpec = { v: 1, planets: '坏', moons: [] };
    const r = parseSave(JSON.stringify(raw));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.save.system).toEqual(SYS);

    const raw2 = JSON.parse(saveText(makeSave(P, EMPTY_EDITS, 'c', '星系', undefined, null, null, SYS))) as Record<string, unknown>;
    raw2.systemSpec = { nope: true };
    delete raw2.system;
    const r2 = parseSave(JSON.stringify(raw2));
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.save.system).toBeUndefined();
      expect(r2.warnings.join('')).toMatch(/星系结构读不懂/);
    }
  });
});
