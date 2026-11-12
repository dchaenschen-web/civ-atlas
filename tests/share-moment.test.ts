/**
 * 分享链接里的"打开时看哪"(gen/savefile.ts 的 moment):种子 7、2024 第 1500 年 + 选中一国 + 镜头 → 链接 → 读回来逐字段相等、
 * 对到生成好的历史上就是那一国;旧链接(没有这个字段)读出来和以前一样;坏字段(年份超出、国家不存在、不是数)安全忽略。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { ownersAt } from '../src/gen/civ/engine/timeline';
import { polityKey, regionKey, type WorldEdits } from '../src/gen/edits';
import {
  CAMERA_ZOOM_RANGE,
  cleanCamera,
  cleanMoment,
  decodeMomentHash,
  decodeShare,
  encodeShare,
  hasShareData,
  isMomentHash,
  makeSave,
  momentHash,
  momentYearMax,
  parseSave,
  resolveMoment,
  saveText,
  versionNote,
  withMoment,
  worldCheck,
  type SaveMoment,
} from '../src/gen/savefile';

const EMPTY: WorldEdits = { names: {}, interventions: [], terrain: [] };

/** 第 year 年州数最多的国家 */
function biggestAt(civ: ReturnType<typeof generateCiv>, year: number): number {
  const o = ownersAt(civ, year);
  const n = new Map<number, number>();
  for (let r = 0; r < civ.regions.count; r++) if (o.polity[r] >= 0) n.set(o.polity[r], (n.get(o.polity[r]) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0][0];
}

describe('打开时看哪:编码 → 解码', () => {
  for (const seed of [7, 2024]) {
    it(`种子 ${seed}:第 1500 年 + 选中一国 + 镜头,读回来逐字段相等,对到历史上就是那一国`, async () => {
      const params: WorldParams = { ...DEFAULT_PARAMS, seed };
      const world = generateWorld(params);
      const civ = generateCiv(world);
      const id = biggestAt(civ, 1500);
      const key = polityKey(civ, id);
      expect(key).toMatch(/^polity:c\d+#\d+$/);
      const moment: SaveMoment = { year: 1500, selected: key, camera: { lon: 112.4, lat: 31.25, zoom: 2.5 } };
      const save = makeSave(params, EMPTY, worldCheck(world), '', '2026-10-21T08:00:00.000Z', { projection: 'robinson', center: 120 });
      // 没改过的世界本来出普通网址;带上这一刻就出带数据的链接
      expect(hasShareData(save)).toBe(false);
      const shared = withMoment(save, moment);
      expect(hasShareData(shared)).toBe(true);
      expect(save.moment).toBeUndefined();

      const r = await decodeShare(await encodeShare(shared));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.warnings).toEqual([]);
      expect(r.save.moment).toEqual(moment);
      expect(r.save.moment!.year).toBe(1500);
      expect(r.save.moment!.selected).toBe(key);
      expect(r.save.moment!.camera).toEqual({ lon: 112.4, lat: 31.25, zoom: 2.5 });
      // 世界本身(种子、参数、修改、投影)一点不变
      const { moment: _m, ...rest } = r.save;
      expect(rest).toEqual(save);

      // 对到生成好的历史上:年份、选中的就是那一国、镜头原样
      expect(resolveMoment(civ, r.save.moment)).toEqual({ year: 1500, selected: { kind: 'polity', id }, camera: moment.camera });
      // 州也能选
      const region = civ.regions.seat.length > 10 ? 10 : 0;
      const rk = regionKey(civ, region);
      const r2 = await decodeShare(await encodeShare(withMoment(save, { selected: rk })));
      expect(r2.ok && resolveMoment(civ, r2.save.moment)).toEqual({ selected: { kind: 'region', id: region } });
    }, 60_000);
  }

  it('年中、经度跨过 180°、放大超出范围:清理成同一个样子,再清理一次不变', () => {
    const m = cleanMoment({ year: 1500.4375, selected: 'region:c8123', camera: { lon: 190, lat: 95, zoom: 100 } }, 3000)!;
    expect(m).toEqual({ year: 1500.438, selected: 'region:c8123', camera: { lon: -170, lat: 90, zoom: CAMERA_ZOOM_RANGE[1] } });
    expect(cleanMoment(m, 3000)).toEqual(m);
    expect(cleanCamera({ lon: 180, lat: 0, zoom: 1 })).toEqual({ lon: -180, lat: 0, zoom: 1 });
    expect(cleanCamera({ lon: -540.0004, lat: -12.3456, zoom: 0.1 })).toEqual({ lon: 180 - 360, lat: -12.346, zoom: CAMERA_ZOOM_RANGE[0] });
    for (const lon of [112.4, -179.999, 0, 179.999, 33.333]) expect(cleanCamera({ lon, lat: 1, zoom: 2 })!.lon).toBe(lon);
  });

  it('withMoment:null 或一样都不剩 = 去掉;不改原来的存档;自动存档(makeSave)从不写它', () => {
    const save = makeSave({ ...DEFAULT_PARAMS, seed: 7 }, EMPTY, '', '九州');
    const a = withMoment(save, { year: 1200 });
    expect(a.moment).toEqual({ year: 1200 });
    expect(withMoment(a, null).moment).toBeUndefined();
    expect('moment' in withMoment(a, { year: -1 })).toBe(false);
    expect(save.moment).toBeUndefined();
    expect(JSON.parse(saveText(save)).moment).toBeUndefined();
  });
});

describe('打开时看哪:旧链接照常', () => {
  // 加这个字段以前的网页做出来的两条链接(原样抄下来的),读出来和那时一样
  const OLD = [
    {
      hash: '#share=XVHNShxBEH6XL9dWamZ0V-vmJU-QU8RDO1O723Gme-iu3RCWuSY3wYsk5AcEwas39ZKncRbyFqFHIZBbVX3F91O1he17MHbXX3ZfL58fL8cf9-P33zBYhNhZBRcGS_ESrYYILg8MkkgDnhv0Ntougbf_RrW0bQJXMyIyaK1v3kZbqwseTPtVZdC3ViWvkEEX1l6t82mSUen6rLOOAiaDaJ1f2LadwDp4dV68pglbWl1JfFlbL5dZvTBY2dh4SS90PkRdgWkwkMbp5NPbTqaiD63TT1xX5eF8_obAGG_vdjdXGAycV4kb8dl1Ap9uceF8A0Yfg0qtMLC5-4_CYBFDBy5KouEsx4k5Afj0bDCoV1JfgEFFWR0czuZHx_YcBslupDlRMEoqZ3sF7ZX0jo6YiIn2ieg9DNRpK2A8P_0cH36Nt3d_vn2GwcbJxylLDB_k9caI4dz5FDzyL3KQydAw_AU',
      save: {
        app: '文明与地图',
        format: 1,
        generator: 24,
        seed: 7,
        params: { ...DEFAULT_PARAMS, seed: 7 },
        edits: { names: { 'polity:c32577#0': '大桑' }, interventions: [{ kind: 'protect', a: 'polity:c32577#0', from: 1200 }], terrain: [] },
        check: '0123456789ab',
        savedAt: '2026-10-20T08:00:00.000Z',
        title: '九州大陆',
        view: { projection: 'robinson', center: 120 },
      },
    },
    {
      hash: '#share=VY6xTsNAEET_ZeojWtshJNvR8AVUIIrF3tgW9tm6u6SJXCAKupSAFBo6SkoqvoZEyl-gcyq62Z3ZnbeB9D0Yh5fnw9v293u7f__a735gsOxcKwGcGJRq1UnoHDidGnjVApxS1L04aT1482-ba9N4cDYjIoNGbHHlJA91Z8E0iWeNBI0JMmi7lQ1SWz92BW37WLZyCiYDJ7VdStOMZt7ZUFu1wY9eKaFSd4qtyjL2JwaVuMKqP72znQsVmAYDLeowklppdRROy7qznM-TNAPjuHs8vn4enz4wGNQ2qFurjdAefHsX0VykicNgkFeaP4BxL4v5xex8mqUJwcDLWovLAEZK6ewsobOUrmnBGTHRhIhuMPwB',
      save: {
        app: '文明与地图',
        format: 1,
        generator: 24,
        seed: 2024,
        params: { ...DEFAULT_PARAMS, seed: 2024, landFraction: 0.4 },
        edits: { names: { 'region:c8123': '雁门郡' }, interventions: [], terrain: [] },
        check: 'ba9876543210',
        savedAt: '2026-10-20T09:30:00.000Z',
      },
    },
  ];

  for (const [i, o] of OLD.entries()) {
    it(`旧链接 ${i + 1}:读出来的存档和那时一样,没有 moment,提示也一样`, async () => {
      const r = await decodeShare(o.hash);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.save).toEqual(o.save);
      expect('moment' in r.save).toBe(false);
      // 生成器以后升了版本,两边都多一句"按新版算的",别的不变
      const note = versionNote(24, false);
      expect(r.warnings).toEqual(note ? [note] : []);
      expect(resolveMoment(generateCivStub(), r.save.moment)).toEqual({});
    });
  }
});

