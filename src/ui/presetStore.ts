/**
 * 新建世界的「预设」(新建弹窗第 2 步最上面、新建页左边「世界参数」里;两边是同一份):
 *
 *   默认      DEFAULT_PARAMS(种子照旧随机)
 *   上次用的  上一次点「创建世界」时的参数(不含种子),记着那次建的世界叫什么
 *   自己存的  「存成预设…」存下的:陆地、大陆、气候、精细度、推演年数;种子、规则只有勾了「连种子 / 规则一起存」才存。最多 30 个
 *   分享的    打开朋友的预设链接(presetLink.ts)带来的那一套:不自动存,点「存进我的预设…」才存;只在这次打开的页面里有
 *
 * 另外记着上次选的是哪个(下次打开弹窗停在它上面;选的是分享的那一套时记的还是之前那个)。
 * 都存在这个浏览器里(和存档一样换电脑带不走);浏览器不让存(隐私模式)就只在这次打开的页面里有效。
 */
import { createListeners } from './createStore';
import { PARAM_RANGE } from '../gen/savefile';
import { DEFAULT_PARAMS, type BaseParamKey, type WorldParams } from '../gen/params';
import { contBrief } from './genesisSliders';
import { cleanRuleSet, type RuleSet } from '../gen/civ/ruleSet';

/** 预设里的参数:世界参数去掉种子 */
export type PresetParams = Omit<WorldParams, 'seed'>;

export interface Preset {
  id: string;
  name: string;
  params: PresetParams;
  /** 勾了「连种子一起存」 */
  seed?: number;
  /** 推演到第几年(没开「推演超过 3000 年」= 不给) */
  endYear?: number;
  /** 勾了「连规则一起存」:那一套(「我的规则」里的带本机编号) */
  rules?: RuleSet;
}

export interface LastUsed {
  params: PresetParams;
  endYear?: number;
  /** 那次建的世界叫什么("建「阿斯特拉」时") */
  title: string;
}

/** 选的是哪个:默认 / 上次用的 / 分享的 / 自己存的那个的 id */
export type PresetChoice = 'default' | 'last' | 'shared' | string;

/**
 * 朋友分享来的预设(没存进自己的预设,没有 id);gallery = 来自作品墙上的新建参数作品
 * (by:作品的署名;id、title:作品编号和作品名,用它新建的世界出处写这个作品)
 */
export type SharedPreset = Omit<Preset, 'id'> & { gallery?: { by: string; id?: string; title?: string } };

/** 分享来的这一套在预设菜单里名字后面带的那几个字:作品墙上的写署名,朋友分享的写"分享的" */
export function sharedNote(p: SharedPreset): string {
  return p.gallery ? p.gallery.by || '作品墙' : '分享的';
}

export interface PresetState {
  list: Preset[];
  last: LastUsed | null;
  chosen: PresetChoice;
  /** 打开预设链接带来的那一套(不存进浏览器;没有 = null) */
  shared: SharedPreset | null;
}

export const MAX_PRESETS = 30;
const KEY = 'wenming-ditu:presets';

/** 只认得的键、在范围里的数;别的(以后加的、坏掉的)按默认 */
function cleanParams(x: unknown): PresetParams {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_PARAMS } as Record<string, number>;
  delete out.seed;
  for (const k of Object.keys(out)) {
    const v = o[k];
    // 和读存档一样:超出合理范围的调回范围内(浏览器里存的东西可能被改坏)
    const [lo, hi] = PARAM_RANGE[k as BaseParamKey];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.min(hi, Math.max(lo, v));
  }
  return out as unknown as PresetParams;
}

const posInt = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined);
const withRules = (raw: unknown): { rules?: RuleSet } => {
  const r = raw === undefined ? null : cleanRuleSet(raw).rules;
  return r ? { rules: r } : {};
};

