/**
 * 君主的「治绩」:他在位这些年本国怎么样(人物卡上「倾向」下面那一段)。打开卡片时现算,只读推演的结果,不改历史。
 *
 *   每位君主都有的四行(没变也写,"始终 24 州""没打过仗"本身就是这一朝的样子):
 *     疆域  即位时 → 末年几州,小字得几失几、最多时几州;没变写"始终 N 州"
 *     人口  约多少 → 约多少,小字多了 / 少了百分之几;差不到 1% 写"没大变化"
 *     战事  "29 年里打了约 8 年",小字最长几年无战事;一仗没打写"没打过仗",小字在位几年
 *     钱粮  国库的档位(充裕、尚可、拮据、国用不足),有国用不足的写哪年;小字岁入多少万石(旧版本的历史没有账本,这一行不出)
 *   有才列的几行(只列他在位时真有的;同一样有几件时一件一行,按年份):
 *     国号(升格)、迁都、城(新筑、被毁)、时代(国都进入 / 退回某时代)、首创(世上第一的发明)、物产(发现、采空)、
 *     天灾(饥荒、瘟疫、地震、大水、大旱;同一种不止一城受灾的并成一条,同一城受灾几回算一座)
 *   在位不满 SHORT_REIGN 年的:几乎什么都没变,缩成一句写他在位时的国势。
 *
 * 只给君主(共和国是执政官);将领、名臣、宗室 = null。取数:州的归属(timeline.ts)、各州人口(growth.ts)、
 * 账本和"国用不足"那几条(fiscalBook.ts)、打仗的起止(warSpans)、发展度的大事(development.ts)、城的兴废和受灾、国号和国都的变迁。
 * 即位、退位那一刻前后归属、人口会跳(改朝换代、亡国),两头各往里收 EDGE 年再取。
 */
import type { Civ, Person, Year } from '../types';
import type { Era } from '../../era';
import { yearShortAt, yearSpan } from '../../era';
import { ownersAt } from '../engine/timeline';
import { capitalAt, polityName, populationLabel, regionPopulationAt } from '../growth';
import { fiscalAt, fiscalMood, fillOf, warSpans, type BookRow } from '../fiscalBook';
import { ERAS, INVENTIONS, RESOURCES } from '../development';
import { regionLabel } from './display';
import { quakeWord } from '../calamity';

/** 在位不满几年的缩成一句 */
export const SHORT_REIGN = 3;
/** 即位、退位两头各往里收几年再取归属、人口 */
const EDGE = 0.3;
/** 疆域"最多时 / 最少时"每隔几年看一眼 */
const PEAK_STEP = 5;
/** 新筑的城、被毁的城最多各列几座 */
const MAX_BUILT = 3;
const MAX_RUINED = 2;

const MOODS = ['充裕', '尚可', '拮据', '国用不足'] as const;
/** 天灾的名字(quake 照震中那州再分地震、大水、大旱,见 calamity.ts 的 quakeWord) */
const CAUSE = { famine: '饥荒', plague: '瘟疫', slump: '疫后凋敝' } as const;

/** 有才列的那几行的名目(也是排在四行底子后面的那几行) */
export type ReignEventKind = '国号' | '迁都' | '城' | '时代' | '首创' | '物产' | '天灾';

/** 在位时的一件大事 */
export interface ReignEvent {
  year: Year;
  kind: ReignEventKind;
  text: string;
  until?: Year;
}

/** 治绩里的一行:名目、值(一件一行)、小字 */
export interface ReignRow {
  k: string;
  lines: string[];
  note: string;
}