/** resolveMoment 拿到空的 moment 时不碰历史:给一个空壳就够 */
function generateCivStub(): ReturnType<typeof generateCiv> {
  return { endYear: 3000 } as ReturnType<typeof generateCiv>;
}

describe('打开时看哪:坏字段安全忽略', () => {
  const read = (moment: unknown, edits: Partial<WorldEdits> = {}) => {
    const save = makeSave({ ...DEFAULT_PARAMS, seed: 7 }, { ...EMPTY, ...edits }, '');
    const r = parseSave(JSON.stringify({ ...save, moment }));
    expect(r.ok).toBe(true);
    // 只是打开时的位置:不合格也不提示
    expect(r.ok && r.warnings).toEqual([]);
    return r.ok ? r.save.moment : undefined;
  };

  it('年份超出这段历史、不是数、负数:去掉年份,别的留着', () => {
    const cam = { lon: 10, lat: 20, zoom: 2 };
    expect(read({ year: 3001, camera: cam })).toEqual({ camera: cam });
    expect(read({ year: -5, selected: 'polity:c1#0' })).toEqual({ selected: 'polity:c1#0' });
    expect(read({ year: '1500' })).toBeUndefined();
    expect(read({ year: NaN })).toBeUndefined();
    expect(read({ year: Infinity })).toBeUndefined();
    // 推到 12000 年的世界,第 9000 年可以;逐年推演的只到"现在"那年
    expect(read({ year: 9000 }, { endYear: 12000 })).toEqual({ year: 9000 });
    expect(read({ year: 2700 }, { play: { year: 2675, commands: [] } })).toBeUndefined();
    expect(read({ year: 2675 }, { play: { year: 2675, commands: [] } })).toEqual({ year: 2675 });
    expect(momentYearMax({ play: { year: 2675, commands: [] } })).toBe(2675);
    expect(momentYearMax({})).toBe(3000);
  });

  it('选中的键样子不对(别的种类、写坏了、不是字符串):去掉', () => {
    for (const selected of ['settlement:c1#0', 'polity:abc', 'polity:c1', 'region:c1#0', 'person:x', '', 42, null, { kind: 'polity', id: 2 }]) {
      expect(read({ selected })).toBeUndefined();
    }
    expect(read({ selected: 'polity:r12#0' })).toEqual({ selected: 'polity:r12#0' });
    expect(read({ selected: 'region:r45' })).toEqual({ selected: 'region:r45' });
  });

  it('镜头不是三个有限数:去掉;整个字段不是对象:当没有', () => {
    expect(read({ camera: { lon: 'x', lat: 1, zoom: 1 } })).toBeUndefined();
    expect(read({ camera: { lon: 1, lat: 1 } })).toBeUndefined();
    expect(read({ camera: [1, 2, 3] })).toBeUndefined();
    expect(read({ camera: { lon: 1, lat: NaN, zoom: 1 } })).toBeUndefined();
    expect(read('第 1500 年')).toBeUndefined();
    expect(read([1500])).toBeUndefined();
    expect(read(null)).toBeUndefined();
  });

  it('键在这个世界里找不到(国家不存在)、年份超出生成好的历史:对到历史上时不选、不停', () => {
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 7 });
    const civ = generateCiv(world);
    const cam = { lon: 1, lat: 2, zoom: 3 };
    expect(resolveMoment(civ, { year: 1500, selected: 'polity:c1#9', camera: cam })).toEqual({ year: 1500, camera: cam });
    expect(resolveMoment(civ, { selected: 'polity:r99999#0' })).toEqual({});
    expect(resolveMoment(civ, { year: civ.endYear + 5 })).toEqual({});
    expect(resolveMoment(null as never, undefined)).toEqual({});
  }, 60_000);
});