function load(): PresetState {
  const empty: PresetState = { list: [], last: null, chosen: 'default', shared: null };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty;
    const o = JSON.parse(raw) as {
      list?: unknown[];
      last?: Record<string, unknown> | null;
      chosen?: unknown;
    };
    const list: Preset[] = [];
    for (const it of Array.isArray(o.list) ? o.list : []) {
      const p = it as Record<string, unknown>;
      if (typeof p?.id !== 'string' || typeof p.name !== 'string') continue;
      list.push({
        id: p.id,
        name: p.name,
        params: cleanParams(p.params),
        seed: posInt(p.seed),
        endYear: posInt(p.endYear),
        ...withRules(p.rules),
      });
    }
    const l = o.last;
    const last =
      l && typeof l === 'object'
        ? {
            params: cleanParams(l.params),
            endYear: posInt(l.endYear),
            title: typeof l.title === 'string' ? l.title : '',
          }
        : null;
    let chosen = typeof o.chosen === 'string' ? o.chosen : 'default';
    if (chosen === 'last' ? !last : chosen !== 'default' && !list.some((p) => p.id === chosen)) chosen = 'default';
    return { list: list.slice(0, MAX_PRESETS), last, chosen, shared: null };
  } catch {
    return empty;
  }
}

let state: PresetState | null = null;
const subs = createListeners();
const get = () => (state ??= load());

/** 浏览器里记着的"上次选的"(选了分享的那一套时不换:它不存进浏览器) */
let keptChoice: PresetChoice | null = null;

function set(next: PresetState) {
  const was = state;
  state = next;
  if (next.chosen !== 'shared') keptChoice = next.chosen;
  else if (keptChoice === null) keptChoice = was && was.chosen !== 'shared' ? was.chosen : 'default';
  try {
    const { shared: _shared, ...rest } = next;
    localStorage.setItem(KEY, JSON.stringify({ ...rest, chosen: keptChoice }));
  } catch {
    /* 隐私模式、存满了:只管这一次 */
  }
  subs.emit();
}

export function usePresets(): PresetState {
  return subs.use(get);
}

export function getPresets(): PresetState {
  return get();
}

export const strip = (p: WorldParams): PresetParams => {
  const { seed: _seed, ...rest } = p;
  return rest;
};

/** 选的那个预设的参数(没有 = 默认) */
export function choiceParams(s: PresetState, c: PresetChoice): { params: PresetParams; seed?: number; endYear?: number; rules?: RuleSet } {
  if (c === 'last' && s.last) return { params: s.last.params, endYear: s.last.endYear };
  const p = c === 'shared' ? s.shared : s.list.find((x) => x.id === c);
  if (p) return { params: p.params, seed: p.seed, endYear: p.endYear, ...(p.rules ? { rules: p.rules } : {}) };
  return { params: strip(DEFAULT_PARAMS) };
}

/** 选的那个预设叫什么 */
export function choiceName(s: PresetState, c: PresetChoice): string {
  if (c === 'last' && s.last) return '上次用的';
  if (c === 'shared' && s.shared) return s.shared.name;
  return s.list.find((x) => x.id === c)?.name ?? '默认';
}

/**
 * 新建弹窗里点「开始」时还选着作品墙上的那一套(shared = 弹窗打开时带来的那一套):那个作品(新的世界出处写它);
 * 换成了默认、上次用的、自己的预设 = null(参数不是那个作品的了,出处不写它)
 */
export function chosenGallery(s: PresetState, shared: SharedPreset | null | undefined): SharedPreset['gallery'] | null {
  const g = shared?.gallery;
  return g && s.chosen === 'shared' && s.shared?.gallery?.id === g.id ? g : null;
}

/** 记下选了哪个 */
export function choosePreset(c: PresetChoice) {
  const s = get();
  if (s.chosen !== c) set({ ...s, chosen: c });
}

/** 打开了朋友的预设链接:选上分享来的这一套(不存进自己的预设;再打开一个链接换成新的那套) */
export function pickSharedPreset(p: SharedPreset) {
  set({ ...get(), shared: p, chosen: 'shared' });
}

/** 存成预设:同名的换掉;多了扔掉最旧的。返回新的 id */
export function savePreset(name: string, params: WorldParams, withSeed: boolean, endYear?: number, rules?: RuleSet): string {
  const s = get();
  const same = s.list.find((p) => p.name === name);
  const id = same?.id ?? `p${Date.now().toString(36)}${s.list.length.toString(36)}`;
  const it: Preset = {
    id,
    name,
    params: strip(params),
    ...(withSeed ? { seed: params.seed } : {}),
    ...(endYear ? { endYear } : {}),
    ...withRules(rules),
  };
  const list = same ? s.list.map((p) => (p.id === id ? it : p)) : [...s.list, it].slice(-MAX_PRESETS);
  set({ ...s, list, chosen: id });
  return id;
}