/** 算治绩用的数(单测核对用;界面只用 reignRecord 写好的字) */
export interface ReignFacts {
  from: Year;
  until: Year;
  /** 在位几年 */
  len: number;
  /** 即位时、末年各几州 */
  regions: [number, number];
  gained: number;
  lost: number;
  /** 在位时最多、最少几州(每 PEAK_STEP 年看一眼,连同两头) */
  peak: number;
  low: number;
  /** 即位时、末年的人口(千人) */
  pop: [number, number];
  /** 在位时打仗的年数(几场仗并起来)、最长连着几年没打 */
  warYears: number;
  longestPeace: number;
  /** 钱粮:档位(MOODS 的下标)、岁入(万石)、国用不足的那几年;没有账本 = null */
  fiscal: { mood0: number; mood1: number; income0: number; income1: number; short: number[] } | null;
  /** 在位时的大事(按年份;同一年同一件只留一条)。until = 几城受灾并成一条的,最后一城受灾那年 */
  events: ReignEvent[];
}

export interface ReignRecord {
  facts: ReignFacts;
  /** 一行一项(在位不满 SHORT_REIGN 年的也算好了,界面不用) */
  rows: ReignRow[];
  /** 在位不满 SHORT_REIGN 年的一句话;够年数的 = null */
  short: string | null;
}

/** 在位的年数:"不到 1 年""29 年" */
const yrs = (v: number) => (v < 1 ? '不到 1 年' : `${Math.round(v)} 年`);
/** 人口的字,不带"约":"1484 万""3200 人" */
const popText = (pop: number) => populationLabel(pop).replace(/^约 /, '').replace(/万人$/, '万');
/** 句子里的人口:"约 1484 万人""约 3200 人" */
const popPeople = (pop: number) => {
  const t = popText(pop);
  return `约 ${t}${t.endsWith('万') ? '人' : ''}`;
};
/** 千石 → 万石 */
const wan = (k: number) => Math.round(k / 10);