describe('短链接后面带的"打开时看哪"(#at=…)', () => {
  it('写成 # 那段、读回来逐字段相等;只写有的那几样', () => {
    const m: SaveMoment = { year: 1500.25, selected: 'polity:c32577#0', camera: { lon: 112.4, lat: -31.25, zoom: 2.5 } };
    const h = momentHash(m);
    expect(h).toBe('#at=1500.25&p=c32577.0&cam=112.4,-31.25,2.5');
    expect(isMomentHash(h)).toBe(true);
    expect(decodeMomentHash(h)).toEqual(m);
    expect(decodeMomentHash(momentHash({ year: 1500, selected: 'region:c8123' }))).toEqual({ year: 1500, selected: 'region:c8123' });
    expect(decodeMomentHash(momentHash({ selected: 'polity:r-12#3' }))).toEqual({ selected: 'polity:r-12#3' });
    expect(momentHash({ camera: { lon: 1, lat: 2, zoom: 3 } })).toBe('#at=&cam=1,2,3');
    expect(decodeMomentHash('#at=&cam=1,2,3')).toEqual({ camera: { lon: 1, lat: 2, zoom: 3 } });
    // 没有东西 / 不是这种 # 那段
    expect(momentHash(null)).toBe('');
    expect(momentHash({})).toBe('');
    expect(isMomentHash('#share=abc')).toBe(false);
    expect(decodeMomentHash('#preset=1')).toBeNull();
    expect(decodeMomentHash('')).toBeNull();
  });

  it('写坏的那一样去掉:年份超出、键不对、镜头不是三个数;倍数夹在范围里', () => {
    expect(decodeMomentHash('#at=99999&p=c1.0')).toEqual({ selected: 'polity:c1#0' });
    expect(decodeMomentHash('#at=abc&r=c5')).toEqual({ selected: 'region:c5' });
    expect(decodeMomentHash('#at=1500&p=c1&cam=1,2')).toEqual({ year: 1500 });
    expect(decodeMomentHash('#at=1500&r=x1&cam=1,,3')).toEqual({ year: 1500 });
    expect(decodeMomentHash('#at=&cam=a,b,c')).toBeNull();
    expect(decodeMomentHash('#at=1500&cam=0,0,9999')).toEqual({ year: 1500, camera: { lon: 0, lat: 0, zoom: CAMERA_ZOOM_RANGE[1] } });
    // 聊天软件折过行(多出空白)照样认
    expect(decodeMomentHash('#at=1500&p=c1.0&ca\nm=1,2,3')).toEqual({ year: 1500, selected: 'polity:c1#0', camera: { lon: 1, lat: 2, zoom: 3 } });
    // 推到 12000 年的世界才认第 9000 年
    expect(decodeMomentHash('#at=9000')).toEqual({ year: 9000 });
    expect(decodeMomentHash('#at=9000', 3000)).toBeNull();
  });
});
