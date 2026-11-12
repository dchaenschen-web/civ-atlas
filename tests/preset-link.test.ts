/**
 * 预设做成分享链接(ui/presetLink.ts):预设 → 链接 → 预设逐字段相等;链接有多长;
 * 折了行、转义过的照样读;坏的参数调回范围内并提示;不是预设链接、少了一截、来自更新版本的给中文错误;
 * 连规则一起的:写成第 2 版、规则逐字段读回来;第 1 版后面接着规则的写法也读得出规则。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/gen/world';
import { PARAM_RANGE, SHARE_WARN_LENGTH } from '../src/gen/savefile';
import { BIOME_KEYS, cleanRuleSet, type RuleSet } from '../src/gen/civ/ruleSet';
import { TUNING_ITEMS, tuningEnds, type TuningValues } from '../src/gen/civ/tuning';
import { decodeRulesHash, rulesHash } from '../src/gen/civ/ruleShare';
import { PRESET_BROKEN, PRESET_NAME_MAX, SHARED_PRESET_NAME, cleanPresetName, decodePresetHash, isPresetHash, presetHash, type SharedPreset } from '../src/ui/presetLink';
import type { PresetParams } from '../src/ui/presetStore';

const { seed: _seed, ...BASE } = DEFAULT_PARAMS;
const P = (o: Partial<PresetParams> = {}): PresetParams => ({ ...BASE, ...o });
/** 网站地址(正式网站);测试网站多 /beta 五个字 */
const SITE = 'https://atlas.gerdor.top/';

const SAMPLES: SharedPreset[] = [
  { name: '两块完整大陆', params: P({ landFraction: 0.4, continents: 2, gather: 0.5 }) },
  { name: '寒冷群岛', params: P({ landFraction: 0.22, plates: 36, mountains: 1.2, temperature: -8, rainfall: 1.3, rugged: 1.6 }), seed: 5730, endYear: 6000 },
  { name: '默认', params: P() },
  // 每一样都改过、名字带空格和符号(& = # % + 都要转义)
  {
    name: 'A & B = 50% #1 + 北境',
    params: {
      cells: 120000,
      landFraction: 0.123456789,
      plates: 64,
      mountains: 4.75,
      temperature: -39.5,
      rainfall: 0.05,
      continents: 8,
      gather: 1,
      rugged: 2.5,
      hardness: 0.3,
      north: -1,
      astro: 1,
      system: 5,
      planets: 6,
      gas: 4,
      moons: 4,
      tilt: 79.5,
      rotation: 199,
      geo: 2.9,
      mag: 1.9,
      tech: 2,
      arch: 3,
      life: 2,
      home: 6,
      salt: 999,
      impact: 2,
    },
    seed: 999999,
    endYear: 60000,
  },
];

describe('预设链接:编码 → 解码', () => {
  for (const p of SAMPLES) {
    it(`「${p.name}」读回来逐字段相等`, () => {
      const hash = presetHash(p);
      expect(hash.startsWith('#preset=1&')).toBe(true);
      expect(isPresetHash(hash)).toBe(true);
      const r = decodePresetHash(hash);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.warnings).toEqual([]);
      expect(r.preset).toEqual(p);
      for (const k of Object.keys(p.params) as (keyof PresetParams)[]) expect(r.preset.params[k]).toBe(p.params[k]);
      expect(r.preset.seed).toBe(p.seed);
      expect(r.preset.endYear).toBe(p.endYear);
      // 同一个预设编出同一个链接
      expect(presetHash(r.preset)).toBe(hash);
    });
  }

  it('链接长度:只写和默认不一样的几样,远小于提醒"链接较长"的 8000 字', () => {
    const lens = SAMPLES.map((p) => (SITE + presetHash(p)).length);
    // 两块完整大陆 135 字、寒冷群岛(带种子、推演年数)178 字、默认 58 字、样样都改过(含星球系九样 + 技术路线)346 字
    expect(lens).toEqual([135, 178, 58, 385]); // 385 = 全部参数都改过(含 arch/life/home/salt/impact 五个新参数)
    for (const n of lens) expect(n).toBeLessThan(SHARE_WARN_LENGTH);
    // 默认的那几样不写
    expect(presetHash(SAMPLES[0])).toBe('#preset=1&name=%E4%B8%A4%E5%9D%97%E5%AE%8C%E6%95%B4%E5%A4%A7%E9%99%86&landFraction=0.4&continents=2&gather=0.5');
  });

  it('名字:去掉控制字符、并掉连续空白,最多 24 字;空的叫"分享的预设"', () => {
    expect(cleanPresetName('  北境\n\t群岛  ')).toBe('北境 群岛');
    expect([...cleanPresetName('长'.repeat(40))]).toHaveLength(PRESET_NAME_MAX);
    const r = decodePresetHash(presetHash({ name: ' \u0007 ', params: P() }));
    expect(r.ok && r.preset.name).toBe(SHARED_PRESET_NAME);
    const r2 = decodePresetHash('#preset=1&landFraction=0.5');
    expect(r2.ok && r2.preset).toEqual({ name: SHARED_PRESET_NAME, params: P({ landFraction: 0.5 }) });
  });
});

