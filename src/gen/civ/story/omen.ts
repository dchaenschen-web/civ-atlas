/**
 * 天象与历史:日食、彗星、流星雨、行星会合、客星(新星)。
 *
 * 两个要点:
 * 1. **全部从星球系派生**:有卫星才有像样的日月食,行星的公转周期决定会合周期,恒星类型决定耀斑/客星频度;
 *    astro = 0 的世界(老世界、没开星球系的新世界)没有天象记录。
 * 2. **古典时代不知道原因**:还没到火药时代(时代序号 < 4)时,编年史写成灾异 / 祥瑞,并和前后几年的大事挂钩
 *    (日食 = 君失德、兵起、大丧;彗星 = 除旧布新;五星连珠 = 大吉、改元);到了火药时代以后,历官预推得出日食,
 *    只记一笔"不以为异",重要度也降下来。这一层不改历史,只把天象和史事**关联**起来(要改历史的另开规则)。
 *
 * 纯计算、确定性:同一个世界、同一份历史 → 同一份天象表。
 */
import type { Civ } from '../types';
import type { World } from '../../world';
import { astroOf, type AstroSystem } from '../../astro';
import { subSeed } from '../../util';
import { buildChronicle, filterChronicle, type ChronicleEntry } from './chronicle';
import { developmentAt, eraLevel, eraOf } from '../development';

export type OmenKind = 'eclipse' | 'comet' | 'meteor' | 'conjunction' | 'nova' | 'storm';

export const OMEN_NAMES: Readonly<Record<OmenKind, string>> = {
  eclipse: '日食',
  comet: '彗星',
  meteor: '流星雨',
  conjunction: '行星会合',
  nova: '客星',
  storm: '磁暴与极光',
};

export interface Omen {
  year: number;
  kind: OmenKind;
  /** 落在哪个州(0 起的州号;没有 = 全天之下都看得到) */
  region: number;
  /** +1 吉 / −1 凶 / 0 中性 */
  mood: 1 | -1 | 0;
  /** 重要度(3 = 大事;和编年史的重要度同一个刻度) */
  importance: 1 | 2 | 3;
  /** 古典时代(还没到火药时代):写成灾异 / 祥瑞 */
  classical: boolean;
  /** 前后三年内挂上的大事件;没有 = null */
  tie: { year: number; text: string } | null;
  /** 编年史那一行(不带年份) */
  text: string;
}

/** 火药时代的序号(development.ts 的 ERAS:石器 0、青铜 1、铁器 2、中古 3、火药 4) */
export const GUNPOWDER_ERA = 4;

/** 八卦方位(天象出现在哪片天,按种子取) */
const DIRECTIONS = ['东', '南', '西', '北', '东南', '西南', '东北', '西北'] as const;

/** 按种子取 [0,1) 的数 */
function unit(seed: number, tag: string): number {
  return (subSeed(seed, 'omen:' + tag) % 1_000_000) / 1_000_000;
}

/** 那个年头天下最高到了第几个时代(0 = 石器) */
export function worldEraAt(civ: Civ, year: number): number {
  const dev = civ.development;
  if (!dev || !dev.snaps.length) return 0;
  const lv = developmentAt(dev, year);
  let top = 0;
  for (let r = 0; r < civ.regions.count; r++) top = Math.max(top, eraLevel(lv, r));
  return eraOf(top).era;
}

/** 候选天象的排布(还没挂钩大事) */
interface Candidate {
  year: number;
  kind: OmenKind;
  /** 用种子和年份挑的方位 */
  dir: string;
  /** 月亮 / 两颗星的名字,写进文案用 */
  detail: string;
}

/** 会合周期(年):两颗行星的会合 = 1 / |1/P1 − 1/P2| */
function synodicYears(p1: number, p2: number): number {
  const d = Math.abs(1 / p1 - 1 / p2);
  return d > 0 ? 1 / d : 0;
}