/** 治绩用的数;不是君主(没有在位年份)= null */
export function reignFacts(civ: Civ, x: Person): ReignFacts | null {
  if (x.role !== 'ruler' || x.from === undefined) return null;
  const pid = x.polity;
  const p = civ.polities[pid];
  if (!p) return null;
  const from = x.from;
  const until = Math.max(from, x.until ?? civ.endYear);
  const len = until - from;
  const edge = Math.min(EDGE, len / 2);
  const a = from + edge;
  const b = Math.max(a, until - edge);

  // 各州归属按年份(取到 1/4 年)缓存
  const owned = new Map<number, Int16Array>();
  const ownAt = (y: number): Int16Array => {
    const k = Math.round(y * 4) / 4;
    let o = owned.get(k);
    if (!o) owned.set(k, (o = ownersAt(civ, k).polity));
    return o;
  };
  const regionsOf = (y: number): number[] => {
    const o = ownAt(y);
    const out: number[] = [];
    for (let r = 0; r < o.length; r++) if (o[r] === pid) out.push(r);
    return out;
  };
  const popOf = (rs: readonly number[], y: number) => rs.reduce((s, r) => s + regionPopulationAt(civ, r, y), 0);

  // 疆域、人口
  const rs0 = regionsOf(a);
  const rs1 = regionsOf(b);
  const s0 = new Set(rs0);
  const s1 = new Set(rs1);
  const gained = rs1.filter((r) => !s0.has(r)).length;
  const lost = rs0.filter((r) => !s1.has(r)).length;
  let peak = Math.max(rs0.length, rs1.length);
  let low = Math.min(rs0.length, rs1.length);
  for (let y = Math.ceil(a / PEAK_STEP) * PEAK_STEP; y < b; y += PEAK_STEP) {
    const n = regionsOf(y).length;
    if (n > peak) peak = n;
    if (n < low) low = n;
  }
  const pop: [number, number] = [popOf(rs0, a), popOf(rs1, b)];

  // 战事:在位时打的几场仗并起来,数打了几年、最长连着几年没打
  const iv: [number, number][] = [];
  for (const w of warSpans(civ).get(pid) ?? []) {
    const lo = Math.max(from, w.from);
    const hi = Math.min(until, w.to);
    if (hi > lo) iv.push([lo, hi]);
  }
  iv.sort((u, v) => u[0] - v[0]);
  let warYears = 0;
  let longestPeace = 0;
  let cs = -Infinity;
  let ce = -Infinity;
  for (const [lo, hi] of iv) {
    if (lo > ce) {
      if (ce > -Infinity) warYears += ce - cs;
      longestPeace = Math.max(longestPeace, lo - (ce > -Infinity ? ce : from));
      cs = lo;
      ce = hi;
    } else ce = Math.max(ce, hi);
  }
  if (ce > -Infinity) warYears += ce - cs;
  longestPeace = Math.max(longestPeace, until - (ce > -Infinity ? ce : from));

  // 钱粮:即位、末年各取那一刻最近的一行账(国库换档的那一年账本都记了一行,档位是准的)
  const f0 = fiscalAt(civ, pid, a);
  const f1 = fiscalAt(civ, pid, b);
  let fiscal: ReignFacts['fiscal'] = null;
  if (f0 && f1) {
    const moodOf = (f: BookRow) => fiscalMood(fillOf(f.values.国库, f.values.应缴), f.values.窘迫);
    const mood0 = moodOf(f0);
    const mood1 = moodOf(f1);
    const short: number[] = [];
    for (const e of civ.annals) if (e.kind === 'fiscal' && e.a === pid && e.year >= from && e.year <= until) short.push(Math.floor(e.year));
    fiscal = {
      mood0,
      mood1,
      income0: wan(f0.values.实收 + f0.values.收贡),
      income1: wan(f1.values.实收 + f1.values.收贡),
      short,
    };
  }

  // 大事:国号、迁都、城、时代、首创、物产、天灾
  const raw: ReignEvent[] = [];
  const inReign = (y: number) => y > from + 1e-6 && y <= until + 1e-6;
  for (const t of p.titles ?? []) {
    if (!inReign(t.year)) continue;
    const name = polityName(p, t.year + 0.01);
    // 只是拓地、国号没换的不算升格
    if (name !== polityName(p, t.year - 0.01)) raw.push({ year: t.year, kind: '国号', text: `升格为${name}` });
  }
  for (const c of p.capitals ?? []) {
    const s = civ.settlements[c.settlement];
    if (inReign(c.year) && s) raw.push({ year: c.year, kind: '迁都', text: `迁都${s.name}` });
  }
  const built: ReignEvent[] = [];
  const ruined: ReignEvent[] = [];
  const sacks = new Map<string, { year: Year; region: number; city: number }[]>();
  for (const s of civ.settlements) {
    if (inReign(s.founded) && ownAt(s.founded + 0.25)[s.region] === pid) built.push({ year: s.founded, kind: '城', text: `筑${s.name}` });
    if (s.ended !== undefined && s.ended > from && s.ended <= until && ownAt(s.ended - 0.25)[s.region] === pid) ruined.push({ year: s.ended, kind: '城', text: `${s.name}被毁` });
    for (const k of s.sacks ?? []) {
      if (!k.cause || k.year < from || k.year > until || ownAt(k.year)[s.region] !== pid) continue;
      // 地震、大水、大旱记的都是 quake,照震中那州定是哪样(和编年史一样);火山另记一种
      const what = k.cause === 'quake' ? quakeWord(civ.regions, k.from ?? s.region) : k.cause === 'volcano' ? '火山' : k.cause === 'impact' ? '陨星' : CAUSE[k.cause as keyof typeof CAUSE];
      let l = sacks.get(what);
      if (!l) sacks.set(what, (l = []));
      l.push({ year: k.year, region: s.region, city: s.id });
    }
  }
  raw.push(...built.slice(0, MAX_BUILT), ...ruined.slice(0, MAX_RUINED));
  for (const e of civ.development?.events ?? []) {
    if (e.polity !== pid || e.year < from || e.year > until) continue;
    if (e.kind === 'enter') raw.push({ year: e.year, kind: '时代', text: `国都进入${ERAS[e.era]}时代` });
    else if (e.kind === 'regress') raw.push({ year: e.year, kind: '时代', text: `国都退回${ERAS[e.era]}时代` });
    else if (e.kind === 'invent' && e.invention !== undefined) raw.push({ year: e.year, kind: '首创', text: `首创${INVENTIONS[e.invention].name}` });
    else if (e.kind === 'discover' && e.resource !== undefined) raw.push({ year: e.year, kind: '物产', text: `${regionLabel(civ, e.region)}发现${RESOURCES[e.resource]}` });
    else if (e.kind === 'deplete' && e.resource !== undefined) {
      const what = RESOURCES[e.resource];
      raw.push({ year: e.year, kind: '物产', text: `${regionLabel(civ, e.region)}${what}${/矿|铁|铜|煤|金|银|石油/.test(what) ? '采空' : '吃空'}` });
    }
    // first(世上头一回进这个时代)和同一刻国都进入的那一条是同一件,不另写
  }
  // 天灾:同一种只一城受灾的写那州,不止一城的并成一条(同一城受灾几回只算一座;跨了几年的带上起止)
  for (const [what, l] of sacks) {
    l.sort((u, v) => u.year - v.year);
    const cities = new Set(l.map((k) => k.city)).size;
    const text = cities === 1 ? `${regionLabel(civ, l[0].region)}${what}` : `${what}，${cities} 座城受灾`;
    raw.push({ year: l[0].year, kind: '天灾', text, until: l.length > 1 ? l[l.length - 1].year : undefined });
  }
  raw.sort((u, v) => u.year - v.year);
  const seen = new Set<string>();
  const events = raw.filter((e) => {
    const k = `${Math.floor(e.year)}${e.kind}${e.text}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return {
    from,
    until,
    len,
    regions: [rs0.length, rs1.length],
    gained,
    lost,
    peak,
    low,
    pop,
    warYears: Math.round(warYears * 10) / 10,
    longestPeace: Math.round(longestPeace * 10) / 10,
    fiscal,
    events,
  };
}

/** 一件大事写成一行:"2337 年升格为大衍王朝";几城受灾、跨了几年的带上起止 */
function eventLine(e: ReignEvent, era: Era | null | undefined): string {
  const span = e.until !== undefined && Math.floor(e.until) > Math.floor(e.year);
  return `${yearShortAt(e.year, era)}${e.text}${span ? `（${yearSpan(e.year, e.until!, era)}）` : ''}`;
}

/** 君主的治绩;不是君主 = null */
export function reignRecord(civ: Civ, x: Person, era?: Era | null): ReignRecord | null {
  const f = reignFacts(civ, x);
  return f ? reignRecordOf(f, era) : null;
}

/** 复制生平里的治绩:"治绩：" 一行加每行一项("疆域：24 州 → 26 州（得 2 州）");不满 SHORT_REIGN 年的 "治绩：" 后接那一句 */
export function reignText(r: ReignRecord): string[] {
  if (r.short !== null) return [`治绩：${r.short}`];
  return ['治绩：', ...r.rows.map((row) => `${row.k}：${row.lines.join('；')}${row.note ? `（${row.note}）` : ''}`)];
}

/** 由算好的数写成治绩(拆出来是为了单测能直接给数) */
export function reignRecordOf(f: ReignFacts, era?: Era | null): ReignRecord {
  const rows: ReignRow[] = [];
  const [r0, r1] = f.regions;
  // 疆域
  if (r0 !== r1 || f.gained || f.lost) {
    const gl = [f.gained ? `得 ${f.gained}` : '', f.lost ? `失 ${f.lost}` : ''].filter(Boolean).join('、');
    const note = [gl && `${gl} 州`, f.peak > Math.max(r0, r1) ? `最多时 ${f.peak} 州` : ''].filter(Boolean).join('，');
    rows.push({ k: '疆域', lines: [`${r0} 州 → ${r1} 州`], note });
  } else rows.push({ k: '疆域', lines: [`始终 ${r0} 州`], note: f.peak > r0 ? `最多时 ${f.peak} 州` : f.low < r0 ? `最少时 ${f.low} 州` : '' });
  // 人口
  const [p0, p1] = f.pop;
  const pc = p0 > 0 ? Math.round((Math.abs(p1 - p0) / p0) * 100) : p1 > 0 ? Infinity : 0;
  if (pc < 1) rows.push({ k: '人口', lines: [`约 ${popText(p0)}`], note: '没大变化' });
  else if (!Number.isFinite(pc)) rows.push({ k: '人口', lines: [`约 ${popText(p1)}`], note: '' });
  // 四舍五入后前后的约数一样("约 14 万 → 约 14 万,多了 4%"):只写一个数
  else if (popText(p0) === popText(p1)) rows.push({ k: '人口', lines: [`约 ${popText(p0)}`], note: '大致没变' });
  else rows.push({ k: '人口', lines: [`约 ${popText(p0)} → 约 ${popText(p1)}`], note: `${p1 >= p0 ? '多了' : '少了'} ${pc}%` });
  // 战事
  const noWar = f.warYears < 0.05;
  const warLen = f.warYears < 1 ? '不到 1 年' : `约 ${Math.round(f.warYears)} 年`;
  if (noWar) rows.push({ k: '战事', lines: ['没打过仗'], note: yrs(f.len) });
  else rows.push({ k: '战事', lines: [`${yrs(f.len)}里打了${warLen}`], note: f.longestPeace >= 1 ? `最长 ${yrs(f.longestPeace)}无战事` : '' });
  // 钱粮("国库一直充裕";一直入不敷出的写"一直国用不足",不写"国库一直国用不足")
  let money = '';
  let moneyShort = '';
  /** 国库没换档、也没出过国用不足 */
  let fiscalSame = true;
  if (f.fiscal) {
    const { mood0, mood1, income0, income1, short } = f.fiscal;
    fiscalSame = mood0 === mood1 && !short.length;
    const broke = mood1 === MOODS.length - 1;
    money = short.length
      ? `${short.length > 1 ? `${short.length} 回国用不足（${yearShortAt(short[0], era)}起）` : `${yearShortAt(short[0], era)}国用不足`}，末年${MOODS[mood1]}`
      : mood0 === mood1
        ? `${broke ? '' : '国库'}一直${MOODS[mood1]}`
        : `国库从${MOODS[mood0]}到${MOODS[mood1]}`;
    // 一句话里不写"一直":"国库充裕""国用不足"
    moneyShort = !short.length && mood0 === mood1 ? `${broke ? '' : '国库'}${MOODS[mood1]}` : money;
    rows.push({ k: '钱粮', lines: [money], note: income0 === income1 ? `岁入约 ${income1} 万石` : `岁入 ${income0} → ${income1} 万石` });
  }
  // 大事:同一类并成一行(一件一行),按这一类头一件的先后
  const groups = new Map<ReignEventKind, string[]>();
  for (const e of f.events) {
    let l = groups.get(e.kind);
    if (!l) groups.set(e.kind, (l = []));
    l.push(eventLine(e, era));
  }
  for (const [k, lines] of groups) rows.push({ k, lines, note: k === '首创' ? '世上第一' : '' });

  // 在位不满 SHORT_REIGN 年:一句话
  let short: string | null = null;
  if (f.len < SHORT_REIGN) {
    // 年数和人物卡副标题同一个取法:起止各取整年再相减(2.5 年可能写 2 年,不四舍五入)
    const whole = Math.floor(f.until) - Math.floor(f.from);
    const head = `在位${whole < 1 ? '不到一年' : ` ${whole} 年`}`;
    const popSame = pc < 1 || popText(p0) === popText(p1);
    const landSame = r0 === r1;
    // 疆域、人口、国库都没变才写"国中没有变化";否则照实写变了的那几样
    let land: string;
    if (landSame && popSame && fiscalSame) land = `国中没有变化：${r0} 州，${popPeople(p0)}`;
    else {
      const parts = [landSame ? '疆域没变' : `疆域从 ${r0} 州到 ${r1} 州`];
      if (!popSame) parts.push(`人口${p1 >= p0 ? '增到' : '减到'}${popPeople(p1)}`);
      land = parts.join('，');
    }
    const fisc = moneyShort ? `，${moneyShort}` : '';
    const war = noWar ? '，没打仗' : `，打了${warLen}仗`;
    short = `${head}，${land}${fisc}${war}。`;
  }
  return { facts: f, rows, short };
}