describe('预设链接:聊天软件里折过行、转义过的照样读', () => {
  const hash = presetHash(SAMPLES[1]);
  it('不带 #、前后空白、中间折行、整段再转义一次', () => {
    for (const v of [hash.slice(1), `  ${hash}\n`, `${hash.slice(0, 30)}\n${hash.slice(30, 60)}\r\n ${hash.slice(60)}`]) {
      const r = decodePresetHash(v);
      expect(r.ok && r.preset).toEqual(SAMPLES[1]);
    }
    // 名字直接写中文(有的聊天软件把转义还原了)也认
    const raw = decodePresetHash('#preset=1&name=寒冷群岛&seed=5730');
    expect(raw.ok && raw.preset).toEqual({ name: '寒冷群岛', params: P(), seed: 5730 });
  });

  it('认不出的键跳过(以后加的参数),不提示', () => {
    const r = decodePresetHash(`${hash}&future=3&style=fantasy`);
    expect(r.ok && r.preset).toEqual(SAMPLES[1]);
    expect(r.ok && r.warnings).toEqual([]);
  });
});

describe('预设链接:坏的参数调回来,附提示', () => {
  it('超出范围的夹回范围内、不是数的按默认', () => {
    const r = decodePresetHash('#preset=1&name=x&cells=1e9&plates=abc&temperature=-99&hardness=');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.preset.params).toEqual(P({ cells: PARAM_RANGE.cells[1], temperature: PARAM_RANGE.temperature[0] }));
    expect(r.warnings).toEqual(['预设链接里的精细度、板块数量、气温、板块软硬不对,已改成合理的值']);
  });

  it('种子不是正整数:去掉,种子照旧随机;推演年数不是数:按 3000 年', () => {
    for (const seed of ['-5', '1.5', 'abc', '', '1e30']) {
      const r = decodePresetHash(`#preset=1&name=x&seed=${seed}`);
      expect(r.ok && r.preset.seed).toBeUndefined();
      expect(r.ok && r.warnings).toEqual(['预设链接里的种子不对,已去掉(种子照旧随机给)']);
    }
    const y = decodePresetHash('#preset=1&name=x&years=很久');
    expect(y.ok && y.preset.endYear).toBeUndefined();
    expect(y.ok && y.warnings).toEqual(['预设链接里的推演年数不对,按 3000 年']);
    // 3000 年本来就不写;超出的夹到 60000
    const z = decodePresetHash('#preset=1&name=x&years=99999');
    expect(z.ok && z.preset.endYear).toBe(60000);
    expect(decodePresetHash('#preset=1&years=3000').ok && (decodePresetHash('#preset=1&years=3000') as { preset: SharedPreset }).preset.endYear).toBeUndefined();
  });
});

describe('预设链接:读不了的给中文错误', () => {
  const bad = (hash: string) => {
    const r = decodePresetHash(hash);
    expect(r.ok).toBe(false);
    return r.ok ? '' : r.error;
  };
  it('不是预设链接(世界的分享链接、空的、别的)', () => {
    expect(bad('')).toBe('链接里没有预设');
    expect(bad('#share=abc')).toBe('链接里没有预设');
    expect(bad('#foo=preset=1')).toBe('链接里没有预设');
    expect(isPresetHash('#share=abc')).toBe(false);
    expect(isPresetHash(undefined as never)).toBe(false);
  });
  it('版本号没了、写坏了;转义坏了(少了一截)', () => {
    expect(bad('#preset=')).toBe(PRESET_BROKEN);
    expect(bad('#preset=0&name=x')).toBe(PRESET_BROKEN);
    expect(bad('#preset=v1&name=x')).toBe(PRESET_BROKEN);
    expect(bad(presetHash(SAMPLES[0]).slice(0, 25))).toBe(PRESET_BROKEN);
  });
  it('来自更新的版本:提示刷新页面', () => {
    expect(bad('#preset=3&name=x')).toMatch(/更新版本.*刷新页面/);
  });
  it('太长的不读', () => {
    expect(bad(`#preset=1&name=${'x'.repeat(21000)}`)).toMatch(/太长/);
  });
});

