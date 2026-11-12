/**
 * 新建世界的预设做成分享链接、从链接读回来(预设本身存在 presetStore.ts)。纯计算:不碰 DOM、不读浏览器存储,Node 里可测。
 *
 *   https://â€¦/#preset=1&name=两块完整大陆&seed=5730&landFraction=0.4&continents=2&years=6000
 *   https://â€¦/#preset=2&name=乱世大陆&seed=5730&rules=1&rules.name=战乱年代&rules.v=2&rules.by=明月&war.odds=2&biome.temperateDesert=灰烬荒原
 *
 * - 放在 # 后面:浏览器不发给服务器,只在打开链接的人自己的页面里读(和世界的分享链接一样,见 gen/savefile.ts)
 * - preset=:写法的版本。带规则的写 2(只认 1 的网页会提示刷新,不会悄悄丢掉规则),不带的照旧写 1;读到比自己新的不读,提示刷新页面
 * - name:预设名(去掉控制字符、首尾空白,最多 PRESET_NAME_MAX 字);空的按 SHARED_PRESET_NAME
 * - seed:勾了「连种子一起」才写(正整数)
 * - 参数:和带种子的网址同一套键(cells、landFractionâ€¦â€¦),只写和默认不一样的;读的时候认不出的键跳过(以后加的参数),
 *   不是数的、超出合理范围的(PARAM_RANGE,和读存档一样)按默认 / 调回范围内,附一句提示
 * - years:推演到第几年(3000 年不写;读的时候过 cleanEndYear)
 * - rules=1:连规则一起(1 是规则链接的写法版本);规则项、地貌的叫法和规则链接同一套写法,名字、版本、署名、介绍、出处的键前面加 rules.
 *   (gen/civ/ruleLink.ts)。没有这个键 = 新建时用官方规则
 * - 中文名字按网址的规矩转义(URLSearchParams):聊天软件里复制粘贴不会断;折了行的(多出来的空白)也认
 */
import { DEFAULT_PARAMS, type WorldParams } from '../gen/world';
import type { BaseParamKey } from '../gen/params';
import { PARAM_NAME, PARAM_RANGE } from '../gen/savefile';
import { cleanEndYear } from '../gen/edits';
import { RULES_HASH_MAX, readRuleParams, writeRuleParams } from '../gen/civ/ruleLink';
import type { Preset, PresetParams } from './presetStore';

/** # 后面的键:#preset=â€¦ */
export const PRESET_KEY = 'preset';
/** 写法的版本:认得的最新一版(带规则的链接写这个) */
export const PRESET_FORMAT = 2;
/** 不带规则的链接写的版本(只认第 1 版的网页也能打开) */
const PRESET_FORMAT_PLAIN = 1;
/** 规则那一段的写法版本(和规则链接的 rules= 一样) */
const RULES_FORMAT = 1;
/** 规则的名字、版本、署名、介绍、出处这几个键的前缀 */
const RULES_META = 'rules.';
/** 预设名最长几个字(和「存成预设」小窗一样) */
export const PRESET_NAME_MAX = 24;
/** 链接里没写名字时叫什么 */
export const SHARED_PRESET_NAME = '分享的预设';
/** # 后面最多多少字(再长就不像预设链接了):参数那一段 4096,规则那一段另算 */
const HASH_MAX = 4096 + RULES_HASH_MAX;

export const PRESET_BROKEN = '预设链接不完整或被改动过(可能复制时少了一截),请让对方重新复制一次链接';
const PRESET_EMPTY = '链接里没有预设';
const NEWER = '这个预设链接来自更新版本的「文明与地图」,请刷新页面换到最新版再打开';

/** 分享的预设:名字、参数(不含种子)、连种子一起时的种子、推演年数、连规则一起时的那套规则(不带本机编号) */
export type SharedPreset = Omit<Preset, 'id'>;

export type PresetLinkResult = { ok: true; preset: SharedPreset; warnings: string[] } | { ok: false; error: string };

const PARAM_KEYS = (Object.keys(DEFAULT_PARAMS) as BaseParamKey[]).filter((k): k is Exclude<BaseParamKey, 'seed'> => k !== 'seed');

/** 种子:正整数(和预设里存的一样) */
const isSeed = (v: number) => Number.isSafeInteger(v) && v > 0;

/** 预设名:去掉控制字符和首尾空白,连续空白并成一个,最多 PRESET_NAME_MAX 字(按字数,不按码元);空 = '' */
export function cleanPresetName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  const cs = [...s];
  return cs.length > PRESET_NAME_MAX ? cs.slice(0, PRESET_NAME_MAX).join('').trim() : s;
}