/** 排天象:日食、彗星、流星雨、行星会合、客星 */
function schedule(civ: Civ, sys: AstroSystem, seed: number): Candidate[] {
  const out: Candidate[] = [];
  const end = civ.endYear;
  const push = (year: number, kind: OmenKind, detail: string) => {
    if (!(year > 0 && year < end)) return;
    const dir = DIRECTIONS[subSeed(seed, `omen-dir:${kind}:${Math.round(year)}`) % DIRECTIONS.length];
    out.push({ year: Math.round(year * 16) / 16, kind, dir, detail });
  };
  const home = sys.design.planets[sys.home.index];

  // 日食:有卫星才明显;周期按"食年"(沙罗周期 18.03 年)派生,挑一部分(否则 3000 年一百多次太多)
  if (home.moons.length) {
    const every = 18.03 * (0.8 + 0.6 * unit(seed, 'saros'));
    const first = 2 + unit(seed, 'saros0') * every;
    for (let k = 0; first + k * every < end; k++) {
      if (unit(seed, `ecl${k}`) > 0.32) continue; // 只有三分之一的日食落在有人住的地方、被记下来
      push(first + k * every, 'eclipse', '日色如血');
    }
  }
  // 双固态行星:伴星每隔一个互绕周期掩一次日,史官只记异样的那几次(古典时代写成"两星相掩")
  const bin = sys.design.binary;
  if (bin) {
    const n = 6 + Math.floor(unit(seed, 'binN') * 10);
    for (let k = 0; k < n; k++) {
      if (unit(seed, `bin${k}`) < 0.85) push((k + 0.5) * (end / n), 'eclipse', '伴星掩日');
    }
  }
  // 气态巨星的宜居卫星:母行星周期性掩日("大星掩日"),史官只记罕见的几次
  const hm = sys.design.habitableMoon;
  if (hm) {
    const n = 6 + Math.floor(unit(seed, 'hmN') * 10);
    for (let k = 0; k < n; k++) {
      if (unit(seed, `hm${k}`) < 0.85) push((k + 0.4) * (end / n), 'eclipse', '大星掩日');
    }
  }
  // 双恒星:两星互食(每互绕周期一次),史官只记罕见的几次
  const bs = sys.design.binaryStar;
  if (bs) {
    const n = 5 + Math.floor(unit(seed, 'bsN') * 9);
    for (let k = 0; k < n; k++) {
      if (unit(seed, `bs${k}`) < 0.8) push((k + 0.35) * (end / n), 'eclipse', '两星互食');
    }
  }
  // 彗星:周期 60–220 年(哈雷型;红矮星系更常见)
  const starFactor = sys.star.id === 'm' ? 0.7 : sys.star.id === 'bin' ? 0.85 : 1;
  const cometPeriod = (60 + 160 * unit(seed, 'comet')) * starFactor;
  for (let k = 0; k * cometPeriod < end; k++) push(cometPeriod * (k + 0.6), 'comet', '长数丈');
  // 流星雨:每年都有,只记大的(约 33 年一轮)
  const meteorEvery = 20 + 40 * unit(seed, 'meteor');
  for (let k = 0; k * meteorEvery < end; k++) if (unit(seed, `met${k}`) < 0.4) push(meteorEvery * (k + 0.3), 'meteor', '夜有星陨如雨');
  // 行星会合:拿两颗周期最长的行星算会合周期(再叠木星土星那样的"大合")
  const periods = sys.bodies
    .filter((b) => b.design.kind === 'gas' || b.periodDays > 365 * 2)
    .map((b) => b.periodDays / 365.25)
    .sort((a, b) => a - b);
  if (periods.length >= 2) {
    const syn = synodicYears(periods[periods.length - 1], periods[periods.length - 2]);
    if (syn > 2 && syn < end) {
      for (let k = 0; k * syn < end; k++) if (unit(seed, `con${k}`) < 0.5) push(syn * (k + 0.4), 'conjunction', '二星相犯');
    }
  }
  // 客星(新星 / 超新星):约 150–400 年一次,红矮星耀斑多的星系更频繁
  const novaEvery = (150 + 250 * unit(seed, 'nova')) / (sys.star.id === 'm' ? 1.6 : 1);
  for (let k = 0; k * novaEvery < end; k++) push(novaEvery * (k + 0.45), 'nova', '客星见于天');
  // 磁暴与极光:磁场挡不住恒星风的地方常有。频率 = 基础 60 年 ÷ 磁暴倍数(home.storms,地球 = 1)
  const stormEvery = 60 / Math.max(0.3, Math.min(6, sys.home.storms));
  for (let k = 0; k * stormEvery < end; k++) if (unit(seed, `storm${k}`) < 0.35) push(stormEvery * (k + 0.5), 'storm', '天光如火');
  out.sort((a, b) => a.year - b.year);
  return out;
}

/** 天象的挂靠:前后三年内最重要的一条史事(重要度 3) */
function tieOf(civ: Civ, year: number, majors: ChronicleEntry[]): Omen['tie'] {
  let best: ChronicleEntry | null = null;
  for (const e of majors) {
    const d = Math.abs(Math.floor(e.year) - year);
    if (d > 3) continue;
    if (!best || d < Math.abs(Math.floor(best.year) - year)) best = e;
  }
  return best ? { year: Math.floor(best.year), text: best.text } : null;
}