describe('预设链接:连规则一起', () => {
  const WAR: RuleSet = {
    name: '战国千年',
    version: 2,
    by: '鲸落',
    about: '仗多，易代快',
    basedOn: [{ name: '群雄并起', by: '砚山', version: 1 }],
    values: { 'war.odds': 2, 'war.truce': 2, 'war.length': [3, 20], 'war.crush': 'never', 'war.winter': 'off' },
    biomes: { temperateDesert: '灰烬荒原' },
  };
  const P1: SharedPreset = { name: '乱世大陆', params: P({ landFraction: 0.4, continents: 2 }), seed: 5730, endYear: 6000, rules: { ...WAR, id: 'rmh3k2x9a4f' } };

  it('写成第 2 版;规则逐字段读回来(本机编号不写),同一个预设编出同一个链接', () => {
    const hash = presetHash(P1);
    expect(hash.startsWith('#preset=2&')).toBe(true);
    expect(hash).toContain('&years=6000&rules=1&rules.name=');
    expect(hash).not.toContain('rmh3k2x9a4f');
    const r = decodePresetHash(hash);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toEqual([]);
    const { id: _id, ...rules } = cleanRuleSet(P1.rules).rules!;
    expect(r.preset).toEqual({ ...P1, rules });
    expect(presetHash(r.preset)).toBe(presetHash({ ...P1, rules }));
    // 规则那一段和规则链接同一套写法
    const tail = hash.slice(hash.indexOf('&rules.name='));
    expect(tail.replace(/rules\./g, '')).toBe(rulesHash(WAR).replace(/^#rules=1/, ''));
  });

  it('不带规则的照旧写第 1 版(只认第 1 版的网页也能打开)', () => {
    const { rules: _r, ...plain } = P1;
    expect(presetHash(plain).startsWith('#preset=1&')).toBe(true);
  });

  it('第 1 版后面接着规则的写法也读得出规则;预设参数和规则项不打架', () => {
    const doc =
      '#preset=1&name=两块大陆&seed=5730&landFraction=0.4&years=6000&rules=1&rules.name=战乱年代&rules.v=2&rules.by=明月&rules.about=仗多&rules.base1=群雄并起&rules.base1.by=砚山&rules.base1.v=1&war.odds=2&war.length=3-20&biome.temperateDesert=灰烬荒原';
    const r = decodePresetHash(doc);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toEqual([]);
    expect(r.preset.name).toBe('两块大陆');
    expect(r.preset.params).toEqual(P({ landFraction: 0.4 }));
    expect(r.preset.seed).toBe(5730);
    expect(r.preset.endYear).toBe(6000);
    expect(r.preset.rules).toEqual({
      name: '战乱年代',
      version: 2,
      by: '明月',
      about: '仗多',
      basedOn: [{ name: '群雄并起', by: '砚山', version: 1 }],
      values: { 'war.odds': 2, 'war.length': [3, 20] },
      biomes: { temperateDesert: '灰烬荒原' },
    });
    // 和同一套的规则链接读出来的一样
    const same = decodeRulesHash('#rules=1&name=战乱年代&v=2&by=明月&about=仗多&base1=群雄并起&base1.by=砚山&base1.v=1&war.odds=2&war.length=3-20&biome.temperateDesert=灰烬荒原');
    expect(same.ok && same.rules).toEqual(r.preset.rules);
  });

  it('规则里个别项不对照样读,附提示;规则的写法版本坏了、比自己新的不读', () => {
    const r = decodePresetHash('#preset=2&name=x&rules=1&rules.name=y&war.odds=abc');
    expect(r.ok && r.preset.rules?.values).toEqual({});
    expect(r.ok && r.warnings.length).toBe(1);
    const bad = (h: string) => {
      const x = decodePresetHash(h);
      return x.ok ? '' : x.error;
    };
    expect(bad('#preset=2&name=x&rules=&rules.name=y')).toBe(PRESET_BROKEN);
    expect(bad('#preset=2&name=x&rules=v1')).toBe(PRESET_BROKEN);
    expect(bad('#preset=2&name=x&rules=2&rules.name=y')).toMatch(/更新版本.*刷新页面/);
  });

  it('规则全写满也读得回来', () => {
    const han = (n: number) => '漢'.repeat(n);
    const all: TuningValues = Object.fromEntries(TUNING_ITEMS.map((x) => [x.id, tuningEnds(x)[1]]));
    const full: RuleSet = {
      name: han(24),
      version: 99999,
      by: han(24),
      about: han(60),
      basedOn: Array.from({ length: 4 }, () => ({ name: han(24), by: han(24), version: 99999 })),
      values: all,
      biomes: Object.fromEntries(BIOME_KEYS.map((k) => [k, han(12)])),
    };
    const p: SharedPreset = { ...SAMPLES[3], name: han(PRESET_NAME_MAX), rules: full };
    const r = decodePresetHash(presetHash(p));
    expect(r.ok && r.preset.rules).toEqual(cleanRuleSet(full).rules);
    expect(r.ok && r.preset.params).toEqual(p.params);
  });
});