/** 网址的 # 那段是不是预设链接(#preset=â€¦) */
export function isPresetHash(hash: string): boolean {
  return typeof hash === 'string' && new RegExp(`^#?\\s*${PRESET_KEY}=`).test(hash.trim());
}

/**
 * 预设 → 网址的 # 那段(`#preset=1&name=â€¦`,接在网站地址后面就是分享链接)。
 * 参数只写和默认不一样的(数字原样写,读回来一模一样);种子不是正整数的不写
 */
export function presetHash(p: SharedPreset): string {
  const q = new URLSearchParams();
  q.set(PRESET_KEY, String(p.rules ? PRESET_FORMAT : PRESET_FORMAT_PLAIN));
  q.set('name', cleanPresetName(p.name) || SHARED_PRESET_NAME);
  if (p.seed !== undefined && isSeed(p.seed)) q.set('seed', String(p.seed));
  for (const k of PARAM_KEYS) {
    const v = p.params[k];
    if (typeof v === 'number' && Number.isFinite(v) && v !== DEFAULT_PARAMS[k]) q.set(k, String(v));
  }
  const years = cleanEndYear(p.endYear);
  if (years) q.set('years', String(years));
  if (p.rules) {
    q.set('rules', String(RULES_FORMAT));
    writeRuleParams(q, p.rules, RULES_META);
  }
  return `#${q.toString()}`;
}

/**
 * 网址的 # 那段(`#preset=â€¦`,也认不带 # 的)→ 预设。不是预设链接、坏了、来自更新的版本给中文错误;
 * 个别参数不对(不是数、超出范围)、种子不对照样读,附提示
 */
export function decodePresetHash(hash: string): PresetLinkResult {
  if (typeof hash !== 'string' || !isPresetHash(hash)) return { ok: false, error: PRESET_EMPTY };
  // 聊天软件折过行:去掉所有空白(名字里的空格已经转义成 + 或 %20)
  const s = hash.trim().replace(/^#/, '').replace(/\s+/g, '');
  if (s.length > HASH_MAX) return { ok: false, error: '链接太长,不像「文明与地图」的预设链接' };
  let q: URLSearchParams;
  try {
    // 先试一遍转义写得对不对(URLSearchParams 遇到坏的 % 不报错,会原样留着)
    decodeURIComponent(s.replace(/\+/g, ' '));
    q = new URLSearchParams(s);
  } catch {
    return { ok: false, error: PRESET_BROKEN };
  }
  const fv = q.get(PRESET_KEY) ?? '';
  if (!/^\d{1,4}$/.test(fv) || Number(fv) < 1) return { ok: false, error: PRESET_BROKEN };
  if (Number(fv) > PRESET_FORMAT) return { ok: false, error: NEWER };

  const warnings: string[] = [];
  const params = {} as PresetParams;
  const bad: string[] = [];
  for (const k of PARAM_KEYS) {
    params[k] = DEFAULT_PARAMS[k];
    const raw = q.get(k);
    if (raw === null) continue;
    const v = raw.trim() === '' ? NaN : Number(raw);
    if (!Number.isFinite(v)) {
      bad.push(PARAM_NAME[k]);
      continue;
    }
    const [lo, hi] = PARAM_RANGE[k];
    if (v < lo || v > hi) bad.push(PARAM_NAME[k]);
    params[k] = Math.min(hi, Math.max(lo, v));
  }
  if (bad.length) warnings.push(`预设链接里的${bad.join('、')}不对,已改成合理的值`);
  const preset: SharedPreset = { name: cleanPresetName(q.get('name')) || SHARED_PRESET_NAME, params };
  const seedRaw = q.get('seed');
  if (seedRaw !== null) {
    const seed = Number(seedRaw);
    if (seedRaw.trim() !== '' && isSeed(seed)) preset.seed = seed;
    else warnings.push('预设链接里的种子不对,已去掉(种子照旧随机给)');
  }
  const yearsRaw = q.get('years');
  if (yearsRaw !== null) {
    const y = yearsRaw.trim() === '' ? NaN : Number(yearsRaw);
    if (!Number.isFinite(y)) warnings.push('预设链接里的推演年数不对,按 3000 年');
    const endYear = cleanEndYear(y);
    if (endYear) preset.endYear = endYear;
  }
  const rv = q.get('rules');
  if (rv !== null) {
    if (!/^\d{1,4}$/.test(rv) || Number(rv) < 1) return { ok: false, error: PRESET_BROKEN };
    if (Number(rv) > RULES_FORMAT) return { ok: false, error: NEWER };
    const r = readRuleParams(q, RULES_META);
    preset.rules = r.rules;
    warnings.push(...r.notes);
  }
  return { ok: true, preset, warnings };
}