/** 文案:古典时代写灾异 / 祥瑞,火药时代以后历官预推、只记一笔 */
function omenText(kind: OmenKind, c: Candidate, classical: boolean, tie: Omen['tie']): { text: string; mood: Omen['mood']; importance: Omen['importance'] } {
  const tieTail = tie ? `，会${tie.text}` : '';
  if (classical) {
    switch (kind) {
      case 'eclipse':
        if (c.detail === '大星掩日') {
          return { text: `大星掩日，昼晦如夜${tieTail || '，占者以为天狗食日'}`, mood: -1, importance: 3 };
        }
        if (c.detail === '两星互食') {
          return { text: `两星互食，天有二日，昼晦复明${tieTail || '，占者以为二主争国之象'}`, mood: -1, importance: 3 };
        }
        return c.detail === '伴星掩日'
          ? { text: `两星相掩，昼晦，${c.dir}方不见天日${tieTail || '，占者以为国分为二之象'}`, mood: -1, importance: 3 }
          : { text: `日有食之，昼晦，${c.dir}方不见天日${tieTail ? tieTail : '，国人惶惧'}`.replace('，会，', '，'), mood: -1, importance: 3 };
      case 'comet':
        return { text: `有星孛于${c.dir}，${c.detail}${tieTail || '，占者以为除旧布新之象'}`, mood: -1, importance: 3 };
      case 'meteor':
        return { text: `夜有星陨如雨，自${c.dir}来${tieTail}`, mood: -1, importance: 2 };
      case 'conjunction':
        return { text: `二星会于${c.dir}，占曰大吉${tieTail}`, mood: 1, importance: 3 };
      case 'nova':
        return { text: `有客星见于${c.dir}，${c.detail}${tieTail || '，占者以为王者有更始之象'}`, mood: 0, importance: 2 };
      case 'storm':
        return { text: `夜见异光如火，彻于${c.dir}天，占者以为兵象${tieTail}`, mood: -1, importance: 2 };
    }
  }
  switch (kind) {
    case 'eclipse':
      return { text: `日食，历官预推得之，不以为异${tieTail}`, mood: 0, importance: 1 };
    case 'comet':
      return { text: `彗星见于${c.dir}，历官算其轨道，非灾异${tieTail}`, mood: 0, importance: 1 };
    case 'meteor':
      return { text: `流星雨，天文官记之${tieTail}`, mood: 0, importance: 1 };
    case 'conjunction':
      return { text: `行星会合于${c.dir}，天文官记之${tieTail}`, mood: 1, importance: 2 };
    case 'nova':
      return { text: `客星见于${c.dir}，天文官测其位、记其光变${tieTail}`, mood: 0, importance: 1 };
    case 'storm':
      return { text: `磁暴，指南之针失准，海船以星位校正${tieTail}`, mood: 0, importance: 1 };
  }
}

const cache = new WeakMap<Civ, Omen[]>();

/** 这个世界的天象表(和前后几年的史事挂好钩;同一个 civ 只算一次) */
export function omensOf(civ: Civ, world: World): Omen[] {
  const hit = cache.get(civ);
  if (hit) return hit;
  const sys = astroOf(world);
  if (!sys) {
    cache.set(civ, []);
    return [];
  }
  const seed = subSeed(civ.seed, 'omens');
  const majors = filterChronicle(buildChronicle(civ), { major: true });
  const eraCache = new Map<number, number>();
  const out: Omen[] = [];
  for (const c of schedule(civ, sys, seed)) {
    const year = Math.floor(c.year);
    const tie = tieOf(civ, year, majors);
    // 常见天象只在挂上大事时记一笔(否则编年史会被日食、流星雨、磁暴、会星会合撑满);彗星、客星照记
    const common = (c.kind === 'eclipse' && c.detail !== '伴星掩日' && c.detail !== '两星互食' && c.detail !== '大星掩日') || c.kind === 'meteor' || c.kind === 'storm' || c.kind === 'conjunction';
    if (common && !tie) continue;
    // 日食、流星雨这种常见天象只在挂上大事时记一笔,免得编年史被它们撑满
    // 常见天象(日食、流星雨、磁暴、会合)只在挂上大事时记一笔,免得编年史被它们撑满;彗星、客星另记
    let era = eraCache.get(year);
    if (era === undefined) {
      era = worldEraAt(civ, year);
      eraCache.set(year, era);
    }
    const classical = era < GUNPOWDER_ERA;
    const t = omenText(c.kind, c, classical, tie);
    out.push({ year, kind: c.kind, region: -1, mood: t.mood, importance: t.importance, classical, tie, text: t.text });
  }
  out.sort((a, b) => a.year - b.year);
  cache.set(civ, out);
  return out;
}

/** 导出用:按年份排的天象纪要(设定集 / 编年史附录) */
export function omenDocument(civ: Civ, world: World): string {
  const list = omensOf(civ, world);
  if (!list.length) return '这个世界没有天象记录(没开星球系)。';
  const lines: string[] = ['# 天象纪', ''];
  let lastEra = '';
  for (const o of list) {
    const era = o.classical ? '古典' : '历法既明';
    if (era !== lastEra) {
      lines.push(era === '古典' ? '## 古典之世(不知其故)' : '## 历法既明(预推不以为异)', '');
      lastEra = era;
    }
    lines.push(`- **第 ${o.year} 年** ${OMEN_NAMES[o.kind]}:${o.text}`);
  }
  return lines.join('\n') + '\n';
}