export function renamePreset(id: string, name: string) {
  const s = get();
  set({ ...s, list: s.list.map((p) => (p.id === id ? { ...p, name } : p)) });
}

export function deletePreset(id: string) {
  const s = get();
  set({
    ...s,
    list: s.list.filter((p) => p.id !== id),
    chosen: s.chosen === id ? 'default' : s.chosen,
  });
}

/** 点「创建世界」建好了:记成「上次用的」 */
export function rememberLast(params: WorldParams, endYear: number | undefined, title: string) {
  const s = get();
  set({
    ...s,
    last: { params: strip(params), ...(endYear ? { endYear } : {}), title },
  });
}

/** 参数和预设一样吗(不比种子;预设存了种子的连种子比) */
export function sameAsChoice(s: PresetState, c: PresetChoice, p: WorldParams, endYear: number | undefined): boolean {
  const ch = choiceParams(s, c);
  if (ch.seed && ch.seed !== p.seed) return false;
  if ((ch.endYear ?? 0) !== (endYear ?? 0)) return false;
  return (Object.keys(ch.params) as (keyof PresetParams)[]).every((k) => ch.params[k] === p[k]);
}

/** 哪几样和预设不一样(数值框用主色写) */
export function changedKeys(s: PresetState, c: PresetChoice, p: WorldParams): Set<string> {
  const ch = choiceParams(s, c).params;
  return new Set((Object.keys(ch) as (keyof PresetParams)[]).filter((k) => ch[k] !== p[k]));
}

/**
 * 一个预设的简写(菜单里写前两样,管理里写前三样):带着规则的先写规则(rulesName = 那一套现在叫什么,不给 = 存下时的名字),
 * 再是种子、陆地、大陆、气温、降水、地块这几样里和默认不一样的
 */
export function presetSummary(p: Pick<Preset, 'params' | 'seed' | 'rules'>, max: number, rulesName?: string): string {
  const d = DEFAULT_PARAMS;
  const q = p.params;
  const parts: string[] = [];
  if (p.rules) parts.push(`规则：${rulesName || p.rules.name}`);
  if (p.seed) parts.push(`种子 ${p.seed}`);
  if (q.landFraction !== d.landFraction) parts.push(`陆地 ${Math.round(q.landFraction * 100)}%`);
  // 大陆块数排在气候前面,大陆的其余几样排在气候后面
  const cont = contBrief({ ...d, ...q, seed: 1 })?.split('，') ?? [];
  if (q.continents) parts.push(cont.shift()!);
  if (q.temperature !== d.temperature) parts.push(`${q.temperature > 0 ? '+' : ''}${q.temperature}°C`);
  if (q.rainfall !== d.rainfall) parts.push(`降水 ${q.rainfall.toFixed(2)}×`);
  parts.push(...cont);
  if (q.plates !== d.plates) parts.push(`${q.plates} 个板块`);
  if (q.mountains !== d.mountains) parts.push(`造山 ${q.mountains.toFixed(2)}×`);
  if (q.cells !== d.cells) parts.push(`地块 ${Math.round(q.cells / 1000)}k`);
  return parts.slice(0, max).join('，');
}

/** 「存成预设」小窗里"会存下:…"那几组(陆地、大陆、气候、精细度、推演年数);陆地写数,大陆改过才写 */
export function keptGroups(p: WorldParams): { name: string; detail?: string }[] {
  const cont = contBrief(p);
  return [
    {
      name: '陆地',
      detail: `${Math.round(p.landFraction * 100)}%，${p.plates} 个板块，造山 ${p.mountains.toFixed(2)}×`,
    },
    { name: '大陆', detail: cont ? cont.replace(' 块大陆', ' 块') : undefined },
    { name: '气候' },
    { name: '精细度' },
    { name: '推演年数' },
  ];
}
