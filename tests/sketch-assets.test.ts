import { describe, expect, it } from 'vitest';
import { makeSketchAssetPack, openSketchAssetPack, validateSketchAsset } from '../src/gen/sketchAssets';

describe('sketch asset constraints and packs', () => {
  it('rejects dimensions and bytes over S4 limits', () => {
    expect(() => validateSketchAsset({ size: 10, width: 1025, height: 1 })).toThrow(/1024/);
    expect(() => validateSketchAsset({ size: 1_500_001, width: 1, height: 1 })).toThrow(/1.5/);
  });
  it('round trips an independent asset pack without changing bytes', async () => {
    const bytes = new Uint8Array([1, 2, 3, 255]);
    const pack = await makeSketchAssetPack([{ worldId: 'w', bodyId: 'b', name: 'map.png', width: 2, height: 2, type: 'image/png', bytes }]);
    const assets = await openSketchAssetPack(pack);
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({ worldId: 'w', bodyId: 'b', width: 2, height: 2, name: 'map.png' });
    expect([...assets[0].bytes]).toEqual([...bytes]);
  });
});
